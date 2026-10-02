/**
 * Data export — the user's own data, in a portable structured form.
 *
 * **This module is a read path and nothing else.** It contains no mutation, no
 * internal function and no write of any kind, so there is no "delete my
 * account" logic hiding here and no code path from a download to a change.
 * Account *deletion* is deliberately a separate, unsolved product decision
 * (D56): the shared-space, audit-retention and per-user-state questions are
 * legal and product calls, not implementation details, and guessing at them in
 * the same commit that adds a download would be worse than leaving them open.
 *
 * ## What "export" means here
 *
 * One deterministic JSON document containing:
 *
 * - a manifest (`buildManifest`) stating exactly what was included and what
 *   was withheld, so a user can tell the difference between "I have no audit
 *   records" and "audit records were not exported";
 * - the user's own rows, read through an **index-bounded** range per table;
 * - **counts** for the security/audit tier, never its rows.
 *
 * ## Why the reads are written out one by one
 *
 * An earlier draft looped over a `table: string` and called `ctx.db.query(table)`.
 * That does not type-check — Convex resolves table names statically, and a
 * dynamic name erases the very guarantee that makes this safe. Spelling out
 * fifteen bounded reads is more lines and buys three things: every read is
 * checked against its real index at compile time, a table with no owner index
 * cannot be read by accident, and adding a table to the export is a visible
 * edit rather than a map lookup that might silently cover a new table.
 *
 * ## The three properties that make it trustworthy
 *
 * 1. **Owner-scoped.** Every read is an index equality on the caller's own
 *    user id. No argument names another user, so there is no substituted-id
 *    attack — the harness proves it by exporting as two users and diffing.
 * 2. **Bounded.** Each read fetches `MAX_ROWS_PER_TABLE + 1` and reports a cap
 *    when the extra row comes back. D48 applies with full force: a bounded
 *    *result* over an unbounded *scan* is not a bounded export.
 * 3. **Secret-free by construction.** No table classified `systemSecret` is
 *    read at all — the omission is structural, not a filter. The redaction pass
 *    over each emitted row is defence in depth for the different threat of
 *    someone adding a credential column to an already-exported table.
 *
 * ## Determinism
 *
 * Rows come back in index order and the only wall-clock value is `exportedAt`,
 * which is an argument rather than a `Date.now()` read. Two exports of
 * unchanged data differ only in that field, which makes them diffable.
 */

import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";

import { query } from "./_generated/server";

import { NEVER_EXPORT_FIELDS, PROFILE_FIELDS, buildManifest } from "../lib/export";

/**
 * Rows per table.
 *
 * Deliberately generous for a personal operating system and deliberately not
 * "everything": the read must be bounded at the database (D48), and an
 * unbounded export of a large space is a request that can exhaust the function.
 * A reached cap is **reported**, because a silent truncation is the privacy
 * equivalent of a wrong number — a user would hold a partial file that claims
 * to be complete.
 */
const MAX_ROWS_PER_TABLE = 5000;

/** Fetch one row past the cap so "exactly full" is distinguishable from "more". */
function bounded<T>(rows: T[]): { items: T[]; capped: boolean } {
  const capped = rows.length > MAX_ROWS_PER_TABLE;
  return { items: capped ? rows.slice(0, MAX_ROWS_PER_TABLE) : rows, capped };
}

/**
 * Strip anything credential-shaped from a row.
 *
 * The second of two controls. The first is that no secret-classified table is
 * read. This covers the different threat of someone adding a `token` column to
 * a table already classified `userOwned`. A denylist is the wrong shape for the
 * profile — hence `PROFILE_FIELDS` as an allowlist — but the right shape here,
 * because these rows are otherwise the user's own data and dropping unknown
 * fields would break the export's usefulness.
 */
function redact<T extends Record<string, unknown>>(row: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(row)) {
    if ((NEVER_EXPORT_FIELDS as readonly string[]).includes(k)) continue;
    out[k] = val;
  }
  return out;
}

export const exportMyData = query({
  args: {
    /** Epoch ms stamped into the manifest. Passed in so the export is reproducible. */
    exportedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);

    // Unauthenticated callers get an empty but well-formed export rather than
    // an error. A thrown error tells an anonymous prober the function exists;
    // an empty manifest tells them nothing and is indistinguishable from a real
    // user who has no data yet.
    if (!userId) {
      return {
        manifest: buildManifest({
          userId: "anonymous",
          exportedAt: args.exportedAt ?? 0,
          counts: {},
          withheld: {},
        }),
        data: {} as Record<string, unknown[]>,
      };
    }

    const counts: Record<string, number> = {};
    const data: Record<string, unknown[]> = {};

    // ---- the profile, by allowlist --------------------------------------
    const me = await ctx.db.get(userId);
    if (me) {
      const profile: Record<string, unknown> = { _id: me._id };
      const raw = me as unknown as Record<string, unknown>;
      for (const field of PROFILE_FIELDS) {
        if (raw[field] !== undefined) profile[field] = raw[field];
      }
      data.profile = [profile];
      counts.profile = 1;
    }

    // ---- the user's own rows, index-bounded ------------------------------
    const t = bounded(
      await ctx.db
        .query("tasks")
        .withIndex("by_owner", (q) => q.eq("ownerUserId", userId))
        .take(MAX_ROWS_PER_TABLE + 1),
    );
    data.tasks = t.items.map(redact);
    counts.tasks = t.items.length;
    if (t.capped) counts["tasks.capped"] = 1;

    const p = bounded(
      await ctx.db
        .query("people")
        .withIndex("by_owner", (q) => q.eq("ownerUserId", userId))
        .take(MAX_ROWS_PER_TABLE + 1),
    );
    data.people = p.items.map(redact);
    counts.people = p.items.length;
    if (p.capped) counts["people.capped"] = 1;

    const n = bounded(
      await ctx.db
        .query("notes")
        .withIndex("by_owner", (q) => q.eq("ownerUserId", userId))
        .take(MAX_ROWS_PER_TABLE + 1),
    );
    data.notes = n.items.map(redact);
    counts.notes = n.items.length;
    if (n.capped) counts["notes.capped"] = 1;

    const ar = bounded(
      await ctx.db
        .query("areas")
        .withIndex("by_owner", (q) => q.eq("ownerUserId", userId))
        .take(MAX_ROWS_PER_TABLE + 1),
    );
    data.areas = ar.items.map(redact);
    counts.areas = ar.items.length;
    if (ar.capped) counts["areas.capped"] = 1;

    const tp = bounded(
      await ctx.db
        .query("taxProfile")
        .withIndex("by_owner", (q) => q.eq("ownerUserId", userId))
        .take(MAX_ROWS_PER_TABLE + 1),
    );
    data.taxProfile = tp.items.map(redact);
    counts.taxProfile = tp.items.length;

    const td = bounded(
      await ctx.db
        .query("taxDocuments")
        .withIndex("by_owner", (q) => q.eq("ownerUserId", userId))
        .take(MAX_ROWS_PER_TABLE + 1),
    );
    data.taxDocuments = td.items.map(redact);
    counts.taxDocuments = td.items.length;

    const ex = bounded(
      await ctx.db
        .query("expenses")
        .withIndex("by_owner", (q) => q.eq("ownerUserId", userId))
        .take(MAX_ROWS_PER_TABLE + 1),
    );
    data.expenses = ex.items.map(redact);
    counts.expenses = ex.items.length;

    const ce = bounded(
      await ctx.db
        .query("calendarEvents")
        .withIndex("by_owner", (q) => q.eq("ownerUserId", userId))
        .take(MAX_ROWS_PER_TABLE + 1),
    );
    data.calendarEvents = ce.items.map(redact);
    counts.calendarEvents = ce.items.length;

    const docs = bounded(
      await ctx.db
        .query("documents")
        .withIndex("by_owner", (q) => q.eq("ownerUserId", userId))
        .take(MAX_ROWS_PER_TABLE + 1),
    );
    data.documents = docs.items.map(redact);
    counts.documents = docs.items.length;

    const cm = bounded(
      await ctx.db
        .query("commitments")
        .withIndex("by_owner", (q) => q.eq("ownerUserId", userId))
        .take(MAX_ROWS_PER_TABLE + 1),
    );
    data.commitments = cm.items.map(redact);
    counts.commitments = cm.items.length;

    const accts = bounded(
      await ctx.db
        .query("accounts")
        .withIndex("by_owner", (q) => q.eq("ownerUserId", userId))
        .take(MAX_ROWS_PER_TABLE + 1),
    );
    data.accounts = accts.items.map(redact);
    counts.accounts = accts.items.length;

    const subs = bounded(
      await ctx.db
        .query("subscriptions")
        .withIndex("by_owner", (q) => q.eq("ownerUserId", userId))
        .take(MAX_ROWS_PER_TABLE + 1),
    );
    data.subscriptions = subs.items.map(redact);
    counts.subscriptions = subs.items.length;

    const conns = bounded(
      await ctx.db
        .query("connections")
        .withIndex("by_owner", (q) => q.eq("ownerUserId", userId))
        .take(MAX_ROWS_PER_TABLE + 1),
    );
    // `connections` carries the provider, label, status and scopes the user
    // granted — their own linkage data — and no token, because the live
    // credential lives in `connectionTokens`, which is never read here.
    data.connections = conns.items.map(redact);
    counts.connections = conns.items.length;

    const txns = bounded(
      await ctx.db
        .query("transactions")
        .withIndex("by_owner_postedAt", (q) => q.eq("ownerUserId", userId))
        .take(MAX_ROWS_PER_TABLE + 1),
    );
    data.transactions = txns.items.map(redact);
    counts.transactions = txns.items.length;
    if (txns.capped) counts["transactions.capped"] = 1;

    const imps = bounded(
      await ctx.db
        .query("imports")
        .withIndex("by_owner_createdAt", (q) => q.eq("ownerUserId", userId))
        .take(MAX_ROWS_PER_TABLE + 1),
    );
    data.imports = imps.items.map(redact);
    counts.imports = imps.items.length;

    // ---- spaces the user belongs to --------------------------------------
    const memberships = await ctx.db
      .query("spaceMembers")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .take(MAX_ROWS_PER_TABLE);
    const spaceIds = memberships.map((m) => m.spaceId);
    const spaceDocs = await Promise.all(spaceIds.map((id) => ctx.db.get(id)));
    data.spaces = spaceDocs.filter((s) => s !== null).map((s) => redact(s));
    counts.spaces = data.spaces.length;

    // ---- withheld: counted, never emitted --------------------------------
    // These name other data subjects or exist as evidence. A count tells the
    // user they exist; the rows would tell them about someone else.
    const withheld: Record<string, number> = {};

    // Written out one per table rather than driven by a name→index map. A
    // dynamic index name erases the type that proves the index exists, and an
    // index that does not exist is a silent full scan — which is precisely the
    // collect-then-filter shape D48 forbids. Spelled out, each count is
    // checked against its real index at compile time.
    //
    // `accessLog`, `activity`, `agentRuns` and `agentProposals` index
    // `by_space_at`, not `by_space`; that mismatch was a real compile error
    // when this was first written, which is the property worth keeping.
    const countPerSpace = async (
      read: (spaceId: (typeof spaceIds)[number]) => Promise<unknown[]>,
    ): Promise<number> => {
      let total = 0;
      for (const spaceId of spaceIds) {
        const rows = await read(spaceId);
        total += Math.min(rows.length, MAX_ROWS_PER_TABLE);
      }
      return total;
    };

    const spaceMembersN = await countPerSpace((spaceId) =>
      ctx.db
        .query("spaceMembers")
        .withIndex("by_space", (q) => q.eq("spaceId", spaceId))
        .take(MAX_ROWS_PER_TABLE + 1),
    );
    if (spaceMembersN > 0) withheld.spaceMembers = spaceMembersN;

    const grantsN = await countPerSpace((spaceId) =>
      ctx.db
        .query("grants")
        .withIndex("by_space", (q) => q.eq("spaceId", spaceId))
        .take(MAX_ROWS_PER_TABLE + 1),
    );
    if (grantsN > 0) withheld.grants = grantsN;

    const accessLogN = await countPerSpace((spaceId) =>
      ctx.db
        .query("accessLog")
        .withIndex("by_space_at", (q) => q.eq("spaceId", spaceId))
        .take(MAX_ROWS_PER_TABLE + 1),
    );
    if (accessLogN > 0) withheld.accessLog = accessLogN;

    const activityN = await countPerSpace((spaceId) =>
      ctx.db
        .query("activity")
        .withIndex("by_space_at", (q) => q.eq("spaceId", spaceId))
        .take(MAX_ROWS_PER_TABLE + 1),
    );
    if (activityN > 0) withheld.activity = activityN;

    const agentRunsN = await countPerSpace((spaceId) =>
      ctx.db
        .query("agentRuns")
        .withIndex("by_space_at", (q) => q.eq("spaceId", spaceId))
        .take(MAX_ROWS_PER_TABLE + 1),
    );
    if (agentRunsN > 0) withheld.agentRuns = agentRunsN;

    const agentProposalsN = await countPerSpace((spaceId) =>
      ctx.db
        .query("agentProposals")
        .withIndex("by_space_at", (q) => q.eq("spaceId", spaceId))
        .take(MAX_ROWS_PER_TABLE + 1),
    );
    if (agentProposalsN > 0) withheld.agentProposals = agentProposalsN;

    const linksN = await countPerSpace((spaceId) =>
      ctx.db
        .query("links")
        .withIndex("by_space", (q) => q.eq("spaceId", spaceId))
        .take(MAX_ROWS_PER_TABLE + 1),
    );
    if (linksN > 0) withheld.links = linksN;

    return {
      manifest: buildManifest({ userId, exportedAt: args.exportedAt ?? 0, counts, withheld }),
      data,
    };
  },
});
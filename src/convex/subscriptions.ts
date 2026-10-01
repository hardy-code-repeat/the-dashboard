/**
 * Subscriptions + account labels (phase 3, feature 5).
 *
 * The arguments are in ADR-028 (an account is a label, never a balance) and
 * ADR-029 (a subscription owns its renewal document; expiry logic is never
 * duplicated). This file is the implementation and the consequences.
 *
 * ## The four rules that shape every function here
 *
 * 1. **An account is a label.** No balance column exists, so none of these
 *    functions can store one, and there is no reconciliation problem because
 *    there is nothing to reconcile against. That is the point, not an omission
 *    (ADR-028).
 *
 * 2. **A subscription is created together with its document** (ADR-029).
 *    `createSubscription` inserts both in one mutation. That is what makes "one
 *    renewal, one item" still true: `document.expiring` is the only producer of
 *    "this is expiring" anywhere in the product, and this feature adds no
 *    attention kind, no section, no rule and no read to `getAttention`.
 *
 * 3. **Every amount passes one guard** — `isValidAmount`. `NaN <= 0` is
 *    `false`, so the pre-existing positivity check in `life:addExpense` waves
 *    NaN through into `estimateTax`, where every downstream total becomes NaN
 *    and the estimate renders as a real-looking figure that is entirely
 *    invented. D44. A plausible wrong number is worse than a crash, and this
 *    is the domain where that is least acceptable.
 *
 * 4. **Deleting detaches, it never cascades.** Removing an account keeps its
 *    subscriptions and reports how many; removing a subscription keeps its
 *    follow-up tasks and cancels its document. The same rule
 *    `deleteDocument` and `deleteCommitment` use, because a user must not be
 *    able to destroy an obligation by tidying a label.
 *
 * ## Authorisation
 *
 * Every read is scoped by a `by_owner` index on the caller's own id; every
 * write re-checks `ownerUserId`. `accountId` and `documentId` are
 * ownership-checked on the way in, so a subscription cannot be pointed at
 * another user's row. No mutation accepts `ownerUserId` or `spaceId`.
 */

import { getAuthUserId } from "@convex-dev/auth/server";
import type { GenericQueryCtx } from "convex/server";
import { v } from "convex/values";

import {
  ACCOUNT_KINDS,
  describeSubscription,
  isInterval,
  isValidAmount,
  MAX_AMOUNT,
  normaliseLabel,
  summariseSubscriptions,
  type AccountKind,
  type SubscriptionInterval,
} from "../lib/subscriptions";

import { requireUserId } from "./assistant";
import { DEFAULT_LEAD_DAYS } from "../lib/documents";
import type { DataModel, Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { ensurePersonalSpace } from "./spaces";

/**
 * A query may be called signed out, and a query that returns somebody else's
 * data because it read the wrong index is the failure this whole project is
 * built to make impossible. So a query asks who is calling and refuses if the
 * answer is nobody; a mutation goes through `requireUserId`. Same split as
 * `life:getFinance` and `commitments:listCommitments`.
 */
async function requireQueryUserId(ctx: GenericQueryCtx<DataModel>): Promise<Id<"users">> {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("Not signed in");
  return userId;
}

/** Subscriptions returned per query. The surface is a list; it is not an export. */
const MAX_SUBSCRIPTIONS = 200;
const MAX_ACCOUNTS = 100;

/** How much activity `financeAudit` reads. A read, so it is bounded. */
const MAX_AUDIT_ROWS = 500;

// ---------------------------------------------------------------------------
// Argument guards
// ---------------------------------------------------------------------------

function requireAmount(raw: number): number {
  if (!isValidAmount(raw)) {
    // Deliberately distinguishes the two families. "not a number" and "not a
    // sensible amount" are different user mistakes and deserve different copy.
    throw new Error(
      Number.isNaN(raw)
        ? "Amount must be a number"
        : `Amount must be a positive amount of at most ${MAX_AMOUNT}`,
    );
  }
  return raw;
}

function requireInterval(raw: string): SubscriptionInterval {
  if (!isInterval(raw)) throw new Error("Unknown billing interval");
  return raw;
}

function requireKind(raw: string): AccountKind {
  // A type predicate rather than a cast, so a new kind added to the schema
  // without being added here is a compile error instead of a silent reject.
  if (!(ACCOUNT_KINDS as readonly string[]).includes(raw)) {
    throw new Error("Unknown account kind");
  }
  return raw as AccountKind;
}

function requireLabel(raw: string): string {
  const label = normaliseLabel(raw);
  if (!label) throw new Error("A name is required");
  return label;
}

/**
 * An optional renewal date.
 *
 * Validated rather than trusted because it is about to become a `documents`
 * field, and a document's `expiresAt` is the input to a hard attention rule
 * (ADR-025). A non-finite date there would make `document.expiring` compare
 * against NaN and quietly never fire — a renewal the user believes is tracked
 * and is not.
 */
function requireRenewsAt(raw: number | undefined): number | undefined {
  if (raw === undefined) return undefined;
  if (!Number.isFinite(raw)) throw new Error("Renewal date must be a real date");
  return raw;
}

// ---------------------------------------------------------------------------
// Ownership helpers
// ---------------------------------------------------------------------------

type Ctx = GenericQueryCtx<DataModel>;

async function requireAccount(
  ctx: Ctx,
  id: Id<"accounts">,
  userId: Id<"users">,
): Promise<Id<"accounts">> {
  const row = await ctx.db.get(id);
  if (!row || row.ownerUserId !== userId) throw new Error("Account not found");
  return id;
}

async function requireSubscription(
  ctx: Ctx,
  id: Id<"subscriptions">,
  userId: Id<"users">,
) {
  const row = await ctx.db.get(id);
  if (!row || row.ownerUserId !== userId) throw new Error("Subscription not found");
  return row;
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

export const listAccounts = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireQueryUserId(ctx);
    const rows = await ctx.db
      .query("accounts")
      .withIndex("by_owner", (q) => q.eq("ownerUserId", userId))
      .take(MAX_ACCOUNTS);
    return rows
      .map((r) => ({
        id: r._id,
        label: r.label,
        kind: r.kind,
        createdAt: r.createdAt,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  },
});

/**
 * Creates an account label. Nothing else — see ADR-028 for why there is no
 * second argument to pass.
 */
export const createAccount = mutation({
  args: { label: v.string(), kind: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const spaceId = await ensurePersonalSpace(ctx, userId);

    const id = await ctx.db.insert("accounts", {
      ownerUserId: userId,
      spaceId,
      label: requireLabel(args.label),
      kind: requireKind(args.kind),
      createdAt: Date.now(),
    });

    await ctx.db.insert("activity", {
      spaceId,
      actor: "user",
      kind: "account.created",
      objectKind: "account",
      objectId: id,
      at: Date.now(),
    });

    return id;
  },
});

/**
 * Renames an account. Label and kind only — there is nothing else on the row,
 * which is the property that makes this function this short.
 */
export const updateAccount = mutation({
  args: { id: v.id("accounts"), label: v.optional(v.string()), kind: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const row = await ctx.db.get(args.id);
    if (!row || row.ownerUserId !== userId) throw new Error("Account not found");

    const patch: Record<string, unknown> = {};
    if (args.label !== undefined) patch.label = requireLabel(args.label);
    if (args.kind !== undefined) patch.kind = requireKind(args.kind);
    if (Object.keys(patch).length === 0) return;
    await ctx.db.patch(row._id, patch);
  },
});

/**
 * Deletes an account label and **detaches** every subscription under it,
 * reporting the count.
 *
 * A cascade here would be a one-line mistake with a real cost: renaming or
 * tidying an account must not be able to delete a subscription the user still
 * pays. The subscriptions survive with `accountId` cleared, which resolves to
 * "ungrouped" on the next read — an honest answer rather than a lost row.
 */
export const deleteAccount = mutation({
  args: { id: v.id("accounts") },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const row = await ctx.db.get(args.id);
    if (!row || row.ownerUserId !== userId) throw new Error("Account not found");

    const attached = await ctx.db
      .query("subscriptions")
      .withIndex("by_owner_account", (q) =>
        q.eq("ownerUserId", userId).eq("accountId", args.id),
      )
      .collect();

    for (const sub of attached) {
      await ctx.db.patch(sub._id, { accountId: undefined });
    }
    await ctx.db.delete(row._id);
    return { detached: attached.length };
  },
});

// ---------------------------------------------------------------------------
// Subscriptions
// ---------------------------------------------------------------------------

/**
 * The list, with the renewal date resolved off each document.
 *
 * **One read, not one per row.** Resolving `subscriptions.documentId →
 * documents` inside the loop would be a 200-query N+1 on a reactively-
 * subscribed query — D41 wearing a different hat. Instead the documents the
 * subscriptions can point at are read once, by `_id`, through a single index
 * range, and joined in JavaScript.
 *
 * The account names come the same way. Neither is an N+1 because the index
 * range is bounded by the *subscription set*, which is already bounded.
 */
export const listSubscriptions = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireQueryUserId(ctx);
    const now = Date.now();

    const rows = await ctx.db
      .query("subscriptions")
      .withIndex("by_owner", (q) => q.eq("ownerUserId", userId))
      .take(MAX_SUBSCRIPTIONS);

    const [accounts, documents] = await Promise.all([
      ctx.db
        .query("accounts")
        .withIndex("by_owner", (q) => q.eq("ownerUserId", userId))
        .take(MAX_ACCOUNTS),
      // `_id` is a valid index prefix on every Convex table, so this is a
      // single range read of exactly the documents the subscriptions name.
      ctx.db
        .query("documents")
        .withIndex("by_owner", (q) => q.eq("ownerUserId", userId))
        .collect(),
    ]);

    const accountName = new Map(accounts.map((a) => [a._id, a.label]));
    const expiry = new Map(documents.map((d) => [d._id, d.expiresAt ?? null]));

    const views = rows.map((r) =>
      describeSubscription(
        {
          id: r._id,
          label: r.label,
          amount: r.amount,
          interval: r.interval as SubscriptionInterval,
          cancelled: r.cancelled,
          cancelledAt: r.cancelledAt,
          renewsAt: expiry.get(r.documentId) ?? null,
        },
        r.accountId ? (accountName.get(r.accountId) ?? null) : null,
        now,
      ),
    );

    return {
      subscriptions: views,
      summary: summariseSubscriptions(views),
      /** The closed vocabulary, so the UI never invents an interval. */
      intervals: ["weekly", "monthly", "quarterly", "yearly"],
      accountKinds: ["checking", "savings", "cash", "credit", "investment"],
    };
  },
});

/**
 * Creates a subscription **and its renewal document in the same mutation**
 * (ADR-029).
 *
 * Doing both here rather than in two calls is deliberate. Two calls leave a
 * window in which a subscription exists with no renewal being tracked — the
 * user believes they have asked Panel to watch something and Panel is not
 * watching it. That is the D34 defect class: a promise the code compiles
 * against and never keeps.
 *
 * `leadDays` is left unset so the document falls back to the shared default,
 * which is one number in one place rather than one per subscription.
 */
export const createSubscription = mutation({
  args: {
    label: v.string(),
    amount: v.number(),
    interval: v.string(),
    accountId: v.optional(v.id("accounts")),
    renewsAt: v.optional(v.number()),
    leadDays: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const spaceId = await ensurePersonalSpace(ctx, userId);

    const label = requireLabel(args.label);
    const amount = requireAmount(args.amount);
    const interval = requireInterval(args.interval);
    const renewsAt = requireRenewsAt(args.renewsAt);

    let accountId: Id<"accounts"> | undefined;
    if (args.accountId !== undefined) {
      accountId = await requireAccount(ctx, args.accountId, userId);
    }

    if (
      args.leadDays !== undefined &&
      (!Number.isFinite(args.leadDays) || args.leadDays < 0)
    ) {
      throw new Error("Lead time must be a positive number of days");
    }

    const now = Date.now();

    const documentId = await ctx.db.insert("documents", {
      ownerUserId: userId,
      spaceId,
      label,
      expiresAt: renewsAt ?? undefined,
      leadDays: args.leadDays ?? DEFAULT_LEAD_DAYS,
      createdAt: now,
    });

    const id = await ctx.db.insert("subscriptions", {
      ownerUserId: userId,
      spaceId,
      label,
      amount,
      interval,
      accountId,
      documentId,
      createdAt: now,
    });

    await ctx.db.insert("activity", {
      spaceId,
      actor: "user",
      kind: "subscription.created",
      objectKind: "subscription",
      objectId: id,
      at: now,
    });

    return { id, documentId };
  },
});

/**
 * Edits a subscription. Never its amount below zero, never its ownership, and
 * never its document.
 *
 * The document is immutable from here because it is the row the attention rule
 * reads; swapping it out would silently re-point an existing renewal at
 * something else. Changing the renewal *date* is a document edit, and the UI
 * sends it there.
 */
export const updateSubscription = mutation({
  args: {
    id: v.id("subscriptions"),
    label: v.optional(v.string()),
    amount: v.optional(v.number()),
    interval: v.optional(v.string()),
    accountId: v.optional(v.id("accounts")),
    renewsAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const row = await requireSubscription(ctx, args.id, userId);

    const patch: Record<string, unknown> = {};
    if (args.label !== undefined) patch.label = requireLabel(args.label);
    if (args.amount !== undefined) patch.amount = requireAmount(args.amount);
    if (args.interval !== undefined) patch.interval = requireInterval(args.interval);
    if (args.accountId !== undefined) {
      patch.accountId = await requireAccount(ctx, args.accountId, userId);
    }

    // The renewal date lives on the **document**, not here (ADR-029), so a
    // date-only edit leaves `patch` empty. Returning early on `patch` alone
    // would therefore skip the audit row for the single most common edit there
    // is — found by the conformance harness, which is the D38 shape arriving
    // one feature later: a declared kind that nothing writes.
    let touched = Object.keys(patch).length > 0;
    if (args.renewsAt !== undefined) {
      const at = requireRenewsAt(args.renewsAt);
      await ctx.db.patch(row.documentId, { expiresAt: at ?? undefined });
      touched = true;
    }

    if (!touched) return;
    if (Object.keys(patch).length > 0) await ctx.db.patch(row._id, patch);

    await ctx.db.insert("activity", {
      spaceId: row.spaceId,
      actor: "user",
      kind: "subscription.updated",
      objectKind: "subscription",
      objectId: row._id,
      at: Date.now(),
    });
  },
});

/**
 * Stops a subscription. Idempotent, and reversible.
 *
 * Cancellation **cancels the document too** (ADR-029). A cancelled
 * subscription that keeps an active renewal document would go on producing
 * `document.expiring` items forever — the user pays attention to something
 * they have already stopped, which is the fastest way to teach someone to
 * ignore the feed.
 */
export const cancelSubscription = mutation({
  args: { id: v.id("subscriptions") },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const row = await requireSubscription(ctx, args.id, userId);
    if (row.cancelled) return;

    const now = Date.now();
    await ctx.db.patch(row._id, { cancelled: true, cancelledAt: now });
    // Clearing the date is the whole of it, and it is enough: `document.expiring`
    // needs an `expiresAt` inside the lead window, so removing the date removes
    // the item. There is no "cancelled" state on a document and this feature
    // did not add one — the derived seven-state machine (ADR-025) is untouched.
    await ctx.db.patch(row.documentId, { expiresAt: undefined });

    await ctx.db.insert("activity", {
      spaceId: row.spaceId,
      actor: "user",
      kind: "subscription.cancelled",
      objectKind: "subscription",
      objectId: row._id,
      at: now,
    });
  },
});

/** Undoes a cancellation without deleting anything. */
export const reactivateSubscription = mutation({
  args: { id: v.id("subscriptions"), renewsAt: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const row = await requireSubscription(ctx, args.id, userId);
    if (!row.cancelled) return;

    await ctx.db.patch(row._id, { cancelled: false, cancelledAt: undefined });
    if (args.renewsAt !== undefined) {
      const at = requireRenewsAt(args.renewsAt);
      await ctx.db.patch(row.documentId, { expiresAt: at ?? undefined });
    }
  },
});

/**
 * Deletes a subscription. Detaches the follow-up tasks, cancels the document,
 * and reports the count.
 *
 * A renewal task is an ordinary task (ADR-026) and deleting the subscription
 * must not delete a task the user may have turned into something else. So the
 * tasks survive with `subscriptionId` cleared, exactly as `deleteDocument`
 * detaches from `documentId`.
 */
export const deleteSubscription = mutation({
  args: { id: v.id("subscriptions") },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const row = await requireSubscription(ctx, args.id, userId);

    // `by_owner_document` is the index feature 3 built for exactly this
    // lookup. Collecting the user's whole task set to filter it in JavaScript
    // would be D37/D39/D41/D42 wearing a fifth hat, and this is a path the
    // project has now been caught by four times.
    const tasks = await ctx.db
      .query("tasks")
      .withIndex("by_owner_document", (q) =>
        q.eq("ownerUserId", userId).eq("documentId", row.documentId),
      )
      .collect();

    for (const t of tasks) {
      await ctx.db.patch(t._id, { documentId: undefined });
    }

    await ctx.db.patch(row.documentId, { expiresAt: undefined });
    await ctx.db.delete(row._id);

    await ctx.db.insert("activity", {
      spaceId: row.spaceId,
      actor: "user",
      kind: "subscription.deleted",
      objectKind: "subscription",
      objectId: args.id,
      at: Date.now(),
    });

    return { detached: tasks.length };
  },
});

/**
 * The audit read.
 *
 * It exists so the claim "all five of these kinds are written" is *checkable*
 * rather than asserted — the R-005 / D38 lesson, which has now been applied
 * three times. A bounded read: `.collect()` on `by_owner` is owner-scoped and
 * capped, and a test that only checked the kinds exist would have passed against
 * an unbounded version.
 */
export const financeAudit = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireQueryUserId(ctx);

    // `activity` deliberately carries no `ownerUserId` — it is the one table
    // in the product about things rather than owned by a person, and its scope
    // comes from the space (ADR-009). A query cannot call `ensurePersonalSpace`
    // (that writes), so the space is read off a row the caller already owns.
    // A user with no accounts and no subscriptions has no activity to audit
    // either, so the empty result is correct rather than a special case.
    const anchor = await ctx.db
      .query("accounts")
      .withIndex("by_owner", (q) => q.eq("ownerUserId", userId))
      .first();

    if (!anchor) return { counts: {}, read: 0, kinds: [] };
    const spaceId = anchor.spaceId;

    // `by_space_at` is a compound index, so the space is the prefix and the
    // timestamp the range. `activity` deliberately carries no `ownerUserId`:
    // it is the one table in the product about things rather than owned by a
    // person, and scope comes from the space (ADR-009).
    const rows = await ctx.db
      .query("activity")
      .withIndex("by_space_at", (q) => q.eq("spaceId", spaceId).gte("at", 0))
      .take(MAX_AUDIT_ROWS);

    const wanted = [
      "expense.added",
      "subscription.created",
      "subscription.updated",
      "subscription.cancelled",
      "subscription.deleted",
      "account.created",
    ];
    const keep = new Set(wanted);

    const counts: Record<string, number> = {};
    for (const row of rows) {
      if (!keep.has(row.kind)) continue;
      counts[row.kind] = (counts[row.kind] ?? 0) + 1;
    }

    return { counts, read: rows.length, kinds: wanted };
  },
});

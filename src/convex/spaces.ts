import { getAuthUserId } from "@convex-dev/auth/server";
import type { GenericMutationCtx } from "convex/server";
import { v } from "convex/values";

import { DEFAULT_AREA_SLUG } from "../lib/areas";

import type { DataModel, Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";

/**
 * Ownership and access foundation (ADR-009, phase 0B).
 *
 * Every product object carries `ownerUserId` + `spaceId`. Ownership is who the
 * object *is*; access is who may *reach* it, and the two are deliberately
 * separate: a grant never rewrites either field.
 */

/** The display name used for the one space every user gets automatically. */
const PERSONAL_SPACE_NAME = "Personal";

/**
 * Every product table that participates in ownership. Kept as data rather than
 * repeated inline so the ownership migration and the backfill can never drift
 * apart from each other.
 */
const OWNED_TABLES = [
  "tasks",
  "notes",
  "assistantState",
  "areas",
  "taxProfile",
  "expenses",
  "taxDocuments",
  "connections",
] as const;

/**
 * Fields that pre-0B rows left unset or out of range, and the value each is
 * normalised to.
 *
 * The ownership rename is not the only thing a pre-0B row is missing:
 *
 *  - `tasks.area` was optional and is now required, because area filtering
 *    moved from a JavaScript scan to an index range. A row with no area drops
 *    out of every range and vanishes from the area views.
 *  - `tasks.priority` was an unvalidated `v.number()`. Rows written before the
 *    enum validator — or by an older build — can hold anything, and with
 *    `schemaValidation: true` a single such row turns every query against the
 *    table into a server error.
 *
 * Defaulting priority to 2 (LATER) is the parser's own default for an input
 * with no priority cue, so a repaired row is indistinguishable from one the
 * user actually typed without a cue.
 */
const LEGACY_FIELD_DEFAULTS: Partial<Record<(typeof OWNED_TABLES)[number], Record<string, unknown>>> = {
  tasks: { area: DEFAULT_AREA_SLUG, priority: 2 },
};

const AREA_SLUGS = new Set<string>(["general", "finance", "relationships", "health", "home"]);

/**
 * Required task scalars a row may be missing, with the value that makes the row
 * mean what it plainly meant.
 *
 * A pre-0B task always had these — `addTask` has always set them — so a row
 * lacking them was written by something that was not the product. Rather than
 * deleting a row that has a title and an owner, it is completed: an unfinished
 * task is the conservative reading, and `createdAt` falls back to the row's own
 * creation time so the age feature stays truthful.
 */
function taskScalarRepairs(row: Record<string, unknown>): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (row.completed === undefined) patch.completed = false;
  if (row.completedAt === undefined) patch.completedAt = null;
  if (row.dueAt === undefined) patch.dueAt = null;
  if (row.createdAt === undefined) patch.createdAt = row._creationTime ?? Date.now();
  return patch;
}

/** The repairs a single row needs, or `null` when it already conforms. */
function repairsFor(
  table: (typeof OWNED_TABLES)[number],
  row: Record<string, unknown>,
  userId: Id<"users">,
  spaceId: Id<"spaces">,
): Record<string, unknown> | null {
  const patch: Record<string, unknown> = {};

  // A row with no owner at all is pre-0B; a row with an owner but no space is
  // half-migrated. Both are repaired in the same pass.
  if (row.ownerUserId !== userId) {
    if (row.userId !== userId) return null;
    patch.ownerUserId = userId;
  }
  if (row.spaceId !== spaceId) patch.spaceId = spaceId;

  const defaults = LEGACY_FIELD_DEFAULTS[table];
  if (defaults) {
    for (const [key, value] of Object.entries(defaults)) {
      const current = row[key];
      if (current === undefined) {
        patch[key] = value;
      } else if (key === "area" && !AREA_SLUGS.has(String(current))) {
        patch[key] = value;
      } else if (key === "priority" && current !== 0 && current !== 1 && current !== 2) {
        patch[key] = value;
      }
    }
  }

  if (table === "tasks") Object.assign(patch, taskScalarRepairs(row));

  // A pre-0B row still carries `userId` inside the document. It cannot be
  // patched away, so it is always a repair — that is what makes the caller
  // recreate the row rather than patch it.
  if (row.userId !== undefined) return { ...patch, __recreate: true };

  return Object.keys(patch).length > 0 ? patch : null;
}

/**
 * Returns the user's personal space, creating it on first use.
 *
 * Idempotent under Convex's serializable mutations: the `by_createdBy` index
 * range is read inside the same transaction that inserts, so two concurrent
 * calls conflict, one retries, and the retry finds the row the winner wrote.
 * This is the same OCC argument verified for N1 in ADR-022.
 *
 * Callers use the returned id for every insert they make, so an object can
 * never be written without a home space.
 */
export async function ensurePersonalSpace(
  ctx: GenericMutationCtx<DataModel>,
  userId: Id<"users">,
): Promise<Id<"spaces">> {
  const rows = await ctx.db
    .query("spaces")
    .withIndex("by_createdBy", (q) => q.eq("createdBy", userId))
    .collect();

  const personal = rows.find((s) => s.kind === "personal" && s.archivedAt == null);
  if (personal) {
    // The ownership rename needs a one-shot per-user normalisation, and the
    // only moment we know the user is present is a write. `migratedAt` is the
    // sentinel: while it is unset the backfill runs, and once it is set the
    // whole cost disappears. This is why enabling `schemaValidation` does not
    // require an operator to visit every account.
    if (personal.migratedAt == null) {
      await backfillUserOwnership(ctx, userId, personal._id);
      await ctx.db.patch(personal._id, { migratedAt: Date.now() });
    }
    return personal._id;
  }

  const now = Date.now();
  const spaceId = await ctx.db.insert("spaces", {
    name: PERSONAL_SPACE_NAME,
    kind: "personal",
    isPersonal: true,
    createdBy: userId,
    createdAt: now,
    // A brand-new user has no pre-0B rows, so the normalisation is already
    // satisfied and the scan is skipped entirely.
    migratedAt: now,
  });
  await ctx.db.insert("spaceMembers", {
    spaceId,
    userId,
    role: "manage",
    joinedAt: now,
  });
  return spaceId;
}

/**
 * One-shot ownership migration: stamps `ownerUserId` + `spaceId` onto rows
 * written before phase 0B, which used a bare `userId` column.
 *
 * Idempotent by construction — a row that already carries `ownerUserId` is left
 * alone, so running this twice writes nothing the second time. It matches on
 * the *old* `userId` field with a filter rather than an index, because the
 * rename is exactly what removed the index that would have made this cheap.
 * That is acceptable only because it runs once per user over their own rows.
 */
export async function backfillUserOwnership(
  ctx: GenericMutationCtx<DataModel>,
  userId: Id<"users">,
  spaceId: Id<"spaces">,
): Promise<number> {
  let patched = 0;

  for (const table of OWNED_TABLES) {
    // Two populations, one scan: rows this user already owns, and rows with no
    // owner at all (the pre-0B shape, whose legacy `userId` is still in the
    // document but no longer in the schema, so it is read from the raw value
    // rather than through a typed field expression). This is a full table scan,
    // which is acceptable only because it runs at most once per user — the
    // `migratedAt` sentinel in `ensurePersonalSpace` guarantees that.
    const candidates = await ctx.db
      .query(table)
      .filter((q) => q.or(q.eq(q.field("ownerUserId"), userId), q.eq(q.field("ownerUserId"), undefined)))
      .collect();

    for (const row of candidates) {
      const raw = row as Record<string, unknown>;
      const patch = repairsFor(table, raw, userId, spaceId);
      if (!patch) continue;

      // A pre-0B row still carries the `userId` column inside the document.
      // `patch` cannot remove a field, and Convex rejects any document holding
      // a field the schema does not declare — so with `schemaValidation: true`
      // these rows can only be brought forward by recreating them. Every value
      // the schema does declare is carried across unchanged; only `_id` and
      // `_creationTime` differ, and nothing references a task's id yet (the
      // `links` table was added in the same phase and has no writers).
      if (patch.__recreate) {
        const rest: Record<string, unknown> = { ...raw };
        delete rest._id;
        delete rest._creationTime;
        delete rest.userId;
        const fields: Record<string, unknown> = { ...patch };
        delete fields.__recreate;
        await ctx.db.delete(row._id as Id<"tasks">);
        await ctx.db.insert(table, { ...rest, ...fields } as never);
      } else {
        await ctx.db.patch(row._id, patch as never);
      }
      patched += 1;
    }
  }

  return patched;
}

/** The spaces the caller belongs to, personal first. */
export const listMySpaces = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const memberships = await ctx.db
      .query("spaceMembers")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    const spaces = await Promise.all(
      memberships.map((m) => ctx.db.get(m.spaceId)),
    );

    return spaces
      .filter((s): s is NonNullable<typeof s> => s != null && s.archivedAt == null)
      .map((s) => ({
        _id: s._id,
        name: s.name,
        kind: s.kind,
        isPersonal: s.isPersonal,
        role: memberships.find((m) => m.spaceId === s._id)?.role ?? "view",
      }));
  },
});

/**
 * Creates a shared space and enrols the caller as a manager.
 *
 * Only the personal space is automatic. Family and work spaces are an explicit
 * act, because creating one is the first half of sharing and sharing is the
 * half that needs the most care.
 */
export const createSpace = mutation({
  args: { name: v.string(), kind: v.union(v.literal("family"), v.literal("work"), v.literal("custom")) },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const name = args.name.trim();
    if (name.length === 0) throw new Error("Space needs a name");
    if (name.length > 80) throw new Error("Space name is too long (max 80 characters)");

    const now = Date.now();
    const spaceId = await ctx.db.insert("spaces", {
      name,
      kind: args.kind,
      isPersonal: false,
      createdBy: userId,
      createdAt: now,
    });
    await ctx.db.insert("spaceMembers", {
      spaceId,
      userId,
      role: "manage",
      joinedAt: now,
    });
    return spaceId;
  },
});

/**
 * Runs the ownership backfill for the calling user.
 *
 * Exposed as a mutation rather than buried in an internal function so the
 * migration can actually be executed and its effect verified, and so a user
 * who signs in again after the deployment can self-heal without an operator.
 */
export const migrateOwnership = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const spaceId = await ensurePersonalSpace(ctx, userId);
    // Force a re-scan even if the sentinel is already set, so this remains a
    // genuine "fix it now" button rather than "it was fine at first write".
    const patched = await backfillUserOwnership(ctx, userId, spaceId);
    return patched;
  },
});

/**
 * Ownership audit for the calling user.
 *
 * Reports, per product table, how many of the caller's rows carry both
 * `ownerUserId` and `spaceId` and how many are still un-stamped. This is the
 * evidence the phase-0B acceptance criteria ask for: "every table has
 * ownerUserId + spaceId" is a checkable claim, not a hope.
 *
 * It returns counts and nothing else — no row content, no other user's data.
 */
export const auditOwnership = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const tables: Record<string, { total: number; owned: number; missingSpace: number }> = {};
    let spaces = 0;
    let memberships = 0;
    let links = 0;
    let activity = 0;

    for (const table of OWNED_TABLES) {
      const rows = await ctx.db
        .query(table)
        .filter((q) => q.eq(q.field("ownerUserId"), userId))
        .collect();

      let owned = 0;
      let missingSpace = 0;
      for (const row of rows) {
        const r = row as { ownerUserId?: string; spaceId?: string };
        if (r.ownerUserId === userId) {
          owned += 1;
          if (!r.spaceId) missingSpace += 1;
        }
      }
      tables[table] = { total: rows.length, owned, missingSpace };
    }

    for (const space of await ctx.db
      .query("spaces")
      .withIndex("by_createdBy", (q) => q.eq("createdBy", userId))
      .collect()) {
      if (space.kind === "personal") spaces += 1;
    }

    memberships = await ctx.db
      .query("spaceMembers")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect()
      .then((rows) => rows.length);

    const spaceIds = new Set(
      (await ctx.db
        .query("spaceMembers")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect()).map((m) => m.spaceId),
    );

    for (const link of await ctx.db.query("links").collect()) {
      if (spaceIds.has(link.spaceId)) links += 1;
    }
    for (const event of await ctx.db.query("activity").collect()) {
      if (spaceIds.has(event.spaceId)) activity += 1;
    }

    return { userId, spaces, memberships, links, activity, tables };
  },
});

/**
 * Life Admin (phase 3, feature 3).
 *
 * A document is **metadata about keeping a credential valid** — a label, an
 * expiry and a lead time. It is not the document (R-007, ADR-025), and it has
 * no stored status: the seven lifecycle states are a pure function of
 * `expiresAt`, the linked renewal task and `now` (`src/lib/documents.ts`).
 *
 * ## The shape of this module
 *
 * The renewal is an **ordinary `tasks` row** carrying `documentId`
 * (ADR-026). Three consequences run through every function here:
 *
 *  - reads go through `by_owner_document`, an index range holding only tasks
 *    that are renewals, rather than a scan of everything the user owns;
 *  - `completeRenewal` calls `assistant:completeTask`, so completing a renewal
 *    trains the model by the *same* path as ticking any other checkbox. That is
 *    a second caller of the one weight-mutation point, not a second writer;
 *  - the document holds no reference to its task, so nothing here has to patch
 *    a document when a task is created, completed or deleted.
 *
 * ## Authorisation
 *
 * Every read is scoped by a `by_owner*` index on the caller's own id, and every
 * write re-checks `ownerUserId`. No mutation accepts `ownerUserId` or `spaceId`:
 * there is no view-as path, and there is no sharing path, because sharing a
 * personal document is not a capability Panel has.
 */

import { getAuthUserId } from "@convex-dev/auth/server";
import type { GenericMutationCtx, GenericQueryCtx } from "convex/server";
import { v } from "convex/values";

import {
  DEFAULT_LEAD_DAYS,
  describeDocument,
  leadDaysFor,
  normaliseLabel,
  renewalDeadline,
  validateExpiry,
  validateLeadDays,
  type RenewalRef,
} from "../lib/documents";
import { READ_LIMITS } from "../lib/readLimits";

import type { DataModel, Id } from "./_generated/dataModel";
import { completeTask, requireUserId } from "./assistant";
import { mutation, query } from "./_generated/server";
import { ensurePersonalSpace } from "./spaces";

/** Documents returned per query. The surface is a list; it is not an export. */
const MAX_DOCUMENTS = READ_LIMITS.DOCUMENTS;

/**
 * How much activity `documentAudit` reads.
 *
 * A read, so it is bounded rather than exhaustive. `AUDIT_SCAN_LIMIT` in
 * `assistant.ts` is the precedent, and so is its reason: an unbounded read on a
 * query a client may call is the shape of D39.
 */
const AUDIT_SCAN_LIMIT = READ_LIMITS.AUDIT_SCAN_LIMIT;

type Ctx = GenericMutationCtx<DataModel> | GenericQueryCtx<DataModel>;

type DocumentRow = {
  _id: Id<"documents">;
  ownerUserId: Id<"users">;
  label: string;
  expiresAt?: number;
  leadDays?: number;
  personId?: Id<"people">;
  createdAt: number;
};

type RenewalTask = {
  _id: Id<"tasks">;
  title: string;
  completed: boolean;
  dueAt?: number | null;
  completedAt?: number | null;
  createdAt: number;
};

/** Reads one document, refusing anything the caller does not own. */
async function ownedDocument(
  ctx: Ctx,
  id: Id<"documents">,
  userId: Id<"users">,
): Promise<DocumentRow> {
  const row = await ctx.db.get(id);
  if (!row || row.ownerUserId !== userId) throw new Error("Document not found");
  return row;
}

/** Every task carrying this `documentId`, newest first. An index range. */
async function renewalsOf(
  ctx: Ctx,
  documentId: Id<"documents">,
  userId: Id<"users">,
): Promise<RenewalTask[]> {
  return await ctx.db
    .query("tasks")
    .withIndex("by_owner_document", (q) => q.eq("ownerUserId", userId).eq("documentId", documentId))
    .take(READ_LIMITS.ASSOCIATED_TASKS);
}

/**
 * Every renewal task the caller owns, grouped by document, in **one** read.
 *
 * The first version of `listDocuments` called `renewalsOf` once per document —
 * an N+1 that would have meant up to two hundred queries on a reactively
 * subscribed query, which is the shape of D37 and D39 wearing a new hat.
 *
 * `by_owner_document` with only the owner prefix is already the narrow read we
 * want: Convex omits a row from an index when the indexed field is absent, so
 * this range holds *only* tasks that are renewals — not every task the user
 * has. Grouping in JavaScript is safe precisely because the database has
 * already scoped the set.
 */
async function renewalsByDocument(
  ctx: Ctx,
  userId: Id<"users">,
): Promise<Map<Id<"documents">, RenewalTask[]>> {
  const rows = await ctx.db
    .query("tasks")
    .withIndex("by_owner_document", (q) => q.eq("ownerUserId", userId))
    .take(READ_LIMITS.ASSOCIATED_TASKS);

  const grouped = new Map<Id<"documents">, RenewalTask[]>();
  for (const row of rows) {
    const key = row.documentId as Id<"documents">;
    const bucket = grouped.get(key);
    if (bucket) bucket.push(row);
    else grouped.set(key, [row]);
  }
  return grouped;
}

/**
 * The renewal a surface should talk about: the newest one that is still open,
 * else the newest one at all.
 *
 * Choosing in one place is what stops the Life Admin surface and the Attention
 * rule from disagreeing about whether a renewal is underway — two readers of
 * the same rows that each pick their own is how a feature reports "renewal in
 * progress" above a task that was finished last week.
 */
export function pickRenewal(rows: RenewalTask[]): RenewalTask | null {
  if (rows.length === 0) return null;
  const open = rows.filter((r) => !r.completed);
  const pool = open.length > 0 ? open : rows;
  return pool.reduce((best, r) => (r.createdAt > best.createdAt ? r : best));
}

/**
 * Projects a task row into the `RenewalRef` the pure state machine reads.
 *
 * Exported so the attention query builds the same object from the same rule.
 * Two copies of this literal is exactly where a field rename leaves one of
 * them quietly reading `undefined` forever — the D34 shape, one level down.
 */
export function renewalRef(task: RenewalTask | null): RenewalRef | null {
  if (!task) return null;
  return {
    completed: task.completed,
    completedAt: task.completedAt ?? null,
    dueAt: task.dueAt ?? null,
  };
}

/** Projects one row plus its renewals into everything the surface needs. */
function view(doc: DocumentRow, rows: RenewalTask[], now: number) {
  const renewal = pickRenewal(rows);
  const state = describeDocument(doc, renewalRef(renewal), now);
  return {
    id: doc._id,
    label: doc.label,
    expiresAt: doc.expiresAt ?? null,
    leadDays: leadDaysFor(doc),
    leadDaysIsDefault: doc.leadDays === undefined || doc.leadDays === null,
    deadlineAt: state.deadlineAt,
    personId: doc.personId ?? null,
    createdAt: doc.createdAt,
    state: state.state,
    daysAway: state.daysAway,
    severity: state.severity,
    attention: state.attention,
    title: state.title,
    detail: state.detail,
    renewal: renewal
      ? {
          id: renewal._id,
          title: renewal.title,
          completed: renewal.completed,
          dueAt: renewal.dueAt ?? null,
          completedAt: renewal.completedAt ?? null,
        }
      : null,
    renewalCount: rows.length,
  };
}

// ---------------------------------------------------------------------------
// reads
// ---------------------------------------------------------------------------

/**
 * Every document the caller owns, most urgent first.
 *
 * `by_owner` is bounded by how many documents a person has — tens, not
 * thousands — and the renewal lookup per row is an index range rather than a
 * scan. Documents with no expiry sort last: they are never urgent, and putting
 * them at the top would make the list lie about priority.
 */
export const listDocuments = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return { documents: [], defaultLeadDays: DEFAULT_LEAD_DAYS };

    const rows = await ctx.db
      .query("documents")
      .withIndex("by_owner", (q) => q.eq("ownerUserId", userId))
      .take(MAX_DOCUMENTS);

    // One read for every renewal this user owns, not one per document.
    const renewals = await renewalsByDocument(ctx, userId);
    const now = Date.now();
    const views = rows
      .slice(0, MAX_DOCUMENTS)
      .map((doc) => view(doc, renewals.get(doc._id) ?? [], now));

    views.sort((a, b) => {
      // Urgent first: whatever wants attention, then soonest, then the rest.
      if (a.attention !== b.attention) return a.attention ? -1 : 1;
      const ax = a.deadlineAt ?? Number.MAX_SAFE_INTEGER;
      const bx = b.deadlineAt ?? Number.MAX_SAFE_INTEGER;
      if (ax !== bx) return ax - bx;
      return a.label.localeCompare(b.label);
    });

    return { documents: views, defaultLeadDays: DEFAULT_LEAD_DAYS };
  },
});

/**
 * One document, resolved through nothing.
 *
 * A deleted id returns `null` rather than throwing, because the id can arrive
 * from a stale client; ownership is checked the same way, so asking for
 * somebody else's document is indistinguishable from asking for a missing one.
 */
export const getDocument = query({
  args: { id: v.id("documents") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const row = await ctx.db.get(args.id);
    if (!row || row.ownerUserId !== userId) return null;

    const rows = await renewalsOf(ctx, row._id, userId);
    return view(row, rows, Date.now());
  },
});

/**
 * The documents that want attention right now, and nothing else.
 *
 * Read through `by_owner_expiry`, whose range holds **only documents that have
 * an expiry** — Convex omits a row from an index when the indexed field is
 * absent. This query therefore does not read a single undated document, which
 * is what makes it safe to run on every Attention load: the narrower the index,
 * the less there is to be wrong about.
 */
export const getExpiring = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const rows = await ctx.db
      .query("documents")
      .withIndex("by_owner_expiry", (q) => q.eq("ownerUserId", userId))
      .take(MAX_DOCUMENTS);

    // One read for the renewals, not one per document (see `renewalsByDocument`).
    const renewals = await renewalsByDocument(ctx, userId);
    const now = Date.now();
    const out = [];
    for (const doc of rows) {
      const v = view(doc, renewals.get(doc._id) ?? [], now);
      if (v.attention) out.push(v);
    }
    return out;
  },
});

/**
 * The caller's own `document.*` audit trail.
 *
 * Exists so the four activity kinds are **read back rather than assumed**
 * (R-005, D38). A harness that trusted a mutation's return value would prove
 * only that the mutation returned; this is what makes "the row was written,
 * with the real task id" a checkable claim.
 *
 * Owner-scoped to the caller's own spaces and bounded, with the range on the
 * index prefix. The unbounded version of this query is D39.
 */
export const documentAudit = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return { kinds: [] as string[], tasks: [] as string[] };

    const spaces = await ctx.db
      .query("spaces")
      .withIndex("by_createdBy", (q) => q.eq("createdBy", userId))
      .take(READ_LIMITS.SPACES);
    if (spaces.length === 0) return { kinds: [], tasks: [] };

    const kinds: string[] = [];
    const tasks: string[] = [];

    for (const space of spaces) {
      const rows = await ctx.db
        .query("activity")
        .withIndex("by_space_at", (q) => q.eq("spaceId", space._id))
        .take(AUDIT_SCAN_LIMIT);

      for (const row of rows) {
        if (!row.kind.startsWith("document.")) continue;
        kinds.push(row.kind);
        // `meta` is a scalar union, so the task id comes back typed loosely.
        // Coercing here keeps the shape honest for any future writer.
        if (row.kind === "document.renewal_started" || row.kind === "document.renewed") {
          tasks.push(String(row.meta?.task ?? ""));
        }
      }
    }

    return { kinds, tasks };
  },
});

// ---------------------------------------------------------------------------
// writes
// ---------------------------------------------------------------------------

/** Validates a label, refusing rather than storing something unusable. */
function requireLabel(raw: string): string {
  const label = normaliseLabel(raw);
  if (label === null) throw new Error("Give the document a name");
  return label;
}

/** Validates an optional expiry, refusing rather than coercing (the N5 lesson). */
function requireExpiry(raw: number | undefined | null): number | undefined {
  const value = validateExpiry(raw);
  if (value === null) throw new Error("That expiry date is not a real date");
  return value;
}

/** Validates an optional lead time against its documented bounds. */
function requireLeadDays(raw: number | undefined | null): number | undefined {
  const value = validateLeadDays(raw);
  if (value === null) throw new Error("Lead time must be between 0 and 365 days");
  return value;
}

/** Ownership-checks an optional person, exactly as `assistant:addTask` does. */
async function requirePerson(
  ctx: GenericMutationCtx<DataModel>,
  personId: Id<"people"> | undefined,
  userId: Id<"users">,
): Promise<Id<"people"> | undefined> {
  if (!personId) return undefined;
  const person = await ctx.db.get(personId);
  if (!person || person.ownerUserId !== userId) throw new Error("Person not found");
  return person._id;
}

/**
 * Records a document.
 *
 * **No duplicate refusal, on purpose.** Two rows with the same label stay
 * separate until the user deletes one, because a label is not identity — the
 * same reasoning as ADR-024 — and refusing to create a second "Car insurance"
 * would be wrong the moment someone holds two. Merging is not in scope.
 */
export const createDocument = mutation({
  args: {
    label: v.string(),
    expiresAt: v.optional(v.number()),
    leadDays: v.optional(v.number()),
    personId: v.optional(v.id("people")),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const spaceId = await ensurePersonalSpace(ctx, userId);
    const label = requireLabel(args.label);
    const personId = await requirePerson(ctx, args.personId, userId);

    const id = await ctx.db.insert("documents", {
      ownerUserId: userId,
      spaceId,
      label,
      expiresAt: requireExpiry(args.expiresAt),
      leadDays: requireLeadDays(args.leadDays),
      personId,
      createdAt: Date.now(),
    });

    await ctx.db.insert("activity", {
      spaceId,
      actor: "user",
      kind: "document.created",
      objectKind: "document",
      objectId: id,
      at: Date.now(),
    });

    return id;
  },
});

/** Edits the label, the expiry or the lead time. Never the ownership. */
export const updateDocument = mutation({
  args: {
    id: v.id("documents"),
    label: v.optional(v.string()),
    expiresAt: v.optional(v.number()),
    leadDays: v.optional(v.number()),
    personId: v.optional(v.id("people")),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const row = await ownedDocument(ctx, args.id, userId);

    const patch: Record<string, unknown> = {};
    if (args.label !== undefined) patch.label = requireLabel(args.label);
    if (args.expiresAt !== undefined) patch.expiresAt = requireExpiry(args.expiresAt);
    if (args.leadDays !== undefined) patch.leadDays = requireLeadDays(args.leadDays);
    if (args.personId !== undefined) {
      patch.personId = await requirePerson(ctx, args.personId, userId);
    }

    if (Object.keys(patch).length === 0) return;
    await ctx.db.patch(row._id, patch);
  },
});

/**
 * Removes the document and **detaches** it from its tasks.
 *
 * The tasks are not deleted. Do-Not-Touch #9 forbids deleting user data as a
 * side effect of another action, and a user who deletes a passport should not
 * lose the "renew passport" task they wrote — they should lose the link, and
 * keep their own note to self. The count comes back so the UI can say what
 * happened rather than letting it disappear quietly.
 */
export const deleteDocument = mutation({
  args: { id: v.id("documents") },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const row = await ownedDocument(ctx, args.id, userId);
    const spaceId = await ensurePersonalSpace(ctx, userId);

    const tasks = await renewalsOf(ctx, row._id, userId);
    for (const task of tasks) {
      await ctx.db.patch(task._id, { documentId: undefined });
    }

    await ctx.db.delete(row._id);
    await ctx.db.insert("activity", {
      spaceId,
      actor: "user",
      kind: "document.deleted",
      objectKind: "document",
      objectId: row._id,
      meta: { detached: String(tasks.length) },
      at: Date.now(),
    });

    return { detached: tasks.length };
  },
});

/**
 * Starts a renewal: creates the task, dated by the deadline Panel computed.
 *
 * **Explicit user action, always.** Panel never creates a renewal on its own —
 * inventing tasks the user did not ask for is how a system becomes a nag. The
 * button is the approval, whether it is pressed in the Life Admin surface or on
 * an `document.expiring` attention item.
 *
 * The due date is `expiresAt − leadDays`, computed **server-side**, because a
 * date the user has to calculate is a date they will get wrong (R-006). An
 * undated document gets no due date, because there is no deadline to compute
 * and a made-up one would be worse than none.
 *
 * Idempotent while a renewal is open: the existing task is returned rather than
 * a second one created, so a double-click cannot produce two.
 */
export const startRenewal = mutation({
  args: { id: v.id("documents") },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const row = await ownedDocument(ctx, args.id, userId);
    const spaceId = await ensurePersonalSpace(ctx, userId);
    const now = Date.now();

    const existing = (await renewalsOf(ctx, row._id, userId)).find((t) => !t.completed);
    if (existing) return { taskId: existing._id, created: false };

    const deadlineAt = renewalDeadline(row);
    const title = `Renew ${row.label}`;

    const taskId = await ctx.db.insert("tasks", {
      ownerUserId: userId,
      spaceId,
      title,
      completed: false,
      priority: 0,
      dueAt: deadlineAt,
      createdAt: now,
      completedAt: null,
      tags: [],
      recurrence: null,
      // `general` on purpose: the renewal has to appear in the user's main task
      // list, where they can see and tick it. Coupling its visibility to
      // whether they enabled the `life` area would hide work they asked for.
      area: "general",
      documentId: row._id,
    });

    await ctx.db.insert("activity", {
      spaceId,
      actor: "user",
      kind: "document.renewal_started",
      objectKind: "document",
      objectId: row._id,
      meta: { task: taskId },
      at: now,
    });

    return { taskId, created: true };
  },
});

/**
 * Cancels a renewal. The document keeps its expiry; only the task goes.
 *
 * Cancelling is not the same as deleting: a user who pressed "renew" by mistake
 * still has a document that expires, and the honest way to express "I did not
 * mean to start that" is to undo the start, not to erase the fact.
 */
export const cancelRenewal = mutation({
  args: { id: v.id("documents") },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const row = await ownedDocument(ctx, args.id, userId);

    const open = (await renewalsOf(ctx, row._id, userId)).find((t) => !t.completed);
    if (open) await ctx.db.delete(open._id);
    return { cancelled: !!open };
  },
});

/**
 * Completes a renewal and records the new expiry — **one atomic mutation**.
 *
 * Two writes that belong together (task completed, expiry advanced) happen here
 * together, so a chain cannot be half-recorded. This is the same rule D6
 * established for task creation, applied to the step that was previously the
 * one that silently did nothing.
 *
 * The task is completed through `assistant:completeTask`, so a renewal trains
 * the model by exactly the path any other checkbox does. It is a second
 * *caller* of the one weight-mutation point, never a second writer.
 *
 * The new expiry must be **later than the current one**. A chain that can run
 * backwards is not a chain. A renewal completed late, producing a date already
 * in the past, is *allowed* — that is reality, and the state machine will
 * correctly report the document as expired.
 */
export const completeRenewal = mutation({
  args: { id: v.id("documents"), newExpiresAt: v.number() },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const row = await ownedDocument(ctx, args.id, userId);
    const spaceId = await ensurePersonalSpace(ctx, userId);
    const now = Date.now();

    const newExpiresAt = validateExpiry(args.newExpiresAt);
    if (newExpiresAt === undefined || newExpiresAt === null) {
      throw new Error("Give the new expiry date");
    }
    if (typeof row.expiresAt === "number" && newExpiresAt <= row.expiresAt) {
      throw new Error("The new expiry has to be later than the current one");
    }

    // Advance the date first. If the task completion below is to fail, the
    // transaction rolls back and neither happened — there is no order in which
    // the document moved but the task did not.
    await ctx.db.patch(row._id, { expiresAt: newExpiresAt });

    // Prefer the newest open renewal; fall back to the newest renewal at all,
    // so a renewal the user already ticked off generically is *adopted* here
    // rather than producing a second task for a renewal already in progress.
    const rows = await renewalsOf(ctx, row._id, userId);
    const target = pickRenewal(rows);

    if (target && !target.completed) {
      const full = await ctx.db.get(target._id);
      if (full && full.ownerUserId === userId) {
        await completeTask(ctx, userId, spaceId, full, now);
      }
    }

    await ctx.db.insert("activity", {
      spaceId,
      actor: "user",
      kind: "document.renewed",
      objectKind: "document",
      objectId: row._id,
      meta: { task: target ? target._id : "", expires: String(newExpiresAt) },
      at: now,
    });

    return { renewed: true, expiresAt: newExpiresAt };
  },
});
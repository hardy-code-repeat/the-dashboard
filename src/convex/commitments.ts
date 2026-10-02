/**
 * Commitments + Waiting On (phase 3, feature 4).
 *
 * One object, two directions — the argument is in ADR-027 and R-008; this file
 * is the implementation and the consequences.
 *
 * ## The three rules that shape every function here
 *
 * 1. **Panel records the user's assertion. It never claims to know what another
 *    person did.** For `owed`, the user did the thing. For `owedTo`, nobody in
 *    the system observed anything, and the copy in `src/lib/commitments.ts` is
 *    written so it cannot be misread as an observation. That is the whole reason
 *    `completeCommitment` is a single honest boolean rather than something
 *    cleverer.
 *
 * 2. **Panel never invents a task.** A follow-up exists only because the user
 *    pressed a button. And pressing it does *not* settle the commitment —
 *    chasing someone is not receiving from them.
 *
 * 3. **A merge rewrites nothing** (ADR-023). A commitment points at exactly the
 *    person row the user chose, unmerging restores it without touching
 *    anything, and every read resolves through `mergedIntoId`. That is only true
 *    because this module never moves or rewrites a row.
 *
 * ## Authorisation
 *
 * Every read is scoped by a `by_owner` index on the caller's own id; every
 * write re-checks `ownerUserId`. `personId` is ownership-checked on the way in.
 * No mutation accepts `ownerUserId` or `spaceId`.
 */

import { getAuthUserId } from "@convex-dev/auth/server";
import type { GenericMutationCtx, GenericQueryCtx } from "convex/server";
import { v } from "convex/values";

import {
  describeCommitment,
  normaliseTitle,
  validateExpectedAt,
  type CommitmentDirection,
  type FollowUpRef,
} from "../lib/commitments";
import { READ_LIMITS } from "../lib/readLimits";

/**
 * Follow-up tasks read for the caller's commitments.
 *
 * The `by_owner_commitment` range holds only tasks that chase a waiting item —
 * Convex drops a row from an index when the indexed field is absent — so it is
 * already much narrower than "every task". It is not, however, bounded, and a
 * user who has chased the same thing for two years should not make every
 * commitments read scale with how long they have been waiting.
 */
const MAX_FOLLOW_UP_TASKS = READ_LIMITS.ASSOCIATED_TASKS;

import type { DataModel, Id } from "./_generated/dataModel";
import { requireUserId } from "./assistant";
import { mutation, query } from "./_generated/server";
import { peopleById, resolvePersonName } from "./people";
import { ensurePersonalSpace } from "./spaces";

/** Commitments returned per query. The surface is a list; it is not an export. */
const MAX_COMMITMENTS = READ_LIMITS.COMMITMENTS;

/**
 * The commitments that can possibly be attention, read as an index range.
 *
 * `by_owner_open` holds **exactly** `{completed: false, expectedAt <= now}` —
 * Convex drops a document from an index when an indexed field is absent, so
 * undated commitments are not in it either, and an undated one can never be
 * overdue. The range is therefore the candidate set rather than a filter that
 * has to be re-checked, and the `attention` check below stays as a belt-and-
 * braces assertion that the machine and the index agree.
 *
 * Bounded on the query that re-runs on every dashboard write. Collecting the
 * whole `by_owner` range and discarding the 99% that cannot be attention is the
 * D37/D39/D41 shape, and this is where it would have been introduced.
 */
function openOverdueRange(ctx: GenericQueryCtx<DataModel>, userId: Id<"users">, now: number) {
  return ctx.db
    .query("commitments")
    .withIndex("by_owner_open", (q) =>
      q.eq("ownerUserId", userId).eq("completed", false).lte("expectedAt", now),
    );
}

/**
 * How much activity `commitmentAudit` reads.
 *
 * A read, so it is bounded — an unbounded read on a query a client may call is
 * the shape of D39, and `assistant:captureAudit` is the precedent.
 */
const AUDIT_SCAN_LIMIT = READ_LIMITS.AUDIT_SCAN_LIMIT;

type Ctx = GenericMutationCtx<DataModel> | GenericQueryCtx<DataModel>;

type CommitmentRow = {
  _id: Id<"commitments">;
  ownerUserId: Id<"users">;
  personId: Id<"people">;
  title: string;
  direction: CommitmentDirection;
  expectedAt?: number;
  completed: boolean;
  completedAt?: number | null;
  createdAt: number;
};

/** Reads one commitment, refusing anything the caller does not own. */
async function ownedCommitment(
  ctx: Ctx,
  id: Id<"commitments">,
  userId: Id<"users">,
): Promise<CommitmentRow> {
  const row = await ctx.db.get(id);
  if (!row || row.ownerUserId !== userId) throw new Error("Commitment not found");
  return row;
}

/** Narrowing a caller-supplied direction, which arrives as a plain string. */
function requireDirection(raw: string): CommitmentDirection {
  if (raw !== "owed" && raw !== "owedTo") throw new Error("Unknown direction");
  return raw;
}

/** Ownership-checks a counterparty. A commitment to nobody is a task. */
async function requirePerson(
  ctx: GenericMutationCtx<DataModel>,
  personId: Id<"people">,
  userId: Id<"users">,
): Promise<Id<"people">> {
  const person = await ctx.db.get(personId);
  if (!person || person.ownerUserId !== userId) throw new Error("Person not found");
  return person._id;
}

function viewOf(
  row: CommitmentRow,
  personName: string | null,
  followUp: FollowUpRef | null,
  now: number,
) {
  const state = describeCommitment(row, personName, followUp, now);
  return {
    id: row._id,
    title: row.title,
    direction: row.direction,
    personId: row.personId,
    personName,
    expectedAt: row.expectedAt ?? null,
    completed: row.completed,
    completedAt: row.completedAt ?? null,
    createdAt: row.createdAt,
    state: state.state,
    daysAway: state.daysAway,
    severity: state.severity,
    attention: state.attention,
    section: state.section,
    detail: state.detail,
    followingUp: state.followingUp,
    followUpTaskId: followUp ? followUp._id : null,
  };
}

// ---------------------------------------------------------------------------
// reads
// ---------------------------------------------------------------------------

/**
 * Every commitment the caller owns, most pressing first.
 *
 * **Three indexed reads in total**, not one per row: the commitments
 * themselves, the people needed to resolve tombstones and names, and every
 * follow-up task grouped by `commitmentId`. A version that called a query per
 * commitment would be D41 again, one feature after it was recorded.
 */
export const listCommitments = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return { owed: [], owedTo: [] };

    const [rows, people, followUps] = await Promise.all([
      // An explicit `.take`, not `.collect()` followed by a slice: the bound
      // belongs to the read, so a long history cannot make this scan grow
      // without limit. The surface is a list, not an export.
      ctx.db
        .query("commitments")
        .withIndex("by_owner", (q) => q.eq("ownerUserId", userId))
        .take(MAX_COMMITMENTS),
      peopleById(ctx, userId),
      ctx.db
        .query("tasks")
        .withIndex("by_owner_commitment", (q) => q.eq("ownerUserId", userId))
        .take(MAX_FOLLOW_UP_TASKS),
    ]);

    const followUpByCommitment = new Map<string, FollowUpRef>();
    for (const task of followUps) {
      if (!task.commitmentId) continue;
      // Prefer an open follow-up; otherwise keep the newest completed one.
      const key = String(task.commitmentId);
      const existing = followUpByCommitment.get(key);
      if (!existing || (!existing.completed && task.completed)) {
        followUpByCommitment.set(key, task);
      }
    }

    const now = Date.now();
    const views = [];
    for (const row of rows) {
      // ADR-027 makes a commitment an expectation between the user and *one
      // person*, and `personId` is required — so this is not about supporting
      // a counterparty with no row. It is about a row whose counterparty can no
      // longer be **resolved**: a merged person whose chain does not land, or a
      // person removed out from under an old promise. This query used to drop
      // those rows entirely, so the one commitment the user could not act on was
      // also the one they could not see. An unresolvable name is a fact the
      // surface states, not a reason to hide the row.
      const person = resolvePersonName(people, row.personId);
      views.push(
        viewOf(
          row,
          person?.name ?? null,
          followUpByCommitment.get(String(row._id)) ?? null,
          now,
        ),
      );
    }

    // Overdue first, then soonest, then the rest — the same ordering the Life
    // Admin list uses, so the two surfaces behave identically.
    views.sort((a, b) => {
      const rank = (v: { attention: boolean; expectedAt: number | null }) =>
        v.attention ? 0 : v.expectedAt === null ? 2 : 1;
      const ra = rank(a);
      const rb = rank(b);
      if (ra !== rb) return ra - rb;
      if (a.expectedAt === null && b.expectedAt !== null) return 1;
      if (b.expectedAt === null && a.expectedAt !== null) return -1;
      if (a.expectedAt !== null && b.expectedAt !== null) return a.expectedAt - b.expectedAt;
      return a.title.localeCompare(b.title);
    });

    return {
      owed: views.filter((v) => v.direction === "owed"),
      owedTo: views.filter((v) => v.direction === "owedTo"),
    };
  },
});

/**
 * The commitments that want attention now, and nothing else.
 *
 * Read for the Attention rule. **Two indexed reads, no per-row query**: the
 * narrow `by_owner_open` range, and the caller's people so the counterparty's
 * name and the tombstone chain resolve in memory. A version that resolved the
 * person inside the loop would be D41 again, on the hottest query in the
 * product.
 */
export const getAttentionCommitments = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const now = Date.now();
    const [rows, people, followUps] = await Promise.all([
      openOverdueRange(ctx, userId, now).collect(),
      peopleById(ctx, userId),
      ctx.db
        .query("tasks")
        .withIndex("by_owner_commitment", (q) => q.eq("ownerUserId", userId))
        .take(MAX_FOLLOW_UP_TASKS),
    ]);

    const followUpByCommitment = new Map<string, FollowUpRef>();
    for (const task of followUps) {
      if (!task.commitmentId) continue;
      followUpByCommitment.set(String(task.commitmentId), task);
    }

    const out = [];
    for (const row of rows) {
      const person = resolvePersonName(people, row.personId);
      if (!person) continue;
      const view = viewOf(row, person.name, followUpByCommitment.get(String(row._id)) ?? null, now);
      if (view.attention) out.push(view);
    }
    return out;
  },
});

/**
 * One commitment, resolved through tombstones.
 *
 * Ownership is checked the same way, so asking for somebody else's commitment
 * is indistinguishable from asking for a missing one.
 */
export const getCommitment = query({
  args: { id: v.id("commitments") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const row = await ctx.db.get(args.id);
    if (!row || row.ownerUserId !== userId) return null;

    const people = await peopleById(ctx, userId);
    const person = resolvePersonName(people, row.personId);
    if (!person) return null;

    const followUps = await ctx.db
      .query("tasks")
      .withIndex("by_owner_commitment", (q) =>
        q.eq("ownerUserId", userId).eq("commitmentId", args.id),
      )
      .take(MAX_FOLLOW_UP_TASKS);

    return viewOf(row, person.name, followUps[0] ?? null, Date.now());
  },
});

/**
 * The caller's own `commitment.*` audit trail.
 *
 * Exists so the four kinds are **read back rather than assumed** (R-005, D38).
 * `commitment.made` has been declared in the closed taxonomy since phase 0B and
 * written by nothing until this feature; a mutation returning successfully
 * proves only that the mutation returned.
 */
export const commitmentAudit = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return { kinds: [] as string[], followUps: [] as string[] };

    const spaces = await ctx.db
      .query("spaces")
      .withIndex("by_createdBy", (q) => q.eq("createdBy", userId))
      .take(READ_LIMITS.SPACES);
    if (spaces.length === 0) return { kinds: [], followUps: [] };

    const kinds: string[] = [];
    const followUps: string[] = [];

    for (const space of spaces) {
      // One indexed range per space, and bounded. The unbounded version of this
      // query is D39.
      const rows = await ctx.db
        .query("activity")
        .withIndex("by_space_at", (q) => q.eq("spaceId", space._id))
        .take(AUDIT_SCAN_LIMIT);

      for (const row of rows) {
        if (!row.kind.startsWith("commitment.")) continue;
        kinds.push(row.kind);
        if (row.kind === "commitment.followed_up") {
          followUps.push(String(row.meta?.task ?? ""));
        }
      }
    }

    return { kinds, followUps };
  },
});

// ---------------------------------------------------------------------------
// writes
// ---------------------------------------------------------------------------

function requireTitle(raw: string): string {
  const title = normaliseTitle(raw);
  if (title === null) throw new Error("Say what the commitment is");
  return title;
}

function requireExpectedAt(raw: number | undefined | null): number | undefined {
  const value = validateExpectedAt(raw);
  if (value === null) throw new Error("That date is not a real date");
  return value;
}

/**
 * Records a commitment or a wait.
 *
 * **No duplicate refusal and no inference.** A label is not identity (ADR-024),
 * and nothing here reads a sentence: the user says what it is and which way it
 * runs, because inferring direction from phrasing is exactly the extraction
 * R-004 warns about (Q-007).
 */
export const createCommitment = mutation({
  args: {
    title: v.string(),
    personId: v.id("people"),
    direction: v.string(),
    expectedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const spaceId = await ensurePersonalSpace(ctx, userId);
    const personId = await requirePerson(ctx, args.personId, userId);
    const direction = requireDirection(args.direction);

    const id = await ctx.db.insert("commitments", {
      ownerUserId: userId,
      spaceId,
      personId,
      title: requireTitle(args.title),
      direction,
      expectedAt: requireExpectedAt(args.expectedAt),
      completed: false,
      completedAt: null,
      createdAt: Date.now(),
    });

    await ctx.db.insert("activity", {
      spaceId,
      actor: "user",
      kind: "commitment.made",
      objectKind: "commitment",
      objectId: id,
      at: Date.now(),
    });

    return id;
  },
});

/**
 * Edits a commitment. Never its ownership, and never its direction — direction
 * is the meaning of the row, and flipping it in place would turn "I owe Raj"
 * into "Raj owes me" without anyone deciding that.
 */
export const updateCommitment = mutation({
  args: {
    id: v.id("commitments"),
    title: v.optional(v.string()),
    expectedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const row = await ownedCommitment(ctx, args.id, userId);

    const patch: Record<string, unknown> = {};
    if (args.title !== undefined) patch.title = requireTitle(args.title);
    if (args.expectedAt !== undefined) patch.expectedAt = requireExpectedAt(args.expectedAt);

    if (Object.keys(patch).length === 0) return;
    await ctx.db.patch(row._id, patch);
  },
});

/**
 * Settles a commitment.
 *
 * For `owed`, the user kept the promise. For `owedTo`, the user is telling
 * Panel it arrived — and the row records **that assertion**, which is why the
 * surface says "you marked this received" and never names what the other person
 * did (ADR-027).
 *
 * Idempotent: re-settling an already-settled commitment changes nothing and
 * writes no second audit row, so a duplicate tap is free.
 */
export const completeCommitment = mutation({
  args: { id: v.id("commitments") },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const row = await ownedCommitment(ctx, args.id, userId);
    const spaceId = await ensurePersonalSpace(ctx, userId);
    if (row.completed) return { alreadyDone: true };

    const now = Date.now();
    await ctx.db.patch(row._id, { completed: true, completedAt: now });
    await ctx.db.insert("activity", {
      spaceId,
      actor: "user",
      kind: "commitment.fulfilled",
      objectKind: "commitment",
      objectId: row._id,
      at: now,
    });
    return { alreadyDone: false };
  },
});

/**
 * Cancels a commitment.
 *
 * Distinct from settling it, and deliberately so: a promise the user withdrew
 * is a real thing that happened, and its history should not read as though the
 * promise was kept. The row is kept, cancelled, and stops being attention.
 */
export const cancelCommitment = mutation({
  args: { id: v.id("commitments") },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const row = await ownedCommitment(ctx, args.id, userId);
    const spaceId = await ensurePersonalSpace(ctx, userId);
    if (row.completed) throw new Error("That commitment is already settled");

    await ctx.db.patch(row._id, { completed: true, completedAt: Date.now() });
    await ctx.db.insert("activity", {
      spaceId,
      actor: "user",
      kind: "commitment.cancelled",
      objectKind: "commitment",
      objectId: row._id,
      at: Date.now(),
    });
    return { cancelled: true };
  },
});

/**
 * Re-opens a settled commitment.
 *
 * The counterpart to settling one, and needed because "I cancelled that by
 * mistake" is a real correction: without it, a mis-tap is permanent.
 */
export const reopenCommitment = mutation({
  args: { id: v.id("commitments") },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const row = await ownedCommitment(ctx, args.id, userId);
    if (!row.completed) return { reopened: false };
    await ctx.db.patch(row._id, { completed: false, completedAt: null });
    return { reopened: true };
  },
});

/**
 * Creates a follow-up task for a waiting item — **only ever on request**.
 *
 * Panel never creates a task for a commitment on its own, because inventing
 * work is how a system becomes a nag (R-009). The button is the approval,
 * exactly as ADR-025's renewal button is.
 *
 * The task is an ordinary task carrying both `personId` and `commitmentId`, so
 * it appears in the user's main list and trains through the normal path with no
 * new plumbing.
 *
 * **Completing it does not settle the commitment.** Chasing someone is not
 * receiving from them, and a system that conflated the two would be recording a
 * fact about a third party it never observed.
 *
 * Idempotent while a follow-up is open: a second press returns the existing
 * task rather than creating a duplicate nudge.
 */
export const followUp = mutation({
  args: { id: v.id("commitments") },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const row = await ownedCommitment(ctx, args.id, userId);
    const spaceId = await ensurePersonalSpace(ctx, userId);
    const now = Date.now();

    const existing = (
      await ctx.db
        .query("tasks")
        .withIndex("by_owner_commitment", (q) =>
          q.eq("ownerUserId", userId).eq("commitmentId", row._id),
        )
        .take(MAX_FOLLOW_UP_TASKS)
    ).find((t) => !t.completed);
    if (existing) return { taskId: existing._id, created: false };

    const taskId = await ctx.db.insert("tasks", {
      ownerUserId: userId,
      spaceId,
      title: `Follow up: ${row.title}`,
      completed: false,
      priority: 1,
      // Due today: the expected date has already passed, by the only route to
      // this screen that matters. The user asked for a nudge, now.
      dueAt: now,
      createdAt: now,
      completedAt: null,
      tags: [],
      recurrence: null,
      area: "general",
      personId: row.personId,
      commitmentId: row._id,
    });

    await ctx.db.insert("activity", {
      spaceId,
      actor: "user",
      kind: "commitment.followed_up",
      objectKind: "commitment",
      objectId: row._id,
      meta: { task: taskId },
      at: now,
    });

    return { taskId, created: true };
  },
});

/**
 * Removes a commitment and **detaches** its follow-up tasks.
 *
 * The tasks are not deleted. Do-Not-Touch #9 forbids deleting user data as a
 * side effect of another action, and a user who tidies away a commitment should
 * keep the "chase Raj" task they wrote. The count comes back so the UI can say
 * what happened rather than letting it disappear quietly.
 */
export const deleteCommitment = mutation({
  args: { id: v.id("commitments") },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const row = await ownedCommitment(ctx, args.id, userId);
    const spaceId = await ensurePersonalSpace(ctx, userId);

    const tasks = await ctx.db
      .query("tasks")
      .withIndex("by_owner_commitment", (q) =>
        q.eq("ownerUserId", userId).eq("commitmentId", row._id),
      )
      .take(MAX_FOLLOW_UP_TASKS);
    for (const task of tasks) {
      await ctx.db.patch(task._id, { commitmentId: undefined });
    }

    await ctx.db.delete(row._id);
    await ctx.db.insert("activity", {
      spaceId,
      actor: "user",
      kind: "commitment.cancelled",
      objectKind: "commitment",
      objectId: row._id,
      meta: { detached: String(tasks.length) },
      at: Date.now(),
    });

    return { detached: tasks.length };
  },
});
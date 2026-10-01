import { getAuthUserId } from "@convex-dev/auth/server";
import type { GenericMutationCtx, GenericQueryCtx } from "convex/server";
import { v } from "convex/values";

import { DEFAULT_AREA_SLUG, areaBySlug } from "../lib/areas";
import { planCapture } from "../lib/capture";
import { nextOccurrence, parseTaskInput } from "../lib/nlp";
import {
  dueBucketKey,
  emptyBehaviour,
  extractFeatures,
  initialWeights,
  learningRateFor,
  rankTasks,
  trainOne,
  WEIGHTS_VERSION,
  type BehaviourStats,
  type TaskFeatures,
} from "../lib/scorer";

import type { DataModel, Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { type AreaSlug, type Priority } from "./schema";
import { ensurePersonalSpace } from "./spaces";

const DAY_MS = 86_400_000;

/**
 * How often a restore point is taken automatically, in labelled events.
 *
 * Without this, `modelSnapshots` would only ever contain entries a user
 * explicitly asked for, and "undo the model" would be unavailable precisely
 * when someone notices it going wrong. Every 25 completions is frequent enough
 * that a bad stretch costs at most 25 events to undo, and rare enough that the
 * snapshot table stays small.
 */
export const AUTO_SNAPSHOT_EVERY = 25;

/**
 * How much activity `captureAudit` reads.
 *
 * A read, so it is bounded rather than exhaustive. This is a question of "did
 * the audit row get written, and with what count", not an export, and an
 * unbounded read on a query a client may call is the shape of defect D37.
 */
const AUDIT_SCAN_LIMIT = 500;

/** Snapshots retained per user; the oldest are pruned. */
export const MAX_SNAPSHOTS = 10;

/**
 * Cap on each explicit suppression set (RJD-006).
 *
 * The sets are written by an explicit "not for me" and are the only way a user
 * can hide a category, so they have to be bounded: an array grown without limit
 * inside a mutation is a row with no ceiling on it. The oldest entries are
 * dropped, because a preference stated months ago is weaker evidence than one
 * stated today.
 */
export const MAX_SUPPRESSION_ENTRIES = 50;

/**
 * Records the current weights as a restore point, then prunes to the newest
 * {@link MAX_SNAPSHOTS}.
 *
 * Lives beside `recordOutcome` rather than in `model.ts` because this is the
 * only place the weights change, and a restore point that can be forgotten at
 * the write site is not a restore point.
 */
export async function takeSnapshot(
  ctx: GenericMutationCtx<DataModel>,
  state: AssistantDoc,
  reason: "manual" | "automatic" | "rollback",
): Promise<void> {
  const modelVersion = (state.modelVersion ?? 0) + 1;

  const snapshotId = await ctx.db.insert("modelSnapshots", {
    ownerUserId: state.ownerUserId,
    spaceId: state.spaceId,
    weights: [...state.weights],
    weightsVersion: state.weightsVersion ?? WEIGHTS_VERSION,
    modelVersion,
    samples: state.samples,
    reason,
    createdAt: Date.now(),
  });

  const existing = await ctx.db
    .query("modelSnapshots")
    .withIndex("by_owner_modelVersion", (q) => q.eq("ownerUserId", state.ownerUserId))
    .collect();

  const surplus = existing
    .sort((a, b) => b.modelVersion - a.modelVersion)
    .slice(MAX_SNAPSHOTS);
  for (const old of surplus) await ctx.db.delete(old._id);

  await ctx.db.patch(state._id, { modelVersion });
  void snapshotId;
}

export async function requireUserId(ctx: GenericMutationCtx<DataModel>) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("Not authenticated");
  return userId;
}

/** The persisted task shape `spawnNextOccurrence` needs, kept narrow on purpose. */
type TaskRow = {
  _id: Id<"tasks">;
  ownerUserId: Id<"users">;
  spaceId: Id<"spaces">;
  title: string;
  priority: Priority;
  dueAt?: number | null;
  tags?: string[];
  recurrence?: string | null;
  area: AreaSlug;
  personId?: Id<"people">;
};

/** Shape of a persisted assistant row. Exported so a second training path can
 *  take a restore point through exactly the same helper. */
export type AssistantDoc = {
  _id: Id<"assistantState">;
  ownerUserId: Id<"users">;
  spaceId: Id<"spaces">;
  weights: number[];
  weightsVersion?: number;
  modelVersion?: number;
  learningPaused?: boolean;
  byHour: number[];
  byWeekday: number[];
  byTag: Record<string, { done: number; total: number }>;
  byArea?: Record<string, { done: number; total: number }>;
  bySource?: Record<string, { done: number; total: number }>;
  byPerson?: Record<string, { done: number; total: number }>;
  byDueBucket?: Record<string, { done: number; total: number }>;
  suppressedKinds?: string[];
  suppressedAreas?: string[];
  shortDone: number;
  shortTotal: number;
  longDone: number;
  longTotal: number;
  samples: number;
  updatedAt: number;
};

/** Reads the caller's model row. `userId` is typed, not `any`: the index value
 *  and the document's `ownerUserId` are the same thing, and a mismatch between
 *  them is exactly the kind of bug a `any` hides. */
async function loadState(
  ctx: GenericQueryCtx<DataModel>,
  userId: Id<"users">,
): Promise<AssistantDoc | null> {
  const row = await ctx.db
    .query("assistantState")
    .withIndex("by_owner", (q) => q.eq("ownerUserId", userId))
    .unique();
  return (row as AssistantDoc | null) ?? null;
}

/** Converts the persisted counters into the shape the scorer expects. */
function toBehaviour(state: AssistantDoc | null): BehaviourStats {
  if (!state) return emptyBehaviour();
  return {
    byHour: state.byHour ?? emptyBehaviour().byHour,
    byWeekday: state.byWeekday ?? emptyBehaviour().byWeekday,
    byTag: (state.byTag ?? {}) as BehaviourStats["byTag"],
    shortDone: state.shortDone ?? 0,
    shortTotal: state.shortTotal ?? 0,
    longDone: state.longDone ?? 0,
    longTotal: state.longTotal ?? 0,
    byArea: state.byArea ?? {},
    bySource: state.bySource ?? {},
    byPerson: state.byPerson ?? {},
    byDueBucket: state.byDueBucket ?? {},
  };
}

function currentWeights(state: AssistantDoc | null): number[] {
  return state?.weights ?? initialWeights();
}

/**
 * The whole dashboard: tasks ordered by the learned model, plus a short
 * "what matters now" brief derived from the user's real data.
 */
export const getDashboard = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const [tasks, notes, state, spaces] = await Promise.all([
      ctx.db.query("tasks").withIndex("by_owner", (q) => q.eq("ownerUserId", userId)).collect(),
      ctx.db.query("notes").withIndex("by_owner", (q) => q.eq("ownerUserId", userId)).collect(),
      loadState(ctx, userId),
      ctx.db.query("spaces").withIndex("by_createdBy", (q) => q.eq("createdBy", userId)).collect(),
    ]);

    const now = new Date();
    const behaviour = toBehaviour(state);
    const weights = currentWeights(state);

    const ranked = rankTasks(
      tasks.map((t) => ({
        ...t,
        dueAt: t.dueAt ?? null,
        tags: t.tags ?? [],
        isOverdue: !t.completed && t.dueAt != null && t.dueAt < now.getTime(),
      })),
      (task) =>
        extractFeatures(
          {
            priority: task.priority as 0 | 1 | 2,
            dueAt: task.dueAt,
            createdAt: task.createdAt,
            tags: task.tags,
            area: task.area,
            source: task.origin,
          },
          behaviour,
          now,
        ),
      weights,
    );

    const open = ranked.filter((r) => !r.task.completed);
    const completed = ranked.filter((r) => r.task.completed);
    const overdue = open.filter((r) => r.task.isOverdue);

    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const todayStart = startOfToday.getTime();

    // The chart and the counts come from `activity`, not from re-scanning tasks.
    // Two reasons, and the second is the important one: a task that was
    // completed and then cleared is a real finished thing that a scan of the
    // task table cannot see, and "what did I actually do" is what this claims
    // to answer. Activity is an append-only log, so it is also the one place
    // that survives the user tidying up after themselves.
    const personalSpaceId = spaces.find((s) => s.isPersonal)?._id ?? state?.spaceId ?? null;
    const weekActivity = personalSpaceId
      ? await ctx.db
          .query("activity")
          .withIndex("by_space_at", (q) =>
            q.eq("spaceId", personalSpaceId).gte("at", todayStart - 6 * DAY_MS),
          )
          .collect()
      : [];

    const completionsIn = (from: number, to: number): number =>
      weekActivity.filter((a) => a.kind === "task.completed" && a.at >= from && a.at < to).length;

    const completedToday = completionsIn(todayStart, todayStart + DAY_MS);
    const completedThisWeek = completionsIn(todayStart - 6 * DAY_MS, todayStart + DAY_MS);

    const week: { day: string; count: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const dayStart = todayStart - i * DAY_MS;
      const dayEnd = dayStart + DAY_MS;
      week.push({
        day: new Date(dayStart).toLocaleDateString("en-US", { weekday: "narrow" }),
        count: completionsIn(dayStart, dayEnd),
      });
    }

    // ---- the brief ---------------------------------------------------------
    // Derived entirely from the user's own data. No generated prose, no
    // external model — just what the numbers actually say.
    const next = open[0];
    const brief: string[] = [];
    if (overdue.length > 0) {
      brief.push(`${overdue.length} overdue — clear ${overdue[0].task.title.toLowerCase()} first.`);
    }
    if (next) {
      const topReason = next.reasons.find((r) => r.contribution > 0);
      brief.push(
        topReason
          ? `Start with "${next.task.title}" — ${topReason.label}.`
          : `Start with "${next.task.title}".`,
      );
    }
    if (overdue.length === 0 && open.length === 0 && completedToday > 0) {
      brief.push("Everything's done. Clean board today.");
    }
    if (completedToday >= 3 && overdue.length === 0) {
      brief.push(`${completedToday} done today, nothing overdue. On track.`);
    }

    return {
      tasks: ranked.map((r) => ({ ...r.task, score: r.score, reasons: r.reasons })),
      notes: notes.sort((a, b) => b.createdAt - a.createdAt),
      brief,
      stats: {
        open: open.length,
        overdue: overdue.length,
        completedTotal: completed.length,
        completedToday,
        completedThisWeek,
        week,
        completionRate:
          tasks.length === 0 ? 0 : Math.round((completed.length / tasks.length) * 100),
        samples: state?.samples ?? 0,
      },
    };
  },
});

/**
 * Resolves the area a new task belongs to.
 *
 * TASK-0A-006. The area is accepted as part of the insert so task creation is a
 * single atomic mutation. Previously the UI had to insert and then patch, and a
 * failure between the two left an unassigned task behind.
 *
 * An unknown or disabled area falls back to General rather than throwing: the
 * composer should never fail because a tab was disabled in another session.
 */
async function resolveArea(
  ctx: GenericMutationCtx<DataModel>,
  userId: Id<"users">,
  requested?: string,
): Promise<AreaSlug> {
  if (!requested || requested === DEFAULT_AREA_SLUG) return DEFAULT_AREA_SLUG;
  // Narrow against the catalogue before touching the index: the column is a
  // closed union, and an unrecognised slug is a stale tab from another session
  // rather than an error worth surfacing to the composer.
  const def = areaBySlug(requested);
  if (!def) return DEFAULT_AREA_SLUG;
  const slug = def.slug as AreaSlug;

  const match = await ctx.db
    .query("areas")
    .withIndex("by_owner_slug", (q) => q.eq("ownerUserId", userId).eq("slug", slug))
    .first();
  // Only an area the user actually has enabled is accepted.
  return match ? slug : DEFAULT_AREA_SLUG;
}

/**
 * Creates a task from natural language, optionally straight into a life area.
 *
 * Parsing happens server-side so behaviour is identical whether the composer
 * preview was skipped (quick add) or not.
 */
/**
 * Multi-object capture (phase 3, feature 2).
 *
 * The one capture entry point that can produce more than one task. Everything
 * it does, it does through the *existing* `addTask` semantics: same parser,
 * same area resolution, same ownership check, same row shape. There is no
 * second way to make a task in Panel, which is the point — a feature that
 * introduced its own insert path would be a feature that could drift from
 * `addTask`'s without anyone noticing.
 *
 * **The server result is authoritative.** The client may preview a parse, but
 * this mutation re-plans from the raw string, so a client that lies about its
 * own segmentation gets the server's answer. Preview and commit therefore
 * cannot disagree about what was created.
 *
 * **One space per capture.** `ensurePersonalSpace` is resolved once and every
 * created task carries it, so a capture cannot straddle two spaces.
 *
 * **One `capture.committed` row per accepted capture**, carrying the real
 * segment count. That kind has been in the closed taxonomy since phase 0B and
 * written by nothing until now (D38) — an audit row that is declared but never
 * written is a promise the code does not keep.
 */
export const capture = mutation({
  args: {
    input: v.string(),
    area: v.optional(v.string()),
    /**
     * A person the whole capture is about, chosen explicitly by the user.
     * Ownership-checked server-side, exactly as in `addTask`. It is applied to
     * every segment that does not name a different person itself.
     */
    personId: v.optional(v.id("people")),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const spaceId = await ensurePersonalSpace(ctx, userId);
    const area = await resolveArea(ctx, userId, args.area);

    // An explicitly chosen person is verified once, here, and the *verified*
    // id is what the plan is given. The plan therefore cannot attach a person
    // the user does not own, even by accident.
    let explicitPerson: { id: string; name: string } | null = null;
    if (args.personId) {
      const person = await ctx.db.get(args.personId);
      if (!person || person.ownerUserId !== userId) throw new Error("Person not found");
      explicitPerson = { id: person._id, name: person.name };
    }

    // Read the caller's own people, bounded, so a segment that opens with a
    // known name can be linked. Identity resolution is advisory (ADR-024): this
    // reads keys, and never writes or merges anything.
    const ownPeople = await ctx.db
      .query("people")
      .withIndex("by_owner", (q) => q.eq("ownerUserId", userId))
      .collect();
    const byId = new Map(ownPeople.map((p) => [p._id, p] as const));

    const known = ownPeople
      .filter((p) => p.mergedIntoId === undefined)
      .map((p) => ({ id: p._id, name: p.name }));

    const plan = planCapture(args.input, known, new Date());

    if (plan.refused) {
      // Refusing is the whole of the low-confidence rule: no object is created,
      // and the reason travels back so the UI can say it rather than shrugging.
      return {
        created: [] as { id: string; title: string; dueAt: number | null; personId: string | null }[],
        dropped: plan.dropped,
        overflow: 0,
        refused: true as const,
        refusalReason: plan.refusalReason ?? "Nothing to capture",
      };
    }

    const created: { id: string; title: string; dueAt: number | null; personId: string | null }[] = [];

    for (const segment of plan.segments) {
      // A segment naming its own person wins over the capture-level choice.
      const subject = segment.leadingPerson ?? explicitPerson;
      if (subject) {
        // Re-check even for a plan-derived person: the plan was given ids this
        // mutation read, but the check is cheap and ownership is not something
        // to be inferred from a previous line of the same function.
        const row = byId.get(subject.id as Id<"people">);
        if (!row || row.ownerUserId !== userId) continue;
      }

      const id = await ctx.db.insert("tasks", {
        ownerUserId: userId,
        spaceId,
        title: segment.parsed.title,
        completed: false,
        priority: segment.parsed.priority,
        dueAt: segment.parsed.dueAt,
        createdAt: Date.now(),
        completedAt: null,
        tags: segment.parsed.tags,
        recurrence: segment.parsed.recurrence,
        area,
        personId: subject ? (subject.id as Id<"people">) : undefined,
      });

      created.push({
        id,
        title: segment.parsed.title,
        dueAt: segment.parsed.dueAt,
        personId: subject?.id ?? null,
      });
    }

    await ctx.db.insert("activity", {
      spaceId,
      actor: "user",
      kind: "capture.committed",
      // `objectKind` and `objectId` are deliberately absent. A capture is an
      // *act*, not an object, and it may have created several tasks — so there
      // is no single object to point at, and naming the first one would make
      // the audit row claim the capture was about something it was not. The
      // kind already says what happened; `meta` carries how much of it.
      meta: { segments: String(created.length) },
      at: Date.now(),
    });

    return {
      created,
      dropped: plan.dropped,
      overflow: plan.overflow,
      refused: false as const,
      refusalReason: null,
    };
  },
});

/**
 * The caller's own capture audit trail.
 *
 * Exists so `capture.committed` can be *read back* rather than assumed. A
 * harness that trusted the mutation's return value would prove only that the
 * mutation returned; this query is what makes "the audit row was actually
 * written, with the real count" a checkable claim rather than a promise
 * (D38 is the defect class where a kind is declared and never written).
 *
 * Owner-scoped to the caller's personal space, and bounded — this is an
 * inspection surface for a person checking their own history, not an export.
 */
export const captureAudit = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return { kinds: [] as string[], segments: [] as string[] };

    const spaces = await ctx.db
      .query("spaces")
      .withIndex("by_createdBy", (q) => q.eq("createdBy", userId))
      .collect();
    if (spaces.length === 0) return { kinds: [], segments: [] };

    const kinds: string[] = [];
    const segments: string[] = [];

    for (const space of spaces) {
      // One indexed range per space, and bounded. The first version of this
      // query read `by_space_at` with no range and filtered the owner's spaces
      // in JavaScript — a table-wide collect on a read path, which is exactly
      // the defect class phase 3 feature 1 audited for (D37) and exactly what
      // this query must not reintroduce. The range is `spaceId` because that
      // is the index's prefix, so the database does the scoping.
      const rows = await ctx.db
        .query("activity")
        .withIndex("by_space_at", (q) => q.eq("spaceId", space._id))
        .take(AUDIT_SCAN_LIMIT);

      for (const row of rows) {
        kinds.push(row.kind);
        // `meta` is a scalar union, so the count comes back typed as
        // `string | number | boolean` even though this writer only ever stores
        // a string. Coercing here rather than casting keeps the shape honest
        // for any future writer of the same kind.
        if (row.kind === "capture.committed") {
          segments.push(String(row.meta?.segments ?? ""));
        }
      }
    }

    return { kinds, segments };
  },
});

/**
 * Creates a task from natural language, optionally straight into a life area.
 *
 * Parsing happens server-side so behaviour is identical whether the composer
 * preview was skipped (quick add) or not.
 */
export const addTask = mutation({
  args: { input: v.string(), area: v.optional(v.string()), personId: v.optional(v.id("people")) },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const spaceId = await ensurePersonalSpace(ctx, userId);
    const parsed = parseTaskInput(args.input);

    if (parsed.title.length > 200) throw new Error("Task title is too long (max 200 characters)");

    // A person is only ever attached by the user picking them, and only ever
    // from their own account. The check is here rather than in the UI because a
    // client can send any id it likes — including somebody else's.
    let personId: Id<"people"> | undefined;
    if (args.personId) {
      const person = await ctx.db.get(args.personId);
      if (!person || person.ownerUserId !== userId) throw new Error("Person not found");
      personId = person._id;
    }

    return await ctx.db.insert("tasks", {
      ownerUserId: userId,
      spaceId,
      title: parsed.title,
      completed: false,
      priority: parsed.priority,
      dueAt: parsed.dueAt,
      createdAt: Date.now(),
      completedAt: null,
      tags: parsed.tags,
      recurrence: parsed.recurrence,
      area: await resolveArea(ctx, userId, args.area),
      personId,
    });
  },
});

/**
 * Creates the next occurrence of a recurring task (TASK-0A-005 / D5).
 *
 * Recurrence was parsed, displayed and tested but never acted on, so a
 * recurring task completed and silently never returned. The parser and
 * `nextOccurrence` already existed; only the wiring was missing.
 *
 * Exactly-once is enforced by the caller, not here: `setTaskCompleted` only
 * calls this on a real not-completed -> completed transition. Convex's OCC
 * re-runs the whole mutation after a conflict, so a concurrent second
 * completion of the same task conflicts on the task patch and retries, at which
 * point the transition guard is false and nothing is spawned.
 */
async function spawnNextOccurrence(ctx: GenericMutationCtx<DataModel>, task: TaskRow) {
  if (!task.recurrence || task.dueAt == null) return;

  const nextDue = nextOccurrence(task.dueAt, task.recurrence);
  if (!Number.isFinite(nextDue) || nextDue <= task.dueAt) return;

  await ctx.db.insert("tasks", {
    ownerUserId: task.ownerUserId,
    spaceId: task.spaceId,
    title: task.title,
    completed: false,
    priority: task.priority,
    dueAt: nextDue,
    createdAt: Date.now(),
    completedAt: null,
    tags: task.tags ?? [],
    recurrence: task.recurrence,
    area: task.area,
    // The link to a person is part of *what* the recurring task is, so it
    // respawns with it. Copying an id forward is safe in a way copying keys
    // would not be: a tombstone resolved on read still reaches the same person.
    personId: task.personId,
  });
}

export const setTaskCompleted = mutation({
  args: { id: v.id("tasks"), completed: v.boolean() },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const task = await ctx.db.get(args.id);
    if (!task || task.ownerUserId !== userId) throw new Error("Task not found");

    const spaceId = await ensurePersonalSpace(ctx, userId);
    const now = Date.now();
    // Only a real transition trains the model or respawns the recurrence. This
    // is what makes completing an already-completed task a no-op, whether it
    // arrives as a duplicate click or as an OCC retry.
    const completing = args.completed && !task.completed;

    await ctx.db.patch(args.id, {
      completed: args.completed,
      completedAt: args.completed ? now : null,
    });

    if (completing) {
      // Capture the features the task had *at resolution time* — training on
      // today's features for a task resolved today is the honest signal.
      const state = await loadState(ctx, userId);
      const behaviour = toBehaviour(state);

      // Phase 3: `PEOPLE_FIT` finally has something real to read. The key is the
      // person **id**, not a name — two people called "Raj" must not share
      // completion evidence. Rows written before phase 3 keyed this counter by a
      // free-text name; those keys simply stop being read, because a name is
      // exactly the thing that cannot identify a person safely. The column is
      // optional and nothing migrates.
      const features = featuresOf(task);
      const x = extractFeatures(features, behaviour, new Date());

      await ctx.db.patch(args.id, { featuresAtCompletion: x });
      await recordOutcome(ctx, userId, spaceId, state, x, features, 1, new Date());

      // One append-only row per real completion. This is what the seven-day
      // chart reads, so it is written on the transition and not derived from the
      // task's current state — a completion that is later cleared away still
      // happened, and still counts.
      await ctx.db.insert("activity", {
        spaceId,
        actor: "user",
        kind: "task.completed",
        objectId: args.id,
        at: now,
      });

      // Respawn before returning so the next occurrence exists by the time the
      // client sees the completion. Idempotent — see spawnNextOccurrence.
      await spawnNextOccurrence(ctx, task as TaskRow);
    }
  },
});

export const updateTask = mutation({
  args: {
    id: v.id("tasks"),
    title: v.optional(v.string()),
    priority: v.optional(v.union(v.literal(0), v.literal(1), v.literal(2))),
    dueAt: v.optional(v.union(v.null(), v.number())),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const task = await ctx.db.get(args.id);
    if (!task || task.ownerUserId !== userId) throw new Error("Task not found");

    const patch: Record<string, unknown> = {};
    if (args.title !== undefined) {
      const title = args.title.trim();
      if (!title) throw new Error("Task title cannot be empty");
      patch.title = title;
    }
    if (args.priority !== undefined) patch.priority = args.priority;
    if (args.dueAt !== undefined) patch.dueAt = args.dueAt;

    if (Object.keys(patch).length > 0) await ctx.db.patch(args.id, patch);
  },
});

export const removeTask = mutation({
  args: { id: v.id("tasks") },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const task = await ctx.db.get(args.id);
    if (!task || task.ownerUserId !== userId) throw new Error("Task not found");

    // Deleting something you never finished is a negative training signal.
    if (!task.completed) {
      const spaceId = await ensurePersonalSpace(ctx, userId);
      const state = await loadState(ctx, userId);
      const behaviour = toBehaviour(state);
      const features = featuresOf(task);
      const x = extractFeatures(features, behaviour, new Date());
      await recordOutcome(ctx, userId, spaceId, state, x, features, 0, new Date());
    }

    await ctx.db.delete(args.id);
  },
});

/**
 * The one place a task row becomes a feature vector.
 *
 * `recordOutcome` used to be handed the raw row, whose fields are `origin` and
 * `personId`, while the feature object it must roll up by is keyed `source` and
 * `person`. Both names existed, both were optional, and nothing failed: the
 * roll-ups simply saw `undefined` and returned the counter map unchanged, every
 * time. `SOURCE_FIT` (9) and `PEOPLE_FIT` (10) were therefore permanently 0 —
 * two features in a frozen layout that could never receive evidence, and whose
 * weights could never move (D34).
 *
 * Building the object once and handing *the same object* to both halves of the
 * step makes that class of drift a compile error instead of a silent zero, and
 * means a future field rename has exactly one place to be renamed in.
 */
function featuresOf(task: {
  priority: number;
  dueAt?: number | null;
  createdAt: number;
  tags?: string[];
  area?: string;
  origin?: string;
  personId?: string;
}): TaskFeatures {
  return {
    priority: task.priority as 0 | 1 | 2,
    dueAt: task.dueAt ?? null,
    createdAt: task.createdAt,
    tags: task.tags ?? [],
    area: task.area,
    source: task.origin,
    // Keyed by person id, never by name: two people called "Raj" must not
    // share a row of completion evidence.
    person: task.personId,
  };
}

/**
 * Updates the trained model and the rolled-up behaviour counters.
 *
 * This is the only place weights change. Both the logistic-regression update
 * and the habit counters live here so the model and the features it reads stay
 * consistent with each other.
 */
async function recordOutcome(
  ctx: GenericMutationCtx<DataModel>,
  userId: Id<"users">,
  spaceId: Id<"spaces">,
  state: AssistantDoc | null,
  x: number[],
  task: TaskFeatures,
  label: 0 | 1,
  when: Date,
) {
  const weights = currentWeights(state);

  // A paused model learns nothing at all: not the weights, not the habit
  // counters, not the sample count. Pausing is meant to be a real pause, and a
  // half-pause would keep nudging the ranking the user asked to stop trusting.
  if (state?.learningPaused) return;

  // Learning rate decays as evidence accumulates (§5.4), so the first hundred
  // completions move the model and the tenth thousand barely nudge it.
  const nextWeights = trainOne(weights, x, label, learningRateFor(state?.samples ?? 0));

  const behaviour = toBehaviour(state);
  const hourBucket = Math.min(3, Math.floor(when.getHours() / 6));
  const weekday = when.getDay();

  const byHour = [...behaviour.byHour];
  const byWeekday = [...behaviour.byWeekday];
  byHour[hourBucket] = (byHour[hourBucket] ?? 0) + label;
  byWeekday[weekday] = (byWeekday[weekday] ?? 0) + label;

  const byTag = { ...behaviour.byTag };
  for (const tag of task.tags ?? []) {
    const prev = byTag[tag] ?? { done: 0, total: 0 };
    byTag[tag] = { done: prev.done + label, total: prev.total + 1 };
  }

  // Phase 1.1: the same roll-up for the four appended features (8–11). Each
  // counter is keyed by the same string `extractFeatures` looked it up with, so
  // a read and a write can never disagree about the key.
  const rollUp = (
    stats: Record<string, { done: number; total: number }> | undefined,
    key: string | undefined,
  ): Record<string, { done: number; total: number }> => {
    if (!key) return stats ?? {};
    const next = { ...(stats ?? {}) };
    const prev = next[key] ?? { done: 0, total: 0 };
    next[key] = { done: prev.done + label, total: prev.total + 1 };
    return next;
  };

  const byArea = rollUp(behaviour.byArea, task.area);
  const bySource = rollUp(behaviour.bySource, task.source);
  const byPerson = rollUp(behaviour.byPerson, task.person);
  const byDueBucket = rollUp(behaviour.byDueBucket, dueBucketKey(task.dueAt ?? null, when));

  // "Long" = a due date more than two days out, matching the scorer's split.
  const isLong = task.dueAt != null && task.dueAt - Date.now() > 2 * DAY_MS;
  const base = {
    weights: nextWeights,
    weightsVersion: state?.weightsVersion ?? WEIGHTS_VERSION,
    modelVersion: state?.modelVersion ?? 0,
    byHour,
    byWeekday,
    byTag,
    byArea,
    bySource,
    byPerson,
    byDueBucket,
    // Suppression is a *decision*, not an outcome, and is written only by an
    // explicit "not for me" in attention.ts. It is carried through unchanged so
    // that training on one event can never quietly wipe a stated preference.
    suppressedKinds: state?.suppressedKinds ?? [],
    suppressedAreas: state?.suppressedAreas ?? [],
    shortDone: state?.shortDone ?? 0,
    shortTotal: state?.shortTotal ?? 0,
    longDone: state?.longDone ?? 0,
    longTotal: state?.longTotal ?? 0,
    samples: (state?.samples ?? 0) + 1,
    updatedAt: Date.now(),
  };

  // Roll the short/long completion counters by outcome.
  if (isLong) {
    base.longTotal += 1;
    if (label === 1) base.longDone += 1;
  } else {
    base.shortTotal += 1;
    if (label === 1) base.shortDone += 1;
  }

  if (state) {
    await ctx.db.patch(state._id, base);
    // Automatic restore point, taken inside the same transaction as the update
    // it captures, so it can never disagree with the state it recorded.
    if (base.samples % AUTO_SNAPSHOT_EVERY === 0) {
      await takeSnapshot(
        ctx,
        { ...state, ...base, spaceId, weightsVersion: base.weightsVersion, modelVersion: state.modelVersion },
        "automatic",
      );
    }
    return;
  }

  // No row yet, so create it.
  //
  // This read-then-insert is safe by construction under Convex's transactional
  // OCC: the read above scans the `by_owner` index range, so a concurrent
  // insert into that range conflicts, the loser is rolled back and re-executed,
  // and on retry it observes this row and patches instead of inserting.
  // Verified against a live deployment — see ADR-022 and the N1 entry in
  // spec/02_CHANGELOG.md. Do not reintroduce a deterministic-id upsert:
  // `ctx.db.insert` has no explicit-id overload in any released Convex version.
  await ctx.db.insert("assistantState", { ownerUserId: userId, spaceId, ...base });
}

export const clearCompleted = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const tasks = await ctx.db
      .query("tasks")
      .withIndex("by_owner", (q) => q.eq("ownerUserId", userId))
      .collect();

    const done = tasks.filter((t) => t.completed);
    for (const task of done) await ctx.db.delete(task._id);
    return done.length;
  },
});

export const addNote = mutation({
  args: { body: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const body = args.body.trim();
    if (!body) throw new Error("Note cannot be empty");
    if (body.length > 2000) throw new Error("Note is too long (max 2000 characters)");

    const spaceId = await ensurePersonalSpace(ctx, userId);
    await ctx.db.insert("notes", { ownerUserId: userId, spaceId, body, createdAt: Date.now() });
  },
});

export const removeNote = mutation({
  args: { id: v.id("notes") },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const note = await ctx.db.get(args.id);
    if (!note || note.ownerUserId !== userId) throw new Error("Note not found");
    await ctx.db.delete(args.id);
  },
});

/** Lets the user inspect what the model has actually learned. */
export const getModel = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const state = await loadState(ctx, userId);
    return {
      weights: currentWeights(state),
      samples: state?.samples ?? 0,
      byHour: state?.byHour ?? emptyBehaviour().byHour,
      byWeekday: state?.byWeekday ?? emptyBehaviour().byWeekday,
      updatedAt: state?.updatedAt ?? null,
    };
  },
});
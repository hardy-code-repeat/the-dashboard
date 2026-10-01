import { getAuthUserId } from "@convex-dev/auth/server";
import type { GenericMutationCtx, GenericQueryCtx } from "convex/server";
import { v } from "convex/values";

import { DEFAULT_AREA_SLUG } from "../lib/areas";
import { nextOccurrence, parseTaskInput } from "../lib/nlp";
import {
  emptyBehaviour,
  extractFeatures,
  initialWeights,
  rankTasks,
  trainOne,
  type BehaviourStats,
} from "../lib/scorer";

import type { DataModel, Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";

const DAY_MS = 86_400_000;

export async function requireUserId(ctx: GenericMutationCtx<DataModel>) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("Not authenticated");
  return userId;
}

/** The persisted task shape `spawnNextOccurrence` needs, kept narrow on purpose. */
type TaskRow = {
  _id: Id<"tasks">;
  userId: Id<"users">;
  title: string;
  priority: number;
  dueAt?: number | null;
  tags?: string[];
  recurrence?: string | null;
  area?: string;
};

/** Shape of a persisted assistant row. */
type AssistantDoc = {
  _id: any;
  userId: any;
  weights: number[];
  byHour: number[];
  byWeekday: number[];
  byTag: Record<string, { done: number; total: number }>;
  shortDone: number;
  shortTotal: number;
  longDone: number;
  longTotal: number;
  samples: number;
  updatedAt: number;
};async function loadState(
  ctx: GenericQueryCtx<DataModel>,
  userId: any,
): Promise<AssistantDoc | null> {
  const row = await ctx.db
    .query("assistantState")
    .withIndex("by_user", (q) => q.eq("userId", userId))
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

    const [tasks, notes, state] = await Promise.all([
      ctx.db.query("tasks").withIndex("by_user", (q) => q.eq("userId", userId)).collect(),
      ctx.db.query("notes").withIndex("by_user", (q) => q.eq("userId", userId)).collect(),
      loadState(ctx, userId),
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
          { priority: task.priority as 0 | 1 | 2, dueAt: task.dueAt, createdAt: task.createdAt, tags: task.tags },
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

    const completedToday = completed.filter(
      (r) => r.task.completedAt != null && r.task.completedAt >= todayStart,
    ).length;
    const completedThisWeek = completed.filter(
      (r) => r.task.completedAt != null && r.task.completedAt >= now.getTime() - 7 * DAY_MS,
    ).length;

    const week: { day: string; count: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const dayStart = todayStart - i * DAY_MS;
      const dayEnd = dayStart + DAY_MS;
      week.push({
        day: new Date(dayStart).toLocaleDateString("en-US", { weekday: "narrow" }),
        count: completed.filter(
          (r) =>
            r.task.completedAt != null &&
            r.task.completedAt >= dayStart &&
            r.task.completedAt < dayEnd,
        ).length,
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
): Promise<string> {
  if (!requested || requested === DEFAULT_AREA_SLUG) return DEFAULT_AREA_SLUG;
  const rows = await ctx.db
    .query("areas")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  return rows.some((a) => a.slug === requested) ? requested : DEFAULT_AREA_SLUG;
}

/**
 * Creates a task from natural language, optionally straight into a life area.
 *
 * Parsing happens server-side so behaviour is identical whether the composer
 * preview was skipped (quick add) or not.
 */
export const addTask = mutation({
  args: { input: v.string(), area: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const parsed = parseTaskInput(args.input);

    if (parsed.title.length > 200) throw new Error("Task title is too long (max 200 characters)");

    return await ctx.db.insert("tasks", {
      userId,
      title: parsed.title,
      completed: false,
      priority: parsed.priority,
      dueAt: parsed.dueAt,
      createdAt: Date.now(),
      completedAt: null,
      tags: parsed.tags,
      recurrence: parsed.recurrence,
      area: await resolveArea(ctx, userId, args.area),
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
    userId: task.userId,
    title: task.title,
    completed: false,
    priority: task.priority,
    dueAt: nextDue,
    createdAt: Date.now(),
    completedAt: null,
    tags: task.tags ?? [],
    recurrence: task.recurrence,
    area: task.area,
  });
}

export const setTaskCompleted = mutation({
  args: { id: v.id("tasks"), completed: v.boolean() },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const task = await ctx.db.get(args.id);
    if (!task || task.userId !== userId) throw new Error("Task not found");

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
      const weights = currentWeights(state);
      const x = extractFeatures(
        {
          priority: task.priority as 0 | 1 | 2,
          dueAt: task.dueAt ?? null,
          createdAt: task.createdAt,
          tags: task.tags ?? [],
        },
        behaviour,
        new Date(),
      );

      await ctx.db.patch(args.id, { featuresAtCompletion: x });
      await recordOutcome(ctx, userId, state, x, task, 1, new Date());

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
    priority: v.optional(v.number()),
    dueAt: v.optional(v.union(v.null(), v.number())),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const task = await ctx.db.get(args.id);
    if (!task || task.userId !== userId) throw new Error("Task not found");

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
    if (!task || task.userId !== userId) throw new Error("Task not found");

    // Deleting something you never finished is a negative training signal.
    if (!task.completed) {
      const state = await loadState(ctx, userId);
      const behaviour = toBehaviour(state);
      const x = extractFeatures(
        {
          priority: task.priority as 0 | 1 | 2,
          dueAt: task.dueAt ?? null,
          createdAt: task.createdAt,
          tags: task.tags ?? [],
        },
        behaviour,
        new Date(),
      );
      await recordOutcome(ctx, userId, state, x, task, 0, new Date());
    }

    await ctx.db.delete(args.id);
  },
});

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
  state: AssistantDoc | null,
  x: number[],
  task: { priority: number; dueAt?: number | null; tags?: string[] },
  label: 0 | 1,
  when: Date,
) {
  const weights = currentWeights(state);
  const nextWeights = trainOne(weights, x, label);

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

  // "Long" = a due date more than two days out, matching the scorer's split.
  const isLong = task.dueAt != null && task.dueAt - Date.now() > 2 * DAY_MS;
  const base = {
    weights: nextWeights,
    byHour,
    byWeekday,
    byTag,
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
    return;
  }

  // No row yet, so create it.
  //
  // This read-then-insert is safe by construction under Convex's transactional
  // OCC: the read above scans the `by_user` index range, so a concurrent
  // insert into that range conflicts, the loser is rolled back and re-executed,
  // and on retry it observes this row and patches instead of inserting.
  // Verified against a live deployment — see ADR-022 and the N1 entry in
  // spec/02_CHANGELOG.md. Do not reintroduce a deterministic-id upsert:
  // `ctx.db.insert` has no explicit-id overload in any released Convex version.
  await ctx.db.insert("assistantState", { userId, ...base });
}

export const clearCompleted = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const tasks = await ctx.db
      .query("tasks")
      .withIndex("by_user", (q) => q.eq("userId", userId))
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

    await ctx.db.insert("notes", { userId, body, createdAt: Date.now() });
  },
});

export const removeNote = mutation({
  args: { id: v.id("notes") },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const note = await ctx.db.get(args.id);
    if (!note || note.userId !== userId) throw new Error("Note not found");
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
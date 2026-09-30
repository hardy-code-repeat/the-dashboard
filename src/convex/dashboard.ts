import { getAuthUserId } from "@convex-dev/auth/server";
import type { GenericMutationCtx } from "convex/server";
import { v } from "convex/values";
import type { DataModel } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";

const DAY_MS = 86_400_000;

/** Resolves the signed-in user or throws, for mutations that must not be anonymous. */
async function requireUserId(ctx: GenericMutationCtx<DataModel>) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("Not authenticated");
  return userId;
}

/**
 * Everything the dashboard renders, in one reactive payload.
 *
 * The stats are derived server-side so the client never has to keep a second
 * copy of the task list in sync just to compute a count.
 */
export const getDashboard = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const [tasks, notes] = await Promise.all([
      ctx.db
        .query("tasks")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect(),
      ctx.db
        .query("notes")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect(),
    ]);

    const now = Date.now();
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const todayStart = startOfToday.getTime();

    const open = tasks.filter((t) => !t.completed);
    const completed = tasks.filter((t) => t.completed);

    // Overdue = still open, has a due date, and the date has passed.
    const overdue = open.filter((t) => t.dueAt != null && t.dueAt < now);

    const completedToday = completed.filter(
      (t) => t.completedAt != null && t.completedAt >= todayStart,
    ).length;

    const completedThisWeek = completed.filter(
      (t) => t.completedAt != null && t.completedAt >= now - 7 * DAY_MS,
    ).length;

    // Seven-day completion histogram, oldest first.
    const week: { day: string; count: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const dayStart = todayStart - i * DAY_MS;
      const dayEnd = dayStart + DAY_MS;
      week.push({
        day: new Date(dayStart).toLocaleDateString("en-US", { weekday: "narrow" }),
        count: completed.filter(
          (t) => t.completedAt != null && t.completedAt >= dayStart && t.completedAt < dayEnd,
        ).length,
      });
    }

    return {
      tasks: tasks
        .map((t) => ({ ...t, isOverdue: !t.completed && t.dueAt != null && t.dueAt < now }))
        .sort((a, b) => {
          if (a.completed !== b.completed) return a.completed ? 1 : -1;
          if (a.priority !== b.priority) return a.priority - b.priority;
          return b.createdAt - a.createdAt;
        }),
      notes: notes.sort((a, b) => b.createdAt - a.createdAt),
      stats: {
        open: open.length,
        overdue: overdue.length,
        completedTotal: completed.length,
        completedToday,
        completedThisWeek,
        week,
        completionRate:
          tasks.length === 0
            ? 0
            : Math.round((completed.length / tasks.length) * 100),
      },
    };
  },
});

export const addTask = mutation({
  args: {
    title: v.string(),
    priority: v.optional(v.number()),
    dueAt: v.optional(v.union(v.null(), v.number())),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const title = args.title.trim();
    if (!title) throw new Error("Task title cannot be empty");
    if (title.length > 200) throw new Error("Task title is too long (max 200 characters)");

    await ctx.db.insert("tasks", {
      userId,
      title,
      completed: false,
      priority: args.priority ?? 0,
      dueAt: args.dueAt ?? null,
      createdAt: Date.now(),
      completedAt: null,
    });
  },
});

export const setTaskCompleted = mutation({
  args: { id: v.id("tasks"), completed: v.boolean() },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const task = await ctx.db.get(args.id);
    if (!task || task.userId !== userId) throw new Error("Task not found");

    await ctx.db.patch(args.id, {
      completed: args.completed,
      completedAt: args.completed ? Date.now() : null,
    });
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
    await ctx.db.delete(args.id);
  },
});

export const clearCompleted = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const completed = await ctx.db
      .query("tasks")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    for (const task of completed.filter((t) => t.completed)) {
      await ctx.db.delete(task._id);
    }
    return completed.filter((t) => t.completed).length;
  },
});

export const addNote = mutation({
  args: { body: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const body = args.body.trim();
    if (!body) throw new Error("Note cannot be empty");
    if (body.length > 2000) throw new Error("Note is too long (max 2000 characters)");

    await ctx.db.insert("notes", {
      userId,
      body,
      createdAt: Date.now(),
    });
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
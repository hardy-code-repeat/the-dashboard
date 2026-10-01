import { getAuthUserId } from "@convex-dev/auth/server";
import type { GenericMutationCtx, GenericQueryCtx } from "convex/server";
import { v } from "convex/values";

import {
  alignWeights,
  emptyBehaviour,
  FEATURE_COUNT,
  initialWeights,
  WEIGHTS_VERSION,
} from "../lib/scorer";

import type { DataModel, Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { AUTO_SNAPSHOT_EVERY, MAX_SNAPSHOTS, requireUserId, takeSnapshot } from "./assistant";
import { featureFlagValidator } from "./schema";
import { ensurePersonalSpace } from "./spaces";

/**
 * Model control: pause, snapshot, roll back, reset, and per-user flags
 * (SYSTEM_FUNDAMENTALS §5.4, ADR-010).
 *
 * Every function here follows the same two rules, and they are the reason this
 * module exists rather than three more booleans on `assistantState`:
 *
 *  1. **No user data is ever touched.** Reset clears the *model* — weights,
 *     counters, suppression — and nothing else. Tasks, notes, expenses and tax
 *     records are the user's work, not the model's output.
 *  2. **Every destructive model change is undoable.** A snapshot is taken
 *     *before* the change, never after, so a rollback target always exists.
 */

/** Re-exported so callers can read the cadence without reaching into assistant.ts. */
export { AUTO_SNAPSHOT_EVERY, MAX_SNAPSHOTS };

type StateRow = {
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
  shortDone: number;
  shortTotal: number;
  longDone: number;
  longTotal: number;
  samples: number;
  updatedAt: number;
};

async function loadState(
  ctx: { db: GenericQueryCtx<DataModel>["db"] | GenericMutationCtx<DataModel>["db"] },
  userId: Id<"users">,
): Promise<StateRow | null> {
  return await ctx.db
    .query("assistantState")
    .withIndex("by_owner", (q) => q.eq("ownerUserId", userId))
    .unique();
}

/**
 * Records the current weights, then prunes to the newest {@link MAX_SNAPSHOTS}.
 *
 * The implementation lives in `assistant.ts` next to the only code that writes
 * weights, so a restore point can never be skipped by adding a new write path.
 */
async function snapshot(
  ctx: GenericMutationCtx<DataModel>,
  state: StateRow,
  reason: "manual" | "automatic" | "rollback",
): Promise<void> {
  await takeSnapshot(ctx, state, reason);
}

/**
 * Pause or resume learning.
 *
 * Pausing stops weights, counters and the sample count from moving. It does not
 * stop anything else: hard rules are not the model's opinion (ADR-006), so a
 * paused model still surfaces every deadline.
 */
export const setLearningPaused = mutation({
  args: { paused: v.boolean() },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const state = await loadState(ctx, userId);
    if (!state) {
      // Nothing to pause yet. Creating a paused row would be a lie about a
      // model that does not exist, so this is a no-op with a clear answer.
      throw new Error("Nothing to pause yet — complete a task first.");
    }
    if (Boolean(state.learningPaused) === args.paused) return;
    await ctx.db.patch(state._id, { learningPaused: args.paused, updatedAt: Date.now() });
  },
});

/**
 * Restores an exact weight vector from a snapshot.
 *
 * The vector is written back byte-for-byte. Nothing is re-derived, re-scaled or
 * re-clamped, because a restore that quietly "corrects" the vector is not a
 * restore. The pre-restore weights are snapshotted first, so rolling back a
 * rollback is also possible.
 */
export const restoreModel = mutation({
  args: { snapshotId: v.id("modelSnapshots") },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const target = await ctx.db.get(args.snapshotId);
    if (!target || target.ownerUserId !== userId) throw new Error("Snapshot not found");

    const state = await loadState(ctx, userId);
    if (!state) throw new Error("No model to restore into");

    await snapshot(ctx, state, "rollback");
    await ctx.db.patch(state._id, {
      weights: [...target.weights],
      weightsVersion: target.weightsVersion,
      samples: target.samples,
      updatedAt: Date.now(),
    });
    return { weights: target.weights.length, weightsVersion: target.weightsVersion };
  },
});

/**
 * Clears the model and starts again from the prior.
 *
 * **No user data is deleted.** Tasks, notes, areas, expenses, tax records,
 * connections, links and activity are all untouched; what goes is the learned
 * vector, the rolled-up counters and the sample count. The current weights are
 * snapshotted first, so this is reversible like everything else here.
 */
export const resetModel = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const spaceId = await ensurePersonalSpace(ctx, userId);
    const state = await loadState(ctx, userId);

    if (state) {
      await snapshot(ctx, state, "manual");
      await ctx.db.patch(state._id, {
        weights: initialWeights(),
        weightsVersion: WEIGHTS_VERSION,
        byHour: emptyBehaviour().byHour,
        byWeekday: emptyBehaviour().byWeekday,
        byTag: {},
        shortDone: 0,
        shortTotal: 0,
        longDone: 0,
        longTotal: 0,
        samples: 0,
        learningPaused: false,
        updatedAt: Date.now(),
      });
      return { reset: true, spaceId };
    }

    // No row yet: create a clean one so the UI has something honest to show.
    const behaviour = emptyBehaviour();
    await ctx.db.insert("assistantState", {
      ownerUserId: userId,
      spaceId,
      weights: initialWeights(),
      weightsVersion: WEIGHTS_VERSION,
      modelVersion: 0,
      byHour: behaviour.byHour,
      byWeekday: behaviour.byWeekday,
      byTag: {},
      shortDone: 0,
      shortTotal: 0,
      longDone: 0,
      longTotal: 0,
      samples: 0,
      updatedAt: Date.now(),
    });
    return { reset: true, spaceId };
  },
});

/** The snapshots available to roll back to, newest first. */
export const listSnapshots = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const rows = await ctx.db
      .query("modelSnapshots")
      .withIndex("by_owner_modelVersion", (q) => q.eq("ownerUserId", userId))
      .collect();

    return rows
      .sort((a, b) => b.modelVersion - a.modelVersion)
      .map((r) => ({
        _id: r._id,
        modelVersion: r.modelVersion,
        weightsVersion: r.weightsVersion,
        samples: r.samples,
        reason: r.reason,
        createdAt: r.createdAt,
        weightCount: r.weights.length,
      }));
  },
});

/** A user's feature flags, with an explicit default for anything unset. */
export const listFeatureFlags = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return { generalisedRanking: false, exploration: true, attentionGrouping: true };

    const rows = await ctx.db
      .query("featureFlags")
      .withIndex("by_owner", (q) => q.eq("ownerUserId", userId))
      .collect();

    const set = new Map(rows.map((r) => [r.key, r.enabled] as const));
    return {
      // Off until phase 1.1 ships them: a flag that turns on a feature the user
      // has not been shown yet would be a switch to nowhere.
      generalisedRanking: set.get("generalisedRanking") ?? false,
      exploration: set.get("exploration") ?? true,
      attentionGrouping: set.get("attentionGrouping") ?? true,
    };
  },
});

export const setFeatureFlag = mutation({
  args: { key: featureFlagValidator, enabled: v.boolean() },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const spaceId = await ensurePersonalSpace(ctx, userId);

    const existing = await ctx.db
      .query("featureFlags")
      .withIndex("by_owner_key", (q) => q.eq("ownerUserId", userId).eq("key", args.key))
      .unique();

    if (existing) {
      if (existing.enabled === args.enabled) return;
      await ctx.db.patch(existing._id, { enabled: args.enabled, updatedAt: Date.now() });
      return;
    }
    await ctx.db.insert("featureFlags", {
      ownerUserId: userId,
      spaceId,
      key: args.key,
      enabled: args.enabled,
      updatedAt: Date.now(),
    });
  },
});

/** Everything the model inspector needs, in one round trip. */
export const getModelControls = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const state = await loadState(ctx, userId);
    const [snapshots, flags] = await Promise.all([
      ctx.db
        .query("modelSnapshots")
        .withIndex("by_owner_modelVersion", (q) => q.eq("ownerUserId", userId))
        .collect(),
      ctx.db
        .query("featureFlags")
        .withIndex("by_owner", (q) => q.eq("ownerUserId", userId))
        .collect(),
    ]);

    const flagMap = new Map(flags.map((f) => [f.key, f.enabled] as const));

    return {
      exists: state !== null,
      weights: state?.weights ?? initialWeights(),
      weightsVersion: state?.weightsVersion ?? WEIGHTS_VERSION,
      modelVersion: state?.modelVersion ?? 0,
      samples: state?.samples ?? 0,
      learningPaused: state?.learningPaused ?? false,
      updatedAt: state?.updatedAt ?? null,
      maxSnapshots: MAX_SNAPSHOTS,
      autoSnapshotEvery: AUTO_SNAPSHOT_EVERY,
      snapshotCount: snapshots.length,
      flags: {
        generalisedRanking: flagMap.get("generalisedRanking") ?? false,
        exploration: flagMap.get("exploration") ?? true,
        attentionGrouping: flagMap.get("attentionGrouping") ?? true,
      },
    };
  },
});

/**
 * Re-aligns a stored vector to the current feature layout (ADR-010).
 *
 * The only situation that needs this is a layout change shipping while a
 * weight vector from an older build is still in the database. It appends
 * neutral weights; it never reorders and never rescales, so the meaning of
 * every existing index is preserved exactly.
 */
export const realignModel = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const state = await loadState(ctx, userId);
    if (!state) return { aligned: 0, from: 0, to: FEATURE_COUNT };

    const aligned = alignWeights(state.weights, FEATURE_COUNT);
    const unchanged =
      aligned.length === state.weights.length &&
      aligned.every((v, i) => v === state.weights[i]);
    if (unchanged) return { aligned: 0, from: state.weights.length, to: FEATURE_COUNT };

    await ctx.db.patch(state._id, {
      weights: aligned,
      weightsVersion: WEIGHTS_VERSION,
      updatedAt: Date.now(),
    });
    return { aligned: aligned.length, from: state.weights.length, to: FEATURE_COUNT };
  },
});

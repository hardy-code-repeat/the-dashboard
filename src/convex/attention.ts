import { getAuthUserId } from "@convex-dev/auth/server";
import type { GenericMutationCtx, GenericQueryCtx } from "convex/server";
import { v } from "convex/values";

import { buildAttention, SECTION_BUDGET, type AttentionFeedback } from "../lib/attention/pipeline";
import { hardRules } from "../lib/attention/rules";
import type { ConnectionView, DeadlineView, DocumentView, TaskView } from "../lib/attention/sources";
import { filingYearFor, COUNTRIES, readinessScore } from "../lib/tax";

import type { DataModel, Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { requireUserId } from "./assistant";
import { ensurePersonalSpace } from "./spaces";

/**
 * Attention, computed at query time (ADR-003).
 *
 * Nothing here decides what matters. The rules in `src/lib/attention/rules.ts`
 * do, this module only supplies them with the user's own data and persists what
 * the user does about the result.
 */

type StateRow = {
  _id: Id<"attentionState">;
  spaceId: Id<"spaces">;
  fingerprint: string;
  seenCount?: number;
  actedAt?: number | null;
  dismissedAt?: number | null;
  snoozedUntil?: number | null;
  rejectedAt?: number | null;
  escalation?: 0 | 1 | 2;
};

type AnyCtx = GenericQueryCtx<DataModel> | GenericMutationCtx<DataModel>;

/** Every feedback row for the caller. */
async function loadFeedback(ctx: AnyCtx, userId: Id<"users">): Promise<StateRow[]> {
  return await ctx.db
    .query("attentionState")
    .withIndex("by_owner", (q) => q.eq("ownerUserId", userId))
    .collect();
}

/**
 * The attention feed.
 *
 * Returns every section whether or not it has items, because an empty section
 * that explains itself is information; a missing section is just a gap.
 */
export const getAttention = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const now = Date.now();

    const [tasks, areas, connections, gathered, profile, feedback] = await Promise.all([
      ctx.db
        .query("tasks")
        .withIndex("by_owner", (q) => q.eq("ownerUserId", userId))
        .collect(),
      ctx.db
        .query("areas")
        .withIndex("by_owner", (q) => q.eq("ownerUserId", userId))
        .collect(),
      ctx.db
        .query("connections")
        .withIndex("by_owner", (q) => q.eq("ownerUserId", userId))
        .collect(),
      ctx.db
        .query("taxDocuments")
        .withIndex("by_owner", (q) => q.eq("ownerUserId", userId))
        .collect(),
      ctx.db
        .query("taxProfile")
        .withIndex("by_owner", (q) => q.eq("ownerUserId", userId))
        .unique()
        .catch(() => null),
      loadFeedback(ctx, userId),
    ]);

    const countryCode = (profile?.country ?? "US") as keyof typeof COUNTRIES;
    const country = COUNTRIES[countryCode] ?? COUNTRIES.US;
    const taxYear = profile?.taxYear ?? filingYearFor(new Date(now));

    const taskViews: TaskView[] = tasks.map((t) => ({
      _id: t._id,
      title: t.title,
      completed: t.completed,
      area: t.area,
      dueAt: t.dueAt ?? null,
      priority: t.priority,
      tags: t.tags ?? [],
      orphanedSource: t.orphanedSource,
      sourceDisconnected: t.sourceDisconnected,
    }));

    const deadlineViews: DeadlineView[] = country.deadlines(taxYear).map((d) => ({
      id: d.id,
      label: d.label,
      date: d.date,
      note: d.note,
      source: d.source,
      country: country.code,
    }));

    const connectionViews: ConnectionView[] = connections.map((c) => ({
      _id: c._id,
      provider: c.provider,
      label: c.label,
      status: c.status,
      connectedAt: c.connectedAt,
      lastSyncedAt: c.lastSyncedAt,
    }));

    const gatheredIds = new Set(gathered.map((g) => g.requirementId));
    const readiness = readinessScore(country.documents, gatheredIds);
    const missingLabels = [...readiness.missingRequired, ...readiness.missingOptional].map((d) => d.label);
    const documentViews: DocumentView[] = country.documents.map((d) => ({
      requirementId: d.id,
      label: d.label,
      readiness: readiness.score / 100,
      missing: missingLabels,
    }));

    const candidates = hardRules(
      {
        tasks: taskViews,
        deadlines: deadlineViews,
        connections: connectionViews,
        documents: documentViews,
        enabledAreas: areas.map((a) => a.slug),
        taxYearLabel: country.taxYearLabel(taxYear),
      },
      now,
    );

    const result = buildAttention(candidates, feedback as AttentionFeedback[], now);

    return {
      ...result,
      now,
      sections: result.bySection.map((s) => ({
        ...s,
        max: SECTION_BUDGET[s.section].max,
        halfLife: SECTION_BUDGET[s.section].halfLife,
      })),
      // A cap that binds is a fact the UI must show, not hide. A user who is
      // missing three items because two sections are full deserves to know.
      truncated: result.produced > result.items.length,
    };
  },
});

/**
 * Records one piece of feedback and keeps `seenCount` honest.
 *
 * Upserted by index rather than read-then-insert, for the same OCC reason
 * ADR-022 records: the read is inside the same transaction as the write, so a
 * concurrent second tap conflicts and retries.
 */
async function recordFeedback(
  ctx: GenericMutationCtx<DataModel>,
  userId: Id<"users">,
  fingerprint: string,
  patch: Partial<{
    actedAt: number;
    dismissedAt: number;
    snoozedUntil: number;
    rejectedAt: number;
    escalation: 0 | 1 | 2;
  }>,
  activityKind: "attention.acted" | "attention.dismissed" | "attention.snoozed" | "attention.rejected",
  objectId: string,
) {
  const existing = await ctx.db
    .query("attentionState")
    .withIndex("by_owner_fingerprint", (q) =>
      q.eq("ownerUserId", userId).eq("fingerprint", fingerprint),
    )
    .unique();

  const spaceId = existing?.spaceId ?? (await ensurePersonalSpace(ctx, userId));

  if (existing) {
    await ctx.db.patch(existing._id, { ...patch, updatedAt: Date.now() });
  } else {
    await ctx.db.insert("attentionState", {
      ownerUserId: userId,
      spaceId,
      fingerprint,
      seenCount: 1,
      ...patch,
      updatedAt: Date.now(),
    });
  }

  await ctx.db.insert("activity", {
    spaceId,
    actor: "user",
    kind: activityKind,
    objectId,
    at: Date.now(),
  });
}

/** The user did the thing. The strongest positive signal Panel has. */
export const attentionActed = mutation({
  args: { fingerprint: v.string(), objectId: v.string(), escalation: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    await recordFeedback(
      ctx,
      userId,
      args.fingerprint,
      { actedAt: Date.now(), escalation: clampEscalation(args.escalation) },
      "attention.acted",
      args.objectId,
    );
  },
});

/**
 * Dismiss.
 *
 * A level-2 item is refused here rather than in the UI. A client that can be
 * talked out of an urgent item by a crafted request is not an authority on
 * urgency, and the check has to live on the server to mean anything.
 */
export const attentionDismissed = mutation({
  args: { fingerprint: v.string(), objectId: v.string(), escalation: v.number() },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    if (args.escalation >= 2) {
      throw new Error("This one cannot be dismissed — deal with it or snooze it until later.");
    }
    await recordFeedback(
      ctx,
      userId,
      args.fingerprint,
      { dismissedAt: Date.now(), escalation: clampEscalation(args.escalation) },
      "attention.dismissed",
      args.objectId,
    );
  },
});

/**
 * Snooze. A level-2 item may only be snoozed with a return date — the same
 * rule the pipeline enforces, repeated here because this is the write path and
 * the write path is the one that has to hold.
 */
export const attentionSnoozed = mutation({
  args: {
    fingerprint: v.string(),
    objectId: v.string(),
    escalation: v.number(),
    until: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const now = Date.now();
    if (args.escalation >= 2 && (args.until == null || args.until <= now)) {
      throw new Error("An urgent item has to come back. Pick when.");
    }
    await recordFeedback(
      ctx,
      userId,
      args.fingerprint,
      { snoozedUntil: args.until ?? now + 3_600_000, escalation: clampEscalation(args.escalation) },
      "attention.snoozed",
      args.objectId,
    );
  },
});

/**
 * Reject: "this is not for me".
 *
 * The strongest negative signal, and the only one that is permanent for that
 * exact item. It does **not** write a category suppression: category
 * suppression is a learned preference, and hard rules ignore learned preferences
 * (ADR-006, RJD-006). Phase 1.1 adds the category set, still ignored by rules.
 */
export const attentionRejected = mutation({
  args: { fingerprint: v.string(), objectId: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    await recordFeedback(
      ctx,
      userId,
      args.fingerprint,
      { rejectedAt: Date.now() },
      "attention.rejected",
      args.objectId,
    );
  },
});

function clampEscalation(value: number | undefined): 0 | 1 | 2 | undefined {
  if (value == null) return undefined;
  if (value >= 2) return 2;
  if (value >= 1) return 1;
  return 0;
}

/** How the user has responded to their attention items, for the settings view. */
export const getAttentionStats = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const rows = await loadFeedback(ctx, userId);
    const now = Date.now();

    return {
      tracked: rows.length,
      acted: rows.filter((r) => r.actedAt != null).length,
      dismissed: rows.filter((r) => r.dismissedAt != null).length,
      rejected: rows.filter((r) => r.rejectedAt != null).length,
      snoozed: rows.filter((r) => r.snoozedUntil != null && r.snoozedUntil > now).length,
    };
  },
});

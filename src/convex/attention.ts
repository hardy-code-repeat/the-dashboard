import { getAuthUserId } from "@convex-dev/auth/server";
import type { GenericMutationCtx, GenericQueryCtx } from "convex/server";
import { v } from "convex/values";

import { buildAttention, SECTION_BUDGET, type AttentionFeedback } from "../lib/attention/pipeline";
import { describeCommitment } from "../lib/commitments";
import { describeDocument } from "../lib/documents";
import { allIntegrations } from "../lib/integrations/registry";
import { learnedCandidates } from "../lib/attention/ranked";
import { hardRules, isHardKind } from "../lib/attention/rules";
import {
  calendarSuppressed,
  type CalendarView,
  type CommitmentAttentionView,
  type ConnectionView,
  type DeadlineView,
  type DocumentView,
  type ExpiryView,
  type TaskView,
} from "../lib/attention/sources";
import {
  emptyBehaviour,
  extractFeatures,
  initialWeights,
  learningRateFor,
  shouldRank,
  shouldTrainDismissal,
  trainOne,
} from "../lib/scorer";
import { filingYearFor, COUNTRIES, readinessScore } from "../lib/tax";
import { DAY_MS, READ_LIMITS } from "../lib/readLimits";

import type { DataModel, Id } from "./_generated/dataModel";
import { pickRenewal, renewalRef } from "./documents";
import { mutation, query } from "./_generated/server";
import { AUTO_SNAPSHOT_EVERY, MAX_SUPPRESSION_ENTRIES, requireUserId, takeSnapshot } from "./assistant";
import { peopleById, resolvePersonName } from "./people";
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

/**
 * How much each signal is worth (§5.3).
 *
 * The numbers are the specification. `snoozed` has no entry and there is no
 * `null` case: snooze is not a label, and encoding it as one would be the whole
 * bug. Absence has no entry either, for the same reason (ADR-004).
 */
const SIGNAL_WEIGHT = {
  acted: 1.0,
  rejected: 1.0,
  dismissed: 0.25,
} as const;

type Signal = keyof typeof SIGNAL_WEIGHT;

type AnyCtx = GenericQueryCtx<DataModel> | GenericMutationCtx<DataModel>;

/** Every feedback row for the caller. */
async function loadFeedback(ctx: AnyCtx, userId: Id<"users">): Promise<StateRow[]> {
  return await ctx.db
    .query("attentionState")
    .withIndex("by_owner", (q) => q.eq("ownerUserId", userId))
    .take(READ_LIMITS.ATTENTION_FEEDBACK);
}

/** Per-user feature switches. One read, cached for the life of the query. */
async function loadFlags(ctx: AnyCtx, userId: Id<"users">) {
  // Closed vocabulary: three known keys, upserted. See readLimits.ts.
  const rows = await ctx.db
    .query("featureFlags")
    .withIndex("by_owner", (q) => q.eq("ownerUserId", userId))
    .collect();
  const set = new Map(rows.map((r) => [r.key, r.enabled] as const));
  return {
    generalisedRanking: set.get("generalisedRanking") ?? true,
    exploration: set.get("exploration") ?? true,
    attentionGrouping: set.get("attentionGrouping") ?? true,
  };
}

/** The caller's learned model, in the shape the ranker wants. */
async function loadModelState(ctx: AnyCtx, userId: Id<"users">) {
  const row = await ctx.db
    .query("assistantState")
    .withIndex("by_owner", (q) => q.eq("ownerUserId", userId))
    .unique();

  const empty = emptyBehaviour();
  return {
    weights: row?.weights ?? initialWeights(),
    samples: row?.samples ?? 0,
    learningPaused: row?.learningPaused === true,
    behaviour: {
      byHour: row?.byHour ?? empty.byHour,
      byWeekday: row?.byWeekday ?? empty.byWeekday,
      byTag: row?.byTag ?? {},
      shortDone: row?.shortDone ?? 0,
      shortTotal: row?.shortTotal ?? 0,
      longDone: row?.longDone ?? 0,
      longTotal: row?.longTotal ?? 0,
      byArea: row?.byArea ?? {},
      bySource: row?.bySource ?? {},
      byPerson: row?.byPerson ?? {},
      byDueBucket: row?.byDueBucket ?? {},
    },
    suppressedKinds: row?.suppressedKinds ?? [],
    suppressedAreas: row?.suppressedAreas ?? [],
  };
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

    // The space comes first: the calendar read is scoped by it, and a user with
    // no space yet has no events to suppress.
    const space = await ctx.db
      .query("spaces")
      .withIndex("by_createdBy", (q) => q.eq("createdBy", userId))
      .first();

    const [tasks, areas, connections, gathered, profile, feedback, events] = await Promise.all([
      // Open work only, newest-first, capped. Previously this collected every
      // task the user had ever created — including every finished one — on the
      // single most heavily subscribed query in the product. The feed scores
      // open work, so the finished rows contributed nothing but cost.
      ctx.db
        .query("tasks")
        .withIndex("by_owner_open", (q) => q.eq("ownerUserId", userId).eq("completed", false))
        .order("desc")
        .take(READ_LIMITS.ATTENTION_TASKS),
      // Closed vocabulary: at most one row per area-catalogue slug. See
      // CLOSED_VOCABULARY_READS in src/lib/readLimits.ts — bounded by the
      // catalogue, not by anything the user can do, so it is not capped.
      ctx.db
        .query("areas")
        .withIndex("by_owner", (q) => q.eq("ownerUserId", userId))
        .collect(),
      ctx.db
        .query("connections")
        .withIndex("by_owner", (q) => q.eq("ownerUserId", userId))
        .take(READ_LIMITS.CONNECTIONS),
      ctx.db
        .query("taxDocuments")
        .withIndex("by_owner", (q) => q.eq("ownerUserId", userId))
        .take(READ_LIMITS.DOCUMENTS),
      ctx.db
        .query("taxProfile")
        .withIndex("by_owner", (q) => q.eq("ownerUserId", userId))
        .unique()
        .catch(() => null),
      loadFeedback(ctx, userId),
      space
        ? ctx.db
            .query("calendarEvents")
            .withIndex("by_space_startsAt", (q) =>
              q
                .eq("spaceId", space._id)
                .gte("startsAt", now)
                .lte("startsAt", now + READ_LIMITS.ATTENTION_CALENDAR_DAYS * DAY_MS),
            )
            .take(READ_LIMITS.ATTENTION_CALENDAR_EVENTS)
        : Promise.resolve([]),
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
      createdAt: t.createdAt,
      source: t.origin,
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

    // --- life-admin documents (phase 3, feature 3) --------------------------
    //
    // Read through `by_owner_expiry`, whose range holds **only documents that
    // have an expiry** — Convex omits a row from an index when the indexed
    // field is absent. An undated document can never be attention, so this
    // query never reads one: the set the rule needs is exactly the set the
    // index returns, and there is no JavaScript filtering in between.
    //
    // The renewal task is then resolved per document through `by_owner_document`,
    // an index range holding only tasks that are renewals. The lifecycle state
    // is computed by `src/lib/documents.ts` and arrives as a *decision*, so the
    // rule and the Life Admin surface cannot disagree about it.
    const expiringDocs = await ctx.db
      .query("documents")
      .withIndex("by_owner_expiry", (q) => q.eq("ownerUserId", userId))
      .take(READ_LIMITS.DOCUMENTS);

    // Every renewal task the user owns, in **one** indexed read. Querying per
    // document would be an N+1 on the hottest query in the product, and this
    // query runs reactively on every Attention load. The range holds only tasks
    // carrying a `documentId`, so it is already narrow.
    const renewalRows = await ctx.db
      .query("tasks")
      .withIndex("by_owner_document", (q) => q.eq("ownerUserId", userId))
      .take(READ_LIMITS.ASSOCIATED_TASKS);
    const renewalsByDoc = new Map<string, typeof renewalRows>();
    for (const row of renewalRows) {
      const key = String(row.documentId);
      const bucket = renewalsByDoc.get(key);
      if (bucket) bucket.push(row);
      else renewalsByDoc.set(key, [row]);
    }

    const expiryViews: ExpiryView[] = [];
    for (const doc of expiringDocs) {
      const state = describeDocument(
        doc,
        renewalRef(pickRenewal(renewalsByDoc.get(String(doc._id)) ?? [])),
        now,
      );
      if (!state.attention) continue;
      expiryViews.push({
        id: doc._id,
        label: doc.label,
        attention: true,
        severity: state.severity,
        deadlineAt: state.deadlineAt,
        expiresAt: doc.expiresAt ?? null,
        detail: state.detail,
      });
    }

    // --- commitments + waits (phase 3, feature 4) ---------------------------
    //
    // **Two extra indexed reads, not one per commitment.** The `by_owner_open`
    // range holds exactly `{completed: false, expectedAt <= now}` — and since
    // Convex drops a document from an index when an indexed field is absent, an
    // undated commitment is not in it either, and an undated one can never be
    // overdue. The database does the filtering; there is no collect-everything
    // and discard.
    //
    // The second read is the caller's people, so the counterparty's name and the
    // tombstone chain resolve in memory. Resolving it inside the loop would be
    // D41 again: an N+1 on the single hottest query in the product, which every
    // subscribed dashboard re-runs on every write.
    //
    // **Follow-up tasks are deliberately not read here.** Nothing the attention
    // rule shows depends on whether a chase task exists — not the severity, not
    // the section, not the copy — so loading `by_owner_commitment` on every feed
    // load would be a third read bought for nothing. `listCommitments` reads
    // them for the surface that actually shows them.
    const [commitmentRows, people] = await Promise.all([
      ctx.db
        .query("commitments")
        .withIndex("by_owner_open", (q) =>
          q.eq("ownerUserId", userId).eq("completed", false).lte("expectedAt", now),
        )
        .take(READ_LIMITS.COMMITMENTS),
      peopleById(ctx, userId),
    ]);

    const commitmentViews: CommitmentAttentionView[] = [];
    for (const row of commitmentRows) {
      // A dangling counterparty degrades to silence rather than to a broken
      // line: there is nobody to name, and a sentence without its subject is
      // worse than no sentence.
      const person = resolvePersonName(people, row.personId);
      if (!person) continue;
      const state = describeCommitment(row, person.name, null, now);
      if (!state.attention) continue;
      commitmentViews.push({
        id: row._id,
        title: row.title,
        direction: row.direction,
        personId: person._id,
        attention: true,
        severity: state.severity,
        section: state.section === "waitingOn" ? "waitingOn" : "people",
        expectedAt: row.expectedAt ?? null,
        detail: state.detail,
      });
    }

    /**
     * Meetings, unless the calendar is too old to trust.
     *
     * §7.2: past `staleSuppressHours` the connection is suppressed from
     * Attention entirely — not greyed out, *absent*. A week-old calendar is a
     * list of meetings that have already been moved, and interrupting someone
     * about one is worse than saying nothing. The banner threshold is lower and
     * is handled by `connectionRules`, which is where a "this may be out of
     * date" message belongs.
     *
     * Computed from the registry's own number rather than a local constant, so
     * the policy lives in one place: `IntegrationDef.staleSuppressHours`.
     */
    const calendarDef = allIntegrations().find((d) => d.slug === "google-calendar");
    const suppressed = calendarSuppressed(connectionViews, calendarDef?.staleSuppressHours ?? 168, now);

    const calendarViews: CalendarView[] = suppressed
      ? []
      : events.map((e) => ({
          _id: e._id,
          title: e.title,
          startsAt: e.startsAt ?? null,
          endsAt: e.endsAt ?? null,
          allDay: e.allDay === true,
          cancelled: e.cancelled === true,
        }));

    const ruleInput = {
      tasks: taskViews,
      deadlines: deadlineViews,
      connections: connectionViews,
      documents: documentViews,
      expiring: expiryViews,
      commitments: commitmentViews,
      calendar: calendarViews,
      enabledAreas: areas.map((a) => a.slug),
      taxYearLabel: country.taxYearLabel(taxYear),
    };

    // The two producers run side by side and never see each other. §5.6: the
    // hard half is deterministic and immune to learning; the ranked half is
    // ordinary open work that the model gets to order. Concatenating them is the
    // only place the two classes meet, and the pipeline treats them differently
    // on every subsequent step.
    const state = await loadModelState(ctx, userId);
    const flags = await loadFlags(ctx, userId);

    // The `generalisedRanking` flag is a real switch, not a label. Turning it
    // off does not hide ordinary work — it stops the *model* from ordering it,
    // by feeding the ranker zero evidence so it reproduces the deterministic
    // prior exactly. A user who does not want a model steering their day still
    // gets their day, just not personalised.
    const useLearned = flags.generalisedRanking;
    const candidates = [
      ...hardRules(ruleInput, now),
      ...learnedCandidates(
        {
          tasks: taskViews,
          enabledAreas: ruleInput.enabledAreas,
          weights: state.weights,
          behaviour: state.behaviour,
          samples: useLearned ? state.samples : 0,
        },
        now,
      ),
    ];

    const result = buildAttention(candidates, feedback as AttentionFeedback[], now, {
      suppress: { kinds: state.suppressedKinds, areas: state.suppressedAreas },
    });

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
      // Whether the model is actually steering anything. Shown rather than
      // hidden: a ranking the user cannot audit is a ranking they cannot correct.
      learning: {
        active: useLearned && shouldRank(state.samples),
        samples: state.samples,
        paused: state.learningPaused,
        enabled: useLearned,
        suppressedKinds: state.suppressedKinds,
        suppressedAreas: state.suppressedAreas,
      },
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

/**
 * Trains on one piece of feedback, or deliberately does not.
 *
 * This is the only place a weight moves in response to attention feedback, and
 * most of its lines are refusals. Each refusal corresponds to a decision the
 * specification makes:
 *
 *  - a **hard-rule** item is never trained on. It was never scored, so scoring
 *    it now would teach the model about something it has no opinion on, and
 *    worse, it would let repeated action on a tax deadline pull other work down.
 *  - a **paused** model moves nothing at all.
 *  - a **dismissal** on a cold model is recorded but not trained, below
 *    `MIN_SAMPLES_TO_TRAIN_DISMISSAL`.
 *  - **snooze is not a signal.** There is no branch for it, and adding one
 *    would be the single most damaging change anyone could make to this file.
 *
 * `signals` describes the item in the shape `extractFeatures` understands. For a
 * hard item the caller is trusted only enough that a wrong description cannot
 * leak data or hide a deadline — the worst outcome of a wrong `kind` is that the
 * user's own model is trained slightly wrongly, which `resetModel` exists for.
 */
async function trainOn(
  ctx: GenericMutationCtx<DataModel>,
  userId: Id<"users">,
  signal: Signal,
  kind: string,
  subject: { priority: number; dueAt: number | null; tags: string[]; area?: string; source?: string; person?: string },
): Promise<void> {
  if (isHardKind(kind)) return;

  const state = await loadModelState(ctx, userId);
  if (state.learningPaused) return;
  if (signal === "dismissed" && !shouldTrainDismissal(state.samples)) return;

  const x = extractFeatures(
    {
      priority: subject.priority as 0 | 1 | 2,
      dueAt: subject.dueAt,
      createdAt: Date.now(),
      tags: subject.tags,
      area: subject.area,
      source: subject.source,
      person: subject.person,
    },
    state.behaviour,
    new Date(),
  );

  const weights = trainOne(
    state.weights,
    x,
    signal === "acted" ? 1 : 0,
    SIGNAL_WEIGHT[signal] * learningRateFor(state.samples),
  );

  const row = await ctx.db
    .query("assistantState")
    .withIndex("by_owner", (q) => q.eq("ownerUserId", userId))
    .unique();
  const spaceId = row?.spaceId ?? (await ensurePersonalSpace(ctx, userId));
  const samples = state.samples + 1;

  const base = {
    weights,
    weightsVersion: row?.weightsVersion ?? 1,
    modelVersion: row?.modelVersion ?? 0,
    byHour: state.behaviour.byHour,
    byWeekday: state.behaviour.byWeekday,
    byTag: state.behaviour.byTag,
    byArea: state.behaviour.byArea,
    bySource: state.behaviour.bySource,
    byPerson: state.behaviour.byPerson,
    byDueBucket: state.behaviour.byDueBucket,
    suppressedKinds: state.suppressedKinds,
    suppressedAreas: state.suppressedAreas,
    shortDone: state.behaviour.shortDone,
    shortTotal: state.behaviour.shortTotal,
    longDone: state.behaviour.longDone,
    longTotal: state.behaviour.longTotal,
    samples,
    updatedAt: Date.now(),
  };

  // Read-then-insert under Convex's transactional OCC, exactly as
  // `recordOutcome` does. Same guarantee, same reasoning — ADR-022.
  if (row) {
    await ctx.db.patch(row._id, base);
    if (samples % AUTO_SNAPSHOT_EVERY === 0) {
      await takeSnapshot(ctx, { ...row, ...base }, "automatic");
    }
  } else {
    await ctx.db.insert("assistantState", { ownerUserId: userId, spaceId, ...base });
  }
}

/** The user did the thing. The strongest positive signal Panel has. */
export const attentionActed = mutation({
  args: {
    fingerprint: v.string(),
    objectId: v.string(),
    escalation: v.optional(v.number()),
    kind: v.string(),
    priority: v.optional(v.number()),
    dueAt: v.optional(v.nullable(v.number())),
    tags: v.optional(v.array(v.string())),
    area: v.optional(v.string()),
    origin: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    await trainOn(ctx, userId, "acted", args.kind, {
      priority: args.priority ?? 1,
      dueAt: args.dueAt ?? null,
      tags: args.tags ?? [],
      area: args.area,
      source: args.origin,
    });
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
  args: {
    fingerprint: v.string(),
    objectId: v.string(),
    escalation: v.number(),
    kind: v.string(),
    priority: v.optional(v.number()),
    dueAt: v.optional(v.nullable(v.number())),
    tags: v.optional(v.array(v.string())),
    area: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    if (args.escalation >= 2) {
      throw new Error("This one cannot be dismissed — deal with it or snooze it until later.");
    }
    // A weak negative, and on a cold model nothing at all. `trainOn` decides.
    await trainOn(ctx, userId, "dismissed", args.kind, {
      priority: args.priority ?? 1,
      dueAt: args.dueAt ?? null,
      tags: args.tags ?? [],
      area: args.area,
    });
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
 *
 * **No call to `trainOn`.** Snooze is a timing signal and nothing else
 * (ADR-005). There is deliberately no label, no weight and no counter here: the
 * user said "not now", and reading that as "not for me" is how a model learns
 * to hide the things you keep postponing.
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
  args: {
    fingerprint: v.string(),
    objectId: v.string(),
    /** Needed to write the category set. Ignored for hard-rule items. */
    kind: v.string(),
    area: v.optional(v.string()),
    priority: v.optional(v.number()),
    dueAt: v.optional(v.nullable(v.number())),
    tags: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    await trainOn(ctx, userId, "rejected", args.kind, {
      priority: args.priority ?? 1,
      dueAt: args.dueAt ?? null,
      tags: args.tags ?? [],
      area: args.area,
    });
    await writeSuppression(ctx, userId, args.kind, args.area);
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

/**
 * Writes an explicit "not for me" category preference (RJD-006, §5.5.5).
 *
 * Two rules are enforced here rather than in the pipeline, because the pipeline
 * only sees the finished list:
 *
 *  1. **Hard-rule items never enter the set.** A statutory deadline is not a
 *     category the user has an opinion about; if "deadline.tax" could be
 *     suppressed, rejecting one deadline once would hide every deadline the
 *     user has for the next decade. `isHardKind` refuses before anything is
 *     written.
 *  2. **The set is bounded.** Oldest entries fall off the end.
 */
async function writeSuppression(
  ctx: GenericMutationCtx<DataModel>,
  userId: Id<"users">,
  kind: string,
  area: string | undefined,
): Promise<void> {
  if (isHardKind(kind)) return;
  if (!area) return;

  const row = await ctx.db
    .query("assistantState")
    .withIndex("by_owner", (q) => q.eq("ownerUserId", userId))
    .unique();
  if (!row) return; // nothing to attach it to; `trainOn` creates the row first

  const kinds = [...(row.suppressedKinds ?? []), kind].slice(-MAX_SUPPRESSION_ENTRIES);
  const areas = [...(row.suppressedAreas ?? []), area].slice(-MAX_SUPPRESSION_ENTRIES);
  await ctx.db.patch(row._id, { suppressedKinds: kinds, suppressedAreas: areas, updatedAt: Date.now() });
}

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

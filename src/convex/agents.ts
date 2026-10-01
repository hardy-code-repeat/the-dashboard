/**
 * Deterministic agents — the runner (phase 3, feature 6, ADR-030).
 *
 * ## The shape of the whole thing
 *
 * ```
 * Convex cron  →  bounded runner  →  pure agent  →  idempotency
 *             →  proposal only   →  activity      →  run record
 * ```
 *
 * The only scheduling mechanism is Convex's own cron, declared in
 * `convex.config.ts`. There is no external scheduler, no queue, no worker and
 * no second backend, and there does not need to be one — the work is a bounded
 * read and a handful of writes.
 *
 * ## The scheduler answers "when", never "what"
 *
 * A cron invocation carries no user and no authority. It cannot widen what an
 * agent may do, because the tier is decided by a **return type** in
 * `src/lib/agents.ts` and this file has no branch that could promote one. The
 * strongest statement in the codebase about that is not in this file at all: it
 * is that {@link AgentAction} is a closed union containing no operation that
 * can write a financial row, so an agent that tried would not compile.
 *
 * ## Bounded, and bounded *underneath*
 *
 * The rule the last four defects taught is that a bounded *result* is not
 * enough — the database access has to be bounded too. So:
 *
 * - spaces due are found by an **index range** (`by_nextAgentRunAt`, `lte`),
 *   `.take(SPACE_BATCH)`. Never "collect every space and filter", which is the
 *   one thing a scheduled job is uniquely able to get away with and uniquely
 *   wrong to do.
 * - a space is only ever in that range if someone opted in. **Absent means
 *   never**, structurally.
 * - expenses for the review come from the `by_owner_spentAt` range feature 5
 *   added, narrowed to the tax year.
 * - the daily-cap tally is a bounded read of the last 24h of that space's runs.
 *
 * ## Two gates, not one
 *
 * A space is enrolled by an explicit user action **and** gated on the
 * `debug_agents_v1` feature flag. The runner re-checks the flag on every run,
 * so switching it off stops agents immediately for everybody — the enrolment
 * is not a grant that outlives the flag. Both default to *inert*: nothing in
 * this product acts on a schedule until a person has asked it to.
 */

import type { GenericMutationCtx, GenericQueryCtx } from "convex/server";
import { v } from "convex/values";

import {
  agentKey,
  applyCaps,
  dayBucket,
  financeReviewAgent,
  MAX_EXECUTIONS_PER_RUN,
  MAX_EXECUTIONS_PER_SPACE_PER_DAY,
  REGISTERED_AGENTS,
  traceAgent,
  usedExecutionsToday,
  type FinanceReviewInput,
} from "../lib/agents";

import { getAuthUserId } from "@convex-dev/auth/server";
import { filingYearFor } from "../lib/tax";
import { requireUserId } from "./assistant";
import type { DataModel, Id } from "./_generated/dataModel";
import { internalMutation, mutation, query } from "./_generated/server";
import { ensurePersonalSpace } from "./spaces";

/**
 * How many due spaces one cron invocation will process.
 *
 * A fixed ceiling, and the arithmetic is stated rather than hoped for: at one
 * invocation a day this covers 200 spaces. A backlog does not starve — the
 * runner only advances what it processed, so everything still in the past
 * stays at the head of the range until there is room.
 */
const SPACE_BATCH = 200;

/** Expenses read per space for the review. A cap on the *read*, not a filter after it. */
const MAX_EXPENSES = 2000;

/** Run rows read when tallying the daily cap. */
const MAX_RUN_HISTORY = 200;

/** How far ahead a freshly-enrolled space is scheduled. */
const FIRST_RUN_DELAY_MS = 60_000;

/**
 * A query may be called signed out, so it asks who is calling and refuses if
 * the answer is nobody. A query that fell back to "no user" and then read a
 * broader set than it meant to is precisely the failure this product is built
 * to make impossible.
 */
async function requireQueryUserId(ctx: GenericQueryCtx<DataModel>): Promise<Id<"users">> {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("Not signed in");
  return userId;
}

/**
 * The caller's personal space, found by reading rather than by
 * `ensurePersonalSpace` — which **creates** one, and a query must never write.
 *
 * An indexed lookup on the creator. `by_createdBy` already scopes to spaces
 * this user **created**, and the personal space is the one
 * `ensurePersonalSpace` created for them — a family or work space this user is
 * a *member* of has a different creator. So `first()` is the personal space,
 * with no JavaScript filter over the result.
 *
 * **Returns null rather than throwing** for an account that has never opened
 * the product. A surface that errors for a brand-new user is a surface whose
 * first impression is a stack trace, and "you have no proposals" is the true
 * answer. Found by the harness calling this as a second, empty account.
 */
async function personalSpaceId(
  ctx: GenericQueryCtx<DataModel>,
  userId: Id<"users">,
): Promise<Id<"spaces"> | null> {
  const space = await ctx.db
    .query("spaces")
    .withIndex("by_createdBy", (q) => q.eq("createdBy", userId))
    .first();
  return space?._id ?? null;
}

/** Evidence pairs kept on a proposal. Bounded so a proposal cannot become a dump. */
const MAX_EVIDENCE = 6;

// ---------------------------------------------------------------------------
// Feature flag
// ---------------------------------------------------------------------------

/**
 * The `debug_agents_v1` flag, read from the space's owner.
 *
 * `by_owner_key` is a point lookup. Checked at **enrolment and again on every
 * run**, because a flag that is only read when the feature is switched on
 * cannot switch it off.
 */
async function agentsEnabled(
  ctx: GenericQueryCtx<DataModel> | GenericMutationCtx<DataModel>,
  ownerUserId: Id<"users">,
): Promise<boolean> {
  const flag = await ctx.db
    .query("featureFlags")
    .withIndex("by_owner_key", (q) =>
      q.eq("ownerUserId", ownerUserId).eq("key", "debug_agents_v1"),
    )
    .unique()
    .catch(() => null);
  return flag?.enabled === true;
}

// ---------------------------------------------------------------------------
// Enrolment
// ---------------------------------------------------------------------------

/**
 * Opts this user's personal space into scheduled runs.
 *
 * An explicit mutation, because a process that runs with nobody watching should
 * only exist for someone who asked for it. It also requires the feature flag,
 * so the product has two independent off switches rather than one.
 */
export const enableAgents = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const spaceId = await ensurePersonalSpace(ctx, userId);
    if (!(await agentsEnabled(ctx, userId))) {
      throw new Error("Scheduled agents are not enabled for this account");
    }
    const space = await ctx.db.get(spaceId);
    if (!space) throw new Error("Space not found");
    await ctx.db.patch(spaceId, { nextAgentRunAt: Date.now() + FIRST_RUN_DELAY_MS });
    return { enrolled: true };
  },
});

/**
 * Stops scheduled runs. Clearing the column is the whole of it: Convex drops a
 * document from an index when an indexed field is absent, so the space leaves
 * the range immediately and no future invocation can find it.
 */
export const disableAgents = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const spaceId = await ensurePersonalSpace(ctx, userId);
    await ctx.db.patch(spaceId, { nextAgentRunAt: undefined });
    return { enrolled: false };
  },
});

/** Whether the caller is enrolled. Read, so it is owner-scoped like everything. */
export const getAgentStatus = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireQueryUserId(ctx);
    const spaceId = await personalSpaceId(ctx, userId);
    const space = spaceId ? await ctx.db.get(spaceId) : null;
    const enrolled = typeof space?.nextAgentRunAt === "number";
    return {
      enrolled,
      nextAgentRunAt: space?.nextAgentRunAt ?? null,
      enabledByFlag: await agentsEnabled(ctx, userId),
      agents: [...REGISTERED_AGENTS],
      maxPerRun: MAX_EXECUTIONS_PER_RUN,
      maxPerDay: MAX_EXECUTIONS_PER_SPACE_PER_DAY,
    };
  },
});

// ---------------------------------------------------------------------------
// The runner
// ---------------------------------------------------------------------------

/**
 * The cron entry point.
 *
 * One indexed range, one bounded batch, one internal mutation per space. It
 * never throws for a single bad space: a failure is recorded against that
 * space and the rest of the batch continues, because a run that aborts on the
 * first error is a run that starves everyone behind the failure.
 */
export const internalRunDueSpaces = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();

    const due = await ctx.db
      .query("spaces")
      .withIndex("by_nextAgentRunAt", (q) => q.lte("nextAgentRunAt", now))
      .take(SPACE_BATCH);

    let ran = 0;
    for (const space of due) {
      // A space with no `createdBy`-owner flag is skipped and **left in the
      // range**, so switching the flag on later picks it straight back up
      // rather than silently losing the enrolment.
      if (!(await agentsEnabled(ctx, space.createdBy))) continue;

      try {
        await runSpace(ctx, space._id, space.createdBy, now);
        ran += 1;
      } catch (e) {
        await recordRun(ctx, {
          spaceId: space._id,
          at: now,
          result: "failed",
          error: sanitise(e),
        });
      }

      // Advance only after the attempt, so a failure is retried rather than
      // skipped. This is the whole anti-retry-storm mechanism: there is no
      // backoff queue, no exponential retry loop, and no second attempt within
      // a run.
      await ctx.db.patch(space._id, { nextAgentRunAt: now + 86_400_000 });
    }

    return { considered: due.length, ran };
  },
});

/** One space, one day, one pass over the registry. */
async function runSpace(
  ctx: GenericMutationCtx<DataModel>,
  spaceId: Id<"spaces">,
  ownerUserId: Id<"users">,
  now: number,
): Promise<void> {
  const started = Date.now();

  // The daily cap is a tally over this space's own runs, read through the
  // space+time index and bounded.
  const recent = await ctx.db
    .query("agentRuns")
    .withIndex("by_space_at", (q) =>
      q.eq("spaceId", spaceId).gte("at", now - 86_400_000).lte("at", now),
    )
    .take(MAX_RUN_HISTORY);
  const usedToday = usedExecutionsToday(
    recent.map((r) => ({ at: r.at, executions: r.executions ?? 0 })),
    now,
  );

  const input = await buildFinanceInput(ctx, spaceId, ownerUserId, now);
  const result = input ? financeReviewAgent(input, now) : null;
  // `finreview` is declared as returning the narrow `{ tier: "proposed" }`,
  // so the compiler proves that "could this be automatic?" is not a question
  // this runner has to ask. The two dead branches that used to be here were a
  // habit, not a safety property — and a branch that cannot be true is a
  // branch nobody tests.
  const proposed = result?.proposals.length ?? 0;

  const cap = applyCaps({ proposed, usedToday });
  const trace = input
    ? traceAgent(
        "finreview",
        spaceId,
        dayBucket(now),
        `${input.taxYear} · ${input.expenses.length} expense(s)`,
        result ?? { tier: "proposed", proposals: [] },
        cap.overflow,
      )
    : null;

  let written = 0;
  if (input && result && cap.allowed > 0) {
    written = await recordProposals(ctx, {
      spaceId,
      ownerUserId,
      agent: "finreview",
      proposals: result.proposals,
      now,
    });
  }

  const durationMs = Date.now() - started;
  const outcome = !input
    ? "skipped"
    : cap.overflow > 0 && written === 0
      ? "capped"
      : written > 0
        ? "ok"
        : "skipped";

  await recordRun(ctx, {
    spaceId,
    agent: "finreview",
    key: input ? agentKey("finreview", spaceId, String(input.taxYear)) : undefined,
    at: now,
    durationMs,
    result: outcome,
    executions: Math.min(cap.allowed, proposed),
    proposals: written,
    skipped: trace?.skipped ? 1 : 0,
    overflow: cap.overflow,
  });
}

/**
 * Reads the space's tax profile and its deductible expenses for the year.
 *
 * `null` means there is no profile yet, which is a legitimate state — a user
 * who has never opened Finance has nothing to review, and that is "skipped",
 * not an error.
 */
async function buildFinanceInput(
  ctx: GenericMutationCtx<DataModel>,
  spaceId: Id<"spaces">,
  ownerUserId: Id<"users">,
  now: number,
): Promise<FinanceReviewInput | null> {
  const profile = await ctx.db
    .query("taxProfile")
    .withIndex("by_owner", (q) => q.eq("ownerUserId", ownerUserId))
    .unique()
    .catch(() => null);
  if (!profile) return null;

  const taxYear = profile.taxYear ?? filingYearFor(new Date(now));
  const yearStart = new Date(taxYear, 0, 1).getTime();
  const yearEnd = new Date(taxYear + 1, 0, 1).getTime() - 1;

  const expenses = await ctx.db
    .query("expenses")
    .withIndex("by_owner_spentAt", (q) =>
      q
        .eq("ownerUserId", ownerUserId)
        .gte("spentAt", yearStart)
        .lte("spentAt", yearEnd),
    )
    .take(MAX_EXPENSES);

  return {
    spaceId,
    taxYear,
    country: profile.country,
    grossIncome: profile.grossIncome,
    businessMiles: profile.businessMiles ?? 0,
    charitableMiles: profile.charitableMiles ?? 0,
    homeOfficeSqFt: profile.homeOfficeSqFt ?? 0,
    donations: profile.donations ?? 0,
    expenses: expenses.map((e) => ({
      label: e.label,
      amount: e.amount,
      deductible: e.deductible,
      bucket: e.bucket,
      confidence: e.confidence,
    })),
  };
}

/**
 * Writes proposals that are not already recorded.
 *
 * **The idempotency check is a point lookup**, not a filter: `by_space_key` on
 * the deterministic key. Re-running the same agent against unchanged input
 * finds the row and writes nothing — not a second proposal, not a second
 * activity row, not a second notification (Do-Not-Touch #9).
 */
async function recordProposals(
  ctx: GenericMutationCtx<DataModel>,
  args: {
    spaceId: Id<"spaces">;
    ownerUserId: Id<"users">;
    agent: string;
    proposals: { key: string; title: string; detail: string; evidence?: { label: string; value: string }[] }[];
    now: number;
  },
): Promise<number> {
  let written = 0;
  for (const p of args.proposals) {
    const existing = await ctx.db
      .query("agentProposals")
      .withIndex("by_space_key", (q) => q.eq("spaceId", args.spaceId).eq("key", p.key))
      .unique();

    // Already recorded: leave it alone. Re-resolving an accepted proposal
    // would re-open a decision the user has already made, which is the worst
    // thing a scheduled process can do to someone's trust.
    if (existing) continue;

    const id = await ctx.db.insert("agentProposals", {
      spaceId: args.spaceId,
      ownerUserId: args.ownerUserId,
      key: p.key,
      agent: args.agent,
      title: p.title,
      detail: p.detail,
      evidence: (p.evidence ?? []).slice(0, MAX_EVIDENCE),
      at: args.now,
      status: "open",
    });

    await ctx.db.insert("activity", {
      spaceId: args.spaceId,
      actor: "agent",
      kind: "agent.proposed",
      objectKind: "agentProposal",
      objectId: id,
      at: args.now,
    });

    written += 1;
  }
  return written;
}

async function recordRun(
  ctx: GenericMutationCtx<DataModel>,
  args: {
    spaceId: Id<"spaces">;
    agent?: string;
    key?: string;
    at: number;
    durationMs?: number;
    result: string;
    executions?: number;
    proposals?: number;
    skipped?: number;
    overflow?: number;
    error?: string;
  },
): Promise<void> {
  await ctx.db.insert("agentRuns", args);
}

/**
 * A failure message, and nothing else.
 *
 * No stack, no argument values, no path. An agent failure is a fact about the
 * agent, and the arguments could contain a label or an amount.
 */
function sanitise(e: unknown): string {
  const text = e instanceof Error ? e.message : String(e);
  return text.slice(0, 200);
}

/**
 * Runs the agents for **the caller's own space, right now**.
 *
 * It calls the very same {@link runSpace} the scheduled path calls, so it is
 * not a parallel implementation that could drift from the one that matters —
 * it is the same function with a different front door. The daily schedule is
 * for users who never open the app; this is for someone who wants the answer
 * now.
 *
 * It is bounded to one space by construction: the space id comes from the
 * session, never from an argument. That is the reason a public "run now"
 * button is safe where a public "run for a space id" would not be.
 */
export const runMyAgentsNow = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const spaceId = await ensurePersonalSpace(ctx, userId);

    if (!(await agentsEnabled(ctx, userId))) {
      throw new Error("Scheduled agents are not enabled for this account");
    }
    if (!(await ctx.db.get(spaceId))) throw new Error("Space not found");

    const now = Date.now();
    await runSpace(ctx, spaceId, userId, now);
    // Advance the schedule so a manual run does not also leave the space due
    // for today's 07:00 — otherwise "check now" would produce a second,
    // identical proposal attempt an hour later.
    await ctx.db.patch(spaceId, { nextAgentRunAt: now + 86_400_000 });
    return { ran: true, at: now };
  },
});

/**
 * What the last run did, and what today's allowance is.
 *
 * §6.3 asks for a run that produced nothing to record **why**, so "why didn't
 * it act?" is answerable — and an answer nobody can read is not an answer. So
 * the counts are surfaced to the owner: the last result, the proposals, the
 * overflow, and the day's tally against both caps.
 *
 * **Overflow has to be observable, not merely stored.** The directive is
 * explicit: overflow is counted, observable and audited. Counted and audited
 * were free — they are columns on `agentRuns`. Observable is this query, and
 * without it a capped agent would hold work back forever in silence, which is
 * the failure mode a cap is supposed to prevent.
 *
 * **The failure message is the owner's own.** `sanitise` has already reduced
 * it to a 200-character message with no stack, no arguments and no path, and
 * this space belongs to the caller, so showing it says "Panel could not finish
 * its last check" instead of leaving the user to wonder.
 *
 * Two bounded index reads: one ordered seek for the newest run, one range for
 * today's tally. Null rather than throwing for an account with no space.
 */
export const getLastRun = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireQueryUserId(ctx);
    const spaceId = await personalSpaceId(ctx, userId);
    if (!spaceId) return null;

    const now = Date.now();
    const last = await ctx.db
      .query("agentRuns")
      .withIndex("by_space_at", (q) => q.eq("spaceId", spaceId))
      .order("desc")
      .first();

    const recent = await ctx.db
      .query("agentRuns")
      .withIndex("by_space_at", (q) => q.eq("spaceId", spaceId).gte("at", now - 86_400_000))
      .take(MAX_RUN_HISTORY);

    return {
      at: last?.at ?? null,
      agent: last?.agent ?? null,
      key: last?.key ?? null,
      result: last?.result ?? null,
      durationMs: last?.durationMs ?? null,
      executions: last?.executions ?? 0,
      proposals: last?.proposals ?? 0,
      skipped: last?.skipped ?? 0,
      overflow: last?.overflow ?? 0,
      error: last?.error ?? null,
      usedToday: usedExecutionsToday(
        recent.map((r) => ({ at: r.at, executions: r.executions ?? 0 })),
        now,
      ),
      maxPerRun: MAX_EXECUTIONS_PER_RUN,
      maxPerDay: MAX_EXECUTIONS_PER_SPACE_PER_DAY,
    };
  },
});

// ---------------------------------------------------------------------------
// The proposal surface
// ---------------------------------------------------------------------------

/**
 * The user's own proposals, newest first. Owner-scoped, bounded.
 *
 * Read through **`by_space_at`, not `by_owner` plus a JavaScript filter.**
 * The first version of this was a `by_owner` collect with
 * `.filter(r => r.spaceId === spaceId)` — which is D42 and D43's exact shape,
 * in the newest module in the codebase, written by someone who had just read
 * both of them. The space is already the caller's, because it came from
 * `by_createdBy` scoped to them, so the filter was not adding safety — only an
 * unbounded-in-principle read that could silently return fewer rows than the
 * cap implied.
 */
export const listProposals = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireQueryUserId(ctx);
    const spaceId = await personalSpaceId(ctx, userId);
    if (!spaceId) return [];
    const rows = await ctx.db
      .query("agentProposals")
      .withIndex("by_space_at", (q) => q.eq("spaceId", spaceId))
      .order("desc")
      .take(100);
    return rows.map((r) => ({
        id: r._id,
        key: r.key,
        agent: r.agent,
        title: r.title,
        detail: r.detail,
        evidence: r.evidence ?? [],
        at: r.at,
        status: r.status ?? "open",
      }));
  },
});

/**
 * The user accepts a proposal — meaning **"I have looked at this"**.
 *
 * It records the acknowledgement and stops there. It does **not** mark any
 * expense deductible, change a tax profile, or alter a single financial value:
 * the review is the agent noticing, and confirming each category stays an act
 * the user performs in the Expenses list, where they can see what they are
 * confirming. An "accept" button that silently rewrote a tax return would be
 * the exact failure this whole feature was scoped to avoid.
 */
export const acceptProposal = mutation({
  args: { id: v.id("agentProposals") },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const row = await ctx.db.get(args.id);
    if (!row || row.ownerUserId !== userId) throw new Error("Proposal not found");
    if (row.status === "accepted") return { accepted: true, already: true };
    await ctx.db.patch(row._id, { status: "accepted", resolvedAt: Date.now() });
    return { accepted: true, already: false };
  },
});

/** The user dismisses a proposal. Also records nothing about the money. */
export const dismissProposal = mutation({
  args: { id: v.id("agentProposals") },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const row = await ctx.db.get(args.id);
    if (!row || row.ownerUserId !== userId) throw new Error("Proposal not found");
    if (row.status === "dismissed") return { dismissed: true, already: true };
    await ctx.db.patch(row._id, { status: "dismissed", resolvedAt: Date.now() });
    return { dismissed: true, already: false };
  },
});

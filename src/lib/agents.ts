/**
 * Deterministic agents — the pure part (phase 3, feature 6).
 *
 * This is `src/lib`, so it is pure, takes its clock as an argument, and has no
 * Convex import (ADR-002).
 *
 * The one agent implemented here is `finreview`. The other five named in §6.1
 * are deliberately absent; the reason is at the foot of this file.
 *
 * ## The one thing this file is for
 *
 * **Making the tier unmissable.** ADR-011 says an agent returns a tier and
 * that risky actions can only be `confirm`. Written as a comment, that is a
 * convention — and conventions are exactly what Do-Not-Touch #10 is defending
 * against. Written as a return type, an agent that tries to pay somebody cannot
 * type-check, and no amount of carelessness at three in the morning gets past
 * the compiler.
 *
 * So an agent returns a discriminated union, and the `automatic` variant
 * carries **no write capability at all** — not "should not write", has none.
 * That is why this file exists.
 *
 * ## Nothing here runs
 *
 * There is no timer, no queue, no I/O and no clock read. `traceAgent` is pure
 * (ADR-011), and the caps are a function, not a throttle — the runner in
 * `src/convex/agents.ts` decides when to call this and is the only thing that
 * touches a database.
 *
 * ## Keys are readable, not hashed
 *
 * §6.1 specifies `sha256(...)` idempotency keys. This uses a **stable
 * composite string** instead, and the reason is auditability rather than
 * performance: a hash makes an operator unable to tell which run produced a row
 * without re-deriving it, so a failure report becomes an archaeology exercise.
 * A composite key like `finreview:sp123:2026-03` is equally deterministic,
 * equally collision-resistant for this purpose, and greppable. The property
 * Do-Not-Touch #9 asks for is determinism, and that is preserved exactly.
 */

import { estimateTax } from "./tax";

/** Milliseconds in a day. */
const DAY_MS = 86_400_000;

/**
 * Maximum agent **executions** in one run.
 *
 * §6.1. A cap on executions, not on proposals — a run that proposes fifty
 * things has still done one thing, and the thing that costs is deciding.
 */
export const MAX_EXECUTIONS_PER_RUN = 10;

/**
 * Maximum agent executions per space per day (§6.1).
 *
 * A second, independent limit, and deliberately not derived from the first: a
 * runner invoked on demand could otherwise be invoked 200 times and do 2000
 * executions, and "bounded" would mean nothing.
 */
export const MAX_EXECUTIONS_PER_SPACE_PER_DAY = 50;

/**
 * The three tiers (ADR-011).
 *
 * - `automatic` — may execute a **safe internal** operation without asking.
 * - `proposed`  — never executes. The user decides.
 * - `confirm`   — blocking. Never a toast, never a background run.
 */
export type AgentTier = "automatic" | "proposed" | "confirm";

/**
 * Something an agent wants the user to consider.
 *
 * A proposal is a **claim about evidence**, never an instruction and never a
 * verdict. `title` states the situation; `detail` must be falsifiable — every
 * number in it traceable to a row the user can open.
 */
export interface AgentProposal {
  /**
   * The deterministic idempotency key. Stable for the same input, so a second
   * run finds this proposal already recorded and does not duplicate it.
   */
  key: string;
  title: string;
  detail: string;
  /**
   * Bounded scalar evidence. Deliberately **not** a JSON blob (ADR-008) and
   * deliberately not the underlying rows: a proposal is a summary the user can
   * drill into from the product, not a copy of the data it came from.
   */
  evidence: { label: string; value: string }[];
}

/**
 * The return type. **The type is the safety property.**
 *
 * The `automatic` variant carries `actions: AgentAction[]`, and
 * {@link AgentAction} is a closed union of the *only* safe internal operations
 * Panel has. There is no variant that can insert an expense, patch a tax
 * profile, send anything to a provider, or touch a document — so an agent
 * cannot, even by writing a new one.
 */
export type AgentAction =
  /** Flag a row for the user to look at. Writes nothing that changes meaning. */
  | { kind: "flag" }
  /** Write an activity row. The audit trail itself. */
  | { kind: "log" };

export type AgentResult =
  | { tier: "automatic"; actions: AgentAction[] }
  | { tier: "proposed"; proposals: AgentProposal[] }
  | { tier: "confirm"; proposals: AgentProposal[] };

/**
 * The deterministic key. The one place a key is built.
 *
 * `bucket` is the period the agent's finding belongs to, not `now` — a key
 * built from the wall clock changes on every run, and a key that changes on
 * every run is not a key.
 */
export function agentKey(agent: string, spaceId: string, bucket: string): string {
  return `${agent}:${spaceId}:${bucket}`;
}

/** The period key for a day. UTC on purpose: a bucket must not drift by offset. */
export function dayBucket(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

/** The period key for a tax year. */
export function yearBucket(year: number): string {
  return String(year);
}

/** How many executions a space has already used today. */
export function usedExecutionsToday(runs: readonly { at: number; executions: number }[], now: number): number {
  const since = now - DAY_MS;
  return runs.reduce((n, r) => (r.at >= since ? n + r.executions : n), 0);
}

export interface CapInput {
  /** What the agent would do if nothing stopped it. */
  proposed: number;
  /** Executions already used by this space today. */
  usedToday: number;
  /** The cap the run is bounded by. Defaults to §6.1. */
  maxPerRun?: number;
  maxPerDay?: number;
}

export interface CapResult {
  /** What may actually execute. */
  allowed: number;
  /** How many were held back. Never silently dropped. */
  overflow: number;
  /** Which limit bound the run, or null when nothing did. */
  boundBy: "per_run" | "per_day" | null;
}

/**
 * The caps, as a pure function.
 *
 * Returns the overflow **count** rather than truncating, because §6.1 is
 * explicit that excess is dropped *with a count recorded* — never silently. A
 * cap that quietly discards work is a cap nobody can debug, and the count is
 * the only evidence that the limit was reached rather than the agent simply
 * having less to do.
 */
export function applyCaps(input: CapInput): CapResult {
  const maxPerRun = input.maxPerRun ?? MAX_EXECUTIONS_PER_RUN;
  const maxPerDay = input.maxPerDay ?? MAX_EXECUTIONS_PER_SPACE_PER_DAY;

  const roomToday = Math.max(0, maxPerDay - input.usedToday);
  const allowed = Math.max(0, Math.min(input.proposed, maxPerRun, roomToday));
  const overflow = Math.max(0, input.proposed - allowed);

  if (allowed >= input.proposed) return { allowed, overflow: 0, boundBy: null };
  if (roomToday <= allowed) return { allowed, overflow, boundBy: "per_day" };
  return { allowed, overflow, boundBy: "per_run" };
}

// ---------------------------------------------------------------------------
// Tracing — pure, and observability rather than a side effect
// ---------------------------------------------------------------------------

export interface TraceStep {
  step: string;
  detail: string;
}

export interface AgentTrace {
  agent: string;
  spaceId: string;
  /** The deterministic key this run is accounted under. */
  key: string;
  tier: AgentTier;
  steps: TraceStep[];
  proposals: number;
  /** True when the run produced nothing, and why. */
  skipped: boolean;
  skipReason: string | null;
}

/**
 * `traceAgent` — `Input → Decisions → Output → Action → Result`, pure.
 *
 * It takes the input and the result and describes the path between them. It
 * writes nothing, calls nothing, and cannot fail for a reason outside its
 * arguments. That is what makes it safe to run for every agent on every run
 * and still cheap enough to store the summary of.
 *
 * Note what it does **not** do: it is not a second effect mechanism. The
 * decision of what to *do* with a result belongs to the runner alone.
 */
export function traceAgent(
  agent: string,
  spaceId: string,
  bucket: string,
  input: string,
  result: AgentResult,
  overflow = 0,
): AgentTrace {
  const key = agentKey(agent, spaceId, bucket);
  const steps: TraceStep[] = [{ step: "input", detail: input }];

  const tier = result.tier;
  if (tier === "automatic") {
    steps.push({ step: "decide", detail: `${result.actions.length} safe action(s), tier automatic` });
    steps.push({ step: "action", detail: "internal only — no user data mutated" });
  } else {
    const n = result.proposals.length;
    steps.push({ step: "decide", detail: `${n} proposal(s), tier ${tier}` });
    steps.push({
      step: "action",
      detail: "none — a proposal never executes, whatever tier it is",
    });
  }

  const proposalCount = tier === "automatic" ? 0 : result.proposals.length;
  const skipped = tier === "automatic" ? result.actions.length === 0 : proposalCount === 0;

  return {
    agent,
    spaceId,
    key,
    tier,
    steps,
    proposals: proposalCount,
    skipped,
    // A run that did nothing must be able to say why. "Why didn't it act?" is a
    // question the product owes an answer to, and an empty trace is not one.
    skipReason: skipped ? (overflow > 0 ? "capped" : "no applicable input") : null,
  };
}

/** Format a money figure for a proposal, without inventing a currency symbol. */
export function formatMoney(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return (Math.round((n + Number.EPSILON) * 100) / 100).toFixed(2);
}

/** "£2,140.00" → "£2,140" for a headline, keeping cents out of the way. */
export function formatMoneyShort(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const rounded = Math.round((n + Number.EPSILON) * 100) / 100;
  return Number.isInteger(rounded)
    ? String(rounded)
    : rounded.toFixed(2);
}

// ---------------------------------------------------------------------------
// The first agent: low-confidence finance review
// ---------------------------------------------------------------------------

/**
 * The finding, before it is phrased. Kept separate from the copy so the
 * arithmetic can be tested without asserting on English.
 */
export interface FinanceReviewFinding {
  /** Total deduction resting on categories the user has never confirmed. */
  deductionAtRisk: number;
  /** Distinct buckets among those expenses. */
  uncheckedCount: number;
  uncheckedBuckets: string[];
  /**
   * How much the estimate would fall if none of them were deductible.
   *
   * Computed by running `estimateTax` twice — once as it stands and once with
   * the unconfirmed rows removed — and subtracting. **Not** a hand-rolled rate
   * applied to the total. A second tax arithmetic path is a second thing that
   * can disagree with the first, and this number is going on screen next to the
   * estimate it qualifies.
   */
  estimateSwing: number;
  /** The estimate as it stands, so the proposal can say "of X". */
  currentEstimate: number;
}

export interface FinanceReviewInput {
  spaceId: string;
  taxYear: number;
  country: "US" | "UK" | "IN" | "CA" | "AU";
  grossIncome: number;
  businessMiles: number;
  charitableMiles: number;
  homeOfficeSqFt: number;
  donations: number;
  expenses: {
    label: string;
    amount: number;
    deductible: boolean;
    bucket: string;
    confidence: "high" | "medium" | "low" | "confirmed";
  }[];
}

export interface FinanceReviewResult {
  key: string;
  finding: FinanceReviewFinding;
  proposals: AgentProposal[];
}

/**
 * The arithmetic, separated from the tier and the copy so it can be pinned on
 * its own. Returns null when there is nothing to say.
 */
export function reviewUnconfirmedDeductions(
  input: FinanceReviewInput,
): FinanceReviewFinding | null {
  const deductible = input.expenses.filter((e) => e.deductible);

  // "Unconfirmed" means the *user* has never asserted it, which is exactly
  // what `confirmed` records. A `high` keyword guess is still a guess — the
  // categoriser is a keyword table, and "high" means it recognised the word,
  // not that the answer is right.
  const unchecked = deductible.filter((e) => e.confidence !== "confirmed");
  if (unchecked.length === 0) return null;

  const base = {
    country: input.country,
    taxYear: input.taxYear,
    grossIncome: input.grossIncome,
    businessMiles: input.businessMiles,
    charitableMiles: input.charitableMiles,
    homeOfficeSqFt: input.homeOfficeSqFt,
    donations: input.donations,
  };

  const asItStands = estimateTax({
    ...base,
    expenses: deductible.map((e) => ({ label: e.label, amount: e.amount, deductible: true })),
  }).estimatedTax;

  const confirmedOnly = estimateTax({
    ...base,
    expenses: deductible
      .filter((e) => e.confidence === "confirmed")
      .map((e) => ({ label: e.label, amount: e.amount, deductible: true })),
  }).estimatedTax;

  const buckets = [...new Set(unchecked.map((e) => e.bucket))].sort();

  return {
    deductionAtRisk: unchecked.reduce((n, e) => n + e.amount, 0),
    uncheckedCount: unchecked.length,
    uncheckedBuckets: buckets,
    // Never negative: dropping expenses can only lower an estimate, and a
    // negative "swing" on screen would be a claim Panel cannot support.
    estimateSwing: Math.max(0, asItStands - confirmedOnly),
    currentEstimate: asItStands,
  };
}

/**
 * The agent. **`proposed` tier, and it cannot be anything else.**
 *
 * It reads, it adds up, and it says what the sum means. It does not write an
 * expense, mark anything deductible, change a tax profile, or touch anything
 * outside its own space. There is no parameter that would let it.
 *
 * The wording obeys one rule: **it never says a category is wrong.** It says
 * what is unconfirmed, and what the figure would be if the unconfirmed part
 * turned out not to count. The user is the only one who knows, and a scheduled
 * process that guessed wrong about a tax return is worse than one that said
 * nothing.
 *
 * The return type is the narrow `{ tier: "proposed" }` rather than
 * {@link AgentResult}, so "this agent may escalate" stops being a decision a
 * later edit can make by accident.
 */
export function financeReviewAgent(
  input: FinanceReviewInput,
  now: number,
): { tier: "proposed"; proposals: AgentProposal[] } {
  const finding = reviewUnconfirmedDeductions(input);
  if (!finding) {
    return { tier: "proposed", proposals: [] };
  }

  const key = agentKey("finreview", input.spaceId, yearBucket(input.taxYear));
  const buckets = finding.uncheckedBuckets.join(", ");

  const proposal: AgentProposal = {
    key,
    title: `${finding.uncheckedCount} categor${
      finding.uncheckedCount === 1 ? "y is" : "ies are"
    } holding ${formatMoneyShort(finding.deductionAtRisk)} of your deduction, unconfirmed`,
    detail:
      `Your estimate of ${formatMoneyShort(finding.currentEstimate)} includes ` +
      `${formatMoneyShort(finding.deductionAtRisk)} you have never confirmed as deductible, ` +
      `across ${finding.uncheckedCount} entr${finding.uncheckedCount === 1 ? "y" : "ies"} ` +
      `(${buckets}). If none of them turned out to be deductible, the estimate would fall by ` +
      `about ${formatMoneyShort(finding.estimateSwing)}. Panel is not saying they are wrong — ` +
      `only that nobody has checked.`,
    evidence: [
      { label: "Unconfirmed deduction", value: formatMoney(finding.deductionAtRisk) },
      { label: "Entries involved", value: String(finding.uncheckedCount) },
      { label: "Buckets", value: buckets },
      { label: "Estimate if none qualify", value: formatMoney(finding.currentEstimate - finding.estimateSwing) },
    ],
  };

  void now;
  return { tier: "proposed", proposals: [proposal] };
}

/** The agents this build is allowed to run, in order. One, deliberately. */
export const REGISTERED_AGENTS = ["finreview"] as const;
export type AgentName = (typeof REGISTERED_AGENTS)[number];

/*
 * ---------------------------------------------------------------------------
 * Why the other five are not here
 * ---------------------------------------------------------------------------
 * §6.1 names six agents. Five of them already have a producer, and adding a
 * second one for the same event is not a feature — it is two sources of truth
 * that have to be taught to suppress each other:
 *
 *   recurringRespawn   → assistant.spawnNextOccurrence (0A)
 *   documentExpiry     → the document.expiring hard rule (CHANGE-0015)
 *   commitmentOverdue  → commitment.overdue / .waiting (CHANGE-0016)
 *   applySync          → integrations.internalApplyBatch (ADR-012)
 *   recurringPayment   → needs accounts + transactions, which is Finance work
 *   relationshipReminder → needs a relationship model Panel does not have
 *
 * Feature 3's acceptance criteria already forbid the outcome: "one renewal, one
 * item". A second producer for "this is expiring" is exactly that violation,
 * and it would be a violation written in the name of following a spec.
 */

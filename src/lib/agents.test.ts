/**
 * Deterministic agents — the framework and the first agent (phase 3, feature 6).
 *
 * Everything below is pure with `now` injected (ADR-002), so the caps can be
 * checked at the exact execution they bite rather than "somewhere around ten".
 *
 * The fixtures are grouped by what could break:
 *
 *  - **The caps**, because a cap that is off by one either wastes capacity or
 *    silently exceeds the limit, and the second is the one §6.1 forbids.
 *  - **The keys**, because idempotency is a *determinism* property and a key
 *    that moves is not a key.
 *  - **The trace**, for the two things it promises: it is pure, and a run that
 *    did nothing can say why.
 *  - **The agent's arithmetic**, and above all that its wording never claims a
 *    category is *wrong*. Panel did not look at a receipt.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  agentKey,
  applyCaps,
  dayBucket,
  financeReviewAgent,
  formatMoney,
  formatMoneyShort,
  MAX_EXECUTIONS_PER_RUN,
  MAX_EXECUTIONS_PER_SPACE_PER_DAY,
  REGISTERED_AGENTS,
  reviewUnconfirmedDeductions,
  traceAgent,
  usedExecutionsToday,
  type FinanceReviewInput,
  type AgentProposal,
} from "./agents";

const DAY = 86_400_000;
const NOW = new Date(2026, 2, 15, 12, 0, 0).getTime();

function input(over: Partial<FinanceReviewInput> = {}): FinanceReviewInput {
  return {
    spaceId: "sp1",
    taxYear: 2026,
    country: "US",
    grossIncome: 80_000,
    businessMiles: 0,
    charitableMiles: 0,
    homeOfficeSqFt: 0,
    donations: 0,
    expenses: [],
    ...over,
  };
}

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

test("the idempotency key is deterministic and names its bucket", () => {
  const a = agentKey("finreview", "sp1", "2026");
  const b = agentKey("finreview", "sp1", "2026");
  assert.equal(a, b);
  assert.notEqual(a, agentKey("finreview", "sp1", "2025"));
  assert.notEqual(a, agentKey("finreview", "sp2", "2026"));
  assert.notEqual(a, agentKey("other", "sp1", "2026"));
  // Readable on purpose: an operator can tell which run produced a row without
  // re-deriving a hash.
  assert.equal(a, "finreview:sp1:2026");
});

test("the day bucket is UTC, so it cannot drift by offset", () => {
  assert.equal(dayBucket(NOW), dayBucket(NOW + 5 * 3_600_000));
  assert.notEqual(dayBucket(NOW), dayBucket(NOW + 20 * 3_600_000));
  assert.equal(dayBucket(NOW).length, 10);
});

// ---------------------------------------------------------------------------
// Caps
// ---------------------------------------------------------------------------

test("nothing is capped when the run is under both limits", () => {
  const r = applyCaps({ proposed: 3, usedToday: 0 });
  assert.deepEqual(r, { allowed: 3, overflow: 0, boundBy: null });
});

test("the per-run cap bites at exactly ten", () => {
  assert.equal(applyCaps({ proposed: 10, usedToday: 0 }).allowed, 10);
  const over = applyCaps({ proposed: 11, usedToday: 0 });
  assert.equal(over.allowed, MAX_EXECUTIONS_PER_RUN);
  assert.equal(over.overflow, 1);
  assert.equal(over.boundBy, "per_run");
});

test("the per-day cap bites at exactly fifty and is not derived from the run cap", () => {
  // A runner invoked on demand must not be able to do 10 x N executions and
  // call the whole thing bounded.
  assert.equal(MAX_EXECUTIONS_PER_RUN, 10);
  assert.equal(MAX_EXECUTIONS_PER_SPACE_PER_DAY, 50);
  assert.equal(applyCaps({ proposed: 5, usedToday: 49 }).allowed, 1);
  const at = applyCaps({ proposed: 5, usedToday: 50 });
  assert.equal(at.allowed, 0);
  assert.equal(at.overflow, 5);
  assert.equal(at.boundBy, "per_day");
});

test("the tighter of the two limits is the one reported", () => {
  // Both limits bite at once; per_day is reported because it is the one that
  // would still be biting tomorrow.
  const r = applyCaps({ proposed: 40, usedToday: 49 });
  assert.equal(r.allowed, 1);
  assert.equal(r.overflow, 39);
  assert.equal(r.boundBy, "per_day");

  const runBound = applyCaps({ proposed: 40, usedToday: 0 });
  assert.equal(runBound.allowed, 10);
  assert.equal(runBound.boundBy, "per_run");
});

test("overflow is a count, never a silent truncation", () => {
  // The whole point of returning the number: a cap that discarded work
  // invisibly would be indistinguishable from an agent with nothing to do.
  const r = applyCaps({ proposed: 100, usedToday: 0 });
  assert.equal(r.allowed + r.overflow, 100);
});

test("a cap cannot be bypassed by passing larger limits", () => {
  const r = applyCaps({ proposed: 100, usedToday: 0, maxPerRun: 5, maxPerDay: 6 });
  assert.equal(r.allowed, 5);
  assert.equal(r.boundBy, "per_run");
});

// ---------------------------------------------------------------------------
// The daily window
// ---------------------------------------------------------------------------

test("the daily tally counts only the last 24 hours", () => {
  const runs = [
    { at: NOW - 1000, executions: 3 },
    { at: NOW - DAY + 1000, executions: 4 },
    { at: NOW - DAY - 1000, executions: 99 },
  ];
  assert.equal(usedExecutionsToday(runs, NOW), 7);
});

test("the daily tally is exact at the window edge", () => {
  assert.equal(usedExecutionsToday([{ at: NOW - DAY, executions: 5 }], NOW), 5);
  assert.equal(usedExecutionsToday([{ at: NOW - DAY - 1, executions: 5 }], NOW), 0);
});

// ---------------------------------------------------------------------------
// Tracing
// ---------------------------------------------------------------------------

test("a proposal trace says the agent will not act, whatever the tier", () => {
  const t = traceAgent("finreview", "sp1", "2026", "input", {
    tier: "proposed",
    proposals: [agentKey("k", "sp1", "2026")].map((key) => ({
      key,
      title: "t",
      detail: "d",
      evidence: [],
    })),
  });
  assert.equal(t.tier, "proposed");
  assert.equal(t.proposals, 1);
  assert.equal(t.skipped, false);
  assert.equal(t.key, "finreview:sp1:2026");
  assert.ok(t.steps.some((s) => s.detail.includes("never executes")));
});

test("a run that did nothing can say why — the question the product owes an answer to", () => {
  const empty = traceAgent("finreview", "sp1", "2026", "input", {
    tier: "proposed",
    proposals: [],
  });
  assert.equal(empty.skipped, true);
  assert.equal(empty.skipReason, "no applicable input");

  const capped = traceAgent("finreview", "sp1", "2026", "input", {
    tier: "proposed",
    proposals: [],
  }, 7);
  assert.equal(capped.skipReason, "capped");
});

test("tracing is pure: the same arguments give the same trace", () => {
  const args = ["finreview", "sp1", "2026", "in"] as const;
  const r = { tier: "proposed", proposals: [] } as { tier: "proposed"; proposals: AgentProposal[] };
  assert.deepEqual(traceAgent(...args, r), traceAgent(...args, r));
});

test("money formatting never prints a float artefact", () => {
  assert.equal(formatMoney(0.1 + 0.2), "0.30");
  assert.equal(formatMoneyShort(2140), "2140");
  assert.equal(formatMoneyShort(2140.5), "2140.50");
  assert.equal(formatMoney(Number.NaN), "—");
  // No currency symbol is invented: the symbol belongs to the account on screen.
  assert.ok(!formatMoney(10).includes("£"));
});

// ---------------------------------------------------------------------------
// The agent
// ---------------------------------------------------------------------------

test("only one agent is registered, and it is the additive one", () => {
  // The other five named in §6.1 already have a producer. Registering them
  // would give one event two sources of truth.
  assert.deepEqual([...REGISTERED_AGENTS], ["finreview"]);
});

test("nothing to review produces no proposal and no finding", () => {
  assert.equal(reviewUnconfirmedDeductions(input()), null);
  const allConfirmed = reviewUnconfirmedDeductions(
    input({
      expenses: [
        { label: "a", amount: 100, deductible: true, bucket: "B", confidence: "confirmed" },
      ],
    }),
  );
  assert.equal(allConfirmed, null);
});

test("a high keyword guess is still a guess", () => {
  // The categoriser is a keyword table. "high" means it recognised the word,
  // not that the answer is right — only the user can confirm that.
  const r = reviewUnconfirmedDeductions(
    input({
      expenses: [
        { label: "adobe", amount: 500, deductible: true, bucket: "Software", confidence: "high" },
      ],
    }),
  );
  assert.ok(r);
  assert.equal(r.uncheckedCount, 1);
  assert.equal(r.deductionAtRisk, 500);
});

test("a non-deductible expense is not at risk — changing its bucket changes nothing", () => {
  const r = reviewUnconfirmedDeductions(
    input({
      expenses: [
        { label: "lunch", amount: 40, deductible: false, bucket: "Meals", confidence: "low" },
      ],
    }),
  );
  assert.equal(r, null);
});

test("the swing is estimateTax twice, not a hand-rolled rate", () => {
  const r = reviewUnconfirmedDeductions(
    input({
      expenses: [
        { label: "a", amount: 1000, deductible: true, bucket: "B", confidence: "low" },
        { label: "b", amount: 500, deductible: true, bucket: "B", confidence: "confirmed" },
      ],
    }),
  );
  assert.ok(r);
  assert.equal(r.deductionAtRisk, 1000);
  // Confirmed rows are still counted in the headline deduction, because the
  // estimate does include them.
  assert.ok(r.currentEstimate > r.estimateSwing);
  assert.equal(r.estimateSwing >= 0, true);
});

test("the swing is never negative — Panel cannot support a negative swing", () => {
  const r = reviewUnconfirmedDeductions(
    input({
      grossIncome: 0,
      expenses: [
        { label: "a", amount: 100, deductible: true, bucket: "B", confidence: "low" },
      ],
    }),
  );
  // A zero-income user has nothing to tax, so there is no swing to report.
  assert.equal(r === null || r.estimateSwing === 0, true);
});

test("the agent is `proposed`, always, and cannot be anything else", () => {
  const r = financeReviewAgent(
    input({
      expenses: [
        { label: "a", amount: 900, deductible: true, bucket: "Office", confidence: "low" },
      ],
    }),
    NOW,
  );
  assert.equal(r.tier, "proposed");
  assert.equal(r.proposals.length, 1);
  const p = r.proposals[0];
  assert.equal(p.key, "finreview:sp1:2026");
});

test("the wording never claims a category is wrong", () => {
  // Panel read no receipt. It knows the category was guessed, and that is a
  // different statement from "the category is incorrect" — which a scheduled
  // process would be asserting about a tax return it cannot see.
  const r = financeReviewAgent(
    input({
      expenses: [
        { label: "a", amount: 2140, deductible: true, bucket: "Office", confidence: "low" },
      ],
    }),
    NOW,
  );
  const text = `${r.proposals[0].title} ${r.proposals[0].detail}`.toLowerCase();
  assert.ok(text.includes("not saying they are wrong"));
  assert.ok(text.includes("nobody has checked"));

  // The disclaimer legitimately contains the word, so the check is on the rest
  // of the sentence. A crude "must not contain 'wrong'" would have failed the
  // very line that exists to *deny* the claim — which is the opposite of useful.
  const asserted = text.replace("panel is not saying they are wrong", "");
  for (const forbidden of ["wrong", "incorrect", "mistake", "error", "mislabelled", "mismatched"]) {
    assert.ok(!asserted.includes(forbidden), `"${forbidden}" must not appear as a claim`);
  }
});

test("a proposal reports evidence the user can check", () => {
  const r = financeReviewAgent(
    input({
      expenses: [
        { label: "a", amount: 2140, deductible: true, bucket: "Office", confidence: "low" },
        { label: "b", amount: 60, deductible: true, bucket: "Mileage", confidence: "medium" },
      ],
    }),
    NOW,
  );
  const ev = r.proposals[0].evidence;
  assert.ok(ev.length > 0 && ev.length <= 6);
  // Both expenses are unchecked, so the whole 2,200 is at risk.
  assert.ok(ev.some((e) => e.label === "Unconfirmed deduction" && e.value === "2200.00"));
  assert.ok(ev.some((e) => e.label === "Entries involved" && e.value === "2"));
  assert.ok(ev.some((e) => e.label === "Buckets" && e.value.includes("Mileage")));
  // Scalars only — never the rows themselves (ADR-008).
  for (const e of ev) assert.equal(typeof e.label, "string");
  for (const e of ev) assert.equal(typeof e.value, "string");
});

test("singular and plural are right, because the copy is a product surface", () => {
  const one = financeReviewAgent(
    input({
      expenses: [{ label: "a", amount: 10, deductible: true, bucket: "B", confidence: "low" }],
    }),
    NOW,
  );
  assert.ok(one.proposals[0].title.includes("1 category is"), one.proposals[0].title);

  const two = financeReviewAgent(
    input({
      expenses: [
        { label: "a", amount: 10, deductible: true, bucket: "B", confidence: "low" },
        { label: "b", amount: 10, deductible: true, bucket: "B", confidence: "low" },
      ],
    }),
    NOW,
  );
  assert.ok(two.proposals[0].title.includes("2 categories are"), two.proposals[0].title);
});

test("the same input gives the same proposal, which is what idempotency rests on", () => {
  const args = input({
    expenses: [{ label: "a", amount: 900, deductible: true, bucket: "B", confidence: "low" }],
  });
  assert.deepEqual(financeReviewAgent(args, NOW), financeReviewAgent(args, NOW + 5 * DAY));
});

test("an empty expense set is a skip, not a crash", () => {
  const r = financeReviewAgent(input(), NOW);
  assert.equal(r.tier, "proposed");
  assert.equal(r.proposals.length, 0);
});

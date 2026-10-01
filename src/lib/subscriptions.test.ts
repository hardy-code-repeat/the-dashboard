/**
 * Subscriptions + account labels — the money guards and the derived numbers
 * (phase 3, feature 5).
 *
 * Everything here is a pure function with `now` injected (ADR-002), so each
 * boundary can be checked at the instant it actually flips rather than "roughly
 * around then".
 *
 * The fixtures are grouped by what could break rather than by what is happy:
 *
 *  - **The money guard first, and by exhaustion.** `NaN`, both infinities,
 *    zero, negatives and the magnitude ceiling. This is the group that matters
 *    most, because the failure mode is not a crash — it is a tax estimate that
 *    renders as a real number and is entirely invented.
 *  - **Annual cost across the whole closed interval set**, including the
 *    exact values where a double stops being the decimal the user typed.
 *  - **Status and renewal distance**, including a null date (a real state, not
 *    a missing field) and the ±1 ms boundaries around a renewal day.
 *  - **Summary arithmetic**, because summing rounded parts and rounding one
 *    exact total are different numbers and only one of them adds up on paper.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ACCOUNT_KINDS,
  annualCost,
  describeSubscription,
  formatAmount,
  isAccountKind,
  isInterval,
  isValidAmount,
  isValidNonNegativeAmount,
  MAX_AMOUNT,
  MAX_LABEL,
  normaliseLabel,
  round2,
  SUBSCRIPTION_INTERVALS,
  summariseSubscriptions,
  type SubscriptionInterval,
  type SubscriptionRow,
} from "./subscriptions";

const DAY_MS = 86_400_000;
/** A fixed instant, so no fixture depends on the day the suite is run. */
const NOW = new Date(2026, 2, 15, 12, 0, 0).getTime();

function row(over: Partial<SubscriptionRow> = {}): SubscriptionRow {
  return {
    id: "sub_1",
    label: "Netflix",
    amount: 9.99,
    interval: "monthly",
    cancelled: false,
    renewsAt: NOW + 7 * DAY_MS,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// The money guard — D44
// ---------------------------------------------------------------------------

test("every non-finite amount is refused", () => {
  // The whole point. `NaN <= 0` is false, so the pre-feature guard let this
  // through into estimateTax, where every total becomes NaN and the UI renders
  // a number.
  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    assert.equal(isValidAmount(bad), false, `${bad} must be refused`);
    assert.equal(isValidNonNegativeAmount(bad), false, `${bad} must be refused`);
  }
});

test("every non-number is refused", () => {
  for (const bad of ["12", null, undefined, {}, [], true, [12]]) {
    assert.equal(isValidAmount(bad), false, `${JSON.stringify(bad)} must be refused`);
  }
});

test("a positive amount within the ceiling is accepted", () => {
  for (const good of [0.01, 1, 9.99, 1000, MAX_AMOUNT]) {
    assert.equal(isValidAmount(good), true, `${good} must be accepted`);
  }
});

test("zero and negatives are refused by the positive guard", () => {
  // A subscription costing nothing is not a subscription.
  for (const bad of [0, -0, -1, -0.01]) {
    assert.equal(isValidAmount(bad), false, `${bad} must be refused`);
  }
});

test("the magnitude ceiling is exclusive", () => {
  assert.equal(isValidAmount(MAX_AMOUNT), true);
  assert.equal(isValidAmount(MAX_AMOUNT + 1), false);
  assert.equal(isValidNonNegativeAmount(MAX_AMOUNT), true);
  assert.equal(isValidNonNegativeAmount(MAX_AMOUNT + 1), false);
});

test("income may be zero but not negative or NaN", () => {
  // `grossIncome < 0` was the old guard, and `NaN < 0` is false — the same
  // hole as the expense path, one field over.
  assert.equal(isValidNonNegativeAmount(0), true);
  assert.equal(isValidNonNegativeAmount(0.0), true);
  assert.equal(isValidNonNegativeAmount(-0.01), false);
  assert.equal(isValidNonNegativeAmount(Number.NaN), false);
});

// ---------------------------------------------------------------------------
// Rounding
// ---------------------------------------------------------------------------

test("round2 fixes the classic double artefact and leaves exact values alone", () => {
  assert.equal(round2(0.1 + 0.2), 0.3);
  assert.equal(round2(10.005), 10.01);
  assert.equal(round2(0), 0);
  assert.equal(round2(100), 100);
  assert.equal(round2(-1.005), -1.0);
});

test("round2 refuses to emit NaN, because a NaN total is worse than a wrong one", () => {
  assert.equal(round2(Number.NaN), 0);
  assert.equal(round2(Number.POSITIVE_INFINITY), 0);
});

test("formatAmount never prints a float artefact or an unbounded number", () => {
  assert.equal(formatAmount(9.99), "9.99");
  assert.equal(formatAmount(0.1 + 0.2), "0.30");
  assert.equal(formatAmount(Number.NaN), "—");
  // No currency symbol: a symbol belongs to the account being looked at, and
  // guessing one would be wrong the moment profile and expense disagree.
  assert.equal(formatAmount(1234.5), "1234.50");
  assert.ok(!formatAmount(1234.5).includes("£"));
  assert.ok(!formatAmount(1234.5).includes("$"));
});

// ---------------------------------------------------------------------------
// Annual cost — derived, never stored
// ---------------------------------------------------------------------------

test("annual cost across the whole closed interval set", () => {
  const expected: Record<SubscriptionInterval, number> = {
    weekly: 9.99 * 52,
    monthly: 9.99 * 12,
    quarterly: 9.99 * 4,
    yearly: 9.99,
  };
  for (const interval of SUBSCRIPTION_INTERVALS) {
    assert.equal(annualCost(9.99, interval), round2(expected[interval]), interval);
  }
});

test("annual cost is exact where the double is not", () => {
  // These are the values that genuinely misbehave. Every one of them was
  // checked against the engine rather than assumed — 9.99 * 52, the intuitive
  // candidate, is in fact exact, and a fixture asserting otherwise would have
  // been asserting a lie.
  assert.equal(0.07 * 12, 0.8400000000000001);
  assert.equal(annualCost(0.07, "monthly"), 0.84);

  assert.equal(0.99 * 12, 11.879999999999999);
  assert.equal(annualCost(0.99, "monthly"), 11.88);

  // And a case that happens to be exact, pinned so a refactor cannot change
  // the answer without a fixture noticing.
  assert.equal(annualCost(9.99, "weekly"), 519.48);
  assert.equal(annualCost(1.15, "quarterly"), 4.6);
  assert.equal(annualCost(2.675, "quarterly"), 10.7);
});

test("a yearly subscription costs exactly its amount", () => {
  for (const amount of [0.01, 9.99, 120, 1234.56]) {
    assert.equal(annualCost(amount, "yearly"), round2(amount));
  }
});

test("annual cost is 0 for an invalid amount rather than NaN", () => {
  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -5, 0, MAX_AMOUNT + 1]) {
    assert.equal(annualCost(bad, "monthly"), 0, `${bad} must not produce a number`);
  }
});

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

test("labels collapse whitespace and are bounded", () => {
  assert.equal(normaliseLabel("  Netflix   Premium  "), "Netflix Premium");
  assert.equal(normaliseLabel(""), null);
  assert.equal(normaliseLabel("   \n\t "), null);
  assert.equal(normaliseLabel("x".repeat(500))?.length, MAX_LABEL);
});

test("the interval and kind vocabularies are closed in both directions", () => {
  for (const i of SUBSCRIPTION_INTERVALS) assert.equal(isInterval(i), true, i);
  for (const i of ACCOUNT_KINDS) assert.equal(isAccountKind(i), true, i);
  // A free-form "every 17 days" would push calendar arithmetic into every
  // read and leave the awkward cases with nowhere to be pinned.
  for (const bad of ["daily", "fortnightly", "", "MONTHLY", "every 17 days"]) {
    assert.equal(isInterval(bad), false, bad);
  }
  for (const bad of ["current", "", "Checking", "wallet"]) {
    assert.equal(isAccountKind(bad), false, bad);
  }
});

// ---------------------------------------------------------------------------
// Status and renewal distance
// ---------------------------------------------------------------------------

test("status is two states and cancellation is what moves between them", () => {
  assert.equal(describeSubscription(row(), null, NOW).status, "active");
  assert.equal(
    describeSubscription(row({ cancelled: true, cancelledAt: NOW - DAY_MS }), null, NOW)
      .status,
    "cancelled",
  );
  // `cancelled: null` is a real value on the row and means the same as false.
  assert.equal(describeSubscription(row({ cancelled: null }), null, NOW).status, "active");
});

test("every view carries its id, because a row without one cannot be acted on", () => {
  // The compiler caught the inverse of this: the first UI pass keyed list rows
  // on label + detail, so two identically-named subscriptions would collide and
  // "Cancel" would act on whichever came first.
  const v = describeSubscription(row({ id: "sub_xyz" }), null, NOW);
  assert.equal(v.id, "sub_xyz");
});

test("a missing renewal date is null, never zero", () => {
  // Zero would mean "renews today", which is a claim. Null means "nobody
  // recorded one", which is a fact.
  for (const missing of [undefined, null]) {
    const v = describeSubscription(row({ renewsAt: missing }), null, NOW);
    assert.equal(v.daysUntilRenewal, null);
    assert.ok(v.detail.includes("no renewal date"), v.detail);
  }
  assert.notEqual(describeSubscription(row({ renewsAt: NOW }), null, NOW).daysUntilRenewal, null);
});

test("renewal distance crosses zero at the exact millisecond", () => {
  assert.equal(describeSubscription(row({ renewsAt: NOW + DAY_MS }), null, NOW).daysUntilRenewal, 1);
  assert.equal(describeSubscription(row({ renewsAt: NOW }), null, NOW).daysUntilRenewal, 0);
  // A millisecond *before* the date is still "today", and must not be -0.
  // `Math.round(-1/86400000)` really is `-0`, which formats as "-0" and fails
  // `Object.is(x, 0)`. This fixture found it.
  const justBefore = describeSubscription(row({ renewsAt: NOW - 1 }), null, NOW);
  assert.equal(justBefore.daysUntilRenewal, 0);
  assert.equal(Object.is(justBefore.daysUntilRenewal, -0), false);
  assert.equal(describeSubscription(row({ renewsAt: NOW - DAY_MS }), null, NOW).daysUntilRenewal, -1);
  assert.equal(describeSubscription(row({ renewsAt: NOW - DAY_MS - 1 }), null, NOW).daysUntilRenewal, -1);
});

test("the detail line is singular exactly once", () => {
  const one = describeSubscription(row({ renewsAt: NOW + DAY_MS }), null, NOW);
  assert.equal(one.detail, "Renews in 1 day");
  const many = describeSubscription(row({ renewsAt: NOW + 3 * DAY_MS }), null, NOW);
  assert.equal(many.detail, "Renews in 3 days");
  const today = describeSubscription(row({ renewsAt: NOW }), null, NOW);
  assert.equal(today.detail, "Renews today");
});

test("a cancellation says when, and never claims the service stopped existing", () => {
  const at = NOW - 3 * DAY_MS;
  const v = describeSubscription(row({ cancelled: true, cancelledAt: at }), null, NOW);
  assert.ok(v.detail.startsWith("Cancelled on "), v.detail);
  // A cancelled subscription still costs what it cost — that is history, and
  // zeroing it would quietly rewrite the past.
  assert.equal(v.annualCost, annualCost(9.99, "monthly"));
  const noDate = describeSubscription(row({ cancelled: true }), null, NOW);
  assert.equal(noDate.detail, "Cancelled");
});

test("a stale renewal reads as past, not as imminent", () => {
  const v = describeSubscription(row({ renewsAt: NOW - 5 * DAY_MS }), null, NOW);
  assert.ok(v.detail.includes("5 days ago"), v.detail);
  const one = describeSubscription(row({ renewsAt: NOW - DAY_MS }), null, NOW);
  assert.ok(one.detail.includes("1 day ago"), one.detail);
});

test("a detached account resolves to null, and null is a legitimate value", () => {
  const detached = describeSubscription(row(), null, NOW);
  assert.equal(detached.accountName, null);
  const grouped = describeSubscription(row(), "Joint current", NOW);
  assert.equal(grouped.accountName, "Joint current");
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

test("the summary counts and totals, and cancelled rows leave the active total", () => {
  const views = [
    describeSubscription(row({ id: "a", label: "A", amount: 10, interval: "monthly" }), "X", NOW),
    describeSubscription(row({ id: "b", label: "B", amount: 5, interval: "yearly" }), "X", NOW),
    describeSubscription(
      row({ id: "c", label: "C", amount: 100, interval: "yearly", cancelled: true }),
      null,
      NOW,
    ),
  ];
  const s = summariseSubscriptions(views);
  assert.equal(s.activeCount, 2);
  assert.equal(s.cancelledCount, 1);
  assert.equal(s.activeAnnualTotal, 125); // 10 x 12 + 5 x 1
  assert.equal(s.annualTotal, 225); // history is included, deliberately
});

test("the summary total is the sum of the figures the user can see", () => {
  // Three subscriptions whose raw annual cost is 11.879999999999999 each. The
  // rows display 11.88, so the total must be 35.64. A total that disagrees
  // with the visible rows is what destroys trust in a number.
  const views = [
    describeSubscription(row({ id: "a", amount: 0.99, interval: "monthly" }), null, NOW),
    describeSubscription(row({ id: "b", amount: 0.99, interval: "monthly" }), null, NOW),
    describeSubscription(row({ id: "c", amount: 0.99, interval: "monthly" }), null, NOW),
  ];
  const s = summariseSubscriptions(views);
  for (const v of views) assert.equal(v.annualCost, 11.88);
  assert.equal(views[0].annualCost + views[1].annualCost + views[2].annualCost, 35.64);
  assert.equal(s.activeAnnualTotal, 35.64);
});

test("ungrouped rows sort last so the actionable ones lead", () => {
  const views = [
    describeSubscription(row({ id: "a", label: "loose", amount: 500 }), null, NOW),
    describeSubscription(row({ id: "b", label: "cheap", amount: 1 }), "Amex", NOW),
    describeSubscription(row({ id: "c", label: "dear", amount: 20 }), "Joint", NOW),
  ];
  const s = summariseSubscriptions(views);
  const names = s.byAccount.map((b) => b.accountName);
  assert.equal(names[names.length - 1], null);
  // And the grouped ones are ordered by what they cost.
  assert.equal(names[0], "Joint");
  assert.equal(s.byAccount[0].annualCost, 240); // 20 x 12
  assert.equal(s.byAccount[0].count, 1);
});

test("an empty summary is honest, not undefined", () => {
  const s = summariseSubscriptions([]);
  assert.deepEqual(s, {
    activeCount: 0,
    cancelledCount: 0,
    annualTotal: 0,
    activeAnnualTotal: 0,
    byAccount: [],
  });
});

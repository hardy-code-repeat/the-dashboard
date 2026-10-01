/**
 * Life Admin — the expiry → renewal state machine (phase 3, feature 3).
 *
 * Every state is reachable from a fixture here, and every *boundary* is
 * checked, because a state machine that is only tested on round numbers is a
 * state machine whose off-by-one is found by a user at the worst possible
 * moment. The clock is always injected (ADR-002); nothing here reads `Date.now`.
 *
 * The two cases worth more than the rest:
 *
 *  - `stale`, because it is the case the whole derived-state design exists to
 *    catch: the renewal was ticked off through the ordinary task path, which
 *    trains correctly and never touches `expiresAt`;
 *  - the silent states, because "no item" is a behaviour that a test which
 *    only checks positive cases would never notice.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DAY_MS,
  DEFAULT_LEAD_DAYS,
  MAX_LABEL,
  describeDays,
  describeDocument,
  formatDay,
  hasExpiry,
  isRenewalOpen,
  leadDaysFor,
  normaliseLabel,
  renewalDeadline,
  validateExpiry,
  validateLeadDays,
} from "./documents";

/** A fixed clock. 2026-11-15T12:00:00Z — a Sunday, deliberately. */
const NOW = Date.UTC(2026, 10, 15, 12, 0, 0);

const days = (n: number) => n * DAY_MS;

const open = (dueAt: number | null = null) => ({
  completed: false,
  completedAt: null,
  dueAt,
});
const done = (completedAt: number, dueAt: number | null = null) => ({
  completed: true,
  completedAt,
  dueAt,
});

// ---------------------------------------------------------------------------
// the seven states
// ---------------------------------------------------------------------------

test("a document with no expiry is undated, silent, and never attention", () => {
  const v = describeDocument({ label: "Birth certificate" }, null, NOW);

  assert.equal(v.state, "undated");
  assert.equal(v.daysAway, null);
  assert.equal(v.deadlineAt, null);
  assert.equal(v.severity, null);
  assert.equal(v.attention, false);
});

test("a document with no expiry and an open renewal is still undated, still silent", () => {
  // The renewal is a fact the user stated; the absence of a date is a fact
  // about the document. Neither erases the other.
  const v = describeDocument({ label: "Passport" }, open(), NOW);

  assert.equal(v.state, "undated");
  assert.equal(v.attention, false);
  assert.equal(v.renewing, true);
});

test("an expiry well beyond the lead window is valid and silent", () => {
  const v = describeDocument({ label: "Passport", expiresAt: NOW + days(300), leadDays: 30 }, null, NOW);

  assert.equal(v.state, "valid");
  assert.equal(v.daysAway, 300);
  assert.equal(v.attention, false);
  assert.equal(v.severity, null);
  assert.equal(v.deadlineAt, NOW + days(270));
});

test("the first day inside the lead window is due and wants attention", () => {
  const v = describeDocument({ label: "Passport", expiresAt: NOW + days(30), leadDays: 30 }, null, NOW);

  assert.equal(v.state, "due");
  assert.equal(v.attention, true);
  assert.ok((v.severity ?? 0) > 0, "severity must be non-zero");
});

test("one day before the lead window closes the document is still valid", () => {
  // The boundary, checked from both sides, because `daysAway <= lead` is where
  // an off-by-one would either nag a year early or miss the window entirely.
  const inside = describeDocument({ label: "X", expiresAt: NOW + days(31), leadDays: 30 }, null, NOW);
  const outside = describeDocument({ label: "X", expiresAt: NOW + days(31), leadDays: 30 }, null, NOW + days(1));

  assert.equal(inside.state, "valid");
  assert.equal(outside.state, "due");
});

test("an expired document with nothing started is expired, pinned, and loud", () => {
  const v = describeDocument({ label: "Passport", expiresAt: NOW - days(5), leadDays: 30 }, null, NOW);

  assert.equal(v.state, "expired");
  assert.equal(v.attention, true);
  assert.equal(v.daysAway, -5);
  assert.ok((v.severity ?? 0) >= 0.9, "expired must reach pin threshold");
});

test("an open renewal with the expiry ahead is renewing, and emits no item", () => {
  const v = describeDocument(
    { label: "Passport", expiresAt: NOW + days(10), leadDays: 30 },
    open(NOW + days(-20)),
    NOW,
  );

  assert.equal(v.state, "renewing");
  assert.equal(v.renewing, true);
  // The anti-spam line: one renewal must not produce two attention items.
  assert.equal(v.attention, false);
  assert.equal(v.severity, null);
});

test("an open renewal with the expiry already past is renewing-late, still no item", () => {
  const v = describeDocument(
    { label: "Passport", expiresAt: NOW - days(3), leadDays: 30 },
    open(NOW + days(-33)),
    NOW,
  );

  assert.equal(v.state, "renewing-late");
  assert.equal(v.attention, false);
  assert.equal(v.renewing, true);
});

test("a renewal ticked off generically after the expiry leaves the document stale", () => {
  // This is the silent failure ADR-025 was written for. The user completed the
  // task through the ordinary dashboard checkbox: the model trained correctly,
  // `task.completed` was written, and `expiresAt` never moved. Without `stale`
  // this row would sit there looking ordinary while expired.
  const v = describeDocument(
    { label: "Passport", expiresAt: NOW - days(10), leadDays: 30 },
    done(NOW - days(2)),
    NOW,
  );

  assert.equal(v.state, "stale");
  assert.equal(v.attention, true);
  assert.equal(v.severity, 1);
});

test("a properly completed renewal is not stale — the date moved past the completion", () => {
  const v = describeDocument(
    { label: "Passport", expiresAt: NOW + days(3650), leadDays: 30 },
    done(NOW - days(2)),
    NOW,
  );

  assert.equal(v.state, "valid");
  assert.equal(v.attention, false);
});

test("a renewal completed before the expiry date is not stale either", () => {
  // Renewing early is normal and good. It must not be reported as a
  // contradiction.
  const v = describeDocument(
    { label: "Passport", expiresAt: NOW + days(200), leadDays: 30 },
    done(NOW - days(5)),
    NOW,
  );

  assert.equal(v.state, "valid");
  assert.equal(v.attention, false);
});

test("a stale renewal beats an expired one in severity", () => {
  const stale = describeDocument(
    { label: "A", expiresAt: NOW - days(10) },
    done(NOW - days(1)),
    NOW,
  );
  const expired = describeDocument({ label: "B", expiresAt: NOW - days(1) }, null, NOW);

  assert.ok(
    (stale.severity ?? 0) > (expired.severity ?? 0),
    "a contradiction the user must resolve outranks a plain date",
  );
});

// ---------------------------------------------------------------------------
// severity is deterministic and bounded
// ---------------------------------------------------------------------------

test("severity rises monotonically across the lead window", () => {
  const severities = [30, 22, 15, 7, 1].map((d) => {
    const v = describeDocument({ label: "P", expiresAt: NOW + days(d), leadDays: 30 }, null, NOW);
    return v.severity ?? -1;
  });

  for (let i = 1; i < severities.length; i++) {
    assert.ok(
      severities[i] > severities[i - 1],
      `severity must rise as the date approaches: ${severities.join(", ")}`,
    );
  }
});

test("severity is a real attention item at the window edge, not a rounding artefact", () => {
  const edge = describeDocument({ label: "P", expiresAt: NOW + days(30), leadDays: 30 }, null, NOW);

  assert.ok((edge.severity ?? 0) >= 0.55, `expected >= 0.55, got ${edge.severity}`);
  assert.ok((edge.severity ?? 2) <= 1, `severity must stay <= 1, got ${edge.severity}`);
});

test("a zero lead time opens the window on the day itself, and the deadline is the expiry", () => {
  // With no lead time there is nothing to do early, so "due" starts on the day
  // the document expires. A day before that it is genuinely still valid, and
  // at the instant of expiry it is `expired` rather than `due` — the window is
  // the final half-day, because `daysAway` rounds like everywhere else in
  // Panel (the same convention `life:getFinance` uses for tax deadlines).
  //
  // The first two drafts of this fixture asserted otherwise and were wrong.
  const expiresAt = NOW + days(1);
  const tomorrow = describeDocument({ label: "P", expiresAt, leadDays: 0 }, null, NOW);
  assert.equal(tomorrow.state, "valid");
  assert.equal(tomorrow.attention, false);

  const finalHours = describeDocument({ label: "P", expiresAt, leadDays: 0 }, null, NOW + days(0.6));
  assert.equal(finalHours.state, "due");
  assert.equal(finalHours.attention, true);
  // With no lead time the deadline *is* the expiry.
  assert.equal(finalHours.deadlineAt, expiresAt);

  const atExpiry = describeDocument({ label: "P", expiresAt, leadDays: 0 }, null, expiresAt);
  assert.equal(atExpiry.state, "expired");
});

test("severity never leaves 0..1 for any state", () => {
  const cases = [
    { expiresAt: NOW + days(30) },
    { expiresAt: NOW + days(1) },
    { expiresAt: NOW },
    { expiresAt: NOW - days(400) },
    { expiresAt: NOW, leadDays: 365 },
  ];
  for (const doc of cases) {
    const v = describeDocument({ label: "X", ...doc }, null, NOW);
    if (v.severity === null) continue;
    assert.ok(v.severity >= 0 && v.severity <= 1, `${JSON.stringify(doc)} -> ${v.severity}`);
  }
});

// ---------------------------------------------------------------------------
// lead time
// ---------------------------------------------------------------------------

test("the default lead time is thirty days", () => {
  assert.equal(DEFAULT_LEAD_DAYS, 30);
  assert.equal(leadDaysFor({}), 30);
});

test("a stored lead time is honoured", () => {
  // Virginia DMV reminds at ninety; Utah opens renewal at sixty.
  assert.equal(leadDaysFor({ leadDays: 90 }), 90);
  assert.equal(leadDaysFor({ leadDays: 60 }), 60);
});

test("an out-of-bounds or non-finite lead time falls back to the default", () => {
  // A row written before the bounds existed must not produce a negative window
  // or a thirty-year one.
  assert.equal(leadDaysFor({ leadDays: -1 }), DEFAULT_LEAD_DAYS);
  assert.equal(leadDaysFor({ leadDays: 400 }), DEFAULT_LEAD_DAYS);
  assert.equal(leadDaysFor({ leadDays: Number.NaN }), DEFAULT_LEAD_DAYS);
  assert.equal(leadDaysFor({ leadDays: Number.POSITIVE_INFINITY }), DEFAULT_LEAD_DAYS);
  assert.equal(leadDaysFor({ leadDays: null }), DEFAULT_LEAD_DAYS);
});

test("a fractional lead time is rounded to whole days", () => {
  assert.equal(leadDaysFor({ leadDays: 29.6 }), 30);
});

test("the renewal deadline is the expiry minus the lead time, not the expiry", () => {
  const expiresAt = NOW + days(365);
  assert.equal(renewalDeadline({ expiresAt, leadDays: 90 }), expiresAt - days(90));
});

test("the deadline is null when there is no expiry", () => {
  assert.equal(renewalDeadline({ leadDays: 30 }), null);
  assert.equal(renewalDeadline({ expiresAt: null }), null);
});

// ---------------------------------------------------------------------------
// expiry validity — NaN and Infinity are refused, not coerced (the N5 lesson)
// ---------------------------------------------------------------------------

test("hasExpiry rejects every non-finite timestamp", () => {
  assert.equal(hasExpiry({ expiresAt: NOW }), true);
  assert.equal(hasExpiry({ expiresAt: Number.NaN }), false);
  assert.equal(hasExpiry({ expiresAt: Number.POSITIVE_INFINITY }), false);
  assert.equal(hasExpiry({}), false);
  assert.equal(hasExpiry({ expiresAt: null }), false);
});

test("validateExpiry refuses rather than coerces", () => {
  assert.equal(validateExpiry(Number.NaN), null);
  assert.equal(validateExpiry(Number.POSITIVE_INFINITY), null);
  assert.equal(validateExpiry(Number.NEGATIVE_INFINITY), null);
  assert.equal(validateExpiry(-5), null);
  assert.equal(validateExpiry(0), null);
  assert.equal(validateExpiry(undefined), undefined);
  assert.equal(validateExpiry(null), undefined);
  assert.equal(validateExpiry(NOW + 1), NOW + 1);
});

test("a non-finite expiry makes the document undated rather than attention", () => {
  const v = describeDocument({ label: "P", expiresAt: Number.NaN }, null, NOW);

  assert.equal(v.state, "undated");
  assert.equal(v.attention, false);
});

test("validateLeadDays separates 'use the default' from 'refuse this'", () => {
  // The distinction matters: `undefined` is a legitimate caller choice, and
  // `null` means the input was unusable.
  assert.equal(validateLeadDays(undefined), undefined);
  assert.equal(validateLeadDays(null), undefined);
  assert.equal(validateLeadDays(-1), null);
  assert.equal(validateLeadDays(366), null);
  assert.equal(validateLeadDays(Number.NaN), null);
  assert.equal(validateLeadDays(45), 45);
});

// ---------------------------------------------------------------------------
// labels
// ---------------------------------------------------------------------------

test("a label is trimmed and whitespace-collapsed", () => {
  assert.equal(normaliseLabel("  Passport  "), "Passport");
  assert.equal(normaliseLabel("Car   insurance\n\tpolicy"), "Car insurance policy");
});

test("a label with nothing usable in it is refused, not stored empty", () => {
  assert.equal(normaliseLabel(""), null);
  assert.equal(normaliseLabel("   "), null);
  assert.equal(normaliseLabel("\n\t"), null);
});

test("a label is bounded, because a mutation writes it", () => {
  const long = "x".repeat(MAX_LABEL + 200);
  assert.equal(normaliseLabel(long)?.length, MAX_LABEL);
});

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

test("isRenewalOpen is true only for an incomplete renewal", () => {
  assert.equal(isRenewalOpen(null), false);
  assert.equal(isRenewalOpen(undefined), false);
  assert.equal(isRenewalOpen(open()), true);
  assert.equal(isRenewalOpen(done(NOW)), false);
});

test("describeDays reads naturally at and around the boundary", () => {
  assert.equal(describeDays(0), "today");
  assert.equal(describeDays(1), "tomorrow");
  assert.equal(describeDays(-1), "yesterday");
  assert.equal(describeDays(2), "in 2 days");
  assert.equal(describeDays(30), "in 30 days");
  assert.equal(describeDays(-30), "30 days ago");
});

test("formatDay renders in UTC, so a calendar day does not shift", () => {
  // Midnight UTC on the 1st. Rendered anywhere west of Greenwich this would
  // read as the last day of the previous month, which is how "expires
  // tomorrow" becomes "expired yesterday".
  assert.equal(formatDay(Date.UTC(2027, 0, 1, 0, 0, 0)), "1 Jan 2027");
  assert.equal(formatDay(Date.UTC(2027, 11, 31, 23, 59, 0)), "31 Dec 2027");
});

test("every state carries a detail line a person can act on", () => {
  const cases = [
    [{ label: "P" }, null],
    [{ label: "P", expiresAt: NOW + days(300) }, null],
    [{ label: "P", expiresAt: NOW + days(10) }, null],
    [{ label: "P", expiresAt: NOW + days(10) }, open(NOW)],
    [{ label: "P", expiresAt: NOW - days(10) }, open(NOW)],
    [{ label: "P", expiresAt: NOW - days(10) }, null],
    [{ label: "P", expiresAt: NOW - days(10) }, done(NOW - days(1))],
  ] as const;

  for (const [doc, renewal] of cases) {
    const v = describeDocument(doc, renewal, NOW);
    assert.ok(v.detail.length > 0, `${v.state} has no detail`);
    assert.ok(v.title.length > 0, `${v.state} has no title`);
  }
});

test("the state machine is pure — the same inputs give the same answer", () => {
  const doc = { label: "Passport", expiresAt: NOW + days(10), leadDays: 30 };
  const a = describeDocument(doc, null, NOW);
  const b = describeDocument(doc, null, NOW);

  assert.deepEqual(a, b);
});

test("no stored field can make a document look renewed", () => {
  // `DocumentRow` has no status field, and this is the assertion that keeps it
  // that way honest: a completed renewal with no date move is `stale`, never
  // anything that reads as success.
  const v = describeDocument({ label: "P", expiresAt: NOW - days(1) }, done(NOW), NOW);

  assert.notEqual(v.state, "valid");
  assert.notEqual(v.state, "renewed");
  assert.equal(v.state, "stale");
});
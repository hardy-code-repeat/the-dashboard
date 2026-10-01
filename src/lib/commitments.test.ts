/**
 * Commitments + Waiting On — the lifecycle machine (phase 3, feature 4).
 *
 * Four states, two directions, no stored status. Everything below is a pure
 * function of `(expectedAt, completed, now)` with `now` injected (ADR-002), so
 * every boundary can be checked at the instant it actually flips rather than
 * "roughly around then".
 *
 * The fixtures are grouped by what could break rather than by what is happy:
 *
 *  - **The exhaustive table.** One loop over every combination of direction,
 *    completion and nine date positions, asserting the invariant that matters
 *    above all: *only* `overdue` is attention. Nine hand-written happy paths
 *    would still let an eleventh combination through.
 *  - **The boundaries.** The due window closes at exactly seven days and opens
 *    for overdue at the exact millisecond the date arrives. Both are off-by-one
 *    traps, and both are the kind of thing a user finds on the one day it
 *    matters.
 *  - **The copy.** For `owedTo`, every string must describe what *the user
 *    recorded*, never what another person did. Panel observed nothing, so a
 *    sentence that says otherwise is not a stylistic slip — it is a false claim
 *    about a third party.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  COMMITMENT_DIRECTIONS,
  DEFAULT_DUE_WINDOW_DAYS,
  MAX_TITLE,
  describeCommitment,
  describeDays,
  formatDay,
  hasExpectedAt,
  isDirection,
  normaliseTitle,
  validateExpectedAt,
  type CommitmentRow,
  type CommitmentState,
} from "./commitments";

const DAY_MS = 86_400_000;

/** A fixed clock. 2026-03-10T09:00:00Z. */
const NOW = Date.UTC(2026, 2, 10, 9, 0, 0);

const owed = (over: Partial<CommitmentRow> = {}): CommitmentRow => ({
  title: "Send the contract",
  direction: "owed",
  completed: false,
  completedAt: null,
  ...over,
});

const wait = (over: Partial<CommitmentRow> = {}): CommitmentRow => ({
  title: "Send the signed copy",
  direction: "owedTo",
  completed: false,
  completedAt: null,
  ...over,
});

const view = (row: CommitmentRow, now = NOW) => describeCommitment(row, "Raj", null, now);

// ---------------------------------------------------------------------------
// the exhaustive table — only `overdue` is ever attention
// ---------------------------------------------------------------------------

test("only the overdue state produces attention, in every direction and position", () => {
  const positions: [string, number | null][] = [
    ["no date", null],
    ["a year ago", NOW - 365 * DAY_MS],
    ["three days ago", NOW - 3 * DAY_MS],
    ["one millisecond ago", NOW - 1],
    ["exactly now", NOW],
    ["one millisecond ahead", NOW + 1],
    ["seven days ahead", NOW + 7 * DAY_MS],
    ["eight days ahead", NOW + 8 * DAY_MS],
    ["a year ahead", NOW + 365 * DAY_MS],
  ];

  for (const direction of COMMITMENT_DIRECTIONS) {
    for (const completed of [false, true]) {
      for (const [label, expectedAt] of positions) {
        const row: CommitmentRow = {
          title: "T",
          direction,
          completed,
          completedAt: completed ? NOW - DAY_MS : null,
          expectedAt: expectedAt ?? undefined,
        };
        const v = describeCommitment(row, "Raj", null, NOW);

        assert.equal(
          v.attention,
          v.state === "overdue",
          `${direction}/${completed}/${label}: attention must track the overdue state exactly`,
        );
        // Silent means silent — no section is named for an item nobody will see.
        assert.equal(v.section, v.attention ? (direction === "owedTo" ? "waitingOn" : "people") : null);
        // `due` carries a severity for the list to sort by without ever reaching
        // the feed, so it is the only silent state that has one.
        if (v.state === "open" || v.state === "kept") {
          assert.equal(v.severity, null, `a ${v.state} item carries no severity`);
        }
        assert.equal(typeof v.detail, "string");
        assert.ok(v.detail.length > 0, "every state has copy, including the quiet ones");
      }
    }
  }
});

test("exactly one state is true for any row — there is no in-between", () => {
  const states: CommitmentState[] = ["open", "due", "overdue", "kept"];
  for (const direction of COMMITMENT_DIRECTIONS) {
    for (const completed of [false, true]) {
      for (const expectedAt of [null, NOW - 3 * DAY_MS, NOW, NOW + 1, NOW + 3 * DAY_MS, NOW + 9 * DAY_MS]) {
        const v = describeCommitment(
          { title: "T", direction, completed, completedAt: null, expectedAt: expectedAt ?? undefined },
          "Raj",
          null,
          NOW,
        );
        assert.ok(states.includes(v.state));
      }
    }
  }
});

// ---------------------------------------------------------------------------
// the four states
// ---------------------------------------------------------------------------

test("an undated outbound promise is open, silent, and says only that it exists", () => {
  const v = view(owed());

  assert.equal(v.state, "open");
  assert.equal(v.daysAway, null);
  assert.equal(v.attention, false);
  assert.equal(v.severity, null);
  assert.equal(v.detail, "You told Raj you would");
});

test("an outbound promise with a distant date is open and names the date", () => {
  const v = view(owed({ expectedAt: NOW + 30 * DAY_MS }));

  assert.equal(v.state, "open");
  assert.equal(v.daysAway, 30);
  assert.equal(v.attention, false);
  assert.equal(v.detail, "You told Raj you would · by 9 Apr 2026");
});

test("an undated wait is open and never becomes due", () => {
  const v = view(wait());

  assert.equal(v.state, "open");
  assert.equal(v.attention, false);
  assert.equal(v.detail, "Waiting on Raj");
});

test("a wait with a distant date is open, and its copy never predicts delivery", () => {
  const v = view(wait({ expectedAt: NOW + 10 * DAY_MS }));

  assert.equal(v.state, "open");
  assert.equal(v.daysAway, 10);
  assert.equal(v.detail, "Waiting on Raj · expected 20 Mar 2026");
  assert.ok(!/Raj\s+(sent|will|should|is going)/.test(v.detail));
});

// ---------------------------------------------------------------------------
// due — outbound only, and never attention
// ---------------------------------------------------------------------------

test("an outbound promise inside the window is due, and due is not attention", () => {
  const v = view(owed({ expectedAt: NOW + 3 * DAY_MS }));

  assert.equal(v.state, "due");
  assert.equal(v.attention, false, "nagging a week early is how a feed gets muted (R-009)");
  assert.equal(v.section, null);
  assert.ok((v.severity ?? 0) > 0, "due carries a severity for the list to sort by");
  assert.equal(v.detail, "You told Raj you would — in 3 days");
});

test("severity rises as the date approaches, and is bounded", () => {
  const far = view(owed({ expectedAt: NOW + 7 * DAY_MS })).severity ?? 0;
  const near = view(owed({ expectedAt: NOW + 1 * DAY_MS })).severity ?? 0;
  const today = view(owed({ expectedAt: NOW + 1 })).severity ?? 0;

  assert.ok(far < near, `${far} should be below ${near}`);
  assert.ok(near < today, `${near} should be below ${today}`);
  assert.ok(today <= 0.7 + 1e-9, "and the top of the window stays under 0.7");
  assert.ok(far >= 0.5);
});

test("the due window closes at exactly seven days and reopens just past it", () => {
  assert.equal(view(owed({ expectedAt: NOW + 7 * DAY_MS })).state, "due");
  // A millisecond past seven days still rounds to eight, so it is open. This is
  // the boundary an off-by-one would sit on.
  assert.equal(view(owed({ expectedAt: NOW + 7 * DAY_MS + 1 })).state, "due");
  assert.equal(view(owed({ expectedAt: NOW + 8 * DAY_MS - 1 })).state, "open");
  assert.equal(view(owed({ expectedAt: NOW + 8 * DAY_MS })).state, "open");
  assert.equal(DEFAULT_DUE_WINDOW_DAYS, 7);
});

test("a wait is never in the due state, however close its date gets", () => {
  for (const offset of [400 * DAY_MS, 8 * DAY_MS, 3 * DAY_MS, DAY_MS, 1]) {
    assert.notEqual(view(wait({ expectedAt: NOW + offset })).state, "due");
  }
});

// ---------------------------------------------------------------------------
// overdue — the only attention state
// ---------------------------------------------------------------------------

test("an overdue outbound promise is hard attention for a person", () => {
  const v = view(owed({ expectedAt: NOW - 3 * DAY_MS }));

  assert.equal(v.state, "overdue");
  assert.equal(v.attention, true);
  assert.equal(v.section, "people");
  assert.equal(v.severity, 0.85);
  assert.equal(v.detail, "You told Raj you would, and it is 3 days overdue");
});

test("one day late reads in the singular, and reads as overdue", () => {
  assert.equal(view(owed({ expectedAt: NOW - DAY_MS })).detail, "You told Raj you would, and it is 1 day overdue");
  assert.equal(view(owed({ expectedAt: NOW - 2 * DAY_MS })).detail, "You told Raj you would, and it is 2 days overdue");
});

test("overdue begins at the instant the date arrives, not the next morning", () => {
  const just = view(owed({ expectedAt: NOW + 1 }));
  assert.equal(just.state, "due", "a millisecond early is still in the window");
  assert.equal(just.detail, "You told Raj you would — today");

  const exactly = view(owed({ expectedAt: NOW }));
  assert.equal(exactly.state, "overdue");
  assert.equal(exactly.daysAway, 0);
  // At the boundary the honest sentence is that today was the day, not that it
  // is late — the lateness is zero and calling it overdue in the copy would be
  // overstating what Panel knows.
  assert.equal(exactly.detail, "You told Raj you would, and today was the day");

  const past = view(owed({ expectedAt: NOW - 1 }));
  assert.equal(past.state, "overdue");
});

test("an overdue wait is soft, low, and belongs to the waiting section", () => {
  const v = view(wait({ expectedAt: NOW - 3 * DAY_MS }));

  assert.equal(v.state, "overdue");
  assert.equal(v.attention, true);
  assert.equal(v.section, "waitingOn");
  assert.equal(v.severity, 0.6, "an inbound wait cannot be resolved by the user, so it must not shout");
  assert.equal(v.detail, "Waiting on Raj since 7 Mar 2026");
});

test("an inbound wait is strictly less severe than the user's own broken promise", () => {
  const mine = view(owed({ expectedAt: NOW - 3 * DAY_MS })).severity ?? 0;
  const theirs = view(wait({ expectedAt: NOW - 3 * DAY_MS })).severity ?? 0;
  assert.ok(theirs < mine, `${theirs} should be below ${mine}`);
});

// ---------------------------------------------------------------------------
// kept — the user's assertion, never an observation
// ---------------------------------------------------------------------------

test("a kept outbound promise reads as a kept promise", () => {
  const v = view(owed({ completed: true, completedAt: NOW - DAY_MS, expectedAt: NOW - 2 * DAY_MS }));

  assert.equal(v.state, "kept");
  assert.equal(v.attention, false);
  assert.equal(v.severity, null);
  assert.equal(v.detail, "You told Raj you would, and it is done");
});

test("a settled wait says the USER marked it received, and never names the sender", () => {
  const v = view(wait({ completed: true, completedAt: NOW - DAY_MS, expectedAt: NOW - 5 * DAY_MS }));

  assert.equal(v.state, "kept");
  assert.equal(v.detail, "You marked this received on 9 Mar 2026");
  assert.ok(!v.detail.includes("Raj"), "the settled copy does not even mention the other party");
});

test("a settled wait with no completion date still reads correctly", () => {
  // A hand-edited row, or one settled by a path that did not stamp it. The copy
  // must not render a dangling " on undefined".
  const v = view(wait({ completed: true, completedAt: null }));

  assert.equal(v.detail, "You marked this received");
  assert.ok(!v.detail.includes("undefined"));
});

test("settling an item makes it silent in every direction", () => {
  for (const direction of COMMITMENT_DIRECTIONS) {
    const v = describeCommitment(
      { title: "T", direction, completed: true, completedAt: NOW, expectedAt: NOW - 30 * DAY_MS },
      "Raj",
      null,
      NOW,
    );
    assert.equal(v.attention, false);
    assert.equal(v.section, null);
    assert.equal(v.severity, null);
  }
});

// ---------------------------------------------------------------------------
// AC-7 — the copy discipline, asserted as a property rather than a sample
// ---------------------------------------------------------------------------

test("no inbound string ever states what another person did", () => {
  const forbidden = /\bRaj\b[^.]*\b(sent|send|deliver|delivered|did|hasn't|has not|failed|refus|never|owes|will)\b/i;
  const offsets = [null, NOW - 30 * DAY_MS, NOW - 1, NOW + 1, NOW + 3 * DAY_MS, NOW + 400 * DAY_MS];

  for (const completed of [false, true]) {
    for (const expectedAt of offsets) {
      for (const completedAt of completed ? [null, NOW - DAY_MS] : [null]) {
        const v = describeCommitment(
          { title: "Send the signed copy", direction: "owedTo", completed, completedAt, expectedAt: expectedAt ?? undefined },
          "Raj",
          null,
          NOW,
        );
        assert.ok(
          !forbidden.test(v.detail),
          `inbound copy makes a claim about Raj: "${v.detail}"`,
        );
      }
    }
  }
});

test("every inbound sentence is one Panel is entitled to write", () => {
  // The complete set of shapes. Anything else is a sentence that has been
  // invented without checking whether Panel knows it.
  const allowed = [
    /^Waiting on Raj$/,
    /^Waiting on Raj · expected \d{1,2} \w{3} \d{4}$/,
    /^Waiting on Raj since \d{1,2} \w{3} \d{4}$/,
    /^You marked this received$/,
    /^You marked this received on \d{1,2} \w{3} \d{4}$/,
  ];
  const offsets = [null, NOW - 30 * DAY_MS, NOW + 1, NOW + 3 * DAY_MS, NOW + 400 * DAY_MS];
  for (const completed of [false, true]) {
    for (const expectedAt of offsets) {
      const v = describeCommitment(
        { title: "T", direction: "owedTo", completed, completedAt: completed ? NOW : null, expectedAt: expectedAt ?? undefined },
        "Raj",
        null,
        NOW,
      );
      assert.ok(
        allowed.some((re) => re.test(v.detail)),
        `unexpected inbound sentence: "${v.detail}"`,
      );
    }
  }
});

test("no outbound string ever claims to be waiting on somebody", () => {
  for (const expectedAt of [null, NOW - DAY_MS, NOW + 3 * DAY_MS]) {
    for (const completed of [false, true]) {
      const v = describeCommitment(
        { title: "T", direction: "owed", completed, completedAt: completed ? NOW : null, expectedAt: expectedAt ?? undefined },
        "Raj",
        null,
        NOW,
      );
      assert.ok(!v.detail.startsWith("Waiting on"), `"${v.detail}" reads as an inbound wait`);
      assert.ok(!v.detail.includes("received"), `"${v.detail}" is the inbound settled copy`);
    }
  }
});

// ---------------------------------------------------------------------------
// follow-up references — present, absent, and deliberately inert
// ---------------------------------------------------------------------------

test("a follow-up is reported but changes nothing about the item's standing", () => {
  const row = owed({ expectedAt: NOW - 3 * DAY_MS });
  const without = view(row);
  const withOpen = describeCommitment(row, "Raj", { _id: "t1", completed: false }, NOW);
  const withDone = describeCommitment(row, "Raj", { _id: "t1", completed: true }, NOW);

  assert.equal(without.followingUp, false);
  assert.equal(withOpen.followingUp, true);
  assert.equal(withDone.followingUp, false, "a finished chase is not an open one");

  for (const v of [without, withOpen, withDone]) {
    assert.equal(v.state, "overdue");
    assert.equal(v.attention, true);
    assert.equal(v.severity, without.severity);
    assert.equal(v.detail, without.detail);
    assert.equal(v.section, without.section);
  }
});

test("a follow-up on an inbound wait does not settle it", () => {
  const row = wait({ expectedAt: NOW - 2 * DAY_MS });
  const v = describeCommitment(row, "Raj", { _id: "t1", completed: true }, NOW);

  assert.equal(v.state, "overdue", "chasing someone is not receiving from them");
  assert.equal(v.followingUp, false);
  assert.ok(v.detail.startsWith("Waiting on Raj"));
});

// ---------------------------------------------------------------------------
// the closed direction union
// ---------------------------------------------------------------------------

test("the direction union is closed, and only the two documented values pass", () => {
  assert.deepEqual([...COMMITMENT_DIRECTIONS], ["owed", "owedTo"]);
  assert.ok(isDirection("owed"));
  assert.ok(isDirection("owedTo"));
  for (const bad of ["Owed", "owedto", "inbound", "", "both"]) {
    assert.ok(!isDirection(bad), `"${bad}" is not a direction`);
  }
});

// ---------------------------------------------------------------------------
// input bounds
// ---------------------------------------------------------------------------

test("a title is collapsed, trimmed and bounded — and a blank one is refused", () => {
  assert.equal(normaliseTitle("  send   the\n contract "), "send the contract");
  assert.equal(normaliseTitle(""), null);
  assert.equal(normaliseTitle("   \t \n "), null);
  assert.equal(normaliseTitle("x".repeat(500))?.length, MAX_TITLE);
  assert.equal(MAX_TITLE, 160);
});

test("an expected date must be finite, and a non-date is refused rather than coerced", () => {
  assert.equal(validateExpectedAt(undefined), undefined);
  assert.equal(validateExpectedAt(null), undefined);
  assert.equal(validateExpectedAt(Number.NaN), null, "a coerced NaN becomes a date in the far future");
  assert.equal(validateExpectedAt(Number.POSITIVE_INFINITY), null);
  assert.equal(validateExpectedAt(Number.NEGATIVE_INFINITY), null);
  assert.equal(validateExpectedAt(NOW + 1.4), NOW + 1, "and a real one is rounded, not truncated");
});

test("a missing or unusable expectedAt is not an expectedAt", () => {
  assert.ok(hasExpectedAt({ expectedAt: NOW }));
  assert.ok(!hasExpectedAt({ expectedAt: undefined }));
  assert.ok(!hasExpectedAt({ expectedAt: null }));
  assert.ok(!hasExpectedAt({ expectedAt: Number.NaN }));
  assert.ok(!hasExpectedAt({ expectedAt: Number.POSITIVE_INFINITY }));
});

// ---------------------------------------------------------------------------
// phrasing helpers, kept identical to the document machine's
// ---------------------------------------------------------------------------

test("describeDays says the same thing the document machine says", () => {
  assert.equal(describeDays(0), "today");
  assert.equal(describeDays(1), "tomorrow");
  assert.equal(describeDays(-1), "yesterday");
  assert.equal(describeDays(3), "in 3 days");
  assert.equal(describeDays(-3), "3 days ago");
  assert.equal(describeDays(-1.2), "1.2 days ago");
  // Fractional input is not rounded away: `describeCommitment` only ever passes
  // an already-rounded whole number, and rounding here would silently disagree
  // with `documents.ts`, which this phrasing is deliberately identical to.
  assert.equal(describeDays(1.5), "in 1.5 days");
});

test("a date is rendered in UTC, so it cannot shift under the reader", () => {
  // 23:30 UTC on 31 January. Anywhere east of UTC+1 this is already 1 February
  // locally; the rendered day must not care.
  assert.equal(formatDay(Date.UTC(2026, 0, 31, 23, 30)), "31 Jan 2026");
  assert.equal(formatDay(Date.UTC(2026, 0, 1, 0, 30)), "1 Jan 2026");
  assert.equal(formatDay(Date.UTC(2026, 11, 31, 12, 0)), "31 Dec 2026");
});
/**
 * Regression fixtures for the natural-language task parser.
 *
 * TASK-0A-001 / REQ-021 / REQ-030.
 *
 * These lock in **current, correct** parser behaviour so that the Phase 1.1
 * capture refactor cannot silently change it. They are not a wish list — where
 * the parser has a known gap, the fixture documents the gap and says so, and
 * the gap is recorded as debt rather than quietly encoded as desired behaviour.
 *
 * Everything runs against a fixed clock so results never depend on the day the
 * suite runs.
 *
 * Uses `node:test` + `node:assert/strict` rather than `bun:test`: both run under
 * `bun test`, but the node built-ins typecheck with the `@types/node` already in
 * devDependencies. `bun:test` has no resolvable type declarations here, so
 * importing it would break `tsc -b` and require a new dependency the Phase 0A
 * budget does not permit.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { describeDue, nextOccurrence, parseTaskInput } from "./nlp";
import type { Priority } from "./nlp";

/** Thursday 1 October 2026, 10:00 local. Fixed clock for every case. */
const NOW = new Date(2026, 9, 1, 10, 0, 0);

function at(year: number, month: number, day: number, hour = 17, minute = 0) {
  return new Date(year, month, day, hour, minute, 0, 0).getTime();
}

interface Case {
  input: string;
  title: string;
  dueAt: number | null;
  priority: Priority;
  recurrence: string | null;
  tags: string[];
}

/**
 * The 20 parser fixtures. Expectations are written out explicitly rather than
 * derived from the parser's own helpers, so the suite cannot pass by being
 * tautological.
 */
const CASES: Case[] = [
  {
    // Time token precedes the date token; the date adopts the parsed hour.
    input: "call sam 6pm tomorrow #work",
    title: "call sam",
    dueAt: at(2026, 9, 2, 18),
    priority: 1,
    recurrence: null,
    tags: ["work"],
  },
  {
    // Regression: "every morning" asks to consume 3 tokens with only 2 left.
    // This used to throw on an undefined token (defect N10).
    input: "take vitamins every morning",
    title: "take vitamins",
    dueAt: null,
    priority: 2,
    recurrence: "daily",
    tags: [],
  },
  {
    input: "water the plants every 3 days",
    title: "water the plants",
    dueAt: null,
    priority: 2,
    recurrence: "every:3:day",
    tags: [],
  },
  {
    // Regression: a hash followed by digits is an issue reference, not a tag.
    input: "review #42",
    title: "review #42",
    dueAt: null,
    priority: 2,
    recurrence: null,
    tags: [],
  },
  {
    input: "pay rent every month",
    title: "pay rent",
    dueAt: null,
    priority: 2,
    recurrence: "monthly",
    tags: [],
  },
  {
    input: "gym daily",
    title: "gym",
    dueAt: null,
    priority: 2,
    recurrence: "daily",
    tags: [],
  },
  {
    input: "call mum tonight",
    title: "call mum",
    dueAt: at(2026, 9, 1, 20),
    priority: 1,
    recurrence: null,
    tags: [],
  },
  {
    input: "draft contract tomorrow 9am",
    title: "draft contract",
    dueAt: at(2026, 9, 2, 9),
    priority: 1,
    recurrence: null,
    tags: [],
  },
  {
    input: "send invoice today",
    title: "send invoice",
    dueAt: at(2026, 9, 1, 17),
    priority: 1,
    recurrence: null,
    tags: [],
  },
  {
    input: "renew passport 2027-04-30",
    title: "renew passport",
    dueAt: at(2027, 3, 30, 17),
    priority: 1,
    recurrence: null,
    tags: [],
  },
  {
    input: "task for friday",
    title: "task for",
    dueAt: at(2026, 9, 2, 17),
    priority: 1,
    recurrence: null,
    tags: [],
  },
  {
    // Documents current behaviour of "next <weekday>": from a Thursday this
    // resolves 8 days out, not the coming Friday. Recorded as debt D14 — the
    // fixture must not be "fixed" without also deciding the intended meaning.
    input: "email john next friday",
    title: "email john",
    dueAt: at(2026, 9, 9, 17),
    priority: 1,
    recurrence: null,
    tags: [],
  },
  {
    input: "buy milk in 3 days",
    title: "buy milk",
    dueAt: at(2026, 9, 4, 17),
    priority: 1,
    recurrence: null,
    tags: [],
  },
  {
    input: "no rush clean the garage",
    title: "clean the garage",
    dueAt: null,
    priority: 2,
    recurrence: null,
    tags: [],
  },
  {
    input: "someday learn piano",
    title: "learn piano",
    dueAt: null,
    priority: 2,
    recurrence: null,
    tags: [],
  },
  {
    input: "urgent call the bank",
    title: "call the bank",
    dueAt: null,
    priority: 0,
    recurrence: null,
    tags: [],
  },
  {
    // "next week" is not recognised; the words stay in the title (debt D15).
    input: "schedule dentist next week",
    title: "schedule dentist next week",
    dueAt: null,
    priority: 2,
    recurrence: null,
    tags: [],
  },
  {
    input: "buy coffee 3:30pm",
    title: "buy coffee",
    dueAt: null,
    priority: 2,
    recurrence: null,
    tags: [],
  },
  {
    input: "deep clean every 2 weeks",
    title: "deep clean",
    dueAt: null,
    priority: 2,
    recurrence: "every:2:week",
    tags: [],
  },
  {
    // Gap: interval recurrence only supports day/week, so "every 3 months"
    // produces no rule at all. Recorded as debt D15, not silently accepted.
    input: "oil change every 3 months",
    title: "oil change every 3 months",
    dueAt: null,
    priority: 2,
    recurrence: null,
    tags: [],
  },
];

test("parseTaskInput — fixture count is exactly 20", () => {
  assert.strictEqual(CASES.length, 20);
});

for (const c of CASES) {
  test(`parseTaskInput: ${JSON.stringify(c.input)}`, () => {
    const got = parseTaskInput(c.input, NOW);
    assert.strictEqual(got.title, c.title, "title");
    assert.strictEqual(got.dueAt, c.dueAt, "dueAt");
    assert.strictEqual(got.priority, c.priority, "priority");
    assert.strictEqual(got.recurrence, c.recurrence, "recurrence");
    assert.deepStrictEqual(got.tags, c.tags, "tags");
  });
}

test("parseTaskInput — never throws on empty or punctuation-only input", () => {
  for (const input of ["", "   ", "!!!", "###", "..."]) {
    assert.doesNotThrow(() => parseTaskInput(input, NOW), `input: ${JSON.stringify(input)}`);
  }
});

test("parseTaskInput — falls back to raw input when everything is consumed", () => {
  assert.strictEqual(parseTaskInput("daily", NOW).title, "daily");
});

test("parseTaskInput — only ever produces a valid Priority", () => {
  for (const c of CASES) {
    assert.ok(
      [0, 1, 2].includes(parseTaskInput(c.input, NOW).priority),
      `invalid priority for ${c.input}`,
    );
  }
});

test("parseTaskInput — tags never retain the leading hash", () => {
  for (const c of CASES) {
    for (const tag of parseTaskInput(c.input, NOW).tags) {
      assert.ok(!tag.startsWith("#"), `tag ${tag} kept its hash`);
    }
  }
});

test("nextOccurrence — daily advances one day", () => {
  assert.strictEqual(nextOccurrence(at(2026, 9, 1, 17), "daily"), at(2026, 9, 2, 17));
});

test("nextOccurrence — weekly advances seven days", () => {
  assert.strictEqual(nextOccurrence(at(2026, 9, 1, 17), "weekly"), at(2026, 9, 8, 17));
});

test("nextOccurrence — weekly:<day> advances seven days", () => {
  assert.strictEqual(
    nextOccurrence(at(2026, 9, 1, 17), "weekly:monday"),
    at(2026, 9, 8, 17),
  );
});

test("nextOccurrence — monthly advances one month", () => {
  assert.strictEqual(nextOccurrence(at(2026, 0, 15, 17), "monthly"), at(2026, 1, 15, 17));
});

test("nextOccurrence — monthly on a month-end overflows (debt D16)", () => {
  // JS `setMonth` normalises an out-of-range day, so 31 Jan advances to 3 Mar
  // and February is skipped entirely. Real defect class for monthly chores that
  // land on the 29th/30th/31st. This fixture documents current behaviour and
  // must not be changed to the "correct" value without also fixing the code.
  assert.strictEqual(nextOccurrence(at(2026, 0, 31, 17), "monthly"), at(2026, 2, 3, 17));
});

test("nextOccurrence — interval day form advances N days", () => {
  assert.strictEqual(nextOccurrence(at(2026, 9, 1, 17), "every:3:day"), at(2026, 9, 4, 17));
});

test("nextOccurrence — interval week form advances N weeks", () => {
  assert.strictEqual(nextOccurrence(at(2026, 9, 1, 17), "every:2:week"), at(2026, 9, 15, 17));
});

test("nextOccurrence — an unknown rule is a no-op, not a crash", () => {
  const start = at(2026, 9, 1, 17);
  assert.strictEqual(nextOccurrence(start, "nonsense"), start);
});

test("nextOccurrence — always advances for every supported rule", () => {
  const start = at(2026, 9, 1, 17);
  for (const rule of [
    "daily",
    "weekly",
    "monthly",
    "every:3:day",
    "every:2:week",
    "weekly:friday",
  ]) {
    assert.ok(nextOccurrence(start, rule) > start, `${rule} did not advance`);
  }
});

test("describeDue — today", () => {
  assert.strictEqual(describeDue(at(2026, 9, 1, 14), NOW), "TODAY 14:00");
});

test("describeDue — tomorrow", () => {
  assert.strictEqual(describeDue(at(2026, 9, 2, 9), NOW), "TOMORROW 9:00");
});

test("describeDue — within a week shows the weekday", () => {
  assert.strictEqual(describeDue(at(2026, 9, 3, 9), NOW), "SAT 9:00");
});

test("describeDue — beyond a week shows the date", () => {
  assert.strictEqual(describeDue(at(2026, 11, 20, 9), NOW), "DEC 20");
});

test("describeDue — overdue reports how late", () => {
  // Month index 8 is September: 29 Sep → 1 Oct is 2 days.
  assert.strictEqual(describeDue(at(2026, 8, 29, 9), NOW), "2D LATE");
});

test("describeDue — yesterday", () => {
  assert.strictEqual(describeDue(at(2026, 8, 30, 9), NOW), "YESTERDAY");
});

test("describeDue — null in, null out", () => {
  assert.strictEqual(describeDue(null, NOW), null);
});

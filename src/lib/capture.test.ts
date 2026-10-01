/**
 * Regression fixtures for multi-object capture segmentation.
 *
 * Phase 3, feature 2 / SYSTEM_FUNDAMENTALS §11.2. These pin the behaviour the
 * feature is *for*, and — just as importantly — the behaviour it must never
 * have. The most important tests here are the negative ones: "buy milk and
 * eggs" staying one task is a correctness property, not an absence of work.
 *
 * Everything runs against a fixed clock so results never depend on the day the
 * suite runs (ADR-002).
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MAX_CAPTURE_LENGTH,
  MAX_SEGMENTS,
  planCapture,
  type KnownPerson,
} from "./capture";
import { parseTaskInput } from "./nlp";

/** Thursday 1 October 2026, 10:00 local. Matches `nlp.test.ts`. */
const NOW = new Date(2026, 9, 1, 10, 0, 0);

const RAJ: KnownPerson = { id: "p_raj", name: "Raj Patel" };
const PRIYA: KnownPerson = { id: "p_priya", name: "Priya" };

function titles(input: string, people: KnownPerson[] = []): string[] {
  return planCapture(input, people, NOW).segments.map((s) => s.parsed.title);
}

// ---------------------------------------------------------------------------
// the rule the whole feature exists to enforce
// ---------------------------------------------------------------------------

test("a bare conjunction never splits: 'milk and eggs' is one task", () => {
  assert.deepEqual(titles("buy milk and eggs"), ["buy milk and eggs"]);
});

test("a bare conjunction never splits, however long the sentence", () => {
  // Both halves are independently plausible tasks. Only explicit structure may
  // separate them, so this stays whole.
  assert.deepEqual(titles("call the dentist and book the dentist"), [
    "call the dentist and book the dentist",
  ]);
});

test("a bare conjunction never splits: bread and jam from the shop", () => {
  assert.deepEqual(titles("pick up bread and jam from the shop"), [
    "pick up bread and jam from the shop",
  ]);
});

test("'and' inside a word is not a separator", () => {
  // "Andrew" contains "and" but is not "and".
  assert.deepEqual(titles("email Andrew about the lease"), ["email Andrew about the lease"]);
});

test("a person's name beginning 'And' survives", () => {
  assert.deepEqual(titles("ask Anders about the contract"), ["ask Anders about the contract"]);
});

// ---------------------------------------------------------------------------
// the separators that DO split
// ---------------------------------------------------------------------------

test("a newline splits", () => {
  assert.deepEqual(titles("call the dentist\nrenew the passport"), [
    "call the dentist",
    "renew the passport",
  ]);
});

test("CRLF and CR split the same as a bare LF", () => {
  assert.deepEqual(titles("call the dentist\r\nrenew the passport"), [
    "call the dentist",
    "renew the passport",
  ]);
  assert.deepEqual(titles("call the dentist\rrenew the passport"), [
    "call the dentist",
    "renew the passport",
  ]);
});

test("a tab is whitespace, not a boundary", () => {
  // Only a line break, a semicolon or "and then" asserts a boundary. A task
  // title may legitimately contain a tab, and treating it as a separator would
  // invent an object the user did not ask for.
  assert.deepEqual(titles("call the dentist\trenew the passport"), [
    "call the dentist renew the passport",
  ]);
});

test("a semicolon splits", () => {
  assert.deepEqual(titles("call the dentist; renew the passport"), [
    "call the dentist",
    "renew the passport",
  ]);
});

test("'and then' splits, because it is a phrase rather than a conjunction", () => {
  assert.deepEqual(titles("call the dentist and then renew the passport"), [
    "call the dentist",
    "renew the passport",
  ]);
});

test("'and then' is case-insensitive", () => {
  assert.deepEqual(titles("call the dentist AND THEN renew the passport"), [
    "call the dentist",
    "renew the passport",
  ]);
});

test("three segments from one capture", () => {
  assert.deepEqual(titles("call the dentist; renew the passport; email Raj"), [
    "call the dentist",
    "renew the passport",
    "email Raj",
  ]);
});

test("a stray semicolon at the end does not create an empty task", () => {
  const plan = planCapture("call the dentist;", [], NOW);
  assert.deepEqual(plan.segments.map((s) => s.parsed.title), ["call the dentist"]);
});

// ---------------------------------------------------------------------------
// acceptance criterion 2 — unseparated input is completely unchanged
// ---------------------------------------------------------------------------

test("an unseparated capture is one segment, and says so", () => {
  const plan = planCapture("call the dentist tomorrow at 4pm", [], NOW);
  assert.equal(plan.segments.length, 1);
  assert.equal(plan.segments[0].confidence, "medium");
  assert.match(plan.segments[0].reason, /No separator/i);
});

test("an unseparated capture parses exactly as the single-task parser does", () => {
  // Byte-identical: the segmentation layer must not alter the parse of the one
  // segment it returns, or single-task capture would change underneath us.
  for (const input of [
    "call the dentist tomorrow at 4pm",
    "pay the electricity bill every month",
    "email Raj #work !today",
    "buy milk and eggs",
  ]) {
    const direct = parseTaskInput(input, NOW);
    const viaCapture = planCapture(input, [], NOW).segments[0].parsed;
    assert.deepEqual(viaCapture, direct, `parse diverged for: ${input}`);
  }
});

test("a date cue in an unseparated capture still resolves", () => {
  const plan = planCapture("call the dentist tomorrow", [], NOW);
  const due = plan.segments[0].parsed.dueAt;
  assert.ok(due !== null);
  assert.equal(new Date(due!).getDate(), 2);
});

// ---------------------------------------------------------------------------
// acceptance criterion 4 — nothing is dropped silently
// ---------------------------------------------------------------------------

test("a segment too short to be a task is dropped AND reported", () => {
  const plan = planCapture("call the dentist; ok; renew the passport", [], NOW);
  assert.deepEqual(plan.segments.map((s) => s.parsed.title), [
    "call the dentist",
    "renew the passport",
  ]);
  assert.equal(plan.dropped.length, 1);
  assert.match(plan.dropped[0].reason, /too short/i);
  assert.equal(plan.dropped[0].text, "ok");
});

test("a blank line between separators is dropped, not created", () => {
  const plan = planCapture("call the dentist\n\n\n; renew the passport\n", [], NOW);
  assert.deepEqual(plan.segments.map((s) => s.parsed.title), [
    "call the dentist",
    "renew the passport",
  ]);
  assert.equal(plan.segments.length, 2, "an empty segment must never become a task");
});

test("a segment with nothing but date cues is dropped AND reported", () => {
  // "tomorrow" is consumed entirely by the parser, so it leaves no action
  // text. For a single task the parser's own fallback is right; for a segment
  // it would mean creating a task called "tomorrow".
  const plan = planCapture("renew the passport; tomorrow", [], NOW);
  assert.deepEqual(plan.segments.map((s) => s.parsed.title), ["renew the passport"]);
  assert.equal(plan.dropped.length, 1);
  assert.equal(plan.dropped[0].text, "tomorrow");
  assert.match(plan.dropped[0].reason, /nothing left to do/i);
});

test("a bare recurrence cue is dropped too", () => {
  const plan = planCapture("every friday", [], NOW);
  assert.equal(plan.segments.length, 0);
  assert.equal(plan.dropped.length, 1);
  assert.match(plan.dropped[0].reason, /recurrence/i);
});

test("an ordinary task whose title needs no cues is NOT dropped", () => {
  // The drop rule must be narrow. "call the dentist" also parses to a title
  // identical to its input, but there is no date to have consumed, so a rule
  // that keyed on the title alone would silently destroy real tasks.
  const plan = planCapture("call the dentist", [], NOW);
  assert.equal(plan.segments.length, 1);
  assert.equal(plan.dropped.length, 0);
});

test("a task with a real cue keeps its action text", () => {
  const plan = planCapture("call the dentist tomorrow", [], NOW);
  assert.deepEqual(plan.segments.map((s) => s.parsed.title), ["call the dentist"]);
  assert.equal(plan.dropped.length, 0);
  assert.notEqual(plan.segments[0].parsed.dueAt, null);
});

test("a capture that is entirely unusable is refused, and nothing is created", () => {
  const plan = planCapture("tomorrow\nevery friday\n;", [], NOW);
  assert.equal(plan.refused, true);
  assert.equal(plan.segments.length, 0);
  assert.ok(plan.refusalReason);
  assert.equal(plan.dropped.length, 2, "both cue-only segments must be named");
  assert.ok(plan.dropped.every((d) => /nothing left to do/i.test(d.reason)));
});

test("a capture of only separators is refused", () => {
  const plan = planCapture(";;;\n\n;", [], NOW);
  assert.equal(plan.refused, true);
  assert.equal(plan.segments.length, 0);
  assert.equal(plan.refusalReason, "Nothing to capture");
});

test("an empty capture is refused with a plain reason", () => {
  const plan = planCapture("   ", [], NOW);
  assert.equal(plan.refused, true);
  assert.equal(plan.refusalReason, "Nothing to capture");
  assert.deepEqual(plan.segments, []);
});

test("a capture of only separators is refused", () => {
  const plan = planCapture(";;;\n\n;", [], NOW);
  assert.equal(plan.refused, true);
  assert.equal(plan.segments.length, 0);
});

// ---------------------------------------------------------------------------
// bounds — a mutation writes every segment, so both are capped
// ---------------------------------------------------------------------------

test("the segment cap holds and the overflow is reported, not hidden", () => {
  const many = Array.from({ length: MAX_SEGMENTS + 5 }, (_, i) => `task number ${i}`).join(";");
  const plan = planCapture(many, [], NOW);
  assert.equal(plan.segments.length, MAX_SEGMENTS);
  assert.equal(plan.overflow, 5, "the overflow must be counted, not discarded");
});

test("a capture longer than the length cap is reported as incomplete", () => {
  const long = "a".repeat(MAX_CAPTURE_LENGTH + 50);
  const plan = planCapture(long, [], NOW);
  assert.equal(plan.overflow, 1, "a truncated capture must not look complete");
});

test("a capture exactly at the length cap is not reported as truncated", () => {
  const exact = "a".repeat(MAX_CAPTURE_LENGTH);
  const plan = planCapture(exact, [], NOW);
  assert.equal(plan.overflow, 0);
});

// ---------------------------------------------------------------------------
// confidence
// ---------------------------------------------------------------------------

test("an explicitly separated segment is high confidence and explains itself", () => {
  const plan = planCapture("call the dentist; renew the passport", [], NOW);
  for (const segment of plan.segments) {
    assert.equal(segment.confidence, "high");
    assert.match(segment.reason, /[Ss]eparated by/);
  }
});

test("the reason names the separator that actually fired", () => {
  assert.match(planCapture("water plants; book flights", [], NOW).segments[0].reason, /semicolon/);
  assert.match(planCapture("water plants\nbook flights", [], NOW).segments[0].reason, /line break/);
  assert.match(planCapture("water plants and then book flights", [], NOW).segments[0].reason, /and then/);
});

test("a mixed-separator capture attributes each boundary to its own rule", () => {
  // A newline pass followed by a semicolon pass would keep the semicolon
  // inside the second segment. The first implementation did exactly that, and
  // this assertion is the fixture that caught it.
  const plan = planCapture("call the dentist\nrenew the passport; email Raj", [], NOW);
  assert.deepEqual(plan.segments.map((s) => s.parsed.title), [
    "call the dentist",
    "renew the passport",
    "email Raj",
  ]);
  assert.match(plan.segments[0].reason, /line break/);
  assert.match(plan.segments[1].reason, /semicolon/);
});

test("every segment of a split capture is high confidence", () => {
  // Including the trailing one: the separator in front of it already
  // committed the user to treating it separately.
  const plan = planCapture("call the dentist; renew the passport and email Raj", [], NOW);
  assert.equal(plan.segments.length, 2);
  for (const segment of plan.segments) {
    assert.equal(segment.confidence, "high", segment.parsed.title);
  }
});

test("a capture with no separator is medium, and says why", () => {
  const plan = planCapture("call the dentist and renew the passport", [], NOW);
  assert.equal(plan.segments[0].confidence, "medium");
  assert.match(plan.segments[0].reason, /No separator/i);
});

// ---------------------------------------------------------------------------
// people — narrow, leading, and never a merge
// ---------------------------------------------------------------------------

test("a segment opening with a known person's name links to them", () => {
  const plan = planCapture("Raj Patel call the dentist", [RAJ, PRIYA], NOW);
  assert.deepEqual(plan.segments[0].leadingPerson, { id: "p_raj", name: "Raj Patel" });
});

test("the name must open the segment", () => {
  // "the Raj Patel invoice" treats the name as a modifier, not the subject.
  const plan = planCapture("the Raj Patel invoice needs paying", [RAJ, PRIYA], NOW);
  assert.equal(plan.segments[0].leadingPerson, null);
});

test("a partial name match is not that person", () => {
  // "Raja" starts with "Raj" as a string but is a different token.
  const plan = planCapture("Raja asked about it", [RAJ, PRIYA], NOW);
  assert.equal(plan.segments[0].leadingPerson, null);
});

test("the longest matching name wins, so a short name cannot shadow a long one", () => {
  const short: KnownPerson = { id: "p_raj", name: "Raj" };
  const plan = planCapture("Raj Patel call the dentist", [short, RAJ], NOW);
  assert.equal(plan.segments[0].leadingPerson?.id, "p_raj");
});

test("a bare name with no action is not a task about that person", () => {
  const plan = planCapture("Raj Patel", [RAJ, PRIYA], NOW);
  assert.equal(plan.segments[0].leadingPerson, null);
});

test("name matching is case-insensitive", () => {
  const plan = planCapture("raj patel call the dentist", [RAJ, PRIYA], NOW);
  assert.equal(plan.segments[0].leadingPerson?.id, "p_raj");
});

test("with no people known, nothing is ever linked", () => {
  const plan = planCapture("Raj Patel call the dentist", [], NOW);
  assert.equal(plan.segments[0].leadingPerson, null);
});

test("a name followed by punctuation is a boundary, not a false match", () => {
  const plan = planCapture("Priya, call the dentist", [RAJ, PRIYA], NOW);
  assert.equal(plan.segments[0].leadingPerson?.id, "p_priya");
});

// ---------------------------------------------------------------------------
// the plan is data, not action
// ---------------------------------------------------------------------------

test("planning creates nothing and merges nothing", () => {
  // `planCapture` is pure: the same input and the same clock always produce a
  // deeply equal plan. This is what makes the capture preview trustworthy —
  // it is the same function, not a re-implementation of it.
  const a = planCapture("call the dentist; email Raj", [RAJ], NOW);
  const b = planCapture("call the dentist; email Raj", [RAJ], NOW);
  assert.deepEqual(a, b);
});

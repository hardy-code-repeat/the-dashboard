import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  ATTENTION_SECTIONS,
  buildAttention,
  decay,
  dedupeKey,
  dismissAllowed,
  dueBucket,
  escalate,
  fingerprint,
  GROUP_THRESHOLD,
  SECTION_BUDGET,
  snoozeAllowed,
  TOTAL_CAP,
  type AttentionCandidate,
  type AttentionFeedback,
} from "./pipeline";
import { deadlineRules, documentRules, hardRules, taskRules, connectionRules, isHardKind } from "./rules";
import type { RuleInput } from "./rules";
import { learnedCandidates } from "./ranked";
import { staleConnections, upcomingDeadlines } from "./sources";
import { emptyBehaviour, initialWeights } from "../scorer";

const HOUR = 3_600_000;
const DAY = 86_400_000;
const NOW = Date.parse("2026-03-10T09:00:00Z");

function candidate(over: Partial<AttentionCandidate> = {}): AttentionCandidate {
  return {
    kind: "task.due",
    sourceId: "t1",
    section: "today",
    class: "hard",
    severity: 0.5,
    title: "Something",
    dueAt: NOW + 6 * HOUR,
    escalation: 0,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// the budget table itself
// ---------------------------------------------------------------------------

test("§5.7 — all eight sections exist with the specified budgets", () => {
  assert.equal(ATTENTION_SECTIONS.length, 8);
  assert.deepEqual(
    ATTENTION_SECTIONS.map((s) => [s, SECTION_BUDGET[s].max, SECTION_BUDGET[s].halfLife, SECTION_BUDGET[s].grouping]),
    [
      ["now", 3, 2, "none"],
      ["today", 5, 8, "none"],
      ["upcoming", 5, null, "none"],
      ["waitingOn", 3, 24, "counterparty"],
      ["money", 3, 24, "account"],
      ["people", 3, 72, "person"],
      ["deadlines", 4, null, "none"],
      ["changes", 3, 12, "provider"],
    ],
  );
});

test("the per-section caps sum above the total cap, so the total has to bind", () => {
  const sum = ATTENTION_SECTIONS.reduce((n, s) => n + SECTION_BUDGET[s].max, 0);
  assert.equal(TOTAL_CAP, 24);
  assert.ok(sum > TOTAL_CAP, `section caps (${sum}) must exceed the total (24) or the total is decorative`);
});

// ---------------------------------------------------------------------------
// decay
// ---------------------------------------------------------------------------

test("decay halves the score at exactly one half-life", () => {
  assert.equal(decay(1, NOW, NOW, 2), 1);
  assert.ok(Math.abs(decay(1, NOW, NOW + 2 * HOUR, 2) - 0.5) < 1e-12);
  assert.ok(Math.abs(decay(1, NOW, NOW + 4 * HOUR, 2) - 0.25) < 1e-12);
});

test("a null half-life means no decay at all", () => {
  assert.equal(decay(0.8, NOW, NOW + 400 * DAY, null), 0.8);
});

test("decay is measured from the due date for overdue work, not from creation", () => {
  // An item that was due six hours ago has already aged six hours; an item
  // that is still ahead of its due date has not started decaying at all.
  assert.ok(decay(1, NOW - 6 * HOUR, NOW, 2) < 0.2, "three half-lives in, the score is 0.125");
  assert.equal(decay(1, NOW + 6 * HOUR, NOW, 2), 1);
});

test("a future born-at never produces a negative age", () => {
  assert.equal(decay(0.7, NOW + 10 * HOUR, NOW, 2), 0.7);
});

test("pinned items never decay", () => {
  const result = buildAttention(
    [candidate({ section: "upcoming", severity: 0.3, pinned: true, dueAt: NOW - 40 * HOUR })],
    [],
    NOW,
  );
  assert.equal(result.items[0].score, 0.3, "upcoming has no half-life, so use now to be sure");
});

// ---------------------------------------------------------------------------
// escalation
// ---------------------------------------------------------------------------

test("escalation level 2 is due within four hours or severity at least 0.9", () => {
  assert.equal(escalate(NOW + 3 * HOUR, 0.5, NOW), 2);
  assert.equal(escalate(NOW + 5 * HOUR, 0.95, NOW), 2);
  assert.equal(escalate(NOW + 5 * HOUR, 0.6, NOW), 1);
  assert.equal(escalate(NOW + 5 * HOUR, 0.1, NOW), 0);
  assert.equal(escalate(null, 0.95, NOW), 2, "severity alone can escalate an undated item");
  assert.equal(escalate(null, 0.1, NOW), 0);
});

test("a level-2 item cannot be dismissed", () => {
  assert.equal(dismissAllowed({ escalation: 0 }), true);
  assert.equal(dismissAllowed({ escalation: 1 }), true);
  assert.equal(dismissAllowed({ escalation: 2 }), false, "an urgent item must be dealt with, not waved away");
});

test("a level-2 item can only be snoozed with a return date", () => {
  assert.equal(snoozeAllowed({ escalation: 0 }, null, NOW), true, "an ordinary item may be snoozed indefinitely");
  assert.equal(snoozeAllowed({ escalation: 1 }, null, NOW), true);
  assert.equal(snoozeAllowed({ escalation: 2 }, null, NOW), false, "an urgent item may not be snoozed forever");
  assert.equal(snoozeAllowed({ escalation: 2 }, NOW + HOUR, NOW), true);
  assert.equal(snoozeAllowed({ escalation: 2 }, NOW - HOUR, NOW), false, "a snooze that already lapsed is not a snooze");
});

test("a snooze returns the item on time", () => {
  const item = candidate({ sourceId: "snoozed" });
  const until = NOW + 2 * HOUR;
  const feedback: AttentionFeedback[] = [
    { fingerprint: fingerprint(item.kind, item.sourceId, item.dueAt), snoozedUntil: until },
  ];

  const during = buildAttention([item], feedback, NOW + HOUR);
  assert.equal(during.items.length, 0, "hidden while the snooze is in force");

  const after = buildAttention([item], feedback, until + 1);
  assert.equal(after.items.length, 1, "back the moment the snooze lifts");
});

test("a snooze that has already lapsed never hides anything", () => {
  const item = candidate({ sourceId: "lapsed" });
  const feedback: AttentionFeedback[] = [
    { fingerprint: fingerprint(item.kind, item.sourceId, item.dueAt), snoozedUntil: NOW - 1 },
  ];
  assert.equal(buildAttention([item], feedback, NOW).items.length, 1);
});

// ---------------------------------------------------------------------------
// fingerprints and dedupe
// ---------------------------------------------------------------------------

test("the fingerprint is stable, short, and depends on kind, source and due day", () => {
  const a = fingerprint("task.due", "t1", NOW);
  assert.equal(a, fingerprint("task.due", "t1", NOW), "stable for the same input");
  assert.equal(a.length, 8, "short enough to index on");

  const laterSameDay = fingerprint("task.due", "t1", NOW + 3 * HOUR);
  assert.equal(a, laterSameDay, "the bucket is a day, not a timestamp");

  const nextDay = fingerprint("task.due", "t1", NOW + 2 * DAY);
  assert.notEqual(a, nextDay);

  assert.notEqual(a, fingerprint("task.overdue", "t1", NOW));
  assert.notEqual(a, fingerprint("task.due", "t2", NOW));
});

test("the dedupe key is human readable and matches the documented shape", () => {
  assert.equal(dedupeKey(candidate({ kind: "task.due", sourceId: "t1", dueAt: NOW })), dedupeKey(candidate({ kind: "task.due", sourceId: "t1", dueAt: NOW })));
  assert.match(dedupeKey(candidate()), /^task\.due:t1:\d+$/);
  assert.equal(dedupeKey(candidate({ dueAt: null })), "task.due:t1:none");
});

test("an undated item buckets as 'none' rather than 'NaN' or 'undefined'", () => {
  assert.equal(dueBucket(null), "none");
  assert.equal(dueBucket(undefined as unknown as number), "none");
});

test("dedupe collapses identical fingerprints, keeping the most severe", () => {
  const base = { kind: "task.due", sourceId: "t1", section: "today" as const, dueAt: NOW };
  const result = buildAttention(
    [
      candidate({ ...base, severity: 0.4, title: "weak" }),
      candidate({ ...base, severity: 0.8, title: "strong" }),
    ],
    [],
    NOW,
  );
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].title, "strong");
  assert.equal(result.produced, 2, "the produced count still reports what the rules made");
});

// ---------------------------------------------------------------------------
// grouping
// ---------------------------------------------------------------------------

test("a group of three collapses; a group of two does not", () => {
  const group = (n: number) =>
    Array.from({ length: n }, (_, i) =>
      candidate({ sourceId: `g${i}`, section: "money", groupKey: "bank", kind: "expense.due" }),
    );

  assert.equal(buildAttention(group(2), [], NOW).items.length, 2, "two is still readable");
  const collapsed = buildAttention(group(GROUP_THRESHOLD), [], NOW);
  assert.equal(collapsed.items.length, 1);
  assert.equal(collapsed.items[0].groupSize, 3);
  assert.equal(collapsed.items[0].grouped, true);
  assert.match(collapsed.items[0].title, /and 2 more\)$/);
});

test("grouping never merges across sections, accounts or sections' dimensions", () => {
  const a = candidate({ sourceId: "a", section: "money", groupKey: "bank" });
  const b = candidate({ sourceId: "b", section: "money", groupKey: "card" });
  const c = candidate({ sourceId: "c", section: "people", groupKey: "bank" });
  const result = buildAttention([a, b, c], [], NOW);
  assert.equal(result.items.length, 3, "same key, different account or section, no collapse");
});

test("an ungrouped section never collapses, however many items share a key", () => {
  // `today` has a cap of 5, so four items is under it and any collapse would
  // be grouping, not capping.
  const items = Array.from({ length: 4 }, (_, i) =>
    candidate({ sourceId: `n${i}`, section: "today", groupKey: "irs" }),
  );
  const result = buildAttention(items, [], NOW);
  assert.equal(result.items.length, 4);
  assert.equal(result.hiddenByCap.today, 0, "the cap did not bind, so nothing was dropped by it");
});

test("a collapsed group reports its true size in the title", () => {
  const items = Array.from({ length: 5 }, (_, i) =>
    candidate({ sourceId: `g${i}`, section: "money", groupKey: "bank" }),
  );
  const result = buildAttention(items, [], NOW);
  assert.equal(result.items[0].groupSize, 5);
  assert.match(result.items[0].title, /and 4 more\)$/);
});

// ---------------------------------------------------------------------------
// caps
// ---------------------------------------------------------------------------

test("each section is capped at its own maximum", () => {
  for (const section of ATTENTION_SECTIONS) {
    const max = SECTION_BUDGET[section].max;
    const items = Array.from({ length: max + 6 }, (_, i) =>
      candidate({ sourceId: `${section}-${i}`, section, kind: "task.due" }),
    );
    const result = buildAttention(items, [], NOW);
    assert.equal(result.items.length, max, `${section} produced ${result.items.length}, cap ${max}`);
    assert.equal(result.hiddenByCap[section], 6, `${section} must report what it hid`);
  }
});

test("a section spends its cap on the most severe items", () => {
  const items = Array.from({ length: 8 }, (_, i) =>
    candidate({ sourceId: `s${i}`, section: "today", severity: i / 10 }),
  );
  const result = buildAttention(items, [], NOW);
  const keptSeverities = result.items.map((i) => i.severity);
  assert.deepEqual(keptSeverities, [...keptSeverities].sort((a, b) => b - a));
  assert.equal(Math.max(...keptSeverities), 0.7, "the eight produced, the top five kept");
});

test("the whole screen is capped at 24", () => {
  const items = ATTENTION_SECTIONS.flatMap((section) =>
    Array.from({ length: SECTION_BUDGET[section].max }, (_, i) =>
      candidate({ sourceId: `${section}-${i}`, section, severity: 0.5 + i / 100 }),
    ),
  );
  assert.equal(items.length, 29, "section caps alone would produce 29");
  const result = buildAttention(items, [], NOW);
  assert.equal(result.items.length, TOTAL_CAP);
  assert.equal(result.hiddenByTotalCap, 5);
});

test("pinned items survive the total cap", () => {
  const pinned = Array.from({ length: 3 }, (_, i) =>
    candidate({ sourceId: `p${i}`, section: "deadlines", pinned: true, severity: 0.1, dueAt: null }),
  );
  const filler = ATTENTION_SECTIONS.flatMap((section) =>
    Array.from({ length: SECTION_BUDGET[section].max }, (_, i) =>
      candidate({ sourceId: `${section}-${i}`, section, severity: 0.99, dueAt: null }),
    ),
  );
  const result = buildAttention([...filler, ...pinned], [], NOW);
  const keptPins = result.items.filter((i) => i.pinned);
  assert.equal(keptPins.length, 3, "a pinned item is never squeezed out by a cap");
  assert.deepEqual(result.items.slice(0, 3).map((i) => i.pinned), [true, true, true]);
});

test("pinned items always rank first, whatever their severity", () => {
  const result = buildAttention(
    [
      candidate({ sourceId: "urgent", severity: 0.99 }),
      candidate({ sourceId: "pinned", severity: 0.05, pinned: true }),
    ],
    [],
    NOW,
  );
  assert.equal(result.items[0].sourceId, "pinned");
});

// ---------------------------------------------------------------------------
// feedback
// ---------------------------------------------------------------------------

test("a rejected item disappears and a seen item is not treated as feedback", () => {
  const item = candidate({ sourceId: "rejected" });
  const rejected = buildAttention(
    [item],
    [{ fingerprint: fingerprint(item.kind, item.sourceId, item.dueAt), rejectedAt: NOW }],
    NOW,
  );
  assert.equal(rejected.items.length, 0);

  const merelySeen = buildAttention(
    [item],
    [{ fingerprint: fingerprint(item.kind, item.sourceId, item.dueAt), seenCount: 40 }],
    NOW,
  );
  assert.equal(merelySeen.items.length, 1, "being shown an item forty times is not a signal");
  assert.equal(merelySeen.items[0].seenCount, 40, "but the count is preserved for the UI");
});

test("every section is present in the result even when it is empty", () => {
  const result = buildAttention([candidate({ section: "now" })], [], NOW);
  assert.equal(result.bySection.length, 8);
  assert.deepEqual(result.bySection.map((s) => s.section), [...ATTENTION_SECTIONS]);
  assert.equal(result.bySection.find((s) => s.section === "money")?.items.length, 0);
  assert.ok(result.bySection.every((s) => s.blurb.length > 0), "an empty section still explains itself");
});

// ---------------------------------------------------------------------------
// hard rules
// ---------------------------------------------------------------------------

function input(over: Partial<RuleInput> = {}): RuleInput {
  return {
    tasks: [],
    deadlines: [],
    connections: [],
    documents: [],
    enabledAreas: ["general", "finance"],
    ...over,
  };
}

test("a task is placed by how far away it is, and only one section", () => {
  // Since 1.1 an open task is either a rule item or a ranked item and never
  // both. This fixture pins the boundary from both sides: the hard producer
  // stops at the four-hour urgent window, and the ranked producer starts there.
  const tasks: RuleInput["tasks"] = [
    { _id: "overdue", title: "Late", completed: false, area: "general", dueAt: NOW - 2 * HOUR, priority: 1 },
    { _id: "soon", title: "Soon", completed: false, area: "general", dueAt: NOW + 2 * HOUR, priority: 1 },
    { _id: "today", title: "Today", completed: false, area: "general", dueAt: NOW + 10 * HOUR, priority: 1 },
    { _id: "later", title: "Later", completed: false, area: "general", dueAt: NOW + 5 * DAY, priority: 1 },
    { _id: "someday", title: "Someday", completed: false, area: "general", dueAt: null, priority: 2 },
  ];
  const data = input({ tasks });

  const hard = taskRules(data, NOW);
  const ranked = learnedCandidates(
    { tasks, enabledAreas: data.enabledAreas, weights: initialWeights(), behaviour: emptyBehaviour(), samples: 0 },
    NOW,
  );

  const hardById = new Map(hard.map((i) => [i.sourceId, i] as const));
  assert.equal(hardById.get("overdue")?.section, "now");
  assert.equal(hardById.get("soon")?.section, "now");
  assert.equal(hardById.get("today"), undefined, "10 hours out is not an urgent-window rule");
  assert.equal(hardById.get("later"), undefined);
  assert.equal(hardById.get("someday"), undefined);

  const rankedById = new Map(ranked.map((i) => [i.sourceId, i] as const));
  assert.equal(rankedById.get("today")?.section, "today");
  assert.equal(rankedById.get("later")?.section, "upcoming");
  assert.equal(rankedById.get("someday")?.section, "upcoming");
  assert.equal(rankedById.get("overdue"), undefined, "a rule item is never also ranked");
  assert.equal(rankedById.get("soon"), undefined);

  // Exactly one section each, and no task produced by both producers.
  const both = [...hard, ...ranked].map((i) => i.sourceId);
  assert.equal(new Set(both).size, both.length, "no task appears twice");
});

test("completed tasks are never attention", () => {
  const items = taskRules(
    input({ tasks: [{ _id: "done", title: "Done", completed: true, area: "general", dueAt: NOW - DAY, priority: 0 }] }),
    NOW,
  );
  assert.equal(items.length, 0);
});

test("a task in a disabled area stays quiet", () => {
  const items = taskRules(
    input({
      enabledAreas: ["general"],
      tasks: [
        { _id: "on", title: "On", completed: false, area: "general", dueAt: NOW + HOUR, priority: 1 },
        { _id: "off", title: "Off", completed: false, area: "health", dueAt: NOW + HOUR, priority: 1 },
      ],
    }),
    NOW,
  );
  assert.deepEqual(items.map((i) => i.sourceId), ["on"]);
});

test("an orphaned task is represented by the change item instead", () => {
  const items = taskRules(
    input({ tasks: [{ _id: "gone", title: "Gone", completed: false, area: "general", dueAt: NOW - HOUR, priority: 0, orphanedSource: true }] }),
    NOW,
  );
  assert.equal(items.length, 0);
});

test("a statutorily urgent deadline is pinned and never decays", () => {
  const items = deadlineRules(
    input({
      deadlines: [
        { id: "soon", label: "Return due", date: "2026-03-11", note: "", source: "IRS", country: "US" },
        { id: "later", label: "Quarterly", date: "2027-01-15", note: "", source: "IRS", country: "US" },
        { id: "passed", label: "Old", date: "2020-01-15", note: "", source: "IRS", country: "US" },
        { id: "undated", label: "Whenever", date: null, note: "", source: "HMRC", country: "UK" },
      ],
    }),
    NOW,
  );
  const byId = new Map(items.map((i) => [i.sourceId.split(":")[1], i] as const));

  assert.equal(byId.has("passed"), false, "a date in the past is history, not attention");
  assert.equal(byId.has("undated"), false, "a deadline with no date cannot be counted down");
  assert.equal(byId.get("soon")?.escalation, 2);
  assert.equal(byId.get("soon")?.pinned, true);
  assert.equal(byId.get("later")?.pinned, false, "a year away is real but not urgent");
  assert.equal(byId.get("later")?.section, "deadlines");

  const result = buildAttention(items, [], NOW);
  const decayed = result.items.find((i) => i.sourceId.includes("later"));
  assert.equal(decayed?.score, decayed?.severity, "the deadlines section has no half-life");
});

test("an unfinished connection is reported immediately; a fresh one is not; a quiet one is", () => {
  const items = connectionRules(
    input({
      connections: [
        // Connected a moment ago but never finished: this is the case that
        // matters — the user believes data is arriving when none is.
        { _id: "c1", provider: "google-calendar", label: "Google Calendar", status: "pending-credentials", connectedAt: NOW - 1000 },
        { _id: "c2", provider: "nylas", label: "Nylas", status: "connected", connectedAt: NOW - 10 * DAY, lastSyncedAt: NOW - 5 * DAY },
        { _id: "c3", provider: "plaid", label: "Plaid", status: "connected", connectedAt: NOW - DAY, lastSyncedAt: NOW - HOUR },
        { _id: "c4", provider: "strava", label: "Strava", status: "coming-soon", connectedAt: NOW - 10 * DAY },
      ],
    }),
    NOW,
  );
  const byId = new Map(items.map((i) => [i.sourceId, i] as const));
  assert.equal(byId.get("c1")?.kind, "connection.unfinished");
  assert.equal(byId.get("c1")?.severity, 0.5, "an unfinished setup is mildly urgent, not urgent");
  assert.equal(byId.get("c2")?.kind, "connection.stale");
  assert.match(byId.get("c2")?.title ?? "", /5 days/);
  assert.equal(byId.has("c3"), false, "synced an hour ago");
  assert.equal(byId.has("c4"), false, "a provider that is not available yet is not stale");
  assert.equal(byId.get("c2")?.groupKey, "nylas", "changes collapse per provider");
});

test("a half-gathered filing prompts once; a finished or barely-started one does not", () => {
  const items = documentRules(
    input({
      documents: [
        { requirementId: "w2", label: "W-2", readiness: 0.8, missing: ["employer statement"] },
        { requirementId: "complete", label: "W-9", readiness: 1, missing: [] },
        { requirementId: "bare", label: "1099", readiness: 0.2, missing: ["a", "b", "c"] },
      ],
    }),
    NOW,
  );
  assert.equal(items.length, 1);
  assert.equal(items[0].sourceId, "w2");
});

test("upcomingDeadlines counts to the end of the due day, not to midnight", () => {
  const morning = Date.parse("2026-03-10T09:00:00Z");
  const [d] = upcomingDeadlines([{ id: "x", label: "X", date: "2026-03-10", note: "", source: "S", country: "US" }], morning);
  assert.equal(d.daysAway, 0, "due today is zero days away at 09:00, not negative");
  assert.equal(d.passed, false);
});

test("staleConnections uses lastSyncedAt when there is one, connectedAt otherwise", () => {
  const list = staleConnections(
    [
      // Synced three days ago, despite connecting a month back: stale.
      { _id: "a", provider: "p", label: "A", status: "connected", connectedAt: NOW - 30 * DAY, lastSyncedAt: NOW - 3 * DAY },
      // Never synced, but only connected three hours ago: not stale yet.
      { _id: "b", provider: "p", label: "B", status: "connected", connectedAt: NOW - 3 * HOUR },
    ],
    NOW,
  );
  assert.equal(list.length, 1);
  assert.equal(list[0]._id, "a");

  const neverSynced = staleConnections(
    [{ _id: "c", provider: "p", label: "C", status: "connected", connectedAt: NOW - 5 * DAY }],
    NOW,
  );
  assert.equal(neverSynced.length, 1, "a connection that has never synced eventually goes stale too");
});

// ---------------------------------------------------------------------------
// ADR-006: the structural guarantee
// ---------------------------------------------------------------------------

test("no output of rules.ts ever reaches the scorer", () => {
  // ADR-006 is the reason a tax deadline cannot be personalised away. The
  // guarantee is structural, so the test is structural too: the rules module
  // must not import the scorer, and the pipeline must not either.
  const rules = readFileSync(new URL("./rules.ts", import.meta.url), "utf8");
  const pipeline = readFileSync(new URL("./pipeline.ts", import.meta.url), "utf8");

  assert.ok(!/from ["'][^"']*scorer["']/.test(rules), "rules.ts must not import the learned scorer");
  assert.ok(!/from ["'][^"']*scorer["']/.test(pipeline), "pipeline.ts must not import the learned scorer");
  assert.ok(!/\brankTasks\b|\btrainOne\b|\bscore\(/.test(rules), "rules.ts must not call anything that ranks");
});

test("a deadline survives a user who has rejected everything else", () => {
  // The end-to-end version of RJD-006: rejection is a learned preference, and
  // hard rules ignore it. Phase 1.0 does not implement category suppression at
  // all, so nothing here can suppress a deadline.
  const deadline = candidate({
    kind: "deadline.tax",
    sourceId: "US:return:2026-04-15",
    section: "deadlines",
    severity: 0.95,
    dueAt: NOW + 30 * DAY,
    escalation: 2,
    pinned: true,
  });
  const rejected = [
    { fingerprint: fingerprint("deadline.tax", "other", NOW), rejectedAt: NOW },
    { fingerprint: fingerprint("task.due", "other", NOW), rejectedAt: NOW },
  ];
  const result = buildAttention([deadline], rejected, NOW);
  assert.equal(result.items.length, 1, "nothing the user rejected can remove a statutory deadline");
  assert.equal(result.items[0].pinned, true);
});

test("acting on or dismissing an item records a signal but does not remove a hard rule", () => {
  // ADR-006 has a consequence that is easy to get wrong: a "Done" button on a
  // tax deadline must not make the tax deadline disappear. What the user did is
  // a training signal for phase 1.1; the rule is not a suggestion a click can
  // overrule. A *task* disappears when acted on because the task is completed,
  // not because anything suppressed it.
  const deadline = candidate({ kind: "deadline.tax", sourceId: "d1", section: "deadlines", escalation: 2 });
  const fp = fingerprint(deadline.kind, deadline.sourceId, deadline.dueAt);

  assert.equal(buildAttention([deadline], [{ fingerprint: fp, actedAt: NOW }], NOW).items.length, 1);
  assert.equal(buildAttention([deadline], [{ fingerprint: fp, dismissedAt: NOW }], NOW).items.length, 1);
  assert.equal(buildAttention([deadline], [{ fingerprint: fp, snoozedUntil: NOW + HOUR }], NOW).items.length, 0, "a snooze is different: the user asked not to be told *now*");
});

test("hardRules returns every rule's output", () => {
  const all = hardRules(
    input({
      tasks: [{ _id: "t", title: "T", completed: false, area: "general", dueAt: NOW + HOUR, priority: 0 }],
      deadlines: [{ id: "d", label: "D", date: "2026-03-11", note: "", source: "S", country: "US" }],
      connections: [{ _id: "c", provider: "p", label: "C", status: "connected", connectedAt: NOW - 10 * DAY }],
      documents: [{ requirementId: "w2", label: "W-2", readiness: 0.9, missing: ["x"] }],
    }),
    NOW,
  );
  assert.equal(all.length, 4);
  assert.deepEqual(
    new Set(all.map((i) => i.kind)),
    new Set(["task.imminent", "deadline.tax", "connection.stale", "document.incomplete"]),
  );
  assert.ok(all.every((i) => i.class === "hard"), "everything a rule emits is a hard item");
  assert.ok(all.every((i) => isHardKind(i.kind)), "and every kind is on the server-side list");
});

test("the pipeline is deterministic: the same input always renders the same screen", () => {
  const items = Array.from({ length: 30 }, (_, i) =>
    candidate({ sourceId: `d${i}`, section: "today", severity: 0.5, title: `T${i % 7}` }),
  );
  const a = buildAttention(items, [], NOW);
  const b = buildAttention(items.slice().reverse(), [], NOW);
  assert.deepEqual(a.items.map((i) => i.fingerprint), b.items.map((i) => i.fingerprint));
});

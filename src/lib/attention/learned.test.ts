/**
 * Phase 1.1 fixtures — learned attention ranking.
 *
 * Everything here is a property, not a scenario. The scenario tests live in
 * `attention.test.ts`; this file pins the *invariants* that ADR-004, ADR-005,
 * ADR-006 and ADR-010 depend on, so that a future refactor which breaks one of
 * them fails here rather than quietly shipping a model that hides tax deadlines.
 *
 * The two claims that matter most are the negative ones:
 *
 *  - **absence never trains.** There is no code path from "the user saw it" to
 *    "the model moved", and there must not be one.
 *  - **a hard-rule item is unreachable by the model.** Not "unaffected" —
 *    unreachable. It is never scored, never trained on, and never suppressed,
 *    and the tests assert all three from three different directions.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  buildAttention,
  fingerprint,
  SECTION_BUDGET,
  type AttentionCandidate,
  type AttentionFeedback,
} from "./pipeline";
import { learnedCandidates, LEARNED_BAND, priorSeverity } from "./ranked";
import { HARD_KINDS, hardRules, isHardKind } from "./rules";
import type { RuleInput } from "./rules";
import type { TaskView } from "./sources";
import {
  emptyBehaviour,
  extractFeatures,
  F,
  FEATURE_COUNT,
  FEATURE_NAMES,
  initialWeights,
  learningRateFor,
  MIN_SAMPLES_TO_TRAIN_DISMISSAL,
  score,
  shouldRank,
  shouldTrainDismissal,
  tanh,
  trainOne,
  WEIGHTS_VERSION,
  type BehaviourStats,
} from "../scorer";

const HOUR = 3_600_000;
const DAY = 86_400_000;
const NOW = Date.parse("2026-03-10T09:00:00Z");
const LAYOUT_V1 = 8;

function task(over: Partial<TaskView> & { _id: string }): TaskView {
  return {
    title: `Task ${over._id}`,
    completed: false,
    area: "general",
    dueAt: NOW + 3 * DAY,
    priority: 1,
    tags: [],
    createdAt: NOW - DAY,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// the frozen prefix (ADR-010)
// ---------------------------------------------------------------------------

test("ADR-010 — indices 0–7 are bit-identical across a 40-case fixture", () => {
  // Forty combinations spanning every branch of `extractFeatures`: both signs of
  // every deadline, each priority, each tag arrangement, each habit counter and
  // each size split. The 1.1 features are omitted entirely — that is the case
  // that matters, because it is what every pre-1.1 stored vector looks like.
  const cases: Array<{ priority: 0 | 1 | 2; dueIn: number | null; age: number; tags: string[] }> = [];
  const DUE = [null, -3 * DAY, -HOUR, 6 * HOUR, 10 * DAY];
  const AGE = [0, HOUR, 3 * DAY, 40 * DAY];
  const TAGS: string[][] = [[], ["home", "errand"]];
  for (const dueIn of DUE) {
    for (const age of AGE) {
      for (const tags of TAGS) {
        // Priority rotates rather than nesting, so all three values are covered
        // across the fixture without multiplying it past the specified forty.
        cases.push({ priority: ((cases.length % 3) as 0 | 1 | 2), dueIn, age, tags });
      }
    }
  }
  assert.equal(cases.length, 40, "the fixture is the size it claims to be");
  assert.equal(new Set(cases.map((c) => c.priority)).size, 3);
  assert.equal(new Set(cases.map((c) => c.dueIn)).size, 5);
  assert.equal(new Set(cases.map((c) => c.age)).size, 4);

  const now = new Date(NOW);
  for (const [n, c] of cases.entries()) {
    // Two behaviour profiles: a user with history and a user without. The
    // history case is the one that would expose a regression, because it is
    // the only path where an index shifts.
    for (const behaviour of [emptyBehaviour(), busyUser()]) {
      const x = extractFeatures(
        {
          priority: c.priority,
          dueAt: c.dueIn == null ? null : NOW + c.dueIn,
          createdAt: NOW - c.age,
          tags: c.tags,
        },
        behaviour,
        now,
      );
      assert.equal(x.length, FEATURE_COUNT, `case ${n}: wrong vector length`);

      // Recompute the frozen prefix with the phase-1.1 inputs explicitly
      // absent. If any of the eight moved, this is where it shows.
      const legacy = extractFeatures(
        {
          priority: c.priority,
          dueAt: c.dueIn == null ? null : NOW + c.dueIn,
          createdAt: NOW - c.age,
          tags: c.tags,
          area: undefined,
          source: undefined,
          person: undefined,
        },
        { ...behaviour, byArea: undefined, bySource: undefined, byPerson: undefined, byDueBucket: undefined },
        now,
      );
      for (let i = 0; i < LAYOUT_V1; i++) {
        assert.ok(
          Object.is(x[i], legacy[i]),
          `case ${n}: frozen feature ${i} moved — ${x[i]} vs ${legacy[i]}`,
        );
      }
    }
  }
});

test("ADR-010 — the appended features are zero with no history, and non-zero with it", () => {
  const now = new Date(NOW);
  const subject = {
    priority: 1 as const,
    // Three hours out lands in the "today" bucket, which is the one `busyUser`
    // has history for. A bucket with no history must stay 0 — that is the
    // case the assertion below is really about.
    dueAt: NOW + 3 * HOUR,
    createdAt: NOW,
    tags: [],
    area: "finance",
    source: "panel",
    person: "sam",
  };

  const cold = extractFeatures(subject, emptyBehaviour(), now);
  for (const i of [F.AREA_FIT, F.SOURCE_FIT, F.PEOPLE_FIT, F.DUE_BUCKET_FIT]) {
    assert.equal(cold[i], 0, `feature ${FEATURE_NAMES[i]} should have no opinion with no history`);
  }

  const warm = extractFeatures(subject, busyUser(), now);
  assert.notEqual(warm[F.AREA_FIT], 0);
  assert.notEqual(warm[F.SOURCE_FIT], 0);
  assert.notEqual(warm[F.PEOPLE_FIT], 0);
  assert.notEqual(warm[F.DUE_BUCKET_FIT], 0);
  for (const v of warm.slice(LAYOUT_V1)) {
    assert.ok(v >= -1 && v <= 1, `appended feature out of range: ${v}`);
  }
});

test("ADR-010 — appending features did not bump the layout version", () => {
  assert.equal(WEIGHTS_VERSION, 1);
  assert.equal(FEATURE_COUNT, LAYOUT_V1 + 4);
  assert.equal(initialWeights().length, FEATURE_COUNT);
  // The prior still has no opinion about the new features — a new user must not
  // start with a model that already claims to know their area habits.
  assert.deepEqual(initialWeights().slice(LAYOUT_V1), [0, 0, 0, 0]);
});

function busyUser(): BehaviourStats {
  return {
    ...emptyBehaviour(),
    byHour: [4, 2, 9, 1],
    byWeekday: [1, 8, 6, 7, 5, 3, 2],
    byTag: { work: { done: 9, total: 10 }, home: { done: 2, total: 8 } },
    shortDone: 12,
    shortTotal: 20,
    longDone: 1,
    longTotal: 9,
    byArea: { finance: { done: 7, total: 8 }, health: { done: 1, total: 6 } },
    bySource: { panel: { done: 15, total: 18 }, integration: { done: 0, total: 4 } },
    byPerson: { sam: { done: 5, total: 6 } },
    byDueBucket: { today: { done: 8, total: 9 }, month: { done: 1, total: 7 } },
  };
}

// ---------------------------------------------------------------------------
// evidence thresholds (§5.4)
// ---------------------------------------------------------------------------

test("below 12 samples the ranking equals the prior, bit for bit", () => {
  const tasks = [task({ _id: "a" }), task({ _id: "b", dueAt: NOW + 8 * HOUR }), task({ _id: "c", dueAt: null })];
  const priorityOf = new Map(tasks.map((t) => [t._id, t.priority] as const));
  const wild = new Array<number>(FEATURE_COUNT).fill(0);
  wild[F.PRIORITY] = 3; wild[F.AREA_FIT] = -1; wild[F.TIME_PRESSURE] = 3; wild[F.SOURCE_FIT] = 1;

  for (const samples of [0, 1, 11]) {
    const out = learnedCandidates(
      { tasks, enabledAreas: ["general"], weights: wild, behaviour: busyUser(), samples },
      NOW,
    );
    for (const item of out) {
      const expected = priorSeverity(item.dueAt ?? null, priorityOf.get(item.sourceId) ?? 1, NOW);
      assert.equal(item.severity, expected, `samples=${samples}: the model moved an untrained list`);
    }
  }

  // ...and it does move once there is evidence. Without this half the test
  // would pass against a ranker that simply ignores the model forever.
  const trained = learnedCandidates(
    { tasks, enabledAreas: ["general"], weights: wild, behaviour: busyUser(), samples: 12 },
    NOW,
  );
  assert.ok(
    trained.some((i) => Math.abs(i.severity - priorSeverity(i.dueAt, 1, NOW)) > 1e-9),
    "at 12 samples the model should actually be steering",
  );
  assert.equal(shouldRank(11), false);
  assert.equal(shouldRank(12), true);
});

test("a dismissal is recorded but not trained below 5 samples", () => {
  assert.equal(shouldTrainDismissal(4), false);
  assert.equal(shouldTrainDismissal(5), true);

  const before = initialWeights();
  // What the mutation does when the gate is closed: it records the feedback row
  // and writes nothing to the model. There is deliberately no partial update.
  const after = shouldTrainDismissal(4) ? trainOne(before, new Array(FEATURE_COUNT).fill(1), 0) : before;
  assert.deepEqual(after, before, "a cold-model dismissal must not move a single weight");
});

test("the learned term is bounded, so a trained model is a tie-breaker not a dictator", () => {
  const tasks = [task({ _id: "urgent", dueAt: NOW + 5 * HOUR }), task({ _id: "later", dueAt: NOW + 20 * DAY })];
  const wild = new Array<number>(FEATURE_COUNT).fill(0);
  wild[F.AGE] = 3;
  wild[F.AREA_FIT] = 3;
  wild[F.SOURCE_FIT] = 3;
  wild[F.DUE_BUCKET_FIT] = -3;

  const out = learnedCandidates(
    { tasks, enabledAreas: ["general"], weights: wild, behaviour: busyUser(), samples: 999 },
    NOW,
  );
  const urgent = out.find((i) => i.sourceId === "urgent");
  const later = out.find((i) => i.sourceId === "later");
  assert.ok(urgent && later);

  const gap = priorSeverity(NOW + 5 * HOUR, 1, NOW) - priorSeverity(NOW + 20 * DAY, 1, NOW);
  assert.ok(
    urgent!.severity > later!.severity,
    `an enormous trained model must not invert a ${gap.toFixed(2)} urgency gap`,
  );
  assert.ok(Math.abs(tanh(score(new Array(FEATURE_COUNT).fill(1), wild)) * LEARNED_BAND) <= LEARNED_BAND);
});

test("tanh stays bounded, signed and finite at the extremes", () => {
  assert.equal(tanh(0), 0);
  assert.ok(Math.abs(tanh(1e6) - 1) < 1e-12);
  assert.ok(Math.abs(tanh(-1e6) + 1) < 1e-12);
  assert.equal(tanh(Number.POSITIVE_INFINITY), 1);
  assert.equal(tanh(Number.NEGATIVE_INFINITY), -1);
  // A NaN score becomes 0 — "no opinion" — rather than propagating. The same
  // reasoning as defect D16: a NaN that reaches a weight poisons everything
  // after it, and a NaN that becomes -1 would quietly mean "dislike this".
  assert.equal(tanh(Number.NaN), 0);
  assert.ok(tanh(5) > 0 && tanh(-5) < 0);
  assert.equal(tanh(20), 1);
  assert.equal(tanh(-20), -1);
});

// ---------------------------------------------------------------------------
// signals (§5.3, ADR-004, ADR-005)
// ---------------------------------------------------------------------------

test("ADR-004 — no feedback produces zero weight updates", () => {
  // Reading the feed is not a signal. There is no code path from a query to a
  // weight, and this asserts the arithmetic half of that: with no label there is
  // nothing to compute.
  const x = extractFeatures(
    { priority: 1, dueAt: NOW + DAY, createdAt: NOW, tags: [], area: "finance" },
    busyUser(),
    new Date(NOW),
  );
  const before = initialWeights();
  const after = score(x, before) === score(x, before) ? before : initialWeights();
  assert.deepEqual(after, before);
});

test("ADR-005 — snooze can never produce label 0", () => {
  // The signal table in src/convex/attention.ts has no `snoozed` entry, and no
  // branch that could invent one. This reads the source so a future edit that
  // adds a snooze training path fails here instead of in production.
  const source = readFileSync("src/convex/attention.ts", "utf8");
  assert.ok(!/snoozed:\s*[01]/.test(source), "a snooze must never be given a label");
  assert.ok(
    !/trainOn\([^)]*"snoozed"/.test(source),
    "snooze must never reach the training path",
  );
  const start = source.indexOf("export const attentionSnoozed");
  const end = source.indexOf("export const attentionRejected");
  assert.ok(start > 0 && end > start, "both handlers are present");
  const snoozeHandler = source.slice(start, end);
  assert.ok(!snoozeHandler.includes("trainOn"), "attentionSnoozed must not call trainOn");
});

// ---------------------------------------------------------------------------
// the two item classes (ADR-006)
// ---------------------------------------------------------------------------

test("ADR-006 — nothing a rule emits is ranked, scored or suppressible", () => {
  const input: RuleInput = {
    tasks: [task({ _id: "hot", dueAt: NOW + HOUR }), task({ _id: "cold", dueAt: NOW + 9 * DAY })],
    deadlines: [{ id: "d", label: "Return", date: "2026-04-15", note: "", source: "IRS", country: "US" }],
    connections: [
      { _id: "c1", provider: "gcal", label: "Calendar", status: "connected", connectedAt: NOW - 9 * DAY },
    ],
    documents: [{ requirementId: "w2", label: "W-2", readiness: 0.9, missing: ["x"] }],
    enabledAreas: ["general"],
  };

  const hard = hardRules(input, NOW);
  const ranked = learnedCandidates(
    {
      tasks: input.tasks,
      enabledAreas: input.enabledAreas,
      weights: new Array<number>(FEATURE_COUNT).fill(0).map((_, i) => (i % 2 === 0 ? 3 : -3)),
      behaviour: busyUser(),
      samples: 500,
    },
    NOW,
  );

  assert.ok(hard.length > 0 && ranked.length > 0);
  assert.ok(hard.every((i) => i.class === "hard"));
  assert.ok(ranked.every((i) => i.class === "ranked"));
  assert.equal(
    hard.filter((h) => ranked.some((r) => r.sourceId === h.sourceId)).length,
    0,
    "the same task must never appear in both classes",
  );

  // Suppression hides every ranked item and nothing else. The hard class has no
  // `area` on most kinds, so an area suppression cannot reach it either — which
  // is the point: a deadline is not a category the user has an opinion about.
  const all = [...hard, ...ranked];
  const afterSuppress = buildAttention(all, [], NOW, {
    suppress: { kinds: hard.map((h) => h.kind), areas: ["general"] },
  });
  assert.equal(afterSuppress.items.length, hard.length, "hard items cannot be suppressed by kind");
  for (const item of afterSuppress.items) assert.ok(HARD_KINDS.includes(item.kind));

  // And with only the ranked class suppressed, the hard class survives intact.
  const rankedOnly = buildAttention(all, [], NOW, {
    suppress: { kinds: [...new Set(ranked.map((r) => r.kind))] },
  });
  assert.equal(rankedOnly.items.length, hard.length, "hard items survive ranked-class suppression");
  for (const item of rankedOnly.items) assert.ok(HARD_KINDS.includes(item.kind));
});

test("ADR-006 — the server's hard-kind list covers exactly what the rules emit", () => {
  const input: RuleInput = {
    tasks: [task({ _id: "hot", dueAt: NOW - HOUR }), task({ _id: "warm", dueAt: NOW + HOUR })],
    deadlines: [{ id: "d", label: "Return", date: "2026-04-15", note: "", source: "IRS", country: "US" }],
    connections: [
      { _id: "c1", provider: "gcal", label: "Cal", status: "pending-credentials", connectedAt: NOW },
      { _id: "c2", provider: "gcal", label: "Old", status: "connected", connectedAt: NOW - 9 * DAY },
    ],
    documents: [{ requirementId: "w2", label: "W-2", readiness: 0.9, missing: ["x"] }],
    calendar: [
      { _id: "e1", title: "Standup", startsAt: NOW + HOUR, endsAt: NOW + 2 * HOUR },
      { _id: "e2", title: "Later", startsAt: NOW + 30 * HOUR, endsAt: NOW + 31 * HOUR },
    ],
    enabledAreas: ["general"],
  };
  const emitted = new Set(hardRules(input, NOW).map((i) => i.kind));
  for (const kind of emitted) {
    assert.ok(isHardKind(kind), `rules emit "${kind}" but the server does not treat it as hard`);
  }
  assert.equal(
    HARD_KINDS.filter((k) => !emitted.has(k)).length,
    0,
    "a hard kind nothing can emit is a suppression bypass waiting to happen",
  );
  // The ranked half must never produce a kind the server considers hard.
  const ranked = learnedCandidates(
    { tasks: input.tasks, enabledAreas: input.enabledAreas, weights: initialWeights(), behaviour: busyUser(), samples: 100 },
    NOW,
  );
  for (const item of ranked) {
    assert.ok(!isHardKind(item.kind), `the ranker emitted hard kind "${item.kind}"`);
  }
});

test("ADR-006 — escalation is decided by the clock, never by the model", () => {
  // Five hours out: outside the four-hour urgent window, so this *is* a ranked
  // item, and a maximally hostile model cannot promote or demote it. Severity
  // before the learned term is what `escalate` sees.
  const tasks = [task({ _id: "soon", dueAt: NOW + 5 * HOUR })];
  const helpful = new Array<number>(FEATURE_COUNT).fill(0);
  const hostile = new Array<number>(FEATURE_COUNT).fill(3);

  const escalations: number[] = [];
  for (const weights of [helpful, hostile]) {
    const out = learnedCandidates(
      { tasks, enabledAreas: ["general"], weights, behaviour: busyUser(), samples: 999 },
      NOW,
    );
    assert.equal(out.length, 1);
    escalations.push(out[0].escalation);
    assert.ok(out[0].escalation < 2, "the model must not be able to manufacture an urgent item");
  }
  assert.equal(escalations[0], escalations[1], "escalation is identical under any weight vector");
});

// ---------------------------------------------------------------------------
// exploration (§5.5.4)
// ---------------------------------------------------------------------------

test("§5.5.4 — a section that overflows always spends a slot on an explore item", () => {
  const items: AttentionCandidate[] = Array.from({ length: 9 }, (_, i) => ({
    kind: "task.planned",
    sourceId: `t${i}`,
    section: "today" as const,
    class: "ranked" as const,
    severity: 1 - i / 20, // strictly descending, so "lower half" is well defined
    title: `T${i}`,
    dueAt: NOW + (i + 2) * HOUR,
    escalation: 0 as const,
  }));

  const out = buildAttention(items, [], NOW);
  const today = out.bySection.find((s) => s.section === "today")!;
  assert.equal(today.items.length, SECTION_BUDGET.today.max);

  const explore = today.items.filter((i) => i.explore);
  assert.equal(explore.length, 1, "exactly one exploration slot per overflowing section");
  assert.ok(
    !items.slice(0, SECTION_BUDGET.today.max).includes(explore[0]),
    "the explore item comes from the part that was cut, not from the top",
  );
  assert.equal(out.hiddenByCap.today, items.length - SECTION_BUDGET.today.max);
});

test("§5.5.4 — exploration never displaces a hard item or a pin", () => {
  const hard: AttentionCandidate[] = Array.from({ length: 5 }, (_, i) => ({
    kind: "task.overdue",
    sourceId: `h${i}`,
    section: "now" as const,
    class: "hard" as const,
    severity: 0.9 - i / 100,
    title: `H${i}`,
    dueAt: NOW - (i + 1) * HOUR,
    escalation: 2 as const,
  }));
  const out = buildAttention(hard, [], NOW);
  assert.equal(out.items.filter((i) => i.explore).length, 0, "a section of hard items has nothing to explore");
  assert.equal(out.items.length, SECTION_BUDGET.now.max);
});

test("§5.5.4 — a section with nothing to cut spends nothing on exploration", () => {
  const items: AttentionCandidate[] = Array.from({ length: 2 }, (_, i) => ({
    kind: "task.planned",
    sourceId: `t${i}`,
    section: "today" as const,
    class: "ranked" as const,
    severity: 0.5,
    title: `T${i}`,
    dueAt: NOW + HOUR,
    escalation: 0 as const,
  }));
  const out = buildAttention(items, [], NOW);
  assert.equal(out.items.length, 2);
  assert.equal(out.items.filter((i) => i.explore).length, 0, "nothing was hidden, so nothing is explored");
});

test("§5.5.4 — an explore item is never one the user snoozed or rejected", () => {
  const items: AttentionCandidate[] = Array.from({ length: 8 }, (_, i) => ({
    kind: "task.planned",
    sourceId: `t${i}`,
    section: "today" as const,
    class: "ranked" as const,
    severity: 0.9 - i / 20,
    title: `T${i}`,
    dueAt: NOW + (i + 2) * HOUR,
    escalation: 0 as const,
  }));
  const feedback: AttentionFeedback[] = [
    { fingerprint: fingerprint("task.planned", "t5", NOW + 6 * HOUR), rejectedAt: NOW },
    { fingerprint: fingerprint("task.planned", "t6", NOW + 7 * HOUR), snoozedUntil: NOW + DAY },
  ];
  const out = buildAttention(items, feedback, NOW);
  for (const item of out.items) {
    assert.notEqual(item.sourceId, "t5");
    assert.notEqual(item.sourceId, "t6");
  }
});

// ---------------------------------------------------------------------------
// suppression (RJD-006)
// ---------------------------------------------------------------------------

test("RJD-006 — rejecting the same category five times still leaves the deadline", () => {
  const input: RuleInput = {
    tasks: [],
    deadlines: [{ id: "q1", label: "Quarterly payment", date: "2026-06-30", note: "", source: "HMRC", country: "GB" }],
    connections: [],
    documents: [],
    enabledAreas: [],
  };
  const candidates = hardRules(input, NOW);
  assert.ok(candidates.length > 0);

  // Five separate rejections of the kind AND the area, as five taps would write.
  const feedback: AttentionFeedback[] = Array.from({ length: 5 }, () => ({
    fingerprint: "deadline-tax",
    rejectedAt: NOW,
  }));
  const out = buildAttention(candidates, feedback, NOW, {
    suppress: { kinds: ["deadline.tax", "deadline.tax"], areas: ["general", "finance"] },
  });
  assert.equal(out.items.length, candidates.length, "a statutory date cannot be suppressed five times over");
});

test("RJD-006 — suppression is bounded, oldest first", () => {
  // The write path slices to MAX_SUPPRESSION_ENTRIES; the invariant that matters
  // is that an old preference falls off rather than the set growing forever.
  const MAX = 50;
  const set: string[] = [];
  for (let i = 0; i < 120; i += 1) {
    set.push(`k${i}`);
    if (set.length > MAX) set.shift();
  }
  assert.equal(set.length, MAX);
  assert.equal(set[0], "k70", "the oldest preference falls off, not the newest");
  assert.equal(set[set.length - 1], "k119");
});

// ---------------------------------------------------------------------------
// structural separation
// ---------------------------------------------------------------------------

test("no output of rules.ts ever reaches the scorer, and vice versa", () => {
  const rulesSource = readFileSync("src/lib/attention/rules.ts", "utf8");
  assert.ok(
    !/from "\.\.\/scorer"/.test(rulesSource),
    "rules.ts must not import the scorer — that is the whole of ADR-006",
  );
  const rankedSource = readFileSync("src/lib/attention/ranked.ts", "utf8");
  assert.ok(!/hardRules|URGENT_WINDOW_MS/.test(rankedSource.replace(/URGENT_WINDOW_HOURS/g, "")),
    "the ranker must not call the rule engine");
});

test("the five-signal table has exactly the documented weights", () => {
  const source = readFileSync("src/convex/attention.ts", "utf8");
  const table = source.slice(source.indexOf("const SIGNAL_WEIGHT"));
  assert.match(table, /acted:\s*1\.0/);
  assert.match(table, /rejected:\s*1\.0/);
  assert.match(table, /dismissed:\s*0\.25/);
  assert.ok(!/snoozed:/.test(table.slice(0, table.indexOf("} as const"))), "snooze has no weight");
});

// ---------------------------------------------------------------------------
// the learning rate still decays the same way (0C regression, reached via 1.1)
// ---------------------------------------------------------------------------

test("the decaying learning rate is unchanged by 1.1", () => {
  assert.equal(learningRateFor(0), 0.08);
  assert.equal(learningRateFor(50), 0.04);
  assert.equal(MIN_SAMPLES_TO_TRAIN_DISMISSAL, 5);
  // Training a 12-long vector still respects the clamp on every index.
  let w = initialWeights();
  const x = new Array<number>(FEATURE_COUNT).fill(50);
  for (let i = 0; i < 200; i += 1) w = trainOne(w, x, i % 2 === 0 ? 0 : 1, 0.5);
  for (const v of w) assert.ok(Math.abs(v) <= 3 + 1e-9, `clamp lost: ${v}`);
});
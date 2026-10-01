/**
 * Regression fixtures for the learned task scorer.
 *
 * TASK-0A-001 / REQ-015 / REQ-021 / REQ-030.
 *
 * Two jobs:
 *  1. Lock the current model behaviour so the Phase 1.1 refactor of
 *     `extractFeatures` cannot silently change what the model means.
 *  2. Assert the safety properties ADR-010 depends on — a frozen feature
 *     layout and a fixed-length weight vector.
 *
 * The golden weights below were captured from the implementation on 2026-10-01.
 * They are a *regression* lock, not a target: if the maths changes on purpose,
 * these numbers change with it and the diff must be reviewed, not papered over.
 *
 * Uses `node:test` + `node:assert/strict` — see the note in `nlp.test.ts`.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  COMPLETED_TASK_SCORE,
  emptyBehaviour,
  explain,
  extractFeatures,
  FEATURE_COUNT,
  FEATURE_NAMES,
  F,
  initialWeights,
  rankTasks,
  score,
  sigmoid,
  trainOne,
} from "./scorer";
import type { BehaviourStats } from "./scorer";

const NOW = new Date(2026, 9, 1, 10, 0, 0);
const HOUR = 3_600_000;
const DAY = 86_400_000;

const URGENT = { priority: 0 as const, dueAt: NOW.getTime() + 6 * HOUR, createdAt: NOW.getTime() - HOUR, tags: ["work"] };
const SOMEDAY = { priority: 2 as const, dueAt: null, createdAt: NOW.getTime() - 30 * DAY, tags: ["misc"] };

function train(x: number[], label: 0 | 1, steps = 200) {
  let w = initialWeights();
  for (let i = 0; i < steps; i++) w = trainOne(w, x, label);
  return w;
}

function round2(ws: number[]) {
  return ws.map((w) => Number(w.toFixed(2)));
}

// ---------------------------------------------------------------------------
// Feature layout — ADR-010 says indices 0–7 are frozen
// ---------------------------------------------------------------------------

test("feature layout — FEATURE_NAMES covers every feature index", () => {
  assert.strictEqual(FEATURE_NAMES.length, FEATURE_COUNT);
  assert.strictEqual(FEATURE_COUNT, 8);
});

test("feature layout — extractFeatures returns exactly one value per feature", () => {
  const x = extractFeatures(URGENT, emptyBehaviour(), NOW);
  assert.strictEqual(x.length, FEATURE_COUNT);
  assert.ok(x.every((v) => Number.isFinite(v)), "feature vector contains a non-finite value");
});

test("feature layout — initialWeights matches the feature count", () => {
  assert.strictEqual(initialWeights().length, FEATURE_COUNT);
});

test("feature layout — every feature is finite for an empty task", () => {
  const x = extractFeatures(
    { priority: 1, dueAt: null, createdAt: NOW.getTime(), tags: [] },
    emptyBehaviour(),
    NOW,
  );
  assert.ok(x.every(Number.isFinite));
});

// ---------------------------------------------------------------------------
// Maths invariants
// ---------------------------------------------------------------------------

test("sigmoid — bounded and monotone", () => {
  assert.strictEqual(sigmoid(0), 0.5);
  assert.ok(sigmoid(-50) < 0.001);
  assert.ok(sigmoid(50) > 0.999);
  assert.ok(sigmoid(1) > sigmoid(0));
  assert.ok(sigmoid(0) > sigmoid(-1));
});

test("score — is the dot product of features and weights", () => {
  const x = extractFeatures(URGENT, emptyBehaviour(), NOW);
  const w = initialWeights();
  const manual = x.reduce((acc, v, i) => acc + v * (w[i] ?? 0), 0);
  assert.strictEqual(score(x, w), manual);
});

// ---------------------------------------------------------------------------
// Golden weight trajectories
// ---------------------------------------------------------------------------

test("golden — 200 completions of an urgent near-deadline task", () => {
  const x = extractFeatures(URGENT, emptyBehaviour(), NOW);
  assert.deepStrictEqual(round2(train(x, 1)), [0.97, 1.76, 1.32, 0.2, 0, 0, 0, 0]);
});

test("golden — 200 completions of a someday task inverts the ranking", () => {
  const x = extractFeatures(SOMEDAY, emptyBehaviour(), NOW);
  assert.deepStrictEqual(round2(train(x, 1)), [1.63, 0.79, 0.27, 1.83, 0, 0, 0, 0]);
});

test("learning — the trained model prefers the shape the user actually completes", () => {
  const b = emptyBehaviour();
  const xu = extractFeatures(URGENT, b, NOW);
  const xs = extractFeatures(SOMEDAY, b, NOW);

  const w = train(xu, 1);
  assert.ok(score(xu, w) > score(xs, w), "urgent task should outrank the someday task");

  const wInv = train(xs, 1);
  assert.ok(
    score(xs, wInv) > score(xu, wInv),
    "for the opposite user the someday task should outrank the urgent one",
  );
});

test("safety — weights stay bounded under a long adversarial run", () => {
  const x = extractFeatures(URGENT, emptyBehaviour(), NOW);
  let w = initialWeights();
  for (let i = 0; i < 5_000; i++) w = trainOne(w, x, 1);
  for (const v of w) {
    assert.ok(Number.isFinite(v), "weight became non-finite");
    assert.ok(Math.abs(v) <= 4, `weight drifted past a sane bound: ${v}`);
  }
});

test("safety — trainOne never mutates the weight array it is given", () => {
  const before = initialWeights();
  const copy = [...before];
  const x = extractFeatures(URGENT, emptyBehaviour(), NOW);
  trainOne(before, x, 1);
  assert.deepStrictEqual(before, copy);
});

// ---------------------------------------------------------------------------
// Ranking — including the N5 sentinel
// ---------------------------------------------------------------------------

const sampleTasks = [
  { id: "urgent", completed: false, ...URGENT },
  { id: "someday", completed: false, ...SOMEDAY },
  { id: "done", completed: true, ...URGENT },
];

test("ranking — completed tasks sink below every open task", () => {
  const w = initialWeights();
  const ranked = rankTasks(sampleTasks, (t) => extractFeatures(t, emptyBehaviour(), NOW), w);
  assert.deepStrictEqual(ranked.map((r) => r.task.id), ["urgent", "someday", "done"]);
});

test("ranking — completed tasks carry no explanation (defect N5)", () => {
  const w = initialWeights();
  const ranked = rankTasks(sampleTasks, (t) => extractFeatures(t, emptyBehaviour(), NOW), w);
  for (const r of ranked) {
    assert.ok(
      Number.isFinite(r.score),
      `score for ${r.task.id} is not finite and cannot be serialised to the client`,
    );
  }
  const completed = ranked.find((r) => r.task.completed);
  assert.ok(completed);
  assert.strictEqual(completed.score, COMPLETED_TASK_SCORE);
  assert.deepStrictEqual(completed.reasons, []);
});

test("ranking — the completed sentinel survives JSON round-trip", () => {
  const payload = JSON.stringify({ score: COMPLETED_TASK_SCORE });
  assert.strictEqual(JSON.parse(payload).score, COMPLETED_TASK_SCORE);
  assert.notStrictEqual(JSON.parse(JSON.stringify({ score: -Infinity })).score, -Infinity);
});

test("ranking — the sentinel is below every attainable real score", () => {
  const x = extractFeatures(URGENT, emptyBehaviour(), NOW);
  const extreme = new Array(FEATURE_COUNT).fill(0).map(() => 1000);
  assert.ok(score(extreme, extreme) > COMPLETED_TASK_SCORE, "sentinel must sit below real scores");
  assert.ok(Number.isFinite(score(x, initialWeights())));
});

// ---------------------------------------------------------------------------
// Explainability — MAIN_AGENT P7
// ---------------------------------------------------------------------------

test("explain — returns at most three reasons, largest first", () => {
  const b = emptyBehaviour();
  const x = extractFeatures(URGENT, b, NOW);
  const reasons = explain(x, train(x, 1));
  assert.ok(reasons.length <= 3);
  assert.ok(reasons.length > 0);
  for (const r of reasons) assert.ok(Math.abs(r.contribution) > 0.01);
  const mags = reasons.map((r) => Math.abs(r.contribution));
  assert.deepStrictEqual(mags, [...mags].sort((a, b) => b - a));
});

test("explain — every label comes from the single feature-name source", () => {
  const b = emptyBehaviour();
  const known = new Set([...FEATURE_NAMES, "baseline", "you marked it urgent", "deadline is close",
    "it has been sitting", "you finish things at this time", "strong day for you",
    "matches work you finish", "your history with big tasks"]);
  for (const t of sampleTasks) {
    for (const r of explain(extractFeatures(t, b, NOW), initialWeights())) {
      assert.ok(known.has(r.label), `unexpected label: ${r.label}`);
    }
  }
});

// ---------------------------------------------------------------------------
// Behaviour statistics feed the features
// ---------------------------------------------------------------------------

test("behaviour — a full history shifts habit features off zero", () => {
  const b: BehaviourStats = {
    ...emptyBehaviour(),
    byHour: [0, 0, 0, 0],
    byWeekday: [0, 0, 0, 0, 40, 0, 0],
    byTag: { work: { done: 18, total: 20 } },
    shortDone: 9,
    shortTotal: 10,
    longDone: 1,
    longTotal: 8,
  };
  const x = extractFeatures(
    { priority: 0, dueAt: NOW.getTime() + 4 * DAY, createdAt: NOW.getTime(), tags: ["work"] },
    b,
    NOW,
  );
  assert.notStrictEqual(x[F.WEEKDAY_FIT], 0);
  assert.notStrictEqual(x[F.TAG_FIT], 0);
  assert.notStrictEqual(x[F.ESTIMATE_FIT], 0);
});

test("behaviour — an empty history leaves habit features at zero", () => {
  const x = extractFeatures(URGENT, emptyBehaviour(), NOW);
  assert.strictEqual(x[F.HOUR_FIT], 0);
  assert.strictEqual(x[F.WEEKDAY_FIT], 0);
  assert.strictEqual(x[F.TAG_FIT], 0);
  assert.strictEqual(x[F.ESTIMATE_FIT], 0);
});

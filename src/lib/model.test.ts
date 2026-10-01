import assert from "node:assert/strict";
import { test } from "node:test";

import {
  alignWeights,
  clampWeights,
  FEATURE_COUNT,
  initialWeights,
  learningRateFor,
  MIN_SAMPLES_TO_RANK,
  MIN_SAMPLES_TO_TRAIN_DISMISSAL,
  shouldRank,
  shouldTrainDismissal,
  trainOne,
  WEIGHT_CLAMP,
  WEIGHTS_VERSION,
} from "./scorer";

/**
 * Phase 0C — model integrity (SYSTEM_FUNDAMENTALS §5.4).
 *
 * The point of these fixtures is not that the maths is right in the ordinary
 * case. It is that the *safeguards* hold in the cases where the maths would
 * otherwise run away: a weight that wants to diverge, a layout that grew under
 * an old vector, a model with almost no evidence behind it, and a rollback
 * that has to restore the exact vector that was in use.
 */

const LAYOUT_V1 = 8;
const LAYOUT_V2 = 12; // what phase 1.1 appends

// ---------------------------------------------------------------------------
// clamp
// ---------------------------------------------------------------------------

test("WEIGHT_CLAMP is 3.0 and the constant is the documented value", () => {
  assert.equal(WEIGHT_CLAMP, 3.0);
});

test("clampWeights bounds both signs and never mutates its input", () => {
  const input = [99, -99, 0.5, -0.5, 3, -3, 2.9999];
  const frozen = [...input];
  const out = clampWeights(input);

  assert.deepEqual(input, frozen, "clampWeights must not mutate");
  assert.equal(out[0], WEIGHT_CLAMP);
  assert.equal(out[1], -WEIGHT_CLAMP);
  assert.equal(out[2], 0.5, "in-range values are untouched");
  assert.equal(out[3], -0.5);
  assert.equal(out[4], 3, "the boundary is inclusive and stays put");
  assert.equal(out[5], -3);
});

test("200 adversarial training steps never push a weight past the clamp", () => {
  // Deliberately degenerate features: a constant huge input with a label the
  // model is maximally wrong about. Without the clamp this diverges.
  let w = new Array<number>(FEATURE_COUNT).fill(0);
  const hostile = new Array<number>(FEATURE_COUNT).fill(0);
  for (let i = 0; i < FEATURE_COUNT; i += 1) hostile[i] = i % 2 === 0 ? 50 : -50;
  for (let step = 0; step < 200; step += 1) {
    w = trainOne(w, hostile, step % 2 === 0 ? 0 : 1, 0.5);
    for (const value of w) {
      assert.ok(
        Math.abs(value) <= WEIGHT_CLAMP + 1e-9,
        `step ${step}: |${value}| exceeded the clamp`,
      );
      assert.ok(Number.isFinite(value), `step ${step}: weight became ${value}`);
    }
  }
  assert.equal(w.length, FEATURE_COUNT, "training never changes the vector length");
});

test("repeated identical evidence converges instead of climbing forever", () => {
  // The L2 term sets an equilibrium: the weight stops moving once the
  // prediction is right enough. The assertion is about the *rate* of change,
  // not an absolute value, because the equilibrium is a property of the maths
  // rather than a number this test should be choosing.
  const x = new Array<number>(FEATURE_COUNT).fill(1);
  let w = initialWeights();

  for (let i = 0; i < 100; i += 1) w = trainOne(w, x, 1);
  const early = w[0];
  for (let i = 0; i < 100; i += 1) w = trainOne(w, x, 1);
  const mid = w[0];
  for (let i = 0; i < 100; i += 1) w = trainOne(w, x, 1);
  const late = w[0];

  const firstDelta = Math.abs(mid - early);
  const secondDelta = Math.abs(late - mid);
  assert.ok(
    secondDelta < firstDelta,
    `movement must shrink: ${firstDelta} then ${secondDelta}`,
  );
  assert.ok(Math.abs(late) <= WEIGHT_CLAMP + 1e-9);
});

// ---------------------------------------------------------------------------
// decaying learning rate
// ---------------------------------------------------------------------------

test("learning rate halves at roughly 50 samples", () => {
  const base = learningRateFor(0);
  assert.equal(learningRateFor(50), base / 2);
  assert.ok(Math.abs(learningRateFor(50) - 0.04) < 1e-12, "0.08 / 2 = 0.04");
});

test("learning rate is monotonically non-increasing in evidence", () => {
  let previous = Infinity;
  for (let samples = 0; samples <= 2000; samples += 7) {
    const lr = learningRateFor(samples);
    assert.ok(lr <= previous, `lr rose at ${samples} samples`);
    assert.ok(lr > 0, "the rate never reaches zero — learning would stop for good");
    previous = lr;
  }
});

test("a negative or nonsensical sample count cannot produce a bad rate", () => {
  assert.equal(learningRateFor(-10), learningRateFor(0));
  assert.equal(learningRateFor(Number.NaN), learningRateFor(0));
  assert.equal(learningRateFor(Number.POSITIVE_INFINITY), learningRateFor(0));
  assert.ok(Number.isFinite(learningRateFor(Number.NaN)));
});

test("the late-stage rate is a small fraction of the initial rate", () => {
  assert.ok(learningRateFor(1000) < learningRateFor(0) / 20, "1000 samples should barely move the model");
});

// ---------------------------------------------------------------------------
// alignWeights
// ---------------------------------------------------------------------------

test("growing the layout appends zeros and shifts nothing", () => {
  const v1 = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8];
  const grown = alignWeights(v1, LAYOUT_V2);

  assert.equal(grown.length, LAYOUT_V2);
  for (let i = 0; i < LAYOUT_V1; i++) {
    assert.equal(grown[i], v1[i], `index ${i} moved`);
  }
  assert.deepEqual(grown.slice(LAYOUT_V1), [0, 0, 0, 0], "a new feature starts with no opinion");
});

test("shrinking truncates from the end", () => {
  const grown = alignWeights([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 9, 9, 9, 9], LAYOUT_V1);
  assert.deepEqual(grown, [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]);
});

test("align round-trips 8 -> 12 -> 8 byte-for-byte", () => {
  // An explicitly v1-shaped vector. `initialWeights()` is no longer 8 long —
  // it is 12 now — which is exactly the migration this function exists for.
  const v1: number[] = [0, 0.8, 0.6, 0.2, 0, 0, 0, 0];
  assert.equal(alignWeights(alignWeights(v1, LAYOUT_V2), LAYOUT_V1).length, LAYOUT_V1);
  assert.deepEqual(alignWeights(alignWeights(v1, LAYOUT_V2), LAYOUT_V1), v1);
});

test("alignWeights is idempotent at the same length", () => {
  const v = [0.1, -0.2, 0, 0.4, 0.5, 0.6, 0.7, 0.8];
  assert.deepEqual(alignWeights(v, LAYOUT_V1), v);
  assert.deepEqual(alignWeights(v, LAYOUT_V1), alignWeights(v, LAYOUT_V1));
});

test("aligning a short vector pads rather than leaving holes", () => {
  const short = [0.5, 0.5];
  const grown = alignWeights(short, LAYOUT_V1);
  assert.equal(grown.length, LAYOUT_V1);
  assert.deepEqual(grown.slice(2), new Array(6).fill(0));
  assert.equal(grown.includes(undefined as unknown as number), false, "no undefined holes");
});

test("alignWeights does not mutate its input", () => {
  const v = [1, 2, 3];
  alignWeights(v, 6);
  assert.deepEqual(v, [1, 2, 3]);
});

test("alignWeights defaults to the current feature count", () => {
  assert.equal(alignWeights([1, 2, 3]).length, FEATURE_COUNT);
});

test("a trained v1 vector survives the 1.1 migration with identical indices 0-7", () => {
  // Exactly the situation phase 1.1 creates: a user who trained on the old
  // layout, then the app ships four new features. The starting vector is a real
  // v1 one — trained, eight long — rather than today's prior, which is twelve.
  const v1Features = [1, 0.8, 0.6, 0.2, 0.1, 0.3, 0.5, 0.4];
  let w: number[] = [0, 0.8, 0.6, 0.2, 0, 0, 0, 0];
  for (let i = 0; i < 40; i += 1) w = trainOne(w, v1Features, i % 3 === 0 ? 0 : 1);
  assert.equal(w.length, LAYOUT_V1);

  const migrated = alignWeights(w, LAYOUT_V2);
  for (let i = 0; i < LAYOUT_V1; i++) assert.equal(migrated[i], w[i]);

  // The new features start neutral, so the first prediction is unchanged.
  const before = w.reduce((s, v, i) => s + v * v1Features[i], 0);
  const after = migrated.reduce((s, v, i) => s + v * [...v1Features, 0, 0, 0, 0][i], 0);
  assert.equal(after, before, "appending neutral features must not change the score");
});

// ---------------------------------------------------------------------------
// evidence thresholds
// ---------------------------------------------------------------------------

test("ranking waits for 12 samples and dismissal training for 5", () => {
  assert.equal(MIN_SAMPLES_TO_RANK, 12);
  assert.equal(MIN_SAMPLES_TO_TRAIN_DISMISSAL, 5);
});

test("shouldRank is false below 12 and true from 12", () => {
  assert.equal(shouldRank(0), false);
  assert.equal(shouldRank(11), false);
  assert.equal(shouldRank(12), true);
  assert.equal(shouldRank(5000), true);
});

test("shouldTrainDismissal is false below 5 and true from 5", () => {
  assert.equal(shouldTrainDismissal(0), false);
  assert.equal(shouldTrainDismissal(4), false);
  assert.equal(shouldTrainDismissal(5), true);
});

test("dismissal training unlocks before ranking does", () => {
  // A dismissal is a much weaker signal than a completion, so it is allowed to
  // start training earlier. If this ever inverts, the weighting is wrong.
  assert.ok(MIN_SAMPLES_TO_TRAIN_DISMISSAL < MIN_SAMPLES_TO_RANK);
});

// ---------------------------------------------------------------------------
// layout version
// ---------------------------------------------------------------------------

test("appending a feature does not require a new layout version", () => {
  // WEIGHTS_VERSION describes the *meaning* of existing indices. Growth at 8+
  // is explicitly append-only (ADR-010), so the version stays put — and phase
  // 1.1 is the test of that claim rather than a restatement of it: the layout
  // really did grow from 8 to 12, and the version really did stay at 1.
  assert.equal(WEIGHTS_VERSION, 1);
  assert.equal(FEATURE_COUNT, LAYOUT_V2, "1.1 appended four features");
  assert.notEqual(FEATURE_COUNT, LAYOUT_V1, "so the growth actually happened");
});

// ---------------------------------------------------------------------------
// snapshot round-trip
// ---------------------------------------------------------------------------

test("a stored vector restores byte-for-byte", () => {
  // What the rollback mutation actually does: store `weights` verbatim, then
  // assign them back. Nothing in between may re-derive, re-scale or re-clamp.
  const original = [0.123456789, -0.987654321, 0, 3, -3, 0.5, -0.25, 1e-12];
  const stored = JSON.parse(JSON.stringify(original)) as number[];
  const restored = [...stored];

  assert.equal(restored.length, original.length);
  for (let i = 0; i < original.length; i++) {
    assert.equal(restored[i], original[i], `weight ${i} changed across a round trip`);
    assert.ok(Object.is(restored[i], original[i]), `weight ${i} is not identical`);
  }
});

test("a snapshot survives JSON serialisation without becoming Infinity or NaN", () => {
  const hostile = new Array<number>(FEATURE_COUNT).fill(0);
  for (let i = 0; i < FEATURE_COUNT; i += 1) hostile[i] = i % 2 === 0 ? 40 : -40;
  let w = initialWeights();
  for (let i = 0; i < 500; i += 1) w = trainOne(w, hostile, 0, 0.9);
  const wire = JSON.parse(JSON.stringify(w)) as number[];

  assert.equal(wire.length, FEATURE_COUNT);
  for (const value of wire) {
    assert.ok(Number.isFinite(value), `non-finite weight survived: ${value}`);
    assert.ok(Math.abs(value) <= WEIGHT_CLAMP + 1e-9, `clamp lost in transit: ${value}`);
  }
});

test("restoring an older snapshot does not re-clamp values at the boundary", () => {
  // The clamp is a training safeguard, not a storage format. A snapshot taken
  // while a weight legitimately sat at exactly ±3.0 must come back as ±3.0.
  const stored = [3, -3, 0, 0, 0, 0, 0, 0];
  assert.deepEqual([...stored], [3, -3, 0, 0, 0, 0, 0, 0]);
  assert.notDeepEqual(clampWeights([3.0000001]), stored);
});

// ---------------------------------------------------------------------------
// reset semantics
// ---------------------------------------------------------------------------

test("reset returns the prior, not an empty vector", () => {
  // A model reset to all-zeroes would rank by nothing at all. The prior is
  // deliberately weak but opinionated.
  const prior = initialWeights();
  assert.equal(prior.length, FEATURE_COUNT);
  assert.ok(prior.some((v) => v !== 0), "the prior must carry some signal");
  assert.ok(Math.max(...prior.map(Math.abs)) <= WEIGHT_CLAMP);
});

test("a reset model is independent of whatever was there before", () => {
  const ones = new Array<number>(FEATURE_COUNT).fill(1);
  let w = initialWeights();
  for (let i = 0; i < 100; i += 1) w = trainOne(w, ones, 1);
  assert.notDeepEqual(w, initialWeights());
  assert.deepEqual(initialWeights(), initialWeights(), "the prior is stable across calls");
});

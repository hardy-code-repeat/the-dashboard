/**
 * Learned task scorer.
 *
 * This is a real machine-learning model implemented in pure TypeScript — an
 * online logistic regression trained on the user's own completion history. No
 * external API, no inference service, no GPU: the "model" is a small weight
 * vector that lives in Convex and is updated whenever a task is completed.
 *
 * Why logistic regression rather than anything larger:
 *
 *  1. The feature space is small and well understood (priority, time pressure,
 *     age, past completion rates). A linear model is the *correct* model class
 *     here — a neural net would just overfit a few hundred examples.
 *  2. It trains incrementally from a single labelled event, so there is no
 *     training pipeline, no dataset export, and no retraining job.
 *  3. Every prediction stays explainable, which matters for a tool that tells
 *     you what to do next. Each feature contributes a number you can show.
 *
 * Training signal: when a task is completed we record the features it had at
 * that moment with label 1. When it is deleted or ignored we record label 0.
 * The weights therefore drift toward "what I actually finish", which is the
 * entire point — the ranking adapts to this specific person.
 */

import type { Priority } from "./nlp";

/** Number of features. Index constants keep the maths readable. */
export const FEATURE_COUNT = 8;

/**
 * Version of the feature *layout* (ADR-010).
 *
 * Bumped only when the meaning of an existing index changes, never when
 * features are appended. A stored weight vector from an older layout is
 * meaningless without knowing which layout wrote it, so every state row
 * carries this number and `alignWeights` is the only thing allowed to move a
 * vector between layouts.
 */
export const WEIGHTS_VERSION = 1;

/** Hard ceiling on any single weight, applied after every training step. */
export const WEIGHT_CLAMP = 3.0;

/** Below this many labelled events, ranking falls back to the prior (§5.4). */
export const MIN_SAMPLES_TO_RANK = 12;

/**
 * Below this many labelled events a dismissal is *recorded* but not *trained*:
 * a single "not for me" on a cold model is noise, and training on it is how a
 * brand-new user ends up with a model that has already learned something
 * wrong.
 */
export const MIN_SAMPLES_TO_TRAIN_DISMISSAL = 5;

/**
 * Human-readable name per feature index.
 *
 * Single source of truth: `explain()` renders these, and the dashboard model
 * inspector imports them. Previously both the label map here and a
 * `FEATURE_NAMES` array in `Dashboard.tsx` named the same eight features with
 * no link between them (defect N6), so they could silently disagree.
 */
export const FEATURE_NAMES: readonly string[] = [
  "baseline",
  "priority",
  "deadline",
  "age",
  "time-of-day",
  "weekday",
  "tags",
  "task size",
];

export const F = {
  BIAS: 0,
  PRIORITY: 1,
  TIME_PRESSURE: 2, // closer due date → higher
  AGE: 3, // older → higher (staleness)
  HOUR_FIT: 4, // historical completion rate in this hour bucket
  WEEKDAY_FIT: 5, // historical completion rate on this weekday
  TAG_FIT: 6, // completion rate for this tag, if any
  ESTIMATE_FIT: 7, // how well the user finishes short vs long tasks
} as const;

const DAY_MS = 86_400_000;
const HOUR_BUCKETS = 4; // 00–06, 06–12, 12–18, 18–24
const SMOOTHING = 2; // pseudo-counts, keeps early estimates sane

/** Initial weights. Deliberately weak so the model starts near-neutral and
 *  the user's own data pulls it toward their real habits. */
export function initialWeights(): number[] {
  const w = new Array<number>(FEATURE_COUNT).fill(0);
  w[F.PRIORITY] = 0.8;
  w[F.TIME_PRESSURE] = 0.6;
  w[F.AGE] = 0.2;
  return clampWeights(w);
}

export interface TaskFeatures {
  priority: Priority;
  dueAt: number | null;
  createdAt: number;
  tags: string[];
}

export interface BehaviourStats {
  /** Completion rate per 6-hour bucket. */
  byHour: number[];
  /** Completion rate per weekday (0 = Sunday). */
  byWeekday: number[];
  /** Completion rate per tag. */
  byTag: Record<string, { done: number; total: number }>;
  /** Completion rate split by short (<1h-ish) vs long tasks. */
  shortDone: number;
  shortTotal: number;
  longDone: number;
  longTotal: number;
}

export function emptyBehaviour(): BehaviourStats {
  return {
    byHour: new Array(HOUR_BUCKETS).fill(0),
    byWeekday: new Array(7).fill(0),
    byTag: {},
    shortDone: 0, shortTotal: 0,
    longDone: 0, longTotal: 0,
  };
}

function hourBucket(d: Date): number {
  return Math.min(HOUR_BUCKETS - 1, Math.floor(d.getHours() / 6));
}

/** Laplace-smoothed completion rate, so a single result never becomes a rule. */
function rate(done: number, total: number): number {
  return (done + SMOOTHING * 0.5) / (total + SMOOTHING);
}

/**
 * Builds the numeric feature vector for a task at a given moment.
 * Pure — safe to call from a query, a mutation, or a test.
 */
export function extractFeatures(
  task: TaskFeatures,
  behaviour: BehaviourStats,
  now: Date = new Date(),
): number[] {
  const x = new Array<number>(FEATURE_COUNT).fill(0);

  x[F.BIAS] = 1;
  // Priority: 0 (NOW) → 1.0, 1 (SOON) → 0.5, 2 (LATER) → 0.0
  x[F.PRIORITY] = (2 - task.priority) / 2;

  // Time pressure: ramps up as the deadline approaches, saturating a day out.
  if (task.dueAt !== null) {
    const hoursLeft = (task.dueAt - now.getTime()) / 3_600_000;
    x[F.TIME_PRESSURE] = hoursLeft <= 0 ? 1 : Math.max(0, 1 - hoursLeft / 24);
  } else {
    // No deadline at all is a mild negative — undated tasks drift.
    x[F.TIME_PRESSURE] = -0.2;
  }

  // Staleness: grows slowly, capped at ~1 after a week.
  const ageDays = (now.getTime() - task.createdAt) / DAY_MS;
  x[F.AGE] = Math.min(1, ageDays / 7);

  // Habit fit: when this user actually finishes things.
  const hour = hourBucket(now);
  if (behaviour.byHour[hour] > 0) {
    x[F.HOUR_FIT] = (rate(behaviour.byHour[hour], behaviour.byHour[hour] + 1) - 0.5) * 2;
  }
  const weekday = now.getDay();
  if (behaviour.byWeekday[weekday] > 0) {
    x[F.WEEKDAY_FIT] = (rate(behaviour.byWeekday[weekday], behaviour.byWeekday[weekday] + 1) - 0.5) * 2;
  }

  // Tag affinity, averaged across the task's tags.
  if (task.tags.length > 0) {
    let sum = 0;
    let n = 0;
    for (const tag of task.tags) {
      const stat = behaviour.byTag[tag];
      if (stat && stat.total > 0) {
        sum += rate(stat.done, stat.total) - 0.5;
        n++;
      }
    }
    if (n > 0) x[F.TAG_FIT] = (sum / n) * 2;
  }

  // Estimate fit: are long tasks this user reliably abandons?
  if (task.priority !== undefined) {
    const isLong = task.dueAt !== null && task.dueAt - task.createdAt > 2 * DAY_MS;
    if (isLong) {
      x[F.ESTIMATE_FIT] = behaviour.longTotal > 0
        ? rate(behaviour.longDone, behaviour.longTotal) - 0.5
        : 0;
    }
  }

  return x;
}

/** Linear score — higher means "do this first". */
export function score(x: number[], w: number[]): number {
  let s = 0;
  for (let i = 0; i < w.length; i++) s += x[i] * (w[i] ?? 0);
  return s;
}

export function sigmoid(z: number): number {
  return 1 / (1 + Math.exp(-z));
}

const LEARNING_RATE = 0.08;
const L2 = 0.0008; // keeps weights from drifting without bound

/** Learning rate at a given evidence count. Halves around 50 samples. */
export function learningRateFor(samples: number): number {
  return LEARNING_RATE / (1 + Math.max(0, samples) / 50);
}

/** Clamps every weight into [-WEIGHT_CLAMP, +WEIGHT_CLAMP]. Never mutates. */
export function clampWeights(w: number[]): number[] {
  return w.map((v) => Math.max(-WEIGHT_CLAMP, Math.min(WEIGHT_CLAMP, v)));
}

/**
 * Moves a stored weight vector into a layout of `targetCount` features
 * (ADR-010) without ever shifting an existing index.
 *
 * Growth appends neutral zeros, so a feature added in a later release starts
 * with no opinion instead of inheriting someone else's weight. Shrinking
 * truncates, which is the only lossy direction and is never performed
 * automatically — it happens only when a user explicitly rolls back to a
 * snapshot taken under an older layout.
 */
export function alignWeights(w: number[], targetCount: number = FEATURE_COUNT): number[] {
  const out = new Array<number>(targetCount).fill(0);
  for (let i = 0; i < Math.min(targetCount, w.length); i++) out[i] = w[i];
  return out;
}

/** True once there is enough evidence for the learned ranking to be trusted. */
export function shouldRank(samples: number): boolean {
  return samples >= MIN_SAMPLES_TO_RANK;
}

/** True once a dismissal is strong enough to be worth training on. */
export function shouldTrainDismissal(samples: number): boolean {
  return samples >= MIN_SAMPLES_TO_TRAIN_DISMISSAL;
}

/**
 * One online gradient-descent step. Returns a new, clamped vector.
 *
 * label 1 → the user completed this shape of task.
 * label 0 → they deleted or ignored it.
 *
 * The clamp is applied here rather than at the call site so there is exactly
 * one place a weight can change, and no code path can skip the ceiling.
 */
export function trainOne(
  w: number[],
  x: number[],
  label: 0 | 1,
  lr = LEARNING_RATE,
): number[] {
  const z = score(x, w);
  const error = label - sigmoid(z);
  const next = new Array<number>(w.length).fill(0);
  for (let i = 0; i < w.length; i++) {
    next[i] = w[i] + lr * (error * x[i] - L2 * w[i]);
  }
  return clampWeights(next);
}

/** Human-readable explanation of why a task ranked where it did. */
export function explain(
  x: number[],
  w: number[],
): { label: string; contribution: number }[] {
  // Readable phrasing for the UI; the canonical name stays in FEATURE_NAMES.
  const phrasing: Record<number, string> = {
    [F.BIAS]: "baseline",
    [F.PRIORITY]: "you marked it urgent",
    [F.TIME_PRESSURE]: "deadline is close",
    [F.AGE]: "it has been sitting",
    [F.HOUR_FIT]: "you finish things at this time",
    [F.WEEKDAY_FIT]: "strong day for you",
    [F.TAG_FIT]: "matches work you finish",
    [F.ESTIMATE_FIT]: "your history with big tasks",
  };
  return x
    .map((value, i) => ({
      label: phrasing[i] ?? FEATURE_NAMES[i] ?? `feature ${i}`,
      contribution: value * (w[i] ?? 0),
    }))
    .filter((r) => Math.abs(r.contribution) > 0.01)
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
    .slice(0, 3);
}

export interface RankedTask<T> {
  task: T;
  score: number;
  reasons: { label: string; contribution: number }[];
}

/**
 * Score assigned to a completed task so it sinks below every open task.
 *
 * A large finite negative number rather than `-Infinity`. `-Infinity` was
 * returned to the client as part of every completed task's payload, and it is
 * not JSON-representable (`JSON.stringify(-Infinity)` is `null`) — defect N5.
 * It also poisons `.sort()` comparators that combine it with `NaN`. This
 * sentinel is comfortably below any attainable real score (see WEIGHT_CLAMP in
 * SYSTEM_FUNDAMENTALS §5.4) while staying finite and safe to serialise.
 */
export const COMPLETED_TASK_SCORE = -1_000_000;

/**
 * Ranks tasks by learned score. Completed tasks always sink to the bottom
 * regardless of score — a finished item is never "what should I do next".
 */
export function rankTasks<T extends { completed: boolean }>(
  tasks: T[],
  featureFor: (task: T) => number[],
  weights: number[],
): RankedTask<T>[] {
  return tasks
    .map((task) => {
      const x = featureFor(task);
      return {
        task,
        score: task.completed ? COMPLETED_TASK_SCORE : score(x, weights),
        reasons: task.completed ? [] : explain(x, weights),
      };
    })
    .sort((a, b) => b.score - a.score);
}
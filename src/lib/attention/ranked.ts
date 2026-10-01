/**
 * The learned half of the attention feed (SYSTEM_FUNDAMENTALS §5.6, ADR-006).
 *
 * `rules.ts` produces the items that must never be personalised. This file
 * produces the ordinary ones — the work that is simply open — and lets the
 * user's own model decide which deserves the space. The two never mix: nothing
 * here produces a hard kind, nothing in `rules.ts` imports the scorer, and
 * `attention.test.ts` asserts both.
 *
 * Two properties are load-bearing and are tested rather than assumed:
 *
 *  1. **Below `MIN_SAMPLES_TO_RANK` the ranking equals the prior.** The learned
 *     term is multiplied by zero, so a cold model reproduces the deterministic
 *     ordering exactly. A new user's first screen is not a random permutation.
 *  2. **The learned term is bounded to ±`LEARNED_BAND`.** The model can
 *     reorder items that are genuinely close together, and cannot promote an
 *     unimportant item above an important one no matter how much it has trained.
 *     That is what stops a self-reinforcing model from burying real work
 *     (R2), without needing the model to be trusted.
 *
 * Escalation is computed from the *deterministic* urgency, before the learned
 * term is added. The model therefore cannot manufacture a level-2 item, and
 * cannot downgrade one either — the clock decides, alone.
 */

import {
  clamp01,
  escalate,
  type AttentionCandidate,
} from "./pipeline";
import { URGENT_WINDOW_HOURS } from "./rules";
import { openTasks, type TaskView } from "./sources";
import type { Priority } from "../nlp";
import {
  explain,
  extractFeatures,
  score,
  shouldRank,
  tanh,
  type BehaviourStats,
} from "../scorer";

const HOUR_MS = 3_600_000;

/**
 * How much the model is allowed to move an item's severity, either way.
 *
 * A quarter of the scale. Two items whose deterministic urgency differs by more
 * than this cannot swap places; two that are within it can. Small enough that a
 * trained model is a tie-breaker rather than a dictator, which is the correct
 * amount of authority for something that guessed.
 */
export const LEARNED_BAND = 0.25;

/**
 * Ceiling on the severity a ranked item can be escalated on.
 *
 * Found by this phase's own fixture, and worth stating plainly: escalation
 * level 2 means "you may not dismiss this", and §5.7 reaches it at
 * `severity >= 0.9`. But a task six hours out scores around 0.93 *for ranking
 * purposes* — near the top of Today — and that number was being read as
 * urgency. Without this ceiling, ordinary scheduled work would quietly become
 * undismissable, which is not what the number means.
 *
 * The honest boundary is the one that already exists: the hard rules own the
 * four-hour urgent window, so a ranked item is never inside it and never earns
 * level 2 by being scored highly. It can still be escalated to level 1, which
 * snoozes need a return date for but dismissal remains available.
 */
const RANKED_ESCALATION_CEILING = 0.85;

/** Everything the ranker needs, as plain data. */
export interface RankedInput {
  tasks: TaskView[];
  /** Areas the user has switched on. A disabled area stays quiet either way. */
  enabledAreas: string[];
  weights: number[];
  behaviour: BehaviourStats;
  /** Labelled events seen. Below `MIN_SAMPLES_TO_RANK`, the prior wins. */
  samples: number;
}

/**
 * The deterministic part of an item's severity: how close it is, and how the
 * user marked it. Exactly the same shape the hard rules use, so a task moving
 * from one class to the other does not visibly jump.
 */
export function priorSeverity(
  dueAt: number | null,
  priority: number,
  now: number,
): number {
  if (dueAt == null) return 0.2; // real, but it should sit at the bottom
  const hoursAway = (dueAt - now) / HOUR_MS;
  const urgency =
    hoursAway < 0 ? clamp01(0.8 + -hoursAway / (7 * 24)) : clamp01(1 - hoursAway / (7 * 24));
  const bonus = priority === 0 ? 0.1 : priority === 1 ? 0.05 : 0;
  return clamp01(0.3 + urgency * 0.6 + bonus);
}

/**
 * Produces the ranked attention candidates for one user.
 *
 * Pure. `now` is injected, weights are passed in, and nothing here reads a
 * clock or a database.
 */
export function learnedCandidates(input: RankedInput, now: number): AttentionCandidate[] {
  const learned = shouldRank(input.samples);
  const out: AttentionCandidate[] = [];

  for (const task of openTasks(input.tasks)) {
    if (task.orphanedSource) continue;
    if (task.area !== "general" && !input.enabledAreas.includes(task.area)) continue;

    const dueAt = task.dueAt ?? null;
    const hoursAway = dueAt == null ? null : (dueAt - now) / HOUR_MS;

    // The hard half stops at the urgent window. Anything inside it is already a
    // rule item and must not be produced twice, let alone ranked.
    if (hoursAway != null && hoursAway <= URGENT_WINDOW_HOURS) continue;

    const prior = priorSeverity(dueAt, task.priority, now);
    const section = hoursAway == null || hoursAway > 24 ? "upcoming" : "today";

    const x = extractFeatures(
      {
        priority: task.priority as Priority,
        dueAt,
        createdAt: task.createdAt ?? now,
        tags: task.tags ?? [],
        area: task.area,
        source: task.source,
        person: task.person,
      },
      input.behaviour,
      new Date(now),
    );

    // Below the evidence threshold the learned term is exactly zero, so the
    // severity is the prior, bit for bit. See property (1) above.
    const adjustment = learned ? tanh(score(x, input.weights)) * LEARNED_BAND : 0;
    const severity = clamp01(prior + adjustment);

    out.push({
      kind: dueAt == null ? "task.someday" : "task.planned",
      sourceId: task._id,
      section,
      class: "ranked",
      severity,
      area: task.area,
      title: task.title,
      detail:
        task.area !== "general" ? task.area : dueAt == null ? "No date set" : undefined,
      dueAt,
      // Clock and data, never the model — and never the ranking number.
      // See RANKED_ESCALATION_CEILING above.
      escalation: escalate(dueAt, Math.min(prior, RANKED_ESCALATION_CEILING), now),
      reasons: learned ? explain(x, input.weights).slice(0, 2) : [],
      action:
        dueAt == null
          ? { label: "Schedule", kind: "task.schedule" }
          : { label: "Open", kind: "task.complete" },
    });
  }

  return out;
}

/**
 * True when the model is being trusted, for the UI to say so honestly.
 *
 * Shown as a one-line note rather than hidden: a ranking that explains itself is
 * a ranking the user can correct, and a user who cannot see when learning is
 * switched off has no way to know the screen is not personal to them.
 */
export function learningActive(samples: number): boolean {
  return shouldRank(samples);
}
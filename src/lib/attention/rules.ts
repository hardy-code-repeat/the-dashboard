/**
 * Hard rules (SYSTEM_FUNDAMENTALS §5.6, ADR-006).
 *
 * These are the items that must never be personalised away. A tax deadline does
 * not get dimmer because the model has learned you ignore tax, and a meeting in
 * two hours does not get pushed down by a learned preference for evenings.
 * Every item produced here goes straight to the pipeline; **none of it is ever
 * passed to the scorer**, and nothing in this file imports `src/lib/scorer.ts`.
 * That is enforced structurally — the import list is short enough to audit by
 * eye, and `attention.test.ts` asserts the separation.
 *
 * Since phase 1.1 this file owns exactly one half of the attention feed. The
 * other half — ordinary, model-ranked work — lives in `ranked.ts` and imports
 * the scorer. The split is by kind, listed once in `HARD_KINDS`, and the same
 * list is what the server reads before it will train on a piece of feedback.
 *
 * Severity is a deterministic function of the data. No randomness, no
 * personalisation, no clock the caller did not pass in.
 */

import {
  escalate,
  type AttentionCandidate,
} from "./pipeline";
import {
  openTasks,
  upcomingDeadlines,
  upcomingEvents,
  type CalendarView,
  type CommitmentAttentionView,
  type ConnectionView,
  type DeadlineView,
  type DocumentView,
  type ExpiryView,
  type TaskView,
} from "./sources";

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** Everything the rules need, as plain data. */
export interface RuleInput {
  tasks: TaskView[];
  deadlines: DeadlineView[];
  connections: ConnectionView[];
  documents: DocumentView[];
  /**
   * Life-admin documents (phase 3, feature 3). Optional so an existing caller
   * that has no documents yet keeps compiling, and so the absence is a real
   * "none" rather than an accident.
   */
  expiring?: ExpiryView[];
  /**
   * Commitments and waits that are past their expected date (phase 3, feature 4).
   * Optional for the same reason `expiring` is: a caller with none must keep
   * compiling, and "none" has to be a real answer rather than an omission.
   */
  commitments?: CommitmentAttentionView[];
  /** Meetings from a connected calendar. Empty when nothing is connected. */
  calendar?: CalendarView[];
  /** Areas the user has switched on, so a task in a disabled area stays quiet. */
  enabledAreas: string[];
  /** The tax year the deadline list belongs to, for the detail line. */
  taxYearLabel?: string;
}

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

/**
 * Which kinds are hard-rule items.
 *
 * The whole of ADR-006 reduces to this list plus the `class: "hard"` field on
 * every candidate this file emits. The server reads it when deciding whether
 * user feedback is allowed to train the model, so the decision is made in one
 * place and cannot drift between client and server.
 */
export const HARD_KINDS: readonly string[] = [
  "task.overdue",
  "task.imminent",
  "deadline.tax",
  "document.incomplete",
  // A document whose renewal window has opened (phase 3, feature 3). Hard for
  // the same reason `deadline.tax` is: it is a fixed date, not a preference,
  // and a model that learns to bury "your passport expires in eight days" has
  // learned the wrong thing.
  "document.expiring",
  "connection.unfinished",
  "connection.stale",
  // A meeting that is about to start. Phase 2 adds it, and it is here rather
  // than in the ranked half for the same reason a task inside the four-hour
  // window is: someone who can dismiss it, or train a model to bury it, will
  // eventually do so, and "I am in a meeting in twenty minutes" is not a
  // preference.
  "calendar.imminent",
  // A promise the user made that has passed (phase 3, feature 4). Hard for the
  // same reason `deadline.tax` is: it is a date the user gave somebody else, not
  // a preference. A model that learns to bury "you told Raj and it is three
  // days late" has learned the worst thing this product could teach it.
  "commitment.overdue",
  // A wait that has passed. Hard too, but for the opposite reason to everything
  // else in this list: the user **cannot** resolve it alone, so there is nothing
  // for the ranker to be wrong about. What stops it nagging is not this entry —
  // it is that it fires only after the date passes, its severity is capped low,
  // and the `waitingOn` budget is three.
  "commitment.waiting",
];

const HARD_KIND_SET = new Set(HARD_KINDS);

/** True when an item of this kind may never be personalised or suppressed. */
export function isHardKind(kind: string): boolean {
  return HARD_KIND_SET.has(kind);
}

/**
 * Tasks — the hard half only.
 *
 * Since phase 1.1 this emits **only** what ADR-006 names: overdue work and work
 * that is within four hours of being due. Everything else that is open — a task
 * due tomorrow, a task due in a fortnight, an undated task — is an *ordinary*
 * item, and ordinary items are ranked by the model rather than declared by a
 * rule. The two classes are produced separately and never meet (§5.6).
 *
 * A task with no due date is deliberately not promoted: an undated task that has
 * sat for months is real, but ranking it above a deadline would be the scorer
 * guessing, and this file does not guess.
 */
export function taskRules(input: RuleInput, now: number): AttentionCandidate[] {
  const out: AttentionCandidate[] = [];

  for (const task of openTasks(input.tasks)) {
    if (task.orphanedSource) continue; // already represented by a change item
    if (task.area !== "general" && !input.enabledAreas.includes(task.area)) continue;
    if (task.dueAt == null) continue; // undated work is ranked, not ruled

    const hoursAway = (task.dueAt - now) / HOUR_MS;

    // The hard boundary. Inside it, the clock decides and the model is not
    // consulted; outside it, `ranked.ts` takes over.
    if (hoursAway > URGENT_WINDOW_HOURS) continue;

    const overdueBy = Math.max(0, -hoursAway);
    const urgency =
      hoursAway < 0 ? clamp01(0.8 + overdueBy / (7 * 24)) : clamp01(1 - hoursAway / 24);
    const priority = task.priority === 0 ? 0.1 : task.priority === 1 ? 0.05 : 0;
    const severity = clamp01(0.3 + urgency * 0.6 + priority);

    out.push({
      kind: hoursAway < 0 ? "task.overdue" : "task.imminent",
      sourceId: task._id,
      section: "now",
      class: "hard",
      severity,
      title: task.title,
      detail: task.area === "general" ? undefined : task.area,
      dueAt: task.dueAt,
      escalation: escalate(task.dueAt, severity, now),
      action: { label: "Open", kind: "task.complete" },
    });
  }

  return out;
}

/**
 * Statutory deadlines.
 *
 * These are the reason the "hard rules bypass the learned ranker" decision
 * exists. They are never suppressed, never personalised and never decayed —
 * the `deadlines` section has no half-life precisely so that ignoring it does
 * not make it go away.
 */
export function deadlineRules(input: RuleInput, now: number): AttentionCandidate[] {
  const out: AttentionCandidate[] = [];

  for (const d of upcomingDeadlines(input.deadlines, now)) {
    if (d.passed) continue;
    if (d.daysAway == null) continue;

    // Anything inside a fortnight is urgent; a year out is real but not today.
    const severity = clamp01(0.55 + (1 - Math.min(d.daysAway, 365) / 365) * 0.4);

    out.push({
      kind: "deadline.tax",
      sourceId: `${d.country}:${d.id}:${d.date ?? "none"}`,
      section: "deadlines",
      class: "hard",
      severity,
      title: d.label,
      detail: `${d.source}${input.taxYearLabel ? ` · ${input.taxYearLabel}` : ""}`,
      dueAt: d.date ? new Date(`${d.date}T23:59:59`).getTime() : null,
      escalation: escalate(d.date ? new Date(`${d.date}T23:59:59`).getTime() : null, severity, now),
      pinned: severity >= 0.9,
      action: { label: "Open", kind: "deadline.open" },
    });
  }

  return out;
}

/**
 * Connected tools that need something, or have gone quiet.
 *
 * Two distinct things live here, and the distinction matters:
 *
 *  - a connection still sitting at `pending-credentials` is **unfinished**, and
 *    is surfaced immediately. A half-set-up integration that silently shows as
 *    connected is worse than one that never connected, because the user
 *    believes data is arriving when none is.
 *  - a real connection that has stopped syncing is **stale**, and is surfaced
 *    only after the staleness window. Fresh connections are not news.
 */
export function connectionRules(input: RuleInput, now: number): AttentionCandidate[] {
  const out: AttentionCandidate[] = [];

  for (const c of input.connections) {
    if (c.status === "coming-soon") continue;

    if (c.status === "pending-credentials") {
      out.push({
        kind: "connection.unfinished",
        sourceId: c._id,
        section: "changes",
        class: "hard",
        severity: 0.5,
        title: `${c.label} is connected but not finished`,
        detail: "Finish setup to start receiving data",
        dueAt: null,
        escalation: 0,
        groupKey: c.provider,
        action: { label: "Open", kind: "connection.open" },
      });
      continue;
    }

    const last = c.lastSyncedAt ?? c.connectedAt;
    if (now - last < 48 * HOUR_MS) continue;

    const days = Math.floor((now - last) / DAY_MS);
    const severity = clamp01(0.4 + (Math.min(days, 14) / 14) * 0.3);

    out.push({
      kind: "connection.stale",
      sourceId: c._id,
      section: "changes",
      class: "hard",
      severity,
      title: `${c.label} has not synced in ${days === 0 ? "under a day" : `${days} day${days === 1 ? "" : "s"}`}`,
      detail: undefined,
      dueAt: null,
      escalation: escalate(null, severity, now),
      groupKey: c.provider,
      action: { label: "Open", kind: "connection.open" },
    });
  }

  return out;
}

/**
 * Filing readiness.
 *
 * A tax return with one document still missing is worth a prompt, because the
 * cost of finding out on filing night is disproportionate. Once it is fully
 * gathered this stops producing anything at all — an empty rule that is silent
 * is the correct behaviour, not a missing one.
 */
export function documentRules(input: RuleInput, now: number): AttentionCandidate[] {
  const out: AttentionCandidate[] = [];

  for (const doc of input.documents) {
    if (doc.readiness >= 1) continue;
    if (doc.readiness < 0.5) continue; // barely started: not worth a prompt yet

    const severity = clamp01(0.35 + (1 - doc.readiness) * 0.4);
    out.push({
      kind: "document.incomplete",
      sourceId: doc.requirementId,
      section: "deadlines",
      class: "hard",
      severity,
      title: `${doc.label} is nearly ready`,
      detail: `Still missing: ${doc.missing.slice(0, 2).join(", ")}`,
      dueAt: null,
      escalation: escalate(null, severity, now),
      action: { label: "Open", kind: "document.open" },
    });
  }

  return out;
}

/**
 * Meetings that are about to start.
 *
 * The hard half only, on the same four-hour rule `taskRules` uses: inside the
 * window a meeting is an event, outside it the item is either ranked or simply
 * not attention — a meeting tomorrow morning is not something to interrupt
 * someone about at lunchtime.
 *
 * Severity rises towards the start and reaches 0.9 at the moment it begins, so
 * a meeting can be *pinned* rather than merely ranked. That is deliberate: the
 * `now` section is capped at three, and a pinned item is rank 1 by definition
 * and immune to the cap (ADR-006, §5.7).
 *
 * A private event contributes its title as the literal `"Busy"`, which is all
 * Panel ever received — there is nothing to redact here because nothing else was
 * stored (§7.3).
 */
export function calendarRules(input: RuleInput, now: number): AttentionCandidate[] {
  const out: AttentionCandidate[] = [];

  for (const event of upcomingEvents(input.calendar ?? [], now)) {
    const hoursAway = (event.startsAt! - now) / HOUR_MS;
    if (hoursAway > URGENT_WINDOW_HOURS) continue;

    const urgency = clamp01(1 - Math.max(hoursAway, 0) / URGENT_WINDOW_HOURS);
    const severity = clamp01(0.45 + urgency * 0.45);

    out.push({
      kind: "calendar.imminent",
      sourceId: event._id,
      section: "now",
      class: "hard",
      severity,
      title: event.title,
      detail: event.allDay ? "All day" : undefined,
      dueAt: event.startsAt,
      escalation: escalate(event.startsAt, severity, now),
      pinned: hoursAway <= 0,
      action: { label: "Open", kind: "event.open" },
    });
  }

  return out;
}

/**
 * Life-admin documents that need a renewal started.
 *
 * **Three anti-spam mechanisms, no new machinery.** This is the whole design of
 * the rule, and each line is load-bearing:
 *
 *  1. `attention` is false outside the lead window, so a document renewing in
 *     nine months emits nothing. One item per document, only when the user's
 *     own lead time says it is time.
 *  2. A document with a renewal in progress emits **nothing** — the server
 *     decided that upstream and said so in the flag. This is the line that stops
 *     one renewal producing two items, which is how an attention feed teaches
 *     people to ignore it.
 *  3. The existing `deadlines` budget of 4 caps the rest, and the pipeline
 *     already reports how many items the caps hid.
 *
 * The rule does no deciding of its own: `severity`, `deadlineAt` and `detail`
 * all arrive from `src/lib/documents.ts`. This file cannot disagree with the
 * Life Admin surface about what state a document is in, because it is told.
 */
export function expiryRules(input: RuleInput, now: number): AttentionCandidate[] {
  const out: AttentionCandidate[] = [];

  for (const doc of input.expiring ?? []) {
    if (!doc.attention) continue;
    const severity = clamp01(doc.severity ?? 0);
    if (severity <= 0) continue;

    out.push({
      kind: "document.expiring",
      sourceId: doc.id,
      section: "deadlines",
      class: "hard",
      severity,
      title: doc.label,
      detail: doc.detail,
      dueAt: doc.deadlineAt,
      escalation: escalate(doc.deadlineAt, severity, now),
      // Past its date, or contradicted by a renewal the user already ticked
      // off. Both have to be dealt with rather than filed away.
      pinned: severity >= 0.9,
      action: { label: "Start renewal", kind: "document.renew" },
    });
  }

  return out;
}

/**
 * Commitments that have passed the date the user gave somebody.
 *
 * **Two kinds, two existing sections, no new machinery** — the whole design is
 * that both halves already existed and one of them had no producer at all
 * (`waitingOn`, since phase 1.0). Adding a section or a prioritiser for this
 * would have been the failure, not the feature.
 *
 * Everything this rule needs is *decided* upstream by
 * `src/lib/commitments.ts` and arrives as flags: whether the item wants
 * attention at all, how severe it is, and which section it belongs in. The rule
 * does no state arithmetic of its own, so it cannot disagree with the
 * Relationships surface about what state a commitment is in.
 *
 * Both are hard (ADR-006), and both are non-dismissable once the date has
 * passed, because `escalate` reads any past date as level 2 — the same rule that
 * makes an overdue task undeclineable. A wait the user no longer expects is
 * resolved by marking it not-happening, which is an honest edit, rather than by
 * dismissing it.
 */
export function commitmentRules(input: RuleInput, now: number): AttentionCandidate[] {
  const out: AttentionCandidate[] = [];

  for (const c of input.commitments ?? []) {
    if (!c.attention) continue;
    const severity = clamp01(c.severity ?? 0);
    if (severity <= 0) continue;

    // Inbound is the wait; outbound is the user's own broken promise. Two kinds
    // rather than one, because they are different obligations with different
    // remedies, and collapsing them would make the feed say "do it" about
    // something the user cannot do.
    const inbound = c.direction === "owedTo";
    out.push({
      kind: inbound ? "commitment.waiting" : "commitment.overdue",
      sourceId: c.id,
      section: c.section,
      class: "hard",
      severity,
      title: c.title,
      detail: c.detail,
      dueAt: c.expectedAt,
      escalation: escalate(c.expectedAt, severity, now),
      // `people` groups by person and `waitingOn` by counterparty. They happen
      // to be the same key, and saying so once here is clearer than two
      // near-identical lines that can drift.
      groupKey: c.personId,
      // Following up is the only action a wait can honestly offer, and the
      // button that offers it creates the chase task — it never settles the
      // wait, because chasing someone is not receiving from them.
      action: inbound
        ? { label: "Follow up", kind: "commitment.follow_up" }
        : { label: "Done it", kind: "commitment.settle" },
    });
  }

  return out;
}

/**
 * Every hard rule, in one call.
 *
 * The order here is the order rules are listed for a human, and it is also the
 * order they enter the pipeline. The pipeline re-ranks by severity, so this is
 * documentation, not behaviour.
 */
export function hardRules(input: RuleInput, now: number): AttentionCandidate[] {
  return [
    ...taskRules(input, now),
    ...deadlineRules(input, now),
    ...calendarRules(input, now),
    ...connectionRules(input, now),
    ...documentRules(input, now),
    ...expiryRules(input, now),
    ...commitmentRules(input, now),
  ];
}

/**
 * The hard/ranked boundary, in hours.
 *
 * Shared with `ranked.ts` so the two classes cannot disagree about which side of
 * the line an item falls on. One constant, two readers — a task is either a
 * rule or a ranked item and there is no in-between.
 */
export const URGENT_WINDOW_HOURS = 4;
export const URGENT_WINDOW_MS = URGENT_WINDOW_HOURS * HOUR_MS;

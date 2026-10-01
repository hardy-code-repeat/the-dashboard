/**
 * The attention pipeline (SYSTEM_FUNDAMENTALS §5.7, ADR-003, ADR-006).
 *
 * Attention is **computed, never stored**. Every item here is produced by a
 * pure function from the user's own data at query time; the only thing that
 * persists is the user's *feedback* about an item. That is why this file
 * exports functions rather than a class, and why every one of them takes `now`
 * instead of reading a clock: a half-life you cannot inject is a half-life you
 * cannot test.
 *
 * The order of operations is load-bearing and is asserted end to end in
 * `attention.test.ts`:
 *
 *   candidates -> snooze/reject filter -> grouping -> dedupe -> decay
 *              -> pin -> per-section cap -> total cap
 *
 * Grouping before dedupe, because grouping changes identities; decay before
 * capping, because a section's cap must be spent on the freshest items rather
 * than the first ones produced; pins first, because a pinned item is rank 1 by
 * definition and must never be squeezed out by a cap.
 */

export type AttentionSection =
  | "now"
  | "today"
  | "upcoming"
  | "waitingOn"
  | "money"
  | "people"
  | "deadlines"
  | "changes";

export const ATTENTION_SECTIONS: readonly AttentionSection[] = [
  "now",
  "today",
  "upcoming",
  "waitingOn",
  "money",
  "people",
  "deadlines",
  "changes",
];

/** How each section is grouped. `none` means items stand alone. */
export type GroupingDimension = "none" | "counterparty" | "account" | "person" | "provider";

export interface SectionBudget {
  /** Hard maximum for this section. */
  max: number;
  /** Hours for the score to halve. `null` means items do not decay. */
  halfLife: number | null;
  grouping: GroupingDimension;
  /** Human label for the UI. */
  label: string;
  /** One line explaining what belongs here, shown as an empty state. */
  blurb: string;
}

/** §5.7. The numbers here are the specification, not a tuning choice. */
export const SECTION_BUDGET: Record<AttentionSection, SectionBudget> = {
  now: {
    max: 3,
    halfLife: 2,
    grouping: "none",
    label: "Now",
    blurb: "Overdue, or due within four hours. These are the only three things that can outrank everything else.",
  },
  today: {
    max: 5,
    halfLife: 8,
    grouping: "none",
    label: "Today",
    blurb: "Due before the day is out.",
  },
  upcoming: {
    max: 5,
    halfLife: null,
    grouping: "none",
    label: "Upcoming",
    blurb: "Scheduled beyond today. These do not decay, because a deadline in three weeks is not less real than one in three days.",
  },
  waitingOn: {
    max: 3,
    halfLife: 24,
    grouping: "counterparty",
    label: "Waiting on",
    blurb: "You are blocked on someone else. Collapsed by who you are waiting for.",
  },
  money: {
    max: 3,
    halfLife: 24,
    grouping: "account",
    label: "Money",
    blurb: "Bills, payments and anything with a due date attached. Collapsed by account.",
  },
  people: {
    max: 3,
    halfLife: 72,
    grouping: "person",
    label: "People",
    blurb: "Things that are about someone rather than about a task. Collapsed by person.",
  },
  deadlines: {
    max: 4,
    halfLife: null,
    grouping: "none",
    label: "Deadlines",
    blurb: "Statutory and fixed dates. These come from rules, never from the model, and nothing you reject can hide one.",
  },
  changes: {
    max: 3,
    halfLife: 12,
    grouping: "provider",
    label: "Changes",
    blurb: "Something moved in a connected tool. Collapsed by provider.",
  },
};

/** The whole screen is capped, not just each section. §5.7. */
export const TOTAL_CAP = 24;

/** A group only collapses once it has at least this many members. */
export const GROUP_THRESHOLD = 3;

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/**
 * Clamp to the closed unit interval.
 *
 * Lives here rather than in each producer because severity is the one number
 * decay, caps and escalation all read, and a producer that returns 1.4 or -0.2
 * would quietly break all three.
 */
export const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

/**
 * Which of the two item classes this is (ADR-006).
 *
 * `hard` — produced by a rule, ordered by deterministic severity, never scored,
 * never trained on, never suppressible. `ranked` — ordinary work, ordered by the
 * learned model, suppressible by an explicit "not for me".
 *
 * Required rather than optional. Phase 1.0 shipped before this field existed and
 * every candidate was hard by construction; making it explicit means a new
 * producer cannot join the feed without declaring which class it belongs to.
 */
export type AttentionClass = "hard" | "ranked";

/** One thing worth someone's attention, before any ordering is applied. */
export interface AttentionCandidate {
  /** What kind of thing this is. Closed in practice, free in shape. */
  kind: string;
  /** The object it came from. Two items with the same one are the same thing. */
  sourceId: string;
  section: AttentionSection;
  /** Which side of the hard/ranked split this item is on. */
  class: AttentionClass;
  /** Deterministic 0..1. Rules produce this; nothing is inferred. */
  severity: number;
  /** Which life area this belongs to, for the learned suppression set. */
  area?: string;
  title: string;
  detail?: string;
  dueAt: number | null;
  /** 0 ordinary, 1 important, 2 urgent — see `escalate`. */
  escalation: 0 | 1 | 2;
  /** Pinned items always rank first and never decay. */
  pinned?: boolean;
  /** The grouping key for this section's dimension, when it has one. */
  groupKey?: string;
  /** What the UI should offer to do about it. */
  action?: { label: string; kind: string };
  /**
   * Why the model put a *ranked* item where it did. Empty for hard items,
   * because a hard item's position comes from the clock, not from a model.
   */
  reasons?: { label: string; contribution: number }[];
}

/** Feedback the user has already given about an item. §3.5. */
export interface AttentionFeedback {
  fingerprint: string;
  seenCount?: number;
  dismissedAt?: number | null;
  snoozedUntil?: number | null;
  actedAt?: number | null;
  rejectedAt?: number | null;
}

/** A candidate after the pipeline has ordered, grouped and capped it. */
export interface AttentionItem extends AttentionCandidate {
  /** Severity after decay. What the UI sorts and displays. */
  score: number;
  /** Stable identity, used for feedback. See `fingerprint`. */
  fingerprint: string;
  /** The readable key the fingerprint was derived from. Kept for debugging. */
  dedupeKey: string;
  /** How many items this one stands for, when grouping collapsed them. */
  groupSize: number;
  /** True when this item is the collapsed representative of a group. */
  grouped: boolean;
  /** How many times the user has seen it. Never used as a training signal. */
  seenCount: number;
  /** Whether a snooze is in force, and when it lifts. */
  snoozedUntil: number | null;
  /** True when the user marked this item itself as "not for me". */
  suppressed: boolean;
  /**
   * True when this item is in the exploration slot rather than the top of its
   * section (§5.5.4). The UI says so, because an experiment the user cannot see
   * is not exploration, it is noise.
   */
  explore: boolean;
}

/**
 * A stable, short identity for one attention item (§3.5).
 *
 * `kind : sourceId : dueBucket` hashed with FNV-1a. The hash is not
 * obfuscation — it is length. A task id plus a due date is a long string, and
 * `attentionState` is indexed by this value and read on every query. The
 * readable key travels alongside on each item so a support question about a
 * missing row can still be answered by eye.
 */
export function fingerprint(kind: string, sourceId: string, dueAt: number | null): string {
  return fnv1a(`${kind}:${sourceId}:${dueBucket(dueAt)}`);
}

function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * Coarse due-date bucket.
 *
 * Deliberately a *day*, not a timestamp. Two calendar events for the same
 * meeting collapse; a task that moved by an hour does not become a new item.
 */
export function dueBucket(dueAt: number | null): string {
  if (dueAt == null) return "none";
  return String(Math.floor(dueAt / DAY_MS));
}

/** The readable key the fingerprint hashes. Exported for debugging and tests. */
export function dedupeKey(candidate: AttentionCandidate): string {
  return `${candidate.kind}:${candidate.sourceId}:${dueBucket(candidate.dueAt)}`;
}

/**
 * Exponential decay. `score *= 0.5 ^ (ageHours / halfLife)`.
 *
 * `halfLife === null` means this section does not decay at all, which is a real
 * decision rather than an omission: a tax deadline gets dimmer if you ignore
 * it, and that is precisely wrong.
 */
export function decay(severity: number, bornAt: number, now: number, halfLife: number | null): number {
  if (halfLife === null) return severity;
  const ageHours = Math.max(0, (now - bornAt) / HOUR_MS);
  if (ageHours === 0) return severity;
  return severity * Math.pow(0.5, ageHours / halfLife);
}

/**
 * Escalation level. §5.7: level 2 is "less than four hours away, or so severe
 * it has to be treated as severe".
 *
 * This is the one place a deadline's urgency is decided, and it is decided from
 * the clock rather than from anything the model believes.
 */
export function escalate(dueAt: number | null, severity: number, now: number): 0 | 1 | 2 {
  if (severity >= 0.9) return 2;
  if (dueAt != null && dueAt - now < 4 * HOUR_MS) return 2;
  if (severity >= 0.6) return 1;
  return 0;
}

/** A snooze on a level-2 item is only honoured with a return date. */
export function snoozeAllowed(item: { escalation: 0 | 1 | 2 }, until: number | null, now: number): boolean {
  if (until == null) return item.escalation < 2;
  return until > now;
}

/** A level-2 item cannot be dismissed at all. It can be dealt with, or snoozed. */
export function dismissAllowed(item: { escalation: 0 | 1 | 2 }): boolean {
  return item.escalation < 2;
}

function toItem(
  candidate: AttentionCandidate,
  feedback: Map<string, AttentionFeedback>,
  now: number,
): AttentionItem {
  const key = dedupeKey(candidate);
  const fp = fingerprint(candidate.kind, candidate.sourceId, candidate.dueAt);
  const prior = feedback.get(fp);
  const budget = SECTION_BUDGET[candidate.section];

  // Born-at is the due date when there is one, otherwise "now". A task due in
  // three days should not start decaying the moment it is created.
  const bornAt = candidate.dueAt != null && candidate.dueAt <= now ? candidate.dueAt : now;
  const score = candidate.pinned
    ? candidate.severity
    : decay(candidate.severity, bornAt, now, budget.halfLife);

  return {
    ...candidate,
    score,
    fingerprint: fp,
    dedupeKey: key,
    groupSize: 1,
    grouped: false,
    seenCount: prior?.seenCount ?? 0,
    snoozedUntil: prior?.snoozedUntil ?? null,
    suppressed: prior?.rejectedAt != null,
    explore: false,
  };
}

/**
 * Collapses a group of three or more into its highest-severity member.
 *
 * Three separate "Sam hasn't replied" rows is noise; one row saying "Sam
 * hasn't replied to three things" is information. Two is not enough to be
 * worth collapsing, because at two the list is still readable and the user
 * might genuinely want to see both.
 */
function applyGrouping(items: AttentionItem[]): AttentionItem[] {
  const groups = new Map<string, AttentionItem[]>();
  const singles: AttentionItem[] = [];

  for (const item of items) {
    const dimension = SECTION_BUDGET[item.section].grouping;
    if (dimension === "none" || !item.groupKey) {
      singles.push(item);
      continue;
    }
    const key = `${item.section}:${dimension}:${item.groupKey}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(item);
    else groups.set(key, [item]);
  }

  const out: AttentionItem[] = [...singles];
  for (const members of groups.values()) {
    if (members.length < GROUP_THRESHOLD) {
      out.push(...members);
      continue;
    }
    const lead = members.reduce((best, m) => (m.score > best.score ? m : best), members[0]);
    out.push({
      ...lead,
      groupSize: members.length,
      grouped: true,
      title:
        members.length === 3
          ? `${lead.title} (and 2 more)`
          : `${lead.title} (and ${members.length - 1} more)`,
    });
  }
  return out;
}

/** Collapses identical fingerprints, keeping the most severe copy. */
function applyDedupe(items: AttentionItem[]): AttentionItem[] {
  const best = new Map<string, AttentionItem>();
  for (const item of items) {
    const existing = best.get(item.fingerprint);
    if (!existing || item.score > existing.score) best.set(item.fingerprint, item);
  }
  return [...best.values()];
}

/** Pinned first, then severity, then the sooner deadline, then a stable title
 *  order so the same input always renders the same screen. */
function compare(a: AttentionItem, b: AttentionItem): number {
  if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
  if (b.score !== a.score) return b.score - a.score;
  const aDue = a.dueAt ?? Number.POSITIVE_INFINITY;
  const bDue = b.dueAt ?? Number.POSITIVE_INFINITY;
  if (aDue !== bDue) return aDue - bDue;
  return a.fingerprint < b.fingerprint ? -1 : 1;
}

export interface AttentionResult {
  /** Ranked, capped, grouped — what the UI renders. */
  items: AttentionItem[];
  /** The same items bucketed by section, in display order. */
  bySection: { section: AttentionSection; label: string; blurb: string; items: AttentionItem[] }[];
  /** Counts produced before the caps, so the UI can say "and 6 more". */
  produced: number;
  /** What the caps removed, per section. Non-zero means the user is missing
   *  something and the UI must not pretend otherwise. */
  hiddenByCap: Record<AttentionSection, number>;
  /** How many were hidden by the total cap rather than a section cap. */
  hiddenByTotalCap: number;
}

/**
 * Explicit, user-authored category suppression (RJD-006, §5.5.5).
 *
 * Written only when the user says "not for me". It hides **ranked** items and
 * nothing else — the filter below tests `class === "ranked"` before it tests
 * anything else, so there is no path by which this set can hide a statutory
 * deadline. There is deliberately no negative *category* feature that would let
 * the same outcome be learned instead of stated.
 */
export interface SuppressionSet {
  kinds?: string[];
  areas?: string[];
}

/**
 * Applies a section's cap and reserves one exploration slot (§5.5.4).
 *
 * Exploration is what stops the ranking eating itself: if only the top of the
 * ranking is ever shown, an early mis-ranking is permanently self-fulfilling,
 * because the items that would have corrected it are never seen and therefore
 * never produce feedback. One slot per section, drawn from the *lower half* of
 * the ranking, is the cheapest thing that breaks that loop.
 *
 * It applies to ranked items only. Hard items are already ordered by a
 * deterministic rule, so there is nothing to explore and reordering them would
 * be exactly the "ordering rule" alternative ADR-006 rejected.
 */
function capSection(items: AttentionItem[], max: number): { kept: AttentionItem[]; hidden: number } {
  const survivors = items.slice(0, max);
  const overflow = items.length - survivors.length;
  // Nothing was cut, so there is nothing to explore into. Spending a slot here
  // would push out an item to make room for one the user could already see.
  if (overflow <= 0) return { kept: survivors, hidden: 0 };

  const survivorsSet = new Set(survivors);
  const lowerHalf = items.slice(Math.floor(items.length / 2));
  const explore = lowerHalf.find(
    (i) => i.class === "ranked" && !i.pinned && !i.grouped && !survivorsSet.has(i),
  );
  if (!explore) return { kept: survivors, hidden: overflow };

  // Replace the weakest surviving *ranked* item, not simply the last one: a
  // pinned or hard item sitting at the bottom of a section is there because it
  // belongs there, not because it lost a ranking contest.
  const replaceAt = [...survivors].reverse().findIndex((i) => i.class === "ranked" && !i.pinned);
  if (replaceAt === -1) return { kept: survivors, hidden: overflow };

  survivors[survivors.length - 1 - replaceAt] = { ...explore, explore: true };
  // One in, one out: the cap still hides exactly as many items as before.
  return { kept: survivors, hidden: overflow };
}

/**
 * The whole pipeline. `now` is injected; nothing here reads a clock.
 *
 * `options.suppress` is honoured for ranked items only, and is structurally
 * incapable of hiding a hard-rule item — see `SuppressionSet`.
 */
export function buildAttention(
  candidates: AttentionCandidate[],
  feedback: AttentionFeedback[],
  now: number,
  options: { suppress?: SuppressionSet } = {},
): AttentionResult {
  const kinds = new Set(options.suppress?.kinds ?? []);
  const areas = new Set(options.suppress?.areas ?? []);

  const lookup = new Map(feedback.map((f) => [f.fingerprint, f] as const));
  const produced = candidates.length;

  const items = candidates
    .map((c) => toItem(c, lookup, now))
    // Per-item feedback applies to both classes: a snooze in force hides the
    // item until it lifts, and a rejection hides it permanently. Neither is a
    // category preference, and neither removes the *rule* — only the task being
    // completed or the date passing removes a hard item.
    .filter((i) => i.snoozedUntil == null || i.snoozedUntil <= now)
    .filter((i) => !i.suppressed)
    // Category suppression is a learned preference. Hard rules ignore learned
    // preferences. The class test comes first on purpose.
    .filter((i) => i.class !== "ranked" || (!kinds.has(i.kind) && !areas.has(i.area ?? "")));

  const grouped = applyGrouping(items);
  const deduped = applyDedupe(grouped);

  const ranked = deduped.slice().sort(compare);

  const hiddenByCap = {} as Record<AttentionSection, number>;
  let hiddenByTotalCap = 0;

  // Per-section caps first, in display order, so a section never appears
  // starved because a later section spent the total budget first.
  const kept: AttentionItem[] = [];
  const perSection = new Map<AttentionSection, AttentionItem[]>();

  for (const section of ATTENTION_SECTIONS) {
    const budget = SECTION_BUDGET[section];
    const inSection = ranked.filter((i) => i.section === section);
    const { kept: survivors, hidden } = capSection(inSection, budget.max);
    hiddenByCap[section] = hidden;
    perSection.set(section, survivors);
    kept.push(...survivors);
  }

  // Then the total cap. When the total binds, the lowest-ranked survivors go,
  // and pinned items are never among them.
  const final = kept.slice().sort(compare).slice(0, TOTAL_CAP);
  hiddenByTotalCap = kept.length - final.length;

  const bySection = ATTENTION_SECTIONS.map((section) => {
    const budget = SECTION_BUDGET[section];
    return {
      section,
      label: budget.label,
      blurb: budget.blurb,
      items: final
        .filter((i) => i.section === section)
        .sort((a, b) => compare(a, b)),
    };
  });

  return {
    items: final,
    bySection,
    produced,
    hiddenByCap,
    hiddenByTotalCap,
  };
}

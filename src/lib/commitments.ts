/**
 * Commitments + Waiting On — the lifecycle (phase 3, feature 4).
 *
 * One object, two directions. A row is an **expectation between the user and
 * one person**: something the user promised (`owed`), or something the user is
 * waiting for (`owedTo`). R-008 and ADR-027 have the argument; this file is the
 * whole of the feature's intelligence.
 *
 * ## No stored state, again
 *
 * ADR-025 was written for documents and it applies unchanged here: **there is
 * no status column.** Four states are a pure function of `(expectedAt,
 * completed, now)`, so none of them can be wrong and adding one never means a
 * migration.
 *
 * ## The rule this file exists to enforce
 *
 * Panel never claims to know what another person did. For `owed`, the user did
 * the thing and Panel knows it. For `owedTo`, nobody in the system observed
 * anything — the user is *asserting* that Raj delivered, and every string in
 * this file is written so it cannot be mistaken for an observation.
 *
 * That is why there are two copy functions rather than one: `owed` can say
 * "you told Raj", and `owedTo` must not be able to say "Raj did not".
 * A single direction-agnostic template is exactly how that mistake would ship.
 *
 * ## Attention is asymmetric on purpose
 *
 * An `owed` commitment that is late is something the user can still fix today.
 * An `owedTo` that is late is something they cannot fix at all — R-009 is
 * unambiguous that waiting lists are reviewed weekly, not continuously, and that
 * the failure mode is rot rather than nagging. So an inbound wait fires
 * attention *only after* the date has passed, at a deliberately low severity,
 * and its action is to follow up rather than to act.
 */

const DAY_MS = 86_400_000;

/**
 * How close an `owed` commitment gets before Panel says anything.
 *
 * An inbound wait has **no** equivalent window and deliberately fires only once
 * the date has passed — nagging someone daily about a delivery they cannot
 * hurry is how a feed gets muted (R-009).
 */
export const DEFAULT_DUE_WINDOW_DAYS = 7;

/** Longest title. Bounded because a mutation writes it. */
export const MAX_TITLE = 160;

/**
 * Which way the obligation runs.
 *
 * A closed union, not a boolean. `isInbound` reads worse than `direction ===`
 * at every call site, and a boolean here would let a later edit flip the meaning
 * of an existing row without any validator noticing.
 */
export type CommitmentDirection = "owed" | "owedTo";

export const COMMITMENT_DIRECTIONS: readonly CommitmentDirection[] = ["owed", "owedTo"];

export function isDirection(value: string): value is CommitmentDirection {
  return value === "owed" || value === "owedTo";
}

/**
 * The four states. Not every commitment has every stage — an undated one is
 * simply `open` forever, which is an honest answer and not a missing one.
 */
export type CommitmentState =
  /** Not settled, with no date or a distant one. */
  | "open"
  /** Not settled, and inside the window the user asked to be warned in. */
  | "due"
  /** Not settled, and the expected date has passed. */
  | "overdue"
  /** The user says it is settled. */
  | "kept";

/** The stored half of a commitment. Two optional fields, no status. */
export interface CommitmentRow {
  title: string;
  direction: CommitmentDirection;
  /** Epoch ms. Absent means "no date was ever given". */
  expectedAt?: number | null;
  completed: boolean;
  completedAt?: number | null;
}

/** A follow-up task, as this file is allowed to see it. */
export interface FollowUpRef {
  _id: string;
  completed: boolean;
  dueAt?: number | null;
}

/** Everything a caller needs about one commitment, derived. */
export interface CommitmentView {
  state: CommitmentState;
  /** Whole days until the expected date; negative once it has passed. */
  daysAway: number | null;
  /** 0..1 for states that deserve attention, `null` otherwise. */
  severity: number | null;
  /**
   * Whether this commitment should produce an attention item. This is the
   * anti-spam decision, made once and told to the rule rather than re-derived
   * there — the same contract `ExpiryView` uses for documents.
   */
  attention: boolean;
  /** Which attention section it belongs in, or `null` when it is silent. */
  section: "people" | "waitingOn" | null;
  title: string;
  detail: string;
  /** Whether the user has any follow-up task against this commitment. */
  followingUp: boolean;
}

/** The states that produce an attention item at all. */
const ATTENTION_STATES: ReadonlySet<CommitmentState> = new Set<CommitmentState>([
  "overdue",
]);

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/** True when a date is a usable timestamp rather than a gap or a typo. */
export function hasExpectedAt(
  row: Pick<CommitmentRow, "expectedAt">,
): row is CommitmentRow & { expectedAt: number } {
  return typeof row.expectedAt === "number" && Number.isFinite(row.expectedAt);
}

/**
 * The single source of truth for "where does this commitment stand".
 *
 * Pure, and it takes `now` rather than reading a clock (ADR-002). Every branch
 * is reachable from a fixture in `commitments.test.ts`.
 */
export function describeCommitment(
  row: CommitmentRow,
  personName: string,
  followUp: FollowUpRef | null | undefined,
  now: number,
): CommitmentView {
  const inbound = row.direction === "owedTo";
  const followingUp = !!followUp && !followUp.completed;
  const daysAway = hasExpectedAt(row)
    ? Math.round((row.expectedAt - now) / DAY_MS)
    : null;

  // --- settled ------------------------------------------------------------
  if (row.completed) {
    return {
      state: "kept",
      daysAway,
      severity: null,
      attention: false,
      section: null,
      title: row.title,
      // The one line that must never lie. For an inbound wait this is an
      // assertion by the user, and the wording has to say so — "Raj sent this"
      // would be a claim about a third party the system has no evidence for.
      detail: inbound
        ? `You marked this received${row.completedAt ? ` on ${formatDay(row.completedAt)}` : ""}`
        : `You told ${personName} you would, and it is done`,
      followingUp,
    };
  }

  // --- overdue ------------------------------------------------------------
  //
  // `expectedAt <= now` rather than `daysAway < 0`, so the commitment is
  // overdue at the instant the date arrives rather than the next morning.
  if (hasExpectedAt(row) && row.expectedAt <= now) {
    const late = daysAway === null ? 0 : Math.abs(daysAway);
    return {
      state: "overdue",
      daysAway,
      // Inbound is capped low. The user cannot resolve a wait themselves, so
      // the only thing Panel can honestly offer is a nudge — and a rule that
      // screams about something impossible is a rule that gets muted (R-009).
      severity: inbound ? 0.6 : 0.85,
      attention: ATTENTION_STATES.has("overdue"),
      section: inbound ? "waitingOn" : "people",
      title: row.title,
      // Spelled out rather than routed through `describeDays`: that helper is
      // written for *future* distances ("tomorrow", "in 3 days") and feeding it
      // a positive lateness says "it is tomorrow late". At the exact instant of
      // the date it is not late at all yet, so it reads "due today".
      detail: inbound
        ? `Waiting on ${personName} since ${formatDay(row.expectedAt!)}`
        : late === 0
          ? `You told ${personName} you would, and today was the day`
          : `You told ${personName} you would, and it is ${late} ${late === 1 ? "day" : "days"} overdue`,
      followingUp,
    };
  }

  // --- due: outbound only -------------------------------------------------
  //
  // A commitment nobody is waiting on is still the user's own promise, and a
  // week of warning is proportionate. A wait the user set is already known to
  // them, so warning them about their own expectation is pure noise.
  if (
    !inbound &&
    hasExpectedAt(row) &&
    daysAway !== null &&
    daysAway <= DEFAULT_DUE_WINDOW_DAYS
  ) {
    const remaining = clamp01(daysAway / DEFAULT_DUE_WINDOW_DAYS);
    return {
      state: "due",
      daysAway,
      severity: 0.5 + (1 - remaining) * 0.2,
      // Deliberately NOT attention. A promise is not urgent the moment it
      // enters its window, and treating it as though it were is how Panel
      // would learn to nag about things in plenty of time.
      attention: false,
      section: null,
      title: row.title,
      detail: `You told ${personName} you would — ${describeDays(daysAway)}`,
      followingUp,
    };
  }

  // --- open ---------------------------------------------------------------
  return {
    state: "open",
    daysAway,
    severity: null,
    attention: false,
    section: null,
    title: row.title,
    detail: inbound
      ? daysAway === null
        ? `Waiting on ${personName}`
        : `Waiting on ${personName} · expected ${formatDay(row.expectedAt!)}`
      : daysAway === null
        ? `You told ${personName} you would`
        : `You told ${personName} you would · by ${formatDay(row.expectedAt!)}`,
    followingUp,
  };
}

/**
 * Plain-English distance in time, same phrasing as the document machine so the
 * two surfaces cannot drift.
 */
export function describeDays(days: number): string {
  const n = Math.abs(days);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  const unit = n === 1 ? "day" : "days";
  return days > 0 ? `in ${n} ${unit}` : `${n} ${unit} ago`;
}

/**
 * A date for a human, in UTC — the same rule as `documents.ts`, and for the
 * same reason: a calendar date must not shift under the viewer.
 */
export function formatDay(at: number): string {
  const d = new Date(at);
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Trims, collapses and bounds a title, refusing rather than storing a blank. */
export function normaliseTitle(raw: string): string | null {
  const collapsed = raw.replace(/\s+/g, " ").trim();
  if (collapsed.length === 0) return null;
  return collapsed.slice(0, MAX_TITLE);
}

/**
 * Validates an expected date.
 *
 * `NaN` and `Infinity` are refused rather than coerced (the N5 lesson): a
 * silently coerced timestamp becomes a commitment that is overdue in the year
 * 275760, or never overdue at all.
 */
export function validateExpectedAt(raw: number | undefined | null): number | null | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!Number.isFinite(raw)) return null;
  return Math.round(raw);
}
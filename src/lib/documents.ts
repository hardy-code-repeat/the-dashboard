/**
 * Life Admin — the expiry → renewal state machine (phase 3, feature 3).
 *
 * This file is the whole of the feature's intelligence, and it is the reason
 * ADR-025 was written: **a document has no stored state.** Everything a caller
 * needs to know about a document — is it expired, is a renewal open, should
 * this become an attention item — is a pure function of three things:
 *
 *   1. `expiresAt`     what the user typed,
 *   2. the renewal task, which is an ordinary `tasks` row,
 *   3. `now`, injected, never read from a clock.
 *
 * There is deliberately no `status` column. A status is a *copy* of those
 * inputs, and a copy is the place where they silently disagree — which is
 * exactly D34 (a roll-up whose fields were never populated and which was
 * therefore permanently zero while compiling cleanly) and D38 (a kind declared
 * in a closed taxonomy and never written). Deriving instead of storing means no
 * state can be wrong, and adding a state never means a migration.
 *
 * The lead-time decision is R-006's: **the expiry date is not the deadline.**
 * A US passport valid for ten years has a renewal deadline roughly six months
 * ahead of its validity deadline, because carriers refuse entry on a
 * short-validity passport. So the deadline this file computes is
 * `expiresAt − leadDays`, and `leadDays` is per-document because it is not a
 * constant: Virginia DMV reminds at 90 days, Utah allows renewal at 60, the
 * State Department needs 4–6 weeks plus mailing.
 *
 * ## The one hazard, handled rather than prevented
 *
 * The renewal is an ordinary task, so the user *can* tick it off through the
 * normal dashboard checkbox. That path trains the model correctly and never
 * touches `expiresAt` — so the document would sit next to a completed "Renew
 * passport" while still reading as expired. That is a silent data-integrity
 * failure, and the alternative (special-casing `setTaskCompleted`) is a
 * special case in a general function. So it is **detected instead**, as
 * `stale`, and stated on the surface.
 */

/** One day in milliseconds. Shared by the date maths below. */
export const DAY_MS = 86_400_000;

/**
 * How many days before expiry a renewal is surfaced when the user has not said.
 *
 * A default, chosen because it is short enough to be useful and long enough to
 * be harmless, and — more importantly — because a *better* default is not
 * available. The real figures are country-specific and document-specific
 * (R-006), and a table of them would be `tax.ts` again: numbers this project
 * cannot audit at source, which is what Do-Not-Touch #1 exists to prevent.
 * Anyone who wants the DMV's 90 days types 90.
 */
export const DEFAULT_LEAD_DAYS = 30;

/** Longest display label. Bounded because a mutation writes it. */
export const MAX_LABEL = 80;

/** Lead-time bounds, in days. Also the caller's validation surface. */
export const MIN_LEAD_DAYS = 0;
export const MAX_LEAD_DAYS = 365;

const MS_PER_DAY = DAY_MS;

/**
 * The seven states. Not all documents have all stages — an `undated` document
 * has no expiry at all, and a `valid` one has a renewal deadline months away —
 * so the union is what a caller switches over, and every member is reachable
 * from a fixture in `documents.test.ts`.
 */
export type ExpiryState =
  /** No expiry recorded. Valid, watched, and permanently silent. */
  | "undated"
  /** Expiry known and further out than the lead window. */
  | "valid"
  /** Inside the lead window and nothing started. This is what needs attention. */
  | "due"
  /** A renewal task is open and the document has not expired yet. */
  | "renewing"
  /** A renewal task is open and the document has already expired. */
  | "renewing-late"
  /** Past expiry with no open renewal. */
  | "expired"
  /** A renewal was marked done after the expiry, but the expiry never moved. */
  | "stale";

/** The stored half of a document. Two optional fields, no status. */
export interface DocumentRow {
  label: string;
  /** Epoch ms. Absent or null means "no expiry recorded". */
  expiresAt?: number | null;
  /** Days before expiry to surface the renewal. Absent means the default. */
  leadDays?: number | null;
}

/**
 * The renewal, as this file is allowed to see it.
 *
 * It is a projection of a `tasks` row, not the row. `dueAt` matters because the
 * renewal deadline computed here is the number the task was *created* with, and
 * reading it back is how a caller can tell "Panel said 14 Aug" from "the user
 * moved it to 1 Sep".
 */
export interface RenewalRef {
  completed: boolean;
  completedAt?: number | null;
  dueAt?: number | null;
}

/** Everything a caller needs about one document, derived. */
export interface DocumentView {
  state: ExpiryState;
  /** Whole days until expiry; negative once it has passed. Null when undated. */
  daysAway: number | null;
  /** `expiresAt − leadDays`, the moment the renewal should have started. */
  deadlineAt: number | null;
  /**
   * 0..1 for states that deserve attention, `null` otherwise. Deterministic —
   * no model, no decay, no randomness (ADR-006).
   */
  severity: number | null;
  /** Whether this document should produce an attention item at all. */
  attention: boolean;
  /** True when an open renewal task exists. */
  renewing: boolean;
  title: string;
  detail: string;
}

/** The states that produce an attention item. Everything else is silent. */
const ATTENTION_STATES: ReadonlySet<ExpiryState> = new Set<ExpiryState>([
  "due",
  "expired",
  "stale",
]);

/** Clamps to 0..1. Mirrors `rules.ts` so a producer can never emit 1.4. */
function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/**
 * The effective lead time, in days.
 *
 * A stored value is trusted only inside its documented bounds; anything else
 * falls back to the default rather than producing a window of negative days or
 * of thirty years. The mutation validates too — this is the second line, for
 * rows written before a bound existed or by a future writer.
 */
export function leadDaysFor(doc: Pick<DocumentRow, "leadDays">): number {
  const raw = doc.leadDays;
  if (typeof raw !== "number" || !Number.isFinite(raw)) return DEFAULT_LEAD_DAYS;
  const whole = Math.round(raw);
  if (whole < MIN_LEAD_DAYS || whole > MAX_LEAD_DAYS) return DEFAULT_LEAD_DAYS;
  return whole;
}

/** `expiresAt − leadDays`, or null when there is no expiry. */
export function renewalDeadline(
  doc: Pick<DocumentRow, "expiresAt" | "leadDays">,
): number | null {
  if (typeof doc.expiresAt !== "number" || !Number.isFinite(doc.expiresAt)) return null;
  return doc.expiresAt - leadDaysFor(doc) * MS_PER_DAY;
}

/** True when the row records an expiry at all. */
export function hasExpiry(
  doc: Pick<DocumentRow, "expiresAt">,
): doc is DocumentRow & { expiresAt: number } {
  return typeof doc.expiresAt === "number" && Number.isFinite(doc.expiresAt);
}

/** True when a renewal task exists and has not been completed. */
export function isRenewalOpen(renewal: RenewalRef | null | undefined): boolean {
  return !!renewal && renewal.completed !== true;
}

/**
 * The single source of truth for "what is going on with this document".
 *
 * Pure, and it takes `now` rather than reading a clock — the whole rule of
 * ADR-002 for `src/lib`. Every branch is reachable from a fixture.
 */
export function describeDocument(
  doc: DocumentRow,
  renewal: RenewalRef | null | undefined,
  now: number,
): DocumentView {
  const lead = leadDaysFor(doc);
  const renewing = isRenewalOpen(renewal);
  const deadlineAt = renewalDeadline(doc);

  // --- no date: valid, watched, and never a nuisance -----------------------
  if (!hasExpiry(doc)) {
    return {
      state: "undated",
      daysAway: null,
      deadlineAt: null,
      severity: null,
      attention: false,
      renewing,
      title: doc.label,
      detail: renewing ? "Renewal in progress · no expiry date" : "No expiry date yet",
    };
  }

  const daysAway = Math.round((doc.expiresAt - now) / MS_PER_DAY);
  const expired = doc.expiresAt <= now;

  // --- the renewal was ticked off generically and the date never moved ----
  //
  // Checked before the open-renewal branches, because it can only be true when
  // the renewal is *not* open, and it is the one case that would otherwise
  // look like ordinary progress.
  const stale =
    !!renewal &&
    renewal.completed === true &&
    typeof renewal.completedAt === "number" &&
    Number.isFinite(renewal.completedAt) &&
    renewal.completedAt > doc.expiresAt;

  if (stale) {
    return {
      state: "stale",
      daysAway,
      deadlineAt,
      // The most severe thing this file can emit. It is a contradiction the
      // user has to resolve, and a contradiction outranks a date.
      severity: 1,
      attention: ATTENTION_STATES.has("stale"),
      renewing: false,
      title: doc.label,
      detail: `Marked renewed ${describeDays(-daysAwayFrom(now, renewal.completedAt!))}, but the expiry still reads ${formatDay(doc.expiresAt)}`,
    };
  }

  // --- a renewal is open: the task already speaks for this -----------------
  //
  // No document item fires here. Emitting one as well would be two items for
  // one renewal, which is how an attention feed teaches people to ignore it.
  if (renewing) {
    const state: ExpiryState = expired ? "renewing-late" : "renewing";
    const due = typeof renewal?.dueAt === "number" ? renewal.dueAt : deadlineAt;
    return {
      state,
      daysAway,
      deadlineAt,
      severity: null,
      attention: false,
      renewing: true,
      title: doc.label,
      detail: expired
        ? `Renewal in progress, and it expired ${describeDays(-daysAway)}`
        : due === null
          ? "Renewal in progress"
          : `Renew by ${formatDay(due)}`,
    };
  }

  // --- expired, and nothing has been started -------------------------------
  if (expired) {
    return {
      state: "expired",
      daysAway,
      deadlineAt,
      severity: 0.95,
      attention: ATTENTION_STATES.has("expired"),
      renewing: false,
      title: doc.label,
      detail: `Expired ${describeDays(-daysAway)} — renew it`,
    };
  }

  // --- inside the lead window: the one state that asks for attention -------
  if (daysAway <= lead) {
    // 0.6 at the moment the window opens, rising to 0.95 as the date arrives.
    const remaining = clamp01((doc.expiresAt - now) / (lead * MS_PER_DAY));
    return {
      state: "due",
      daysAway,
      deadlineAt,
      severity: 0.6 + (1 - remaining) * 0.35,
      attention: ATTENTION_STATES.has("due"),
      renewing: false,
      title: doc.label,
      detail: `Expires ${describeDays(daysAway)} — renew by ${formatDay(deadlineAt!)}`,
    };
  }

  // --- known, far away, silent ---------------------------------------------
  return {
    state: "valid",
    daysAway,
    deadlineAt,
    severity: null,
    attention: false,
    renewing: false,
    title: doc.label,
    detail: `Expires in ${describeDays(daysAway)} · renewal opens in ${daysAway - lead} days`,
  };
}

/** Whole days from `now` to `at`, rounded — the same convention as `getFinance`. */
function daysAwayFrom(now: number, at: number): number {
  return Math.round((at - now) / MS_PER_DAY);
}

/**
 * Plain-English distance in time. The one place this phrasing is written, so
 * the Attention feed and the Life Admin surface cannot disagree about it.
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
 * A date for a human. UTC, because an expiry date is a calendar day and
 * rendering it in the viewer's timezone is how "expires tomorrow" becomes
 * "expired yesterday" for anyone west of UTC.
 */
export function formatDay(at: number): string {
  const d = new Date(at);
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/**
 * Normalises a user-supplied label.
 *
 * Trimmed, collapsed and bounded, because a label is the only free text on the
 * row and it is rendered in a list. Returns `null` when nothing usable is
 * left, so the caller refuses the write rather than storing an empty label.
 */
export function normaliseLabel(raw: string): string | null {
  const collapsed = raw.replace(/\s+/g, " ").trim();
  if (collapsed.length === 0) return null;
  return collapsed.slice(0, MAX_LABEL);
}

/**
 * Validates a lead time, returning `null` when the input is unusable.
 *
 * `undefined` means "use the default" and is a legitimate caller choice, so the
 * caller distinguishes it from `null`, which means "refuse this".
 */
export function validateLeadDays(raw: number | undefined | null): number | null | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!Number.isFinite(raw)) return null;
  const whole = Math.round(raw);
  if (whole < MIN_LEAD_DAYS || whole > MAX_LEAD_DAYS) return null;
  return whole;
}

/**
 * Validates an expiry timestamp.
 *
 * `NaN` and `Infinity` are **refused rather than coerced** (the N5 lesson):
 * Convex does not round-trip `-Infinity` reliably, and a silent coercion turns
 * a typo into a document that expires in year 275760 or never at all.
 */
export function validateExpiry(raw: number | undefined | null): number | null | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!Number.isFinite(raw)) return null;
  if (raw <= 0) return null;
  return Math.round(raw);
}
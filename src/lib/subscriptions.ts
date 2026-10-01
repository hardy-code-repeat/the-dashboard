/**
 * Subscriptions + account labels — the pure part (phase 3, feature 5).
 *
 * ## What this file is for, and what it deliberately is not
 *
 * This is `src/lib`, so it is pure, takes its clock as an argument, and has no
 * Convex import (ADR-002). It derives two numbers — what a subscription costs
 * per year, and how long until it renews — and it holds the one rule that
 * guards every money value in Finance.
 *
 * **It contains no expiry logic and no attention logic, ever** (ADR-029). A
 * subscription renews because a *document* it points at expires, and
 * `document.expiring` already says so. This file is not allowed to have a
 * second opinion, because two expiry models disagree the first time a lead time
 * or a boundary case is fixed in one of them and not the other — which is the
 * failure ADR-025 was written to prevent, and which F3's acceptance criteria
 * guarded against with "one renewal, one item".
 *
 * `daysUntilRenewal` below is therefore **reporting, not escalation**. It
 * answers "when is this?" for a list the user is already looking at. Nothing
 * here can put an item in the feed; that is `documents.ts`'s job and nobody
 * else's.
 *
 * ## Money
 *
 * Amounts are IEEE-754 doubles and deliberately stay that way. The obvious
 * alternative — integer minor units — is better arithmetic and is *not* being
 * adopted, because `expenses.amount` and `taxProfile.grossIncome` already feed
 * a verified tax estimate and rewriting their representation is a change to
 * existing financial semantics that must not happen quietly.
 *
 * The consequence is accepted and guarded rather than fixed. The specific
 * hazard is not that a double is imprecise; it is that a bad one is **plausible**.
 * `0.1 + 0.2` is `0.30000000000000004`, which a user reads as a rounding error
 * and a tax engine reads as a number. And `NaN <= 0` is `false`, so a naive
 * positivity guard waves NaN straight through into `estimateTax`, where every
 * downstream total becomes NaN and the estimate renders as a real-looking
 * figure that is entirely invented.
 *
 * So: every amount is checked by {@link isValidAmount} before it is written,
 * totals are accumulated exactly and rounded only at the moment they are
 * emitted, and {@link MAX_AMOUNT} bounds the magnitude so an absurd value is
 * refused at the door rather than displayed as a number nobody can act on.
 */

/** Milliseconds in a day. */
const DAY_MS = 86_400_000;

/**
 * Longest label on an account or a subscription. Bounded because a mutation
 * writes it, and because this is a list the user scans.
 */
export const MAX_LABEL = 80;

/**
 * The largest amount Panel will store.
 *
 * A guard, not a currency limit: 10^12 is far beyond any real subscription and
 * far below the point where a float stops being able to represent whole units
 * exactly. The point is to refuse a nonsense value at the boundary rather than
 * render a number like 1e21 that no user can read or act on.
 */
export const MAX_AMOUNT = 1_000_000_000_000;

/**
 * How often a subscription bills.
 *
 * Mirrors `subscriptionIntervalValidator` in the schema. The two lists are
 * written out separately because a Convex validator has to be a static literal
 * union, and keeping them in step is a reviewer's job — the same arrangement
 * `ACTIVITY_KINDS` and `activityKindValidator` already have.
 *
 * A closed vocabulary is what makes {@link annualCost} checkable. An open one
 * ("every 17 days") would push calendar arithmetic into every read, and the
 * genuinely awkward cases — a 28-day February, a leap year, a month that does
 * not exist — would have no single place to be pinned by a fixture.
 */
export type SubscriptionInterval = "weekly" | "monthly" | "quarterly" | "yearly";

export const SUBSCRIPTION_INTERVALS: readonly SubscriptionInterval[] = [
  "weekly",
  "monthly",
  "quarterly",
  "yearly",
];

export function isInterval(value: string): value is SubscriptionInterval {
  return (SUBSCRIPTION_INTERVALS as readonly string[]).includes(value);
}

/** How an account is labelled for grouping. Mirrors `accountKindValidator`. */
export type AccountKind = "checking" | "savings" | "cash" | "credit" | "investment";

export const ACCOUNT_KINDS: readonly AccountKind[] = [
  "checking",
  "savings",
  "cash",
  "credit",
  "investment",
];

export function isAccountKind(value: string): value is AccountKind {
  return (ACCOUNT_KINDS as readonly string[]).includes(value);
}

/** Closed for a reason: see `SubscriptionInterval`. */
const BILLINGS_PER_YEAR: Record<SubscriptionInterval, number> = {
  weekly: 52,
  monthly: 12,
  quarterly: 4,
  yearly: 1,
};

/**
 * Round to two decimal places, for **display only**.
 *
 * The accumulator is deliberately left exact. Rounding on write would corrupt a
 * stored value to hide a presentation artefact, which is the one thing that
 * makes a money system impossible to reason about afterwards: the number on
 * disk stops being the number that was entered, and nobody can say why.
 */
export function round2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * The single money guard. Every write path in Finance calls this.
 *
 * Rejects, in order: `NaN` and both infinities, because `NaN <= 0` is `false`
 * and a naive guard lets it through; non-positive amounts, because a
 * subscription costing nothing is not a subscription; and anything above
 * {@link MAX_AMOUNT}.
 *
 * Returns a boolean rather than throwing so it can be called from a pure
 * function and from a fixture without a try/catch. The mutations throw the
 * reason; this file only states the rule.
 */
export function isValidAmount(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value > 0 &&
    value <= MAX_AMOUNT
  );
}

/**
 * The same guard for a value that is **legitimately zero**.
 *
 * `taxProfile.grossIncome` may be 0 — a user with no declared income is a real
 * user, not a mistake — so it cannot go through {@link isValidAmount}. What it
 * must not be is `NaN`, and `grossIncome < 0` is not enough to catch that
 * because `NaN < 0` is `false` too. Two guards, one file, so neither call site
 * has to re-derive the rule.
 */
export function isValidNonNegativeAmount(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= MAX_AMOUNT
  );
}

/**
 * What a subscription costs across a year, derived and **never stored**.
 *
 * The whole point of the derivation is that `amount` and `annualCost` cannot
 * disagree: there is one number on the row, and everything else is a function
 * of it and the closed interval. A stored annual cost would be a second copy of
 * two fields — exactly what ADR-025 says a stored status is, and where copies
 * go wrong without anything noticing.
 *
 * Exact, then rounded. `9.99 × 52` is `519.4800000000001` in binary floating
 * point, and that is precisely the value the user must never see.
 */
export function annualCost(amount: number, interval: SubscriptionInterval): number {
  if (!isValidAmount(amount)) return 0;
  return round2(amount * BILLINGS_PER_YEAR[interval]);
}

/** Trim, collapse, bound. Returns null when nothing usable is left. */
export function normaliseLabel(raw: string, max = MAX_LABEL): string | null {
  const collapsed = raw.replace(/\s+/g, " ").trim();
  if (!collapsed) return null;
  return collapsed.slice(0, max);
}

/** The stored half of a subscription, as this file is allowed to see it. */
export interface SubscriptionRow {
  id: string;
  label: string;
  amount: number;
  interval: SubscriptionInterval;
  cancelled?: boolean | null;
  cancelledAt?: number | null;
  /** The renewal date, already read off the document. See ADR-029. */
  renewsAt?: number | null;
}

/**
 * Two states, and the smaller the better.
 *
 * The renewal is not a state here. It is a date on a document, and the
 * document owns what that date means — including the seven derived states that
 * feature 3 shipped. A subscription that invented a fourth notion of "renewing
 * soon" would be the second expiry model ADR-029 refuses.
 */
export type SubscriptionStatus = "active" | "cancelled";

export interface SubscriptionView {
  /**
   * The row's id, as an opaque string.
   *
   * `src/lib` does not know what a Convex id is and must not import one
   * (ADR-002), so it is typed as a string here and the query maps it — the same
   * arrangement `FollowUpRef._id` uses.
   *
   * It is in the view rather than reconstructed in the UI because a list whose
   * rows carry no identity cannot be acted on: keying by label and date means
   * two identically-named subscriptions collide, and "Cancel" then acts on the
   * wrong one. The compiler caught exactly that.
   */
  id: string;
  label: string;
  amount: number;
  interval: SubscriptionInterval;
  annualCost: number;
  status: SubscriptionStatus;
  /** Resolved label, or null when the user filed it under no account. */
  accountName: string | null;
  /**
   * Whole days until the renewal date, or null when there is no date. Null
   * means "nobody has recorded one", which is a real state, not a missing
   * field and not zero.
   */
  daysUntilRenewal: number | null;
  /**
   * The raw renewal date, in epoch ms, or null.
   *
   * Carried alongside the human distance so the UI can put a `<input type=date>`
   * on the real value. Without it the form has to *reconstruct* the date from
   * `daysUntilRenewal` and `Date.now()` at render time — a clock read inside
   * render, and a date that quietly drifts on every re-render. Two views of one
   * fact, one of them raw.
   */
  renewsAt: number | null;
  /** The one line shown in the list. Derived from the fields above. */
  detail: string;
}

const PERIOD_LABEL: Record<SubscriptionInterval, string> = {
  weekly: "week",
  monthly: "month",
  quarterly: "quarter",
  yearly: "year",
};

/**
 * Pure, and it takes `now` rather than reading a clock (ADR-002).
 *
 * `accountName` is passed in already resolved, because resolution — including
 * the detach case where an account was deleted and the subscription was kept —
 * belongs to the query that can see both rows. Three private copies of a
 * resolution rule is how two of them end up disagreeing, which is what
 * `peopleById` was exported to prevent.
 */
export function describeSubscription(
  row: SubscriptionRow,
  accountName: string | null,
  now: number,
): SubscriptionView {
  const status: SubscriptionStatus = row.cancelled ? "cancelled" : "active";
  const annual = annualCost(row.amount, row.interval);
  const hasDate = typeof row.renewsAt === "number" && Number.isFinite(row.renewsAt);

  // `Math.round` of a small negative fraction is **`-0`**, not `0` — and `-0`
  // is a real value that formats as "-0" and fails `Object.is(x, 0)`. A
  // subscription one millisecond before its renewal would otherwise report a
  // negative zero days and read as nonsense. Found by a fixture, not by
  // inspection, which is the only way this would ever have been seen.
  const rawDays = hasDate ? Math.round((row.renewsAt! - now) / DAY_MS) : null;
  const daysUntilRenewal = rawDays === null ? null : rawDays === 0 ? 0 : rawDays;

  let detail: string;
  if (status === "cancelled") {
    detail = row.cancelledAt
      ? `Cancelled on ${formatDay(row.cancelledAt)}`
      : "Cancelled";
  } else if (daysUntilRenewal === null) {
    detail = `${formatAmount(row.amount)} ${PERIOD_LABEL[row.interval]}, no renewal date recorded`;
  } else if (daysUntilRenewal < 0) {
    const late = Math.abs(daysUntilRenewal);
    detail = `Last renewed ${late} ${late === 1 ? "day" : "days"} ago`;
  } else if (daysUntilRenewal === 0) {
    detail = "Renews today";
  } else {
    detail = `Renews in ${daysUntilRenewal} ${daysUntilRenewal === 1 ? "day" : "days"}`;
  }

  return {
    id: row.id,
    label: row.label,
    amount: row.amount,
    interval: row.interval,
    annualCost: annual,
    status,
    accountName,
    daysUntilRenewal,
    renewsAt: hasDate ? row.renewsAt! : null,
    detail,
  };
}

/**
 * "£9.99", not "£9.989999999999999" and not "£9.99/month/month".
 *
 * Rounded here rather than at the call site so every surface formats money the
 * same way, and deliberately *not* carrying a currency symbol — a symbol
 * belongs to the account the user is looking at, and a function that guesses
 * one would be wrong the moment a user's profile country and their expense
 * disagree.
 */
export function formatAmount(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return round2(n).toFixed(2);
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** "4 Mar" — unambiguous, short, and local, like every other date in Panel. */
export function formatDay(at: number): string {
  if (!Number.isFinite(at)) return "—";
  const d = new Date(at);
  return `${d.getDate()} ${MONTH_NAMES[d.getMonth()]}`;
}

/** "Mon 4 Mar" — used where the weekday is the point, e.g. a cancellation. */
export function formatDayLong(at: number): string {
  if (!Number.isFinite(at)) return "—";
  const d = new Date(at);
  return `${DAY_NAMES[d.getDay()]} ${d.getDate()} ${MONTH_NAMES[d.getMonth()]}`;
}

/**
 * The list summary.
 *
 * Sums the **rounded per-row** annual costs, not the exact ones, and that is
 * deliberate rather than lazy: the total then equals the sum of the figures the
 * user can actually see in the list above it. A total that matched the
 * unrounded arithmetic but not the displayed rows is the kind of discrepancy
 * that destroys trust in a number — "it says 35.64 but those add to 35.61".
 * The row values are rounded, so the row values are the ones that must add up.
 */
export interface SubscriptionSummary {
  activeCount: number;
  cancelledCount: number;
  annualTotal: number;
  /** Annual cost of only the active subscriptions. */
  activeAnnualTotal: number;
  byAccount: { accountName: string | null; annualCost: number; count: number }[];
}

export function summariseSubscriptions(
  views: readonly SubscriptionView[],
): SubscriptionSummary {
  let activeCount = 0;
  let cancelledCount = 0;
  let activeAnnualTotal = 0;
  let annualTotal = 0;
  const byAccount = new Map<string | null, { annualCost: number; count: number }>();

  for (const v of views) {
    if (v.status === "cancelled") {
      cancelledCount += 1;
    } else {
      activeCount += 1;
      activeAnnualTotal += v.annualCost;
    }
    annualTotal += v.annualCost;

    const cur = byAccount.get(v.accountName) ?? { annualCost: 0, count: 0 };
    cur.annualCost += v.annualCost;
    cur.count += 1;
    byAccount.set(v.accountName, cur);
  }

  return {
    activeCount,
    cancelledCount,
    annualTotal: round2(annualTotal),
    activeAnnualTotal: round2(activeAnnualTotal),
    byAccount: [...byAccount.entries()]
      .map(([accountName, v]) => ({
        accountName,
        annualCost: round2(v.annualCost),
        count: v.count,
      }))
      // Ungrouped last, so the rows the user can act on are at the top.
      .sort((a, b) =>
        a.accountName === null
          ? 1
          : b.accountName === null
            ? -1
            : b.annualCost - a.annualCost,
      ),
  };
}

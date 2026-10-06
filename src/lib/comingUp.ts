/**
 * Coming up — the deterministic "what is due soon" slice (product build phase).
 *
 * The dashboard already holds a bounded, ranked read of the user's own tasks.
 * This module answers one question from it, in pure code: **what is due over
 * the next seven days?** It is a forecast in the honest sense — the same due
 * dates the attention feed ranks, grouped by day — and nothing more. There is
 * no prediction here, no model, no invented signal: a date is a date.
 *
 * Three rules decide what counts, and each exists to keep the card from
 * lying:
 *
 * 1. **Overdue belongs to "Needs you", not here.** A task whose moment has
 *    already passed is not "coming up" — showing it in a forward-looking card
 *    would double-report it while the attention feed and the Overdue tile are
 *    already accountable for it. The cut is `dueAt >= now`, same clock as the
 *    board's own overdue flag.
 * 2. **The horizon is a calendar boundary, not a rolling 168 hours.** The
 *    window ends at midnight at the end of the seventh calendar day counted
 *    from today, so "Friday evening" stays in the card on Monday morning. The
 *    exclusive end timestamp is returned so the UI can say precisely where the
 *    window stops instead of approximating it in copy.
 * 3. **The cap is reported, never absorbed.** `more` counts what the window
 *    held beyond `COMING_UP_MAX`; a card that silently drops the sixth task
 *    teaches the user to distrust the five it shows.
 *
 * Completed tasks, undated tasks and tasks outside the window are excluded —
 * a "coming up" card that lists finished work is the same class of defect as
 * a health dashboard that shows yesterday's numbers.
 *
 * Pure and dependency-free, like everything in `src/lib` (ADR-002). The clock
 * is injected so fixtures never depend on the day they run.
 */

/** Calendar days covered, counting today. The window ends at the midnight
 *  that closes the seventh day (today + 6). */
export const COMING_UP_DAYS = 7;

/** Most rows the card lists before the rest are reported as a count. */
export const COMING_UP_MAX = 6;

/** Which day-bucket a row falls in, relative to the injected clock. */
export type ComingUpBucket = "today" | "tomorrow" | "later";

export interface ComingUpItem {
  id: string;
  title: string;
  dueAt: number;
  bucket: ComingUpBucket;
}

export interface ComingUp {
  /** Soonest first, never longer than `COMING_UP_MAX`. */
  items: ComingUpItem[];
  /** In-window rows beyond the cap. 0 means the list is complete. */
  more: number;
  /** Exclusive end of the window — midnight closing day (today + 6). */
  horizonEnd: number;
}

/** The shape this module needs from a task; the dashboard's rows satisfy it. */
export interface ComingUpTask {
  id: string;
  title: string;
  dueAt: number | null;
  completed: boolean;
}

const DAY_MS = 86_400_000;

function startOfDay(now: Date): number {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  return start.getTime();
}

/**
 * Selects the next seven days' worth of open, dated work.
 *
 * Sorting is by `dueAt` ascending — time order, not rank order: the question
 * this card answers is *when*, and the ranking already had its turn in the
 * board list above it.
 */
export function selectComingUp(
  tasks: readonly ComingUpTask[],
  now: Date,
  max: number = COMING_UP_MAX,
): ComingUp {
  const nowMs = now.getTime();
  const dayStart = startOfDay(now);
  const horizonEnd = dayStart + COMING_UP_DAYS * DAY_MS;
  const tomorrowStart = dayStart + DAY_MS;
  const laterStart = dayStart + 2 * DAY_MS;

  const inWindow = tasks.filter(
    (t) =>
      !t.completed &&
      t.dueAt !== null &&
      t.dueAt >= nowMs &&
      t.dueAt < horizonEnd,
  );
  inWindow.sort((a, b) => (a.dueAt as number) - (b.dueAt as number));

  const items: ComingUpItem[] = inWindow.slice(0, max).map((t) => ({
    id: t.id,
    title: t.title,
    dueAt: t.dueAt as number,
    bucket:
      (t.dueAt as number) < tomorrowStart
        ? "today"
        : (t.dueAt as number) < laterStart
          ? "tomorrow"
          : "later",
  }));

  return {
    items,
    more: Math.max(0, inWindow.length - max),
    horizonEnd,
  };
}

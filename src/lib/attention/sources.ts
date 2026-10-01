/**
 * Data adapters for the attention rules (SYSTEM_FUNDAMENTALS §9.5).
 *
 * These functions do no deciding. They narrow the user's own records into the
 * small, flat shapes the rules need, so `rules.ts` never has to know what a
 * Convex document looks like and never has to reach past its data. Keeping the
 * two apart is what makes the rules testable from plain object literals.
 *
 * Everything here is pure and takes `now`.
 */

export interface TaskView {
  _id: string;
  title: string;
  completed: boolean;
  area: string;
  dueAt?: number | null;
  priority: number;
  tags?: string[];
  /** Set when the row came from a connected tool and that tool went away. */
  orphanedSource?: boolean;
  sourceDisconnected?: boolean;
  /** Phase 1.1: when it was created, for `AGE`. Absent means "assume now". */
  createdAt?: number;
  /** Phase 1.1: how it arrived, for `SOURCE_FIT`. */
  source?: string;
  /** Phase 1.1: the person involved, for `PEOPLE_FIT`. Empty until phase 3. */
  person?: string;
}

export interface DeadlineView {
  id: string;
  label: string;
  /** ISO date (YYYY-MM-DD) or null when it depends on circumstance. */
  date: string | null;
  note: string;
  source: string;
  /** Which country's authority set this date. */
  country: string;
}

export interface ConnectionView {
  _id: string;
  provider: string;
  label: string;
  status: string;
  connectedAt: number;
  lastSyncedAt?: number;
}

export interface DocumentView {
  requirementId: string;
  label: string;
  /** 0..1. Drives the "nearly ready" rule. */
  readiness: number;
  missing: string[];
}

const DAY_MS = 86_400_000;

/** Open tasks only, soonest first. Completed rows are never attention. */
export function openTasks(tasks: TaskView[]): TaskView[] {
  return tasks
    .filter((t) => !t.completed)
    .slice()
    .sort((a, b) => (a.dueAt ?? Number.POSITIVE_INFINITY) - (b.dueAt ?? Number.POSITIVE_INFINITY));
}

/**
 * Statutory deadlines, soonest first, with days-to-go computed once.
 *
 * `date` is an ISO day, so the comparison is done on the *end* of that day: a
 * return due today is not "passed" at 09:00.
 */
export function upcomingDeadlines(deadlines: DeadlineView[], now: number): (DeadlineView & { daysAway: number | null; passed: boolean })[] {
  return deadlines
    .map((d) => {
      if (!d.date) return { ...d, daysAway: null, passed: false };
      // The deadline bites at the *end* of its day, so "due today" is zero days
      // away even at nine in the morning. Floor, not round: rounding would turn
      // a deadline due later today into "tomorrow".
      const endOfDay = new Date(`${d.date}T23:59:59`).getTime();
      const daysAway = Math.floor((endOfDay - now) / DAY_MS);
      return { ...d, daysAway, passed: daysAway < 0 };
    })
    .sort((a, b) => (a.daysAway ?? Number.POSITIVE_INFINITY) - (b.daysAway ?? Number.POSITIVE_INFINITY));
}

/** Connections that have not synced in `staleAfterMs`. */
export function staleConnections(connections: ConnectionView[], now: number, staleAfterMs = 48 * 3_600_000): ConnectionView[] {
  return connections
    .filter((c) => c.status !== "coming-soon")
    .filter((c) => {
      const last = c.lastSyncedAt ?? c.connectedAt;
      return now - last >= staleAfterMs;
    })
    .sort((a, b) => (a.lastSyncedAt ?? a.connectedAt) - (b.lastSyncedAt ?? b.connectedAt));
}

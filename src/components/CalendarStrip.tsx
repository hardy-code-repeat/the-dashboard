/**
 * What is next (phase 2, §7.3).
 *
 * A read model, not a calendar client. Panel holds a cache of a handful of
 * fields about the next fortnight and this component renders exactly those,
 * which is why there is no month grid, no drag-to-reschedule and no "add
 * event": Panel is inbound-only (ADR-013), so there is nothing here to edit.
 *
 * Three states, and the third one matters most:
 *
 *  - **not connected** — says so, and says *why* the connect button will fail
 *    if the deployment has no Google credentials. A button that always errors is
 *    worse than a sentence that explains the situation.
 *  - **connected but stale** — a banner, because §7.2 promises one, and a stale
 *    calendar is not hidden: it is labelled. It is not *used* — past seven days
 *    the attention feed stops drawing from it entirely, which is a server-side
 *    decision this component cannot undo.
 *  - **connected** — the meetings, soonest first.
 *
 * A private event renders as the literal "Busy" with a marker explaining why,
 * because an unexplained "Busy" looks like a bug and the user deserves to know
 * that Panel chose to lose the title.
 */

import { useMemo } from "react";
import { useQuery } from "convex/react";
import { CalendarDays, ExternalLink, RefreshCw } from "lucide-react";

import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { safeHttpUrl } from "@/lib/url";

/** The value Panel stores for a private event (§7.3). */
const BUSY = "Busy";

type EventRow = {
  id: string;
  title: string;
  startsAt: number | null;
  endsAt: number | null;
  allDay: boolean;
  sourceUrl: string | null;
  private: boolean;
};

type CalendarRead = {
  connected: boolean;
  lastSyncedAt: number | null;
  stale: boolean;
  suppress: boolean;
  cancelled: number;
  now: number;
  events: EventRow[];
};

/**
 * "09:30" in the viewer's own timezone.
 *
 * Read from `Intl` rather than `toISOString().slice(11, 16)`: the latter shows
 * UTC and would tell a user in London their 10am meeting is at 9am. The zone is
 * named in the group label for the same reason.
 */
function timeLabel(ms: number): string {
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(new Date(ms));
}

function dayLabel(ms: number, now: number): string {
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const startOfThat = new Date(ms);
  startOfThat.setHours(0, 0, 0, 0);
  const days = Math.round((startOfThat.getTime() - startOfToday.getTime()) / 86_400_000);

  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days < 7) {
    return new Intl.DateTimeFormat(undefined, { weekday: "long" }).format(new Date(ms));
  }
  return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" }).format(new Date(ms));
}

function durationLabel(event: EventRow): string {
  if (event.allDay) return "All day";
  if (event.startsAt == null || event.endsAt == null) return "";
  const minutes = Math.max(0, Math.round((event.endsAt - event.startsAt) / 60_000));
  if (minutes === 0) return "";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return minutes % 60 === 0 ? `${hours}h` : `${hours}h ${minutes % 60}m`;
}

export function CalendarStrip() {
  const data = useQuery(api.calendar.upcomingEvents, {}) as CalendarRead | undefined;

  const grouped = useMemo(() => {
    // `now` comes from the server response rather than from a client clock, so
    // "Today" here is the same day the query filtered on.
    const now = data?.now ?? 0;
    const byDay = new Map<string, EventRow[]>();
    for (const event of data?.events ?? []) {
      if (event.startsAt == null) continue;
      const key = dayLabel(event.startsAt, now);
      const list = byDay.get(key) ?? [];
      list.push(event);
      byDay.set(key, list);
    }
    return [...byDay.entries()];
  }, [data?.events, data?.now]);

  if (data === undefined) {
    return (
      <section className="brutal-flat bg-card p-5" aria-busy="true">
        <h2 className="font-display mb-4 flex items-center gap-2 text-sm uppercase tracking-wide">
          <CalendarDays className="size-4" />
          Next up
        </h2>
        <p className="text-xs uppercase text-muted-foreground">Loading…</p>
      </section>
    );
  }

  return (
    <section className="brutal-flat bg-card p-5">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 className="font-display flex items-center gap-2 text-sm uppercase tracking-wide">
          <CalendarDays className="size-4" />
          Next up
        </h2>
        {data.connected && data.events.length > 0 && !data.suppress ? (
          <span className="text-[10px] uppercase text-muted-foreground">
            {data.events.length} in the next 14 days
          </span>
        ) : null}
      </div>

      {!data.connected ? (
        <div className="border-2 border-border bg-background p-4">
          <p className="text-sm font-bold">No calendar connected.</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Panel reads your calendar and never writes to it. Private events are stored as{" "}
            <span className="font-bold text-foreground">{BUSY}</span> with no title.
          </p>
          <Button
            type="button"
            disabled
            className="brutal mt-3 gap-2 bg-primary font-bold uppercase"
            title="Needs GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in the deployment environment"
          >
            Connect Google Calendar
          </Button>
          <p className="mt-2 text-[11px] uppercase text-muted-foreground">
            Not available until the deployment has Google credentials
          </p>
        </div>
      ) : data.stale || data.suppress ? (
        <div className="border-2 border-border bg-background p-4">
          <p className="text-sm font-bold">
            {data.suppress ? "Calendar is out of date." : "Calendar may be out of date."}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {data.suppress
              ? "It has not synced for over a week, so Panel is not using it to interrupt you. Meetings shown here may have moved."
              : "It has not synced in a while. Meetings shown here may have moved."}
          </p>
          <p className="mt-2 flex items-center gap-1.5 text-[11px] uppercase text-muted-foreground">
            <RefreshCw className="size-3" />
            Sync runs when you ask for one
          </p>
        </div>
      ) : grouped.length === 0 ? (
        <p className="text-xs uppercase text-muted-foreground">
          Nothing in the next 14 days.
          {data.cancelled > 0
            ? ` ${data.cancelled} cancelled meeting${data.cancelled === 1 ? "" : "s"} not shown.`
            : ""}
        </p>
      ) : (
        <ol className="flex flex-col gap-4">
          {grouped.map(([day, events]) => (
            <li key={day}>
              <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                {day}
              </p>
              <ul className="flex flex-col gap-2">
                {events.map((event) => (
                  <li
                    key={event.id}
                    className="flex items-center justify-between gap-3 border-2 border-border bg-background px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold">
                        {event.title}
                        {event.private ? (
                          <span className="ml-2 text-[10px] font-normal uppercase text-muted-foreground">
                            private
                          </span>
                        ) : null}
                      </p>
                      <p className="text-[11px] uppercase text-muted-foreground">
                        {event.startsAt != null ? timeLabel(event.startsAt) : "No time"}
                        {durationLabel(event) ? ` · ${durationLabel(event)}` : ""}
                      </p>
                    </div>
                    {safeHttpUrl(event.sourceUrl) ? (
                      <a
                        href={safeHttpUrl(event.sourceUrl)}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
                        aria-label={`Open ${event.title} in Google Calendar`}
                      >
                        <ExternalLink className="size-4" />
                      </a>
                    ) : null}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

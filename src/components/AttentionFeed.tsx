import { useMutation, useQuery } from "convex/react";
import { AnimatePresence, motion } from "framer-motion";
import { AlarmClock, Check, Clock, Loader2, Pin, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The attention feed (phase 1.0).
 *
 * Presentational on purpose. Every decision — which items exist, in what
 * order, what is allowed — is made by the rules and the pipeline on the server.
 * This component's only job is to render what it is given and send back what
 * the user did, so the rules stay testable without a browser.
 */

export type AttentionItemView = {
  kind: string;
  sourceId: string;
  section: string;
  class: "hard" | "ranked";
  area?: string;
  severity: number;
  title: string;
  detail?: string;
  dueAt: number | null;
  escalation: 0 | 1 | 2;
  pinned?: boolean;
  groupSize: number;
  grouped: boolean;
  seenCount: number;
  snoozedUntil: number | null;
  explore: boolean;
  score: number;
  reasons?: { label: string; contribution: number }[];
  /** Stable identity used to record feedback. */
  fingerprint: string;
  action?: { label: string; kind: string };
};

type SectionView = {
  section: string;
  label: string;
  blurb: string;
  max: number;
  halfLife: number | null;
  items: AttentionItemView[];
};

type FeedView = {
  now: number;
  items: AttentionItemView[];
  sections: SectionView[];
  hiddenByCap: Record<string, number>;
  hiddenByTotalCap: number;
  produced: number;
  truncated: boolean;
  learning: {
    active: boolean;
    samples: number;
    paused: boolean;
    enabled: boolean;
    suppressedKinds: string[];
    suppressedAreas: string[];
  };
};

const ESCALATION_MARK: Record<number, string> = {
  0: "",
  1: "Important",
  2: "Urgent",
};

export function AttentionFeed() {
  const attention = useQuery(api.attention.getAttention) as FeedView | undefined | null;
  const acted = useMutation(api.attention.attentionActed);
  const dismissed = useMutation(api.attention.attentionDismissed);
  const snoozed = useMutation(api.attention.attentionSnoozed);
  const rejected = useMutation(api.attention.attentionRejected);
  const setCompleted = useMutation(api.assistant.setTaskCompleted);
  const [busy, setBusy] = useState<string | null>(null);

  if (attention === undefined) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
        <Loader2 className="size-4 animate-spin" aria-hidden />
        Working out what needs you…
      </div>
    );
  }

  if (attention === null) {
    return <p className="text-sm text-muted-foreground">Sign in to see what needs you.</p>;
  }

  const now = attention.now;
  const total = attention.items.length;
  const hidden =
    Object.values(attention.hiddenByCap).reduce((a, b) => a + b, 0) + attention.hiddenByTotalCap;

  async function run(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "That did not work");
    } finally {
      setBusy(null);
    }
  }

  async function onAct(item: AttentionItemView) {
    await run(item.fingerprint, async () => {
      await acted(describe(item));
      // Acting on a task means doing it. A "Done" that does not tick the box
      // would be the kind of lie that makes the rest of the app untrustworthy.
      if (TASK_KINDS.has(item.kind)) {
        await setCompleted({ id: item.sourceId as never, completed: true });
      }
    });
  }

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">Needs you</h2>
        <p className="text-sm text-muted-foreground">
          {total === 0
            ? "Nothing right now. That is a real answer, not a loading state."
            : `${total} item${total === 1 ? "" : "s"}. Overdue work and fixed dates come from rules and never from the model.`}
        </p>
        <LearningNote learning={attention.learning} />
        {hidden > 0 && (
          <p className="text-xs text-muted-foreground" role="status">
            {hidden} more item{hidden === 1 ? " is" : "s are"} hidden by the section limits. Each
            section shows at most a fixed number so the list stays readable.
          </p>
        )}
      </header>

      {attention.sections.map((section: SectionView) => (
        <AttentionSection key={section.section} section={section} busy={busy} onAct={onAct} onRun={run}
          now={now} dismissed={dismissed} snoozed={snoozed} rejected={rejected} />
      ))}
    </div>
  );
}

/** Task kinds whose "Done" button can honestly tick the underlying task. */
const TASK_KINDS = new Set([
  "task.overdue",
  "task.imminent",
  "task.planned",
  "task.due",
  "task.someday",
]);

/**
 * The feedback payload for an item.
 *
 * `kind` travels with the feedback so the server can decide, from its own list,
 * whether this is a hard-rule item. The client is not trusted to classify it —
 * a client that lied could only mis-train the user's own model, never leak data
 * and never hide a deadline.
 */
function describe(item: AttentionItemView) {
  return {
    fingerprint: item.fingerprint,
    objectId: item.sourceId,
    kind: item.kind,
    area: item.area,
    dueAt: item.dueAt,
    escalation: item.escalation,
  };
}

/**
 * Says out loud whether the model is steering the list.
 *
 * A ranking that explains itself is one the user can correct, and a user who
 * cannot tell when learning is off has no way to know the screen is not
 * personal to them. Silence here would be the dishonest option.
 */
function LearningNote({ learning }: { learning: FeedView["learning"] }) {
  if (learning.paused || !learning.enabled) {
    return (
      <p className="text-xs text-muted-foreground">
        Learning is paused, so this list is not personalised. Rules still apply.
      </p>
    );
  }
  if (!learning.active) {
    return (
      <p className="text-xs text-muted-foreground">
        Ordering by your own history starts after 12 signals. Until then this is a plain
        priority order.
      </p>
    );
  }
  const hidden = learning.suppressedKinds.length + learning.suppressedAreas.length;
  return (
    <p className="text-xs text-muted-foreground">
      Ordered by what you actually finish
      {hidden > 0 ? ` · ${hidden} categories muted by you` : ""}.
    </p>
  );
}

type AttentionArgs = ReturnType<typeof describe>;
type SnoozeArgs = Omit<AttentionArgs, "kind" | "area" | "dueAt"> & { until?: number };
type RejectArgs = Omit<AttentionArgs, "escalation" | "dueAt">;

function AttentionSection({
  section,
  busy,
  onAct,
  onRun,
  now,
  dismissed,
  snoozed,
  rejected,
}: {
  section: SectionView;
  busy: string | null;
  onAct: (item: AttentionItemView) => Promise<void>;
  onRun: (key: string, fn: () => Promise<unknown>) => Promise<void>;
  now: number;
  dismissed: (args: AttentionArgs) => Promise<unknown>;
  snoozed: (args: SnoozeArgs) => Promise<unknown>;
  rejected: (args: RejectArgs) => Promise<unknown>;
}) {
  const items = section.items;
  return (
    <section aria-labelledby={`attention-${section.section}`} className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <h3 id={`attention-${section.section}`} className="text-sm font-semibold uppercase tracking-wide">
          {section.label}
        </h3>
        <span className="text-xs text-muted-foreground">
          {items.length}/{section.max}
        </span>
      </div>

      {items.length === 0 ? (
        <p className="rounded border border-dashed px-3 py-4 text-sm text-muted-foreground">
          {section.blurb} Nothing here.
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          <AnimatePresence initial={false}>
            {items.map((item) => (
              <motion.li
                key={item.fingerprint}
                layout
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.16 }}
                className={cn(
                  "flex flex-wrap items-center gap-2 rounded border px-3 py-2",
                  item.escalation === 2 ? "border-destructive/60 bg-destructive/5" : "border-border",
                )}
              >
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-medium">
                    {item.explore ? (
                      <span
                        className="mr-1.5 rounded border border-dashed border-muted-foreground/60 px-1 align-middle text-[10px] font-normal uppercase tracking-wide text-muted-foreground"
                        title="Shown because the ranking has not proved itself yet, not because it scored highly."
                      >
                        exploring
                      </span>
                    ) : null}
                    {item.title}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    {item.pinned ? <Pin className="mr-1 inline size-3" aria-hidden /> : null}
                    {ESCALATION_MARK[item.escalation] ? `${ESCALATION_MARK[item.escalation]} · ` : ""}
                    {item.detail ? `${item.detail} · ` : ""}
                    {item.dueAt ? <DueLabel dueAt={item.dueAt} now={now} /> : "No date"}
                    {item.reasons && item.reasons.length > 0
                      ? ` · ${item.reasons.map((r) => r.label).join(", ")}`
                      : ""}
                  </span>
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    size="sm"
                    variant={item.escalation === 2 ? "default" : "ghost"}
                    disabled={busy === item.fingerprint}
                    onClick={() => void onAct(item)}
                  >
                    <Check className="size-3.5" aria-hidden />
                    <span className="sr-only">Mark </span>
                    {item.action?.label ?? "Act"}
                  </Button>

                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy === item.fingerprint}
                    onClick={() =>
                      void onRun(item.fingerprint, () =>
                        snoozed({
                          fingerprint: item.fingerprint,
                          objectId: item.sourceId,
                          escalation: item.escalation,
                          // A level-2 item is refused without a return date by the
                          // server; sending one for ordinary items is the default.
                          until: item.escalation === 2 ? now + 3_600_000 : undefined,
                        }),
                      )
                    }
                  >
                    <Clock className="size-3.5" aria-hidden />
                    <span className="sr-only">Snooze </span>
                    Later
                  </Button>

                  {item.escalation < 2 && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy === item.fingerprint}
                      onClick={() =>void onRun(item.fingerprint, () => dismissed(describe(item)))
                      }
                    >
                      <X className="size-3.5" aria-hidden />
                      <span className="sr-only">Dismiss </span>
                    </Button>
                  )}

                  {item.escalation === 2 && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy === item.fingerprint}
                      onClick={() =>
                        void onRun(item.fingerprint, () =>
                          rejected(describe(item) as never),
                        )
                      }
                      title="Not for me"
                    >
                      <AlarmClock className="size-3.5" aria-hidden />
                      <span className="sr-only">Not for me</span>
                    </Button>
                  )}
                </div>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
    </section>
  );
}

function DueLabel({ dueAt, now }: { dueAt: number; now: number }) {
  // `now` is passed in rather than read from the clock, so the rendered label
  // is the same value the server ranked the item with.
  const hours = Math.round((dueAt - now) / 3_600_000);
  const text =
    hours < 0
      ? `${Math.abs(hours)}h overdue`
      : hours === 0
        ? "due now"
        : hours < 24
          ? `in ${hours}h`
          : `in ${Math.round(hours / 24)}d`;
  return <>{text}</>;
}

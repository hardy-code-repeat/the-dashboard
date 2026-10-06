import { useMutation, useQuery } from "convex/react";
import { AnimatePresence, motion } from "framer-motion";
import { AlarmClock, Check, Clock, Loader2, Pin, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { areaBySlug } from "@/lib/areas";
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
  // One wiring of "what the user did" for every surface that renders these
  // items — the full feed below and the board's summary card — so an action
  // cannot mean one thing on one screen and another thing on the next.
  const { busy, run, onAct, dismissed, snoozed, rejected } = useAttentionActions();

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

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <h2 className="font-display text-lg uppercase tracking-tight">Needs you</h2>
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

/** Attention kinds whose action is to *start* something rather than finish it. */
const START_RENEWAL = "document.expiring";

/** A wait: the button creates the chase task and settles nothing. */
const FOLLOW_UP_COMMITMENT = "commitment.waiting";

/** A promise: the button records that the user kept it. */
const SETTLE_COMMITMENT = "commitment.overdue";

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
        <h3
          id={`attention-${section.section}`}
          className="font-display text-sm uppercase tracking-wide"
        >
          {section.label}
        </h3>
        <span className="text-xs text-muted-foreground">
          {items.length}/{section.max}
        </span>
      </div>

      {items.length === 0 ? (
        <p className="border-2 border-dashed border-border px-3 py-4 text-[11px] uppercase text-muted-foreground">
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
                  "flex flex-wrap items-center gap-2 border-2 px-3 py-2",
                  item.escalation === 2
                    ? "border-destructive/60 bg-destructive/5"
                    : "border-border",
                )}
              >
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-medium">
                    {item.explore ? (
                      <span
                        className="mr-1.5 border border-dashed border-muted-foreground/60 px-1 align-middle text-[10px] font-normal uppercase tracking-wide text-muted-foreground"
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

/**
 * The wiring behind every attention action, shared by both surfaces.
 *
 * Extracted when the board gained its summary card, for one reason: a "Done"
 * on the first screen and a "Done" in the full feed must tick the same task,
 * start the same renewal and settle the same promise. One copy of those rules
 * is the only way the two cannot drift apart.
 */
function useAttentionActions() {
  const acted = useMutation(api.attention.attentionActed);
  const dismissed = useMutation(api.attention.attentionDismissed);
  const snoozed = useMutation(api.attention.attentionSnoozed);
  const rejected = useMutation(api.attention.attentionRejected);
  const setCompleted = useMutation(api.assistant.setTaskCompleted);
  const startRenewal = useMutation(api.documents.startRenewal);
  const followUpCommitment = useMutation(api.commitments.followUp);
  const settleCommitment = useMutation(api.commitments.completeCommitment);
  const [busy, setBusy] = useState<string | null>(null);

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
      // An expiring document's button says "Start renewal", so it has to
      // actually start one. A button that only records that it was pressed
      // would be the kind of lie the rest of this feed is careful not to tell —
      // and it is precisely the silent no-op STEP 20 asks us to look for.
      if (item.kind === START_RENEWAL) {
        await startRenewal({ id: item.sourceId as Id<"documents"> });
      }
      // Same rule, same reason, two more kinds (phase 3, feature 4).
      //
      // "Done it" on a promise settles it — the user did what they said, and the
      // item should stop shouting. "Follow up" on a wait creates the chase task
      // and **does not** settle the wait: chasing somebody is not receiving from
      // them, and a button that conflated the two would be Panel asserting a
      // fact about a third party it never observed.
      if (item.kind === FOLLOW_UP_COMMITMENT) {
        await followUpCommitment({ id: item.sourceId as Id<"commitments"> });
      }
      if (item.kind === SETTLE_COMMITMENT) {
        await settleCommitment({ id: item.sourceId as Id<"commitments"> });
      }
    });
  }

  return { busy, run, onAct, dismissed, snoozed, rejected };
}

/** How many rows the board's summary card shows before pointing at the feed. */
const SUMMARY_MAX = 3;

/**
 * The board's "Needs you" card — the product's promise on the first screen.
 *
 * The full feed lived one toggle away from the opening view, which meant the
 * answer to "what needs me?" arrived only after the user already knew to look
 * for it. This card puts that answer — same query, same action wiring, same
 * honest labels — on the screen the app opens to, **without merging the two
 * views**: the feed keeps its sections, caps and controls, and the card is a
 * window onto it rather than a second feed that could disagree.
 *
 * Deliberately a window and not a summary of the summary: rows are flattened
 * in the pipeline's own priority order, so the card shows exactly what the
 * feed would show first. When nothing needs the user, the card is absent — a
 * banner announcing an empty list is noise in the place the eye lands first.
 */
export function AttentionSummary({ onSeeAll }: { onSeeAll: () => void }) {
  const attention = useQuery(api.attention.getAttention) as FeedView | undefined | null;
  const { busy, run, onAct, snoozed } = useAttentionActions();

  // Loading or signed out: render nothing. A placeholder that vanishes a
  // moment later would put motion exactly where the user is trying to read.
  if (attention === undefined || attention === null) return null;

  const now = attention.now;
  const total = attention.items.length;
  if (total === 0) return null;

  const hidden =
    Object.values(attention.hiddenByCap).reduce((a, b) => a + b, 0) +
    attention.hiddenByTotalCap;

  const rows = attention.sections
    .flatMap((section) =>
      section.items.map((item) => ({
        section: section.label,
        item,
        area: areaBySlug(item.area ?? "")?.label ?? null,
      })),
    )
    .slice(0, SUMMARY_MAX);

  return (
    <section aria-label="Needs you" className="brutal-flat mb-8 bg-card p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <AlarmClock className="size-4" aria-hidden />
          <h2 className="font-display text-sm uppercase tracking-wide">Needs you</h2>
          <span className="border-2 border-border bg-primary px-1.5 py-0.5 text-[10px] font-bold uppercase">
            {total}
          </span>
        </div>
        <button
          type="button"
          onClick={onSeeAll}
          className="brutal-press border-2 border-border px-3 py-1.5 text-[11px] font-bold uppercase hover:bg-muted"
        >
          See all
        </button>
      </div>

      <ul className="flex flex-col gap-2">
        {rows.map(({ section, item, area }) => (
          <li
            key={item.fingerprint}
            className={cn(
              // Mutually exclusive colour classes, never two border-colour
              // utilities stacked: which one wins would be decided by the
              // stylesheet's order, not by this attribute.
              "flex flex-wrap items-center gap-2 border-2 p-3",
              item.escalation === 2
                ? "border-destructive/60 bg-destructive/5"
                : "border-border bg-background",
            )}
          >
            <div className="flex min-w-0 flex-1 flex-col">
              <p className="text-sm font-medium break-words">{item.title}</p>
              <p className="mt-1 flex flex-wrap items-center gap-2 text-[10px] uppercase text-muted-foreground">
                <span className="border-2 border-border bg-card px-1.5 py-0.5 font-bold">
                  {section}
                </span>
                {area && (
                  <span className="border-2 border-border bg-card px-1.5 py-0.5 font-bold">
                    {area}
                  </span>
                )}
                {item.detail ? <span>{item.detail}</span> : null}
                {item.dueAt ? (
                  <DueLabel dueAt={item.dueAt} now={now} />
                ) : (
                  <span>No date</span>
                )}
              </p>
            </div>

            <div className="flex shrink-0 items-center gap-1">
              <Button
                size="sm"
                variant={item.escalation === 2 ? "default" : "outline"}
                disabled={busy === item.fingerprint}
                onClick={() => void onAct(item)}
                className="gap-1 font-bold uppercase"
              >
                <Check className="size-3.5" aria-hidden />
                {item.action?.label ?? "Act"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy === item.fingerprint}
                onClick={() =>
                  void run(item.fingerprint, () =>
                    snoozed({
                      fingerprint: item.fingerprint,
                      objectId: item.sourceId,
                      escalation: item.escalation,
                      until: item.escalation === 2 ? now + 3_600_000 : undefined,
                    }),
                  )
                }
              >
                <Clock className="size-3.5" aria-hidden />
                Later
              </Button>
            </div>
          </li>
        ))}
      </ul>

      {hidden > 0 && (
        <p className="mt-3 text-[11px] uppercase text-muted-foreground">
          {hidden} more {hidden === 1 ? "item is" : "items are"} hidden here — each
          section shows a fixed number so the list stays readable.
        </p>
      )}
    </section>
  );
}

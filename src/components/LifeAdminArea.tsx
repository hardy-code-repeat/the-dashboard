import { useMutation, useQuery } from "convex/react";
import { AnimatePresence, motion } from "framer-motion";
import {
  BadgeCheck,
  CalendarClock,
  Check,
  FileWarning,
  Loader2,
  Plus,
  RotateCcw,
  ShieldQuestion,
  Trash2,
  X,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { ConfirmAction } from "@/components/ConfirmAction";
import { Input } from "@/components/ui/input";
import { formatDay } from "@/lib/documents";
import { cn } from "@/lib/utils";

/**
 * Life Admin — the expiry → renewal chain (phase 3, feature 3).
 *
 * The whole surface is one list of things that expire, each showing a state
 * computed on the server. There is no second page system and no second list of
 * "things to do about documents": a renewal is an ordinary task that appears in
 * the user's main dashboard, and this surface's job is to explain what that
 * task is *for* and to let them set the date that closes the loop.
 *
 * Three things this deliberately does not do, because each would be a lie the
 * user only discovers later:
 *
 *  - it does not invent a lead time and present it as fact. The default is
 *    labelled as a default (R-006 — the real figures are country-specific and
 *    document-specific, and Virginia's DMV number is not the law everywhere);
 *  - it does not offer to store, upload or photograph the document. Panel keeps
 *    the date and nothing else (R-007, ADR-025);
 *  - it does not create a renewal task unless the user presses the button.
 *    Inventing work is how a system becomes a nag.
 */

/** The seven states, as the surface needs to say them. */
const STATE_LABEL: Record<string, string> = {
  undated: "No date",
  valid: "Valid",
  due: "Renew soon",
  renewing: "Renewing",
  "renewing-late": "Renewing · expired",
  expired: "Expired",
  stale: "Needs the new date",
};

/** Tailwind treatment per state. Kept flat, in the house style. */
const STATE_CLASS: Record<string, string> = {
  undated: "bg-muted text-muted-foreground",
  valid: "bg-muted text-muted-foreground",
  due: "bg-accent text-accent-foreground",
  renewing: "bg-secondary text-secondary-foreground",
  "renewing-late": "bg-secondary text-secondary-foreground",
  expired: "bg-destructive text-background",
  stale: "bg-destructive text-background",
};

/**
 * `YYYY-MM-DD` to the last instant of that day, in UTC.
 *
 * End-of-day because an expiry is the last day the document still works, and
 * UTC because a calendar day must not shift under the viewer — the same
 * convention `life:getFinance` uses for tax deadlines, and the reason
 * `formatDay` renders in UTC too.
 */
function endOfDay(date: string): number | null {
  const parsed = Date.parse(`${date}T23:59:59Z`);
  return Number.isFinite(parsed) ? parsed : null;
}

/** The inverse, for seeding the input from a stored timestamp. */
function toInputDate(at: number | null): string {
  if (at === null) return "";
  return new Date(at).toISOString().slice(0, 10);
}

export function LifeAdminArea() {
  const data = useQuery(api.documents.listDocuments);
  const people = useQuery(api.people.listPeople)?.people;

  const createDocument = useMutation(api.documents.createDocument);
  const deleteDocument = useMutation(api.documents.deleteDocument);
  const startRenewal = useMutation(api.documents.startRenewal);
  const cancelRenewal = useMutation(api.documents.cancelRenewal);
  const completeRenewal = useMutation(api.documents.completeRenewal);

  const [label, setLabel] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [leadDays, setLeadDays] = useState("");
  const [personId, setPersonId] = useState<Id<"people"> | "">("");
  const [busy, setBusy] = useState(false);

  // Which document is mid-renewal-completion, and what the user typed for it.
  const [closing, setClosing] = useState<Id<"documents"> | null>(null);
  const [newExpiry, setNewExpiry] = useState("");

  const docs = data?.documents ?? [];

  async function run<T>(key: string, fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(true);
    try {
      return await fn();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "That did not work");
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  const handleAdd = async (event: React.FormEvent) => {
    event.preventDefault();
    const name = label.trim();
    if (!name || busy) return;

    const at = expiresAt ? endOfDay(expiresAt) : null;
    if (expiresAt && at === null) {
      toast.error("That expiry date is not a real date");
      return;
    }

    const lead = leadDays.trim() === "" ? undefined : Number(leadDays);
    if (lead !== undefined && (!Number.isFinite(lead) || lead < 0 || lead > 365)) {
      toast.error("Lead time must be between 0 and 365 days");
      return;
    }

    const ok = await run("add", () =>
      createDocument({
        label: name,
        // `undefined`, not `null`: absent means "no expiry recorded", and the
        // mutation distinguishes it from a rejected value.
        expiresAt: at ?? undefined,
        leadDays: lead,
        personId: personId || undefined,
      }),
    );
    if (ok === undefined) return;

    setLabel("");
    setExpiresAt("");
    setLeadDays("");
  };

  const handleStart = (id: Id<"documents">) =>
    void run("start", async () => {
      const result = await startRenewal({ id });
      // Idempotent: a second press returns the task it already made.
      toast.success(result.created ? "Renewal added to your tasks" : "That renewal is already open");
    });

  const handleCancel = (id: Id<"documents">) =>
    void run("cancel", async () => {
      await cancelRenewal({ id });
      toast("Renewal removed");
    });

  const handleComplete = async (id: Id<"documents">) => {
    const at = endOfDay(newExpiry);
    if (at === null) {
      toast.error("Pick the date the new document runs out");
      return;
    }
    const ok = await run("complete", () => completeRenewal({ id, newExpiresAt: at }));
    if (ok === undefined) return;
    setClosing(null);
    setNewExpiry("");
    toast.success(`Renewed — now valid until ${formatDay(at)}`);
  };

  return (
    <div className="flex flex-col gap-6">
      {/* ---------- THE PROMISE, STATED HONESTLY ---------- */}
      <div className="brutal-flat bg-card p-5">
        <div className="mb-3 flex items-center gap-2">
          <CalendarClock className="size-4" />
          <h2 className="font-display text-sm uppercase tracking-wide">Life admin</h2>
        </div>
        <p className="text-sm leading-snug">
          The things that expire. Panel keeps the <strong>date</strong> and nothing else — not a
          scan, not a number, not a photo. It will tell you when to start renewing, and it will
          wait while you do.
        </p>
        <p className="mt-3 flex items-start gap-2 border-t-2 border-border pt-3 text-[11px] uppercase text-muted-foreground">
          <ShieldQuestion className="mt-0.5 size-3.5 shrink-0" />
          <span>
            Panel never renews anything for you. No bookings, no payments, no submissions — you
            do that part, and Panel tracks where you got to.
          </span>
        </p>
      </div>

      {/* ---------- ADD ---------- */}
      <form onSubmit={handleAdd} className="brutal-flat bg-card p-5">
        <div className="mb-4 flex items-center gap-2">
          <Plus className="size-4" />
          <h2 className="font-display text-sm uppercase tracking-wide">Something that expires</h2>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label
              htmlFor="doc-label"
              className="mb-1 block text-[10px] font-bold uppercase text-muted-foreground"
            >
              What is it
            </label>
            <Input
              id="doc-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Passport"
              maxLength={80}
              className="h-11 border-2 border-border bg-background focus-visible:ring-0"
            />
          </div>

          <div>
            <label
              htmlFor="doc-expiry"
              className="mb-1 block text-[10px] font-bold uppercase text-muted-foreground"
            >
              Expires on
            </label>
            <Input
              id="doc-expiry"
              type="date"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              className="h-11 border-2 border-border bg-background focus-visible:ring-0"
            />
          </div>

          <div>
            <label
              htmlFor="doc-lead"
              className="mb-1 block text-[10px] font-bold uppercase text-muted-foreground"
            >
              Warn me this many days early
            </label>
            <Input
              id="doc-lead"
              type="number"
              min={0}
              max={365}
              value={leadDays}
              onChange={(e) => setLeadDays(e.target.value)}
              placeholder={String(data?.defaultLeadDays ?? 30)}
              className="h-11 border-2 border-border bg-background focus-visible:ring-0"
            />
          </div>
        </div>

        {(people?.length ?? 0) > 0 && (
          <div className="mt-3">
            <label
              htmlFor="doc-person"
              className="mb-1 block text-[10px] font-bold uppercase text-muted-foreground"
            >
              Whose is it
            </label>
            <select
              id="doc-person"
              value={personId}
              onChange={(e) => setPersonId(e.target.value as Id<"people"> | "")}
              className="h-11 w-full border-2 border-border bg-background px-2 text-[11px] font-bold uppercase focus-visible:ring-0"
            >
              <option value="">Mine</option>
              {people?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button
            type="submit"
            disabled={!label.trim() || busy}
            className="brutal h-11 gap-2 bg-primary px-5 font-bold uppercase"
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            Track it
          </Button>
          <p className="text-[10px] uppercase text-muted-foreground">
            Leave the date empty and Panel will just hold the name until you know it.
          </p>
        </div>
      </form>

      {/* ---------- THE LIST ---------- */}
      {data === undefined ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          Loading…
        </div>
      ) : docs.length === 0 ? (
        <div className="brutal-flat bg-card px-6 py-12 text-center">
          <CalendarClock className="mx-auto mb-3 size-7 text-muted-foreground" />
          <p className="font-display text-base uppercase">Nothing tracked yet</p>
          <p className="mt-1 text-[11px] uppercase text-muted-foreground">
            Add the first one above — a passport, a licence, a policy
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {docs.map((doc) => {
            const isClosing = closing === doc.id;
            const showRenewButton =
              doc.state === "due" || doc.state === "expired" || doc.state === "stale";
            const showCancel = doc.renewal !== null && !doc.renewal.completed;

            return (
              <motion.li
                key={doc.id}
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.18 }}
                className={cn(
                  "brutal-flat bg-card p-4",
                  doc.state === "expired" && "border-destructive",
                  doc.state === "stale" && "border-destructive",
                )}
              >
                <div className="flex flex-wrap items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-bold uppercase break-words">{doc.label}</span>
                      <span
                        className={cn(
                          "border-2 border-border px-1.5 py-0.5 text-[9px] font-bold uppercase",
                          STATE_CLASS[doc.state] ?? STATE_CLASS.valid,
                        )}
                      >
                        {STATE_LABEL[doc.state] ?? doc.state}
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] leading-snug opacity-80">{doc.detail}</p>

                    <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] uppercase text-muted-foreground">
                      {doc.expiresAt !== null && (
                        <div className="flex gap-1">
                          <dt>Expires</dt>
                          <dd className="font-bold text-foreground">{formatDay(doc.expiresAt)}</dd>
                        </div>
                      )}
                      {doc.deadlineAt !== null && (
                        <div className="flex gap-1">
                          <dt>Renew by</dt>
                          <dd className="font-bold text-foreground">
                            {formatDay(doc.deadlineAt)}
                          </dd>
                        </div>
                      )}
                      <div className="flex gap-1">
                        <dt>Warn</dt>
                        <dd className="font-bold text-foreground">
                          {doc.leadDays}d{doc.leadDaysIsDefault ? " (default)" : ""}
                        </dd>
                      </div>
                    </dl>

                    {doc.renewal !== null && (
                      <p
                        className={cn(
                          "mt-2 flex items-center gap-1.5 border-2 border-border bg-background px-2 py-1 text-[10px] uppercase",
                          doc.renewal.completed ? "opacity-70" : "font-bold",
                        )}
                      >
                        {doc.renewal.completed ? (
                          <BadgeCheck className="size-3" />
                        ) : (
                          <RotateCcw className="size-3" />
                        )}
                        {doc.renewal.title}
                        {doc.renewal.completed
                          ? " · marked done"
                          : doc.renewal.dueAt !== null
                            ? ` · due ${formatDay(doc.renewal.dueAt)}`
                            : " · open"}
                      </p>
                    )}

                    {doc.state === "stale" && (
                      <p className="mt-2 flex items-start gap-1.5 border-2 border-destructive bg-background p-2 text-[10px] uppercase text-destructive">
                        <FileWarning className="mt-0.5 size-3 shrink-0" />
                        You marked this renewed, but the expiry date never moved. Tell Panel the new
                        one so it stops showing the old date.
                      </p>
                    )}

                    {isClosing && (
                      <div className="mt-3 border-2 border-border bg-background p-3">
                        <label
                          htmlFor={`new-expiry-${doc.id}`}
                          className="mb-1 block text-[10px] font-bold uppercase"
                        >
                          New expiry date
                        </label>
                        <div className="flex flex-wrap gap-2">
                          <Input
                            id={`new-expiry-${doc.id}`}
                            type="date"
                            value={newExpiry}
                            onChange={(e) => setNewExpiry(e.target.value)}
                            className="h-10 flex-1 border-2 border-border bg-background focus-visible:ring-0"
                          />
                          <Button
                            type="button"
                            disabled={busy}
                            onClick={() => void handleComplete(doc.id)}
                            className="brutal h-10 gap-2 bg-primary px-4 font-bold uppercase"
                          >
                            {busy ? (
                              <Loader2 className="size-4 animate-spin" />
                            ) : (
                              <Check className="size-4" />
                            )}
                            Save
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            onClick={() => {
                              setClosing(null);
                              setNewExpiry("");
                            }}
                            className="h-10 font-bold uppercase"
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="flex shrink-0 flex-col gap-2">
                    {showRenewButton && !isClosing && (
                      <Button
                        type="button"
                        disabled={busy}
                        onClick={() => void handleStart(doc.id)}
                        className="brutal h-9 gap-1.5 bg-accent px-3 text-[10px] font-bold uppercase text-accent-foreground"
                      >
                        <RotateCcw className="size-3.5" />
                        Start renewal
                      </Button>
                    )}
                    {doc.state === "stale" && !isClosing && (
                      <Button
                        type="button"
                        onClick={() => {
                          setClosing(doc.id);
                          setNewExpiry(toInputDate(doc.expiresAt));
                        }}
                        className="brutal h-9 gap-1.5 bg-primary px-3 text-[10px] font-bold uppercase text-foreground"
                      >
                        <Check className="size-3.5" />
                        Record new expiry
                      </Button>
                    )}
                    {showCancel && (
                      <ConfirmAction
                        label="Cancel renewal"
                        confirmLabel="Cancel it"
                        disabled={busy}
                        onConfirm={() => handleCancel(doc.id)}
                        className="inline-flex h-9 items-center gap-1.5 px-2 text-[10px] font-bold uppercase"
                      >
                        {({ onClick, "aria-label": ariaLabel }) => (
                          <Button
                            type="button"
                            variant="ghost"
                            disabled={busy}
                            onClick={onClick}
                            aria-label={ariaLabel}
                            className="h-9 px-2 text-[10px] font-bold uppercase"
                          >
                            <X className="size-3.5" />
                            Cancel renewal
                          </Button>
                        )}
                      </ConfirmAction>
                    )}
                    <ConfirmAction
                      label={`Stop tracking ${doc.label}`}
                      confirmLabel="Stop tracking"
                      onConfirm={() =>
                        run("delete", async () => {
                          const result = await deleteDocument({ id: doc.id });
                          // Report the side effect rather than letting the task
                          // vanish with the link that held it.
                          toast(
                            result.detached === 0
                              ? `${doc.label} removed`
                              : `${doc.label} removed · ${result.detached} renewal ${
                                  result.detached === 1 ? "task was" : "tasks were"
                                } kept, not deleted`,
                          );
                        })
                      }
                    >
                      {({ onClick, "aria-label": ariaLabel }) => (
                        <button
                          type="button"
                          aria-label={ariaLabel}
                          disabled={busy}
                          onClick={onClick}
                          className="brutal-press border-2 border-border p-1.5 hover:bg-primary"
                        >
                          <Trash2 className="size-4" />
                        </button>
                      )}
                    </ConfirmAction>
                  </div>
                </div>
              </motion.li>
            );
          })}
        </ul>
      )}

      <p className="text-[10px] uppercase text-muted-foreground">
        <AnimatePresence>Everything here belongs to you and is visible only to you.</AnimatePresence>
        Panel will not ask to see the document, and never stores one.
      </p>
    </div>
  );
}
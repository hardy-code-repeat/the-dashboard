/**
 * Importing a bank statement, from the Finance area.
 *
 * ## The flow this component exists to enforce
 *
 *   choose file → **prepareImport** → review → **explicit confirmation** →
 *   **applyImport** → result
 *
 * `prepareImport` and `applyImport` are separate mutations precisely so that a
 * person has to ask for the part that writes money. This component keeps that
 * separation visible rather than hiding it behind a "Continue" button: the
 * only control that calls `applyImport` is the one that says **Import these N
 * transactions** in those words, and it is disabled until the file has been
 * read and nothing is written before it is pressed.
 *
 * ## What the review screen must show
 *
 * Everything the parser found, including the parts that did not work. A preview
 * that shows only the good rows is the same as a green success state for a file
 * that was half-understood, so the rejected rows are listed with their reasons,
 * the uncertainties are stated in the parser's own words, and the reconciliation
 * result is shown as a comparison rather than as a verdict. A mismatch is
 * never dressed as a pass — it blocks the button until the person says the
 * statement is wrong anyway.
 *
 * ## Duplicates
 *
 * Two different things are called a duplicate and only one can be known here.
 * **Rows repeated inside the file** are visible in the preview, because the
 * parser already holds them. **Rows Panel already holds from an earlier
 * statement** are not: answering that before confirmation would mean a fourth
 * read whose only purpose is to pre-announce a number `applyImport` already
 * reports accurately as `skipped`. So the review screen says which of the two
 * it is showing, and the result reports the rest honestly.
 */

import { useMutation } from "convex/react";
import {
  AlertTriangle,
  Check,
  FileSpreadsheet,
  Loader2,
  ShieldAlert,
  Upload,
  X,
} from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LIMITS } from "@/lib/csv";
import { formatMinor, isCurrencyCode } from "@/lib/money";
import { formatDay } from "@/lib/subscriptions";
import { cn } from "@/lib/utils";

const CURRENCIES = ["GBP", "USD", "EUR", "INR", "CAD", "AUD", "JPY"] as const;

interface Candidate {
  row: number;
  externalId: string;
  postedAt: number;
  amountMinor: number;
  direction: "in" | "out";
  label: string;
}

interface Rejected {
  row: number;
  reason: string;
}

/** What the review screen renders. Built from the mutation result, stored as data. */
interface Review {
  /** Carried so the apply call can name the exact import the person reviewed. */
  importId: Id<"imports">;
  /** The hash of the bytes previewed, shown after so the audit is legible. */
  sha256: string;
  filename: string;
  accountLabel: string;
  currency: string;
  candidates: Candidate[];
  rejected: Rejected[];
  uncertainty: string[];
  computedTotalMinor: number;
  openingBalanceMinor: number | null;
  closingBalanceMinor: number | null;
  totalsMatch: boolean | null;
  truncated: boolean;
  periodStart: number | undefined;
  periodEnd: number | undefined;
  /** Rows repeated inside this file, counted once each. */
  duplicateRows: number;
}

interface Applied {
  importId: Id<"imports">;
  sha256: string;
  written: number;
  skipped: number;
  alreadyApplied: boolean;
  rejectedCount: number;
  warnings: string[];
}

type Phase = "idle" | "reading" | "review" | "applying" | "done";

export function CsvImportPanel({
  accounts,
  defaultCurrency,
}: {
  accounts: { id: Id<"accounts">; label: string }[];
  defaultCurrency: string;
}) {
  const prepareImport = useMutation(api.transactions.prepareImport);
  const applyImport = useMutation(api.transactions.applyImport);

  const [phase, setPhase] = useState<Phase>("idle");
  // Branded rather than plain `string`: a `<select>` value is a string, and the
  // mutations will not take one. Keeping the branded type here means the cast
  // never has to happen at the call site.
  const [accountId, setAccountId] = useState<Id<"accounts"> | "">("");
  const [currency, setCurrency] = useState(defaultCurrency);
  const [review, setReview] = useState<Review | null>(null);
  const [applied, setApplied] = useState<Applied | null>(null);
  const [refused, setRefused] = useState<string | null>(null);
  const [acknowledgeMismatch, setAcknowledgeMismatch] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  /** The file's bytes, kept for the apply call. Never persisted, never sent anywhere else. */
  const textRef = useRef<string>("");
  const inputRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setPhase("idle");
    setReview(null);
    setApplied(null);
    setRefused(null);
    setApplyError(null);
    setAcknowledgeMismatch(false);
    textRef.current = "";
    if (inputRef.current) inputRef.current.value = "";
  };

  const money = (amountMinor: number) =>
    isCurrencyCode(currency) ? formatMinor(amountMinor, currency) : String(amountMinor);

  const accountLabel =
    accounts.find((a) => a.id === accountId)?.label ?? "No account — transactions will be unassigned";

  /**
   * Reads the file and asks the backend what it made of it.
   *
   * This is the only step that touches the database, and it writes an audit
   * row and nothing else. The bytes are held in a ref so the apply call can
   * re-verify them against the sha256 the preview recorded — which is why the
   * same file is handed to both calls rather than being cached server-side.
   */
  const handleRead = async (file: File) => {
    setPhase("reading");
    setRefused(null);
    setApplyError(null);
    setAcknowledgeMismatch(false);

    // A courtesy check with a fast message. The backend enforces the same limit
    // and is the authority; this only spares a person a round trip to be told
    // their file is too big.
    if (file.size > LIMITS.maxBytes) {
      setPhase("idle");
      setRefused(
        `That file is ${Math.round(file.size / 1024)} KB. Panel reads statements up to ${Math.round(
          LIMITS.maxBytes / 1024,
        )} KB — split it, or export a shorter period.`,
      );
      return;
    }

    let text: string;
    try {
      text = await file.text();
    } catch {
      setPhase("idle");
      setRefused("That file could not be read as text.");
      return;
    }

    textRef.current = text;

    try {
      const result = await prepareImport({
        accountId: accountId || undefined,
        filename: file.name,
        text,
        currency: isCurrencyCode(currency) ? currency : "GBP",
      });

      if (!result.ok) {
        setPhase("idle");
        setRefused(result.reason);
        return;
      }

      // Rows repeated inside this one file. Counted here rather than asked of
      // the backend because the parser already holds every candidate.
      const seen = new Set<string>();
      let duplicateRows = 0;
      for (const candidate of result.candidates) {
        if (seen.has(candidate.externalId)) duplicateRows += 1;
        else seen.add(candidate.externalId);
      }

      setReview({
        importId: result.importId,
        sha256: result.sha256,
        filename: file.name,
        accountLabel,
        currency: result.currency,
        candidates: result.candidates,
        rejected: result.rejected,
        uncertainty: result.uncertainty,
        computedTotalMinor: result.computedTotalMinor,
        openingBalanceMinor: result.openingBalanceMinor,
        closingBalanceMinor: result.closingBalanceMinor,
        totalsMatch: result.totalsMatch,
        truncated: result.truncated,
        periodStart: result.periodStart,
        periodEnd: result.periodEnd,
        duplicateRows,
      });
      setPhase("review");
    } catch (error) {
      setPhase("idle");
      setRefused(error instanceof Error ? error.message : "That file could not be read.");
    }
  };

  /** The only caller of `applyImport`. Reached only by the explicit button. */
  const handleApply = async () => {
    if (!review) return;
    setPhase("applying");
    setApplyError(null);
    try {
      const result = await applyImport({
        importId: review.importId,
        text: textRef.current,
        currency: isCurrencyCode(review.currency) ? review.currency : "GBP",
        accountId: accountId || undefined,
        acknowledgeMismatch: acknowledgeMismatch || undefined,
      });
      setApplied({
        importId: review.importId,
        sha256: review.sha256,
        written: result.written,
        skipped: result.skipped,
        alreadyApplied: result.alreadyApplied,
        rejectedCount: review.rejected.length,
        warnings: review.uncertainty,
      });
      setPhase("done");
      toast.success(
        result.alreadyApplied
          ? "Already imported — nothing was written twice"
          : `${result.written} transaction${result.written === 1 ? "" : "s"} imported`,
      );
    } catch (error) {
      // A failure is a failure. No optimistic count, no success styling, and
      // the review stays on screen so the person can read the reason and retry.
      setPhase("review");
      setApplyError(error instanceof Error ? error.message : "The import did not complete.");
      toast.error("Nothing was imported");
    }
  };

  const blocksConfirmation =
    review !== null && review.totalsMatch === false && !acknowledgeMismatch;

  return (
    <section id="finance-import" className="brutal-flat bg-card p-5">
      <h2 className="font-display mb-1 text-sm uppercase tracking-wide">Import a statement</h2>
      <p className="mb-4 text-[10px] leading-relaxed uppercase text-muted-foreground">
        A CSV from your bank. Panel reads it, shows you exactly what it found and
        what it could not read, and writes nothing until you say so. A statement
        Panel has already seen is recognised row by row, so importing twice writes
        once.
      </p>

      {/* ---------- STEP 1: CHOOSE ---------- */}
      {(phase === "idle" || phase === "reading") && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-2 sm:flex-row">
            <select
              value={accountId}
              onChange={(e) => setAccountId(e.target.value as Id<"accounts"> | "")}
              aria-label="Which account this statement is for"
              className="h-11 border-2 border-border bg-background px-2 text-[11px] uppercase focus-visible:ring-0"
            >
              <option value="">No account</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              aria-label="What currency the statement is in"
              className="h-11 border-2 border-border bg-background px-2 text-[11px] uppercase focus-visible:ring-0"
            >
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          <Input
            ref={inputRef}
            type="file"
            accept=".csv,text/csv"
            disabled={phase === "reading"}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleRead(file);
            }}
            aria-label="Choose a CSV statement"
            className="h-11 w-full border-2 border-dashed border-border bg-background file:mr-3 file:border-0 file:bg-transparent file:text-[11px] file:font-bold file:uppercase focus-visible:ring-0"
          />

          {phase === "reading" && (
            <p className="flex items-center gap-2 text-[11px] uppercase text-muted-foreground">
              <Loader2 className="size-3 animate-spin" />
              Reading the statement. Nothing is written at this step.
            </p>
          )}

          {refused && (
            <div className="flex items-start gap-2 border-2 border-border bg-background p-3">
              <ShieldAlert className="mt-0.5 size-4 shrink-0" />
              <div className="min-w-0">
                <p className="text-[11px] font-bold uppercase">Nothing was imported</p>
                <p className="mt-1 text-[11px] leading-relaxed">{refused}</p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ---------- STEP 2: REVIEW — everything the parser found ---------- */}
      {(phase === "review" || phase === "applying") && review && (
        <div className="flex flex-col gap-4">
          <div className="border-2 border-border bg-background p-3">
            <p className="text-[11px] font-bold uppercase">What Panel found</p>
            <dl className="mt-2 grid gap-x-6 gap-y-1 text-[11px] sm:grid-cols-2">
              <Summary label="File" value={review.filename} />
              <Summary label="Into" value={review.accountLabel} />
              <Summary label="Currency" value={review.currency} />
              <Summary
                label="Period"
                value={
                  review.periodStart != null && review.periodEnd != null
                    ? `${formatDay(review.periodStart)} – ${formatDay(review.periodEnd)}`
                    : "Not enough readable dates"
                }
              />
              <Summary
                label="Rows to import"
                value={`${review.candidates.length} of ${review.candidates.length + review.rejected.length}`}
              />
              <Summary
                label="Will not be imported"
                value={
                  review.rejected.length === 0
                    ? "None"
                    : `${review.rejected.length} row${review.rejected.length === 1 ? "" : "s"}`
                }
              />
              <Summary
                label="Repeated in this file"
                value={
                  review.duplicateRows === 0
                    ? "None"
                    : `${review.duplicateRows} — only the first of each will be written`
                }
              />
              <Summary
                label="Rows already held"
                value="Cannot be known before applying — reported in the result"
              />
            </dl>
          </div>

          {/* Totals, as a comparison the person can check rather than a verdict. */}
          <div className="border-2 border-border bg-background p-3">
            <p className="text-[11px] font-bold uppercase">Totals</p>
            <dl className="mt-2 grid gap-x-6 gap-y-1 text-[11px] sm:grid-cols-2">
              <Summary label="These rows move" value={money(review.computedTotalMinor)} />
              <Summary
                label="The statement's balance moves"
                value={
                  review.openingBalanceMinor != null && review.closingBalanceMinor != null
                    ? money(review.closingBalanceMinor - review.openingBalanceMinor)
                    : "No balance column to compare against"
                }
              />
              <Summary
                label="Opening / closing"
                value={
                  review.openingBalanceMinor != null && review.closingBalanceMinor != null
                    ? `${money(review.openingBalanceMinor)} / ${money(review.closingBalanceMinor)}`
                    : "Not in this file"
                }
              />
              <Summary
                label="Reconciliation"
                value={
                  review.totalsMatch === true
                    ? "The rows agree with the statement's own balance"
                    : review.totalsMatch === false
                      ? "They do not agree"
                      : "Not checkable — no balance column"
                }
              />
            </dl>
          </div>

          {/* Uncertainty is never behind a success state. */}
          {review.uncertainty.length > 0 && (
            <div className="border-2 border-border bg-background p-3">
              <p className="flex items-center gap-2 text-[11px] font-bold uppercase">
                <AlertTriangle className="size-3.5" />
                Before you decide
              </p>
              <ul className="mt-2 flex list-disc flex-col gap-1 pl-4 text-[11px] leading-relaxed">
                {review.uncertainty.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          )}

          {review.rejected.length > 0 && (
            <div className="border-2 border-border bg-background p-3">
              <p className="text-[11px] font-bold uppercase">
                Rows that will not be imported
              </p>
              <ul className="mt-2 flex flex-col gap-1">
                {review.rejected.map((row) => (
                  <li key={row.row} className="text-[11px] leading-relaxed">
                    <span className="font-bold">Line {row.row}</span> — {row.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {review.candidates.length > 0 && (
            <details className="border-2 border-border bg-background">
              <summary className="cursor-pointer px-3 py-2 text-[11px] font-bold uppercase">
                See the {review.candidates.length} row{review.candidates.length === 1 ? "" : "s"} to import
              </summary>
              <ul className="max-h-64 overflow-y-auto border-t-2 border-border">
                {review.candidates.map((row) => (
                  <li
                    key={`${row.row}-${row.externalId}`}
                    className="flex items-baseline justify-between gap-3 border-b border-border px-3 py-1.5 text-[11px] last:border-b-0"
                  >
                    <span className="truncate">
                      <span className="text-muted-foreground">{formatDay(row.postedAt)}</span>{" "}
                      {row.label}
                    </span>
                    <span className="shrink-0 font-bold">
                      {row.direction === "out" ? "−" : "+"}
                      {money(row.amountMinor)}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}

          {review.totalsMatch === false && (
            <label className="flex items-start gap-2 border-2 border-border bg-background p-3 text-[11px] leading-relaxed">
              <input
                type="checkbox"
                checked={acknowledgeMismatch}
                onChange={(e) => setAcknowledgeMismatch(e.target.checked)}
                className="mt-0.5 size-4 shrink-0 accent-[hsl(var(--foreground))]"
              />
              <span>
                These rows disagree with the statement&apos;s own balance. I have
                checked the statement and want to import them anyway.
              </span>
            </label>
          )}

          {applyError && (
            <div className="flex items-start gap-2 border-2 border-border bg-background p-3">
              <ShieldAlert className="mt-0.5 size-4 shrink-0" />
              <div className="min-w-0">
                <p className="text-[11px] font-bold uppercase">The import did not complete</p>
                <p className="mt-1 text-[11px] leading-relaxed">{applyError}</p>
              </div>
            </div>
          )}

          {/* ---------- STEP 3: THE EXPLICIT ACTION ----------
              The label names the number and the consequence, because this is the
              only control in the flow that creates records. */}
          <div className="flex flex-col gap-2 border-t-2 border-border pt-4 sm:flex-row sm:items-center">
            <Button
              type="button"
              onClick={() => void handleApply()}
              disabled={phase === "applying" || blocksConfirmation || review.candidates.length === 0}
              className="brutal h-11 gap-2 bg-primary px-5 font-bold uppercase"
            >
              {phase === "applying" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Upload className="size-4" />
              )}
              {`Import these ${review.candidates.length} transaction${review.candidates.length === 1 ? "" : "s"}`}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={phase === "applying"}
              onClick={reset}
              className="h-11 gap-2 border-2 border-border px-5 font-bold uppercase"
            >
              <X className="size-4" />
              Cancel — write nothing
            </Button>
            <p className="text-[10px] leading-relaxed uppercase text-muted-foreground">
              Cancel writes nothing. The statement is remembered only as an
              attempt you did not apply.
            </p>
          </div>
        </div>
      )}

      {/* ---------- STEP 4: RESULT ---------- */}
      {phase === "done" && applied && (
        <div className="border-2 border-border bg-background p-4">
          <p className="flex items-center gap-2 text-[11px] font-bold uppercase">
            <Check className="size-4" />
            {applied.alreadyApplied
              ? "Already imported — nothing was written a second time"
              : `${applied.written} transaction${applied.written === 1 ? "" : "s"} imported`}
          </p>
          <dl className="mt-3 grid gap-x-6 gap-y-1 text-[11px] sm:grid-cols-2">
            <Summary label="Written" value={String(applied.written)} />
            <Summary
              label="Skipped as already held"
              value={`${applied.skipped} — same content, already imported`}
            />
            <Summary
              label="Not imported"
              value={`${applied.rejectedCount} row${applied.rejectedCount === 1 ? "" : "s"} could not be read`}
            />
            <Summary label="Audit reference" value={applied.importId} />
          </dl>
          {applied.warnings.length > 0 && (
            <ul className="mt-3 flex list-disc flex-col gap-1 border-t-2 border-border pl-4 pt-3 text-[11px] leading-relaxed">
              {applied.warnings.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}
          <p className="mt-3 break-all text-[10px] uppercase text-muted-foreground">
            sha-256 {applied.sha256}
          </p>
          <Button
            type="button"
            onClick={reset}
            className="brutal mt-4 h-11 gap-2 px-5 font-bold uppercase"
          >
            <FileSpreadsheet className="size-4" />
            Import another statement
          </Button>
        </div>
      )}
    </section>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 justify-between gap-3 sm:justify-start">
      <dt className="shrink-0 uppercase text-muted-foreground">{label}</dt>
      <dd className={cn("min-w-0 truncate text-right font-bold")}>{value}</dd>
    </div>
  );
}
/**
 * The import history: every statement Panel has been offered, and what happened.
 *
 * ## Why this surface exists
 *
 * `transactions.listImports` has been written on every attempt since the import
 * pipeline shipped — applied, abandoned and refused alike — and **nothing
 * rendered it**. That produced two real gaps:
 *
 * 1. The result screen shows an audit reference that leads nowhere. A user told
 *    "Audit reference: kq7…" had no way to look it up.
 * 2. A **failed or cancelled import was invisible**. The row was written, the
 *    person forgot they had tried, and a month later they re-uploaded the same
 *    statement wondering why nothing appeared. "I uploaded it and nothing
 *    happened" is the state a user cannot explain to themselves.
 *
 * So this is not a nicety: it is the surface that makes the audit trail mean
 * anything, and it is read-only.
 *
 * ## What it deliberately does not show
 *
 * No statement rows. The `imports` table stores aggregates only — a row count,
 * a total, a period and the words of anything uncertain — and this renders
 * exactly those. The transactions themselves live in the transactions list, and
 * a statement's own text is never stored here to be displayed.
 *
 * ## Failure is shown as failure
 *
 * A refused file is listed with the reason the backend gave, in its own words.
 * It is not hidden because it failed, and it is not styled as a success with a
 * footnote, because "Panel wrote down that your file was unreadable" and
 * "Panel imported your file" must never look alike.
 */

import { useQuery } from "convex/react";
import { AlertTriangle, Check, ChevronDown, Loader2, Undo2 } from "lucide-react";
import { useState } from "react";

import { api } from "@/convex/_generated/api";
import { formatMinor, isCurrencyCode } from "@/lib/money";
import { formatDay } from "@/lib/subscriptions";

type ImportStatus = "uploaded" | "extracted" | "confirmed" | "applied" | "failed" | "discarded";

// The row shape is deliberately **not** redeclared here. Convex generates it
// from the schema, so a hand-written copy would be a second definition that
// drifts the moment a column is added — and the drift would be silent.

/**
 * How a status reads to a person.
 *
 * `extracted` is the interesting one: it means Panel read the file and the
 * person then **cancelled**. Calling that "pending" would suggest work still in
 * flight; calling it nothing would hide a real attempt.
 */
function describe(status: ImportStatus, appliedAt?: number): { label: string; tone: string } {
  switch (status) {
    case "applied":
      return { label: "Imported", tone: "bg-primary text-primary-foreground" };
    case "failed":
      return { label: "Not read", tone: "bg-destructive text-destructive-foreground" };
    case "extracted":
    case "confirmed":
      return { label: appliedAt ? "Imported" : "Cancelled — wrote nothing", tone: "bg-secondary text-secondary-foreground" };
    case "discarded":
      return { label: "Discarded", tone: "bg-secondary text-secondary-foreground" };
    default:
      return { label: status, tone: "bg-secondary text-secondary-foreground" };
  }
}

export function ImportHistory() {
  const imports = useQuery(api.transactions.listImports);
  const [open, setOpen] = useState<Record<string, boolean>>({});

  if (imports === undefined) {
    return (
      <section id="finance-import-history" className="brutal-flat bg-card p-5">
        <h2 className="font-display mb-3 text-sm uppercase tracking-wide">Import history</h2>
        <p className="flex items-center gap-2 border-2 border-dashed border-border px-3 py-4 text-center text-[11px] uppercase text-muted-foreground">
          <Loader2 className="mx-auto size-3 animate-spin" />
          Reading your import record…
        </p>
      </section>
    );
  }

  if (imports.length === 0) {
    return (
      <section id="finance-import-history" className="brutal-flat bg-card p-5">
        <h2 className="font-display mb-1 text-sm uppercase tracking-wide">Import history</h2>
        <p className="border-2 border-dashed border-border px-3 py-4 text-[11px] uppercase text-muted-foreground">
          No statement has been offered yet. Anything you try is recorded here,
          whether it imports or not.
        </p>
      </section>
    );
  }

  const applied = imports.filter((i) => i.status === "applied").length;

  return (
    <section id="finance-import-history" className="brutal-flat bg-card p-5">
      <h2 className="font-display mb-1 text-sm uppercase tracking-wide">Import history</h2>
      <p className="mb-4 text-[10px] leading-relaxed uppercase text-muted-foreground">
        Every statement you have offered, newest first — including the ones you
        cancelled and the ones Panel could not read. {applied} of {imports.length}{" "}
        imported.
      </p>

      <ul className="flex flex-col gap-2">
        {imports.map((row) => {
          const { label, tone } = describe(row.status, row.appliedAt);
          const isOpen = open[row._id] ?? false;
          const total = row.detected?.totals?.[0];
          return (
            <li key={row._id} className="border-2 border-border bg-background">
              <div className="flex flex-wrap items-center gap-2 px-3 py-2">
                <span
                  className={`shrink-0 border-2 border-border px-1.5 py-0.5 text-[9px] font-bold uppercase ${tone}`}
                >
                  {label}
                </span>
                <span className="min-w-0 flex-1 truncate text-[11px]">{row.filename}</span>
                <span className="shrink-0 text-[10px] uppercase text-muted-foreground">
                  {formatDay(row.createdAt)}
                </span>
                <button
                  type="button"
                  aria-expanded={isOpen}
                  aria-label={`Show detail for ${row.filename}`}
                  onClick={() => setOpen((prev) => ({ ...prev, [row._id]: !isOpen }))}
                  className="shrink-0 border-2 border-border p-1 hover:bg-accent"
                >
                  <ChevronDown className={`size-3 transition-transform ${isOpen ? "rotate-180" : ""}`} />
                </button>
              </div>

              {isOpen && (
                <div className="border-t-2 border-border px-3 py-2 text-[10px] uppercase leading-relaxed text-muted-foreground">
                  {row.detected && (
                    <p>
                      {row.detected.rowCount} row{row.detected.rowCount === 1 ? "" : "s"}
                      {total
                        ? ` · ${isCurrencyCode(total.currency) ? formatMinor(total.amountMinor, total.currency) : `${total.amountMinor} ${total.currency}`}`
                        : ""}
                      {row.detected.periodStart != null && row.detected.periodEnd != null
                        ? ` · ${formatDay(row.detected.periodStart)} – ${formatDay(row.detected.periodEnd)}`
                        : ""}
                    </p>
                  )}
                  {row.appliedAt != null && <p>Applied {formatDay(row.appliedAt)}</p>}
                  <p className="mt-1 flex items-center gap-1">
                    {row.status === "applied" ? <Check className="size-3" /> : row.status === "failed" ? <AlertTriangle className="size-3" /> : <Undo2 className="size-3" />}
                    Reference {row._id}
                  </p>
                  <p className="mt-1 break-all">sha-256 {row.sha256}</p>

                  {row.reason && (
                    <p className="mt-2 border-l-2 border-border pl-2 text-foreground">{row.reason}</p>
                  )}
                  {row.uncertainty && row.uncertainty.length > 0 && (
                    <ul className="mt-2 list-disc pl-4">
                      {row.uncertainty.map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
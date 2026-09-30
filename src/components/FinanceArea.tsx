import { useMutation, useQuery } from "convex/react";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  Check,
  FileText,
  Info,
  Landmark,
  Plus,
  Scale,
  Trash2,
  TrendingDown,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * The Finance area.
 *
 * Everything here is an *estimate* and a *checklist*. Panel deliberately does
 * not file returns or present itself as an accountant — the disclaimer is
 * rendered in the UI, not buried in a footer.
 */
export function FinanceArea() {
  const finance = useQuery(api.life.getFinance);
  const saveProfile = useMutation(api.life.saveTaxProfile);
  const addExpense = useMutation(api.life.addExpense);
  const removeExpense = useMutation(api.life.removeExpense);
  const setDeductible = useMutation(api.life.setExpenseDeductible);
  const toggleDoc = useMutation(api.life.toggleDocument);

  const [income, setIncome] = useState<string | null>(null);
  const [expenseLabel, setExpenseLabel] = useState("");
  const [expenseAmount, setExpenseAmount] = useState("");
  const [busy, setBusy] = useState(false);

  if (finance === undefined) {
    return <div className="brutal-flat bg-card p-8 text-center text-xs uppercase text-muted-foreground">Loading finance…</div>;
  }
  if (finance === null) return null;

  const { country, taxYearLabel, profile, estimate, readiness, deadlines, documents, expenses, buckets } = finance;

  const handleCountry = async (code: string) => {
    try {
      await saveProfile({ country: code, grossIncome: profile.grossIncome });
      toast.success(`Switched to ${code}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not switch country");
    }
  };

  const handleSaveIncome = async () => {
    const value = Number(income);
    if (!Number.isFinite(value) || value < 0) {
      toast.error("Enter a valid amount");
      return;
    }
    setBusy(true);
    try {
      await saveProfile({ country: country.code, grossIncome: value });
      setIncome(null);
      toast.success("Income saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  };

  const handleAddExpense = async (event: React.FormEvent) => {
    event.preventDefault();
    const amount = Number(expenseAmount);
    if (!expenseLabel.trim() || !Number.isFinite(amount) || amount <= 0) {
      toast.error("Add a description and an amount");
      return;
    }
    setBusy(true);
    try {
      const guess = await addExpense({ label: expenseLabel.trim(), amount });
      setExpenseLabel("");
      setExpenseAmount("");
      if (guess.likelyDeductible && guess.confidence === "low") {
        toast.info(`Filed under ${guess.bucket} — check it before claiming.`);
      } else {
        toast.success(`Added to ${guess.bucket}`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not add expense");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {/* ---------- DISCLAIMER (first, not last) ---------- */}
      <div className="brutal-flat flex items-start gap-3 border-dashed bg-muted p-4">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" />
        <p className="text-[11px] leading-relaxed uppercase">
          <span className="font-bold">Estimates only — not tax advice.</span> Panel
          organises your paperwork and runs published rules from{" "}
          {country.authority}. It cannot file your return or judge your circumstances.
          Have a qualified professional review before you file.
        </p>
      </div>

      {/* ---------- COUNTRY + YEAR ---------- */}
      <section className="brutal-flat bg-card p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Landmark className="size-4" />
            <h2 className="font-display text-sm uppercase tracking-wide">
              {taxYearLabel} · {country.name}
            </h2>
          </div>
          <span className="text-[10px] uppercase text-muted-foreground">
            Figures from {country.authority}
          </span>
        </div>

        <div className="flex flex-wrap gap-2">
          {finance.countries.map((c) => (
            <button
              key={c.code}
              type="button"
              onClick={() => handleCountry(c.code)}
              aria-pressed={country.code === c.code}
              className={cn(
                "brutal-flat px-3 py-2 text-[11px] font-bold uppercase transition-colors",
                country.code === c.code ? "bg-foreground text-background" : "bg-background hover:bg-muted",
              )}
            >
              {c.code}
            </button>
          ))}
        </div>

        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <Input
            type="number"
            min={0}
            value={income ?? String(profile.grossIncome || "")}
            onChange={(e) => setIncome(e.target.value)}
            placeholder="Total income this year"
            aria-label="Total income"
            className="h-11 border-2 border-border bg-background focus-visible:ring-0"
          />
          <Button
            type="button"
            onClick={handleSaveIncome}
            disabled={busy}
            className="brutal h-11 bg-primary px-5 font-bold uppercase"
          >
            Save income
          </Button>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* ---------- DEADLINES ---------- */}
        <section className="brutal-flat bg-card p-5">
          <h2 className="font-display mb-4 text-sm uppercase tracking-wide">Deadlines</h2>
          <ul className="flex flex-col gap-2.5">
            {deadlines.map((d) => (
              <li
                key={d.id}
                className={cn(
                  "border-2 border-border p-3",
                  d.state === "urgent" && "bg-secondary text-secondary-foreground",
                  d.state === "passed" && "bg-muted text-muted-foreground",
                )}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-xs font-bold uppercase">{d.label}</p>
                  {d.date && (
                    <span className="shrink-0 text-[10px] font-bold uppercase">
                      {d.state === "passed"
                        ? "passed"
                        : d.daysAway === 0
                          ? "today"
                          : `in ${d.daysAway}d`}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-[11px] leading-relaxed opacity-80">{d.note}</p>
                {d.penalty && (
                  <p className="mt-1 text-[10px] font-bold uppercase opacity-70">⚠ {d.penalty}</p>
                )}
                <a
                  href={country.authorityUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1.5 inline-block text-[9px] uppercase underline underline-offset-2 opacity-60"
                >
                  {d.source}
                </a>
              </li>
            ))}
          </ul>
        </section>

        {/* ---------- READINESS ---------- */}
        <section className="brutal-flat bg-card p-5">
          <h2 className="font-display mb-1 text-sm uppercase tracking-wide">Filing readiness</h2>
          <p className="mb-4 text-[11px] text-muted-foreground">
            What {country.authority} says you need to hand over.
          </p>

          <div className="mb-4 flex items-end gap-3">
            <span className="font-display text-5xl leading-none">{readiness.score}</span>
            <span className="pb-1 text-[11px] uppercase text-muted-foreground">/ 100</span>
          </div>
          <div className="mb-5 h-4 w-full border-2 border-border bg-background">
            <div
              className="h-full bg-primary transition-all duration-500"
              style={{ width: `${readiness.score}%` }}
            />
          </div>

          {readiness.missingRequired.length > 0 && (
            <div className="mb-4 border-2 border-destructive bg-background p-3">
              <p className="mb-2 text-[10px] font-bold uppercase text-destructive">
                Still missing ({readiness.missingRequired.length})
              </p>
              <ul className="flex flex-col gap-1">
                {readiness.missingRequired.map((d) => (
                  <li key={d.id} className="text-[11px] leading-snug">
                    <span className="font-bold uppercase">{d.label}</span>
                    <span className="block opacity-70">{d.detail}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <details className="mt-4">
            <summary className="cursor-pointer text-[11px] font-bold uppercase">
              Full checklist ({documents.filter((d) => d.gathered).length}/{documents.length})
            </summary>
            <ul className="mt-3 flex flex-col gap-1.5">
              {documents.map((d) => (
                <li key={d.id}>
                  <button
                    type="button"
                    onClick={() => void toggleDoc({ requirementId: d.id, gathered: !d.gathered })}
                    className="flex w-full items-start gap-2 border-2 border-border bg-background p-2 text-left hover:bg-muted"
                  >
                    <span
                      className={cn(
                        "mt-0.5 flex size-4 shrink-0 items-center justify-center border-2 border-border",
                        d.gathered && "bg-foreground",
                      )}
                    >
                      {d.gathered && <Check className="size-3 text-background" strokeWidth={4} />}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[11px] font-bold uppercase">{d.label}</span>
                      <span className="block text-[10px] opacity-70">{d.detail}</span>
                      {d.conditional && (
                        <span className="mt-0.5 block text-[9px] uppercase opacity-50">
                          May be needed
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </details>
        </section>
      </div>

      {/* ---------- EXPENSES ---------- */}
      <section className="brutal-flat bg-card p-5">
        <h2 className="font-display mb-4 text-sm uppercase tracking-wide">Expenses</h2>

        <form onSubmit={handleAddExpense} className="mb-5 flex flex-col gap-2 sm:flex-row">
          <Input
            value={expenseLabel}
            onChange={(e) => setExpenseLabel(e.target.value)}
            placeholder="Adobe Creative Cloud"
            maxLength={120}
            aria-label="Expense description"
            className="h-11 flex-1 border-2 border-border bg-background focus-visible:ring-0"
          />
          <Input
            type="number"
            min={0}
            step="0.01"
            value={expenseAmount}
            onChange={(e) => setExpenseAmount(e.target.value)}
            placeholder="0.00"
            aria-label="Expense amount"
            className="h-11 w-28 border-2 border-border bg-background focus-visible:ring-0"
          />
          <Button
            type="submit"
            disabled={busy}
            className="brutal h-11 gap-2 bg-primary px-5 font-bold uppercase"
          >
            <Plus className="size-4" />
            Add
          </Button>
        </form>

        <p className="mb-4 flex items-start gap-2 border-2 border-dashed border-border bg-background p-2.5 text-[10px] leading-relaxed uppercase text-muted-foreground">
          <Info className="mt-px size-3 shrink-0" />
          Categories are guessed by keyword. Anything marked low confidence needs
          your own judgement.
        </p>

        {expenses.length === 0 ? (
          <p className="border-2 border-dashed border-border px-3 py-6 text-center text-[11px] uppercase text-muted-foreground">
            No expenses logged for {taxYearLabel}
          </p>
        ) : (
          <>
            <ul className="mb-4 flex flex-col gap-2">
              {expenses.map((e) => (
                <motion.li
                  key={e._id}
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.18 }}
                  className="flex items-center gap-3 border-2 border-border bg-background p-2.5"
                >
                  <button
                    type="button"
                    onClick={() => void setDeductible({ id: e._id, deductible: !e.deductible })}
                    aria-label={e.deductible ? "Mark as not deductible" : "Mark as deductible"}
                    aria-pressed={e.deductible}
                    className={cn(
                      "brutal-press flex size-6 shrink-0 items-center justify-center border-2 border-border",
                      e.deductible ? "bg-foreground" : "bg-card",
                    )}
                  >
                    {e.deductible && <Check className="size-4 text-background" strokeWidth={4} />}
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className={cn("truncate text-xs", !e.deductible && "text-muted-foreground line-through")}>
                      {e.label}
                    </p>
                    <p className="mt-0.5 text-[9px] uppercase text-muted-foreground">
                      {e.bucket}
                      {e.confidence === "low" && " · low confidence"}
                      {e.confidence === "confirmed" && " · confirmed"}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs font-bold">
                    {country.currencySymbol}
                    {e.amount.toFixed(2)}
                  </span>
                  <button
                    type="button"
                    onClick={() => void removeExpense({ id: e._id })}
                    aria-label={`Delete ${e.label}`}
                    className="brutal-press shrink-0 border-2 border-border p-1 hover:bg-primary"
                  >
                    <Trash2 className="size-3" />
                  </button>
                </motion.li>
              ))}
            </ul>

            {buckets.length > 0 && (
              <div className="mb-4">
                <p className="mb-2 text-[10px] font-bold uppercase text-muted-foreground">
                  By category
                </p>
                <ul className="flex flex-col gap-1.5">
                  {buckets.map((b) => {
                    const max = buckets[0].amount || 1;
                    return (
                      <li key={b.bucket} className="flex items-center gap-2">
                        <span className="w-32 shrink-0 truncate text-[10px] uppercase">{b.bucket}</span>
                        <span className="h-4 flex-1 border-2 border-border bg-background">
                          <span
                            className="block h-full bg-primary"
                            style={{ width: `${(b.amount / max) * 100}%` }}
                          />
                        </span>
                        <span className="w-20 shrink-0 text-right text-[10px] font-bold">
                          {country.currencySymbol}
                          {b.amount.toFixed(0)}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </>
        )}
      </section>

      {/* ---------- ESTIMATE ---------- */}
      <section className="brutal bg-foreground p-5 text-background">
        <div className="mb-4 flex items-center gap-2">
          <Scale className="size-4" />
          <h2 className="font-display text-sm uppercase tracking-wide">Rough estimate</h2>
        </div>

        <div className="mb-5 grid gap-4 sm:grid-cols-3">
          <div>
            <p className="text-[10px] uppercase opacity-60">Deductible total</p>
            <p className="font-display mt-1 text-3xl leading-none">
              {country.currencySymbol}
              {estimate.totalDeductible.toFixed(0)}
            </p>
          </div>
          <div>
            <p className="text-[10px] uppercase opacity-60">Estimated profit</p>
            <p className="font-display mt-1 text-3xl leading-none">
              {country.currencySymbol}
              {estimate.estimatedNet.toFixed(0)}
            </p>
          </div>
          <div>
            <p className="text-[10px] uppercase opacity-60">Tax (estimate)</p>
            <p className="font-display mt-1 flex items-center gap-1 text-3xl leading-none">
              <TrendingDown className="size-5" />
              {country.currencySymbol}
              {estimate.estimatedTax.toFixed(0)}
            </p>
          </div>
        </div>

        {estimate.lines.length > 0 && (
          <ul className="mb-5 flex flex-col gap-2 border-t-2 border-background/30 pt-4">
            {estimate.lines.map((l, i) => (
              <li key={i} className="text-[11px]">
                <div className="flex justify-between gap-3">
                  <span className="font-bold uppercase">{l.label}</span>
                  <span className="shrink-0 font-bold">
                    {country.currencySymbol}
                    {l.amount.toFixed(2)}
                  </span>
                </div>
                <p className="text-[10px] opacity-70">
                  {l.rule} · {l.source}
                </p>
                {l.note && <p className="text-[10px] opacity-60">{l.note}</p>}
              </li>
            ))}
          </ul>
        )}

        <ul className="flex flex-col gap-1.5 border-t-2 border-background/30 pt-4">
          {estimate.warnings.map((w, i) => (
            <li key={i} className="flex items-start gap-1.5 text-[10px] leading-relaxed uppercase opacity-75">
              <FileText className="mt-px size-3 shrink-0" />
              {w}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
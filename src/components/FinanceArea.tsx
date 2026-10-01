import { useMutation, useQuery } from "convex/react";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  Check,
  CreditCard,
  FileText,
  Info,
  Landmark,
  Sparkles,
  Plus,
  Repeat,
  Scale,
  Trash2,
  TrendingDown,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatAmount, isValidAmount } from "@/lib/subscriptions";
import { cn } from "@/lib/utils";

/** A date input holds "YYYY-MM-DD"; the machine holds epoch ms. */
function toDateInput(ms: number | null | undefined): string {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return "";
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** End of the chosen local day, so a date the user typed is the day they meant. */
function endOfLocalDay(value: string): number | null {
  if (!value) return null;
  const t = new Date(`${value}T23:59:59`).getTime();
  return Number.isFinite(t) ? t : null;
}

/**
 * A `<select>` gives back a string and a mutation wants a typed id.
 *
 * Cast once, here, rather than at six call sites — and rather than keying list
 * rows on their label, which is how the first pass of this panel ended up able
 * to cancel the wrong subscription. The id travels with the row instead.
 */
const asAccountId = (v: string): Id<"accounts"> | undefined =>
  v ? (v as Id<"accounts">) : undefined;
const asSubscriptionId = (v: string): Id<"subscriptions"> => v as Id<"subscriptions">;

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

  const subs = useQuery(api.subscriptions.listSubscriptions);
  const accounts = useQuery(api.subscriptions.listAccounts);
  const createAccount = useMutation(api.subscriptions.createAccount);
  const deleteAccount = useMutation(api.subscriptions.deleteAccount);
  const createSubscription = useMutation(api.subscriptions.createSubscription);
  const cancelSubscription = useMutation(api.subscriptions.cancelSubscription);
  const reactivateSubscription = useMutation(api.subscriptions.reactivateSubscription);
  const deleteSubscription = useMutation(api.subscriptions.deleteSubscription);
  const updateSubscription = useMutation(api.subscriptions.updateSubscription);

  // Phase 3, feature 6. Proposals never execute — they are things to read and
  // a decision the user makes. `accept` here means "I have looked at this",
  // and deliberately changes nothing about any expense: confirming a category
  // is an act the user performs in the Expenses list, where they can see what
  // they are confirming.
  const proposals = useQuery(api.agents.listProposals);
  const agentStatus = useQuery(api.agents.getAgentStatus);
  const lastRun = useQuery(api.agents.getLastRun);
  const enableAgents = useMutation(api.agents.enableAgents);
  const disableAgents = useMutation(api.agents.disableAgents);
  const runAgentsNow = useMutation(api.agents.runMyAgentsNow);
  const acceptProposal = useMutation(api.agents.acceptProposal);
  const dismissProposal = useMutation(api.agents.dismissProposal);
  const [agentsBusy, setAgentsBusy] = useState(false);

  const [income, setIncome] = useState<string | null>(null);
  const [expenseLabel, setExpenseLabel] = useState("");
  const [expenseAmount, setExpenseAmount] = useState("");
  const [busy, setBusy] = useState(false);

  const [subLabel, setSubLabel] = useState("");
  const [subAmount, setSubAmount] = useState("");
  const [subInterval, setSubInterval] = useState("monthly");
  const [subAccount, setSubAccount] = useState("");
  const [subRenews, setSubRenews] = useState("");
  const [accountLabel, setAccountLabel] = useState("");
  const [accountKind, setAccountKind] = useState("checking");

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
    if (!expenseLabel.trim() || !isValidAmount(amount)) {
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

  // ---- subscriptions (phase 3, feature 5) -------------------------------
  //
  // The amount is checked client-side with the *same* guard the server uses.
  // That is not redundancy for its own sake: it turns a network round-trip
  // into a typed field error, and it means the UI and the server can never
  // disagree about what a valid amount is.
  const handleAddSubscription = async (event: React.FormEvent) => {
    event.preventDefault();
    const amount = Number(subAmount);
    if (!subLabel.trim() || !isValidAmount(amount)) {
      toast.error("Add a name and a positive amount");
      return;
    }
    setBusy(true);
    try {
      await createSubscription({
        label: subLabel.trim(),
        amount,
        interval: subInterval,
        accountId: asAccountId(subAccount),
        renewsAt: endOfLocalDay(subRenews) ?? undefined,
      });
      setSubLabel("");
      setSubAmount("");
      setSubRenews("");
      toast.success("Subscription tracked");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not add subscription");
    } finally {
      setBusy(false);
    }
  };

  const handleAddAccount = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!accountLabel.trim()) {
      toast.error("Give the account a name");
      return;
    }
    setBusy(true);
    try {
      await createAccount({ label: accountLabel.trim(), kind: accountKind });
      setAccountLabel("");
      toast.success("Account added");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not add account");
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteAccount = async (id: Id<"accounts">) => {
    try {
      const res = await deleteAccount({ id });
      const n = res.detached;
      toast.success(
        n === 0
          ? "Account removed"
          : `Account removed — ${n} subscription${n === 1 ? "" : "s"} ungrouped`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not remove account");
    }
  };

  const handleEditRenewal = async (id: Id<"subscriptions">, value: string) => {
    try {
      await updateSubscription({ id, renewsAt: endOfLocalDay(value) ?? undefined });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not set the renewal date");
    }
  };

  const handleToggleAgents = async () => {
    setAgentsBusy(true);
    try {
      if (agentStatus?.enrolled) {
        await disableAgents({});
        toast.success("Scheduled review off");
      } else {
        await enableAgents({});
        toast.success("Scheduled review on — it runs once a day");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not change that");
    } finally {
      setAgentsBusy(false);
    }
  };

  const handleRunNow = async () => {
    setAgentsBusy(true);
    try {
      await runAgentsNow({});
      toast.success("Checked");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not run the review");
    } finally {
      setAgentsBusy(false);
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

      {/* ---------- PROPOSALS (phase 3, feature 6) ---------- */}
      <section className="brutal-flat bg-card p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-sm uppercase tracking-wide">
            Things to check
          </h2>
          {agentStatus?.enabledByFlag ? (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                disabled={agentsBusy}
                onClick={() => void handleRunNow()}
                className="brutal h-8 gap-1 px-2 text-[10px] uppercase"
              >
                <Sparkles className="size-3" />
                Check now
              </Button>
              <Button
                variant={agentStatus.enrolled ? "ghost" : "default"}
                disabled={agentsBusy}
                onClick={() => void handleToggleAgents()}
                className="brutal h-8 px-2 text-[10px] uppercase"
              >
                {agentStatus.enrolled ? "Daily review on" : "Daily review off"}
              </Button>
            </div>
          ) : null}
        </div>

        <p className="mb-4 flex items-start gap-2 border-2 border-dashed border-border bg-background p-2.5 text-[10px] leading-relaxed uppercase text-muted-foreground">
          <Info className="mt-px size-3 shrink-0" />
          Panel can notice something and add it to this list. It cannot act on
          your money — every suggestion waits for you, and confirming a category
          happens where you can see it.
        </p>

        {agentStatus?.enabledByFlag === false && (
          <p className="border-2 border-dashed border-border px-3 py-4 text-center text-[10px] uppercase text-muted-foreground">
            Scheduled review is switched off for this account
          </p>
        )}

        {proposals && proposals.filter((p) => p.status === "open").length > 0 && (
          <ul className="flex flex-col gap-2">
            {proposals
              .filter((p) => p.status === "open")
              .map((p) => (
                <li
                  key={p.id}
                  className="border-2 border-border bg-background px-3 py-3"
                >
                  <p className="flex items-start gap-2 text-[12px] font-bold uppercase">
                    <Sparkles className="mt-px size-3 shrink-0 text-muted-foreground" />
                    {p.title}
                  </p>
                  <p className="mt-1 text-[11px] leading-relaxed">{p.detail}</p>
                  {p.evidence.length > 0 && (
                    <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1">
                      {p.evidence.map((e) => (
                        <div key={e.label} className="text-[10px] uppercase">
                          <dt className="text-muted-foreground">{e.label}</dt>
                          <dd className="font-display text-[12px]">{e.value}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                  <div className="mt-3 flex gap-2">
                    <Button
                      disabled={agentsBusy}
                      onClick={() => void acceptProposal({ id: p.id })}
                      className="brutal h-8 gap-1 bg-primary px-3 text-[10px] font-bold uppercase"
                    >
                      <Check className="size-3" />
                      I have looked
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={agentsBusy}
                      onClick={() => void dismissProposal({ id: p.id })}
                      className="brutal h-8 px-3 text-[10px] uppercase"
                    >
                      Dismiss
                    </Button>
                  </div>
                </li>
              ))}
          </ul>
        )}

        {proposals &&
          proposals.filter((p) => p.status === "open").length === 0 &&
          agentStatus?.enabledByFlag && (
            <p className="border-2 border-dashed border-border px-3 py-6 text-center text-[11px] uppercase text-muted-foreground">
              Nothing waiting on you
            </p>
          )}

        {/* The last check, in the open. A process that looks at your money
            without you asking has to be able to say when it last looked, what
            it found, and — when a limit stopped it — how much it held back. */}
        {lastRun && agentStatus?.enabledByFlag && (
          <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t-2 border-dashed border-border pt-2.5 text-[10px] uppercase text-muted-foreground">
            <span>
              Last check:{" "}
              {lastRun.result === "failed"
                ? "could not finish"
                : lastRun.at
                  ? new Date(lastRun.at).toLocaleString()
                  : "not yet"}
            </span>
            {lastRun.result === "failed" && lastRun.error && (
              <span className="font-bold text-foreground">{lastRun.error}</span>
            )}
            {lastRun.result === "capped" && (
              <span className="font-bold text-foreground">
                {lastRun.overflow} held back by today&apos;s limit
              </span>
            )}
            {lastRun.result === "skipped" && <span>Nothing to review</span>}
            <span>
              {lastRun.usedToday}/{lastRun.maxPerDay} checks used today
            </span>
          </p>
        )}
      </section>

      {/* ---------- SUBSCRIPTIONS (phase 3, feature 5) ---------- */}
      <section className="brutal-flat bg-card p-5">
        <h2 className="font-display mb-1 text-sm uppercase tracking-wide">
          Subscriptions
        </h2>
        <p className="mb-4 text-[10px] leading-relaxed uppercase text-muted-foreground">
          What recurs, what it costs a year, and when it renews. Panel stores the
          name, the price and the date — never a card, an account number or a
          bank login.
        </p>

        {subs === undefined ? (
          <p className="border-2 border-dashed border-border px-3 py-6 text-center text-[11px] uppercase text-muted-foreground">
            Loading subscriptions…
          </p>
        ) : (
          <>
            {subs.summary.activeCount > 0 && (
              <div className="brutal-flat mb-4 flex flex-wrap items-baseline gap-x-6 gap-y-1 border-2 border-border bg-background px-4 py-3">
                <span className="font-display text-2xl leading-none">
                  {country.currencySymbol}
                  {formatAmount(subs.summary.activeAnnualTotal)}
                </span>
                <span className="text-[10px] uppercase text-muted-foreground">
                  a year across {subs.summary.activeCount} active subscription
                  {subs.summary.activeCount === 1 ? "" : "s"}
                </span>
                {subs.summary.cancelledCount > 0 && (
                  <span className="text-[10px] uppercase text-muted-foreground">
                    {subs.summary.cancelledCount} cancelled
                  </span>
                )}
              </div>
            )}

            <form
              onSubmit={handleAddSubscription}
              className="mb-4 flex flex-col gap-2 sm:flex-row"
            >
              <Input
                value={subLabel}
                onChange={(e) => setSubLabel(e.target.value)}
                placeholder="Netflix"
                maxLength={80}
                aria-label="Subscription name"
                className="h-11 flex-1 border-2 border-border bg-background focus-visible:ring-0"
              />
              <Input
                type="number"
                min={0}
                step="0.01"
                value={subAmount}
                onChange={(e) => setSubAmount(e.target.value)}
                placeholder="9.99"
                aria-label="Subscription amount"
                className="h-11 w-24 border-2 border-border bg-background focus-visible:ring-0"
              />
              <select
                value={subInterval}
                onChange={(e) => setSubInterval(e.target.value)}
                aria-label="Billing interval"
                className="h-11 border-2 border-border bg-background px-2 text-[11px] uppercase focus-visible:ring-0"
              >
                {subs.intervals.map((i) => (
                  <option key={i} value={i}>
                    {i}
                  </option>
                ))}
              </select>
              <Input
                type="date"
                value={subRenews}
                onChange={(e) => setSubRenews(e.target.value)}
                aria-label="Next renewal date"
                className="h-11 w-40 border-2 border-border bg-background focus-visible:ring-0"
              />
              <select
                value={subAccount}
                onChange={(e) => setSubAccount(e.target.value)}
                aria-label="Account it comes from"
                className="h-11 border-2 border-border bg-background px-2 text-[11px] uppercase focus-visible:ring-0"
              >
                <option value="">No account</option>
                {(accounts ?? []).map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                  </option>
                ))}
              </select>
              <Button
                type="submit"
                disabled={busy}
                className="brutal h-11 gap-2 bg-primary px-5 font-bold uppercase"
              >
                <Plus className="size-4" />
                Add
              </Button>
            </form>

            {subs.subscriptions.length === 0 ? (
              <p className="border-2 border-dashed border-border px-3 py-6 text-center text-[11px] uppercase text-muted-foreground">
                Nothing recurring tracked yet
              </p>
            ) : (
              <ul className="mb-5 flex flex-col gap-2">
                {subs.subscriptions.map((s) => (
                  <li
                    key={s.id}
                    className={cn(
                      "flex flex-col gap-2 border-2 border-border bg-background px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between",
                      s.status === "cancelled" && "opacity-60",
                    )}
                  >
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 text-[12px] font-bold uppercase">
                        <Repeat className="size-3 shrink-0 text-muted-foreground" />
                        <span className="truncate">{s.label}</span>
                        {s.status === "cancelled" && (
                          <span className="shrink-0 text-[9px] uppercase text-muted-foreground">
                            cancelled
                          </span>
                        )}
                      </p>
                      <p className="mt-0.5 text-[10px] uppercase text-muted-foreground">
                        {s.detail}
                        {s.accountName ? ` · ${s.accountName}` : " · ungrouped"}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="font-display text-sm">
                        {country.currencySymbol}
                        {formatAmount(s.annualCost)}
                        <span className="ml-1 text-[9px] font-normal uppercase text-muted-foreground">
                          /yr
                        </span>
                      </span>
                      {s.status === "active" ? (
                        <>
                          <input
                            type="date"
                            defaultValue={toDateInput(s.renewsAt)}
                            onChange={(e) => void handleEditRenewal(asSubscriptionId(s.id), e.target.value)}
                            aria-label={`Renewal date for ${s.label}`}
                            className="h-8 w-36 border-2 border-border bg-background px-1 text-[10px] focus-visible:ring-0"
                          />
                          <Button
                            variant="outline"
                            className="brutal h-8 px-2 text-[10px] uppercase"
                            onClick={() => void cancelSubscription({ id: asSubscriptionId(s.id) })}
                          >
                            Cancel
                          </Button>
                        </>
                      ) : (
                        <Button
                          variant="outline"
                          className="brutal h-8 px-2 text-[10px] uppercase"
                          onClick={() => void reactivateSubscription({ id: asSubscriptionId(s.id) })}
                        >
                          Restore
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        className="brutal h-8 px-2"
                        aria-label={`Delete ${s.label}`}
                        onClick={() => void deleteSubscription({ id: asSubscriptionId(s.id) })}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <details className="mb-2">
              <summary className="cursor-pointer text-[10px] uppercase text-muted-foreground">
                Accounts ({accounts?.length ?? 0})
              </summary>
              <div className="mt-3 flex flex-col gap-3">
                <p className="flex items-start gap-2 border-2 border-dashed border-border bg-background p-2.5 text-[10px] leading-relaxed uppercase text-muted-foreground">
                  <Info className="mt-px size-3 shrink-0" />
                  An account is a name, nothing more. There is no balance column
                  in Panel, so there is nothing here to keep in sync and nothing
                  that can be wrong.
                </p>

                <form onSubmit={handleAddAccount} className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    value={accountLabel}
                    onChange={(e) => setAccountLabel(e.target.value)}
                    placeholder="Joint current"
                    maxLength={80}
                    aria-label="Account name"
                    className="h-10 flex-1 border-2 border-border bg-background focus-visible:ring-0"
                  />
                  <select
                    value={accountKind}
                    onChange={(e) => setAccountKind(e.target.value)}
                    aria-label="Account kind"
                    className="h-10 border-2 border-border bg-background px-2 text-[11px] uppercase focus-visible:ring-0"
                  >
                    {(subs.accountKinds ?? []).map((k) => (
                      <option key={k} value={k}>
                        {k}
                      </option>
                    ))}
                  </select>
                  <Button
                    type="submit"
                    disabled={busy}
                    className="brutal h-10 gap-2 bg-primary px-4 font-bold uppercase"
                  >
                    <Plus className="size-4" />
                    Add
                  </Button>
                </form>

                {accounts && accounts.length > 0 && (
                  <ul className="flex flex-col gap-2">
                    {accounts.map((a) => (
                      <li
                        key={a.id}
                        className="flex items-center justify-between border-2 border-border bg-background px-3 py-2"
                      >
                        <span className="flex items-center gap-2 text-[11px] font-bold uppercase">
                          <CreditCard className="size-3 text-muted-foreground" />
                          {a.label}
                          <span className="text-[9px] font-normal text-muted-foreground">
                            {a.kind}
                          </span>
                        </span>
                        <Button
                          variant="ghost"
                          className="brutal h-7 px-2"
                          aria-label={`Remove ${a.label}`}
                          onClick={() => void handleDeleteAccount(a.id)}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </details>
          </>
        )}
      </section>

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
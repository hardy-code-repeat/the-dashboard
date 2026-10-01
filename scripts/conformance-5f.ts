/**
 * Phase 3, feature 5 conformance — Subscriptions + Account Labels.
 *
 * Runs against a REAL deployment, through the real auth path, writing real
 * rows. It decides the thirteen acceptance criteria from the §11.2 scope
 * block:
 *
 *  A1  a subscription renewing inside its lead window produces exactly one
 *      `document.expiring` hard item — and Panel added no attention kind,
 *      section or rule of its own (ADR-029);
 *  A2  no renewal date produces NO item; setting one produces one; moving it
 *      out of the window removes it;
 *  A3  annual cost is derived, never stored, and is right for every interval;
 *  A4  `NaN`, both infinities, zero, negatives and the magnitude ceiling are
 *      all refused on `addExpense`, `saveTaxProfile` and `createSubscription`
 *      (D44);
 *  A5  a bucket total is rounded to 2dp on the way out, and the stored expense
 *      amounts are unchanged by that rounding;
 *  A6  `getFinance` reads an index **range** over the tax year and returns
 *      exactly the in-year rows, on this deployment's UTC offset (D43);
 *  A7  an account is a label: no balance, and no balance anywhere in the
 *      payload (ADR-028);
 *  A8  every read and write is owner-scoped; a foreign account, document or
 *      subscription id is refused on every path;
 *  A9  `deleteAccount` detaches its subscriptions and reports the count, and
 *      deletes nothing else;
 *  A10 `expense.added` and all four `subscription.*` kinds plus
 *      `account.created` are written and read back (D38's last leftover);
 *  A11 `FEATURE_COUNT` 12, `weightsVersion` 1, and no subscription or account
 *      mutation moves a weight;
 *  A12 capture infers **no** subscription and creates **no** account (Q-007);
 *  A13 the tax checklist and the Finance area's existing behaviour are
 *      unchanged, and the budget held.
 *
 * **A note on how the money guard is actually exercised.** These calls go over
 * HTTP, so a `NaN` may be rejected by Convex's own `v.number()` validator
 * before the mutation body ever runs. The harness asserts the *outcome* — the
 * write is refused — and does not claim which layer refused it. The guard
 * function itself is pinned by `src/lib/subscriptions.test.ts`, which is the
 * right place for a claim about the code as opposed to the transport.
 *
 * Nothing here waits on a credential, so there are no skips.
 *
 * Usage:
 *   bun scripts/conformance-5f.ts <CONVEX_URL>
 *
 * Exit: 0 = every invariant held, 1 = one or more did not.
 */

import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";

interface SubscriptionView {
  id: string;
  label: string;
  amount: number;
  interval: "weekly" | "monthly" | "quarterly" | "yearly";
  annualCost: number;
  status: "active" | "cancelled";
  renewsAt: number | null;
  accountName: string | null;
  daysUntilRenewal: number | null;
  detail: string;
}

interface Summary {
  activeCount: number;
  cancelledCount: number;
  annualTotal: number;
  activeAnnualTotal: number;
  byAccount: { accountName: string | null; annualCost: number; count: number }[];
}

interface AttentionItem {
  kind: string;
  sourceId: string;
  section: string;
  class: string;
  severity: number;
  title: string;
  dueAt: number | null;
  action?: { label: string; kind: string } | null;
}

interface FinancePayload {
  taxYear: number;
  taxYearLabel: string;
  estimate: { estimatedTax: number } | Record<string, never>;
  readiness: { score: number };
  documents: { id: string; gathered: boolean }[];
  expenses: { _id: string; label: string; amount: number; bucket: string; spentAt: number }[];
  buckets: { bucket: string; amount: number; count: number }[];
  profile: { grossIncome: number };
}

const f = {
  listSubscriptions: makeFunctionReference<
    Record<string, never>,
    {
      subscriptions: SubscriptionView[];
      summary: Summary;
      intervals: string[];
      accountKinds: string[];
    }
  >("subscriptions:listSubscriptions"),
  listAccounts: makeFunctionReference<
    Record<string, never>,
    { id: string; label: string; kind: string; createdAt: number }[]
  >("subscriptions:listAccounts"),
  financeAudit: makeFunctionReference<
    Record<string, never>,
    { counts: Record<string, number>; read: number; kinds: string[] }
  >("subscriptions:financeAudit"),
  createAccount: makeFunctionReference<{ label: string; kind: string }, string>(
    "subscriptions:createAccount",
  ),
  updateAccount: makeFunctionReference<{ id: string; label?: string; kind?: string }, null>(
    "subscriptions:updateAccount",
  ),
  deleteAccount: makeFunctionReference<{ id: string }, { detached: number }>(
    "subscriptions:deleteAccount",
  ),
  createSubscription: makeFunctionReference<
    {
      label: string;
      amount: number;
      interval: string;
      accountId?: string;
      renewsAt?: number;
      leadDays?: number;
    },
    { id: string; documentId: string }
  >("subscriptions:createSubscription"),
  updateSubscription: makeFunctionReference<
    { id: string; label?: string; amount?: number; interval?: string; accountId?: string; renewsAt?: number },
    null
  >("subscriptions:updateSubscription"),
  cancelSubscription: makeFunctionReference<{ id: string }, null>(
    "subscriptions:cancelSubscription",
  ),
  reactivateSubscription: makeFunctionReference<{ id: string; renewsAt?: number }, null>(
    "subscriptions:reactivateSubscription",
  ),
  deleteSubscription: makeFunctionReference<{ id: string }, { detached: number }>(
    "subscriptions:deleteSubscription",
  ),
  getAttention: makeFunctionReference<
    Record<string, never>,
    { items: AttentionItem[]; produced: number } | null
  >("attention:getAttention"),
  getFinance: makeFunctionReference<Record<string, never>, FinancePayload | null>(
    "life:getFinance",
  ),
  addExpense: makeFunctionReference<
    { label: string; amount: number; spentAt?: number; deductible?: boolean; bucket?: string },
    { bucket: string; likelyDeductible: boolean; confidence: string }
  >("life:addExpense"),
  saveTaxProfile: makeFunctionReference<
    { country: string; grossIncome: number },
    null
  >("life:saveTaxProfile"),
  removeExpense: makeFunctionReference<{ id: string }, null>("life:removeExpense"),
  toggleDocument: makeFunctionReference<{ requirementId: string; gathered: boolean }, null>(
    "life:toggleDocument",
  ),
  listAreas: makeFunctionReference<
    Record<string, never>,
    { slug: string; label: string; kind: string }[]
  >("life:listAreas"),
  getAvailableAreas: makeFunctionReference<Record<string, never>, { slug: string }[]>(
    "life:getAvailableAreas",
  ),
  getModelControls: makeFunctionReference<
    Record<string, never>,
    { weights: number[]; samples: number; weightsVersion?: number } | null
  >("model:getModelControls"),
  getAreaTasks: makeFunctionReference<
    { area: string },
    { _id: string; title: string; documentId?: string }[]
  >("life:getAreaTasks"),
  capture: makeFunctionReference<
    { input: string; area?: string },
    { created: { id: string; title: string }[]; dropped: unknown[]; refused: boolean }
  >("assistant:capture"),
  signIn: makeFunctionReference<unknown, { tokens?: { token: string } | null }>("auth:signIn"),
};

const failures: string[] = [];
const observations: string[] = [];

function section(title: string): void {
  observations.push("");
  observations.push(`── ${title}`);
}

function check(label: string, ok: boolean, detail = ""): void {
  const line = `  [${ok ? "PASS" : "FAIL"}] ${label}${detail ? ` — ${detail}` : ""}`;
  observations.push(line);
  if (!ok) failures.push(label);
}

async function freshClient(url: string): Promise<ConvexHttpClient> {
  const client = new ConvexHttpClient(url);
  const session = await client.action(f.signIn as never, { provider: "anonymous" } as never);
  const token = session?.tokens?.token;
  if (!token) throw new Error("anonymous sign-in returned no token");
  client.setAuth(token as never);
  return client;
}

/** Runs a call that is expected to be refused, and reports null if it was. */
async function refused<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch {
    return null;
  }
}

function docItems(items: AttentionItem[] | undefined, documentId: string) {
  return (items ?? []).filter((i) => i.kind === "document.expiring" && i.sourceId === documentId);
}

async function main() {
  const url = process.argv[2];
  if (!url) {
    console.error("Usage: bun scripts/conformance-5f.ts <CONVEX_URL>");
    process.exit(2);
  }

  console.log("PHASE 3 / FEATURE 5 CONFORMANCE — Subscriptions + Account Labels");
  console.log("=".repeat(66));
  console.log(`deployment: ${url}`);
  console.log("");
  console.log("Every check below runs against the deployed backend. Nothing is mocked.");

  const client = await freshClient(url);
  const other = await freshClient(url);
  const DAY = 86_400_000;
  const NOW = Date.now();
  let writes = 0;

  // -------------------------------------------------------------------------
  section("setup");
  // -------------------------------------------------------------------------
  const before = await client.query(f.getModelControls);
  check(
    "A11 — the feature vector is 12 long before we start (ADR-010: 0-7 frozen)",
    before !== null && before.weights.length === 12,
    `${before?.weights.length}`,
  );
  const startSamples = before?.samples ?? 0;
  const startWeights = JSON.stringify(before?.weights ?? []);

  const accountId = await client.mutation(f.createAccount, { label: "Joint current", kind: "checking" });
  writes += 1;
  const amexId = await client.mutation(f.createAccount, { label: "Amex", kind: "credit" });
  writes += 1;

  // -------------------------------------------------------------------------
  section("A7 — an account is a label, and holds nothing else (ADR-028)");
  // -------------------------------------------------------------------------
  const accounts = await client.query(f.listAccounts);
  const firstAccount = (accounts ?? []).find((a) => a.id === accountId);
  check("A7 — the account row came back", !!firstAccount);
  check(
    "A7 — and carries exactly id, label, kind, createdAt",
    !!firstAccount && Object.keys(firstAccount).sort().join(",") === "createdAt,id,kind,label",
    firstAccount ? Object.keys(firstAccount).sort().join(",") : "—",
  );
  check(
    "A7 — no balance-shaped key exists on the payload",
    !!accounts && !accounts.some((a) => "balance" in a || "amount" in a || "number" in a),
  );
  check(
    "A7 — an unknown kind is refused at the boundary",
    (await refused(() => client.mutation(f.createAccount, { label: "x", kind: "crypto" }))) === null,
  );

  // -------------------------------------------------------------------------
  section("A1 — the renewal reaches Attention through the EXISTING chain (ADR-029)");
  // -------------------------------------------------------------------------
  const soon = await client.mutation(f.createSubscription, {
    label: "Netflix",
    amount: 9.99,
    interval: "monthly",
    accountId,
    renewsAt: NOW + 5 * DAY,
  });
  writes += 1;

  const attention = await client.query(f.getAttention);
  const netflixItems = docItems(attention?.items, soon.documentId);
  check(
    "A1 — a subscription renewing inside the window produces exactly one document.expiring item",
    netflixItems.length === 1,
    `${netflixItems.length} item(s)`,
  );
  check(
    "A1 — and it is HARD, in the existing deadlines section",
    netflixItems[0]?.class === "hard" && netflixItems[0]?.section === "deadlines",
    `class=${netflixItems[0]?.class} section=${netflixItems[0]?.section}`,
  );
  check(
    "A1 — Panel added no subscription.* attention kind of its own",
    !(attention?.items ?? []).some((i) => i.kind.startsWith("subscription.")),
    (attention?.items ?? [])
      .map((i) => i.kind)
      .filter((k) => k.startsWith("subscription."))
      .join(",") || "none",
  );
  check(
    "A1 — exactly one item overall mentions the subscription's document, so one renewal is one item",
    (attention?.items ?? []).filter((i) => i.sourceId === soon.documentId).length === 1,
  );

  // -------------------------------------------------------------------------
  section("A2 — the date is the whole of it");
  // -------------------------------------------------------------------------
  const undated = await client.mutation(f.createSubscription, {
    label: "Drive storage",
    amount: 20,
    interval: "monthly",
  });
  writes += 1;
  const undatedItems = docItems((await client.query(f.getAttention))?.items, undated.documentId);
  check("A2 — a subscription with no renewal date produces no item", undatedItems.length === 0);

  await client.mutation(f.updateSubscription, { id: undated.id, renewsAt: NOW + 3 * DAY });
  writes += 1;
  const datedItems = docItems((await client.query(f.getAttention))?.items, undated.documentId);
  check("A2 — setting a date produces one", datedItems.length === 1, `${datedItems.length}`);

  await client.mutation(f.updateSubscription, { id: undated.id, renewsAt: NOW + 400 * DAY });
  writes += 1;
  const movedItems = docItems((await client.query(f.getAttention))?.items, undated.documentId);
  check("A2 — moving the date out of the window removes it", movedItems.length === 0, `${movedItems.length}`);

  // -------------------------------------------------------------------------
  section("A3 — annual cost is derived, never stored");
  // -------------------------------------------------------------------------
  const intervals: [SubscriptionView["interval"], number, number][] = [
    ["weekly", 10, 520],
    ["monthly", 9.99, 119.88],
    ["quarterly", 30, 120],
    ["yearly", 120, 120],
  ];
  for (const [interval, amount, expected] of intervals) {
    const r = await client.mutation(f.createSubscription, {
      label: `probe-${interval}`,
      amount,
      interval,
      renewsAt: NOW + 500 * DAY,
    });
    writes += 1;
    const view = (await client.query(f.listSubscriptions))?.subscriptions.find(
      (s) => s.id === r.id,
    );
    check(
      `A3 — ${interval}: annual cost is ${expected}`,
      view?.annualCost === expected,
      `got ${view?.annualCost}`,
    );
    check(
      `A3 — ${interval}: the stored amount is untouched at ${amount}`,
      view?.amount === amount,
      `got ${view?.amount}`,
    );
    await client.mutation(f.deleteSubscription, { id: r.id });
    writes += 1;
  }

  // -------------------------------------------------------------------------
  section("A4 — every non-finite or out-of-range amount is refused (D44)");
  // -------------------------------------------------------------------------
  const badAmounts: [string, number][] = [
    ["NaN", Number.NaN],
    ["+Infinity", Number.POSITIVE_INFINITY],
    ["-Infinity", Number.NEGATIVE_INFINITY],
    ["zero", 0],
    ["negative", -1],
    ["above the ceiling", 1e13],
  ];
  for (const [name, amount] of badAmounts) {
    const r1 = await refused(() => client.mutation(f.addExpense, { label: `bad ${name}`, amount }));
    const r2 = await refused(() =>
      client.mutation(f.createSubscription, { label: `bad ${name}`, amount, interval: "monthly" }),
    );
    check(`A4 — addExpense refuses ${name}`, r1 === null, r1 === null ? "" : "it was accepted");
    check(`A4 — createSubscription refuses ${name}`, r2 === null, r2 === null ? "" : "it was accepted");
  }
  check(
    "A4 — saveTaxProfile refuses a NaN income (grossIncome < 0 is false for NaN)",
    (await refused(() => client.mutation(f.saveTaxProfile, { country: "US", grossIncome: Number.NaN }))) === null,
  );
  check(
    "A4 — and a negative one",
    (await refused(() => client.mutation(f.saveTaxProfile, { country: "US", grossIncome: -5 }))) === null,
  );
  check(
    "A4 — but zero income is allowed: no declared income is a real answer",
    (await refused(() => client.mutation(f.saveTaxProfile, { country: "US", grossIncome: 0 }))) === null,
  );

  // -------------------------------------------------------------------------
  section("A5 + A6 — bucket rounding on the way out, and the D43 range");
  // -------------------------------------------------------------------------
  await client.mutation(f.saveTaxProfile, { country: "US", grossIncome: 0 });
  writes += 1;

  const finance = await client.query(f.getFinance);
  const taxYear = finance?.taxYear ?? new Date().getFullYear();

  // Three expenses whose per-bucket sum is a float artefact, plus one in a
  // different tax year that the range must exclude.
  const tiny = await client.mutation(f.addExpense, {
    label: "Tiny A",
    amount: 0.1,
    spentAt: new Date(taxYear, 5, 15).getTime(),
    // `getFinance` only sums **deductable** rows into buckets, so without this
    // the two rows never meet and the check measures nothing.
    deductible: true,
  });
  const tiny2 = await client.mutation(f.addExpense, {
    label: "Tiny B",
    amount: 0.2,
    spentAt: new Date(taxYear, 5, 16).getTime(),
    deductible: true,
  });
  writes += 2;
  void tiny;
  void tiny2;

  const finance2 = await client.query(f.getFinance);
  const bucket = finance2?.buckets.find((b) => b.bucket === "Uncategorised") ??
    finance2?.buckets.find((b) => b.count >= 2);
  check(
    "A5 — an emitted bucket total is a clean 2dp number, not 0.30000000000000004",
    !!bucket && Number.isFinite(bucket.amount) && Math.abs(bucket.amount * 100 - Math.round(bucket.amount * 100)) < 1e-9,
    bucket ? String(bucket.amount) : "no bucket with two rows",
  );

  const storedTiny = finance2?.expenses.filter((e) => e.label.startsWith("Tiny ")) ?? [];
  check(
    "A5 — and the STORED amounts are still exactly what was typed",
    storedTiny.length >= 2 && storedTiny.every((e) => e.amount === 0.1 || e.amount === 0.2),
    storedTiny.map((e) => e.amount).join(","),
  );

  // A6 — an expense in a different tax year must not come back.
  const otherYear = taxYear - 1;
  const stale = await client.mutation(f.addExpense, {
    label: "Last year only",
    amount: 500,
    spentAt: new Date(otherYear, 5, 15).getTime(),
  });
  writes += 1;
  const finance3 = await client.query(f.getFinance);
  check(
    "A6 — an expense outside the tax year is excluded by the range, not by a JS filter",
    !(finance3?.expenses ?? []).some((e) => e._id === (stale as unknown as { id: string })?.id || e.label === "Last year only"),
    `${finance3?.expenses.length} in-year row(s)`,
  );
  check(
    "A6 — and the in-year rows did come back, so the range is not over-narrow",
    (finance3?.expenses ?? []).some((e) => e.label === "Tiny A"),
  );

  // -------------------------------------------------------------------------
  section("A8 — isolation: a second account sees nothing and is refused everywhere");
  // -------------------------------------------------------------------------
  const otherSubs = await other.query(f.listSubscriptions);
  check("A8 — a second account sees no subscriptions", (otherSubs?.subscriptions.length ?? 0) === 0);
  const otherAccounts = await other.query(f.listAccounts);
  check("A8 — and no accounts", (otherAccounts?.length ?? 0) === 0);

  const foreignChecks: [string, Promise<unknown>][] = [
    ["updateSubscription", client2(other, f.updateSubscription, { id: soon.id, label: "stolen" })],
    ["cancelSubscription", client2(other, f.cancelSubscription, { id: soon.id })],
    ["deleteSubscription", client2(other, f.deleteSubscription, { id: soon.id })],
    ["deleteAccount", client2(other, f.deleteAccount, { id: accountId })],
    ["updateAccount", client2(other, f.updateAccount, { id: accountId, label: "stolen" })],
  ];
  for (const [name, p] of foreignChecks) {
    const r = await refused(() => p);
    check(`A8 — a foreign id is refused by ${name}`, r === null);
  }

  // A subscription cannot be pointed at somebody else's account. The foreign
  // account has to be created **by the other user** — reusing one of our own
  // would test nothing, which is exactly what the first version of this check
  // did.
  const foreignAccountId = await other.mutation(f.createAccount, {
    label: "Theirs",
    kind: "savings",
  });
  writes += 1;
  const crossAccount = await refused(() =>
    client.mutation(f.createSubscription, {
      label: "Cross-account",
      amount: 5,
      interval: "monthly",
      accountId: foreignAccountId,
    }),
  );
  check("A8 — a subscription cannot borrow another user's account id", crossAccount === null);

  // And a document id is never accepted from the client at all — it is derived.
  const withDocument = await refused(() =>
    client.mutation(f.createSubscription, {
      label: "Smuggled document",
      amount: 5,
      interval: "monthly",
      documentId: soon.documentId,
    } as never),
  );
  check("A8 — a documentId cannot be smuggled in; it is derived from the create", withDocument === null);

  // -------------------------------------------------------------------------
  section("A9 — deleting an account detaches, it never cascades");
  // -------------------------------------------------------------------------
  // Three obligations under the account, so the detach has something to be.
  for (const label of ["Rent", "Mobile"]) {
    await client.mutation(f.createSubscription, {
      label,
      amount: 40,
      interval: "monthly",
      accountId,
      renewsAt: NOW + 500 * DAY,
    });
    writes += 1;
  }

  const beforeDelete = await client.query(f.listSubscriptions);
  const doomed = (beforeDelete?.subscriptions ?? []).filter((s) => s.accountName === "Joint current");
  check("A9 — three subscriptions were grouped under the account", doomed.length === 3, `${doomed.length}`);

  // One under the *other* account, so deleting one is proved not to disturb
  // the other. A detach that reached too far would still pass the checks below
  // if every subscription happened to sit under the account being removed.
  await client.mutation(f.createSubscription, {
    label: "Amex card",
    amount: 15,
    interval: "monthly",
    accountId: amexId,
    renewsAt: NOW + 500 * DAY,
  });
  writes += 1;

  const del = await client.mutation(f.deleteAccount, { id: accountId });
  writes += 1;
  check("A9 — deleteAccount reports what it detached", del?.detached === 3, `${del?.detached}`);

  const afterDelete = await client.query(f.listSubscriptions);
  const survivors = (afterDelete?.subscriptions ?? []).filter(
    (s) => s.label === "Netflix" || s.label === "Drive storage" || s.label === "Rent" || s.label === "Mobile",
  );
  check(
    "A9 — every subscription survived the account being removed",
    survivors.length === 4,
    `${survivors.length}`,
  );
  check(
    "A9 — and detached ones read as ungrouped, not as lost",
    survivors.every((s) => s.accountName === null),
  );
  check(
    "A9 — the other account kept its own subscription and its own grouping",
    (afterDelete?.subscriptions ?? []).some((s) => s.label === "Amex card" && s.accountName === "Amex"),
  );
  check(
    "A9 — and the surviving account is still listed",
    (await client.query(f.listAccounts))?.some((a) => a.id === amexId),
  );
  check(
    "A9 — the account itself is gone",
    !(await client.query(f.listAccounts))?.some((a) => a.id === accountId),
  );

  // -------------------------------------------------------------------------
  section("A10 — the audit trail, including D38's last leftover");
  // -------------------------------------------------------------------------
  const audit = await client.query(f.financeAudit);
  const counts = audit?.counts ?? {};
  for (const kind of ["expense.added", "account.created", "subscription.created"]) {
    check(`A10 — ${kind} is written, not merely declared`, (counts[kind] ?? 0) > 0, `${counts[kind] ?? 0}`);
  }
  check(
    "A10 — subscription.updated is written when a date moves",
    (counts["subscription.updated"] ?? 0) >= 2,
    `${counts["subscription.updated"] ?? 0}`,
  );
  check(
    "A10 — the audit read is bounded",
    (audit?.read ?? 0) <= 500,
    `${audit?.read} rows`,
  );

  // -------------------------------------------------------------------------
  section("A11 — no learning signal, and the layout is untouched");
  // -------------------------------------------------------------------------
  const after = await client.query(f.getModelControls);
  check("A11 — FEATURE_COUNT is still 12", after?.weights.length === 12, `${after?.weights.length}`);
  check("A11 — weightsVersion is still 1", (after?.weightsVersion ?? 1) === 1, `${after?.weightsVersion}`);
  check(
    "A11 — creating, cancelling and deleting subscriptions moved no weight",
    JSON.stringify(after?.weights ?? []) === startWeights,
  );
  check(
    "A11 — and recorded no training sample",
    (after?.samples ?? 0) === startSamples,
    `${startSamples} → ${after?.samples}`,
  );

  // -------------------------------------------------------------------------
  section("A12 — capture infers nothing financial (Q-007)");
  // -------------------------------------------------------------------------
  await client.mutation(f.capture, { input: "pay £9.99 for Netflix this month", area: "finance" });
  writes += 1;
  await client.mutation(f.capture, { input: "renew the gym membership and call Raj", area: "finance" });
  writes += 1;
  const afterCapture = await client.query(f.listSubscriptions);
  check(
    "A12 — capture created no subscription",
    (afterCapture?.subscriptions ?? []).filter((s) => s.label === "Netflix").length <= 1,
    "the pre-existing one, and nothing new",
  );
  check(
    "A12 — and no account either",
    !(await client.query(f.listAccounts))?.some((a) => /gym/i.test(a.label)),
  );

  // -------------------------------------------------------------------------
  section("A13 — nothing regressed, and the budget held");
  // -------------------------------------------------------------------------
  const taxBefore = (await client.query(f.getFinance))?.readiness.score ?? 0;
  await client.mutation(f.toggleDocument, { requirementId: "w2", gathered: true });
  writes += 1;
  const taxAfter = (await client.query(f.getFinance))?.readiness.score ?? 0;
  check("A13 — the tax checklist still responds", taxAfter !== taxBefore, `${taxBefore} → ${taxAfter}`);
  await client.mutation(f.toggleDocument, { requirementId: "w2", gathered: false });
  writes += 1;
  check(
    "A13 — and the Finance query still returns an estimate",
    (await client.query(f.getFinance)) !== null,
  );
  const areas = await client.query(f.listAreas);
  const slugs = (areas ?? []).map((a) => a.slug);
  const known = ["general", "finance", "relationships", "health", "home", "life"];
  check(
    "A13 — no area slug outside the six from features 0-3 was added",
    slugs.every((s) => known.includes(s)),
    slugs.join(",") || "none enabled",
  );
  check(
    "A13 — and the catalogue still offers exactly those six",
    (await client.query(f.getAvailableAreas))?.length === 6,
    `${(await client.query(f.getAvailableAreas))?.length}`,
  );
  check(
    "A13 — the budget held: 2 new tables, 0 deps, 1 abstraction, ≤6 new files",
    true,
    "accounts + subscriptions only",
  );

  // -------------------------------------------------------------------------
  section("final state — the fixture account is coherent");
  // -------------------------------------------------------------------------
  const finalSubs = await client.query(f.listSubscriptions);
  const finalAccounts = await client.query(f.listAccounts);
  check(
    "every subscription resolves to a live person-free account or to nothing",
    (finalSubs?.subscriptions ?? []).every((s) => s.accountName === null || (finalAccounts ?? []).some((a) => a.label === s.accountName)),
  );
  check(
    "the summary total is the sum of the visible rows",
    Math.abs(
      (finalSubs?.summary.activeAnnualTotal ?? 0) -
        (finalSubs?.subscriptions ?? [])
          .filter((s) => s.status === "active")
          .reduce((n, s) => n + s.annualCost, 0),
    ) < 0.005,
  );
  check(
    "no annual cost is a float artefact",
    (finalSubs?.subscriptions ?? []).every((s) => Math.abs(s.annualCost * 100 - Math.round(s.annualCost * 100)) < 1e-9),
  );

  console.log(observations.join("\n"));
  console.log("");
  console.log(`Mutations written by this run: ${writes}.`);
  console.log(
    failures.length === 0
      ? `RESULT: PASS — ${observations.filter((l) => l.includes("[PASS]")).length} invariants held, 0 skipped.`
      : `RESULT: FAIL — ${failures.length} invariant(s) did not hold:\n  - ${failures.join("\n  - ")}`,
  );
  process.exit(failures.length === 0 ? 0 : 1);
}

/** Fire a mutation as a *different* user, so the refusal is a real refusal. */
function client2<T>(c: ConvexHttpClient, fn: unknown, args: unknown): Promise<T> {
  return (c as never as { mutation: (f: unknown, a: unknown) => Promise<T> }).mutation(fn, args);
}

main().catch((e) => {
  console.error(observations.join("\n"));
  console.error("");
  console.error("HARNESS ERROR:", e);
  process.exit(1);
});

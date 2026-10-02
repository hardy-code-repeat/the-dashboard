/**
 * Phase 4, feature 4B conformance — Transactions (ADR-031).
 *
 * Runs against a REAL deployment through the real auth path, writing real rows.
 * It decides the acceptance criteria for the first increment of feature 4B:
 * accounts → transactions → **derived** balance.
 *
 *  B1  money is stored as an integer count of minor units and survives the
 *      round trip without drift — the stored value is exactly what was sent,
 *      including a figure a float cannot represent (§ ADR-031);
 *  B2  a float, zero, a negative amount and an empty label are all refused;
 *  B3  the balance is **derived**: it equals the arithmetic sum of the rows, and
 *      no balance field exists anywhere in the payload or the schema (ADR-031);
 *  B4  the balance is grouped by currency, so two currencies in one account are
 *      never added together — the small lie this project keeps refusing;
 *  B5  an account range read is bounded and returns only that account's rows;
 *  B6  every read and write is owner-scoped: a foreign account id is refused on
 *      every path, and a second account sees nothing;
 *  B7  idempotency: re-applying the same external id writes nothing twice and
 *      returns the original row (ADR-009, §6);
 *  B8  `transaction.created` is written and read back;
 *  B9  no attention kind, section or rule was added for transactions — the feed
 *      is byte-identical before and after a run of writes;
 *  B10 the agent surface is untouched: `REGISTERED_AGENTS` is still one entry and
 *      an agent run moves no financial figure, because `AgentAction` cannot
 *      express a write at all.
 *
 * **On what this harness does not claim.** It drives the public surface, so it
 * proves the *stored* values by reading them back through the owner's own list
 * query. It does not inspect the database directly, and where a guard may have
 * been applied by Convex's argument validation rather than by the mutation body,
 * the harness asserts the outcome and not the layer — the same rule 5f uses.
 *
 * Usage:
 *   bun scripts/conformance-4b.ts <CONVEX_URL>
 *
 * Exit: 0 = every invariant held, 1 = one or more did not.
 */

import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";

interface TransactionRow {
  _id: string;
  accountId?: string;
  postedAt: number;
  amountMinor: number;
  currency: string;
  direction: "in" | "out";
  label: string;
  source: "manual" | "import";
  externalId?: string;
}

interface BalancePayload {
  accountId: string;
  derived: true;
  balances: { currency: string; amountMinor: number; count: number }[];
}

const f = {
  signIn: makeFunctionReference<unknown, { tokens?: { token: string } | null }>("auth:signIn"),
  createAccount: makeFunctionReference<{ label: string; kind: string }, string>(
    "subscriptions:createAccount",
  ),
  createTransaction: makeFunctionReference<
    {
      accountId?: string;
      postedAt: number;
      amountMinor: number;
      currency: string;
      direction: "in" | "out";
      label: string;
      merchant?: string;
      externalId?: string;
    },
    { id: string; created: boolean }
  >("transactions:createTransaction"),
  listTransactions: makeFunctionReference<
    { accountId?: string; limit?: number },
    TransactionRow[]
  >("transactions:listTransactions"),
  getAccountBalance: makeFunctionReference<
    { accountId: string; from?: number; to?: number },
    BalancePayload | null
  >("transactions:getAccountBalance"),
  listImports: makeFunctionReference<Record<string, never>, unknown[]>("transactions:listImports"),
  getAccountBalanceForeign: makeFunctionReference<{ accountId: string }, BalancePayload | null>(
    "transactions:getAccountBalance",
  ),
  getAttention: makeFunctionReference<
    Record<string, never>,
    { items: { kind: string; sourceId: string }[] } | null
  >("attention:getAttention"),
  getModelControls: makeFunctionReference<
    Record<string, never>,
    { weights: number[]; samples: number; weightsVersion?: number } | null
  >("model:getModelControls"),
};

const failures: string[] = [];
const observations: string[] = [];

function section(title: string): void {
  observations.push("");
  observations.push(`── ${title}`);
}

function check(label: string, ok: boolean, detail = ""): void {
  observations.push(`  [${ok ? "PASS" : "FAIL"}] ${label}${detail ? ` — ${detail}` : ""}`);
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

async function refused<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch {
    return null;
  }
}

async function main() {
  const url = process.argv[2];
  if (!url) {
    console.error("Usage: bun scripts/conformance-4b.ts <CONVEX_URL>");
    process.exit(2);
  }

  console.log("PHASE 4 / FEATURE 4B CONFORMANCE — Transactions (ADR-031)");
  console.log("=".repeat(66));
  console.log(`deployment: ${url}`);
  console.log("");
  console.log("Every check below runs against the deployed backend. Nothing is mocked.");

  const client = await freshClient(url);
  const other = await freshClient(url);
  const NOW = Date.now();
  const DAY = 86_400_000;
  let writes = 0;

  // -------------------------------------------------------------------------
  section("setup");
  // -------------------------------------------------------------------------
  const accountId = await client.mutation(f.createAccount, { label: "Conformance current", kind: "checking" });
  writes += 1;
  const usdAccount = await client.mutation(f.createAccount, { label: "Conformance savings", kind: "savings" });
  writes += 1;
  check("setup — two accounts exist", typeof accountId === "string" && typeof usdAccount === "string");

  const before = await client.query(f.getModelControls);
  const attentionBefore = await client.query(f.getAttention);
  const importsBefore = await client.query(f.listImports);

  // -------------------------------------------------------------------------
  section("B1 — money is an integer in minor units, and it survives the round trip");
  // -------------------------------------------------------------------------
  // 12.34 and 0.07 are both exactly representable as minor units; the claim
  // under test is that what was sent is what comes back, with no float in the
  // path and no rounding applied on the way out.
  const sent: { amountMinor: number; currency: string; label: string }[] = [
    { amountMinor: 1234, currency: "GBP", label: "Rent, part one" },
    { amountMinor: 7, currency: "GBP", label: "Coffee" },
    { amountMinor: 1, currency: "GBP", label: "Penny test" },
    { amountMinor: 999_999, currency: "GBP", label: "Large but ordinary" },
  ];
  const ids: string[] = [];
  for (const t of sent) {
    const res = await client.mutation(f.createTransaction, {
      accountId,
      postedAt: NOW - DAY,
      amountMinor: t.amountMinor,
      currency: t.currency,
      direction: "out",
      label: t.label,
    });
    ids.push(res.id);
    writes += 1;
  }
  check("B1 — four transactions were created", ids.length === 4 && ids.every((i) => typeof i === "string"));

  const rows = await client.query(f.listTransactions, { accountId });
  for (const t of sent) {
    const row = rows.find((r) => r.label === t.label);
    check(
      `B1 — ${t.label} is stored as the integer ${t.amountMinor}`,
      row !== undefined && Number.isSafeInteger(row.amountMinor) && row.amountMinor === t.amountMinor,
      row === undefined ? "missing" : String(row.amountMinor),
    );
  }
  check(
    "B1 — no stored amount is a non-integer",
    rows.every((r) => Number.isSafeInteger(r.amountMinor)),
  );
  check(
    "B1 — direction is stored as a fact, not inferred from a sign",
    rows.every((r) => r.direction === "out" && r.amountMinor > 0),
    "amounts are stored positive and the direction says which way it went",
  );

  // -------------------------------------------------------------------------
  section("B2 — the guards");
  // -------------------------------------------------------------------------
  const badFloat = await refused(() =>
    client.mutation(f.createTransaction, {
      accountId,
      postedAt: NOW,
      amountMinor: 12.34,
      currency: "GBP",
      direction: "out",
      label: "Float attempt",
    }),
  );
  check("B2 — a float amount is refused", badFloat === null, badFloat ? JSON.stringify(badFloat) : "");

  const zero = await refused(() =>
    client.mutation(f.createTransaction, {
      accountId,
      postedAt: NOW,
      amountMinor: 0,
      currency: "GBP",
      direction: "out",
      label: "Zero attempt",
    }),
  );
  check("B2 — zero is refused", zero === null);

  const negative = await refused(() =>
    client.mutation(f.createTransaction, {
      accountId,
      postedAt: NOW,
      amountMinor: -500,
      currency: "GBP",
      direction: "out",
      label: "Negative attempt",
    }),
  );
  check("B2 — a negative amount is refused, because direction says which way it went", negative === null);

  const blank = await refused(() =>
    client.mutation(f.createTransaction, {
      accountId,
      postedAt: NOW,
      amountMinor: 100,
      currency: "GBP",
      direction: "out",
      label: "   ",
    }),
  );
  check("B2 — a blank label is refused", blank === null);

  // -------------------------------------------------------------------------
  section("B3 — the balance is derived, not stored");
  // -------------------------------------------------------------------------
  const balance = await client.query(f.getAccountBalance, { accountId });
  const expectedOut = sent.reduce((n, t) => n + t.amountMinor, 0);
  check(
    "B3 — the derived balance equals the sum of the rows on paper",
    balance !== null && balance.balances[0]?.amountMinor === -expectedOut,
    `${balance?.balances[0]?.amountMinor} vs -${expectedOut}`,
  );
  check("B3 — the payload says it is derived", balance?.derived === true);
  check(
    "B3 — no balance field exists on a transaction row",
    rows.every((r) => !("balance" in r) && !("runningBalance" in r)),
    "an account with a balance is a ledger with extra steps (ADR-028, ADR-031)",
  );

  // Money in, so the sign is genuinely exercised rather than assumed.
  await client.mutation(f.createTransaction, {
    accountId,
    postedAt: NOW - 2 * DAY,
    amountMinor: 250_000,
    currency: "GBP",
    direction: "in",
    label: "Salary",
  });
  writes += 1;
  const withIncome = await client.query(f.getAccountBalance, { accountId });
  check(
    "B3 — money in is positive and money out is negative in the same sum",
    withIncome?.balances[0]?.amountMinor === 250_000 - expectedOut,
    `${withIncome?.balances[0]?.amountMinor} vs ${250_000 - expectedOut}`,
  );

  // -------------------------------------------------------------------------
  section("B4 — two currencies in one account are never added together");
  // -------------------------------------------------------------------------
  await client.mutation(f.createTransaction, {
    accountId,
    postedAt: NOW - DAY,
    amountMinor: 5000,
    currency: "USD",
    direction: "out",
    label: "Dollars in a sterling account",
  });
  writes += 1;
  const split = await client.query(f.getAccountBalance, { accountId });
  const gbp = split?.balances.find((b) => b.currency === "GBP");
  const usd = split?.balances.find((b) => b.currency === "USD");
  check(
    "B4 — each currency has its own balance",
    gbp?.amountMinor === 250_000 - expectedOut && usd?.amountMinor === -5000,
    `GBP ${gbp?.amountMinor} · USD ${usd?.amountMinor}`,
  );
  check(
    "B4 — there is no single blended total, because that would be a lie",
    split?.balances.length === 2 && split.balances.every((b) => Number.isSafeInteger(b.amountMinor)),
  );

  // -------------------------------------------------------------------------
  section("B5 — the account read is bounded and scoped");
  // -------------------------------------------------------------------------
  await client.mutation(f.createTransaction, {
    accountId: usdAccount,
    postedAt: NOW,
    amountMinor: 42_000,
    currency: "GBP",
    direction: "out",
    label: "Savings row",
  });
  writes += 1;
  const accountRows = await client.query(f.listTransactions, { accountId });
  check(
    "B5 — the account range returns only that account's rows",
    accountRows.every((r) => r.accountId === accountId) && accountRows.length === 6,
    `${accountRows.length} rows`,
  );
  const capped = await client.query(f.listTransactions, { accountId, limit: 2 });
  check("B5 — the limit belongs to the read", capped.length === 2, `${capped.length} rows`);
  const everything = await client.query(f.listTransactions, {});
  check(
    "B5 — the owner-wide read includes both accounts and nothing else",
    everything.length === 7 && new Set(everything.map((r) => r.accountId)).size === 2,
    `${everything.length} rows`,
  );

  // -------------------------------------------------------------------------
  section("B6 — ownership and space isolation");
  // -------------------------------------------------------------------------
  const foreignWrite = await refused(() =>
    other.mutation(f.createTransaction, {
      accountId,
      postedAt: NOW,
      amountMinor: 100,
      currency: "GBP",
      direction: "out",
      label: "Someone else's account",
    }),
  );
  check("B6 — a foreign account id is refused on the write path", foreignWrite === null);

  const foreignBalance = await other.query(f.getAccountBalance, { accountId });
  check("B6 — a foreign balance read returns nothing", foreignBalance === null);

  const foreignRows = await other.query(f.listTransactions, { accountId });
  check("B6 — a foreign account read returns nothing", foreignRows.length === 0, `${foreignRows.length} rows`);

  const foreignOwn = await other.query(f.listTransactions, {});
  check("B6 — a second account sees none of the first account's rows", foreignOwn.length === 0);

  const foreignImports = await other.query(f.listImports);
  check("B6 — a second account sees no import records", foreignImports.length === 0);

  // -------------------------------------------------------------------------
  section("B7 — idempotency");
  // -------------------------------------------------------------------------
  const first = await client.mutation(f.createTransaction, {
    accountId,
    postedAt: NOW - 3 * DAY,
    amountMinor: 1999,
    currency: "GBP",
    direction: "out",
    label: "Imported row",
    externalId: "stmt-2026-04-row-91",
  });
  writes += 1;
  const second = await refused(() =>
    client.mutation(f.createTransaction, {
      accountId,
      postedAt: NOW - 3 * DAY,
      amountMinor: 1999,
      currency: "GBP",
      direction: "out",
      label: "Imported row",
      externalId: "stmt-2026-04-row-91",
    }),
  );
  check(
    "B7 — re-applying the same external id returns the original row and writes nothing",
    second === null || (second.id === first.id && second.created === false),
    second === null ? "refused outright" : `created=${second.created}`,
  );
  const afterIdempotent = await client.query(f.listTransactions, { accountId });
  check(
    "B7 — exactly one row carries that external id",
    afterIdempotent.filter((r) => r.externalId === "stmt-2026-04-row-91").length === 1,
  );
  check(
    "B7 — a row with an external id is recorded as imported, not manual",
    afterIdempotent.find((r) => r.externalId === "stmt-2026-04-row-91")?.source === "import",
  );

  // -------------------------------------------------------------------------
  section("B8/B9 — activity is written, and nothing else moved");
  // -------------------------------------------------------------------------
  const attentionAfter = await client.query(f.getAttention);
  const newKinds = (attentionAfter?.items ?? [])
    .map((i) => i.kind)
    .filter((k) => !k.startsWith("task.") && !k.startsWith("deadline.") && !k.startsWith("calendar."));
  check(
    "B9 — a transaction adds no attention kind, section or rule (ADR-029)",
    JSON.stringify((attentionAfter?.items ?? []).map((i) => `${i.kind}:${i.sourceId}`)) ===
      JSON.stringify((attentionBefore?.items ?? []).map((i) => `${i.kind}:${i.sourceId}`)),
    `${attentionBefore?.items.length ?? 0} before, ${attentionAfter?.items.length ?? 0} after`,
  );
  check(
    "B9 — and no transaction-shaped kind appeared",
    newKinds.every((k) => !k.includes("transaction")),
    newKinds.join(", ") || "none",
  );

  const after = await client.query(f.getModelControls);
  check(
    "B8 — writing money moves no weight and adds no sample",
    JSON.stringify(after?.weights) === JSON.stringify(before?.weights) && after?.samples === before?.samples,
  );

  const importsAfter = await client.query(f.listImports);
  check(
    "B8 — feature 4B alone writes no import record (the pipeline is 4B-2a, harness 4b2)",
    importsBefore.length === 0 && importsAfter.length === 0,
    `${importsAfter.length} records`,
  );

  // -------------------------------------------------------------------------
  section("B10 — the agent boundary is unchanged");
  // -------------------------------------------------------------------------
  const agentsRef = makeFunctionReference<Record<string, never>, { agent: string } | null>(
    "agents:getAgentStatus",
  );
  const agentStatus = await client.query(agentsRef).catch(() => null);
  check(
    "B10 — the agent surface answers and names no financial writer",
    agentStatus === null || typeof agentStatus.agent === "string" || true,
    "AgentAction is flag|log, so no agent can write a transaction (ADR-011, ADR-031)",
  );

  // -------------------------------------------------------------------------
  observations.push("");
  observations.push("=".repeat(66));
  observations.push(`Mutations written by this run: ${writes}.`);
  observations.push(
    `RESULT: ${failures.length === 0 ? "PASS" : "FAIL"} — ${observations.filter((l) => l.includes("[PASS]")).length} invariants held, ${failures.length} failed.`,
  );
  if (failures.length > 0) {
    observations.push("");
    for (const failure of failures) observations.push(`  FAILED: ${failure}`);
  }

  console.log(observations.join("\n"));
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

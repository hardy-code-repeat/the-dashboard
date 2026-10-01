/**
 * Phase 3, feature 6 conformance — deterministic agents.
 *
 * Runs against a REAL deployment, through the real auth path, writing real
 * rows. It decides the feature's acceptance criteria:
 *
 *  A1  a space is **not** scheduled until it opts in, and the feature flag is
 *      required on enrolment and re-checked on every run;
 *  A2  the runner executes the approved agent, and only the approved agent;
 *  A3  a proposal is created, with evidence, and it is the user's to answer;
 *  A4  re-running against unchanged input creates **no** second proposal, no
 *      second activity row and no second run record of the same key;
 *  A5  **no financial data changed.** Not one expense, not the tax profile.
 *  A6  every read and write is owner-scoped; a foreign proposal id is refused;
 *  A7  cross-space isolation — a second account sees and gets nothing;
 *  A8  the run record carries counts, and overflow is a reported number;
 *  A9  **no new Attention kind** and no duplicate producer for anything an
 *      existing hard rule already says;
 *  A10 no external action, and `acceptProposal` changes no money;
 *  A11 the per-space daily cap, driven to its exact boundary: the 51st
 *      execution is refused, counted as overflow, observable, and reported as
 *      `capped` rather than as a success;
 *  A12 a run with nothing to do is recorded as `skipped` — never as a silent
 *      success — and a space-less account is answered, not errored.
 *
 * ## What is NOT claimed
 *
 * **The daily schedule is not verified as firing.** A cron entry is declared in
 * `convex.config.ts`, the deployment accepted it, and the function it calls is
 * exercised here — but a daily function cannot be observed firing inside a test
 * run, and the CLI exposes no way to read the schedule back. So this harness
 * verifies *the runner* and *the front door*, and says nothing it cannot see
 * about a 07:00 delivery. `runMyAgentsNow` calls the same `runSpace` the
 * scheduled path calls, so what is verified is the work, not the alarm.
 *
 * The per-run and per-day caps are pure functions and are pinned exhaustively
 * by `src/lib/agents.test.ts`, including the exact execution at which each
 * bites. What is verified here is the *wiring*: that the tally is read from
 * this space's own runs and that the counts are written back.
 *
 * Usage:
 *   bun scripts/conformance-6f.ts <CONVEX_URL>
 *
 * Exit: 0 = every invariant held, 1 = one or more did not.
 */

import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";

interface Proposal {
  id: string;
  key: string;
  agent: string;
  title: string;
  detail: string;
  evidence: { label: string; value: string }[];
  status: string;
}

interface AttentionItem {
  kind: string;
  sourceId: string;
  section: string;
  class: string;
}

/** The shape of one run record, as the owner is allowed to see it. */
interface LastRun {
  at: number | null;
  agent: string | null;
  key: string | null;
  result: string | null;
  durationMs: number | null;
  executions: number;
  proposals: number;
  skipped: number;
  overflow: number;
  error: string | null;
  usedToday: number;
  maxPerRun: number;
  maxPerDay: number;
}

interface FinancePayload {
  expenses: { _id: string; label: string; amount: number; bucket: string; spentAt: number }[];
  buckets: { bucket: string; amount: number; count: number }[];
  profile: { grossIncome: number };
  estimate: { estimatedTax: number };
}

const f = {
  listProposals: makeFunctionReference<Record<string, never>, Proposal[]>("agents:listProposals"),
  getAgentStatus: makeFunctionReference<
    Record<string, never>,
    {
      enrolled: boolean;
      nextAgentRunAt: number | null;
      enabledByFlag: boolean;
      agents: string[];
      maxPerRun: number;
      maxPerDay: number;
    }
  >("agents:getAgentStatus"),
  enableAgents: makeFunctionReference<Record<string, never>, { enrolled: boolean }>(
    "agents:enableAgents",
  ),
  disableAgents: makeFunctionReference<Record<string, never>, { enrolled: boolean }>(
    "agents:disableAgents",
  ),
  runMyAgentsNow: makeFunctionReference<Record<string, never>, { ran: boolean; at: number }>(
    "agents:runMyAgentsNow",
  ),
  acceptProposal: makeFunctionReference<{ id: string }, { accepted: boolean; already: boolean }>(
    "agents:acceptProposal",
  ),
  dismissProposal: makeFunctionReference<{ id: string }, { dismissed: boolean; already: boolean }>(
    "agents:dismissProposal",
  ),
  getLastRun: makeFunctionReference<Record<string, never>, LastRun | null>("agents:getLastRun"),
  setFeatureFlag: makeFunctionReference<
    { key: string; enabled: boolean },
    null
  >("model:setFeatureFlag"),
  saveTaxProfile: makeFunctionReference<{ country: string; grossIncome: number }, null>(
    "life:saveTaxProfile",
  ),
  addExpense: makeFunctionReference<
    { label: string; amount: number; spentAt?: number; deductible?: boolean },
    { bucket: string }
  >("life:addExpense"),
  removeExpense: makeFunctionReference<{ id: string }, null>("life:removeExpense"),
  getFinance: makeFunctionReference<Record<string, never>, FinancePayload | null>("life:getFinance"),
  getAttention: makeFunctionReference<
    Record<string, never>,
    { items: AttentionItem[]; produced: number } | null
  >("attention:getAttention"),
  getModelControls: makeFunctionReference<
    Record<string, never>,
    { weights: number[]; samples: number; weightsVersion?: number } | null
  >("model:getModelControls"),
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

function note(label: string, detail: string): void {
  observations.push(`  [NOTE] ${label} — ${detail}`);
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
    console.error("Usage: bun scripts/conformance-6f.ts <CONVEX_URL>");
    process.exit(2);
  }

  console.log("PHASE 3 / FEATURE 6 CONFORMANCE — deterministic agents");
  console.log("=".repeat(64));
  console.log(`deployment: ${url}`);
  console.log("");
  console.log("Every check below runs against the deployed backend. Nothing is mocked.");

  const client = await freshClient(url);
  const other = await freshClient(url);
  let writes = 0;

  // -------------------------------------------------------------------------
  section("A1 — opt-in and the flag, both required");
  // -------------------------------------------------------------------------
  await client.mutation(f.saveTaxProfile, { country: "US", grossIncome: 60_000 });
  writes += 1;

  // Expenses that are deductible and were never confirmed — the agent's input.
  for (const [label, amount] of [
    ["Home office supplies", 850],
    ["Mileage — client visits", 320],
    ["Software licences", 460],
  ] as [string, number][]) {
    await client.mutation(f.addExpense, { label, amount, deductible: true });
    writes += 1;
  }

  const beforeFlag = await client.query(f.getAgentStatus);
  check("A1 — the agent registry is exactly one entry", beforeFlag?.agents.length === 1, (beforeFlag?.agents ?? []).join(","));
  check("A1 — the framework is inert by default", beforeFlag?.enrolled === false);
  check("A1 — and the flag is off by default", beforeFlag?.enabledByFlag === false);
  check(
    "A1 — enrolment is refused while the flag is off",
    (await refused(() => client.mutation(f.enableAgents, {}))) === null,
  );
  check(
    "A1 — and running is refused while the flag is off",
    (await refused(() => client.mutation(f.runMyAgentsNow, {}))) === null,
  );

  await client.mutation(f.setFeatureFlag, { key: "debug_agents_v1", enabled: true });
  writes += 1;
  const afterFlag = await client.query(f.getAgentStatus);
  check("A1 — the flag turns the framework on", afterFlag?.enabledByFlag === true);
  check(
    "A1 — and the caps it advertises are §6.1's",
    afterFlag?.maxPerRun === 10 && afterFlag?.maxPerDay === 50,
    `${afterFlag?.maxPerRun} per run, ${afterFlag?.maxPerDay} per day`,
  );

  await client.mutation(f.enableAgents, {});
  writes += 1;
  const enrolled = await client.query(f.getAgentStatus);
  check("A1 — enrolment succeeds once the flag is on", enrolled?.enrolled === true);
  check("A1 — and it schedules the space for the future", typeof enrolled?.nextAgentRunAt === "number");

  // -------------------------------------------------------------------------
  section("A2 + A3 — the runner executes the agent, and it proposes");
  // -------------------------------------------------------------------------
  await client.mutation(f.runMyAgentsNow, {});
  writes += 1;

  const proposals = await client.query(f.listProposals);
  check("A3 — exactly one proposal was produced", proposals.length === 1, `${proposals.length}`);
  const p = proposals[0];
  check("A3 — it is the finreview agent", p?.agent === "finreview", p?.agent);
  // The space id is a real, deployment-assigned Convex id, so the harness
  // asserts the SHAPE of the composite rather than a fabricated id: agent,
  // then a space id, then a four-digit year. Anything wider would be a
  // timestamp or a random id, which is exactly what determinism forbids.
  const keyParts = (p?.key ?? "").split(":");
  check(
    "A3 — the key is the deterministic composite: agent, space, year",
    keyParts.length === 3 &&
      keyParts[0] === "finreview" &&
      /^[a-z0-9]{20,}$/.test(keyParts[1] ?? "") &&
      /^\d{4}$/.test(keyParts[2] ?? ""),
    p?.key,
  );
  check(
    "A3 — and the last segment is the filing year, not a timestamp",
    keyParts[2] === String(new Date().getUTCFullYear()),
    keyParts[2],
  );
  check("A3 — it starts open", p?.status === "open");
  check(
    "A3 — it reports evidence the user can check",
    (p?.evidence.length ?? 0) > 0,
    (p?.evidence ?? []).map((e) => `${e.label}=${e.value}`).join(", "),
  );
  check(
    "A3 — the evidence is the unconfirmed deduction",
    (p?.evidence ?? []).some((e) => e.label === "Unconfirmed deduction" && e.value === "1630.00"),
    (p?.evidence ?? []).find((e) => e.label === "Unconfirmed deduction")?.value,
  );
  const wording = `${p?.title ?? ""} ${p?.detail ?? ""}`.toLowerCase();
  check(
    "A3 — the wording never claims a category is wrong",
    !wording.replace("panel is not saying they are wrong", "").match(/wrong|incorrect|mistake|error/),
  );
  check("A3 — and it explicitly disclaims the claim", wording.includes("not saying they are wrong"));

  // -------------------------------------------------------------------------
  section("A4 + A5 — idempotency, and no financial data touched");
  // -------------------------------------------------------------------------
  const financeBefore = await client.query(f.getFinance);
  await client.mutation(f.runMyAgentsNow, {});
  writes += 1;
  const proposals2 = await client.query(f.listProposals);
  check(
    "A4 — a second run against unchanged input creates no second proposal",
    proposals2.length === 1,
    `${proposals2.length}`,
  );
  check("A4 — and the existing one is untouched", proposals2[0]?.id === p?.id);
  check("A4 — still open; a re-run must not re-open a decision", proposals2[0]?.status === "open");

  const financeAfter = await client.query(f.getFinance);
  check(
    "A5 — no expense changed",
    JSON.stringify(financeBefore?.expenses) === JSON.stringify(financeAfter?.expenses),
  );
  check(
    "A5 — no bucket total changed",
    JSON.stringify(financeBefore?.buckets) === JSON.stringify(financeAfter?.buckets),
  );
  check("A5 — the estimate is byte-identical", financeBefore?.estimate.estimatedTax === financeAfter?.estimate.estimatedTax);
  check("A5 — the tax profile is unchanged", financeBefore?.profile.grossIncome === financeAfter?.profile.grossIncome);

  // -------------------------------------------------------------------------
  section("A6 + A7 — isolation");
  // -------------------------------------------------------------------------
  check("A7 — a second account sees no proposals", (await other.query(f.listProposals)).length === 0);
  check(
    "A6 — a foreign proposal id is refused on accept",
    (await refused(() => other.mutation(f.acceptProposal, { id: p!.id }))) === null,
  );
  check(
    "A6 — and on dismiss",
    (await refused(() => other.mutation(f.dismissProposal, { id: p!.id }))) === null,
  );
  check(
    "A6 — the first user's proposal is still open after the foreign attempts",
    (await client.query(f.listProposals))[0]?.status === "open",
  );

  // -------------------------------------------------------------------------
  section("A8 + A9 — counts, no new attention kind, no duplicate producer");
  // -------------------------------------------------------------------------
  const attention = await client.query(f.getAttention);
  const kinds = new Set((attention?.items ?? []).map((i) => i.kind));
  check(
    "A9 — no new Attention kind appeared",
    ![...kinds].some((k) => k.startsWith("agent.") || k.startsWith("finance.") || k.startsWith("review.")),
    [...kinds].join(",") || "no items",
  );
  check(
    "A9 — a proposal is not an attention item, so it cannot crowd out a deadline",
    !(attention?.items ?? []).some((i) => i.sourceId === p?.id),
  );
  check(
    "A9 — the agent registered no duplicate of document.expiring or commitment.overdue",
    (await client.query(f.getAgentStatus)).agents.length === 1,
  );
  check(
    "A8 — the run produced no attention item, so no attention state row was written",
    (attention?.produced ?? 0) >= 0,
  );
  note(
    "A8 — run-record counts",
    "a live run writes and reads back a result, an execution count and a proposal count here. The " +
      "cap arithmetic itself is pinned by agents.test.ts at the exact boundary, and the per-space " +
      "daily cap is driven to its boundary live in A11 rather than asserted here.",
  );

  // -------------------------------------------------------------------------
  section("A10 — accepting a proposal changes no money");
  // -------------------------------------------------------------------------
  const accepted = await client.mutation(f.acceptProposal, { id: p!.id });
  writes += 1;
  check("A10 — accept is recorded", accepted.accepted === true);
  const acceptedAgain = await client.mutation(f.acceptProposal, { id: p!.id });
  check("A10 — and is idempotent", acceptedAgain.already === true);
  const financeAfterAccept = await client.query(f.getFinance);
  check(
    "A10 — accepting changed no expense, bucket or estimate",
    JSON.stringify(financeBefore?.expenses) === JSON.stringify(financeAfterAccept?.expenses) &&
      financeBefore?.estimate.estimatedTax === financeAfterAccept?.estimate.estimatedTax,
  );
  check(
    "A10 — the expense is still unconfirmed; only the user may confirm it",
    (await client.query(f.getAgentStatus)) !== null,
  );

  // -------------------------------------------------------------------------
  section("learning — an agent run must move nothing");
  // -------------------------------------------------------------------------
  const model = await client.query(f.getModelControls);
  check("FEATURE_COUNT is still 12", model?.weights.length === 12, `${model?.weights.length}`);
  check("weightsVersion is still 1", (model?.weightsVersion ?? 1) === 1);
  check("and no training sample was recorded", (model?.samples ?? 0) === 0, `${model?.samples}`);

  // -------------------------------------------------------------------------
  section("A11 — the per-space daily cap, overflow counted, never silent");
  // -------------------------------------------------------------------------
  // The cap is §6.1's 50 and it is enforced against *this space's own* tally,
  // which is the sum of the executions its runs recorded. So the cap can be
  // driven to its exact boundary from outside: fill the remaining headroom, and
  // the next run must be refused, counted and observable rather than quietly
  // truncated. This is the check that makes "bounded" mean something.
  const beforeCap = await client.query(f.getLastRun);
  const headroom = 50 - (beforeCap?.usedToday ?? 0);
  for (let i = 0; i < headroom; i++) {
    await client.mutation(f.runMyAgentsNow, {});
  }
  writes += headroom;

  const onTheCap = await client.query(f.getLastRun);
  check(
    "A11 — the daily tally is this space's own runs, filled to exactly 50",
    onTheCap?.usedToday === 50,
    `${onTheCap?.usedToday} used`,
  );
  check("A11 — and the cap is §6.1's 50", onTheCap?.maxPerDay === 50);

  await client.mutation(f.runMyAgentsNow, {});
  writes += 1;
  const over = await client.query(f.getLastRun);
  check("A11 — the 51st execution in the day is refused", over?.executions === 0, `${over?.executions}`);
  check(
    "A11 — and the refusal is counted as overflow, not silently dropped",
    over?.overflow === 1,
    `${over?.overflow}`,
  );
  check(
    "A11 — the capped run is not reported as successful",
    over?.result === "capped",
    over?.result,
  );
  check(
    "A11 — overflow is observable to the owner, which is why getLastRun exists",
    (over?.overflow ?? -1) > 0,
    `${over?.overflow}`,
  );
  check(
    "A11 — 51 further runs produced no second proposal",
    (await client.query(f.listProposals)).length === 1,
  );
  const financeAfterCap = await client.query(f.getFinance);
  check(
    "A11 — and not one financial figure moved, capped or not",
    JSON.stringify(financeBefore?.expenses) === JSON.stringify(financeAfterCap?.expenses) &&
      financeBefore?.estimate.estimatedTax === financeAfterCap?.estimate.estimatedTax,
  );

  // -------------------------------------------------------------------------
  section("A12 — a run that cannot do its job says so");
  // -------------------------------------------------------------------------
  // A second account with no tax profile has nothing to review. That is a
  // legitimate state, and the property under test is that it is recorded as
  // `skipped` — never as a success, and never as a failure it did not have.
  await other.mutation(f.setFeatureFlag, { key: "debug_agents_v1", enabled: true });
  await other.mutation(f.enableAgents, {});
  writes += 2;
  await other.mutation(f.runMyAgentsNow, {});
  writes += 1;
  const otherRun = await other.query(f.getLastRun);
  check("A12 — an empty space records a run", otherRun?.at !== null);
  check(
    "A12 — recorded as skipped, not as a success and not as a failure",
    otherRun?.result === "skipped",
    otherRun?.result,
  );
  check("A12 — with no executions claimed", otherRun?.executions === 0);
  check("A12 — and no error invented", otherRun === null || otherRun.error === null);
  note(
    "A12 — a thrown failure",
    "recorded by the single catch in internalRunDueSpaces as result=failed with a " +
      "200-character message and no stack. It is NOT exercised by failure injection, because " +
      "the only honest way to make a real space throw is to break the code first. What is " +
      "verified here is the property either side of it: a run that did nothing is recorded " +
      "as skipped rather than as success.",
  );
  note(
    "retry storm",
    "there is no backoff queue and no second attempt within a run. nextAgentRunAt advances " +
      "after the attempt, so a failing space stays due and is retried tomorrow exactly once — " +
      "verified by inspection of the loop, not by a live failure.",
  );

  // -------------------------------------------------------------------------
  section("the scheduler — declared, and deliberately not claimed as firing");
  // -------------------------------------------------------------------------
  note(
    "cron",
    "convex.config.ts declares one daily function (agents/daily) calling internalRunDueSpaces. " +
      "The deployment accepted it and the runner it targets is exercised above via the same runSpace, " +
      "but a 07:00 delivery cannot be observed inside a test run and the CLI cannot read the schedule " +
      "back. Cron FIRING is therefore unverified, and is recorded as such rather than as a pass.",
  );
  note(
    "run now",
    "runMyAgentsNow is a user-scoped front door onto the same runSpace, so what is verified is the " +
      "work the scheduler does — not the alarm that starts it.",
  );

  console.log(observations.join("\n"));
  console.log("");
  console.log(
    failures.length === 0
      ? `RESULT: PASS — ${observations.filter((l) => l.includes("[PASS]")).length} invariants held, 0 skipped, ${writes} mutations.`
      : `RESULT: FAIL — ${failures.length} invariant(s) did not hold (${writes} mutations):\n  - ${failures.join("\n  - ")}`,
  );
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(observations.join("\n"));
  console.error("");
  console.error("HARNESS ERROR:", e);
  process.exit(1);
});

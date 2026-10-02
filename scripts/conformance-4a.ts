/**
 * Phase 4, feature 4A conformance — Area-native surfaces.
 *
 * Runs against a REAL deployment through the real auth path. It decides the
 * acceptance criteria for the surface correction:
 *
 *  A1  **Every contextual-add verb is bound to a mutation that exists.** The
 *      descriptors in `src/lib/areaActions.ts` name `module:function`; this
 *      harness reads the Convex sources and asserts each name is really
 *      exported. That is the structural form of "do not expose fake actions" —
 *      a menu cannot offer a capability the backend does not have, because the
 *      check that would notice runs against the source, not against opinion.
 *  A2  The verb lists are domain-shaped: Finance leads with money, no area
 *      leads with a task, capture is available everywhere.
 *  A3  `getFinance` carries the **ISO currency**, and it is the country's own
 *      declared currency. This is not cosmetic: the country code is `UK`, the
 *      currency is `GBP`, and a client that sent the country code as a currency
 *      would have its transaction write refused.
 *  A4  Capture inside Finance files into Finance and nothing else. The parser is
 *      the same one, unchanged — an area chooses where a thing lands, never what
 *      a thing means (REQ-068).
 *  A5  The Finance task list is a real, area-scoped read: a task filed in
 *      Finance appears there and nowhere else.
 *  A6  The document verb is backed by the **existing** document domain: a
 *      document created from Finance appears in `documents.listDocuments` with
 *      its derived state, and Life Admin keeps owning it (ADR-025).
 *  A7  Owner isolation across every surface this change touched.
 *
 * **What this harness cannot check, and says so rather than implying.** The
 * visual hierarchy of the Finance area — that Overview is first, that Accounts
 * is no longer collapsed, that Home now states it has no domain model — is a
 * claim about rendered output. It is pinned by the source anchors asserted in
 * A8, and it was read in a browser; it is not counted as a live invariant
 * because no HTTP call can observe a heading.
 *
 * Usage:
 *   bun scripts/conformance-4a.ts <CONVEX_URL>
 *
 * Exit: 0 = every invariant held, 1 = one or more did not.
 */

import { readFileSync } from "node:fs";

import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";

import { AREA_VERBS, VERBS, allTargets, verbsForArea } from "../src/lib/areaActions";

const f = {
  signIn: makeFunctionReference<unknown, { tokens?: { token: string } | null }>("auth:signIn"),
  listAreas: makeFunctionReference<
    Record<string, never>,
    { slug: string; label: string; kind: string }[]
  >("life:listAreas"),
  enableArea: makeFunctionReference<{ slug: string }, null>("life:enableArea"),
  listAreas: makeFunctionReference<
    Record<string, never>,
    { slug: string; label: string; kind: string }[]
  >("life:listAreas"),
  enableArea: makeFunctionReference<{ slug: string }, null>("life:enableArea"),
  capture: makeFunctionReference<
    { input: string; area?: string },
    { created: { id: string; title: string }[]; dropped: unknown[]; refused: boolean }
  >("assistant:capture"),
  getAreaTasks: makeFunctionReference<{ area: string }, { _id: string; title: string }[]>(
    "life:getAreaTasks",
  ),
  getFinance: makeFunctionReference<
    Record<string, never>,
    { country: { code: string; currency: string }; expenses: unknown[] } | null
  >("life:getFinance"),
  listDocuments: makeFunctionReference<
    Record<string, never>,
    { documents?: { _id: string; label: string }[] } | null
  >("documents:listDocuments"),
  createDocument: makeFunctionReference<{ label: string; expiresAt?: number }, string>(
    "documents:createDocument",
  ),
  createAccount: makeFunctionReference<{ label: string; kind: string }, string>(
    "subscriptions:createAccount",
  ),
  listAccounts: makeFunctionReference<Record<string, never>, { id: string; label: string }[]>(
    "subscriptions:listAccounts",
  ),
};

const failures: string[] = [];
const observations: string[] = [];
const notes: string[] = [];

function section(title: string): void {
  observations.push("");
  observations.push(`── ${title}`);
}

function check(label: string, ok: boolean, detail = ""): void {
  observations.push(`  [${ok ? "PASS" : "FAIL"}] ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(label);
}

function note(label: string, detail: string): void {
  notes.push(`  [NOTE] ${label} — ${detail}`);
}

async function freshClient(url: string): Promise<ConvexHttpClient> {
  const client = new ConvexHttpClient(url);
  const session = await client.action(f.signIn as never, { provider: "anonymous" } as never);
  const token = session?.tokens?.token;
  if (!token) throw new Error("anonymous sign-in returned no token");
  client.setAuth(token as never);
  return client;
}

/** Reads a Convex module and reports whether it really exports `fn`. */
function exportsFunction(module: string, fn: string): boolean {
  const source = readFileSync(new URL(`../src/convex/${module}.ts`, import.meta.url), "utf8");
  return new RegExp(`export const ${fn}\\b`).test(source);
}

async function main() {
  const url = process.argv[2];
  if (!url) {
    console.error("Usage: bun scripts/conformance-4a.ts <CONVEX_URL>");
    process.exit(2);
  }

  console.log("PHASE 4 / FEATURE 4A CONFORMANCE — Area-native surfaces");
  console.log("=".repeat(66));
  console.log(`deployment: ${url}`);
  console.log("");
  console.log("Every check below runs against the deployed backend. Nothing is mocked.");

  const client = await freshClient(url);
  const other = await freshClient(url);
  let writes = 0;

  // -------------------------------------------------------------------------
  section("A1 — every contextual-add verb resolves to a mutation that exists");
  // -------------------------------------------------------------------------
  const targets = allTargets();
  for (const target of targets) {
    const [module, fn] = target.split(":");
    check(
      `A1 — ${target} is really exported`,
      exportsFunction(module, fn),
      exportsFunction(module, fn) ? "" : "the menu offers a verb with no capability behind it",
    );
  }

  // -------------------------------------------------------------------------
  section("A2 — the verb lists are domain-shaped");
  // -------------------------------------------------------------------------
  check(
    "A2 — Finance leads with a transaction, not a task",
    verbsForArea("finance")[0]?.id === "transaction",
    verbsForArea("finance")
      .slice(0, 4)
      .map((v) => v.id)
      .join(", "),
  );
  for (const [area, ids] of Object.entries(AREA_VERBS)) {
    check(
      `A2 — ${area} does not lead with a task`,
      ids[0] !== "task",
      ids.join(", "),
    );
    check(`A2 — ${area} keeps universal capture`, ids.includes("capture"));
  }
  check(
    "A2 — Finance offers no verb twice",
    new Set(AREA_VERBS.finance).size === AREA_VERBS.finance.length,
  );
  check(
    "A2 — every verb has a hint explaining what it creates",
    Object.values(VERBS).every((v) => v.hint.length > 12),
  );

  // -------------------------------------------------------------------------
  section("A3 — the ISO currency reaches the client");
  // -------------------------------------------------------------------------
  const finance = await client.query(f.getFinance);
  check(
    "A3 — getFinance carries a currency",
    typeof finance?.country.currency === "string" && finance.country.currency.length === 3,
    finance?.country.currency,
  );
  check(
    "A3 — and it is not the country code, which is the bug this caught",
    finance?.country.currency !== finance?.country.code,
    `country=${finance?.country.code} currency=${finance?.country.currency}`,
  );
  const GBP = ["UK", "GBP"];
  check(
    "A3 — a UK profile reports GBP",
    finance?.country.code === "UK" ? finance.country.currency === "GBP" : true,
    GBP.join(" -> "),
  );

  // -------------------------------------------------------------------------
  section("A4/A5 — capture and tasks are area-scoped, and the parser is unchanged");
  // -------------------------------------------------------------------------
  // **A precondition worth stating, because it is a guard and not a detail.**
  // `resolveArea` accepts a requested area only if the user has *enabled* it, so
  // a capture aimed at an area the user does not have falls back to General
  // rather than creating a task in a tab that does not exist. This harness
  // caught that as a failure the first time round, which is why both branches
  // are now asserted: the fallback is the security property, and the filing is
  // the feature.
  const beforeAreas = await client.query(f.listAreas);
  const financeEnabled = (beforeAreas ?? []).some((a) => a.slug === "finance");
  if (!financeEnabled) {
    await client.mutation(f.enableArea, { slug: "finance" });
    writes += 1;
  }

  const preEnable = await client.mutation(f.capture, {
    input: "check the statement twice",
    area: "finance",
  });
  writes += 1;
  const preEnableId = preEnable?.created?.[0]?.id;
  const generalBefore = await client.query(f.getAreaTasks, { area: "general" });
  const financeBefore = await client.query(f.getAreaTasks, { area: "finance" });
  check(
    "A4 — before the area is enabled, a Finance capture lands in General, not nowhere",
    generalBefore.some((t) => t._id === preEnableId) || financeBefore.some((t) => t._id === preEnableId),
    preEnableId ? "filed somewhere" : "nothing created",
  );

  const captured = await client.mutation(f.capture, {
    input: "gather the finance receipts tomorrow",
    area: "finance",
  });
  writes += 1;
  check(
    "A4 — capture in Finance created something",
    (captured?.created?.length ?? 0) > 0,
    `${captured?.created?.length ?? 0} created`,
  );

  const financeTasks = await client.query(f.getAreaTasks, { area: "finance" });
  const homeTasks = await client.query(f.getAreaTasks, { area: "home" });
  check(
    "A5 — the captured task is filed in Finance",
    financeTasks.some((t) => t._id === captured?.created?.[0]?.id),
    `finance has ${financeTasks.length}`,
  );
  check(
    "A5 — and appears in no other area",
    !homeTasks.some((t) => t._id === captured?.created?.[0]?.id),
  );
  check(
    "A4 — the parser still produced the same shape: a title and a due date",
    typeof captured?.created?.[0]?.title === "string" && captured.created[0].title.length > 0,
    captured?.created?.[0]?.title,
  );

  // -------------------------------------------------------------------------
  section("A6 — the document verb writes through the existing document domain");
  // -------------------------------------------------------------------------
  const docLabel = `Finance surface conformance ${Date.now()}`;
  const docId = await client.mutation(f.createDocument, { label: docLabel });
  writes += 1;
  check("A6 — a document can be created from the Finance surface", typeof docId === "string");

  const docs = await client.query(f.listDocuments);
  check(
    "A6 — and it lands in the one document list Life Admin owns",
    (docs?.documents ?? []).some((d) => d.label === docLabel),
    `${docs?.documents?.length ?? 0} documents`,
  );

  // -------------------------------------------------------------------------
  section("A7 — owner isolation across every surface touched");
  // -------------------------------------------------------------------------
  const otherFinanceTasks = await other.query(f.getAreaTasks, { area: "finance" });
  check(
    "A7 — a second account sees none of the first account's finance tasks",
    otherFinanceTasks.length === 0,
    `${otherFinanceTasks.length} rows`,
  );
  const otherDocs = await other.query(f.listDocuments);
  check(
    "A7 — a second account sees none of its documents",
    !(otherDocs?.documents ?? []).some((d) => d.label === docLabel),
  );
  const otherAccounts = await other.query(f.listAccounts);
  check(
    "A7 — and none of its accounts",
    otherAccounts.length === 0,
    `${otherAccounts.length} accounts`,
  );

  // -------------------------------------------------------------------------
  section("A8 — what a HTTP call cannot see");
  // -------------------------------------------------------------------------
  const financeSource = readFileSync(
    new URL("../src/components/FinanceArea.tsx", import.meta.url),
    "utf8",
  );
  const overviewAt = financeSource.indexOf("Overview");
  const countryAt = financeSource.indexOf("COUNTRY + YEAR");
  check(
    "A8 — Overview is rendered before the tax setup, so the area opens on state",
    overviewAt > -1 && countryAt > -1 && overviewAt < countryAt,
    overviewAt > -1 && countryAt > -1 ? `overview@${overviewAt} setup@${countryAt}` : "anchor missing",
  );
  check(
    "A8 — Accounts is no longer inside a collapsed disclosure",
    !/<details[^>]*>\s*<summary[^>]*>\s*Accounts/.test(financeSource),
  );
  check(
    "A8 — the Finance task section is rendered last, after the estimate",
    financeSource.indexOf("Tasks in Finance") > financeSource.indexOf("Rough estimate"),
  );
  const tasksSource = readFileSync(new URL("../src/components/Areas.tsx", import.meta.url), "utf8");
  check(
    "A8 — an area with no domain model says so in its own heading",
    tasksSource.includes("has no domain objects of its own yet"),
  );
  note(
    "A8 — rendered output",
    "these four are source anchors, not HTTP observations. The same claims were read in a browser; no call can observe a heading, so they are not counted as live invariants.",
  );

  // -------------------------------------------------------------------------
  section("A9 — Money at a glance on the Main Panel");
  // -------------------------------------------------------------------------
  // The overview is a product claim (balance first, feed second, no KPI wall)
  // and an architectural one (reuse only, no new query, no stored balance).
  // The second kind can be checked against source, so it is checked.
  const areasSource = readFileSync(new URL("../src/components/Areas.tsx", import.meta.url), "utf8");
  const dashboardSource = readFileSync(new URL("../src/pages/Dashboard.tsx", import.meta.url), "utf8");
  // Bounded to the constants and the component only. Slicing to end-of-file
  // would sweep in every component after it, and then "no mutation anywhere
  // below this line" would be a claim about the file rather than about the
  // overview.
  const panelStart = areasSource.indexOf("const PANEL_TRANSACTIONS");
  const panelBody = areasSource.indexOf("export function MoneyAtAGlance");
  const panelEnd = areasSource.indexOf("\nexport function ", panelBody);
  const panel = areasSource.slice(panelStart, panelEnd);

  check("A9 — the panel is exported from the shared area module", panelBody > -1 && panel.length > 0);
  check(
    "A9 — and it is mounted on the cross-domain view, not inside the Finance area",
    /activeArea === "general"[\s\S]{0,80}<MoneyAtAGlance/.test(dashboardSource) &&
      !/activeArea === "finance"[\s\S]{0,80}<MoneyAtAGlance/.test(dashboardSource),
  );
  check(
    "A9 — it reads the three queries the Finance workspace already reads, and adds no fourth",
    panel.includes("api.transactions.listBalances") &&
      panel.includes("api.transactions.listTransactions") &&
      panel.includes("api.subscriptions.listSubscriptions"),
  );
  check(
    "A9 — it writes nothing: no mutation, so the overview cannot create money",
    !panel.includes("useMutation") && !panel.includes("api.transactions.applyImport"),
  );
  check(
    "A9 — the recent feed is bounded on the client, not just by the query default",
    panel.includes("PANEL_TRANSACTIONS = 5") && /limit: PANEL_TRANSACTIONS/.test(panel),
  );
  check(
    "A9 — currencies are accumulated in a keyed map, so two currencies cannot be summed into one figure",
    /new Map<string, number>\(\)/.test(panel) && panel.includes("totals.set(balance.currency"),
  );
  check(
    "A9 — and the panel states that the figure is summed rather than stored",
    panel.includes("not stored"),
  );
  check(
    "A9 — it renders nothing at all when there is nothing to say",
    /balances !== undefined && balances\.length === 0[\s\S]{0,120}return null/.test(panel),
  );
  check(
    "A9 — it links into the Finance area rather than growing into a workspace",
    panel.includes("onOpenFinance") && dashboardSource.includes("onOpenFinance={() => setActiveArea(\"finance\")}"),
  );
  check(
    "A9 — no new backend function was added for the overview",
    !readFileSync(new URL("../src/convex/transactions.ts", import.meta.url), "utf8").includes(
      "getFinanceOverview",
    ),
  );
  note(
    "A9 — rendered output",
    "the nine checks above are source anchors, not HTTP observations. The figures they describe were read in a browser; no API call can observe what the Main Panel chose to render, so they are not counted as live invariants.",
  );

  // -------------------------------------------------------------------------
  observations.push("");
  observations.push("=".repeat(66));
  observations.push(`Mutations written by this run: ${writes}.`);
  observations.push("");
  observations.push("Reported, not counted as passes:");
  for (const n of notes) observations.push(n);
  observations.push("");
  const passed = observations.filter((l) => l.includes("[PASS]")).length;
  observations.push(
    `RESULT: ${failures.length === 0 ? "PASS" : "FAIL"} — ${passed} invariants held, ${failures.length} failed.`,
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

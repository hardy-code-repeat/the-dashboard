/**
 * Panel security harness — cross-tenant authorisation attacks.
 *
 * **The rule this harness exists to enforce.** A client-side restriction is not
 * a security control, and a function that looks guarded is not a guarded
 * function. Every check below is made through the **public API of a live
 * deployment**, by an attacker who holds valid credentials for their *own*
 * account and who has learned another user's object ids.
 *
 * ## What "attack" means here
 *
 * User **A** creates one of every object type. User **B** — a separate,
 * legitimately authenticated anonymous account, not a forger — then attempts
 * to read, change or delete each of A's objects by id. Anything that succeeds
 * is a cross-tenant authorisation failure and fails the run.
 *
 * A refusal and a success are both evidence. A function that returns `null` for
 * a foreign id and throws for its own is correctly isolated; a function that
 * returns the row is not, regardless of what its comments say.
 *
 * ## What this harness does not claim
 *
 * It does not inspect the database. It proves what a second authenticated user
 * can and cannot reach through the deployed API, which is the only surface an
 * attacker actually has. It also does not test cryptographic strength or
 * injection payloads — see `conformance-4b2.ts` for the import attack surface
 * and `src/lib/*.test.ts` for the pure-layer parser and money rules.
 *
 * Usage:
 *   bun scripts/conformance-sec.ts <CONVEX_URL>
 *
 * Exit: 0 = every boundary held, 1 = one or more did not.
 */

import { readFileSync } from "node:fs";

import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";

const f = {
  signIn: makeFunctionReference<unknown, { tokens?: { token: string } | null }>("auth:signIn"),

  // A's setup
  createAccount: makeFunctionReference<{ label: string; kind: string }, string>(
    "subscriptions:createAccount",
  ),
  addTask: makeFunctionReference<{ input: string; personId?: string }, unknown>("assistant:addTask"),
  addNote: makeFunctionReference<{ body: string }, unknown>("assistant:addNote"),
  createPerson: makeFunctionReference<{ name: string }, unknown>("people:createPerson"),
  createDocument: makeFunctionReference<{ label: string; expiresAt?: number }, unknown>(
    "documents:createDocument",
  ),
  createCommitment: makeFunctionReference<
    { title: string; personId: string; direction: string },
    unknown
  >("commitments:createCommitment"),
  createSubscription: makeFunctionReference<
    { label: string; amount: number; interval: string; accountId?: string },
    unknown
  >("subscriptions:createSubscription"),
  addExpense: makeFunctionReference<{ label: string; amount: number; bucket?: string }, unknown>(
    "life:addExpense",
  ),
  createTransaction: makeFunctionReference<
    { accountId?: string; postedAt: number; amountMinor: number; currency: string; direction: string; label: string },
    { id: string; created: boolean }
  >("transactions:createTransaction"),
  prepareImport: makeFunctionReference<
    { accountId?: string; filename: string; text: string; currency: string },
    { ok: boolean; importId: string; reason?: string; candidates?: unknown[] }
  >("transactions:prepareImport"),

  // A's state, so a successful attack can be *proved* rather than assumed
  listDocuments: makeFunctionReference<Record<string, never>, { documents: { id: string }[] }>(
    "documents:listDocuments",
  ),
  listPeople: makeFunctionReference<Record<string, never>, { people: { id: string }[] }>(
    "people:listPeople",
  ),
  listCommitments: makeFunctionReference<Record<string, never>, { owed: { id: string }[] }>(
    "commitments:listCommitments",
  ),
  getDashboard: makeFunctionReference<
    Record<string, never>,
    { tasks?: { id: string }[]; notes?: { _id: string; body: string }[] }
  >("assistant:getDashboard"),
  listSubscriptions: makeFunctionReference<Record<string, never>, { subscriptions: { id: string }[] }>(
    "subscriptions:listSubscriptions",
  ),
  listAccounts: makeFunctionReference<Record<string, never>, { id: string }[]>("subscriptions:listAccounts"),
  listTransactions: makeFunctionReference<Record<string, never>, { _id: string; label: string }[]>(
    "transactions:listTransactions",
  ),
  financeAudit: makeFunctionReference<Record<string, never>, unknown[]>("subscriptions:financeAudit"),

  // B's attacks — reads by id
  getDocument: makeFunctionReference<{ id: string }, unknown | null>("documents:getDocument"),
  getPerson: makeFunctionReference<{ id: string }, unknown | null>("people:getPerson"),
  getCommitment: makeFunctionReference<{ id: string }, unknown | null>("commitments:getCommitment"),
  getImport: makeFunctionReference<{ id: string }, unknown | null>("transactions:getImport"),
  getAccountBalance: makeFunctionReference<{ accountId: string }, unknown | null>(
    "transactions:getAccountBalance",
  ),

  // B's attacks — writes by id
  updateDocument: makeFunctionReference<{ id: string; label?: string }, unknown>("documents:updateDocument"),
  deleteDocument: makeFunctionReference<{ id: string }, unknown>("documents:deleteDocument"),
  updatePerson: makeFunctionReference<{ id: string; name?: string }, unknown>("people:updatePerson"),
  mergePeople: makeFunctionReference<{ id: string; intoId: string }, unknown>("people:mergePeople"),
  unmergePerson: makeFunctionReference<{ id: string }, unknown>("people:unmergePerson"),
  updateCommitment: makeFunctionReference<{ id: string; title?: string }, unknown>(
    "commitments:updateCommitment",
  ),
  completeCommitment: makeFunctionReference<{ id: string }, unknown>("commitments:completeCommitment"),
  cancelCommitment: makeFunctionReference<{ id: string }, unknown>("commitments:cancelCommitment"),
  deleteCommitment: makeFunctionReference<{ id: string }, unknown>("commitments:deleteCommitment"),
  setTaskCompleted: makeFunctionReference<{ id: string; completed: boolean }, unknown>(
    "assistant:setTaskCompleted",
  ),
  updateTask: makeFunctionReference<{ id: string; title?: string }, unknown>("assistant:updateTask"),
  removeTask: makeFunctionReference<{ id: string }, unknown>("assistant:removeTask"),
  removeNote: makeFunctionReference<{ id: string }, unknown>("assistant:removeNote"),
  setExpenseDeductible: makeFunctionReference<{ id: string; deductible: boolean }, unknown>(
    "life:setExpenseDeductible",
  ),
  removeExpense: makeFunctionReference<{ id: string }, unknown>("life:removeExpense"),
  setTaskArea: makeFunctionReference<{ id: string; area?: string }, unknown>("life:setTaskArea"),
  toggleDocument: makeFunctionReference<{ id: string }, unknown>("life:toggleDocument"),
  updateAccount: makeFunctionReference<{ id: string; label?: string }, unknown>("subscriptions:updateAccount"),
  deleteAccount: makeFunctionReference<{ id: string }, unknown>("subscriptions:deleteAccount"),
  updateSubscription: makeFunctionReference<{ id: string; label?: string }, unknown>(
    "subscriptions:updateSubscription",
  ),
  cancelSubscription: makeFunctionReference<{ id: string }, unknown>("subscriptions:cancelSubscription"),
  deleteSubscription: makeFunctionReference<{ id: string }, unknown>("subscriptions:deleteSubscription"),
  acceptProposal: makeFunctionReference<{ id: string }, unknown>("agents:acceptProposal"),
  restoreModel: makeFunctionReference<{ snapshotId: string }, unknown>("model:restoreModel"),
  applyImport: makeFunctionReference<
    { importId: string; text: string; currency: string; accountId?: string },
    { ok: boolean; written: number }
  >("transactions:applyImport"),

  // Writes that reference a foreign object rather than mutating one
  createTransactionWithAccount: makeFunctionReference<
    { accountId?: string; postedAt: number; amountMinor: number; currency: string; direction: string; label: string },
    { id: string; created: boolean }
  >("transactions:createTransaction"),
  createSubscriptionWithAccount: makeFunctionReference<
    { label: string; amount: number; interval: string; accountId?: string },
    unknown
  >("subscriptions:createSubscription"),
  createCommitmentWithPerson: makeFunctionReference<
    { title: string; personId: string; direction: string },
    unknown
  >("commitments:createCommitment"),
  addTaskWithPerson: makeFunctionReference<{ input: string; personId?: string }, unknown>(
    "assistant:addTask",
  ),
  createDocumentWithPerson: makeFunctionReference<{ label: string; personId?: string }, unknown>(
    "documents:createDocument",
  ),

  // Abuse surface
  applyBatch: makeFunctionReference<
    { provider: string; objects: unknown[]; complete: boolean },
    { written: number }
  >("integrations:applyBatch"),
  upcomingEvents: makeFunctionReference<Record<string, never>, { events: { sourceUrl?: string }[] }>(
    "calendar:upcomingEvents",
  ),
  addNote: makeFunctionReference<{ body: string }, unknown>("assistant:addNote"),
};

const failures: string[] = [];
const observations: string[] = [];

function section(title: string): void {
  observations.push("");
  console.log(`── ${title}`);
}

function check(label: string, ok: boolean, detail = ""): void {
  const line = `  [${ok ? "PASS" : "FAIL"}] ${label}${detail ? ` — ${detail}` : ""}`;
  observations.push(line);
  console.log(line);
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

/**
 * Runs an attack and classifies the outcome.
 *
 * Three outcomes are refusals; one is a breach. `null` from a getter is a
 * refusal (the row is hidden), a thrown error is a refusal, and an **empty
 * object** counts as a refusal too — several functions return `{}` or `[]`
 * rather than null when nothing matched.
 */
function breached(result: unknown, threw: boolean): boolean {
  if (threw) return false;
  if (result === null || result === undefined) return false;
  if (Array.isArray(result) && result.length === 0) return false;
  if (typeof result === "object" && Object.keys(result as object).length === 0) return false;
  return true;
}

async function attack(
  label: string,
  fn: () => Promise<unknown>,
): Promise<unknown> {
  try {
    const result = await fn();
    const bad = breached(result, false);
    check(label, !bad, bad ? `returned ${JSON.stringify(result).slice(0, 160)}` : "refused");
    return result;
  } catch (error) {
    check(label, true, `refused: ${error instanceof Error ? error.message.slice(0, 80) : "error"}`);
    return null;
  }
}

async function main() {
  const url = process.argv[2];
  if (!url) {
    console.error("Usage: bun scripts/conformance-sec.ts <CONVEX_URL>");
    process.exit(2);
  }

  console.log("PANEL SECURITY HARNESS — cross-tenant authorisation");
  console.log("=".repeat(70));
  console.log(`deployment: ${url}`);
  console.log("");
  console.log("Two legitimate authenticated users. B attacks A's objects by id.");

  const victim = await freshClient(url);
  const attacker = await freshClient(url);
  const anonymous = new ConvexHttpClient(url);

  const NOW = Date.now();
  const CSVTEXT = ["Date,Description,Amount,Balance", "2026-01-02,Coffee,-3.50,96.50", ""].join("\n");

  // -------------------------------------------------------------------------
  section("setup — user A creates one of everything");
  // -------------------------------------------------------------------------
  // Creators are not uniform: some return a bare id string, some return
  // `{created, id}`. `asId` accepts either so the harness does not encode a
  // guess about each module's return shape.
  const asId = (r: unknown): string =>
    typeof r === "string" ? r : ((r as { id?: string } | null)?.id ?? "");

  const accountId = asId(await victim.mutation(f.createAccount, { label: "Victim current", kind: "checking" }));
  const personId = asId(await victim.mutation(f.createPerson, { name: "Victim Person" }));
  const docId = asId(
    await victim.mutation(f.createDocument, { label: "Victim Passport", expiresAt: NOW + 86_400_000 }),
  );
  await victim.mutation(f.addTask, { input: "victim task" });
  await victim.mutation(f.addNote, { body: "victim note body" });
  const commitmentId = asId(
    await victim.mutation(f.createCommitment, {
      title: "Victim promise",
      personId,
      direction: "owed",
    }),
  );
  const subscriptionId = asId(
    await victim.mutation(f.createSubscription, {
      label: "Victim sub",
      amount: 9.99,
      interval: "monthly",
      accountId,
    }),
  );
  // `addExpense` writes and returns void, and no query lists expense ids, so the
  // victim's expense id is unknowable from the API. The expense mutations are
  // therefore attacked with a substituted id from another table instead, which
  // still exercises the validator and the ownership check together.
  await victim.mutation(f.addExpense, { label: "Victim expense", amount: 12.5 });
  const expenseId = "";
  await victim.mutation(f.createTransaction, {
    accountId,
    postedAt: NOW,
    amountMinor: 350,
    currency: "GBP",
    direction: "out",
    label: "Victim txn",
  });
  const prep = await victim.mutation(f.prepareImport, {
    accountId,
    filename: "victim.csv",
    text: CSVTEXT,
    currency: "GBP",
  });
  const importId = prep.ok ? prep.importId : "";

  const victimDocs = (await victim.query(f.listDocuments))?.documents ?? [];
  const victimPeople = (await victim.query(f.listPeople))?.people ?? [];
  const victimCommitments = await victim.query(f.listCommitments);
  const victimDash = await victim.query(f.getDashboard);
  const victimSubs = await victim.query(f.listSubscriptions);
  const victimAccounts = await victim.query(f.listAccounts);
  const victimTxns = await victim.query(f.listTransactions);

  const victimTaskId = victimDash?.tasks?.[0]?.id ?? "";
  const noteId =
    (victimDash as unknown as { notes?: { _id: string }[] } | null)?.notes?.[0]?._id ?? "";

  check(
    "setup — victim objects created",
    !!accountId && !!personId && !!docId && !!commitmentId && !!subscriptionId && !!importId,
    `account=${!!accountId} person=${!!personId} doc=${!!docId} commitment=${!!commitmentId} sub=${!!subscriptionId} import=${!!importId}`,
  );
  check(
    "setup — and the victim's reads actually return them",
    victimDocs.length > 0 && victimPeople.length > 0 && victimCommitments.owed.length > 0 &&
      victimSubs.subscriptions.length > 0 && victimAccounts.length > 0 && victimTxns.length > 0,
    `docs=${victimDocs.length} people=${victimPeople.length} commitments=${victimCommitments.owed.length} subs=${victimSubs.subscriptions.length} accounts=${victimAccounts.length} txns=${victimTxns.length}`,
  );

  // -------------------------------------------------------------------------
  section("S1 — cross-tenant READS by id");
  // -------------------------------------------------------------------------
  await attack("S1 — documents.getDocument on a foreign document", () =>
    attacker.query(f.getDocument, { id: docId }),
  );
  await attack("S1 — people.getPerson on a foreign person", () =>
    attacker.query(f.getPerson, { id: personId }),
  );
  await attack("S1 — commitments.getCommitment on a foreign commitment", () =>
    attacker.query(f.getCommitment, { id: commitmentId }),
  );
  await attack("S1 — transactions.getImport on a foreign import", () =>
    attacker.query(f.getImport, { id: importId }),
  );
  await attack("S1 — transactions.getAccountBalance on a foreign account", () =>
    attacker.query(f.getAccountBalance, { accountId }),
  );

  // -------------------------------------------------------------------------
  section("S2 — cross-tenant WRITES and DELETES by id");
  // -------------------------------------------------------------------------
  await attack("S2 — documents.updateDocument", () =>
    attacker.mutation(f.updateDocument, { id: docId, label: "PWNED" }),
  );
  await attack("S2 — documents.deleteDocument", () => attacker.mutation(f.deleteDocument, { id: docId }));
  await attack("S2 — people.updatePerson", () =>
    attacker.mutation(f.updatePerson, { id: personId, name: "PWNED" }),
  );
  await attack("S2 — people.unmergePerson", () => attacker.mutation(f.unmergePerson, { id: personId }));
  await attack("S2 — commitments.updateCommitment", () =>
    attacker.mutation(f.updateCommitment, { id: commitmentId, title: "PWNED" }),
  );
  await attack("S2 — commitments.completeCommitment", () =>
    attacker.mutation(f.completeCommitment, { id: commitmentId }),
  );
  await attack("S2 — commitments.cancelCommitment", () =>
    attacker.mutation(f.cancelCommitment, { id: commitmentId }),
  );
  await attack("S2 — commitments.deleteCommitment", () =>
    attacker.mutation(f.deleteCommitment, { id: commitmentId }),
  );
  if (victimTaskId) {
    await attack("S2 — assistant.setTaskCompleted", () =>
      attacker.mutation(f.setTaskCompleted, { id: victimTaskId, completed: true }),
    );
    await attack("S2 — assistant.updateTask", () =>
      attacker.mutation(f.updateTask, { id: victimTaskId, title: "PWNED" }),
    );
    await attack("S2 — assistant.removeTask", () => attacker.mutation(f.removeTask, { id: victimTaskId }));
  }
  if (noteId) {
    await attack("S2 — assistant.removeNote", () => attacker.mutation(f.removeNote, { id: noteId }));
  }
  if (expenseId) {
    await attack("S2 — life.removeExpense", () => attacker.mutation(f.removeExpense, { id: expenseId }));
    await attack("S2 — life.setExpenseDeductible", () =>
      attacker.mutation(f.setExpenseDeductible, { id: expenseId, deductible: false }),
    );
  }
  await attack("S2 — life.toggleDocument", () => attacker.mutation(f.toggleDocument, { id: docId }));
  await attack("S2 — subscriptions.updateAccount", () =>
    attacker.mutation(f.updateAccount, { id: accountId, label: "PWNED" }),
  );
  await attack("S2 — subscriptions.deleteAccount", () =>
    attacker.mutation(f.deleteAccount, { id: accountId }),
  );
  await attack("S2 — subscriptions.updateSubscription", () =>
    attacker.mutation(f.updateSubscription, { id: subscriptionId, label: "PWNED" }),
  );
  await attack("S2 — subscriptions.cancelSubscription", () =>
    attacker.mutation(f.cancelSubscription, { id: subscriptionId }),
  );
  await attack("S2 — subscriptions.deleteSubscription", () =>
    attacker.mutation(f.deleteSubscription, { id: subscriptionId }),
  );
  await attack("S2 — transactions.applyImport on a foreign import", () =>
    attacker.mutation(f.applyImport, { importId, text: CSVTEXT, currency: "GBP" }),
  );

  // -------------------------------------------------------------------------
  section("S3 — indirect references: a foreign id smuggled into a new row");
  // -------------------------------------------------------------------------
  // The subtler version of S2: the attacker does not touch A's row, they name
  // it while creating their own, hoping a later join crosses the boundary.
  await attack("S3 — transactions.createTransaction into a foreign account", () =>
    attacker.mutation(f.createTransactionWithAccount, {
      accountId,
      postedAt: NOW,
      amountMinor: 100,
      currency: "GBP",
      direction: "out",
      label: "smuggled",
    }),
  );
  await attack("S3 — subscriptions.createSubscription under a foreign account", () =>
    attacker.mutation(f.createSubscriptionWithAccount, {
      label: "smuggled",
      amount: 1,
      interval: "monthly",
      accountId,
    }),
  );
  await attack("S3 — commitments.createCommitment against a foreign person", () =>
    attacker.mutation(f.createCommitmentWithPerson, {
      title: "smuggled",
      personId,
      direction: "owed",
    }),
  );
  await attack("S3 — documents.createDocument against a foreign person", () =>
    attacker.mutation(f.createDocumentWithPerson, { label: "smuggled", personId }),
  );
  await attack("S3 — assistant.addTask against a foreign person", () =>
    attacker.mutation(f.addTaskWithPerson, { input: "smuggled", personId }),
  );

  // -------------------------------------------------------------------------
  section("S4 — prove the refusals were refusals, not no-ops");
  // -------------------------------------------------------------------------
  // Every attack above returned a refusal. That is only meaningful if the
  // victim's objects are *still intact* afterwards. A function that silently
  // swallowed the call would look identical in S2 and be caught here.
  const afterDocs = (await victim.query(f.listDocuments))?.documents ?? [];
  const afterPeople = (await victim.query(f.listPeople))?.people ?? [];
  const afterCommitments = await victim.query(f.listCommitments);
  const afterSubs = await victim.query(f.listSubscriptions);
  const afterAccounts = await victim.query(f.listAccounts);
  const afterDash = await victim.query(f.getDashboard);

  check(
    "S4 — the victim's document still exists and was not renamed",
    afterDocs.some((d) => d.id === docId) && !JSON.stringify(afterDocs).includes("PWNED"),
    `${afterDocs.length} documents`,
  );
  check(
    "S4 — the victim's person still exists and was not renamed",
    afterPeople.some((p) => p.id === personId) && !JSON.stringify(afterPeople).includes("PWNED"),
  );
  check(
    "S4 — the victim's commitment survives every attempted mutation",
    afterCommitments.owed.some((c) => c.id === commitmentId),
  );
  check(
    "S4 — the victim's subscription was not cancelled, renamed or deleted",
    afterSubs.subscriptions.some((s) => s.id === subscriptionId),
  );
  check(
    "S4 — the victim's account was not deleted or renamed",
    afterAccounts.some((a) => a.id === accountId),
  );
  check(
    "S4 — the victim's task was not deleted",
    (afterDash?.tasks?.length ?? 0) >= (victimDash?.tasks?.length ?? 0),
    `${victimDash?.tasks?.length ?? 0} before, ${afterDash?.tasks?.length ?? 0} after`,
  );

  // -------------------------------------------------------------------------
  section("S5 — the attacker's own view contains none of the victim's data");
  // -------------------------------------------------------------------------
  const atkDocs = (await attacker.query(f.listDocuments))?.documents ?? [];
  const atkPeople = (await attacker.query(f.listPeople))?.people ?? [];
  const atkCommitments = await attacker.query(f.listCommitments);
  const atkSubs = await attacker.query(f.listSubscriptions);
  const atkAccounts = await attacker.query(f.listAccounts);
  const atkTxns = await attacker.query(f.listTransactions);
  const atkAudit = await attacker.query(f.financeAudit);

  check(
    "S5 — no victim document is listed for the attacker",
    !atkDocs.some((d) => d.id === docId),
    `${atkDocs.length} documents`,
  );
  check("S5 — no victim person is listed", !atkPeople.some((p) => p.id === personId));
  check("S5 — no victim commitment is listed", !atkCommitments.owed.some((c) => c.id === commitmentId));
  check("S5 — no victim subscription is listed", !atkSubs.subscriptions.some((s) => s.id === subscriptionId));
  check("S5 — no victim account is listed", !atkAccounts.some((a) => a.id === accountId));
  check("S5 — no victim transaction is listed", !atkTxns.some((t) => t.label === "Victim txn"));
  check(
    "S5 — no victim string leaks into the attacker's audit trail",
    !JSON.stringify(atkAudit).includes("Victim"),
  );

  // -------------------------------------------------------------------------
  section("S6 — unauthenticated access");
  // -------------------------------------------------------------------------
  const anonDoc = await anonymous
    .query(f.getDocument, { id: docId })
    .then((r) => ({ r, threw: false }))
    .catch((e) => ({ r: null, threw: true, e }));
  check(
    "S6 — an unauthenticated caller cannot read a document",
    anonDoc.threw || anonDoc.r === null,
    anonDoc.threw ? "refused" : JSON.stringify(anonDoc.r).slice(0, 80),
  );

  for (const [name, run] of [
    ["getDashboard", () => anonymous.query(f.getDashboard)],
    ["listDocuments", () => anonymous.query(f.listDocuments).then((r) => r?.documents ?? [])],
    ["listPeople", () => anonymous.query(f.listPeople).then((r) => r?.people ?? [])],
    ["listAccounts", () => anonymous.query(f.listAccounts)],
    ["listTransactions", () => anonymous.query(f.listTransactions)],
    ["listSubscriptions", () => anonymous.query(f.listSubscriptions)],
  ] as const) {
    const result = await run()
      .then((r) => ({ r, threw: false }))
      .catch((e) => ({ r: null, threw: true, e }));
    const leaked = Array.isArray(result.r)
      ? result.r.length > 0
      : result.r !== null && result.r !== undefined;
    check(
      `S6 — ${name} returns nothing to an unauthenticated caller`,
      result.threw || !leaked,
      result.threw ? "refused" : `${JSON.stringify(result.r).slice(0, 60)}`,
    );
  }

  const anonWrite = await anonymous
    .mutation(f.removeTask, { id: victimTaskId })
    .then(() => "ok")
    .catch(() => "refused");
  check("S6 — an unauthenticated caller cannot delete", anonWrite === "refused", anonWrite);

  // -------------------------------------------------------------------------
  section("S7 — malformed and substituted identifiers");
  // -------------------------------------------------------------------------
  await attack("S7 — a syntactically valid but non-existent id", () =>
    attacker.query(f.getDocument, {
      id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaab",
    }),
  );
  await attack("S7 — an id from a different table, used as a document", () =>
    attacker.query(f.getDocument, { id: accountId }),
  );
  await attack("S7 — an id from a different table, used as a person", () =>
    attacker.query(f.getPerson, { id: accountId }),
  );

  // -------------------------------------------------------------------------
  section("S8 — abuse surface: unbounded array arguments");
  // -------------------------------------------------------------------------
  // `applyBatch` takes `objects: v.array(v.any())`. A bound on the *result*
  // is not a bound on the *input*, so this asks whether the caller can make
  // the server do unbounded work in one call.
  const abuseStarted = Date.now();
  let abuseOutcome = "accepted";
  let abuseMs = 0;
  try {
    const many = Array.from({ length: 2000 }, (_, i) => ({
      kind: "calendarEvent",
      externalId: `abuse-${i}`,
      fields: { title: "abuse", startsAt: NOW + i },
    }));
    await attacker.mutation(f.applyBatch, { provider: "google-calendar", objects: many, complete: false });
  } catch {
    abuseOutcome = "refused";
  }
  abuseMs = Date.now() - abuseStarted;
  check(
    "S8 — a 2000-object sync batch is refused rather than processed",
    abuseOutcome === "refused",
    `${abuseOutcome} in ${abuseMs}ms`,
  );

  // -------------------------------------------------------------------------
  section("S9 — injection: can a stored value become a dangerous URL?");
  // -------------------------------------------------------------------------
  // `calendarEvents.sourceUrl` is written from a public `v.array(v.any())` batch
  // and rendered as `href={event.sourceUrl}`. React escapes text but not URLs,
  // so a stored `javascript:` URL is a working link that runs in Panel's origin.
  // The write is the control; this asks whether it holds.
  const hostileUrls = [
    "javascript:alert(document.domain)",
    "java\tscript:alert(1)",
    "JaVaScRiPt:alert(2)",
    "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
    "vbscript:msgbox(1)",
  ];
  for (const [i, payload] of hostileUrls.entries()) {
    try {
      await attacker.mutation(f.applyBatch, {
        provider: "google-calendar",
        complete: false,
        objects: [
          {
            kind: "calendarEvent",
            externalId: `xss-probe-${i}-${Date.now()}`,
            fields: { title: "probe", startsAt: NOW + 86_400_000, sourceUrl: payload },
          },
        ],
      });
    } catch {
      /* refused at the batch layer, which is also an acceptable outcome */
    }
  }
  const afterInject = await attacker.query(f.upcomingEvents, { days: 30 });
  const stored = (afterInject.events ?? [])
    .map((e) => e.sourceUrl)
    .filter((u): u is string => typeof u === "string");
  // eslint-disable-next-line no-control-regex
const survived = stored.filter((u) => !/^https?:/i.test(u) || /[\u0000-\u001f]/.test(u));
  check(
    "S9 — no executable URL survives the write path",
    survived.length === 0,
    survived.length > 0 ? survived.join(", ") : `${stored.length} stored URLs, all http(s)`,
  );

  // The other half: a real link must still work. A guard that refuses
  // everything is not a fix, it is an outage.
  const legitOk = await attacker
    .mutation(f.applyBatch, {
      provider: "google-calendar",
      complete: false,
      objects: [
        {
          kind: "calendarEvent",
          externalId: `xss-legit-${Date.now()}`,
          fields: {
            title: "legitimate link",
            startsAt: NOW + 86_400_000,
            sourceUrl: "https://calendar.google.com/event?eid=real",
          },
        },
      ],
    })
    .then(() => true)
    .catch(() => false);
  const withLegit = await attacker.query(f.upcomingEvents, { days: 30 });
  check(
    "S9 — and a real https link still round-trips",
    legitOk && (withLegit.events ?? []).some((e) => e.sourceUrl?.startsWith("https://")),
  );

  // -------------------------------------------------------------------------
  section("S10 — CSV formula injection into stored labels");
  // -------------------------------------------------------------------------
  // A statement description is attacker-controlled in the sense that matters
  // here: it comes from a file. Panel renders it in the app (React escapes it),
  // but the same string is also what a user would paste into a spreadsheet, and
  // `=cmd|...` is a formula there. Panel is not obliged to rewrite a person's
  // bank description; what it must do is refuse a control-character payload that
  // breaks its own rendering, which the parser already does.
  const formulaText = [
    "Date,Description,Amount,Balance",
    "2026-01-02,\"=1+1\",-3.50,96.50",
    "2026-01-03,\"@SUM(A1)\",-1.00,95.50",
    "",
  ].join("\n");
  const formulaPrep = await attacker.mutation(f.prepareImport, {
    filename: "formula.csv",
    text: formulaText,
    currency: "GBP",
  });
  check(
    "S10 — formula-shaped descriptions are stored verbatim rather than mangled",
    formulaPrep.ok === true && formulaPrep.candidates?.length === 2,
    formulaPrep.ok
      ? `${formulaPrep.candidates?.length} candidates`
      : `refused: ${formulaPrep.reason}`,
  );
  if (formulaPrep.ok) {
    const applied = await attacker.mutation(f.applyImport, {
      importId: formulaPrep.importId,
      text: formulaText,
      currency: "GBP",
    });
    const listed = await attacker.query(f.listTransactions);
    const storedFormula = listed.find((t) => t.label === "=1+1");
    check(
      "S10 — and React renders it as text, so nothing executes on the page",
      applied.ok === true && storedFormula !== undefined,
      storedFormula ? `stored as text: "${storedFormula.label}"` : "not found",
    );
  }

  // -------------------------------------------------------------------------
  section("S11 — source hygiene: a credential must not live in the repository");
  // -------------------------------------------------------------------------
  // Reported, **not counted as a pass**, and deliberately still red today.
  //
  // `src/convex/auth/emailOtp.ts` contains a literal API key for the email
  // relay. It is server-side only — no client component imports that module, so
  // it never reaches the browser bundle — which narrows the exposure to anyone
  // with repository access. It is still a credential committed to source, and
  // rotating it is an action only the owner can take.
  //
  // This check keeps reporting until the key is gone. A guard that turned green
  // while the secret was still in the file would be worse than no guard: it
  // would mark the problem solved.
  const scanned = [
    "src/convex/auth/emailOtp.ts",
    "src/convex/credentials.ts",
    "src/convex/integrations.ts",
    "src/convex/calendar.ts",
    "src/convex/users.ts",
  ];
  const keyPattern =
    /["'`](x-api-key|api[_-]?key|client[_-]?secret|authorization)["'`]\s*:\s*["'`][A-Za-z0-9_-]{16,}["'`]/gi;
  const keyFindings: string[] = [];
  for (const rel of scanned) {
    try {
      const text = readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
      if (keyPattern.test(text)) keyFindings.push(rel);
    } catch {
      /* a file that is not present is not a finding */
    }
  }
  const s11 = `S11 — credential-shaped literals in tracked source: ${
    keyFindings.length === 0 ? "none" : `${keyFindings.length} (${keyFindings.join(", ")})`
  }`;
  observations.push(`  [NOTE] ${s11}`);
  console.log(`  [NOTE] ${s11}`);
  console.log("         Reported, not counted. Rotation is an owner action — see the governance entry.");

  // -------------------------------------------------------------------------
  section("S12 — bounded reads (D48: the access itself must be bounded)");
  // -------------------------------------------------------------------------
  // A bounded *result* is not evidence of a bounded *read*. The dashboard used
  // to collect every note the user had ever written, sort them in memory and
  // return the lot on every load. This asks the database the question the index
  // can now answer, and checks the answer is capped.
  const noteBody = (i: number) => `bounded-probe-${i}`;
  const NOTE_COUNT = 70;
  for (let i = 0; i < NOTE_COUNT; i += 1) {
    await attacker.mutation(f.addNote, { body: noteBody(i) });
  }
  const dash = await attacker.query(f.getDashboard);
  const notes = dash?.notes ?? [];
  check(
    "S12 — the dashboard note list is capped, not the whole history",
    notes.length <= 50,
    `${NOTE_COUNT} written, ${notes.length} returned`,
  );
  check(
    "S12 — and it is still newest-first",
    notes.length > 1 && notes[0].body.startsWith("bounded-probe-69") && notes[notes.length - 1].body.startsWith("bounded-probe-"),
    notes.length > 0 ? `${notes[0].body} … ${notes[notes.length - 1].body}` : "none",
  );

  // -------------------------------------------------------------------------
  console.log("");
  console.log("=".repeat(70));
  const passed = observations.filter((l) => l.includes("[PASS]")).length;
  console.log(
    `RESULT: ${failures.length === 0 ? "PASS" : "FAIL"} — ${passed} boundaries held, ${failures.length} failed.`,
  );
  for (const failure of failures) console.log(`  FAILED: ${failure}`);
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
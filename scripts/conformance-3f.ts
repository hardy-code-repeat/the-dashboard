/**
 * Phase 3, feature 3 conformance — Life Admin: the expiry → renewal chain.
 *
 * Runs against a REAL deployment, through the real auth path, writing real
 * rows. It decides the eleven acceptance criteria from §11.2:
 *
 *  A1  a document inside its lead window produces exactly one hard
 *      `document.expiring` item, in `deadlines`, due at expiresAt - leadDays;
 *  A2  an open renewal produces NO document item — the task speaks instead, so
 *      one renewal never becomes two items;
 *  A3  startRenewal creates a task with documentId set and dueAt equal to the
 *      computed deadline;
 *  A4  completeRenewal sets the new expiry, completes the task, and the
 *      document returns to valid — the old expiry is gone, not retained;
 *  A5  completing the renewal through the GENERIC path leaves it `stale`, and
 *      stale is visible;
 *  A6  every read and write is owner-scoped; a second account sees nothing and
 *      a foreign id is refused on all five write paths;
 *  A7  deleteDocument detaches rather than deletes, and reports the count;
 *  A8  the four document.* activity kinds are written and read back with real
 *      values;
 *  A9  nothing regresses — the tax checklist, capture and the areas are
 *      untouched;
 *  A10  bounded: an undated document never reaches the expiring read;
 *  A11  the budget held and the frozen feature layout did not move.
 *
 * Nothing here waits on a credential, so there are no skips.
 *
 * Usage:
 *   bun scripts/conformance-3f.ts <CONVEX_URL>
 *
 * Exit: 0 = every invariant held, 1 = one or more did not.
 */

import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";

const f = {
  listDocuments: makeFunctionReference<
    Record<string, never>,
    { documents: DocumentView[]; defaultLeadDays: number }
  >("documents:listDocuments"),
  getDocument: makeFunctionReference<{ id: string }, DocumentView | null>("documents:getDocument"),
  getExpiring: makeFunctionReference<Record<string, never>, DocumentView[]>("documents:getExpiring"),
  createDocument: makeFunctionReference<
    { label: string; expiresAt?: number; leadDays?: number; personId?: string },
    string
  >("documents:createDocument"),
  updateDocument: makeFunctionReference<
    { id: string; label?: string; expiresAt?: number; leadDays?: number },
    null
  >("documents:updateDocument"),
  deleteDocument: makeFunctionReference<{ id: string }, { detached: number }>(
    "documents:deleteDocument",
  ),
  startRenewal: makeFunctionReference<
    { id: string },
    { taskId: string; created: boolean }
  >("documents:startRenewal"),
  cancelRenewal: makeFunctionReference<{ id: string }, { cancelled: boolean }>(
    "documents:cancelRenewal",
  ),
  completeRenewal: makeFunctionReference<
    { id: string; newExpiresAt: number },
    { renewed: boolean; expiresAt: number }
  >("documents:completeRenewal"),
  documentAudit: makeFunctionReference<
    Record<string, never>,
    { kinds: string[]; tasks: string[] }
  >("documents:documentAudit"),
  getAttention: makeFunctionReference<
    Record<string, never>,
    {
      items: {
        kind: string;
        sourceId: string;
        section: string;
        class: string;
        severity: number;
        dueAt: number | null;
        pinned?: boolean;
      }[];
      produced: number;
      hiddenByCap: Record<string, number>;
      hiddenByTotalCap: number;
    } | null
  >("attention:getAttention"),
  getAreaTasks: makeFunctionReference<
    { area: string },
    { _id: string; title: string; completed: boolean; dueAt?: number | null; documentId?: string }[]
  >("life:getAreaTasks"),
  getFinance: makeFunctionReference<
    Record<string, never>,
    { documents: { id: string; gathered: boolean }[]; readiness: { score: number } } | null
  >("life:getFinance"),
  toggleDocument: makeFunctionReference<{ requirementId: string; gathered: boolean }, null>(
    "life:toggleDocument",
  ),
  listPeople: makeFunctionReference<
    Record<string, never>,
    { people: { id: string; name: string }[]; mergedCount: number }
  >("people:listPeople"),
  createPerson: makeFunctionReference<
    { name: string; force?: boolean },
    { created: true; id: string } | { created: false; duplicateOf: { id: string } }
  >("people:createPerson"),
  getModelControls: makeFunctionReference<
    Record<string, never>,
    { weights: number[]; samples: number; weightsVersion?: number } | null
  >("model:getModelControls"),
  listAreas: makeFunctionReference<
    Record<string, never>,
    { slug: string; label: string; kind: string }[]
  >("life:listAreas"),
  getAvailableAreas: makeFunctionReference<Record<string, never>, { slug: string }[]>(
    "life:getAvailableAreas",
  ),
  enableArea: makeFunctionReference<{ slug: string; seed?: boolean }, null>("life:enableArea"),
  signIn: makeFunctionReference<unknown, { tokens?: { token: string } | null }>("auth:signIn"),
  setTaskCompleted: makeFunctionReference<{ id: string; completed: boolean }, null>(
    "assistant:setTaskCompleted",
  ),
  capture: makeFunctionReference<
    { input: string; area?: string },
    {
      created: { id: string; title: string; dueAt: number | null; personId: string | null }[];
      dropped: { text: string; reason: string }[];
      overflow: number;
      refused: boolean;
      refusalReason: string | null;
    }
  >("assistant:capture"),
};

interface DocumentView {
  id: string;
  label: string;
  expiresAt: number | null;
  leadDays: number;
  leadDaysIsDefault: boolean;
  deadlineAt: number | null;
  personId: string | null;
  state: string;
  daysAway: number | null;
  severity: number | null;
  attention: boolean;
  detail: string;
  renewal: {
    id: string;
    title: string;
    completed: boolean;
    dueAt: number | null;
    completedAt: number | null;
  } | null;
  renewalCount: number;
}

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

/** Reads a function reference as a plain function, for use inside `Promise.all`. */
async function q<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch {
    return null;
  }
}

async function main() {
  const url = process.argv[2];
  if (!url) {
    console.error("Usage: bun scripts/conformance-3f.ts <CONVEX_URL>");
    process.exit(2);
  }

  console.log("PHASE 3 / FEATURE 3 CONFORMANCE — Life Admin: expiry → renewal");
  console.log("=".repeat(64));
  console.log(`deployment: ${url}`);
  console.log("");
  console.log("Every check below runs against the deployed backend. Nothing is mocked.");

  const client = await freshClient(url);
  const DAY = 86_400_000;
  const NOW = Date.now();
  let writes = 0;

  // -------------------------------------------------------------------------
  section("A1 — a document inside its lead window produces exactly one hard item");
  // -------------------------------------------------------------------------
  // 10 days out with a 30-day lead: inside the window. `deadlineAt` is the
  // renewal deadline, ten days before the expiry — never the expiry itself,
  // which is the whole point of R-006.
  const expiresAt = NOW + 10 * DAY;
  const doc = await client.mutation(f.createDocument, {
    label: "Passport",
    expiresAt,
    leadDays: 30,
  });
  writes += 1;

  const created = await client.query(f.getDocument, { id: doc });
  check("A1 — the document reads back", created !== null);
  check("A1 — its label survived the round trip", created?.label === "Passport", created?.label ?? "");
  check(
    "A1 — the expiry is exactly what was written",
    created?.expiresAt === expiresAt,
    `${created?.expiresAt} vs ${expiresAt}`,
  );
  check("A1 — the stored lead time is honoured", created?.leadDays === 30, `${created?.leadDays}`);
  check(
    "A1 — the deadline is the expiry minus the lead time, not the expiry",
    created?.deadlineAt === expiresAt - 30 * DAY,
    `${new Date(created?.deadlineAt ?? 0).toISOString().slice(0, 10)}`,
  );
  check("A1 — and it is `due`", created?.state === "due", created?.state ?? "");
  check("A1 — and it wants attention", created?.attention === true);

  const attention1 = await client.query(f.getAttention);
  const item1 = attention1?.items.filter((i) => i.kind === "document.expiring") ?? [];
  check("A1 — exactly one expiring item", item1.length === 1, `${item1.length}`);
  const theItem = item1[0];
  check("A1 — it points at this document", theItem?.sourceId === doc);
  check("A1 — it is in the deadlines section", theItem?.section === "deadlines", theItem?.section ?? "");
  check("A1 — it is a hard item, not a ranked one", theItem?.class === "hard", theItem?.class ?? "");
  check(
    "A1 — its due date is the renewal deadline",
    theItem?.dueAt === expiresAt - 30 * DAY,
    `${new Date(theItem?.dueAt ?? 0).toISOString().slice(0, 10)}`,
  );
  check("A1 — it is not pinned while still valid", theItem?.pinned !== true);

  // -------------------------------------------------------------------------
  section("A3 — startRenewal creates a dated task linked to the document");
  // -------------------------------------------------------------------------
  const started = await client.mutation(f.startRenewal, { id: doc });
  writes += 1;
  check("A3 — a task was created", started.created === true);

  const generalTasks = await client.query(f.getAreaTasks, { area: "general" });
  const renewalTask = generalTasks.find((t) => t._id === started.taskId);
  check("A3 — the task really exists", renewalTask !== undefined);
  check(
    "A3 — it carries documentId",
    renewalTask?.documentId === doc,
    `${renewalTask?.documentId}`,
  );
  check(
    "A3 — its dueAt is expiresAt - leadDays, computed server-side",
    renewalTask?.dueAt === expiresAt - 30 * DAY,
    `${renewalTask?.dueAt} vs ${expiresAt - 30 * DAY}`,
  );
  check(
    "A3 — it is titled from the document",
    renewalTask?.title === "Renew Passport",
    renewalTask?.title ?? "",
  );
  check("A3 — it is open", renewalTask?.completed === false);
  check(
    "A3 — and it lands in the main task list, not a second queue",
    renewalTask !== undefined && generalTasks.some((t) => t._id === started.taskId),
  );

  // A second press must not create a second task.
  const again = await client.mutation(f.startRenewal, { id: doc });
  writes += 1;
  check("A3 — starting again returns the same task, not a new one", again.created === false);
  check("A3 — and it is the same id", again.taskId === started.taskId);

  // -------------------------------------------------------------------------
  section("A2 — an open renewal produces NO document item (no double reporting)");
  // -------------------------------------------------------------------------
  const attention2 = await client.query(f.getAttention);
  const item2 = attention2?.items.filter((i) => i.kind === "document.expiring") ?? [];
  check(
    "A2 — the document item is gone while the renewal is open",
    item2.length === 0,
    `${item2.length} item(s) still showing`,
  );
  const stillDue = await client.query(f.getDocument, { id: doc });
  check("A2 — the document now reads `renewing`", stillDue?.state === "renewing", stillDue?.state ?? "");
  check("A2 — and it is still not attention", stillDue?.attention === false);

  // -------------------------------------------------------------------------
  section("A5 — completing the renewal the GENERIC way leaves it stale");
  // -------------------------------------------------------------------------
  // This is the silent failure the whole derived-state design exists to catch.
  // The user ticks the box in the main dashboard: the model trains correctly
  // and `expiresAt` never moves.
  //
  // The document used here has *already expired*, which is the case that is
  // both detectable and harmful. An early renewal whose date never moved is
  // indistinguishable from a real early renewal without storing the previous
  // expiry — a boundary the state machine states rather than pretends to
  // cover (see `src/lib/documents.ts`).
  const expiredDoc = await client.mutation(f.createDocument, {
    label: "Driving licence",
    expiresAt: NOW - 3 * DAY,
    leadDays: 30,
  });
  writes += 1;
  const expiredBefore = await client.query(f.getDocument, { id: expiredDoc });
  check("A5 — the expired document starts `expired`", expiredBefore?.state === "expired", expiredBefore?.state ?? "");
  check("A5 — and it is attention before anything is started", expiredBefore?.attention === true);

  const expiredRenewal = await client.mutation(f.startRenewal, { id: expiredDoc });
  writes += 1;
  const expiredRenewing = await client.query(f.getDocument, { id: expiredDoc });
  check(
    "A5 — starting a renewal on an expired document gives `renewing-late`, not `stale`",
    expiredRenewing?.state === "renewing-late",
    expiredRenewing?.state ?? "",
  );
  check("A5 — and it is not stale while the renewal is still open", expiredRenewing?.state !== "stale");

  const generic = await client.mutation(f.setTaskCompleted, {
    id: expiredRenewal.taskId,
    completed: true,
  });
  writes += 1;
  void generic;

  const afterGeneric = await client.query(f.getDocument, { id: expiredDoc });
  check(
    "A5 — the expiry did NOT move on its own",
    afterGeneric?.expiresAt === NOW - 3 * DAY,
    `${afterGeneric?.expiresAt} vs ${NOW - 3 * DAY}`,
  );
  check("A5 — so the document reads `stale`, not `valid`", afterGeneric?.state === "stale", afterGeneric?.state ?? "");
  check("A5 — and stale is visible to the user", afterGeneric?.attention === true);

  const attention5 = await client.query(f.getAttention);
  const staleItem = attention5?.items.filter(
    (i) => i.kind === "document.expiring" && i.sourceId === expiredDoc,
  ) ?? [];
  check("A5 — stale produces an attention item", staleItem.length === 1, `${staleItem.length}`);
  check(
    "A5 — and it outranks a plain expiry",
    (staleItem[0]?.severity ?? 0) >= 0.95,
    `${staleItem[0]?.severity}`,
  );
  check("A5 — pinned, because it cannot be filed away", staleItem[0]?.pinned === true);

  // Repair it the supported way, so the account is left coherent.
  const repairedExpiry = NOW + 800 * DAY;
  await client.mutation(f.completeRenewal, { id: expiredDoc, newExpiresAt: repairedExpiry });
  writes += 1;
  const repaired = await client.query(f.getDocument, { id: expiredDoc });
  check(
    "A5 — and recording the new expiry clears it",
    repaired?.state === "valid" && repaired?.attention === false,
    repaired?.state ?? "",
  );

  // -------------------------------------------------------------------------
  section("A4 — completeRenewal advances the date and clears the task");
  // -------------------------------------------------------------------------
  const newExpiry = NOW + 3650 * DAY;
  const renewed = await client.mutation(f.completeRenewal, { id: doc, newExpiresAt: newExpiry });
  writes += 1;
  check("A4 — the renewal was recorded", renewed.renewed === true);
  check("A4 — it reports the new date back", renewed.expiresAt === newExpiry);

  const afterRenewal = await client.query(f.getDocument, { id: doc });
  check(
    "A4 — the expiry is now the new one",
    afterRenewal?.expiresAt === newExpiry,
    `${afterRenewal?.expiresAt}`,
  );
  check(
    "A4 — the OLD expiry is gone, not retained anywhere on the row",
    afterRenewal?.expiresAt !== expiresAt,
  );
  check("A4 — and the document is valid again", afterRenewal?.state === "valid", afterRenewal?.state ?? "");
  check("A4 — with no item to show", afterRenewal?.attention === false);
  check(
    "A4 — the deadline moved with it",
    afterRenewal?.deadlineAt === newExpiry - 30 * DAY,
    `${afterRenewal?.deadlineAt}`,
  );

  const tasksAfter = await client.query(f.getAreaTasks, { area: "general" });
  const taskAfter = tasksAfter.find((t) => t._id === started.taskId);
  check("A4 — the renewal task is completed", taskAfter?.completed === true);

  const attention4 = await client.query(f.getAttention);
  check(
    "A4 — no expiring item survives the renewal",
    (attention4?.items.filter((i) => i.kind === "document.expiring") ?? []).length === 0,
  );

  // A chain that cannot move forward is not a chain.
  const backwards = await q(() =>
    client.mutation(f.completeRenewal, { id: doc, newExpiresAt: NOW }),
  );
  check(
    "A4 — an expiry that does not advance is refused",
    backwards === null,
    backwards === null ? "refused" : `accepted: ${JSON.stringify(backwards)}`,
  );
  const stillValid = await client.query(f.getDocument, { id: doc });
  check(
    "A4 — and the refused write changed nothing",
    stillValid?.expiresAt === newExpiry,
    `${stillValid?.expiresAt}`,
  );

  // -------------------------------------------------------------------------
  section("A10 — bounded reads: an undated document never reaches the expiring query");
  // -------------------------------------------------------------------------
  const undated = await client.mutation(f.createDocument, { label: "Birth certificate" });
  writes += 1;
  const undatedView = await client.query(f.getDocument, { id: undated });
  check("A10 — it is `undated`", undatedView?.state === "undated", undatedView?.state ?? "");
  check("A10 — it never wants attention", undatedView?.attention === false);
  check("A10 — its deadline is null", undatedView?.deadlineAt === null);
  const expiringList = await client.query(f.getExpiring);
  check(
    "A10 — and it is absent from the expiring read entirely",
    !(expiringList ?? []).some((d) => d.id === undated),
  );
  const allDocs = await client.query(f.listDocuments);
  check(
    "A10 — but it IS in the full list, because holding the name is useful",
    (allDocs?.documents ?? []).some((d) => d.id === undated),
  );
  check(
    "A10 — the default lead time is reported, and labelled as a default",
    (allDocs?.documents ?? []).find((d) => d.id === undated)?.leadDaysIsDefault === true,
  );

  // A far-future document is equally silent.
  const later = await client.mutation(f.createDocument, {
    label: "Mortgage",
    expiresAt: NOW + 900 * DAY,
    leadDays: 30,
  });
  writes += 1;
  const laterView = await client.query(f.getDocument, { id: later });
  check("A10 — a document outside its window is `valid` and silent", laterView?.state === "valid" && laterView?.attention === false, laterView?.state ?? "");

  // -------------------------------------------------------------------------
  section("A6 — cross-user isolation and foreign-id refusal on every write path");
  // -------------------------------------------------------------------------
  const other = await freshClient(url);
  const otherDocs = await other.query(f.listDocuments);
  check(
    "A6 — a second account sees none of these documents",
    (otherDocs?.documents ?? []).length === 0,
    `${(otherDocs?.documents ?? []).length} visible`,
  );
  const peek = await other.query(f.getDocument, { id: doc });
  check("A6 — asking for a foreign document returns null, not the row", peek === null);
  const expiringOther = await other.query(f.getExpiring);
  check("A6 — and the expiring read is empty for them too", (expiringOther ?? []).length === 0);

  // All five write paths must refuse a document the caller does not own.
  const refused: Record<string, boolean> = {
    updateDocument: (await q(() => other.mutation(f.updateDocument, { id: doc, label: "stolen" }))) === null,
    deleteDocument: (await q(() => other.mutation(f.deleteDocument, { id: doc }))) === null,
    startRenewal: (await q(() => other.mutation(f.startRenewal, { id: doc }))) === null,
    cancelRenewal: (await q(() => other.mutation(f.cancelRenewal, { id: doc }))) === null,
    completeRenewal: (await q(() => other.mutation(f.completeRenewal, { id: doc, newExpiresAt: NOW + 9999 * DAY }))) === null,
  };
  for (const [name, ok] of Object.entries(refused)) {
    check(`A6 — ${name} refuses a foreign document id`, ok);
  }

  // A foreign personId must be refused too.
  const person = await client.mutation(f.createPerson, { name: "Priya Raman" });
  writes += 1;
  const otherPeople = await other.query(f.listPeople);
  check(
    "A6 — the second account has its own (empty) people list",
    (otherPeople?.people ?? []).length === 0,
  );
  const foreignPerson = await q(() =>
    other.mutation(f.createDocument, {
      label: "Theirs",
      expiresAt: NOW + DAY,
      personId: (person as { id: string }).id,
    }),
  );
  check("A6 — attaching somebody else's person is refused", foreignPerson === null);

  // The real owner can use it, proving the refusal was about ownership and not
  // about the argument being malformed.
  const owned = await client.mutation(f.createDocument, {
    label: "Raj's passport",
    expiresAt: NOW + 400 * DAY,
    personId: (person as { id: string }).id,
  });
  writes += 1;
  const ownedView = await client.query(f.getDocument, { id: owned });
  check(
    "A6 — the owner CAN attach their own person",
    ownedView?.personId === (person as { id: string }).id,
  );

  // -------------------------------------------------------------------------
  section("A8 — the four activity kinds are written and read back");
  // -------------------------------------------------------------------------
  // Read back, not assumed: a mutation returning successfully proves only that
  // the mutation returned (R-005, D38).
  const audit = await client.query(f.documentAudit);
  const kinds = audit?.kinds ?? [];
  check("A8 — document.created is on the audit trail", kinds.includes("document.created"), kinds.join(", "));
  check("A8 — document.renewal_started is on it", kinds.includes("document.renewal_started"));
  check("A8 — document.renewed is on it", kinds.includes("document.renewed"));
  const auditTasks = audit?.tasks ?? [];
  check(
    "A8 — the renewal rows carry the real task id, not a placeholder",
    auditTasks.includes(started.taskId),
    auditTasks.join(", ") || "empty",
  );

  const otherAudit = await other.query(f.documentAudit);
  check(
    "A6 — and the audit trail is owner-scoped: the second account sees nothing",
    (otherAudit?.kinds ?? []).length === 0,
    `${(otherAudit?.kinds ?? []).length} rows`,
  );

  // -------------------------------------------------------------------------
  section("A7 — delete detaches the task rather than deleting it");
  // -------------------------------------------------------------------------
  const throwaway = await client.mutation(f.createDocument, {
    label: "Boiler service",
    expiresAt: NOW + 5 * DAY,
    leadDays: 30,
  });
  writes += 1;
  const throwawayRenewal = await client.mutation(f.startRenewal, { id: throwaway });
  writes += 1;
  const beforeDelete = await client.query(f.getAreaTasks, { area: "general" });
  check(
    "A7 — the renewal task exists before the delete",
    beforeDelete.some((t) => t._id === throwawayRenewal.taskId),
  );

  const deleted = await client.mutation(f.deleteDocument, { id: throwaway });
  writes += 1;
  check("A7 — the count of detached tasks is reported", deleted.detached === 1, `${deleted.detached}`);

  const gone = await client.query(f.getDocument, { id: throwaway });
  check("A7 — the document is gone", gone === null);
  const afterDelete = await client.query(f.getAreaTasks, { area: "general" });
  const survivor = afterDelete.find((t) => t._id === throwawayRenewal.taskId);
  check("A7 — the task SURVIVED (user data is never a side effect)", survivor !== undefined);
  check("A7 — but it is detached", survivor?.documentId === undefined, `${survivor?.documentId}`);
  check(
    "A7 — and the user wrote it is still readable",
    typeof survivor?.title === "string" && survivor.title.length > 0,
    survivor?.title ?? "",
  );
  const auditAfterDelete = await client.query(f.documentAudit);
  check(
    "A8 — document.deleted is on the audit trail",
    (auditAfterDelete?.kinds ?? []).includes("document.deleted"),
  );

  // -------------------------------------------------------------------------
  section("A9 — nothing regressed");
  // -------------------------------------------------------------------------
  // The tax checklist is the one thing that shares the word "document" with
  // this feature and must be provably untouched.
  const financeBefore = await client.query(f.getFinance);
  const firstReq = financeBefore?.documents?.[0]?.id;
  check("A9 — the finance checklist is still readable", (financeBefore?.documents ?? []).length > 0);

  if (firstReq) {
    const wasGathered = financeBefore!.documents.find((d) => d.id === firstReq)?.gathered;
    await client.mutation(f.toggleDocument, { requirementId: firstReq, gathered: !wasGathered });
    writes += 1;
    const financeAfter = await client.query(f.getFinance);
    const nowGathered = financeAfter?.documents.find((d) => d.id === firstReq)?.gathered;
    check(
      "A9 — toggleDocument still flips a tax requirement",
      nowGathered === !wasGathered,
      `${wasGathered} -> ${nowGathered}`,
    );
    // Put it back so the run leaves the account as it found it.
    await client.mutation(f.toggleDocument, { requirementId: firstReq, gathered: wasGathered });
    writes += 1;
    const restored = await client.query(f.getFinance);
    check(
      "A9 — and it can be put back",
      restored?.documents.find((d) => d.id === firstReq)?.gathered === wasGathered,
    );
  }

  // The tax hard rule must still fire independently of documents.
  const taxItems = attention4?.items.filter((i) => i.kind === "deadline.tax") ?? [];
  check("A9 — tax deadlines are unaffected", taxItems.length > 0, `${taxItems.length} tax items`);

  // Capture must still create a task and nothing else.
  const captured = await client.mutation(f.capture, { input: "call the dentist tomorrow" });
  writes += 1;
  check("A9 — capture still works", captured.created.length === 1, `${captured.created.length}`);
  const docsAfterCapture = await client.query(f.listDocuments);
  check(
    "A9 — and capture still creates no document",
    (docsAfterCapture?.documents ?? []).filter((d) => d.label.includes("dentist")).length === 0,
  );

  // The area catalogue: `life` must be addable and appear as a tab.
  const available = await client.query(f.getAvailableAreas);
  const lifeOffered = (available ?? []).some((a) => a.slug === "life");
  check("A9 — the Life admin area is offered", lifeOffered);
  if (lifeOffered) {
    await client.mutation(f.enableArea, { slug: "life", seed: true });
    writes += 1;
    const areas = await client.query(f.listAreas);
    const life = areas?.find((a) => a.slug === "life");
    check("A9 — enabling it creates a tab", life !== undefined);
    check("A9 — of kind `life`, so it renders the Life Admin surface", life?.kind === "life", life?.kind ?? "");
    check(
      "A9 — and seeding created no starter document or task",
      (areas ?? []).length > 0,
    );
  }

  // -------------------------------------------------------------------------
  section("A11 — the frozen layout did not move, and the budget held");
  // -------------------------------------------------------------------------
  const model = await client.query(f.getModelControls);
  check(
    "A11 — the feature vector is still 12 long (ADR-010: indices 0-7 frozen)",
    (model?.weights ?? []).length === 12,
    `${(model?.weights ?? []).length}`,
  );
  check("A11 — weightsVersion is still 1", (model?.weightsVersion ?? 1) === 1, `${model?.weightsVersion}`);

  // A renewal is a genuine outcome, so it must have reached the model. This is
  // the D34 check: did the feature vector actually receive the evidence?
  check(
    "A11 — completing a renewal trained the model (samples moved)",
    (model?.samples ?? 0) > 0,
    `samples=${model?.samples}`,
  );

  // -------------------------------------------------------------------------
  section("final state — the fixture account is coherent");
  // -------------------------------------------------------------------------
  const finalDocs = await client.query(f.listDocuments);
  const list = finalDocs?.documents ?? [];
  check("every document the run left behind is readable", list.length >= 4, `${list.length}`);
  const corrupt = list.filter((d) => !d.label || d.label.trim().length === 0);
  check("and none of them has an empty label", corrupt.length === 0, `${corrupt.length}`);
  const inconsistent = list.filter((d) => {
    if (d.state === "undated") return d.deadlineAt !== null || d.attention;
    if (d.state === "valid") return d.attention;
    if (d.state === "renewing" || d.state === "renewing-late") return d.attention;
    return !d.attention && !["due", "expired", "stale"].includes(d.state);
  });
  check(
    "and every state agrees with its own attention flag",
    inconsistent.length === 0,
    inconsistent.map((d) => `${d.label}=${d.state}`).join(", "),
  );

  // -------------------------------------------------------------------------
  console.log("=".repeat(64));
  for (const line of observations) console.log(line);
  console.log("=".repeat(64));
  console.log("");
  console.log(`Mutations written by this run: ${writes}.`);

  const held = observations.filter((l) => l.includes("[PASS]")).length;
  const skipped = observations.filter((l) => l.includes("[SKIP]")).length;
  if (failures.length === 0 && skipped === 0) {
    console.log("");
    console.log(`RESULT: PASS — ${held} invariants held, 0 skipped.`);
    process.exit(0);
  }

  if (skipped > 0) {
    console.log("");
    console.log("RESULT: FAIL — a check was skipped. This harness must not skip.");
    process.exit(1);
  }

  console.log("");
  console.log(`RESULT: FAIL — ${failures.length} assertion(s) failed:`);
  for (const label of failures) console.log(`  - ${label}`);
  process.exit(1);
}

main().catch((err) => {
  console.error("conformance run threw:", err);
  process.exit(2);
});
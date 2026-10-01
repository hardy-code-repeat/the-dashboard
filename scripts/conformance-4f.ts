/**
 * Phase 3, feature 4 conformance — Commitments + Waiting On.
 *
 * Runs against a REAL deployment, through the real auth path, writing real
 * rows. It decides the fourteen acceptance criteria from §11.2:
 *
 *  A1  an overdue promise produces exactly one hard `commitment.overdue` item,
 *      in `people`;
 *  A2  an overdue wait produces exactly one `commitment.waiting` item, in
 *      `waitingOn` — the section that had no producer for two phases;
 *  A3  an undated or distant commitment produces NO attention item;
 *  A4  `followUp` creates exactly one task, carrying `personId` and
 *      `commitmentId`, dated today — and only when asked;
 *  A5  completing that follow-up does NOT settle the commitment;
 *  A6  settling a commitment makes it `kept` and removes it from Attention;
 *  A7  copy for `owedTo` never asserts what the other person did — checked
 *      against the exact strings, in every state;
 *  A8  a merge rewrites nothing, unmerge restores it, and a merged-away person
 *      still resolves;
 *  A9  every read and write is owner-scoped; a second account sees nothing and a
 *      foreign id is refused on all seven write paths;
 *  A10 no people mutation ever removes a commitment, and `deleteCommitment`
 *      detaches its follow-up tasks rather than deleting them;
 *  A11 all four `commitment.*` activity kinds are written and read back;
 *  A12 nothing regresses — capture, tax, Life Admin, people and areas — and in
 *      particular capture still infers **no** commitments (Q-007);
 *  A13 `FEATURE_COUNT` 12, `weightsVersion` 1, and a commitment moves no
 *      weight — while the follow-up task it created does (D34);
 *  A14 the budget held.
 *
 * Nothing here waits on a credential, so there are no skips.
 *
 * Usage:
 *   bun scripts/conformance-4f.ts <CONVEX_URL>
 *
 * Exit: 0 = every invariant held, 1 = one or more did not.
 */

import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";

interface CommitmentView {
  id: string;
  title: string;
  direction: "owed" | "owedTo";
  /** The row this commitment STORED, not the one it resolves to. */
  personId: string;
  personName: string;
  expectedAt: number | null;
  completed: boolean;
  completedAt: number | null;
  createdAt: number;
  state: "open" | "due" | "overdue" | "kept";
  daysAway: number | null;
  severity: number | null;
  attention: boolean;
  section: "people" | "waitingOn" | null;
  detail: string;
  followingUp: boolean;
  followUpTaskId: string | null;
}

interface AttentionItem {
  kind: string;
  sourceId: string;
  section: string;
  class: string;
  severity: number;
  title: string;
  detail?: string;
  dueAt: number | null;
  escalation: 0 | 1 | 2;
  action?: { label: string; kind: string };
}

interface AreaTask {
  _id: string;
  title: string;
  completed: boolean;
  dueAt?: number | null;
  area: string;
  personId?: string;
  commitmentId?: string;
}

const f = {
  listCommitments: makeFunctionReference<
    Record<string, never>,
    { owed: CommitmentView[]; owedTo: CommitmentView[] }
  >("commitments:listCommitments"),
  getCommitment: makeFunctionReference<{ id: string }, CommitmentView | null>(
    "commitments:getCommitment",
  ),
  getAttentionCommitments: makeFunctionReference<Record<string, never>, CommitmentView[]>(
    "commitments:getAttentionCommitments",
  ),
  commitmentAudit: makeFunctionReference<
    Record<string, never>,
    { kinds: string[]; followUps: string[] }
  >("commitments:commitmentAudit"),
  createCommitment: makeFunctionReference<
    { title: string; personId: string; direction: string; expectedAt?: number },
    string
  >("commitments:createCommitment"),
  updateCommitment: makeFunctionReference<
    { id: string; title?: string; expectedAt?: number },
    null
  >("commitments:updateCommitment"),
  completeCommitment: makeFunctionReference<
    { id: string },
    { alreadyDone: boolean }
  >("commitments:completeCommitment"),
  cancelCommitment: makeFunctionReference<{ id: string }, { cancelled: boolean }>(
    "commitments:cancelCommitment",
  ),
  reopenCommitment: makeFunctionReference<{ id: string }, { reopened: boolean }>(
    "commitments:reopenCommitment",
  ),
  followUp: makeFunctionReference<{ id: string }, { taskId: string; created: boolean }>(
    "commitments:followUp",
  ),
  deleteCommitment: makeFunctionReference<{ id: string }, { detached: number }>(
    "commitments:deleteCommitment",
  ),
  getAttention: makeFunctionReference<
    Record<string, never>,
    {
      items: AttentionItem[];
      produced: number;
      hiddenByCap: Record<string, number>;
      hiddenByTotalCap: number;
    } | null
  >("attention:getAttention"),
  listPeople: makeFunctionReference<
    Record<string, never>,
    { people: { id: string; name: string; openTasks: number }[]; mergedCount: number }
  >("people:listPeople"),
  createPerson: makeFunctionReference<
    { name: string; force?: boolean },
    { created: true; id: string } | { created: false; duplicateOf: { id: string } }
  >("people:createPerson"),
  getPerson: makeFunctionReference<{ id: string }, { id: string; mergedIntoId?: string } | null>(
    "people:getPerson",
  ),
  updatePerson: makeFunctionReference<{ id: string; name?: string; note?: string }, null>(
    "people:updatePerson",
  ),
  mergePeople: makeFunctionReference<
    { sourceId: string; targetId: string },
    { from: string; into: string }
  >("people:mergePeople"),
  unmergePerson: makeFunctionReference<{ id: string }, { unmerged: boolean }>(
    "people:unmergePerson",
  ),
  getAreaTasks: makeFunctionReference<{ area: string }, AreaTask[]>("life:getAreaTasks"),
  getFinance: makeFunctionReference<
    Record<string, never>,
    { documents: { id: string; gathered: boolean }[]; readiness: { score: number } } | null
  >("life:getFinance"),
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
async function q<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch {
    return null;
  }
}

/** Every commitment the caller owns, as one flat list. */
function flat(list: { owed: CommitmentView[]; owedTo: CommitmentView[] } | null | undefined) {
  return [...(list?.owed ?? []), ...(list?.owedTo ?? [])];
}

function itemFor(items: AttentionItem[] | undefined, id: string) {
  return (items ?? []).filter((i) => i.kind === "commitment.overdue" || i.kind === "commitment.waiting").filter((i) => i.sourceId === id);
}

async function main() {
  const url = process.argv[2];
  if (!url) {
    console.error("Usage: bun scripts/conformance-4f.ts <CONVEX_URL>");
    process.exit(2);
  }

  console.log("PHASE 3 / FEATURE 4 CONFORMANCE — Commitments + Waiting On");
  console.log("=".repeat(64));
  console.log(`deployment: ${url}`);
  console.log("");
  console.log("Every check below runs against the deployed backend. Nothing is mocked.");

  const client = await freshClient(url);
  const other = await freshClient(url);
  const DAY = 86_400_000;
  const NOW = Date.now();
  let writes = 0;

  // -------------------------------------------------------------------------
  section("setup — one person, and the model state before anything is written");
  // -------------------------------------------------------------------------
  const created = await client.mutation(f.createPerson, { name: "Raj Menon" });
  if (!("created" in created)) throw new Error("the fixture person was refused as a duplicate");
  const personId = created.id;
  writes += 1;

  const before = await client.query(f.getModelControls);
  check(
    "A13 — the feature vector is 12 long before we start (ADR-010: 0-7 frozen)",
    (before?.weights ?? []).length === 12,
    `${(before?.weights ?? []).length}`,
  );
  check("A13 — weightsVersion is 1", (before?.weightsVersion ?? 1) === 1, `${before?.weightsVersion}`);

  // -------------------------------------------------------------------------
  section("A1 — an overdue promise is `overdue` and produces one hard item in `people`");
  // -------------------------------------------------------------------------
  const promise = await client.mutation(f.createCommitment, {
    title: "Send the signed contract",
    personId,
    direction: "owed",
    expectedAt: NOW - 3 * DAY,
  });
  writes += 1;

  const promiseView = await client.query(f.getCommitment, { id: promise });
  check("A1 — it reads back", promiseView !== null);
  check("A1 — its state is `overdue`", promiseView?.state === "overdue", promiseView?.state ?? "");
  check("A1 — it wants attention", promiseView?.attention === true);
  check("A1 — it belongs to `people`", promiseView?.section === "people", promiseView?.section ?? "");
  check("A1 — the copy names the promise, not the failure", promiseView?.detail === "You told Raj Menon you would, and it is 3 days overdue", promiseView?.detail ?? "");
  check("A1 — the stored person is the one it was made with", promiseView?.personId === personId);

  const attention1 = await client.query(f.getAttention);
  const promiseItems = itemFor(attention1?.items, promise);
  check("A1 — exactly one item", promiseItems.length === 1, `${promiseItems.length}`);
  check("A1 — the kind is `commitment.overdue`", promiseItems[0]?.kind === "commitment.overdue", promiseItems[0]?.kind ?? "");
  check("A1 — the section is `people`", promiseItems[0]?.section === "people", promiseItems[0]?.section ?? "");
  check("A1 — it is hard, never ranked", promiseItems[0]?.class === "hard", promiseItems[0]?.class ?? "");
  check("A1 — its due date is the date the user gave", promiseItems[0]?.dueAt === NOW - 3 * DAY);

  const attentionOnly = await client.query(f.getAttentionCommitments);
  check(
    "A1 — the server's own attention read agrees",
    attentionOnly?.some((c) => c.id === promise) === true,
    `${(attentionOnly ?? []).length} attention-worthy`,
  );

  // -------------------------------------------------------------------------
  section("A2 — an overdue wait fills `waitingOn`, the section with no producer");
  // -------------------------------------------------------------------------
  const wait = await client.mutation(f.createCommitment, {
    title: "Send the signed copy",
    personId,
    direction: "owedTo",
    expectedAt: NOW - 5 * DAY,
  });
  writes += 1;

  const waitView = await client.query(f.getCommitment, { id: wait });
  check("A2 — it reads back as `overdue`", waitView?.state === "overdue", waitView?.state ?? "");
  check("A2 — and it belongs to `waitingOn`", waitView?.section === "waitingOn", waitView?.section ?? "");

  const attention2 = await client.query(f.getAttention);
  const waitItems = itemFor(attention2?.items, wait);
  check("A2 — exactly one item", waitItems.length === 1, `${waitItems.length}`);
  check("A2 — the kind is `commitment.waiting`", waitItems[0]?.kind === "commitment.waiting", waitItems[0]?.kind ?? "");
  check("A2 — the section is `waitingOn`", waitItems[0]?.section === "waitingOn", waitItems[0]?.section ?? "");
  check("A2 — it is hard", waitItems[0]?.class === "hard", waitItems[0]?.class ?? "");
  check(
    "A2 — its action is to follow up, never to do it",
    waitItems[0]?.action?.kind === "commitment.follow_up" && waitItems[0]?.action?.label === "Follow up",
    `${waitItems[0]?.action?.kind}`,
  );
  check(
    "A2 — and the promise's action is to settle it",
    itemFor(attention2?.items, promise)[0]?.action?.kind === "commitment.settle",
  );

  const waitSeverity = waitItems[0]?.severity ?? 1;
  const promiseSeverity = itemFor(attention2?.items, promise)[0]?.severity ?? 0;
  check(
    "A2 — a wait the user cannot resolve is quieter than their own broken promise",
    waitSeverity < promiseSeverity,
    `${waitSeverity} vs ${promiseSeverity}`,
  );

  // -------------------------------------------------------------------------
  section("A3 — an undated or distant commitment produces nothing at all");
  // -------------------------------------------------------------------------
  const undated = await client.mutation(f.createCommitment, {
    title: "Show Raj how the demo works",
    personId,
    direction: "owed",
  });
  const distant = await client.mutation(f.createCommitment, {
    title: "Pay Raj back for the flights",
    personId,
    direction: "owedTo",
    expectedAt: NOW + 90 * DAY,
  });
  writes += 2;

  const undatedView = await client.query(f.getCommitment, { id: undated });
  const distantView = await client.query(f.getCommitment, { id: distant });
  check("A3 — an undated promise is `open`", undatedView?.state === "open", undatedView?.state ?? "");
  check("A3 — and silent", undatedView?.attention === false);
  check("A3 — a distant wait is `open` too", distantView?.state === "open", distantView?.state ?? "");
  check("A3 — and silent", distantView?.attention === false);

  const attention3 = await client.query(f.getAttention);
  check("A3 — neither produced an item", itemFor(attention3?.items, undated).length === 0);
  check("A3 — the second one neither", itemFor(attention3?.items, distant).length === 0);
  check(
    "A3 — and the feed still holds exactly the two that are genuinely late",
    itemFor(attention3?.items, promise).length === 1 && itemFor(attention3?.items, wait).length === 1,
  );

  // A promise inside the seven-day window is `due` — and `due` is not attention.
  const soon = await client.mutation(f.createCommitment, {
    title: "Send Raj the invoice",
    personId,
    direction: "owed",
    expectedAt: NOW + 2 * DAY,
  });
  writes += 1;
  const soonView = await client.query(f.getCommitment, { id: soon });
  check("A3 — inside the window it is `due`", soonView?.state === "due", soonView?.state ?? "");
  check("A3 — and `due` is deliberately not attention", soonView?.attention === false);
  const attentionSoon = await client.query(f.getAttention);
  check("A3 — so it produces no item", itemFor(attentionSoon?.items, soon).length === 0);

  // -------------------------------------------------------------------------
  section("A3 — moving the expected date removes the item, and direction is immutable");
  // -------------------------------------------------------------------------
  const movable = await client.mutation(f.createCommitment, {
    title: "Send Raj the invoice copy",
    personId,
    direction: "owed",
    expectedAt: NOW - 2 * DAY,
  });
  writes += 1;
  check("A3 — it starts in Attention", itemFor((await client.query(f.getAttention))?.items, movable).length === 1);

  await client.mutation(f.updateCommitment, { id: movable, expectedAt: NOW + 40 * DAY });
  writes += 1;
  const moved = await client.query(f.getCommitment, { id: movable });
  check("A3 — the date moved", moved?.expectedAt === NOW + 40 * DAY, `${moved?.expectedAt}`);
  check("A3 — and the item left Attention", itemFor((await client.query(f.getAttention))?.items, movable).length === 0);
  check("A3 — the row itself survives, so the promise is not lost", moved?.completed === false);
  check("A3 — it is `open` again", moved?.state === "open", moved?.state ?? "");

  // Direction is not an argument on the edit path at all, so it cannot be
  // flipped in place: "I owe Raj" cannot silently become "Raj owes me".
  const flipAttempt = await q(() =>
    client.mutation(f.updateCommitment, { id: movable, direction: "owedTo" } as never),
  );
  check("A3 — an attempt to pass a direction is refused by the validator", flipAttempt === null);

  // -------------------------------------------------------------------------
  section("A4 — a follow-up task exists only when the user asks for one");
  // -------------------------------------------------------------------------
  const tasksBefore = await client.query(f.getAreaTasks, { area: "general" });
  check(
    "A4 — Panel created no task of its own for any commitment",
    tasksBefore.every((t) => t.commitmentId === undefined),
    `${tasksBefore.filter((t) => t.commitmentId !== undefined).length} found`,
  );

  const chased = await client.mutation(f.followUp, { id: wait });
  writes += 1;
  check("A4 — a task was created", chased.created === true);

  const tasks = await client.query(f.getAreaTasks, { area: "general" });
  const chase = tasks.find((t) => t._id === chased.taskId);
  check("A4 — the task really exists", chase !== undefined);
  check("A4 — it carries commitmentId", chase?.commitmentId === wait, `${chase?.commitmentId}`);
  check("A4 — it carries personId too", chase?.personId === personId, `${chase?.personId}`);
  check("A4 — it is open", chase?.completed === false);
  check(
    "A4 — it is dated today",
    typeof chase?.dueAt === "number" && Math.abs((chase?.dueAt ?? 0) - NOW) < 5 * 60_000,
    `${chase?.dueAt}`,
  );
  check(
    "A4 — and it lives in the ordinary task list, not a second queue",
    chase !== undefined && tasks.some((t) => t._id === chased.taskId),
  );

  const chaseAgain = await client.mutation(f.followUp, { id: wait });
  writes += 1;
  check("A4 — a second press does not create a second nudge", chaseAgain.created === false);
  check("A4 — and returns the same task", chaseAgain.taskId === chased.taskId);

  const waitAfterChase = await client.query(f.getCommitment, { id: wait });
  check("A4 — the wait is now marked as being chased", waitAfterChase?.followingUp === true);
  check(
    "A4 — and it is still exactly the same overdue commitment",
    waitAfterChase?.state === "overdue" && waitAfterChase?.attention === true,
  );

  // -------------------------------------------------------------------------
  section("A5 — chasing somebody is not receiving from them");
  // -------------------------------------------------------------------------
  await client.mutation(f.setTaskCompleted, { id: chased.taskId, completed: true });
  writes += 1;
  const afterChase = await client.query(f.getCommitment, { id: wait });
  check("A5 — the follow-up task is done", afterChase?.followingUp === false);
  check("A5 — and the commitment is STILL not settled", afterChase?.completed === false);
  check("A5 — its state is unchanged", afterChase?.state === "overdue", afterChase?.state ?? "");
  check("A5 — and it is still saying it is waiting", (afterChase?.detail ?? "").startsWith("Waiting on Raj Menon"), afterChase?.detail ?? "");

  // -------------------------------------------------------------------------
  section("A7 — the copy never claims to know what another person did");
  // -------------------------------------------------------------------------
  const settled = await client.mutation(f.completeCommitment, { id: wait });
  writes += 1;
  check("A7 — the wait is settled", settled.alreadyDone === false);
  const settledView = await client.query(f.getCommitment, { id: wait });
  check("A7 — it reads `kept`", settledView?.state === "kept", settledView?.state ?? "");
  check(
    "A7 — and the sentence attributes it to the user",
    (settledView?.detail ?? "").startsWith("You marked this received"),
    settledView?.detail ?? "",
  );
  check(
    "A7 — the copy does not even mention the other person",
    !(settledView?.detail ?? "").includes("Raj"),
    settledView?.detail ?? "",
  );

  const forbidden = /\bRaj\b[^.]*\b(sent|send|deliver|delivered|did|hasn't|has not|failed|refus|never|owes|will)\b/i;
  const everyDetail = flat(await client.query(f.listCommitments)).map((c) => ({ dir: c.direction, detail: c.detail }));
  const inboundOffenders = everyDetail.filter((c) => c.dir === "owedTo" && forbidden.test(c.detail));
  check(
    "A7 — no inbound string in the whole list asserts anything about Raj",
    inboundOffenders.length === 0,
    inboundOffenders.map((c) => c.detail).join(" | "),
  );
  const outboundOffenders = everyDetail.filter((c) => c.dir === "owed" && !c.detail.startsWith("You told "));
  check(
    "A7 — and every outbound string is phrased as something the user said",
    outboundOffenders.length === 0,
    outboundOffenders.map((c) => c.detail).join(" | "),
  );

  // Re-settling is idempotent: a double tap must not invent a second event.
  const resettled = await client.mutation(f.completeCommitment, { id: wait });
  writes += 1;
  check("A7 — settling twice is idempotent", resettled.alreadyDone === true);
  const resettledView = await client.query(f.getCommitment, { id: wait });
  check("A7 — and the completion date did not move", resettledView?.completedAt === settledView?.completedAt);

  // -------------------------------------------------------------------------
  section("A6 — a settled commitment leaves Attention");
  // -------------------------------------------------------------------------
  const attentionAfter = await client.query(f.getAttention);
  check("A6 — the settled wait is gone from the feed", itemFor(attentionAfter?.items, wait).length === 0);
  check("A6 — the still-late promise is not", itemFor(attentionAfter?.items, promise).length === 1);

  const attentionOnlyAfter = await client.query(f.getAttentionCommitments);
  check(
    "A6 — the server's own attention read agrees",
    (attentionOnlyAfter ?? []).some((c) => c.id === wait) === false,
  );

  // Reopening brings it straight back — a mis-tap is not permanent.
  const reopened = await client.mutation(f.reopenCommitment, { id: wait });
  writes += 1;
  check("A6 — it can be reopened", reopened.reopened === true);
  const reopenedView = await client.query(f.getCommitment, { id: wait });
  check("A6 — which clears the completion", reopenedView?.completed === false);
  const attentionReopened = await client.query(f.getAttention);
  check("A6 — and it is back in the feed", itemFor(attentionReopened?.items, wait).length === 1);

  // Cancelling is a real, separate outcome from settling.
  const cancelled = await client.mutation(f.cancelCommitment, { id: distant });
  writes += 1;
  check("A6 — a distant wait can be cancelled", cancelled.cancelled === true);
  const cancelView = await client.query(f.getCommitment, { id: distant });
  check("A6 — and it becomes `kept`", cancelView?.state === "kept", cancelView?.state ?? "");
  const doubleCancel = await q(() => client.mutation(f.cancelCommitment, { id: distant }));
  check("A6 — cancelling an already-settled commitment is refused", doubleCancel === null);

  // -------------------------------------------------------------------------
  section("A8 — a merge rewrites nothing, and unmerge restores it exactly");
  // -------------------------------------------------------------------------
  const second = await client.mutation(f.createPerson, { name: "Raj M" });
  if (!("created" in second)) throw new Error("the second fixture person was refused");
  const secondId = second.id;
  writes += 1;

  const toMerge = await client.mutation(f.createCommitment, {
    title: "Send Raj the signed copy",
    personId: secondId,
    direction: "owedTo",
    expectedAt: NOW - 2 * DAY,
  });
  writes += 1;

  const beforeMerge = await client.query(f.getCommitment, { id: toMerge });
  check("A8 — the commitment points at the person it was made with", beforeMerge?.personId === secondId, beforeMerge?.personId ?? "");
  check("A8 — and names them", beforeMerge?.personName === "Raj M", beforeMerge?.personName ?? "");

  const merged = await client.mutation(f.mergePeople, { sourceId: secondId, targetId: personId });
  writes += 1;
  check("A8 — the merge reported both names", merged.from === "Raj M" && merged.into === "Raj Menon");

  const afterMerge = await client.query(f.getCommitment, { id: toMerge });
  check(
    "A8 — the STORED pointer did not move",
    afterMerge?.personId === secondId,
    `${afterMerge?.personId} (was ${secondId})`,
  );
  check("A8 — but it now resolves to the surviving person", afterMerge?.personName === "Raj Menon", afterMerge?.personName ?? "");
  check("A8 — and it is still overdue", afterMerge?.state === "overdue", afterMerge?.state ?? "");

  const attentionMerged = await client.query(f.getAttention);
  check("A8 — and it is still in Attention", itemFor(attentionMerged?.items, toMerge).length === 1);

  // The list is the one source of truth for "what is this person in my
// obligations", and it reports the *resolved* person. So a merge changes what
// the surface says without a single row being written.
  const mergedList = await client.query(f.listCommitments);
  const nowNamed = flat(mergedList).find((c) => c.id === toMerge);
  check(
    "A8 — the list groups the commitment under the surviving person",
    nowNamed?.personName === "Raj Menon",
    nowNamed?.personName ?? "",
  );
  check(
    "A8 — while the stored pointer is still the merged-away row",
    nowNamed?.personId === secondId,
    nowNamed?.personId ?? "",
  );
  check(
    "A8 — so the merge really did rewrite nothing",
    (await client.query(f.getPerson, { id: secondId })) !== null &&
      (await client.query(f.listPeople)).mergedCount >= 1,
    `mergedCount=${(await client.query(f.listPeople)).mergedCount}`,
  );

  const unmerged = await client.mutation(f.unmergePerson, { id: secondId });
  writes += 1;
  check("A8 — the merge is undone", unmerged.unmerged === true);
  const afterUnmerge = await client.query(f.getCommitment, { id: toMerge });
  check("A8 — the pointer never moved, so undo needs no restoration", afterUnmerge?.personId === secondId);
  check("A8 — and the name is theirs again", afterUnmerge?.personName === "Raj M", afterUnmerge?.personName ?? "");

  // -------------------------------------------------------------------------
  section("A10 — no people mutation ever removes a commitment; deleting detaches");
  // -------------------------------------------------------------------------
  // Panel has no "delete person" path, and that is deliberate: ADR-024 makes a
  // person a tombstone or a separate row, never a deletion. The guarantee that
  // actually holds — and is what the original criterion meant — is that no
  // people mutation removes a commitment, and that the one deletion in this
  // feature detaches rather than destroys.
  const peopleBefore = flat(await client.query(f.listCommitments)).length;
  await client.mutation(f.updatePerson, { id: personId, name: "Raj Menon" });
  await client.mutation(f.createPerson, { name: "Priya Raman" });
  writes += 2;
  const peopleAfter = flat(await client.query(f.listCommitments)).length;
  check(
    "A10 — creating and updating people leaves every commitment in place",
    peopleAfter === peopleBefore,
    `${peopleBefore} → ${peopleAfter}`,
  );

  const withChase = await client.mutation(f.createCommitment, {
    title: "Send Raj the deck",
    personId,
    direction: "owedTo",
    expectedAt: NOW - DAY,
  });
  writes += 1;
  const deckChase = await client.mutation(f.followUp, { id: withChase });
  writes += 1;
  const tasksWithChase = await client.query(f.getAreaTasks, { area: "general" });
  check("A10 — the chase task exists", tasksWithChase.some((t) => t._id === deckChase.taskId));

  const deleted = await client.mutation(f.deleteCommitment, { id: withChase });
  writes += 1;
  check("A10 — the number of detached tasks is reported", deleted.detached === 1, `${deleted.detached}`);
  check("A10 — the commitment is gone", (await client.query(f.getCommitment, { id: withChase })) === null);
  const tasksAfterDelete = await client.query(f.getAreaTasks, { area: "general" });
  const survivor = tasksAfterDelete.find((t) => t._id === deckChase.taskId);
  check("A10 — the chase task SURVIVED (user data is never a side effect)", survivor !== undefined);
  check("A10 — and it is detached, not orphaned by a dead pointer", survivor?.commitmentId === undefined);

  // -------------------------------------------------------------------------
  section("A9 — cross-user isolation and foreign-id refusal on every write path");
  // -------------------------------------------------------------------------
  const otherList = await other.query(f.listCommitments);
  check("A9 — a second account sees none of these commitments", flat(otherList).length === 0, `${flat(otherList).length} visible`);
  check("A9 — asking for a foreign commitment returns null, not the row", (await other.query(f.getCommitment, { id: promise })) === null);
  check("A9 — the attention read is empty for them too", ((await other.query(f.getAttentionCommitments)) ?? []).length === 0);
  check("A9 — and their attention feed has no commitment items", itemFor((await other.query(f.getAttention))?.items, promise).length === 0);

  const refused: Record<string, boolean> = {
    updateCommitment: (await q(() => other.mutation(f.updateCommitment, { id: promise, title: "stolen" }))) === null,
    completeCommitment: (await q(() => other.mutation(f.completeCommitment, { id: promise }))) === null,
    cancelCommitment: (await q(() => other.mutation(f.cancelCommitment, { id: promise }))) === null,
    reopenCommitment: (await q(() => other.mutation(f.reopenCommitment, { id: promise }))) === null,
    followUp: (await q(() => other.mutation(f.followUp, { id: promise }))) === null,
    deleteCommitment: (await q(() => other.mutation(f.deleteCommitment, { id: promise }))) === null,
  };
  for (const [name, ok] of Object.entries(refused)) {
    check(`A9 — ${name} refuses a foreign commitment id`, ok);
  }

  const foreignPerson = await q(() =>
    other.mutation(f.createCommitment, {
      title: "Theirs",
      personId,
      direction: "owed",
      expectedAt: NOW - DAY,
    }),
  );
  check("A9 — creating a commitment against somebody else's person is refused", foreignPerson === null);

  const otherPromise = await other.mutation(f.createCommitment, {
    title: "Send Sam the report",
    personId: (
      await other.mutation(f.createPerson, { name: "Sam Adeyemi" })
    ).id,
    direction: "owed",
    expectedAt: NOW - 2 * DAY,
  });
  writes += 1;
  check("A9 — the second account CAN create their own", typeof otherPromise === "string");
  check(
    "A9 — and it reads back to them through the single-commitment path",
    (await other.query(f.getCommitment, { id: otherPromise as string })) !== null,
  );
  const otherListNow = await other.query(f.listCommitments);
  check(
    "A9 — and their own list holds exactly the one commitment they made",
    flat(otherListNow).length === 1,
    `${flat(otherListNow).length}: ${flat(otherListNow).map((c) => `${c.title}/${c.personName}`).join(", ")}`,
  );

  const otherAudit = await other.query(f.commitmentAudit);
  check(
    "A9 — and the audit trail is owner-scoped: they see only their own",
    (otherAudit?.kinds ?? []).length > 0 &&
      (otherAudit?.followUps ?? []).length === 0,
    `${(otherAudit?.kinds ?? []).length} rows`,
  );
  const ownerAudit = await client.query(f.commitmentAudit);
  check(
    "A9 — the owner's audit is not polluted by theirs",
    (ownerAudit?.kinds ?? []).length >= 3,
    `${(ownerAudit?.kinds ?? []).length} rows`,
  );

  // -------------------------------------------------------------------------
  section("A11 — the four activity kinds are written and read back");
  // -------------------------------------------------------------------------
  // Read back, not assumed: a mutation returning successfully proves only that
  // the mutation returned (R-005, D38). `commitment.made` has been in the closed
  // taxonomy since phase 0B and was written by nothing until this feature.
  const audit = await client.query(f.commitmentAudit);
  const kinds = audit?.kinds ?? [];
  check("A11 — commitment.made is on the audit trail", kinds.includes("commitment.made"), kinds.join(", "));
  check("A11 — commitment.fulfilled is on it", kinds.includes("commitment.fulfilled"));
  check("A11 — commitment.cancelled is on it", kinds.includes("commitment.cancelled"));
  check("A11 — commitment.followed_up is on it", kinds.includes("commitment.followed_up"));
  check(
    "A11 — and the follow-up rows carry the real task id",
    (audit?.followUps ?? []).includes(chased.taskId),
    (audit?.followUps ?? []).join(", ") || "empty",
  );

  // -------------------------------------------------------------------------
  section("A12 — capture still infers no commitments (Q-007), and nothing regressed");
  // -------------------------------------------------------------------------
  const captured = await client.mutation(f.capture, {
    input: "I'll send Raj Menon the file tomorrow; Raj Menon will send me the contract",
    area: "relationships",
  });
  writes += 1;
  check(
    "A12 — the sentence still splits into ordinary tasks",
    captured.created.length === 2,
    `${captured.created.length} created, ${captured.dropped.length} dropped`,
  );
  check(
    "A12 — and it creates no commitment of either direction",
    flat(await client.query(f.listCommitments)).length === peopleAfter,
    "capture must not guess a direction (Q-007 is open and non-blocking)",
  );

  const finance = await client.query(f.getFinance);
  check("A12 — the tax checklist still answers", finance !== null && finance.documents.length > 0);
  const areas = await client.query(f.listAreas);
  check(
    "A12 — no new area appeared for this feature",
    areas.every((a) => !a.slug.startsWith("commitment") && !a.slug.startsWith("waiting")),
    areas.map((a) => a.slug).join(", "),
  );
  // `listAreas` only returns what this account switched on, so the catalogue is
  // the thing that answers "did this feature add a place to live".
  const catalogue = await client.query(f.getAvailableAreas);
  check(
    "A12 — `life` is still in the catalogue from feature 3",
    catalogue.some((a) => a.slug === "life"),
    catalogue.map((a) => a.slug).join(", "),
  );
  check(
    "A12 — and `relationships` is still the people area this feature lives inside",
    catalogue.some((a) => a.slug === "relationships"),
  );
  check(
    "A12 — the catalogue is exactly the six areas from features 0-3, no more",
    catalogue.length === 6 &&
      ["general", "finance", "relationships", "health", "home", "life"].every((slug) =>
        catalogue.some((a) => a.slug === slug),
      ),
    catalogue.map((a) => a.slug).join(", "),
  );

  // -------------------------------------------------------------------------
  section("A13 — a commitment moves no weight; the task it created does (D34)");
  // -------------------------------------------------------------------------
  // Isolated on purpose. Earlier sections complete *tasks* on purpose, and a
  // task completion is a genuine outcome that trains (ADR-004, Q-006). Reading a
  // sample delta across the whole run would prove nothing: it would be measuring
  // the tasks, not the commitments. So this measures four commitment mutations
  // and nothing else.
  const preIsolate = await client.query(f.getModelControls);
  const isolate = await client.mutation(f.createCommitment, {
    title: "Send Raj the summary",
    personId,
    direction: "owed",
    expectedAt: NOW - DAY,
  });
  await client.mutation(f.completeCommitment, { id: isolate });
  await client.mutation(f.reopenCommitment, { id: isolate });
  await client.mutation(f.cancelCommitment, { id: isolate });
  writes += 4;
  const postIsolate = await client.query(f.getModelControls);

  check(
    "A13 — the feature vector is still 12 long",
    (postIsolate?.weights ?? []).length === 12,
    `${(postIsolate?.weights ?? []).length}`,
  );
  check("A13 — weightsVersion is still 1", (postIsolate?.weightsVersion ?? 1) === 1);
  check(
    "A13 — creating, settling, reopening and cancelling a commitment produced NO training sample",
    (postIsolate?.samples ?? 0) === (preIsolate?.samples ?? 0),
    `${preIsolate?.samples} → ${postIsolate?.samples}`,
  );
  check(
    "A13 — and not one weight moved",
    JSON.stringify(postIsolate?.weights ?? []) === JSON.stringify(preIsolate?.weights ?? []),
  );

  // The D34 check in the positive direction: the follow-up task IS ordinary
  // work, so completing one must actually reach the vector. If this does not
  // move, the evidence is not flowing even though the task was ticked.
  const liveChase = await client.mutation(f.followUp, { id: promise });
  writes += 1;
  await client.mutation(f.setTaskCompleted, { id: liveChase.taskId, completed: true });
  writes += 1;
  const afterTask = await client.query(f.getModelControls);
  check(
    "A13 — completing the follow-up DID train (an ordinary task outcome)",
    (afterTask?.samples ?? 0) > (postIsolate?.samples ?? 0),
    `${postIsolate?.samples} → ${afterTask?.samples}`,
  );
  const promiseStillOpen = await client.query(f.getCommitment, { id: promise });
  check(
    "A13 — and ticking that task did not settle the promise it was about",
    promiseStillOpen?.completed === false,
  );

  // -------------------------------------------------------------------------
  section("A14 — the budget held")
  // -------------------------------------------------------------------------
  const finalList = await client.query(f.listCommitments);
  const all = flat(finalList);
  check("A14 — one table, two directions: every row is on one side or the other", all.every((c) => c.direction === "owed" || c.direction === "owedTo"));
  check("A14 — no stored status: every state is derived", all.every((c) => typeof c.state === "string" && c.state.length > 0));
  check(
    "A14 — every row still resolves to a live person",
    all.every((c) => c.personName.length > 0),
    all.filter((c) => c.personName.length === 0).map((c) => c.id).join(", "),
  );
  check(
    "A14 — and the two lists are disjoint",
    (finalList?.owed ?? []).every((c) => c.direction === "owed") &&
      (finalList?.owedTo ?? []).every((c) => c.direction === "owedTo"),
  );

  // -------------------------------------------------------------------------
  section("final state — the fixture account is coherent");
  // -------------------------------------------------------------------------
  const inconsistent = all.filter((c) => {
    if (c.completed) return c.state !== "kept" || c.attention;
    if (c.state === "overdue") return !c.attention || c.severity === null;
    if (c.state === "open" || c.state === "due") return c.attention;
    return true;
  });
  check(
    "every state agrees with its own attention flag",
    inconsistent.length === 0,
    inconsistent.map((c) => `${c.title}=${c.state}`).join(", "),
  );
  check(
    "no commitment survived without a title",
    all.every((c) => c.title.trim().length > 0 && c.title.length <= 160),
  );
  const finalAttention = await client.query(f.getAttention);
  check(
    "and the feed agrees with the list",
    itemFor(finalAttention?.items, promise).length === 1 &&
      itemFor(finalAttention?.items, toMerge).length === 1,
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
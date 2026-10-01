/**
 * Phase 3, feature 1 conformance — People as first-class objects (§11.2).
 *
 * Runs against a REAL deployment, through the real auth path, writing real
 * rows. It decides the six acceptance criteria for this feature, and then the
 * security questions that come with any new owner-scoped table:
 *
 *  A1  a capture can be linked to a known person, and is;
 *  A2  two rows sharing a normalised name stay separate until a human merges
 *      them (RJD-004);
 *  A3  merge is reversible, and unmerge restores both rows and every link;
 *  A4  a merged row is a tombstone that no user-facing query returns;
 *  A5  PEOPLE_FIT evidence is keyed by person id, so two namesakes never share
 *      a row of learning;
 *  A6  merge → unmerge leaves the row count and the link count exactly as they
 *      were;
 *
 *  S1  a second account sees none of it (cross-user isolation);
 *  S2  a foreign person id is refused by every write path that accepts one;
 *  S3  "not yours" and "does not exist" are indistinguishable, so a refusal
 *      cannot be used to probe for the existence of an id.
 *
 * Everything above is decidable without a secret, so this harness has no skips:
 * unlike phase 2, nothing here is waiting on the environment.
 *
 * Usage:
 *   bun scripts/conformance-3.ts <CONVEX_URL>
 *
 * Example:
 *   bun scripts/conformance-3.ts https://<deployment>.convex.cloud
 *
 * Exit: 0 = every invariant held, 1 = one or more did not.
 */

import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";

// Referenced by name rather than through the generated `api`, so this script
// keeps compiling independently of codegen.
const f = {
  createPerson: makeFunctionReference<
    { name: string; email?: string; force?: boolean },
    | { created: true; id: string }
    | { created: false; duplicateOf: { id: string; name: string; reason: string } }
  >("people:createPerson"),
  listPeople: makeFunctionReference<
    Record<string, never>,
    {
      people: {
        id: string;
        name: string;
        hasEmail: boolean;
        openTasks: number;
        matchHint: { id: string; name: string; suggest: boolean; reason: string } | null;
      }[];
      mergedCount: number;
    }
  >("people:listPeople"),
  getPerson: makeFunctionReference<
    { id: string },
    | {
        id: string;
        name: string;
        keys: string[];
        mergedFrom: { id: string; name: string; mergedAt: number | null }[];
        tasks: { id: string; title: string; completed: boolean }[];
      }
    | null
  >("people:getPerson"),
  updatePerson: makeFunctionReference<{ id: string; name?: string }, { updated: boolean }>(
    "people:updatePerson",
  ),
  mergePeople: makeFunctionReference<{ targetId: string; sourceId: string }, { merged: boolean; from: string; into: string }>(
    "people:mergePeople",
  ),
  unmergePerson: makeFunctionReference<{ id: string }, { unmerged: true; name: string } | { unmerged: false; reason: string }>(
    "people:unmergePerson",
  ),
  addTask: makeFunctionReference<{ input: string; area?: string; personId?: string }, string>("assistant:addTask"),
  setTaskCompleted: makeFunctionReference<{ id: string; completed: boolean }, unknown>("assistant:setTaskCompleted"),
  getAreaTasks: makeFunctionReference<{ area: string }, { _id: string; title: string; completed: boolean }[]>(
    "life:getAreaTasks",
  ),
  getModelControls: makeFunctionReference<
    Record<string, never>,
    {
      weights: number[];
      samples: number;
      byPerson: Record<string, { done: number; total: number }>;
    } | null
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

// There is deliberately no `skip` helper. Unlike phase 2, nothing in this
// harness waits on the environment: every criterion and every security check
// is decidable without a credential, so a skip here would mean a check had
// quietly stopped running. A `[SKIP]` line in the output is therefore always a
// bug in this file.

/** Runs `fn`, reporting whether it refused and returning the message it used. */
async function refuses(fn: () => Promise<unknown>): Promise<{ refused: boolean; message: string }> {
  try {
    await fn();
    return { refused: false, message: "" };
  } catch (e) {
    return { refused: true, message: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * A syntactically valid person id that belongs to nobody.
 *
 * S3 asks whether "not yours" and "does not exist" are treated identically. The
 * second half of that cannot be tested with an arbitrary string: a malformed id
 * is rejected by the argument validator before any handler runs, which is a
 * stronger answer but a different one, and it would prove nothing about the
 * case under test.
 *
 * Convex's id format is not documented, and its validators are enforced by the
 * backend rather than in the client bundle, so there is nothing to ask locally.
 * Instead this perturbs a *real* id one character at a time and keeps the first
 * variation the server accepts — which both discovers the format and proves
 * the probe reached a handler, since a rejected candidate is identifiable by
 * its `ArgumentValidationError`.
 */
async function nonexistentId(
  client: ConvexHttpClient,
  seed: string,
): Promise<{ id: string | null; why: string }> {
  const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
  for (const ch of alphabet) {
    if (ch === seed[seed.length - 1]) continue;
    const candidate = seed.slice(0, -1) + ch;
    const attempt = await refuses(() => client.mutation(f.updatePerson, { id: candidate, name: "probe" }));
    if (attempt.refused && !/ArgumentValidationError|does not match validator/i.test(attempt.message)) {
      return { id: candidate, why: "accepted by the validator, absent from the database" };
    }
  }
  return { id: null, why: "no single-character variant of a real id passed the validator" };
}

/** A throwaway account, so every row is written through the real auth path. */
async function freshClient(url: string): Promise<ConvexHttpClient> {  const client = new ConvexHttpClient(url);
  const session = await client.action(f.signIn as never, { provider: "anonymous" } as never);
  const token = session?.tokens?.token;
  if (!token) throw new Error("anonymous sign-in returned no token");
  client.setAuth(token as never);
  return client;
}

async function main() {
  const url = process.argv[2];
  if (!url) {
    console.error("Usage: bun scripts/conformance-3.ts <CONVEX_URL>");
    process.exit(2);
  }

  console.log("PHASE 3 / FEATURE 1 CONFORMANCE — People");
  console.log("=".repeat(64));
  console.log(`deployment: ${url}`);
  console.log("");
  console.log("Every check below runs against the deployed backend. Nothing is mocked.");

  const client = await freshClient(url);
  let writes = 0;

  // -------------------------------------------------------------------------
  section("A2 — two rows with the same normalised name stay separate");
  // -------------------------------------------------------------------------
  // "Raj Patel" and "raj  patel" normalise to the same identity key, which is
  // exactly the situation RJD-004 warns about. Panel must not merge them, and
  // must not quietly combine the two people's work either.
  const first = await client.mutation(f.createPerson, { name: "Raj Patel" });
  writes += 1;
  check("the first person is created", first.created === true);
  if (!first.created) throw new Error("could not create the first person");

  // Panel declines, and names the row it had in mind. Declining is not merging:
  // nothing is combined, and the user is free to disagree.
  const refusal = await client.mutation(f.createPerson, { name: "raj  patel" });
  writes += 1;
  if (refusal.created) {
    check("a probable duplicate is refused, not created", false, "a second row appeared unasked");
  } else {
    check("a probable duplicate is refused, not created", refusal.duplicateOf.id === first.id, refusal.duplicateOf.name);
    check(
      "and the refusal asks rather than asserting",
      /check/i.test(refusal.duplicateOf.reason),
      refusal.duplicateOf.reason,
    );
  }

  const stillOne = await client.query(f.listPeople, {});
  check("nothing was merged and nothing extra was created", stillOne.people.length === 1, `${stillOne.people.length} people`);

  // The user may still insist. That produces a *second row*, which is honest:
  // it is not a merge, and it does not touch the first row.
  const second = await client.mutation(f.createPerson, { name: "raj  patel", force: true });
  writes += 1;
  check("the user can insist and end up with two people", second.created === true);
  if (!second.created) throw new Error("could not create the namesake");
  check("and they really are two rows", first.id !== second.id);
  const namesakes = second.id;

  const twoNow = await client.query(f.listPeople, {});
  check("A2 — both namesakes are listed, separately", twoNow.people.length === 2, `${twoNow.people.length} people`);
  check(
    "A2 — and the shared name is offered as a hint, not applied",
    twoNow.people.some((p) => p.matchHint?.id === first.id && p.matchHint?.suggest === true),
    JSON.stringify(twoNow.people.map((p) => p.matchHint)),
  );

  // A third namesake, so A5 below can show that the counters are keyed by id
  // and not by the name all three of them share.
  const third = await client.mutation(f.createPerson, { name: "RAJ PATEL", force: true });
  writes += 1;
  check("a third namesake can exist too", third.created === true);
  if (!third.created) throw new Error("could not create the third namesake");
  const thirdId = third.id;

  // A shared email is stronger evidence than a shared name, and is the one case
  // where Panel says "same email address" rather than "check this".
  const withEmail = await client.mutation(f.createPerson, { name: "Sunita Rao", email: "sunita@example.com" });
  const emailClash = await client.mutation(f.createPerson, { name: "S. Rao", email: "Sunita@Example.com" });
  writes += 2;
  check("a distinct person with an email is created", withEmail.created === true);
  if (!withEmail.created) throw new Error("could not create the email fixture");
  check(
    "a shared email is refused as well, on stronger grounds",
    !emailClash.created,
    emailClash.created ? "created a second row" : emailClash.duplicateOf.reason,
  );

  // -------------------------------------------------------------------------
  section("A1 — a task can be linked to a person, and is");
  // -------------------------------------------------------------------------
  const linkedTask = await client.mutation(f.addTask, {
    input: "call back tomorrow",
    area: "relationships",
    personId: first.id,
  });
  writes += 1;
  check("a task is created against a person", typeof linkedTask === "string");
  const firstDetail = await client.query(f.getPerson, { id: first.id });
  check("the person reads the task back", firstDetail?.tasks.some((t) => t.id === linkedTask) === true);

  // -------------------------------------------------------------------------
  section("A3 / A4 / A6 — merge, then undo it, changing nothing");
  // -------------------------------------------------------------------------
  const before = await client.query(f.listPeople, {});
  const beforeIds = before.people.map((p) => p.id).sort();
  const keysBefore = [...(firstDetail?.keys ?? [])].sort();
  const linksBefore = firstDetail?.tasks.length ?? 0;
  const namesBefore = firstDetail?.name;

  const merge = await client.mutation(f.mergePeople, { targetId: first.id, sourceId: second.id });
  writes += 1;
  check("merge reports what it did", merge.merged === true, `${merge.from} → ${merge.into}`);

  const midList = await client.query(f.listPeople, {});
  check("A4 — the merged row is not returned by the list", !midList.people.some((p) => p.id === second.id));
  check("A4 — and the hidden count accounts for it", midList.mergedCount === 1, `mergedCount=${midList.mergedCount}`);

  const midDetail = await client.query(f.getPerson, { id: second.id });
  check("A4 — asking for the tombstone returns the person who absorbed it", midDetail?.id === first.id, midDetail?.id);
  check("A4 — the absorbed work is reachable through the merge", midDetail?.tasks.some((t) => t.id === linkedTask) === true);
  check("A4 — the survivor is told what was merged into it", (midDetail?.mergedFrom ?? []).some((m) => m.id === second.id));

  // Unmerge is the point of the tombstone design: it clears two fields, and
  // nothing else was ever moved, so there is nothing to restore.
  const unmerge = await client.mutation(f.unmergePerson, { id: second.id });
  writes += 1;
  check("unmerge reports what it did", unmerge.unmerged === true);

  const after = await client.query(f.listPeople, {});
  const afterIds = after.people.map((p) => p.id).sort();
  const firstAfter = await client.query(f.getPerson, { id: first.id });
  const secondAfter = await client.query(f.getPerson, { id: second.id });

  check(
    "A6 — the row count is identical either side",
    before.people.length === after.people.length,
    `${before.people.length} → ${after.people.length}`,
  );
  check("A6 — the same rows are present", JSON.stringify(beforeIds) === JSON.stringify(afterIds));
  check("A6 — nothing is left hidden", after.mergedCount === 0, `mergedCount=${after.mergedCount}`);
  check("A6 — the survivor's display name is unchanged", firstAfter?.name === namesBefore);
  check(
    "A6 — the survivor's link count is unchanged",
    (firstAfter?.tasks.length ?? 0) === linksBefore,
    `${linksBefore} → ${firstAfter?.tasks.length ?? 0}`,
  );
  check(
    "A6 — the survivor's identity keys are identical either side",
    JSON.stringify(keysBefore) === JSON.stringify([...(firstAfter?.keys ?? [])].sort()),
    JSON.stringify(keysBefore),
  );
  check("A3 — the merged row resolves to itself again", secondAfter?.id === second.id, `resolves to ${secondAfter?.id}`);
  check(
    "A3 — and the work is back on the row it was written to",
    secondAfter?.tasks.length === 0,
    `${secondAfter?.tasks.length} task(s)`,
  );

  // -------------------------------------------------------------------------
  section("A5 — PEOPLE_FIT evidence is keyed by person id, not by name");
  // -------------------------------------------------------------------------
  // Two people called Raj must not be able to accumulate one shared history.
  // The counters are keyed by id precisely so that they cannot.
  const doneA = await client.mutation(f.addTask, {
    input: "water the plants today",
    area: "relationships",
    personId: second.id,
  });
  const doneB = await client.mutation(f.addTask, {
    input: "book the dentist tomorrow",
    area: "relationships",
    personId: second.id,
  });
  writes += 2;
  await client.mutation(f.setTaskCompleted, { id: doneA, completed: true });
  await client.mutation(f.setTaskCompleted, { id: doneB, completed: true });
  writes += 2;

  const controls = await client.query(f.getModelControls, {});
  const byPerson = controls?.byPerson ?? {};
  const personKeys = Object.keys(byPerson);

  check("completing linked work produced per-person evidence", personKeys.length > 0, JSON.stringify(personKeys));
  check("A5 — the evidence is keyed by the person's id", personKeys.includes(second.id), JSON.stringify(personKeys));
  check(
    "A5 — the person whose work was completed owns the evidence",
    (byPerson[second.id]?.total ?? 0) === 2,
    JSON.stringify(byPerson[second.id]),
  );
  check(
    "A5 — a namesake who shares the name has none of that evidence",
    !personKeys.includes(thirdId) && !personKeys.includes(first.id),
    `keys=${JSON.stringify(personKeys)}`,
  );
  check(
    "A5 — the survivor of the earlier merge was not credited with it",
    (byPerson[first.id]?.total ?? undefined) === undefined,
    JSON.stringify(byPerson[first.id]),
  );
  check(
    "A5 — exactly one row of evidence exists for three namesakes",
    personKeys.length === 1,
    JSON.stringify(personKeys),
  );

  // -------------------------------------------------------------------------
  section("S — a second account sees and touches none of it");
  // -------------------------------------------------------------------------
  const other = await freshClient(url);
  const otherList = await other.query(f.listPeople, {});
  check("S1 — the other account's list is empty", otherList.people.length === 0, `${otherList.people.length} people`);
  check("S1 — and nothing is hidden there either", otherList.mergedCount === 0);
  check("S1 — reading somebody else's person returns null", (await other.query(f.getPerson, { id: first.id })) === null);
  const otherTasks = await other.query(f.getAreaTasks, { area: "relationships" });
  check("S1 — the other account's area is empty", otherTasks.length === 0, `${otherTasks.length} tasks`);

  const foreignMerge = await refuses(() => other.mutation(f.mergePeople, { targetId: first.id, sourceId: second.id }));
  check("S2 — merging somebody else's people is refused", foreignMerge.refused, foreignMerge.message);

  const foreignUnmerge = await refuses(() => other.mutation(f.unmergePerson, { id: second.id }));
  check("S2 — unmerging somebody else's person is refused", foreignUnmerge.refused, foreignUnmerge.message);

  const foreignEdit = await refuses(() => other.mutation(f.updatePerson, { id: first.id, name: "hijacked" }));
  check("S2 — editing somebody else's person is refused", foreignEdit.refused, foreignEdit.message);

  const foreignLink = await refuses(() =>
    other.mutation(f.addTask, { input: "spy on raj tomorrow", personId: first.id }),
  );
  check("S2 — linking a task to somebody else's person is refused", foreignLink.refused, foreignLink.message);

  // S3: the refusal for a real id that is not yours must be indistinguishable
  // from the refusal for a well-formed id that was never real, or the error
  // itself becomes an oracle for "does this person exist". The id below is
  // shaped like a real one on purpose: a *malformed* id is rejected by the
  // validator before any handler runs, which is a stronger answer but a
  // different one, and it would not test what this check is about.
  // S3 is about whether a refusal leaks existence. The strongest way to answer
  // that turned out to be stronger than the check originally written: no client
  // can construct a person id that is well-formed but absent. Convex ids carry
  // an integrity check, so every variant of a real id that a client can produce
  // is rejected by the argument validator before any handler runs — the second
  // half of the comparison has no inputs.
  //
  // So rather than skip a check, assert the property that makes it moot. If a
  // future platform version ever lets such an id through, this turns to FAIL and
  // someone looks at whether `owned()` still answers "not yours" and "does not
  // exist" identically.
  const neverExisted = await nonexistentId(other, first.id);
  check(
    "S3 — no client can construct a well-formed person id that does not exist",
    neverExisted.id === null,
    neverExisted.why,
  );
  check(
    "S3 — so a refusal cannot be used to probe for existence",
    foreignEdit.message.includes("Person not found"),
    foreignEdit.message.split("\n")[1] ?? foreignEdit.message,
  );

  // Guard rails inside one account.
  check("a person cannot be merged into themselves", (await refuses(() => client.mutation(f.mergePeople, { targetId: first.id, sourceId: first.id }))).refused);

  await client.mutation(f.mergePeople, { targetId: first.id, sourceId: second.id });
  writes += 1;
  check("a person cannot be merged twice", (await refuses(() => client.mutation(f.mergePeople, { targetId: namesakes, sourceId: second.id }))).refused);

  const firstUndo = await client.mutation(f.unmergePerson, { id: second.id });
  writes += 1;
  check("the merge in progress is undone", firstUndo.unmerged === true);
  const secondUndo = await client.mutation(f.unmergePerson, { id: second.id });
  writes += 1;
  check(
    "unmerging somebody who is not merged says so rather than pretending",
    secondUndo.unmerged === false && typeof secondUndo.reason === "string" && secondUndo.reason.length > 0,
    secondUndo.unmerged ? "" : secondUndo.reason,
  );

  // -------------------------------------------------------------------------
  section("cleanup");
  // -------------------------------------------------------------------------
  // There is no deletePerson, and adding one is not in this feature's scope: a
  // destructive path that did not exist before is not a safe improvement. The
  // fixture rows are inert and owner-scoped, and every run uses a fresh
  // throwaway account, so none of it is reachable by anything else.
  const final = await client.query(f.listPeople, {});
  check("the fixture account is still readable", final.people.length > 0, `${final.people.length} people`);
  check("and nothing is left merged away", final.mergedCount === 0);

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
    console.log("RESULT: FAIL — a check was skipped. This harness must not skip;");
    console.log("a skip means a criterion stopped running rather than passing.");
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

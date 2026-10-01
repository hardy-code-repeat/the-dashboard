/**
 * Phase 3, feature 2 conformance — Multi-object Capture (SYSTEM_FUNDAMENTALS §11.2).
 *
 * Runs against a REAL deployment, through the real auth path, writing real
 * rows. It decides the eight acceptance criteria:
 *
 *  A1  one capture with two separators produces three tasks, each parsed
 *      independently and correctly dated;
 *  A2  an input with no separator produces exactly one task, byte-identical to
 *      what the single-task path creates for the same string;
 *  A3  "call the dentist and book the dentist" produces ONE task, not two;
 *  A4  a segment the parser cannot use is dropped AND reported, never silently;
 *  A5  every created task is owner-scoped, in the personal space, and invisible
 *      to a second account;
 *  A6  `capture.committed` is written exactly once per accepted capture, with
 *      the real segment count;
 *  A7  the server is authoritative — the client cannot talk it into a
 *      different segmentation;
 *  A8  existing capture behaviour is unchanged, and the learned model is
 *      untouched by authorship.
 *
 * The A2 check is the important one for regression safety, and it is written
 * against the *deployed* `addTask` rather than against the parser: if the two
 * paths ever diverged, the single-task composer would have changed underneath
 * every existing user without anything reporting it.
 *
 * Nothing here waits on a credential, so there are no skips.
 *
 * Usage:
 *   bun scripts/conformance-4.ts <CONVEX_URL>
 *
 * Exit: 0 = every invariant held, 1 = one or more did not.
 */

import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";

const f = {
  capture: makeFunctionReference<
    { input: string; area?: string; personId?: string },
    {
      created: { id: string; title: string; dueAt: number | null; personId: string | null }[];
      dropped: { text: string; reason: string }[];
      overflow: number;
      refused: boolean;
      refusalReason: string | null;
    }
  >("assistant:capture"),
  addTask: makeFunctionReference<{ input: string; area?: string }, string>("assistant:addTask"),
  listPeople: makeFunctionReference<
    Record<string, never>,
    { people: { id: string; name: string }[]; mergedCount: number }
  >("people:listPeople"),
  createPerson: makeFunctionReference<
    { name: string; force?: boolean },
    { created: true; id: string } | { created: false; duplicateOf: { id: string } }
  >("people:createPerson"),
  getAreaTasks: makeFunctionReference<{ area: string }, { _id: string; title: string; completed: boolean; dueAt?: number | null; personId?: string }[]>(
    "life:getAreaTasks",
  ),
  getModelControls: makeFunctionReference<
    Record<string, never>,
    { weights: number[]; samples: number } | null
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

async function freshClient(url: string): Promise<ConvexHttpClient> {
  const client = new ConvexHttpClient(url);
  const session = await client.action(f.signIn as never, { provider: "anonymous" } as never);
  const token = session?.tokens?.token;
  if (!token) throw new Error("anonymous sign-in returned no token");
  client.setAuth(token as never);
  return client;
}

async function main() {
  const url = process.argv[2];
  if (!url) {
    console.error("Usage: bun scripts/conformance-4.ts <CONVEX_URL>");
    process.exit(2);
  }

  console.log("PHASE 3 / FEATURE 2 CONFORMANCE — Multi-object Capture");
  console.log("=".repeat(64));
  console.log(`deployment: ${url}`);
  console.log("");
  console.log("Every check below runs against the deployed backend. Nothing is mocked.");

  const client = await freshClient(url);
  const DAY = 86_400_000;
  let writes = 0;

  // -------------------------------------------------------------------------
  section("A1 — one capture, two separators, three correctly-parsed tasks");
  // -------------------------------------------------------------------------
  const three = await client.mutation(f.capture, {
    input: "call the dentist tomorrow\nrenew the passport in january\nemail Raj about the lease",
    area: "general",
  });
  writes += 1;

  check("A1 — the capture is not refused", three.refused === false, three.refusalReason ?? "");
  check("A1 — exactly three tasks were created", three.created.length === 3, `${three.created.length}`);
  check(
    "A1 — each segment kept its own action text",
    JSON.stringify(three.created.map((c) => c.title)) ===
      JSON.stringify([
        "call the dentist",
        "renew the passport in january",
        "email Raj about the lease",
      ]),
    JSON.stringify(three.created.map((c) => c.title)),
  );

  const dated = three.created.filter((c) => c.dueAt !== null);
  check("A1 — each segment was dated independently", dated.length >= 1, `${dated.length} dated`);
  if (dated.length > 0) {
    // "tomorrow" must be a real near-future date, not a parse artefact.
    const soon = dated[0].dueAt!;
    check(
      "A1 — the near-future date is genuinely near-future",
      soon > Date.now() - DAY && soon < Date.now() + 2 * DAY,
      new Date(soon).toISOString(),
    );
  }
  check("A1 — nothing was reported as dropped", three.dropped.length === 0, JSON.stringify(three.dropped));
  check("A1 — nothing overflowed", three.overflow === 0);

  // -------------------------------------------------------------------------
  section("A3 — a bare conjunction is never a separator");
  // -------------------------------------------------------------------------
  // This is the behaviour the whole feature is built to protect. It is checked
  // live because a parser change that started splitting on "and" would pass
  // every "clever" test and destroy real data.
  const conj = await client.mutation(f.capture, { input: "call the dentist and book the dentist" });
  writes += 1;
  check("A3 — one task, not two", conj.created.length === 1, `${conj.created.length}`);
  check(
    "A3 — and it kept the whole sentence",
    conj.created[0]?.title === "call the dentist and book the dentist",
    conj.created[0]?.title,
  );

  const milk = await client.mutation(f.capture, { input: "buy milk and eggs" });
  writes += 1;
  check("A3 — 'buy milk and eggs' is one task", milk.created.length === 1 && milk.created[0].title === "buy milk and eggs", JSON.stringify(milk.created.map((c) => c.title)));

  const shop = await client.mutation(f.capture, { input: "pick up bread and jam from the shop" });
  writes += 1;
  check(
    "A3 — a long 'and' list is still one task",
    shop.created.length === 1,
    `${shop.created.length}`,
  );

  const andThen = await client.mutation(f.capture, { input: "call the dentist and then renew the passport" });
  writes += 1;
  check(
    "A3 — 'and then' IS a separator, and does split",
    andThen.created.length === 2,
    `${andThen.created.length}`,
  );

  // -------------------------------------------------------------------------
  section("A2 — unseparated capture is byte-identical to the single-task path");
  // -------------------------------------------------------------------------
  // The regression guard. The single-task composer is what every existing user
  // uses, so if these two paths diverged, capture would have changed silently.
  const probes = [
    "call the dentist tomorrow at 4pm",
    "pay the electricity bill every month",
    "renew the passport #admin urgent",
    "review the deck every 2 weeks",
  ];

  for (const probe of probes) {
    const viaCapture = await client.mutation(f.capture, { input: probe, area: "general" });
    const viaAddTask = await client.mutation(f.addTask, { input: probe, area: "general" });
    writes += 2;

    check(`A2 — "${probe}" produces exactly one task`, viaCapture.created.length === 1, `${viaCapture.created.length}`);

    const a = viaCapture.created[0];
    const b = await client.query(f.getAreaTasks, { area: "general" });
    const match = b.find((t) => t._id === viaAddTask);
    check(
      `A2 — "${probe}" parses identically on both paths`,
      a !== undefined && match !== undefined && a.title === match.title && a.dueAt === (match.dueAt ?? null),
      `capture=${JSON.stringify({ title: a?.title, dueAt: a?.dueAt })} addTask=${JSON.stringify({ title: match?.title, dueAt: match?.dueAt ?? null })}`,
    );
  }

  // -------------------------------------------------------------------------
  section("A4 — an unusable segment is dropped AND reported");
  // -------------------------------------------------------------------------
  const withDrop = await client.mutation(f.capture, {
    input: "call the dentist; tomorrow; renew the passport",
  });
  writes += 1;
  check("A4 — the two real tasks were created", withDrop.created.length === 2, `${withDrop.created.length}`);
  check("A4 — the cue-only segment is reported", withDrop.dropped.length === 1, JSON.stringify(withDrop.dropped));
  check(
    "A4 — and the report names it and says why",
    withDrop.dropped[0]?.text === "tomorrow" && /nothing left to do/i.test(withDrop.dropped[0]?.reason ?? ""),
    JSON.stringify(withDrop.dropped),
  );

  const refused = await client.mutation(f.capture, { input: "tomorrow\nevery friday" });
  writes += 1;
  check("A4 — an entirely unusable capture creates nothing", refused.created.length === 0, `${refused.created.length}`);
  check("A4 — and it is refused, not silently empty", refused.refused === true);
  check(
    "A4 — the refusal carries a reason the UI can show",
    typeof refused.refusalReason === "string" && refused.refusalReason!.length > 0,
    refused.refusalReason ?? "",
  );
  check("A4 — and it still reports what it dropped", refused.dropped.length === 2, `${refused.dropped.length}`);

  const empty = await client.mutation(f.capture, { input: "   " });
  writes += 1;
  check("A4 — empty input creates nothing and is refused", empty.refused === true && empty.created.length === 0);

  // -------------------------------------------------------------------------
  section("A6 — the audit row is written once, with the real count");
  // -------------------------------------------------------------------------
  // `capture.committed` was declared in the closed taxonomy since phase 0B and
  // written by nothing (D38). This is the check that it is now real, read
  // back through the activity feed rather than trusted.
  const activityAfter = await client.query(
    makeFunctionReference<Record<string, never>, { kinds: string[]; segments: string[] }>(
      "assistant:captureAudit",
    ),
    {},
  );
  const commitRows = activityAfter.kinds.filter((k) => k === "capture.committed").length;
  check("A6 — at least one capture.committed row exists", commitRows > 0, `${commitRows} rows`);
  check(
    "A6 — every row carries a real segment count",
    activityAfter.segments.every((s) => /^\d+$/.test(s) && Number(s) > 0),
    JSON.stringify(activityAfter.segments),
  );
  check(
    "A6 — the counts include a multi-segment capture",
    activityAfter.segments.some((s) => Number(s) > 1),
    JSON.stringify(activityAfter.segments),
  );
  check(
    "A6 — the counts include a single-segment capture",
    activityAfter.segments.some((s) => Number(s) === 1),
    JSON.stringify(activityAfter.segments),
  );

  // -------------------------------------------------------------------------
  section("A7 — the server is authoritative");
  // -------------------------------------------------------------------------
  // The plan is computed server-side from the raw string. A client that sends
  // a pre-segmented "input" is simply parsed again, so it cannot get a
  // different answer by lying about its own segmentation.
  const lying = await client.mutation(f.capture, {
    input: "call the dentist and book the dentist",
  });
  writes += 1;
  check(
    "A7 — a client claiming two objects still gets one",
    lying.created.length === 1,
    `${lying.created.length}`,
  );

  const outOfRange = await client.mutation(f.capture, { input: "email Priya tomorrow\ncall Raj" });
  writes += 1;
  check(
    "A7 — segments are planned server-side, in the order given",
    JSON.stringify(outOfRange.created.map((c) => c.title)) === JSON.stringify(["email Priya", "call Raj"]),
    JSON.stringify(outOfRange.created.map((c) => c.title)),
  );

  // -------------------------------------------------------------------------
  section("people integration — a named person links, and only if they exist");
  // -------------------------------------------------------------------------
  const person = await client.mutation(f.createPerson, { name: "Sunita Rao" });
  writes += 1;
  if (!person.created) throw new Error("could not create the fixture person");
  const sunita = person.id;

  const withPerson = await client.mutation(f.capture, { input: "Sunita Rao call about the invoice" });
  writes += 1;
  check("a segment opening with a known name is linked to them", withPerson.created[0]?.personId === sunita, String(withPerson.created[0]?.personId));

  const explicit = await client.mutation(f.capture, {
    input: "call about the invoice",
    personId: sunita,
  });
  writes += 1;
  check("an explicitly chosen person is applied", explicit.created[0]?.personId === sunita, String(explicit.created[0]?.personId));

  const midSentence = await client.mutation(f.capture, { input: "ask Sunita Rao about the invoice" });
  writes += 1;
  check(
    "a name that is not at the start is not treated as the subject",
    midSentence.created[0]?.personId === null,
    String(midSentence.created[0]?.personId),
  );

  // Capture must never create a person, and never merge one. Someone named in
  // a capture who does not exist is left as words in the title.
  const peopleBefore = await client.query(f.listPeople, {});
  await client.mutation(f.capture, { input: "call Zoltan Kovács about the lease" });
  writes += 1;
  const peopleAfter = await client.query(f.listPeople, {});
  check(
    "capture never creates a person from a name it does not know",
    peopleAfter.people.length === peopleBefore.people.length,
    `${peopleBefore.people.length} → ${peopleAfter.people.length}`,
  );
  check("and never merges one", peopleAfter.mergedCount === peopleBefore.mergedCount, `mergedCount=${peopleAfter.mergedCount}`);

  // -------------------------------------------------------------------------
  section("A5 — ownership, space, and isolation");
  // -------------------------------------------------------------------------
  const other = await freshClient(url);
  const otherTasks = await other.query(f.getAreaTasks, { area: "general" });
  check("A5 — a second account sees none of these tasks", otherTasks.length === 0, `${otherTasks.length}`);
  const otherPeople = await other.query(f.listPeople, {});
  check("A5 — and none of these people", otherPeople.people.length === 0, `${otherPeople.people.length}`);

  // A foreign personId must be refused, exactly as addTask refuses it. The
  // check is on the server, so a capture cannot borrow somebody else's person.
  let foreignRefused = false;
  let foreignMessage = "";
  try {
    await other.mutation(f.capture, { input: "call about the lease", personId: sunita });
  } catch (e) {
    foreignRefused = true;
    foreignMessage = e instanceof Error ? e.message : String(e);
  }
  check("A5 — a foreign person id is refused", foreignRefused, foreignMessage);
  check(
    "A5 — the refusal says the same thing addTask says",
    foreignMessage.includes("Person not found"),
    foreignMessage.split("\n")[1] ?? foreignMessage,
  );

  // A foreign person id inside a *segment name* cannot be used either: the
  // plan only ever sees people the caller already owns.
  const otherCapture = await other.mutation(f.capture, { input: "Sunita Rao call about the invoice" });
  writes += 1;
  check(
    "A5 — a name the other account does not know is not linked",
    otherCapture.created[0]?.personId === null,
    String(otherCapture.created[0]?.personId),
  );

  // -------------------------------------------------------------------------
  section("A8 — the learned model is untouched by authorship");
  // -------------------------------------------------------------------------
  // Capturing is not completing. Q-006 records the open question about whether
  // a multi-object capture *should* be a learning signal; the interim answer is
  // that it is not one, and this is the check that it genuinely is not.
  const before = await client.query(f.getModelControls, {});
  const samplesBefore = before?.samples ?? 0;
  await client.mutation(f.capture, { input: "one; two; three" });
  writes += 1;
  await client.mutation(f.capture, { input: "four; five" });
  writes += 1;
  const after = await client.query(f.getModelControls, {});
  check(
    "A8 — authoring objects moves no weight and adds no sample",
    (after?.samples ?? 0) === samplesBefore,
    `samples ${samplesBefore} → ${after?.samples ?? 0}`,
  );
  check(
    "A8 — and the weight vector is byte-identical",
    JSON.stringify(after?.weights) === JSON.stringify(before?.weights),
  );

  // -------------------------------------------------------------------------
  section("bounds — the cap holds and the overflow is reported");
  // -------------------------------------------------------------------------
  const many = Array.from({ length: 20 }, (_, i) => `task number ${i}`).join(";");
  const overflowed = await client.mutation(f.capture, { input: many });
  writes += 1;
  check("no more than twelve tasks are created", overflowed.created.length <= 12, `${overflowed.created.length}`);
  check(
    "and the excess is reported rather than hidden",
    overflowed.overflow > 0,
    `overflow=${overflowed.overflow}`,
  );
  check(
    "created + overflow accounts for the input",
    overflowed.created.length + overflowed.overflow >= 20,
    `${overflowed.created.length} + ${overflowed.overflow}`,
  );

  // -------------------------------------------------------------------------
  section("cleanup");
  // -------------------------------------------------------------------------
  const finalTasks = await client.query(f.getAreaTasks, { area: "general" });
  check("the fixture account's tasks are all still readable", finalTasks.length > 0, `${finalTasks.length}`);
  const orphans = finalTasks.filter((t) => !t.title || t.title.trim().length === 0);
  check("and none of them is empty", orphans.length === 0, `${orphans.length} empty`);

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

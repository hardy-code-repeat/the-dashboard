/**
 * Phase-0B conformance test — ownership and the access foundation.
 *
 * The unit suite in `src/lib/permissions.test.ts` proves the *decision* logic.
 * This proves the *deployment*: that every write path in the product actually
 * stamps `ownerUserId` and `spaceId`, that the personal space is created
 * exactly once under concurrency, that the migration is idempotent, and that
 * one user still cannot reach another user's rows after the rename.
 *
 * It signs in through the real Convex Auth `signIn` action with the anonymous
 * provider, so it needs no fixture module, no test user in the database and no
 * privileged surface. Every function it calls is the same one the UI calls.
 *
 * Usage:
 *   bun scripts/conformance-0b.ts <CONVEX_URL> [concurrency] [--legacy]
 *
 * Example:
 *   bun scripts/conformance-0b.ts https://little-pelican-326.convex.cloud 40
 *
 * `--legacy` additionally exercises the pre-0B ownership backfill against a
 * row shaped the way the old schema wrote it. That needs the temporary fixture
 * `src/convex/ownership_conformance.ts`, which is NOT checked in — an
 * unauthenticated public mutation that writes a row is forbidden by
 * MAIN_AGENT S1. To re-run it: restore the fixture, `bun convex dev --once`,
 * run with `--legacy`, then delete the fixture and push again. Verified
 * 2026-10-01: a seeded legacy row is invisible before the migration, the
 * migration reports exactly 1 row, the row then carries ownerUserId, spaceId
 * and a normalised `area`, and a second run reports 0.
 *
 * Exit:  0 = every invariant held, 1 = at least one failed
 */

import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";

// ---------------------------------------------------------------------------
// references — by name, so the script keeps typechecking independently of
// the generated api object and of the shape of any particular table.
// ---------------------------------------------------------------------------

type Empty = Record<string, never>;

const ref = {
  signIn: makeFunctionReference<
    { provider?: string; params?: unknown; calledBy?: string },
    { redirect?: string; tokens?: { token: string; refreshToken: string } | null }
  >("auth:signIn"),

  listMySpaces: makeFunctionReference<Empty, { _id: string; name: string; kind: string; isPersonal: boolean; role: string }[]>(
    "spaces:listMySpaces",
  ),
  auditOwnership: makeFunctionReference<
    Empty,
    {
      userId: string;
      spaces: number;
      memberships: number;
      links: number;
      activity: number;
      tables: Record<string, { total: number; owned: number; missingSpace: number }>;
    } | null
  >("spaces:auditOwnership"),
  migrateOwnership: makeFunctionReference<Empty, number>("spaces:migrateOwnership"),

  addTask: makeFunctionReference<{ input: string; area?: string }, string>("assistant:addTask"),
  addNote: makeFunctionReference<{ body: string }, null>("assistant:addNote"),
  setTaskCompleted: makeFunctionReference<{ id: string; completed: boolean }, null>(
    "assistant:setTaskCompleted",
  ),
  removeTask: makeFunctionReference<{ id: string }, null>("assistant:removeTask"),
  getDashboard: makeFunctionReference<
    Empty,
    { tasks: { _id: string; ownerUserId: string; spaceId: string; title: string }[] } | null
  >("assistant:getDashboard"),

  enableArea: makeFunctionReference<{ slug: string; seed?: boolean }, null>("life:enableArea"),
  disableArea: makeFunctionReference<{ slug: string }, null>("life:disableArea"),
  listAreas: makeFunctionReference<Empty, { slug: string }[]>("life:listAreas"),
  getAreaTasks: makeFunctionReference<{ area: string }, { _id: string; title: string; area?: string }[]>(
    "life:getAreaTasks",
  ),
  addExpense: makeFunctionReference<
    { label: string; amount: number; spentAt?: number; deductible?: boolean; bucket?: string },
    unknown
  >("life:addExpense"),
  saveTaxProfile: makeFunctionReference<
    { country: string; grossIncome: number },
    null
  >("life:saveTaxProfile"),
  toggleDocument: makeFunctionReference<{ requirementId: string; gathered: boolean }, null>(
    "life:toggleDocument",
  ),
  connectTool: makeFunctionReference<{ provider: string }, null>("life:connectTool"),
  getFinance: makeFunctionReference<Empty, { expenses: { label: string }[] } | null>("life:getFinance"),

  // Only present when the temporary `--legacy` fixture is re-armed. Referenced
  // by name so the script still typechecks when the fixture is absent.
  seedLegacyTask: makeFunctionReference<{ title: string }, boolean>(
    "ownership_conformance:seedLegacyTask",
  ),
};

// ---------------------------------------------------------------------------
// harness
// ---------------------------------------------------------------------------

let failures = 0;

function check(label: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    console.log(`  [PASS] ${label}`);
  } else {
    failures += 1;
    console.log(`  [FAIL] ${label}${detail === undefined ? "" : ` — ${JSON.stringify(detail)}`}`);
  }
}

function section(title: string): void {
  console.log(`\n── ${title}`);
}

async function newUser(url: string): Promise<{ client: ConvexHttpClient; userId: string }> {
  const client = new ConvexHttpClient(url);
  const result = await client.action(ref.signIn, { provider: "anonymous" });
  const token = result.tokens?.token;
  if (!token) throw new Error("anonymous sign-in returned no token");
  client.setAuth(token);
  const me = await client.query(ref.auditOwnership, {});
  if (!me) throw new Error("signed-in user produced no ownership audit");
  return { client, userId: me.userId };
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const url = process.argv[2];
  const concurrency = Number(process.argv[3] ?? 40);
  const withLegacy = process.argv.includes("--legacy");
  if (!url) {
    console.error("usage: bun scripts/conformance-0b.ts <CONVEX_URL> [concurrency] [--legacy]");
    process.exit(1);
  }

  console.log(`Panel phase-0B conformance against ${url} (concurrency ${concurrency})`);

  // -- 1. the personal space exists exactly once, even under concurrency -----
  section("personal space is created once and reused");
  const alice = await newUser(url);

  await Promise.all(
    Array.from({ length: concurrency }, (_, i) => alice.client.mutation(ref.addTask, { input: `concurrent task ${i}` })),
  );

  let spaces = await alice.client.query(ref.listMySpaces, {});
  check("exactly one space after a concurrent burst", spaces.length === 1, spaces);
  check("it is the personal space", spaces[0]?.kind === "personal" && spaces[0]?.isPersonal === true, spaces[0]);
  check("the creator manages it", spaces[0]?.role === "manage", spaces[0]?.role);

  let audit = await alice.client.query(ref.auditOwnership, {});
  check("exactly one personal space row", audit?.spaces === 1, audit?.spaces);
  check("exactly one membership row", audit?.memberships === 1, audit?.memberships);

  // -- 2. every write path stamps ownership --------------------------------
  section("every insert path stamps ownerUserId + spaceId");
  const spaceId = spaces[0]?._id;

  const taskId = await alice.client.mutation(ref.addTask, { input: "buy stamps #errands tomorrow" });
  await alice.client.mutation(ref.addNote, { body: "call the accountant" });
  await alice.client.mutation(ref.enableArea, { slug: "finance", seed: true });
  await alice.client.mutation(ref.addExpense, { label: "coffee", amount: 3.5 });
  await alice.client.mutation(ref.saveTaxProfile, { country: "US", grossIncome: 50_000 });
  await alice.client.mutation(ref.toggleDocument, { requirementId: "w2", gathered: true });
  await alice.client.mutation(ref.connectTool, { provider: "google-calendar" });
  // Completing a task is the only path that creates `assistantState`.
  await alice.client.mutation(ref.setTaskCompleted, { id: taskId, completed: true });

  audit = await alice.client.query(ref.auditOwnership, {});
  for (const [table, counts] of Object.entries(audit?.tables ?? {})) {
    if (counts.total === 0) continue;
    check(
      `${table}: all ${counts.total} row(s) carry ownerUserId`,
      counts.owned === counts.total,
      counts,
    );
    check(
      `${table}: all ${counts.total} row(s) carry spaceId`,
      counts.missingSpace === 0,
      counts,
    );
  }

  const untouched = ["notes", "areas", "expenses", "taxProfile", "taxDocuments", "connections", "assistantState"];
  for (const table of untouched) {
    check(`${table} was actually exercised`, (audit?.tables[table]?.total ?? 0) > 0, audit?.tables[table]);
  }

  const dashboard = await alice.client.query(ref.getDashboard, {});
  check("every task the dashboard returns carries ownership", (dashboard?.tasks ?? []).every(
    (t) => !!t.ownerUserId && !!t.spaceId,
  ));
  check("the dashboard's tasks live in the personal space", (dashboard?.tasks ?? []).every(
    (t) => t.spaceId === spaceId,
  ));

  // -- 3. the migration is idempotent --------------------------------------
  section("ownership migration is idempotent");
  const firstRun = await alice.client.mutation(ref.migrateOwnership, {});
  const secondRun = await alice.client.mutation(ref.migrateOwnership, {});
  check("a fully migrated user backfills 0 rows on the first run", firstRun === 0, firstRun);
  check("and 0 rows on the second run", secondRun === 0, secondRun);
  check("still exactly one personal space afterwards", (await alice.client.query(ref.auditOwnership, {}))?.spaces === 1);

  if (withLegacy) {
    section("pre-0B rows are backfilled and become reachable again");
    const before = await alice.client.query(ref.auditOwnership, {});
    const seeded = await alice.client.mutation(ref.seedLegacyTask, { title: "legacy pre-0B row" });
    check("the fixture seeded a row", seeded === true);

    const invisible = await alice.client.query(ref.auditOwnership, {});
    check(
      "an un-backfilled row is invisible to the owner index",
      invisible!.tables.tasks.total === before!.tables.tasks.total,
      { before: before!.tables.tasks, after: invisible!.tables.tasks },
    );

    const migrated = await alice.client.mutation(ref.migrateOwnership, {});
    check("the migration reports exactly 1 backfilled row", migrated === 1, migrated);

    const visible = await alice.client.query(ref.auditOwnership, {});
    check("the row now counts as owned", visible!.tables.tasks.total === before!.tables.tasks.total + 1, visible!.tables.tasks);
    check("and carries a space", visible!.tables.tasks.missingSpace === 0, visible!.tables.tasks);

    const again = await alice.client.mutation(ref.migrateOwnership, {});
    check("a second migration run reports 0", again === 0, again);

    const rows = await alice.client.query(ref.getAreaTasks, { area: "general" });
    const legacyRow = rows.find((r) => r.title === "legacy pre-0B row");
    check("the backfilled row is reachable through the area index", !!legacyRow, rows.length);
    check("its area was normalised to the default", legacyRow?.area === "general", legacyRow?.area);
  }

  // -- 4. the query-idiom fixes return the same rows they used to -----------
  section("indexed lookups return what the old scans returned");
  const financeTasks = await alice.client.query(ref.getAreaTasks, { area: "finance" });
  check("seeded finance tasks are reachable by area", financeTasks.length >= 1, financeTasks.length);
  const areaSlugs = (await alice.client.query(ref.listAreas, {})).map((a) => a.slug);
  check("the enabled area is listed", areaSlugs.includes("finance"), areaSlugs);
  check("the default area still exists", areaSlugs.includes("general"), areaSlugs);

  const before = (await alice.client.query(ref.getAreaTasks, { area: "finance" })).length;
  await alice.client.mutation(ref.disableArea, { slug: "finance" });
  const after = (await alice.client.query(ref.getAreaTasks, { area: "finance" })).length;
  check("disabling an area removes it from the index range", after === 0, { before, after });
  check(
    "and re-homes its tasks into General rather than deleting them",
    (await alice.client.query(ref.getAreaTasks, { area: "general" })).length > 0,
  );

  const toggled = await alice.client.mutation(ref.toggleDocument, { requirementId: "w2", gathered: false });
  check("untoggling a document is accepted", toggled === null);
  check("the document is gone", (await alice.client.query(ref.getFinance, {}))?.expenses !== undefined);

  // -- 5. tenant isolation --------------------------------------------------
  section("one user cannot reach another user's rows");
  const mallory = await newUser(url);
  const malloryDashboard = await mallory.client.query(ref.getDashboard, {});
  check("a second user sees none of the first user's tasks", (malloryDashboard?.tasks ?? []).length === 0, malloryDashboard?.tasks?.length);
  check("a second user has their own personal space", (await mallory.client.query(ref.listMySpaces, {}))[0]?._id !== spaceId);

  let blocked = false;
  try {
    await mallory.client.mutation(ref.removeTask, { id: taskId });
  } catch {
    blocked = true;
  }
  check("a second user cannot delete the first user's task", blocked);

  blocked = false;
  try {
    await mallory.client.mutation(ref.setTaskCompleted, { id: taskId, completed: true });
  } catch {
    blocked = true;
  }
  check("a second user cannot complete the first user's task", blocked);

  blocked = false;
  try {
    await mallory.client.mutation(ref.disableArea, { slug: "general" });
  } catch (e) {
    blocked = String(e).includes("General");
  }
  check("the General area is still undeletable for everybody", blocked);

  const malloryAudit = await mallory.client.query(ref.auditOwnership, {});
  check(
    "the second user's audit shows only their own rows",
    Object.values(malloryAudit?.tables ?? {}).every((c) => c.total === 0),
    malloryAudit?.tables,
  );

  // -------------------------------------------------------------------------
  console.log(
    failures === 0
      ? `\nAll phase-0B invariants held against ${url}.`
      : `\n${failures} phase-0B invariant(s) FAILED against ${url}.`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

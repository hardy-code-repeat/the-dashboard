/**
 * The Custom Pages harness — by an attacker, against the live deployment.
 *
 * ## What this is for
 *
 * Custom Pages is the first feature since the Admin Control Centre that adds a
 * table the user writes to, so it gets the same treatment from the outside
 * rather than a set of unit fixtures that prove the code agrees with itself.
 * Unit tests (`src/lib/customPages.test.ts`) establish the rules; this file
 * establishes that the **deployment** enforces them, because a validator that
 * exists only in the client is not a validator.
 *
 * ## The three claims under test
 *
 * 1. **The closed vocabulary holds server-side.** Every refusal here is
 *    attempted against `createPage` directly, not through the UI. A block kind
 *    the product does not recognise must be rejected by the database layer; if
 *    it is merely hidden in the interface, the EAV door is open (ADR-007).
 * 2. **A page belongs to exactly one person.** Two anonymous identities, and
 *    the second tries to delete the first's page. Ownership must be
 *    indistinguishable from "does not exist", so the probe cannot even confirm
 *    the page is real.
 * 3. **Nothing was added to attention.** A saved view cannot nag. This is
 *    asserted against the live attention feed rather than by reading the code,
 *    because a rule that "cannot" fire is only proved by observing that it
 *    does not.
 *
 * Usage: `bun scripts/conformance-pages.ts <CONVEX_URL>`
 * Exit: 0 = every boundary held, 1 = one or more did not.
 */

import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";

const f = {
  signIn: makeFunctionReference<unknown, { tokens?: { token: string } | null }>("auth:signIn"),
  currentUser: makeFunctionReference<Record<string, never>, unknown>("users:currentUser"),
  createPage: makeFunctionReference<
    unknown,
    { name: string; area: string; blocks: Array<{ kind: string }> }
  >("customPages:createPage"),
  listPages: makeFunctionReference<unknown, Record<string, never>, unknown>("customPages:listPages"),
  deletePage: makeFunctionReference<unknown, { id: string }, unknown>("customPages:deletePage"),
  updatePage: makeFunctionReference<unknown, Record<string, unknown>, unknown>("customPages:updatePage"),
  getAttention: makeFunctionReference<unknown, Record<string, never>, unknown>("attention:getAttention"),
};

/** Mirrored from src/lib/readLimits.ts — asserted, not assumed, below. */
const PAGES = 50;
const PAGE_MAX_BLOCKS = 12;

const failures: string[] = [];
const notes: string[] = [];

/**
 * Something this harness genuinely cannot show, stated rather than left implicit.
 *
 * The first draft of this file declared `notes` and printed a NOT VERIFIED block
 * but **never pushed to it**, so the block was structurally incapable of firing —
 * a disclosure that looks like a disclosure and says nothing, which is D78's
 * shape one level up. Dead reporting is worse than no reporting, because a
 * reader sees the apparatus and concludes the gap was handled.
 *
 * So the note below is a real gap in this harness's coverage, stated on purpose.
 */
function note(label: string, detail: string): void {
  console.log(`  [NOTE] ${label} — ${detail}`);
  notes.push(label);
}

function section(title: string): void {
  console.log(`\n── ${title} ${"─".repeat(Math.max(0, 62 - title.length))}`);
}

function check(label: string, ok: boolean, detail = ""): void {
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(label);
}



/** True when the call was refused: it threw, or returned nothing usable. */
async function refused(fn: () => Promise<unknown>): Promise<{ refused: boolean; got?: unknown }> {
  try {
    const got = await fn();
    const empty =
      got === null ||
      got === undefined ||
      (Array.isArray(got) && got.length === 0);
    return { refused: empty, got };
  } catch {
    return { refused: true };
  }
}

async function guest(
  url: string,
): Promise<{ client: ConvexHttpClient; token: string; userId: string }> {
  const client = new ConvexHttpClient(url);
  const session = (await client.action(f.signIn as never, {
    provider: "anonymous",
  } as never)) as { tokens?: { token: string } | null };
  const token = session?.tokens?.token;
  if (!token) throw new Error("anonymous sign-in returned no token");
  client.setAuth(token as never);
  const user = (await client.query(f.currentUser as never, {} as never)) as {
    _id?: string;
  } | null;
  return { client, token, userId: user?._id ?? "" };
}

type PageRow = { id: string; name: string; area: string; blocks: Array<{ kind: string }> };
type ListResult = { pages: PageRow[]; capped: boolean };

async function main(): Promise<void> {
  const url = process.argv[2];
  if (!url) {
    console.error("usage: bun scripts/conformance-pages.ts <CONVEX_URL>");
    process.exit(2);
  }

  const a = await guest(url);
  const b = await guest(url);
  console.log(`A: ${a.userId}\nB: ${b.userId}`);

  // -------------------------------------------------------------------------
  section("P1 — the closed vocabulary is enforced by the server");
  // Every one of these is attempted against createPage directly. If any is
  // accepted, the vocabulary is decorative.
  const refusedCases: Array<[string, { name: string; area: string; blocks: Array<{ kind: string }> }]> = [
    ["an empty block list", { name: "p1-empty", area: "general", blocks: [] }],
    ["an unknown block kind", { name: "p1-unknown", area: "general", blocks: [{ kind: "horoscope" }] }],
    ["a custom-shaped block", { name: "p1-custom", area: "general", blocks: [{ kind: "custom" }] }],
    ["a duplicate block", { name: "p1-dup", area: "general", blocks: [{ kind: "money" }, { kind: "money" }] }],
    ["an empty name", { name: "   ", area: "general", blocks: [{ kind: "money" }] }],
    ["an area outside the union", { name: "p1-area", area: "astrology", blocks: [{ kind: "money" }] }],
    [
      "more blocks than the cap",
      {
        name: "p1-many",
        area: "general",
        blocks: Array.from({ length: PAGE_MAX_BLOCKS + 1 }, (_, i) => ({
          kind: ["headline", "taskList", "people", "money"][i % 4],
        })),
      },
    ],
  ];

  let n = 1;
  for (const [label, args] of refusedCases) {
    const r = await refused(() => a.client.mutation(f.createPage as never, args as never));
    check(`P1.${n++} ${label} refused`, r.refused, r.refused ? "" : `ACCEPTED: ${JSON.stringify(r.got)}`);
  }

  // -------------------------------------------------------------------------
  section("P2 — a valid page round-trips, in order, with no extra fields");
  const created = (await a.client.mutation(f.createPage as never, {
    name: "Morning",
    area: "general",
    blocks: [{ kind: "headline" }, { kind: "money" }, { kind: "note" }],
  } as never)) as string;

  let list = (await a.client.query(f.listPages as never, {} as never)) as ListResult;
  const mine = list.pages.find((p) => p.id === created);
  check("P2.1 the created page is listed", mine !== undefined);
  check(
    "P2.2 block order is preserved",
    JSON.stringify(mine?.blocks) === JSON.stringify([{ kind: "headline" }, { kind: "money" }, { kind: "note" }]),
    JSON.stringify(mine?.blocks),
  );
  check(
    "P2.3 a block carries a kind and nothing else",
    mine !== undefined && mine.blocks.every((b) => Object.keys(b).length === 1),
    JSON.stringify(mine?.blocks[0]),
  );
  check("P2.4 the page row carries no user-defined field", mine !== undefined && Object.keys(mine).sort().join(",") === "area,blocks,id,name");

  // A second page, created here while there is room. P4 later saturates this
  // account at the cap on purpose, so anything that needs a spare page must
  // make it before then — the first draft of P8 created it afterwards and was
  // refused by the very cap it had just proven works.
  const second = (await a.client.mutation(f.createPage as never, {
    name: "Evening",
    area: "general",
    blocks: [{ kind: "note" }],
  } as never)) as string;

  // -------------------------------------------------------------------------
  section("P3 — one person's page is not another's to read or delete");
  const bList = (await b.client.query(f.listPages as never, {} as never)) as ListResult;
  check(
    "P3.1 B cannot see A's page in a list",
    !bList.pages.some((p) => p.id === created),
    `${bList.pages.length} page(s) visible to B`,
  );
  const del = await refused(() => b.client.mutation(f.deletePage as never, { id: created } as never));
  check("P3.2 B cannot delete A's page", del.refused, del.refused ? "" : `SUCCEEDED: ${JSON.stringify(del.got)}`);
  list = (await a.client.query(f.listPages as never, {} as never)) as ListResult;
  check(
    "P3.3 A's page survived B's attempt",
    list.pages.some((p) => p.id === created),
  );

  // -------------------------------------------------------------------------
  section("P4 — the cap holds on write, and nothing is falsely reported as truncated");
  // A is at 1. Create up to PAGES total, then assert both the refusal and the
  // read receipt. The receipt matters as much as the refusal: a page silently
  // missing from a list the user can scroll is a page they cannot find.
  let refusedAt: number | null = null;
  for (let i = list.pages.length; i < PAGES + 2; i++) {
    const r = await refused(() =>
      a.client.mutation(f.createPage as never, {
        name: `fill-${i}`,
        area: "general",
        blocks: [{ kind: "note" }],
      } as never),
    );
    if (r.refused) {
      refusedAt = i;
      break;
    }
  }
  check("P4.1 writes are refused at the cap", refusedAt !== null, refusedAt === null ? "never refused" : `refused at page #${refusedAt}`);

  list = (await a.client.query(f.listPages as never, {} as never)) as ListResult;
  check("P4.2 the read is bounded by the cap", list.pages.length === PAGES, `${list.pages.length} rows`);

  // P4.3 is the check this harness got wrong on its first run, and the wrong
  // version is the interesting one.
  //
  // It originally asserted `capped === true` here, on the reasoning that the
  // read was at its cap so it should say so. It does not, and it should not:
  // the **write** path refuses the 51st page, so a user can never hold more
  // than `PAGES`, so the read's `cap + 1` probe never finds the extra row and
  // the receipt never fires. Asserting it must fire asserts a state the product
  // cannot reach — which is how a harness ends up reporting green for a
  // behaviour nobody can observe.
  //
  // The reachable truth is the stronger claim in the other direction: at
  // exactly the cap, Panel must **not** claim truncation, because nothing has
  // been truncated. A product that cried "showing your 50 most recent" while
  // holding exactly 50 would be D68's defect again — UI copy outrunning the
  // backend.
  check(
    "P4.3 a full-but-untruncated page list does NOT claim truncation",
    list.capped === false,
    `capped=${list.capped} at exactly ${list.pages.length} pages`,
  );

  // -------------------------------------------------------------------------
  section("P5 — a page adds nothing to attention (ADR-033, ADR-006)");
  const att = (await a.client.query(f.getAttention as never, {} as never)) as {
    sections?: Array<{ items?: unknown[] }>;
  } | null;
  const kinds = new Set<string>();
  for (const s of att?.sections ?? []) {
    for (const it of (s.items ?? []) as Array<{ kind?: string }>) {
      if (typeof it.kind === "string") kinds.add(it.kind);
    }
  }
  check(
    "P5.1 no attention item names a page",
    ![...kinds].some((k) => k.includes("page")),
    `kinds: ${[...kinds].sort().join(", ") || "none"}`,
  );

  // -------------------------------------------------------------------------
  section("P8 — a saved page can be changed, and only by its owner");
  // `second` already exists from P2, so "did editing move this page to the
  // end?" is observable. If updatePage replaced-and-reinserted instead of
  // patching, createdAt would change and `created` would drop below `second`.
  const before8 = (await a.client.query(f.listPages as never, {} as never)) as ListResult;
  const posBefore = before8.pages.findIndex((p) => p.id === created);

  const bUpdate = await refused(() =>
    b.client.mutation(f.updatePage as never, {
      id: created,
      name: "Stolen",
    } as never),
  );
  check("P8.1 B cannot update A's page", bUpdate.refused, bUpdate.refused ? "" : `SUCCEEDED: ${JSON.stringify(bUpdate.got)}`);

  const badUpdates: Array<[string, Record<string, unknown>]> = [
    ["an unknown block kind", { id: created, blocks: [{ kind: "horoscope" }] }],
    ["an emptied block list", { id: created, blocks: [] }],
    ["a duplicate block", { id: created, blocks: [{ kind: "money" }, { kind: "money" }] }],
    ["an empty name", { id: created, name: "   " }],
    ["an area outside the union", { id: created, area: "astrology" }],
  ];
  let m = 1;
  for (const [label, args] of badUpdates) {
    const r = await refused(() => a.client.mutation(f.updatePage as never, args as never));
    check(`P8.${++m} an update with ${label} refused`, r.refused, r.refused ? "" : `ACCEPTED: ${JSON.stringify(r.got)}`);
  }

  // Atomicity: the mixed update below carries a VALID name and an INVALID
  // area. A patch that applied as it validated would leave the renamed page
  // behind — a state the user never asked for and cannot reproduce.
  const beforeBad = (await a.client.query(f.listPages as never, {} as never)) as ListResult;
  await a.client.mutation(f.updatePage as never, { id: created, name: "HalfApplied", area: "astrology" } as never).catch(() => {});
  const afterBad = (await a.client.query(f.listPages as never, {} as never)) as ListResult;
  check(
    "P8.7 a partly-invalid update writes nothing at all",
    beforeBad.pages.find((p) => p.id === created)?.name ===
      afterBad.pages.find((p) => p.id === created)?.name,
    `${beforeBad.pages.find((p) => p.id === created)?.name} -> ${afterBad.pages.find((p) => p.id === created)?.name}`,
  );

  await a.client.mutation(f.updatePage as never, {
    id: created,
    name: "Morning, revised",
    area: "finance",
    blocks: [{ kind: "people" }, { kind: "headline" }],
  } as never);

  const after8 = (await a.client.query(f.listPages as never, {} as never)) as ListResult;
  const edited = after8.pages.find((p) => p.id === created);
  check("P8.8 the new name is stored", edited?.name === "Morning, revised", edited?.name);
  check("P8.9 the new area is stored", edited?.area === "finance", edited?.area);
  check(
    "P8.10 the new block order is stored exactly",
    JSON.stringify(edited?.blocks) === JSON.stringify([{ kind: "people" }, { kind: "headline" }]),
    JSON.stringify(edited?.blocks),
  );
  check(
    "P8.11 editing does not move the page to the end of the list",
    after8.pages.findIndex((p) => p.id === created) === posBefore,
    `position ${posBefore} -> ${after8.pages.findIndex((p) => p.id === created)}`,
  );
  check(
    "P8.12 the other page is untouched",
    after8.pages.find((p) => p.id === second)?.name === "Evening",
  );

  // -------------------------------------------------------------------------
  section("P6 — deletion removes the view and only the view");
  const before = (await a.client.query(f.listPages as never, {} as never)) as ListResult;
  await a.client.mutation(f.deletePage as never, { id: created } as never);
  const after = (await a.client.query(f.listPages as never, {} as never)) as ListResult;
  check("P6.1 the page is gone", !after.pages.some((p) => p.id === created));
  check(
    "P6.2 the other pages are untouched",
    after.pages.length === Math.min(before.pages.length - 1, PAGES),
    `${before.pages.length} -> ${after.pages.length}`,
  );
  const gone = await refused(() => a.client.mutation(f.deletePage as never, { id: created } as never));
  check("P6.3 deleting it twice is refused", gone.refused);

  // -------------------------------------------------------------------------
  section("P7 — what this harness cannot show");
  // Stated here rather than in the changelog alone, so a reader who ran this
  // file sees the same limit the changelog records.
  note(
    "the Custom Pages interface has never been rendered in a browser",
    "every check above drives the backend directly, so it establishes that the " +
      "deployment enforces the rules and not that the saved arrangement reads " +
      "well. Visual confirmation is outstanding.",
  );
  note(
    "delete is exercised as a mutation, not through ConfirmAction",
    "P6 proves the mutation refuses correctly; whether the confirmation dialog " +
      "is the only path to it is a static property, gated by spec-drift's " +
      "destructive-actions check rather than by this harness.",
  );

  console.log("\n" + "=".repeat(68));
  if (notes.length > 0) {
    console.log("NOT VERIFIED (reported, not counted as passes):");
    for (const x of notes) console.log(`  - ${x}`);
  }
  if (failures.length > 0) {
    console.log(`RESULT: FAIL — ${failures.length} of ${PAGES} boundaries did not hold:`);
    for (const f of failures) console.log(`  - ${f}`);
    console.log("=".repeat(68));
    process.exit(1);
  }
  console.log("RESULT: PASS — every Custom Pages boundary held.");
  console.log("=".repeat(68));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
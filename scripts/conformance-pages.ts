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

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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
  createSpace: makeFunctionReference<unknown, { name: string; kind: string }, unknown>("spaces:createSpace"),
  getAttention: makeFunctionReference<unknown, Record<string, never>, unknown>("attention:getAttention"),
};

/**
 * Mirrored from the product source — and the mirror is **checked**, because a
 * harness that hard-codes a cap it believes in tests nothing.
 *
 * The first draft of this file carried the comment "asserted, not assumed,
 * below" above two literal numbers and then never asserted anything. If the
 * owner had raised `PAGES` to 200, this harness would have kept proving the
 * deployment refuses a 51st page — a green run against a cap that no longer
 * existed. A claim in a comment is not a check; this is the same defect as the
 * dead `notes` block below, one level down: apparatus that looks like a
 * guarantee and performs none.
 *
 * So the numbers are read out of the real files and compared, and a mismatch is
 * a **failure of this harness**, not something to paper over by editing the
 * mirror to match.
 */
const SRC = {
  readLimits: readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "src", "lib", "readLimits.ts"),
    "utf8",
  ),
  pages: readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "src", "lib", "customPages.ts"),
    "utf8",
  ),
  backend: readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "src", "convex", "customPages.ts"),
    "utf8",
  ),
  renderer: readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "src", "components", "CustomPages.tsx"),
    "utf8",
  ),
  templates: readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "src", "lib", "pageTemplates.ts"),
    "utf8",
  ),
  schema: readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "src", "convex", "schema.ts"),
    "utf8",
  ),
};

/** The value of a `export const NAME = <number>;` in src/lib/readLimits.ts. */
function limitNumber(name: string): number | null {
  const m = SRC.readLimits.match(new RegExp(`export const ${name} = (\\d+);`));
  return m ? Number(m[1]) : null;
}

/** The `PAGE_BLOCK_KINDS` array literal, parsed from src/lib/customPages.ts. */
function productBlockKinds(): string[] {
  const start = SRC.pages.indexOf("export const PAGE_BLOCK_KINDS = [");
  const end = SRC.pages.indexOf("] as const", start);
  if (start < 0 || end < start) return [];
  return [...SRC.pages.slice(start, end).matchAll(/"([a-zA-Z]+)"/g)].map((m) => m[1]);
}

/** The `PAGE_TEMPLATES` catalogue, parsed out of src/lib/pageTemplates.ts. */
function productTemplates(): Array<{ id: string; name: string; area: string; blocks: string[] }> {
  const start = SRC.templates.indexOf("const CATALOGUE = [");
  const end = SRC.templates.indexOf("] as const", start);
  if (start < 0 || end < start) return [];
  const body = SRC.templates.slice(start, end);
  const out: Array<{ id: string; name: string; area: string; blocks: string[] }> = [];
  for (const entry of body.split(/\n  \{\n/).slice(1)) {
    const id = /id:\s*"([^"]+)"/.exec(entry)?.[1];
    const name = /name:\s*"([^"]+)"/.exec(entry)?.[1];
    const area = /area:\s*"([^"]+)"/.exec(entry)?.[1];
    const array = /blocks:\s*\[([^\]]*)\]/.exec(entry)?.[1] ?? "";
    const blocks = [...array.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    if (id && name && area) out.push({ id, name, area, blocks });
  }
  return out;
}

const PAGES = limitNumber("PAGES") ?? -1;
const PAGE_MAX_BLOCKS = limitNumber("PAGE_MAX_BLOCKS") ?? -1;

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
  const r = await reject(fn);
  return { refused: r.refused, got: r.got };
}

/**
 * `refused`, but keeping the server's own words.
 *
 * Most refusals only need to be refusals. The ones that matter are the ones
 * where a *second* guard could be producing the refusal for the wrong reason,
 * and the only way to tell two guards apart is to read which one spoke. See
 * P1.7, which was green with the block cap deleted.
 */
async function reject(
  fn: () => Promise<unknown>,
): Promise<{ refused: boolean; got?: unknown; message: string }> {
  try {
    const got = await fn();
    const empty =
      got === null ||
      got === undefined ||
      (Array.isArray(got) && got.length === 0);
    return { refused: empty, got, message: "" };
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e);
    // Convex's HTTP client puts the real server text on the lines *after*
    // `[Request ID: …] Server Error`, newline-separated, with a stack trace
    // under it. Left alone that prints across several lines and reads like a
    // crash in the middle of a passing run — which is exactly how this file
    // was misread while a mutation was in place. One line, no stack.
    const message = raw
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(0, 2)
      .join(" | ");
    return { refused: true, message };
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
  section("P0 — the harness agrees with the product it is testing");
  // Every number below was read out of `src/`, not typed in here. If a mirror
  // drifts, that is this file being wrong about what it is proving, so it is a
  // failure rather than a warning: a harness that silently tests an old cap is
  // worse than no harness, because it reports green.
  const KINDS = productBlockKinds();
  check(
    "P0.1 the page cap this harness tests is the product's page cap",
    PAGES > 0 && limitNumber("PAGES") === PAGES,
    `src/lib/readLimits.ts PAGES = ${limitNumber("PAGES")}`,
  );
  check(
    "P0.2 the block cap this harness tests is the product's block cap",
    PAGE_MAX_BLOCKS > 0 && limitNumber("PAGE_MAX_BLOCKS") === PAGE_MAX_BLOCKS,
    `src/lib/readLimits.ts PAGE_MAX_BLOCKS = ${limitNumber("PAGE_MAX_BLOCKS")}`,
  );
  check(
    "P0.3 the block vocabulary this harness builds payloads from is the product's",
    KINDS.length > 0 && KINDS.every((k) => /^[a-zA-Z]+$/.test(k)),
    `${KINDS.length} kind(s): ${KINDS.join(", ")}`,
  );

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
  ];

  let n = 1;
  for (const [label, args] of refusedCases) {
    const r = await refused(() => a.client.mutation(f.createPage as never, args as never));
    check(`P1.${n++} ${label} refused`, r.refused, r.refused ? "" : `ACCEPTED: ${JSON.stringify(r.got)}`);
  }

  // P1.7 used to live in the table above, which only asks "was this refused?".
  // That was the wrong question, and it made the check pass for the wrong
  // reason.
  //
  // An over-cap payload has to be built by cycling the vocabulary, and a cycle
  // repeats kinds — so the payload contains duplicates as well as being too
  // long. Delete the length guard and this call is *still* refused, by the
  // duplicate guard. The check would have stayed green with `PAGE_MAX_BLOCKS`
  // enforcement deleted, which is the exact mutation it exists to catch, and
  // it would have reported green rather than red.
  //
  // So it is asserted on which guard spoke. Only the length guard says "at
  // most"; the duplicate guard says "already on this page". Both have to be
  // present for this to pass, and the second is not a substitute for the first.
  const overCap = await reject(() =>
    a.client.mutation(f.createPage as never, {
      name: "p1-many",
      area: "general",
      blocks: Array.from({ length: PAGE_MAX_BLOCKS + 1 }, (_, i) => ({
        kind: KINDS[i % KINDS.length],
      })),
    } as never),
  );
  check(
    `P1.${n++} more blocks than the cap refused **by the cap, not by a duplicate**`,
    overCap.refused && /at most/.test(overCap.message),
    `server said: ${overCap.message || "(accepted)"}`,
  );

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
  section("P9 — a signed-out caller gets nothing, and cannot name a space");
  //
  // Everything above tests one signed-in identity against another. The caller
  // with **no** identity is the one that was untested, and it is the cheapest
  // attack there is: no token, straight at the mutations.
  const anon = new ConvexHttpClient(url);
  const anonList = (await anon.query(f.listPages as never, {} as never)) as ListResult;
  check(
    "P9.1 a signed-out read returns an empty list rather than somebody else's",
    Array.isArray(anonList?.pages) && anonList.pages.length === 0,
    `${anonList?.pages?.length} page(s) returned`,
  );
  const anonCreate = await reject(() =>
    anon.mutation(f.createPage as never, {
      name: "anon",
      area: "general",
      blocks: [{ kind: "note" }],
    } as never),
  );
  check("P9.2 a signed-out create is refused", anonCreate.refused, anonCreate.message);
  const anonUpdate = await reject(() =>
    anon.mutation(f.updatePage as never, { id: second, name: "anon edit" } as never),
  );
  check("P9.3 a signed-out update is refused", anonUpdate.refused, anonUpdate.message);
  const anonDelete = await reject(() =>
    anon.mutation(f.deletePage as never, { id: second } as never),
  );
  check("P9.4 a signed-out delete is refused", anonDelete.refused, anonDelete.message);

  // Cross-space isolation. The honest statement of what this product guarantees
  // is narrower than "spaces isolate pages", so it is worth being precise about
  // the mechanism rather than implying a tenancy model that is not there.
  //
  // A page's `spaceId` is *derived* — `createPage` calls `ensurePersonalSpace`
  // and never reads a space from its arguments. So the caller cannot choose
  // where a page lands, and cannot point one at a space they do not belong to.
  // That is the control, and it is checkable: name a space and the write is
  // refused, because the argument does not exist in the validator.
  const directed = await reject(() =>
    a.client.mutation(f.createPage as never, {
      name: "p9-directed",
      area: "general",
      blocks: [{ kind: "note" }],
      spaceId: b.userId,
    } as never),
  );
  check(
    "P9.5 a caller cannot choose the space a page lands in",
    directed.refused,
    directed.refused ? `refused: ${directed.message}` : `ACCEPTED: ${JSON.stringify(directed.got)}`,
  );
  const impostor = await reject(() =>
    a.client.mutation(f.createPage as never, {
      name: "p9-impostor",
      area: "general",
      blocks: [{ kind: "note" }],
      ownerUserId: b.userId,
    } as never),
  );
  check(
    "P9.6 a caller cannot write a page into somebody else's ownership",
    impostor.refused,
    impostor.refused ? `refused: ${impostor.message}` : `ACCEPTED: ${JSON.stringify(impostor.got)}`,
  );

  // Both identities also hold a non-personal space. That does not change the
  // answer, and the check is here so that the day a shared space *can* have two
  // members, the harness already asks the question that would expose a leak.
  let bSpace: string | null = null;
  const bMade = await reject(() =>
    b.client.mutation(f.createSpace as never, { name: "B household", kind: "family" } as never),
  );
  if (!bMade.refused) bSpace = String(bMade.got);
  check(
    "P9.7 two users can each hold a non-personal space",
    bSpace !== null,
    bSpace === null ? `could not create one: ${bMade.message}` : `B's space ${bSpace}`,
  );
  const aInBWorld = (await b.client.query(f.listPages as never, {} as never)) as ListResult;
  check(
    "P9.8 a shared space does not make another person's page visible",
    !aInBWorld.pages.some((p) => p.id === created || p.id === second),
    `${aInBWorld.pages.length} page(s) visible to B`,
  );

  // -------------------------------------------------------------------------
  section("P10 — every template Panel ships is a page the deployment accepts");
  //
  // A template is a compile-time convenience, so the unit tests prove the
  // catalogue is internally valid. That is not the same claim. What matters
  // about a template is that pressing it produces a page **the server will
  // store** — so every entry is created here against the live deployment, on
  // account B, and read back.
  //
  // B rather than A because P4 deliberately saturated A at the page cap.
  const TEMPLATES = productTemplates();
  check(
    "P10.1 the catalogue this harness reads is not empty",
    TEMPLATES.length > 0,
    `${TEMPLATES.length} template(s) parsed from src/lib/pageTemplates.ts`,
  );

  let t = 0;
  for (const tpl of TEMPLATES) {
    const n2 = ++t;
    const made = await reject(() =>
      b.client.mutation(f.createPage as never, {
        name: `tpl-${tpl.id}-${n2}`,
        area: tpl.area,
        blocks: tpl.blocks.map((kind) => ({ kind })),
      } as never),
    );
    check(
      `P10.2.${n2} the "${tpl.name}" template's blocks are accepted by createPage`,
      !made.refused,
      made.refused ? `REFUSED: ${made.message}` : "",
    );
  }

  // The catalogue blocks round-trip in the order the template declares, which
  // is the property that makes a template a starting point rather than a hint.
  const bList10 = (await b.client.query(f.listPages as never, {} as never)) as ListResult;
  let k = 0;
  for (const tpl of TEMPLATES) {
    k += 1;
    const stored = bList10.pages.find((p) => p.name === `tpl-${tpl.id}-${k}`);
    check(
      `P10.3.${k} "${tpl.name}" round-trips with its blocks in the declared order`,
      stored !== undefined &&
        stored.area === tpl.area &&
        JSON.stringify(stored.blocks.map((x) => x.kind)) === JSON.stringify(tpl.blocks),
      stored ? JSON.stringify(stored.blocks.map((x) => x.kind)) : "not stored",
    );
  }

  // And the mirror-image claim: a template is a **client-side** convenience and
  // the server has never heard of one. If createPage grew a `templateId`, there
  // would be a second write path that decides a page's contents server-side —
  // the shape ADR-033 rules out — and it would be reachable by anyone who found
  // the argument.
  const asTemplate = await reject(() =>
    a.client.mutation(f.createPage as never, {
      name: "p10-as-template",
      area: "general",
      blocks: [{ kind: "note" }],
      templateId: "morning",
    } as never),
  );
  check(
    "P10.4 the server does not accept a templateId — a template is not a write path",
    asTemplate.refused,
    asTemplate.refused ? `refused: ${asTemplate.message}` : `ACCEPTED: ${JSON.stringify(asTemplate.got)}`,
  );

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
  note(
    "cross-space isolation is proven by derivation, not by tenancy",
    "P9 shows a caller cannot name a space and that two identities sharing the " +
      "product still see only their own pages. It cannot show two members of " +
      "one shared space, because Panel exposes no invite: `createSpace` seats " +
      "only its creator. So the guarantee rests on pages being written only to " +
      "the caller's personal space, not on a space-membership check that was " +
      "exercised.",
  );
  note(
    "the template buttons have never been pressed in a browser",
    "P10 proves every template's blocks are accepted by the live deployment and " +
      "round-trip in order. It cannot show that pressing a button fills the form " +
      "correctly, or that the resulting page reads well. The form wiring is " +
      "source-level only.",
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
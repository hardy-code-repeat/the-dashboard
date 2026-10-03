/**
 * CHANGE-0031 / D67 conformance — the dashboard's truncation receipts.
 *
 * The defect this harness exists for: `getDashboard` has always computed
 * `take(n + 1)` and set `truncated`, `stats.openTruncated` and
 * `stats.completedTruncated` precisely so that hitting the cap would be an
 * observable fact rather than a quiet lie about how complete the board is. Its
 * own doc comment went further and asserted that "the client shows this as a
 * 'showing your 200 most recent' note".
 *
 * **No component had ever read any of them.** The receipt was computed at the
 * cap boundary, described in a comment, and discarded on the client, so above
 * 200 open tasks the four headline tiles reported counts taken from a slice
 * and said nothing about it. That is the exact failure the extra row exists to
 * prevent, reached by ignoring the extra row.
 *
 * `spec-drift.ts` now checks that every receipt a query the product calls is
 * read by the product. That check is a **name-presence** check, and the
 * instruction for this project is explicit that a check which can pass for the
 * wrong reason is not evidence — it was in fact fooled during development, by
 * `stats?.openTruncated && false`, which leaves the identifier in the source
 * while making the disclosure dead. So the load-bearing half is here, over the
 * wire:
 *
 *  **R1** The receipt is `false` on a small board. A receipt that is always
 *       true is as much a lie as one that is always false, and it would make
 *       R2 vacuous.
 *  **R2** The receipt **flips to `true` exactly at the cap boundary** — not
 *       before, not after. This is the whole point of `take(n + 1)`: the read
 *       stops one row past the cap so that "there is more" is a fact rather
 *       than an inference.
 *  **R3** The returned list is capped, not merely flagged. A receipt with an
 *       uncapped payload would be an admission, not a bound.
 *  **R4** `stats.open` counts what was returned, so the client has to know it
 *       is a floor. If the backend ever computed a true total over a bounded
 *       read it would have to say so, and the tile's `+` would be a lie in the
 *       other direction.
 *  **R5** The completed side has its own receipt and it is independent.
 *
 * **What this harness cannot check, and says so.** Whether the receipt is
 * *rendered* — the `+ at least` tile caption, the dashed note above the list —
 * is a claim about output. It is pinned by `spec-drift`'s
 * `checkTruncationReceipts` and by `tsc` (the field is read off the generated
 * query result, so it cannot be referenced if it does not exist), and it has
 * not been rendered in a browser. It is not counted as an invariant here
 * because no HTTP call can observe a caption.
 *
 * Usage:
 *   bun scripts/conformance-dashboard.ts <CONVEX_URL>
 *
 * Exit: 0 = every invariant held, 1 = one or more did not, 2 = could not run.
 */

import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";

import { READ_LIMITS } from "../src/lib/readLimits";
import { MAX_SEGMENTS } from "../src/lib/capture";

const f = {
  signIn: makeFunctionReference<unknown, { tokens?: { token: string } | null }>("auth:signIn"),
  getDashboard: makeFunctionReference<
    Record<string, never>,
    {
      tasks: { _id: string; completed: boolean }[];
      truncated: boolean;
      stats: {
        open: number;
        openTruncated: boolean;
        completedTruncated: boolean;
      };
    } | null
  >("assistant:getDashboard"),
  capture: makeFunctionReference<
    { input: string },
    {
      created: { id: string }[];
      dropped: unknown[];
      refused: boolean;
      overflow: number;
    }
  >("assistant:capture"),
};

const CAP = READ_LIMITS.DASHBOARD_TASKS;

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

/**
 * Writes `count` open tasks.
 *
 * Batched, because Feature 2 (multi-object capture) splits on explicit
 * structure only and a newline is explicit structure — and because
 * `MAX_SEGMENTS` caps a single capture at 12 objects. The first version of
 * this helper sent all 199 lines in one call and reported 12 created: the cap
 * is a deliberate, client-reported limit (`overflow`), not a bug, and the
 * harness was wrong rather than the product. Batching to `MAX_SEGMENTS` keeps
 * every batch under the limit and still costs a handful of round trips rather
 * than 199.
 */
async function writeTasks(client: ConvexHttpClient, count: number, tag: string): Promise<number> {
  let written = 0;
  let serial = 0;
  while (written < count) {
    const batch = Math.min(MAX_SEGMENTS, count - written);
    const input = Array.from({ length: batch }, (_, i) => `cap probe ${tag} ${serial + i}`).join(
      "\n",
    );
    const result = await client.mutation(f.capture, { input });
    if (result.refused) {
      throw new Error(`capture refused a batch of ${batch}: nothing was written`);
    }
    if (result.created.length !== batch) {
      throw new Error(
        `capture accepted ${result.created.length} of ${batch} segments — the harness assumes no silent drop, and would otherwise under-count the board`,
      );
    }
    written += result.created.length;
    serial += batch;
  }
  return written;
}

async function main() {
  const url = process.argv[2];
  if (!url) {
    console.error("Usage: bun scripts/conformance-dashboard.ts <CONVEX_URL>");
    process.exit(2);
  }

  console.log("CHANGE-0031 / D67 CONFORMANCE — dashboard truncation receipts");
  console.log("=".repeat(66));
  console.log(`deployment: ${url}`);
  console.log(`cap: ${CAP} per side`);
  console.log("");
  console.log("Every check below runs against the deployed backend. Nothing is mocked.");

  const client = await freshClient(url);

  // -------------------------------------------------------------------------
  section("R1 — a receipt that is always true would make R2 meaningless");
  // -------------------------------------------------------------------------
  const fresh = await client.query(f.getDashboard, {});
  check("R1 — a brand-new board is readable", fresh !== null);
  check(
    "R1 — and its receipt is false, not vacuously true",
    fresh?.truncated === false && fresh?.stats.openTruncated === false,
    `truncated=${String(fresh?.truncated)} openTruncated=${String(fresh?.stats.openTruncated)}`,
  );

  // -------------------------------------------------------------------------
  section("R2 — the receipt flips exactly at the cap boundary");
  // -------------------------------------------------------------------------
  // One below the cap. If the receipt fired early the board would be crying
  // wolf on a board that fits, which is how a receipt stops being read.
  const underCount = await writeTasks(client, CAP - 1, "under");
  const under = await client.query(f.getDashboard, {});
  check(
    "R2 — wrote exactly cap-1 open tasks",
    underCount === CAP - 1,
    `capture returned ${underCount}`,
  );
  check(
    "R2 — one below the cap, no receipt",
    under?.truncated === false,
    `tasks=${String(under?.tasks.length)} truncated=${String(under?.truncated)}`,
  );

  const overCount = await writeTasks(client, 2, "over");
  const over = await client.query(f.getDashboard, {});
  check("R2 — wrote the two that cross it", overCount === 2, `capture returned ${overCount}`);

  const openRows = over?.tasks.filter((t) => !t.completed).length ?? 0;
  check(
    "R2 — the receipt is true the moment there is one row too many",
    over?.stats.openTruncated === true && over?.truncated === true,
    `open rows on the wire=${openRows} openTruncated=${String(over?.stats.openTruncated)}`,
  );

  // -------------------------------------------------------------------------
  section("R3 — the receipt is a bound, not just an admission");
  // -------------------------------------------------------------------------
  check(
    "R3 — no more open rows come back than the cap allows",
    openRows === CAP,
    `${openRows} rows for a board of ${CAP}+`,
  );

  // -------------------------------------------------------------------------
  section("R4 — the count the client shows is the count it was given");
  // -------------------------------------------------------------------------
  check(
    "R4 — stats.open matches the rows returned, so the client knows it is a floor",
    over?.stats.open === openRows,
    `stats.open=${String(over?.stats.open)} rows=${openRows}`,
  );
  check(
    "R4 — stats.open is therefore not the true total, which is the disclosure's whole job",
    over !== null && over.stats.open === CAP,
    `a true total would exceed ${CAP}`,
  );

  // -------------------------------------------------------------------------
  section("R5 — the completed side carries its own receipt");
  // -------------------------------------------------------------------------
  check(
    "R5 — the completed receipt is independent of the open one",
    over?.stats.completedTruncated === false,
    `completedTruncated=${String(over?.stats.completedTruncated)} on a board with no completed work`,
  );

  // -------------------------------------------------------------------------
  section("OBSERVED — not an invariant");
  // -------------------------------------------------------------------------
  note(
    "rendering",
    "Whether the receipt reaches the screen (`+ at least` on the Open tile, the dashed cap note above the list) is output. It is pinned by spec-drift's truncation-receipt check and by tsc; it has not been rendered in a browser.",
  );
  note(
    "D61",
    "Whether 200 should be the cap, and whether the board should page past it instead, is an open product decision. This harness pins the behaviour of the cap as it exists; it does not settle it.",
  );

  console.log(observations.join("\n"));
  if (notes.length > 0) {
    console.log("");
    console.log(notes.join("\n"));
  }
  console.log("");
  console.log("=".repeat(66));
  if (failures.length > 0) {
    console.log(`${failures.length} FAILED: ${failures.join("; ")}`);
    process.exit(1);
  }
  console.log("ALL RECEIPT INVARIANTS HELD.");
}

main().catch((error) => {
  console.error(`HARNESS FAILED TO RUN: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
});
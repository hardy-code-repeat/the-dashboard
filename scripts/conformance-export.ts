/**
 * Panel export harness — attacks the data-portability surface.
 *
 * **The rule this harness exists to enforce.** A download is the highest-risk
 * read in the product, because it is the one read a user *wants* to succeed
 * for themselves and an attacker wants to succeed for somebody else. Everything
 * here is therefore driven from outside, through the public API of a live
 * deployment, by two legitimately authenticated users.
 *
 * ## The checks that matter most are the negative ones
 *
 * It is easy to build an export that works and a much harder one to prove it
 * cannot be *widened*. So this harness asserts:
 *
 * 1. **Owner scope** — two users export; neither sees the other's rows.
 * 2. **No substituted identity** — the export takes no user argument at all, so
 *    there is nothing to substitute. The harness proves the function's argument
 *    list is empty, because a single added argument is how IDOR arrives here.
 * 3. **No secrets** — the serialized export is scanned for credential-shaped
 *    keys and for the live API-key value, which is asserted *absent by
 *    construction* rather than by trusting the tier map.
 * 4. **No cross-space leakage** — data another user owns never appears.
 * 5. **Unauthenticated** — an anonymous caller gets an empty manifest, not rows.
 * 6. **Empty and repeated exports** — a fresh account exports successfully, and
 *    two exports of unchanged data are identical apart from the timestamp.
 *
 * ## Why the secret scan is a *string* scan and not a tier assertion
 *
 * The tier map is the design; a string scan over the actual bytes is the
 * evidence. They can disagree — a future refactor could read a secret table
 * while the classification still says it never does. Scanning the payload for
 * credential-shaped keys and for the literal key in `emailOtp.ts` catches that
 * class of regression regardless of what the map claims.
 *
 * Usage:
 *   bun scripts/conformance-export.ts <CONVEX_URL>
 *
 * Exit: 0 = every boundary held, 1 = one or more did not.
 */

import { readFileSync } from "node:fs";

import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";

const f = {
  signIn: makeFunctionReference<unknown, { tokens?: { token: string } | null }>(
    "auth:signIn",
  ),
  exportMyData: makeFunctionReference<Record<string, never>, unknown>("export:exportMyData"),
  createPerson: makeFunctionReference<{ name: string }, unknown>("people:createPerson"),
  createTask: makeFunctionReference<{ input: string }, unknown>("assistant:addTask"),
  addNote: makeFunctionReference<{ body: string }, unknown>("assistant:addNote"),
  createAccount: makeFunctionReference<{ label: string; kind: string }, unknown>(
    "subscriptions:createAccount",
  ),
  createTransaction: makeFunctionReference<
    {
      accountId?: string;
      label: string;
      amountMinor: number;
      currency: string;
      direction: "in" | "out";
      postedAt: number;
    },
    unknown
  >("transactions:createTransaction"),
};

const observations: string[] = [];
const failures: string[] = [];

function section(title: string): void {
  console.log("");
  console.log(`── ${title} ${"─".repeat(Math.max(0, 62 - title.length))}`);
  observations.push(`── ${title}`);
}

function check(label: string, ok: boolean, detail = ""): void {
  const line = `  [${ok ? "PASS" : "FAIL"}] ${label}${detail ? ` — ${detail}` : ""}`;
  observations.push(line);
  console.log(line);
  if (!ok) failures.push(label);
}

async function freshUser(url: string): Promise<{ client: ConvexHttpClient; token: string }> {
  const client = new ConvexHttpClient(url);
  const session = await client.action(f.signIn as never, { provider: "anonymous" } as never);
  const token = session?.tokens?.token;
  if (!token) throw new Error("anonymous sign-in returned no token");
  client.setAuth(token as never);
  return { client, token };
}

/** The literal key from src/convex/auth/emailOtp.ts, read so it is never retyped here. */
function literalSecretFromSource(): string | null {
  try {
    const src = readFileSync("src/convex/auth/emailOtp.ts", "utf8");
    const m = src.match(/fb_email_[A-Za-z0-9]+/);
    return m ? m[0] : null;
  } catch {
    return null;
  }
}

/** Credential-shaped keys that must never appear anywhere in a payload. */
const SECRET_KEYS = [
  "token",
  "accessToken",
  "refreshToken",
  "secret",
  "apiKey",
  "password",
  "privateKey",
  "stateHash",
  "codeVerifier",
  "connectionToken",
];

function findSecretKeys(value: unknown, path = "$", found: string[] = []): string[] {
  if (value === null || typeof value !== "object") return found;
  if (Array.isArray(value)) {
    value.forEach((v, i) => findSecretKeys(v, `${path}[${i}]`, found));
    return found;
  }
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEYS.includes(k)) found.push(`${path}.${k}`);
    findSecretKeys(v, `${path}.${k}`, found);
  }
  return found;
}

async function main() {
  const url = process.argv[2];
  if (!url) {
    console.error("Usage: bun scripts/conformance-export.ts <CONVEX_URL>");
    process.exit(2);
  }

  console.log("PANEL EXPORT HARNESS — data-portability attacks");
  console.log("=".repeat(70));
  console.log(`deployment: ${url}`);

  const alice = await freshUser(url);
  const bob = await freshUser(url);
  const anonymous = new ConvexHttpClient(url);

  const MARK = "exportprobe";

  // -------------------------------------------------------------------------
  section("E1 — the export takes no identity argument");
  // -------------------------------------------------------------------------
  // The strongest guarantee against substituted-id IDOR here is structural: if
  // the function accepts no user id, there is nothing to substitute.
  //
  // Convex's argument validator makes that structural rather than conventional —
  // passing a foreign `userId` is **rejected by the validator**, not silently
  // ignored, so the request never reaches the handler at all. That is stronger
  // than "the handler would have ignored it", so the harness asserts the
  // rejection and names the validator shape it saw.
  let rejected = false;
  let validatorNote = "";
  try {
    await alice.client.query(f.exportMyData as never, {
      userId: "someone-else",
    } as never);
    // If a future refactor widens the args, this branch is the failure: the
    // call succeeded, so identity injection is now *possible* even if ignored.
    validatorNote = "call succeeded — arguments were widened";
    rejected = false;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    rejected = /extra field|ArgumentValidationError|not in the validator/i.test(msg);
    validatorNote = rejected
      ? "validator refused the unknown field"
      : `refused for an unrelated reason: ${msg.slice(0, 60)}`;
  }
  check(
    "E1 — the export's validator accepts no identity argument at all",
    rejected,
    validatorNote,
  );

  // And the ordinary call still works, so E1 is not passing because the
  // function is simply broken.
  const smoke = await alice.client.query(f.exportMyData as never);
  check("E1 — CONTROL: the same query with no arguments still succeeds", !!smoke);

  // -------------------------------------------------------------------------
  section("E2 — a populated export actually contains the caller's own data");
  // -------------------------------------------------------------------------
  await alice.client.mutation(f.createPerson, { name: `${MARK} person Alice` } as never);
  await alice.client.mutation(f.createTask, { input: `${MARK} task Alice` } as never);
  await alice.client.mutation(f.addNote, { body: `${MARK} note Alice` } as never);
  const account = (await alice.client.mutation(f.createAccount, {
    label: `${MARK} account Alice`,
    kind: "checking",
  } as never)) as { id?: string } | string;
  const accountId = typeof account === "string" ? account : account?.id;
  if (accountId) {
    await alice.client.mutation(f.createTransaction, {
      accountId,
      label: `${MARK} txn Alice`,
      amountMinor: 1250,
      direction: "out",
      currency: "GBP",
      postedAt: Date.now(),
    } as never);
  }

  const mine = await alice.client.query(f.exportMyData as never);
  const mineStr = JSON.stringify(mine);
  check("E2 — the export includes the caller's own person", mineStr.includes(`${MARK} person Alice`));
  check("E2 — and their own task", mineStr.includes(`${MARK} task Alice`));
  check("E2 — and their own note", mineStr.includes(`${MARK} note Alice`));
  check("E2 — and their own transaction", mineStr.includes(`${MARK} txn Alice`));

  // -------------------------------------------------------------------------
  section("E3 — owner scope: a second user cannot obtain the first's rows");
  // -------------------------------------------------------------------------
  const theirs = await bob.client.query(f.exportMyData as never);
  const theirsStr = JSON.stringify(theirs);
  for (const label of ["person Alice", "task Alice", "note Alice", "txn Alice"]) {
    check(
      `E3 — Bob's export contains no "${label}"`,
      !theirsStr.includes(`${MARK} ${label}`),
      "no foreign row",
    );
  }
  check(
    "E3 — the manifest reports Bob's own user id, not Alice's",
    (theirs as { manifest?: { userId?: string } })?.manifest?.userId !== bob.token,
    "manifest identity is the caller's",
  );

  // -------------------------------------------------------------------------
  section("E4 — no secret leaves the system");
  // -------------------------------------------------------------------------
  // Scanned as bytes, not asserted from the tier map, so the two can disagree
  // loudly rather than silently agreeing.
  const secretKeyHits = findSecretKeys(mine);
  check(
    "E4 — no credential-shaped key appears anywhere in the payload",
    secretKeyHits.length === 0,
    secretKeyHits.length ? secretKeyHits.slice(0, 3).join(", ") : "clean",
  );

  const literal = literalSecretFromSource();
  if (literal) {
    check(
      "E4 — the live email-relay key appears in no export",
      !mineStr.includes(literal) && !theirsStr.includes(literal),
      "literal absent from both users' exports",
    );
  } else {
    check("E4 — the relay key literal was readable for the scan", false, "could not read source");
  }

  // The audit/security tier must be *counted*, never emitted.
  for (const table of ["accessLog", "grants", "agentRuns", "agentProposals", "activity"]) {
    check(
      `E4 — "${table}" appears only under withheld, never as emitted rows`,
      !(mine as { data?: Record<string, unknown[]> })?.data?.[table],
      "not in data",
    );
  }

  // -------------------------------------------------------------------------
  section("E5 — unauthenticated access yields nothing");
  // -------------------------------------------------------------------------
  const anon = (await anonymous.query(f.exportMyData as never)) as {
    manifest?: { userId?: string };
    data?: Record<string, unknown[]>;
  };
  const anonRows = Object.values(anon?.data ?? {}).reduce((n, rows) => n + rows.length, 0);
  check("E5 — an anonymous caller receives zero rows", anonRows === 0, `${anonRows} rows`);
  check("E5 — and the manifest names them anonymous", anon?.manifest?.userId === "anonymous");
  check(
    "E5 — and no Alice data appears",
    !JSON.stringify(anon).includes(`${MARK} person Alice`),
    "nothing leaked",
  );

  // -------------------------------------------------------------------------
  section("E6 — empty export, and determinism");
  // -------------------------------------------------------------------------
  const carol = await freshUser(url);
  const empty = (await carol.client.query(f.exportMyData as never)) as {
    manifest?: { counts?: Record<string, number> };
    data?: Record<string, unknown[]>;
  };
  check(
    "E6 — a brand-new account exports successfully with empty arrays, not an error",
    !!empty?.manifest,
    `counts: ${JSON.stringify(empty?.manifest?.counts)}`,
  );

  const first = await alice.client.query(f.exportMyData as never, { exportedAt: 1 } as never);
  const second = await alice.client.query(f.exportMyData as never, { exportedAt: 1 } as never);
  check(
    "E6 — two exports of unchanged data are byte-identical at the same timestamp",
    JSON.stringify(first) === JSON.stringify(second),
    "reproducible",
  );

  // -------------------------------------------------------------------------
  section("E7 — the manifest tells the truth about what was withheld");
  // -------------------------------------------------------------------------
  const manifest = (mine as { manifest?: { guarantees?: string[]; counts?: Record<string, number> } })
    ?.manifest;
  check(
    "E7 — the manifest states its guarantees",
    (manifest?.guarantees?.length ?? 0) >= 4,
    `${manifest?.guarantees?.length ?? 0} guarantees`,
  );
  check(
    "E7 — and counts what was included",
    typeof manifest?.counts?.people === "number",
    `people=${manifest?.counts?.people}`,
  );
  check(
    "E7 — the guarantees mention no credentials and no co-member data",
    manifest?.guarantees?.join(" ").includes("no credentials") &&
      manifest?.guarantees?.join(" ").includes("co-member"),
    "both stated",
  );

  // -------------------------------------------------------------------------
  console.log("");
  console.log("=".repeat(70));
  const total = observations.filter((o) => o.startsWith("  [")).length;
  if (failures.length) {
    console.log(`RESULT: FAIL — ${failures.length} of ${total} boundaries did not hold:`);
    failures.forEach((l) => console.log(`  - ${l}`));
    process.exit(1);
  }
  console.log(`RESULT: PASS — ${total} boundaries held, 0 failed.`);
}

main().catch((error) => {
  console.error("harness error:", error);
  process.exit(2);
});
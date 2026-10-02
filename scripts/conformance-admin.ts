/**
 * The Admin Control Centre harness — fifteen boundaries, by an attacker.
 *
 * **Why this file exists.** `conformance-sec.ts` proves user B cannot reach
 * user A's *objects*. Nothing in the existing evidence proves anything about
 * the Control Centre, and it is the one surface in Panel where a mistake is
 * not a leaked note but a leaked deployment: row counts across every tenant,
 * configuration state, and the list of open security findings. So it gets the
 * same adversarial treatment, from the outside, against the live deployment.
 *
 * **The rule this harness enforces.** Every check is made by calling the
 * queries as a browser would. A control is only believed if it **refuses**. A
 * thrown error, a `null`, an empty array and an empty object are all refusals;
 * a populated payload is not.
 *
 * ## What this harness does NOT claim, and why
 *
 * **The authorised path is reported `NOT VERIFIED` unless `PANEL_ADMIN_TOKEN`
 * is set in the environment.** This is not an omission to be tidied up later —
 * it is the direct consequence of ADR-032 §4. Panel contains no code that can
 * create an admin, because a client-reachable grant is a privilege-escalation
 * path. A harness that minted its own admin identity would need exactly the
 * thing the architecture refuses, so it cannot.
 *
 * The allowed case is therefore covered by the unit table in
 * `src/lib/adminAccess.test.ts`, which asserts it with a real fixture, and the
 * live half is covered by supplying a token the deployment owner already has.
 * Reporting it as a pass would be the exact kind of green-that-means-nothing
 * this project keeps refusing (D60).
 *
 * Usage:
 *   bun scripts/conformance-admin.ts <CONVEX_URL>
 *
 * Exit: 0 = every boundary held, 1 = one or more did not.
 */

import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";

/** The five public queries. Named from `src/convex/admin.ts`, not assumed. */
const QUERIES = {
  systemStatus: makeFunctionReference("admin:systemStatus"),
  agentHealth: makeFunctionReference("admin:agentHealth"),
  integrationHealth: makeFunctionReference("admin:integrationHealth"),
  dataModel: makeFunctionReference("admin:dataModel"),
  securityPosture: makeFunctionReference("admin:securityPosture"),
} as const;

const QUERY_NAMES = Object.keys(QUERIES) as Array<keyof typeof QUERIES>;

const f = {
  signIn: makeFunctionReference<unknown, { tokens?: { token: string } | null }>("auth:signIn"),
  currentUser: makeFunctionReference<Record<string, never>, unknown>("users:currentUser"),
  listPeople: makeFunctionReference<unknown, unknown>("people:listPeople"),
  addTask: makeFunctionReference<{ input: string }, unknown>("assistant:addTask"),
};

const observations: string[] = [];
const failures: string[] = [];
const notes: string[] = [];

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

function note(label: string, detail: string): void {
  const line = `  [NOTE] ${label} — ${detail}`;
  observations.push(line);
  console.log(line);
  notes.push(label);
}

/** A populated payload is a breach. Everything else is a refusal. */
function leaked(result: unknown): boolean {
  if (result === null || result === undefined) return false;
  if (Array.isArray(result) && result.length === 0) return false;
  if (typeof result === "object" && Object.keys(result as object).length === 0) return false;
  return true;
}

/**
 * Call every Control Centre query and require that all five refuse.
 *
 * A loop over the five rather than five hand-written checks, because a new query
 * added to `admin.ts` is then covered by this harness automatically. The
 * alternative is a list that goes stale the moment someone adds an export, and
 * an unguarded new query is precisely the failure this file exists to catch.
 */
async function expectAllRefused(label: string, client: ConvexHttpClient): Promise<void> {
  for (const name of QUERY_NAMES) {
    let result: unknown;
    let threw = false;
    try {
      result = await client.query(QUERIES[name] as never, {} as never);
    } catch {
      threw = true;
    }
    const bad = leaked(result);
    check(
      `A-${QUERY_NAMES.indexOf(name) + 1} ${label} refused by ${name}`,
      threw || !bad,
      bad ? `RETURNED ${JSON.stringify(result).slice(0, 100)}` : threw ? "refused: threw" : "refused: empty",
    );
  }
}

/** A fresh anonymous (guest) identity, with its raw token. */
async function freshGuest(
  url: string,
): Promise<{ client: ConvexHttpClient; token: string; userId: string }> {
  const client = new ConvexHttpClient(url);
  const session = await client.action(f.signIn as never, { provider: "anonymous" } as never);
  const token = session?.tokens?.token;
  if (!token) throw new Error("anonymous sign-in returned no token");
  client.setAuth(token as never);
  const user = (await client.query(f.currentUser as never, {} as never)) as { _id?: string } | null;
  return { client, token, userId: user?._id ?? "" };
}

/** Walk a value and yield every string reachable in it, with its path. */
function* strings(value: unknown, path = "$"): Generator<[string, string]> {
  if (typeof value === "string") {
    yield [path, value];
    return;
  }
  if (Array.isArray(value)) {
    for (const [i, v] of value.entries()) yield* strings(v, `${path}[${i}]`);
    return;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      yield* strings(v, `${path}.${k}`);
    }
  }
}

/** Field names anywhere in a payload — used to assert no identifier leaks. */
function fieldNames(value: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const v of value) fieldNames(v, into);
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      into.add(k);
      fieldNames(v, into);
    }
  }
  return into;
}

/**
 * Secrets that must never appear in a Control Centre payload.
 *
 * Matched as substrings of every string in every payload. The list is built from
 * what this deployment actually has: the schema's own field names for anything
 * sensitive, plus the env-var names whose *values* must never leak. A variable
 * name appearing is fine — the surface reports state and names variables — but
 * a value appearing is a breach.
 */
const FORBIDDEN_FRAGMENTS = [
  "accessToken",
  "refreshToken",
  "clientSecret",
  "stateHash",
  "fb_email_",
  "x-api-key",
  "sk-",
  "-----BEGIN",
  "AIza",
  "ya29.",
];

async function main() {
  const url = process.argv[2];
  if (!url) {
    console.error("usage: bun scripts/conformance-admin.ts <CONVEX_URL>");
    process.exit(2);
  }

  console.log("=".repeat(70));
  console.log("PANEL — ADMIN CONTROL CENTRE CONFORMANCE (ADR-032)");
  console.log("Every check is an attack. A control is believed only if it refuses.");
  console.log("=".repeat(70));

  // -------------------------------------------------------------------------
  section("A. CONTROL — the harness can reach a signed-in identity at all");
  // Without this, every "refused" below could be passing because the client is
  // broken rather than because the Control Centre is closed. `conformance-auth.ts`
  // learned this the hard way: four forged-token checks were green and all
  // meaningless because `setAuth` was handed an object instead of a string.
  const guest = await freshGuest(url);
  const guestUser = (await guest.client.query(f.currentUser as never, {} as never)) as {
    _id?: string;
    role?: unknown;
  } | null;
  check(
    "C1 — a guest identity exists (so the refusals below are real)",
    typeof guestUser?._id === "string" && guestUser._id.length > 0,
    `userId ${guestUser?._id ?? "none"}`,
  );
  check(
    "C2 — the guest is not an admin (the refusal must be a policy, not luck)",
    guestUser?.role !== "admin",
    `role=${JSON.stringify(guestUser?.role)}`,
  );

  // -------------------------------------------------------------------------
  section("B. Unauthenticated caller");
  const anon = new ConvexHttpClient(url);
  await expectAllRefused("unauthenticated caller", anon);

  // -------------------------------------------------------------------------
  section("C. Guest / anonymous signed-in user");
  await expectAllRefused("guest", guest.client);

  // -------------------------------------------------------------------------
  section("D. Direct backend invocation — arguments cannot widen access");
  // The Control Centre takes no arguments, so "supplying arguments" is not a
  // meaningful attack on it directly; what IS meaningful is confirming the
  // refusal survives an attacker who believes they are passing something.
  // Positional args to a zero-arg query must not be silently accepted.
  for (const name of QUERY_NAMES) {
    let ok = false;
    try {
      const r = await guest.client.query(QUERIES[name] as never, { role: "admin" } as never);
      ok = !leaked(r);
    } catch {
      ok = true;
    }
    check(`D-${name} refuses an injected role argument`, ok);
  }

  // -------------------------------------------------------------------------
  section("E. Forged and malformed identities");
  const forged: Array<[string, string]> = [
    ["garbage string", "not-a-jwt"],
    ["empty string", ""],
    ["JWT-shaped but unsigned", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhZG1pbiJ9.sig"],
    ["alg=none token", "eyJhbGciOiJub25lIn0.eyJzdWIiOiJhZG1pbiJ9."],
  ];
  for (const [label, token] of forged) {
    const client = new ConvexHttpClient(url);
    client.setAuth(token as never);
    const allRefused = await (async () => {
      for (const name of QUERY_NAMES) {
        try {
          if (leaked(await client.query(QUERIES[name] as never, {} as never))) return false;
        } catch {
          /* refused */
        }
      }
      return true;
    })();
    check(`E — ${label} refused by all five queries`, allRefused);
  }

  // -------------------------------------------------------------------------
  section("F. Cross-space: a member of another space gains nothing");
  // A guest is the strongest available case — it is a real, authenticated,
  // non-admin identity in the deployment. If the Control Centre leaked anything
  // to *it*, it would leak to every ordinary account.
  const spaces = await guest.client.query(f.listPeople as never, {} as never).then(
    (r) => (Array.isArray(r) ? r : (r as { people?: unknown[] })?.people ?? []),
    () => [],
  );
  check(
    "F1 — the ordinary-user surface still works (isolation is a real condition)",
    Array.isArray(spaces),
    `${Array.isArray(spaces) ? spaces.length : 0} people visible to the guest`,
  );
  await expectAllRefused("another-space member", guest.client);

  // -------------------------------------------------------------------------
  section("G. No mutation exists to attempt");
  // The strongest statement available from outside: there is nothing to call.
  // `client.mutation` against a non-existent reference must fail, and the gate
  // in `spec-drift.ts` is what keeps it that way across edits.
  for (const name of ["grantAdmin", "revokeAdmin", "setRole", "deleteUser", "resetAll"]) {
    let refused = false;
    try {
      await guest.client.mutation(
        makeFunctionReference(`admin:${name}`) as never,
        { userId: guestUser?._id ?? "x", email: "x@y.z", role: "admin" } as never,
      );
    } catch {
      refused = true;
    }
    check(`G — admin:${name} does not exist`, refused);
  }

  // -------------------------------------------------------------------------
  section("H. Attempted privilege escalation through the product");
  // An attacker with a real session tries the ordinary admin surface first.
  //
  // The assertion is **not** "the mutation returns nothing" — `addTask`
  // legitimately succeeds and returns the new task's id, and a check that
  // treated a populated result as a breach here would have been green for the
  // wrong reason. What matters is the *effect*: the caller's role afterwards.
  // The first version of this check did assert on the return value and failed
  // for exactly that reason.
  const before = (await guest.client.query(f.currentUser as never, {} as never)) as { role?: unknown } | null;
  let mutationReachable = false;
  try {
    await guest.client.mutation(f.addTask as never, { input: "escalate me to admin" } as never);
    mutationReachable = true;
  } catch {
    mutationReachable = false;
  }
  check(
    "H1 — the ordinary write surface is reachable (so H2 is a real test)",
    mutationReachable,
    mutationReachable ? "addTask accepted the call" : "addTask refused",
  );
  const after = (await guest.client.query(f.currentUser as never, {} as never)) as { role?: unknown } | null;
  check(
    "H2 — writing a task named 'escalate me to admin' grants no role",
    after?.role === before?.role && after?.role !== "admin",
    `role before=${JSON.stringify(before?.role)} after=${JSON.stringify(after?.role)}`,
  );

  // -------------------------------------------------------------------------
  section("I. Bounded reads and read-only architecture");
  // Static properties, asserted against the source, because a live read cannot
  // prove its own ceiling. `scripts/audit-bounded-reads.ts` covers the chain
  // terminators; this asserts the two invariants specific to this module.
  const { readFileSync } = await import("node:fs");
  const source = readFileSync("src/convex/admin.ts", "utf8");
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  check(
    "I1 — admin.ts declares no write endpoint",
    !/export const \w+(\s*:\s*[^=]+)?\s*=\s*(mutation|action|internalMutation|internalAction|httpAction)\s*\(/.test(code),
  );
  check(
    "I2 — admin.ts performs no database write",
    !/ctx\.db\.(patch|insert|replace|delete)\s*\(/.test(code),
  );
  const queryCount = [...code.matchAll(/export const \w+ = query\(/g)].length;
  const guarded = [...code.matchAll(/export const (\w+) = query\(/g)].filter((m) => {
    const start = m.index ?? 0;
    const next = code.indexOf("export const ", start + 1);
    return /requireAdmin\s*\(/.test(code.slice(start, next === -1 ? undefined : next));
  }).length;
  check("I3 — every exported query calls requireAdmin", queryCount > 0 && queryCount === guarded, `${guarded}/${queryCount}`);
  const collectCalls = [...code.matchAll(/\.collect\(\)/g)].length;
  check("I4 — admin.ts uses no unbounded collect()", collectCalls === 0, `${collectCalls} found`);

  // -------------------------------------------------------------------------
  section("J. Disclosure: what an authorised admin would receive");
  // Cannot be executed without an admin token, so the primary disclosure check
  // is **static**. The first version matched bare identifiers anywhere in the
  // file and produced two false failures: it flagged the word "fingerprint"
  // inside a disclosure sentence that says the query does *not* return one, and
  // it flagged the `ctx.db.get` that performs the authorisation check itself.
  // Both were the check being wrong, not the module — and a gate that cries wolf
  // is a gate people learn to skip.
  //
  // So these match **property access** (`row.fingerprint`) rather than the bare
  // word, which is what actually puts a value into a payload, and the user-row
  // check is stated as the thing it really means: the row read for the
  // authorisation decision is never returned.
  const forbiddenAccess: Array<[string, RegExp]> = [
    ["a token field", /\.\s*accessToken\b/],
    ["a refresh token field", /\.\s*refreshToken\b/],
    ["an account hint", /\.\s*accountHint\b/],
    ["a credential fingerprint", /\.\s*fingerprint\b/],
    ["a state hash", /\.\s*stateHash\b/],
    ["a connection label", /\.\s*label\b/],
    ["a sync cursor token", /\.\s*cursor\b/],
    ["an email field", /\.\s*email\b/],
  ];
  for (const [label, re] of forbiddenAccess) {
    check(`J — the module never reads ${label}`, !re.test(code));
  }

  // The authorisation read is `ctx.db.get(userId)`. It must exist — without it
  // the role check could not happen — and it must not be returned. Asserting
  // both halves, because asserting either alone passes for the wrong reason.
  const authRead = /const (\w+) = await ctx\.db\.get\(userId\)/.exec(code);
  check("J — the authorisation check reads the caller row", authRead !== null);
  if (authRead) {
    const binding = authRead[1];
    const returned = new RegExp(`return\\s+${binding}\\b|\\b${binding}\\s*[,\\n]\\s*\\}`).test(code);
    check(`J — the caller row (${binding}) is never returned`, !returned);
  }

  // -------------------------------------------------------------------------
  section("K. AUTHORISED PATH — reported, not assumed");
  const adminToken = process.env.PANEL_ADMIN_TOKEN;
  if (!adminToken) {
    note(
      "K1 — authorised admin is ALLOWED",
      "NOT VERIFIED. No admin token supplied (PANEL_ADMIN_TOKEN unset). Panel cannot mint one: no code path can grant users.role, by design (ADR-032 §4). The allowed case is covered by src/lib/adminAccess.test.ts instead. This is a gap and is reported as one.",
    );
  } else {
    const admin = new ConvexHttpClient(url);
    admin.setAuth(adminToken as never);
    let allowed = 0;
    for (const name of QUERY_NAMES) {
      try {
        const r = await admin.query(QUERIES[name] as never, {} as never);
        if (leaked(r)) {
          allowed += 1;
          // A payload check, only for an authorised caller.
          for (const [path, text] of strings(r)) {
            const bad = FORBIDDEN_FRAGMENTS.find((f) => text.includes(f));
            if (bad) {
              check(`K — no secret in ${name}${path}`, false, `matched ${bad}`);
            }
          }
          const names = fieldNames(r);
          const idLeak = [...names].filter((n) => /^(userId|spaceId|ownerUserId|_id|_creationTime|email|name)$/.test(n));
          check(`K — no identifier field in ${name}`, idLeak.length === 0, idLeak.join(", "));
        }
      } catch {
        check(`K — authorised admin can read ${name}`, false, "refused");
      }
    }
    check("K1 — authorised admin is allowed on every query", allowed === QUERY_NAMES.length, `${allowed}/${QUERY_NAMES.length}`);
    note(
      "K2 — disclosure scan",
      `inspected every string in ${allowed} payload(s) for credential fragments and every field name for identifiers`,
    );
  }

  // -------------------------------------------------------------------------
  console.log("");
  console.log("=".repeat(70));
  const passed = observations.filter((l) => l.includes("[PASS]")).length;
  console.log(
    `RESULT: ${failures.length === 0 ? "PASS" : "FAIL"} — ${passed} boundaries held, ${failures.length} failed, ${notes.length} unverified-by-design.`,
  );
  for (const failure of failures) console.log(`  FAILED: ${failure}`);
  if (notes.length > 0) {
    console.log("");
    console.log("NOT VERIFIED (reported, not counted as passes):");
    for (const n of notes) console.log(`  - ${n}`);
  }
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

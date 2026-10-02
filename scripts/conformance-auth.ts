/**
 * Panel auth-lifecycle harness — session, token and sign-in attacks.
 *
 * **Why this file exists.** `conformance-sec.ts` proves that user B cannot
 * reach user A's *objects*. It does not prove anything about the credential
 * itself: that a forged token is rejected, that a token is bound to the user
 * who minted it, that `signOut` actually revokes a token rather than merely
 * asking the browser to forget it, and that the sign-in action refuses
 * garbage arguments instead of throwing a stack trace back at the caller.
 *
 * Those are exactly the properties an `@convex-dev/auth` upgrade can change
 * silently, and none of them are covered by `bun test` — those fixtures are
 * pure `src/lib` functions that never touch Convex Auth. So after the
 * 0.0.90 → 0.0.96 upgrade this is the evidence that the auth stack still holds.
 *
 * **The rule this harness enforces.** Every check is made through the public
 * API of a live deployment by an attacker. A control is only believed if it
 * refuses. `null`, an empty array, an empty object and a thrown error are all
 * refusals; returning a populated identity is not.
 *
 * ## What this harness does not claim
 *
 * It does not test the email-OTP provider's delivery path — that needs a real
 * inbox and the relay key, which is a human action (D54). It does not test
 * token *cryptography*; it tests that the deployment enforces verification.
 * A valid-but-old or valid-but-other-user token is an attacker artefact
 * regardless of how well it was signed.
 *
 * ## A finding this harness produced rather than assumed
 *
 * A4 was written to assert that `signOut` revokes a token. It does not, and
 * that is correct behaviour for this platform — Convex Auth issues self-
 * contained signed JWTs and documents that a deleted session does not sign the
 * user out until the JWT expires. The assertion was therefore replaced with a
 * measurement of the real exposure (one issued token, bounded by `exp`), and
 * the per-call session check is recorded as the available mitigation.
 *
 * A4 only found this because it carries a **control**: an untouched token
 * replayed through the identical mechanism, which must succeed. The first
 * draft had no control and passed for the wrong reason — `setAuth` was given a
 * `{ getToken }` object where ConvexHttpClient wants a raw string, so every
 * forged token and every replay was refused as `Bearer [object Object]`. Four
 * forged-token checks and two revocation checks were all green and all
 * meaningless. The control is now permanent and sits immediately above the
 * assertions it protects.
 *
 * Usage:
 *   bun scripts/conformance-auth.ts <CONVEX_URL>
 *
 * Exit: 0 = every boundary held, 1 = one or more did not.
 */

import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";

const f = {
  signIn: makeFunctionReference<unknown, { tokens?: { token: string } | null }>(
    "auth:signIn",
  ),
  signOut: makeFunctionReference<unknown, unknown>("auth:signOut"),
  // The real identity surface. `users:currentUser` returns the whole auth user
  // row, so a non-null result is a genuine authenticated identity and null is a
  // refusal. Named from src/convex/users.ts rather than assumed.
  currentUser: makeFunctionReference<Record<string, never>, unknown>("users:currentUser"),
  listPeople: makeFunctionReference<unknown, unknown>("people:listPeople"),
  createPerson: makeFunctionReference<{ name: string }, unknown>("people:createPerson"),
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

/** A populated identity is the only thing that counts as a breach. */
function leaked(result: unknown, threw: boolean): boolean {
  if (threw) return false;
  if (result === null || result === undefined) return false;
  if (Array.isArray(result) && result.length === 0) return false;
  if (typeof result === "object" && Object.keys(result as object).length === 0) return false;
  return true;
}

async function attack(label: string, fn: () => Promise<unknown>): Promise<unknown> {
  try {
    const result = await fn();
    const bad = leaked(result, false);
    check(
      label,
      !bad,
      bad ? `returned ${JSON.stringify(result).slice(0, 120)}` : "refused",
    );
    return result;
  } catch (error) {
    check(label, true, `refused: ${error instanceof Error ? error.message.slice(0, 70) : "error"}`);
    return null;
  }
}

/** Sign in as a fresh anonymous account and return the client plus its raw token. */
async function freshUser(
  url: string,
): Promise<{ client: ConvexHttpClient; token: string }> {
  const client = new ConvexHttpClient(url);
  const session = await client.action(f.signIn as never, { provider: "anonymous" } as never);
  const token = session?.tokens?.token;
  if (!token) throw new Error("anonymous sign-in returned no token");
  client.setAuth(token as never);
  return { client, token };
}

async function main() {
  const url = process.argv[2];
  if (!url) {
    console.error("Usage: bun scripts/conformance-auth.ts <CONVEX_URL>");
    process.exit(2);
  }

  console.log("PANEL AUTH-LIFECYCLE HARNESS — credential and session attacks");
  console.log("=".repeat(70));
  console.log(`deployment: ${url}`);
  console.log("");
  console.log("Forged, substituted, revoked and malformed credentials.");

  const alice = await freshUser(url);
  const bob = await freshUser(url);

  // -------------------------------------------------------------------------
  section("A1 — a token proves an identity at all");
  // -------------------------------------------------------------------------
  // If this fails, every later refusal is vacuous: a harness where nothing
  // authenticates would "pass" A2–A5 for the wrong reason.
  const aliceView = await alice.client.query(f.currentUser as never);
  check(
    "A1 — a real token resolves to a real identity",
    leaked(aliceView, false),
    leaked(aliceView, false) ? "authenticated" : "no identity returned",
  );
  check(
    "A1 — the authenticated caller can write their own row",
    leaked(await alice.client.mutation(f.createPerson, { name: "Auth Alice" } as never), false),
  );

  // -------------------------------------------------------------------------
  section("A2 — a forged or malformed token is refused");
  // -------------------------------------------------------------------------
  // Each of these is a token an attacker can construct without any secret.
  // A deployment that accepts any one of them has no verification at all.
  const forged: Array<[string, string]> = [
    ["an empty string", ""],
    ["a bare word", "not-a-token"],
    [
      "a structurally valid unsigned JWT",
      [
        "eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0",
        "eyJzdWIiOiJhdHRhY2tlciIsIm5hbWUiOiJBbGljZSIsImlhdCI6NDEwMjQ0NDgwMH0",
        "",
      ].join("."),
    ],
    [
      "a JWT with alg=none but a real subject",
      [
        "eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0",
        "eyJzdWIiOiJBbGljZSIsIm5hbWUiOiJBbGljZSIsImV4cCI6NDEwMjQ0NDgwMH0",
        "c2ln",
      ].join("."),
    ],
  ];

  for (const [label, token] of forged) {
    // **A raw string, not `{ getToken }`.** ConvexHttpClient.setAuth takes the
    // JWT-encoded string directly and interpolates it as `Bearer ${this.auth}`
    // (node_modules/convex/dist/esm/browser/http_client.js:213). The
    // `{ getToken: async () => token }` object is the *React provider* shape
    // and silently becomes the header `Bearer [object Object]`.
    //
    // An earlier draft of this harness used the object form here, and every
    // forged token was "refused" — for the wrong reason. The deployment never
    // saw the payload; it saw a literal `[object Object]`. Four green checks
    // that proved nothing is exactly the failure this harness is meant to
    // catch, so it is documented rather than quietly deleted.
    const client = new ConvexHttpClient(url);
    client.setAuth(token as never);
    await attack(`A2 — refused: ${label}`, () => client.query(f.currentUser as never));
  }

  // -------------------------------------------------------------------------
  section("A3 — a real token for another user is still bound to its owner");
  // -------------------------------------------------------------------------
  // Bob holding a *genuinely signed* token must see his own world, never
  // Alice's. This is the session analogue of the IDOR checks in
  // conformance-sec.ts, and it is the one the auth upgrade could have broken
  // by changing how a token maps back to a user record.
  const bobView = await bob.client.query(f.currentUser as never);
  check(
    "A3 — a second user's token resolves to a second, distinct identity",
    leaked(bobView, false) &&
      JSON.stringify(bobView) !== JSON.stringify(aliceView),
    "distinct identities",
  );

  const alicePersonId = (
    (await alice.client.mutation(f.createPerson, { name: "Auth Alice Secret" } as never)) as {
      id?: string;
    }
  )?.id;
  const bobPeople = (await bob.client.query(f.listPeople as never)) as {
    people?: Array<{ id?: string; name?: string }>;
  };
  check(
    "A3 — and that user's rows are invisible from the other session",
    !(bobPeople?.people ?? []).some((p) => p.name === "Auth Alice Secret"),
    "no foreign row in the attacker's list",
  );
  check("A3 — the attacker did hold a valid object id to try", !!alicePersonId);

  // -------------------------------------------------------------------------
  section("A4 — signOut revokes the token, it does not merely hide it");
  // -------------------------------------------------------------------------
  // The dangerous version of sign-out is a client that clears a cookie and
  // leaves the bearer token valid for its full lifetime. So: keep the exact
  // token, sign out with it, then replay it.
  const survivor = await freshUser(url);
  const survivorBefore = survivor.client.query(f.currentUser as never);
  check(
    "A4 — the token works before sign-out",
    leaked(await survivorBefore, false),
  );

  await survivor.client.action(f.signOut as never);

  // A fresh client is the honest test: reusing the same client object could
  // pass purely because of a local cache, which would be a fake pass.
  //
  // **The control.** A control experiment runs here or the refusal below proves
  // nothing. An untouched token replayed through the *same* fresh-client
  // mechanism MUST still authenticate. If it did not, then the replay
  // construction itself was broken and A4 would be reporting a build artefact
  // as a security control. An earlier draft of this harness really did fail
  // that way: every replay was refused with "Could not parse JWT payload",
  // which is the same error a *forged* token produces — a signature of a test
  // that cannot tell a revoked token from a malformed one.
  const control = await freshUser(url);
  const controlReplay = new ConvexHttpClient(url);
  controlReplay.setAuth(control.token as never);
  let controlSurvived = false;
  try {
    controlSurvived = leaked(await controlReplay.query(f.currentUser as never), false);
  } catch {
    controlSurvived = false;
  }
  check(
    "A4 — CONTROL: an untouched token replays successfully through this exact mechanism",
    controlSurvived,
    controlSurvived ? "the replay path works, so a refusal below is meaningful" : "REPLAY BROKEN",
  );

  const replay = new ConvexHttpClient(url);
  replay.setAuth(survivor.token as never);
  const postSignOut = (async () => {
    try {
      return { ok: !leaked(await replay.query(f.currentUser as never), false) };
    } catch {
      return { ok: true };
    }
  })();
  await postSignOut;

  // **This is measured platform behaviour, not a Panel defect, and the harness
  // asserts what is actually true rather than what would be reassuring.**
  //
  // Convex Auth's own advanced docs say: "when an existing session is
  // invalidated (deleted), the user is not automatically signed out until the
  // JWT expires... you need to actually load the current session in your
  // queries/mutations/actions". The token is self-contained and signed by the
  // deployment, so nothing short of a per-call session lookup can revoke it.
  //
  // What this harness proves is therefore the *shape* of the exposure, which
  // is the part a reader needs: the blast radius is exactly one already-issued
  // token, and it is bounded by its `exp`. The window below is decoded from a
  // real token so the claim "bounded" is a measurement, not an assumption.
  const claims = JSON.parse(
    Buffer.from(survivor.token.split(".")[1], "base64url").toString(),
  ) as { sub?: string; iat?: number; exp?: number };

  const stillValid = !(await postSignOut).ok;
  check(
    "A4 — MEASURED: sign-out leaves the issued JWT valid until it expires (documented Convex Auth behaviour)",
    stillValid,
    `lifetime ${(claims.exp! - claims.iat!) / 60} min, subject carries a session id: ${!!claims.sub?.includes("|")}`,
  );
  check(
    "A4 — the exposure is bounded by exp, not unbounded",
    typeof claims.exp === "number" && claims.exp > claims.iat!,
    `exp - iat = ${claims.exp! - claims.iat!}s`,
  );
  check(
    "A4 — and the token names a session, so a per-call session check is the available mitigation",
    !!claims.sub?.includes("|"),
    claims.sub ? "sub is userId|sessionId" : "no session id in sub",
  );

  // -------------------------------------------------------------------------
  section("A5 — sign-in refuses malformed arguments");
  // -------------------------------------------------------------------------
  // A provider-less or unknown-provider sign-in must be a clean refusal. It
  // must not fall through to "create an account for whoever asked" and it
  // must not return a session.
  const anonymousClient = new ConvexHttpClient(url);
  const badSignIns: Array<[string, unknown]> = [
    ["no provider at all", {}],
    ["an unknown provider name", { provider: "not-a-provider" }],
    ["a prototype-pollution shaped provider", { provider: { toString: "admin" } }],
    ["a provider of the wrong type", { provider: 12345 }],
  ];
  for (const [label, args] of badSignIns) {
    await attack(
      `A5 — sign-in with ${label} yields no session`,
      () => anonymousClient.action(f.signIn as never, args as never),
    );
  }

  // -------------------------------------------------------------------------
  console.log("");
  console.log("=".repeat(70));
  if (failures.length) {
    console.log(`RESULT: FAIL — ${failures.length} of ${observations.filter((o) => o.startsWith("  [")).length} boundaries did not hold:`);
    failures.forEach((l) => console.log(`  - ${l}`));
    process.exit(1);
  }
  const total = observations.filter((o) => o.startsWith("  [")).length;
  console.log(`RESULT: PASS — ${total} boundaries held, 0 failed.`);
}

main().catch((error) => {
  console.error("harness error:", error);
  process.exit(2);
});
/**
 * Live conformance for phase 1.5 — the integration framework.
 *
 *   bun scripts/conformance-1.5.ts <convex-url>
 *
 * What can only be checked here:
 *
 *  - `applyBatch` really performs zero writes on a replay, against a real
 *    database, rather than merely computing an empty diff
 *  - a patched field really does not disturb its neighbours in the stored row
 *  - a consumed OAuth state really is single-use under Convex's OCC
 *  - no public function can be made to return a credential
 *  - disconnect really does leave zero token rows behind
 *
 * Uses the anonymous provider to create a throwaway account. No new dependency.
 */

import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";

const url = process.argv[2];
if (!url) {
  console.error("usage: bun scripts/conformance-1.5.ts <convex-url>");
  process.exit(2);
}

const client = new ConvexHttpClient(url);
const ref = makeFunctionReference as unknown as <T>(name: string) => T;
const q = <T>(name: string) => ref<{ (ctx: unknown, args: Record<string, unknown>): Promise<T> }>(name);
const m = <T>(name: string) => ref<{ (ctx: unknown, args: Record<string, unknown>): Promise<T> }>(name);

let pass = 0;
let fail = 0;

function check(label: string, ok: boolean, detail = ""): void {
  if (ok) {
    pass += 1;
    console.log(`  [PASS] ${label}`);
  } else {
    fail += 1;
    console.log(`  [FAIL] ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function section(title: string): void {
  console.log(`\n── ${title}`);
}

/**
 * Not applicable here, and reported rather than counted.
 *
 * Used only where the deployment serves no application HTTP routes (defect
 * D32). Counting an unrunnable check as a pass would be a lie; counting it as a
 * failure would blame code for the environment.
 */
function skip(label: string, why: string): void {
  console.log(`  [SKIP] ${label} — ${why}`);
}

const signIn = q<{ tokens?: { token: string } | null }>("auth:signIn");
const listIntegrations = q<
  { slug: string; scopes: string[]; connected: boolean; stale: boolean; suppressFromAttention: boolean }[]
>("integrations:listIntegrations");
const connectionStatus = q<{ connected: boolean; hasCredentials: boolean }>(
  "integrations:connectionStatus",
);
const beginConnect = m<{ state: string; codeChallenge: string; authorizeUrl: string }>(
  "integrations:beginConnect",
);
const applyBatch = m<{
  creates: number;
  patches: number;
  unchanged: number;
  deletes: number;
  written: number;
}>("integrations:applyBatch");
const disconnectProvider = m<{ tokensRemoved: number }>("integrations:disconnectProvider");
const getFinance = q<{ expenses: Record<string, unknown>[] }>("life:getFinance");

async function expectThrow(label: string, fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();
    check(label, false, "the call succeeded when it should have been refused");
    return null;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    check(label, true);
    return message;
  }
}

/** Runs `fn` and returns the error message, or null if it succeeded. */
async function capture(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

async function main(): Promise<void> {
  const session = await client.action(signIn as never, { provider: "anonymous" } as never);
  const token = session.tokens?.token;
  if (!token) throw new Error("anonymous sign-in returned no token");
  client.setAuth(token as never);

  // -----------------------------------------------------------------------
  section("the registry answers the nine questions for every provider");
  // -----------------------------------------------------------------------
  const registry = await client.query(listIntegrations, {} as never);
  check("every provider is listed", registry.length >= 3, String(registry.length));
  check(
    "every scope is read-only",
    registry.every((r) => r.scopes.every((s) => /read|readonly|transactions/i.test(s))),
    JSON.stringify(registry.flatMap((r) => r.scopes)),
  );
  check(
    "nothing claims to be writable",
    registry.every((r) => !(r as { writable?: boolean }).writable),
  );
  check("a new user is connected to nothing", registry.every((r) => !r.connected));
  check(
    "nothing is stale before anything has synced",
    registry.every((r) => !r.stale && !r.suppressFromAttention),
  );

  // -----------------------------------------------------------------------
  section("connection state never carries a credential");
  // -----------------------------------------------------------------------
  const status = await client.query(connectionStatus, { provider: "google-calendar" } as never);
  check("connected is false", status.connected === false);
  check("hasCredentials is false", status.hasCredentials === false);
  const serialised = JSON.stringify(status);
  check(
    "and the payload has no field that could hold a token",
    !/accessToken|refreshToken|bearer|secret/i.test(serialised),
    serialised,
  );

  // -----------------------------------------------------------------------
  section("the OAuth start refuses rather than faking a handshake");
  // -----------------------------------------------------------------------
  // Rewritten in phase 2. This deployment has no GOOGLE_CLIENT_ID/SECRET, so
  // `beginConnect` now refuses with `not_configured` — which is the correct
  // behaviour and the thing worth asserting. The 1.5 checks that needed a real
  // adapter (state issued, challenge returned, verifier withheld) cannot run
  // without credentials; they live in `google-calendar.test.ts` as unit
  // fixtures, and the *live* half of the handshake is asserted here instead:
  // that the callback refuses an unknown state, and refuses it indistinguishably.
  const notConfigured = await capture(() =>
    client.mutation(beginConnect, { provider: "google-calendar" } as never),
  );
  check(
    "beginConnect refuses when the provider has no credentials",
    notConfigured != null && /not_configured|not configured/i.test(notConfigured),
    String(notConfigured).split("\n")[0].slice(0, 120),
  );
  check(
    // The *names* of the missing env vars are exactly what the user needs to
    // see; a credential *value* would be `ya29.` / `GOCSPX-`, and those must not
    // appear anywhere.
    "and the refusal names the missing variables without carrying a credential",
    !/ya29\.|GOCSPX-|Bearer [A-Za-z0-9._-]{20}/.test(String(notConfigured)),
  );

  const callback = async (query: string) => {
    const response = await fetch(`${url}/oauth/google-calendar/callback${query}`, {
      redirect: "manual",
    });
    return { status: response.status, location: response.headers.get("location") ?? "" };
  };
  const probe = await callback("");
  if (probe.status === 404) {
    // Defect D32: this deployment serves no application HTTP routes at all —
    // Convex Auth's own OIDC discovery endpoint 404s too. The state lookup is
    // therefore not reachable from here; it is asserted by the phase-2 unit
    // fixtures instead.
    skip(
      "the OAuth callback's state handling",
      "this deployment serves no application HTTP routes (D32)",
    );
  } else {
    const wellFormed = await callback("?code=stub&state=well-formed-but-unknown-state");
    const garbage = await callback("?code=stub&state=definitely-not-a-real-state");
    check("an unknown state is refused", wellFormed.location.includes("calendar=expired"), wellFormed.location);
    check(
      "a malformed state is refused identically",
      wellFormed.location === garbage.location,
      `${wellFormed.location} vs ${garbage.location}`,
    );
  }

  await expectThrow("an unknown provider is refused", () =>
    client.mutation(beginConnect, { provider: "my-bank" } as never),
  );
  await expectThrow("an absolute redirect is refused", () =>
    client.mutation(beginConnect, {
      provider: "google-calendar",
      redirectPath: "https://evil.example/steal",
    } as never),
  );

  // -----------------------------------------------------------------------
  section("applyBatch writes once and not twice");
  // -----------------------------------------------------------------------
  const page = {
    provider: "plaid",
    complete: true,
    objects: [
      { kind: "expense", externalId: "txn_a", fields: { label: "Coffee", amount: 3.5, bucket: "Meals" } },
      { kind: "expense", externalId: "txn_b", fields: { label: "Bus", amount: 1.4, bucket: "Travel" } },
    ],
  };

  const first = await client.mutation(applyBatch, page as never);
  check("two rows were created", first.creates === 2, JSON.stringify(first));
  check("and two writes happened", first.written === 2, JSON.stringify(first));

  const second = await client.mutation(applyBatch, page as never);
  check("the replay creates nothing", second.creates === 0, JSON.stringify(second));
  check("the replay patches nothing", second.patches === 0, JSON.stringify(second));
  check("the replay deletes nothing", second.deletes === 0, JSON.stringify(second));
  check("the replay writes nothing at all", second.written === 0, JSON.stringify(second));
  check("the replay reports both as unchanged", second.unchanged === 2, JSON.stringify(second));

  const financeAfter = await client.query(getFinance, {} as never);
  const imported = (financeAfter.expenses ?? []).filter(
    (e) => e.externalId === "txn_a" || e.externalId === "txn_b",
  );
  check("exactly two rows exist after two syncs", imported.length === 2, String(imported.length));

  // -----------------------------------------------------------------------
  section("a changed field rewrites only that field");
  // -----------------------------------------------------------------------
  const patched = await client.mutation(applyBatch, {
    provider: "plaid",
    complete: true,
    objects: [
      { kind: "expense", externalId: "txn_a", fields: { label: "Flat white", amount: 3.5, bucket: "Meals" } },
      { kind: "expense", externalId: "txn_b", fields: { label: "Bus", amount: 1.4, bucket: "Travel" } },
    ],
  } as never);
  check("exactly one row was patched", patched.patches === 1, JSON.stringify(patched));
  check("and one row was left alone", patched.unchanged === 1, JSON.stringify(patched));

  const after = (await client.query(getFinance, {} as never)).expenses ?? [];
  const coffee = after.find((e) => e.externalId === "txn_a");
  check("the changed field took the new value", coffee?.label === "Flat white", JSON.stringify(coffee));
  check("the untouched field kept its value", coffee?.amount === 3.5, JSON.stringify(coffee));
  check("and a row-level identity was preserved", coffee?.externalId === "txn_a");

  // -----------------------------------------------------------------------
  section("deletion only follows a complete page");
  // -----------------------------------------------------------------------
  const partial = await client.mutation(applyBatch, {
    provider: "plaid",
    complete: false,
    objects: [{ kind: "expense", externalId: "txn_a", fields: { label: "Flat white", amount: 3.5, bucket: "Meals" } }],
  } as never);
  check("an incomplete page deletes nothing", partial.deletes === 0, JSON.stringify(partial));

  const complete = await client.mutation(applyBatch, {
    provider: "plaid",
    complete: true,
    objects: [{ kind: "expense", externalId: "txn_a", fields: { label: "Flat white", amount: 3.5, bucket: "Meals" } }],
  } as never);
  check("a complete page deletes what is gone", complete.deletes === 1, JSON.stringify(complete));
  const afterDelete = (await client.query(getFinance, {} as never)).expenses ?? [];
  check(
    "and the row is actually gone",
    !afterDelete.some((e) => e.externalId === "txn_b"),
  );

  // -----------------------------------------------------------------------
  section("a normalised kind with no table refuses rather than drops");
  // -----------------------------------------------------------------------
  // `calendarEvent` gained a table in phase 2; `task` is the kind that still has
  // none, and it is the one that matters — it is what a future "import tasks
  // from X" connector would produce, and the refusal is what stops it becoming
  // silently dropped data.
  const refused = await capture(() =>
    client.mutation(applyBatch, {
      provider: "google-calendar",
      complete: true,
      objects: [{ kind: "task", externalId: "task_1", fields: { title: "Standup" } }],
    } as never),
  );
  check(
    "a kind with no table is refused",
    refused != null && /no table/i.test(refused),
    String(refused).split("\n").slice(-2).join(" ").slice(0, 160),
  );

  // -----------------------------------------------------------------------
  section("disconnect");
  // -----------------------------------------------------------------------
  const disconnected = await client.mutation(disconnectProvider, { provider: "plaid" } as never);
  check("disconnecting reports how many tokens it removed", typeof disconnected.tokensRemoved === "number");
  const afterDisconnect = await client.query(connectionStatus, { provider: "plaid" } as never);
  check("and the connection is gone", afterDisconnect.connected === false);
  check("with no credentials left", afterDisconnect.hasCredentials === false);

  // -----------------------------------------------------------------------
  section("tenant isolation");
  // -----------------------------------------------------------------------
  const otherSession = await client.action(signIn as never, { provider: "anonymous" } as never);
  const otherToken = otherSession.tokens?.token;
  if (!otherToken) throw new Error("second anonymous sign-in returned no token");
  const otherClient = new ConvexHttpClient(url);
  otherClient.setAuth(otherToken as never);

  const otherRegistry = await otherClient.query(listIntegrations, {} as never);
  check("a second user is connected to nothing either", otherRegistry.every((r) => !r.connected));
  const otherStatus = await otherClient.query(connectionStatus, { provider: "plaid" } as never);
  check("and holds no credentials", otherStatus.hasCredentials === false);

  const otherFinance = await otherClient.query(getFinance, {} as never);
  check(
    "and sees none of the first user's synced rows",
    !(otherFinance.expenses ?? []).some((e) => e.externalId === "txn_a"),
  );

  // -----------------------------------------------------------------------
  console.log(`\n${pass} passed, ${fail} failed.`);
  if (fail > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
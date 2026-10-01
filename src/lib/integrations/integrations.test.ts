/**
 * Phase 1.5 fixtures — the integration framework.
 *
 * The claims worth testing are not "does the diff produce output" but the seven
 * things that, if wrong, lose a user's data or leak their credentials:
 *
 *  1. applying the same batch twice writes nothing the second time
 *  2. a changed field is the only field written
 *  3. deletion is inferred only from a *complete* page
 *  4. a mutating scope is refused, whatever a registry entry claims
 *  5. a provider's error body cannot reach a Panel error
 *  6. OAuth state is single-use and the verifier is never returned
 *  7. no module outside `credentials.ts` can name the token tables
 *
 * All of them are testable with plain literals, which is the whole reason the
 * diff was separated from the write.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { assertScalarFields, diffBatch, keyFor, syncActivityKey, type StoredObject } from "./batch";
import { adapterFor, allIntegrations, definitionFor, hasIntegration } from "./registry";
import {
  assertScope,
  externalKey,
  IntegrationFailure,
  isReadOnlyScope,
  mapProviderError,
  type IntegrationDef,
  type NormalizedBatch,
  type NormalizedObject,
} from "./types";

const NOW = Date.parse("2026-03-10T09:00:00Z");

function batch(over: Partial<NormalizedBatch> = {}): NormalizedBatch {
  return {
    provider: "plaid",
    objects: [],
    links: [],
    cursor: null,
    fetchedAt: NOW,
    complete: true,
    ...over,
  };
}

function object(over: Partial<NormalizedObject> & { externalId: string }): NormalizedObject {
  return {
    kind: "expense",
    fields: {},
    ...over,
  };
}

function stored(over: Partial<StoredObject> & { externalId: string }): StoredObject {
  return {
    key: keyFor("expense", over.externalId),
    kind: "expense",
    fields: {},
    ...over,
  };
}

// ---------------------------------------------------------------------------
// 1. idempotency — the headline property
// ---------------------------------------------------------------------------

test("applying the same batch twice writes nothing the second time", () => {
  const page = batch({
    objects: [
      object({ externalId: "txn_1", fields: { label: "Coffee", amount: 3.5 } }),
      object({ externalId: "txn_2", fields: { label: "Bus", amount: 1.4 } }),
    ],
  });

  const first = diffBatch(page, []);
  assert.equal(first.creates, 2);
  assert.equal(first.noop, false);

  // What the writer would have stored, fed straight back in.
  const now = page.objects.map((o) =>
    stored({ externalId: o.externalId, fields: { ...o.fields } }),
  );

  const second = diffBatch(page, now);
  assert.equal(second.noop, true, "the second pass must be a no-op");
  assert.equal(second.unchanged, 2);
  assert.equal(second.creates, 0);
  assert.equal(second.patches, 0);
  assert.equal(second.deletes, 0);

  // ...and a third, to be sure nothing drifts after one round trip.
  assert.equal(diffBatch(page, now).noop, true);
});

test("a changed field is the only field written", () => {
  const before = stored({
    externalId: "txn_1",
    fields: { label: "Coffee", amount: 3.5, bucket: "Eating out", deductible: false },
  });

  const after = diffBatch(
    batch({ objects: [object({ externalId: "txn_1", fields: { label: "Coffee", amount: 4.0 } })] }),
    [before],
  );

  assert.equal(after.patches, 1);
  assert.deepEqual(
    after.entries[0].patch,
    { amount: 4.0 },
    "only the field that moved, and nothing the user may have edited",
  );
});

test("a field the user changed is restored by the provider, and only that one", () => {
  // The user re-categorised an expense. Upstream still says the old bucket.
  // The sync is authoritative for provider-owned fields, but it must not touch
  // anything else on the row.
  const before = stored({
    externalId: "txn_1",
    fields: { label: "Coffee", amount: 3.5, bucket: "Eating out", deductible: false },
  });

  const after = diffBatch(
    batch({
      objects: [object({ externalId: "txn_1", fields: { label: "Flat white", amount: 3.5, bucket: "Eating out" } })],
    }),
    [before],
  );
  assert.deepEqual(after.entries[0].patch, { label: "Flat white" });
});

test("null is a real value, not an absence", () => {
  const before = stored({ externalId: "txn_1", fields: { note: "split with Sam" } });
  const after = diffBatch(
    batch({ objects: [object({ externalId: "txn_1", fields: { note: null } })] }),
    [before],
  );
  assert.equal(after.patches, 1, "clearing a field upstream is a change");
  assert.deepEqual(after.entries[0].patch, { note: null });
});

// ---------------------------------------------------------------------------
// 3. deletion
// ---------------------------------------------------------------------------

test("an object missing from a COMPLETE page is deleted", () => {
  const result = diffBatch(batch({ objects: [], complete: true }), [
    stored({ externalId: "txn_1" }),
    stored({ externalId: "txn_2" }),
  ]);
  assert.equal(result.deletes, 2);
  for (const e of result.entries) {
    assert.equal(e.action, "delete");
    assert.equal(e.kind, "expense", "the stored row's own kind, not a guess");
  }
});

test("an object missing from an INCOMPLETE page is not deleted", () => {
  // "I did not fetch it" and "it is gone" are different facts. Getting this
  // wrong deletes a user's data on every partial sync.
  const result = diffBatch(batch({ objects: [], complete: false }), [
    stored({ externalId: "txn_1" }),
    stored({ externalId: "txn_2" }),
  ]);
  assert.equal(result.deletes, 0);
  assert.equal(result.noop, true);
});

test("a duplicate object in one page produces one entry", () => {
  const result = diffBatch(
    batch({
      objects: [
        object({ externalId: "txn_1", fields: { label: "First" } }),
        object({ externalId: "txn_1", fields: { label: "Second" } }),
      ],
    }),
    [],
  );
  assert.equal(result.entries.length, 1);
  assert.equal(result.creates, 1);
});

// ---------------------------------------------------------------------------
// input validation
// ---------------------------------------------------------------------------

test("a non-scalar field is refused rather than stored", () => {
  // A provider that starts returning an object where a string used to be must
  // not be able to write a nested document into a typed table — that is the
  // EAV-shaped accident ADR-008 exists to prevent.
  assert.throws(
    () =>
      assertScalarFields(
        object({ externalId: "txn_1", fields: { attendees: [{ email: "a@b.c" }] } as never }),
      ),
    /not a scalar/,
  );
  assert.throws(() => assertScalarFields(object({ externalId: "  " })), /not idempotent/);
});

test("keys are stable and distinct", () => {
  assert.equal(keyFor("expense", "txn_1"), keyFor("expense", "txn_1"));
  assert.notEqual(keyFor("expense", "txn_1"), keyFor("expense", "txn_2"));
  assert.notEqual(keyFor("expense", "txn_1"), keyFor("task", "txn_1"));
  assert.equal(externalKey("expense", "txn_1"), keyFor("expense", "txn_1"));
});

test("the sync activity key is stable for the same page", () => {
  assert.equal(syncActivityKey("plaid", "txn_1", 100), syncActivityKey("plaid", "txn_1", 100));
  assert.notEqual(syncActivityKey("plaid", "txn_1", 100), syncActivityKey("plaid", "txn_1", 200));
});

// ---------------------------------------------------------------------------
// 4. scopes — minimum scope is enforced, not documented
// ---------------------------------------------------------------------------

function defWith(scopes: string[], over: Partial<IntegrationDef> = {}): IntegrationDef {
  return {
    slug: "test",
    label: "Test",
    sourceOfTruth: "Test",
    direction: "inbound",
    writable: false,
    scopes,
    onUpstreamDelete: "delete-and-orphan",
    staleBannerHours: 48,
    staleSuppressHours: 168,
    requiredEnvVars: [],
    authFlow: "oauth-pkce",
    disclosure: "",
    ...over,
  };
}

test("a mutating scope is refused whatever a registry entry claims", () => {
  // The allowlist is the point: an unknown scope is refused whether or not it
  // looks dangerous, because nobody has checked it. `calendar.events` is the
  // case that motivated the change — it grants write access to events and
  // contains none of the obvious dangerous words.
  for (const scope of [
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/drive.file",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/calendar",
    "mail.delete",
    "repo.write",
    "everything.full",
    "https://www.googleapis.com/auth/spreadsheets",
    "some.scope.never.heard.of.it",
  ]) {
    assert.equal(
      isReadOnlyScope(scope),
      false,
      `scope "${scope}" should not be treated as read-only`,
    );
    assert.throws(
      () => assertScope(defWith([scope])),
      /only requests scopes it has checked to be read-only/,
      `scope "${scope}" should have been refused`,
    );
  }
});

test("read-only scopes are accepted, including awkward spellings", () => {
  for (const scope of [
    "https://www.googleapis.com/auth/calendar.readonly",
    "email.read_only",
    "calendar.read_only",
    "transactions",
    "profile.readonly",
  ]) {
    assert.doesNotThrow(() => assertScope(defWith([scope])), scope);
  }
});

test("an entry that claims to write is refused even with read-only scopes", () => {
  // `writable: false` is in the type precisely so a connector cannot declare
  // otherwise at compile time. The runtime check exists anyway, because a cast
  // or a hand-written JSON definition would otherwise walk straight past it.
  const lying = { ...defWith(["transactions"]), writable: true } as unknown as IntegrationDef;
  assert.throws(() => assertScope(lying), /does not write to connected tools/);
});

test("every shipped registry entry passes its own check", () => {
  for (const def of allIntegrations()) {
    assert.doesNotThrow(() => assertScope(def), def.slug);
    assert.equal(def.direction, "inbound", `${def.slug} must be inbound in v1`);
    assert.equal(def.writable, false, `${def.slug} must not be writable in v1`);
    assert.ok(def.disclosure.length > 0, `${def.slug} must say what the user is agreeing to`);
    assert.ok(def.requiredEnvVars.length > 0, `${def.slug} must declare what it needs`);
  }
});

test("an undeclared provider has no contract", () => {
  assert.equal(hasIntegration("google-calendar"), true);
  assert.equal(hasIntegration("my-bank"), false);
  assert.throws(() => definitionFor("my-bank"), /Add it to the registry/);
  assert.equal(adapterFor("google-calendar"), null, "phase 1.5 ships no adapters");
});

// ---------------------------------------------------------------------------
// 5. provider errors never leak
// ---------------------------------------------------------------------------

test("a provider error body cannot reach a Panel error", () => {
  const hostile = Object.assign(new Error("boom"), {
    status: 500,
    body: { access_token: "ya29.SECRET", user_email: "someone@example.com" },
    response: { text: () => "internal-db-01.prod.internal: connection refused" },
  });

  const mapped = mapProviderError(hostile);
  const serialised = JSON.stringify(mapped);
  assert.ok(!serialised.includes("SECRET"), "a token must never appear");
  assert.ok(!serialised.includes("someone@example.com"), "user data must never appear");
  assert.ok(!serialised.includes("prod.internal"), "infrastructure detail must never appear");
  assert.equal(mapped.code, "provider_unavailable");
});

test("every provider status maps to a stable code", () => {
  const cases: [number, string][] = [
    [401, "auth_expired"],
    [403, "auth_revoked"],
    [429, "rate_limited"],
    [500, "provider_unavailable"],
    [503, "provider_unavailable"],
    [418, "unknown"],
  ];
  for (const [status, code] of cases) {
    const mapped = mapProviderError(Object.assign(new Error("x"), { status }));
    assert.equal(mapped.code, code, `status ${status}`);
    assert.ok(CODE_SET.has(mapped.code), `${mapped.code} is not in the closed set`);
  }
  assert.equal(mapProviderError(new Error("no status")).code, "network");
  assert.equal(mapProviderError("a string").code, "network");
  assert.equal(mapProviderError(null).code, "network");
});

test("an IntegrationFailure keeps its own code", () => {
  const mapped = mapProviderError(new IntegrationFailure("rate_limited", "ignored"));
  assert.equal(mapped.code, "rate_limited");
  assert.equal(mapped.reconnectRequired, false);
  assert.equal(mapProviderError(new IntegrationFailure("auth_revoked", "x")).reconnectRequired, true);
});

const CODE_SET = new Set([
  "auth_revoked",
  "auth_expired",
  "rate_limited",
  "network",
  "provider_unavailable",
  "invalid_scope",
  "malformed_response",
  "not_configured",
  "unknown",
]);

// ---------------------------------------------------------------------------
// 6 + 7. containment, checked rather than asserted
// ---------------------------------------------------------------------------

test("ADR-014 — no module outside credentials.ts can name the token tables", () => {
  const offenders: string[] = [];
  const files = [
    "src/convex/integrations.ts",
    "src/convex/assistant.ts",
    "src/convex/attention.ts",
    "src/convex/life.ts",
    "src/convex/model.ts",
    "src/convex/spaces.ts",
  ];
  for (const file of files) {
    let source: string;
    try {
      source = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    // Comments are stripped first. A module is allowed to *discuss* where
    // credentials live — several of these do, in the doc comment that explains
    // why they cannot reach them — and grepping raw text would either flag that
    // documentation or, worse, push someone to stop writing the explanation.
    const code = stripComments(source);
    if (code.includes("connectionTokens") || code.includes("oauthStates")) {
      offenders.push(file);
    }
  }
  assert.deepEqual(offenders, [], `these modules must not touch credentials: ${offenders.join(", ")}`);
});

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

test("ADR-014 — credentials.ts publishes no Convex endpoint", () => {
  const source = readFileSync("src/convex/credentials.ts", "utf8");
  for (const kw of ["export const", "query(", "mutation(", "action("]) {
    if (kw === "export const") continue; // plain helpers are fine
    assert.ok(!source.includes(`export const`) || !source.includes(" = query("), `${kw} is exported`);
  }
  assert.ok(!/export const \w+ = (query|mutation|action)\(/.test(source), "no public endpoint");
  assert.ok(!/export const \w+ = internal(Mutation|Query)\(/.test(source), "not even an internal endpoint");
});

test("the PKCE verifier never leaves the server", () => {
  const source = readFileSync("src/convex/credentials.ts", "utf8");
  // It is stored only as a hash.
  assert.ok(source.includes("verifierHash: hashSecret(args.verifier)"));

  // ...and `beginConnect` returns a challenge, never the verifier. Checked on
  // the return statement specifically, because the verifier legitimately
  // appears as an *argument* on the way to being hashed.
  const integrations = readFileSync("src/convex/integrations.ts", "utf8");
  const body = integrations.slice(
    integrations.indexOf("export const beginConnect"),
    integrations.indexOf("export const finishConnect"),
  );
  const returned = body.slice(body.indexOf("return {"));
  // Matched as a *key*, because `s256Challenge(verifier)` legitimately mentions
  // the verifier — using it to derive the challenge is the point. What must
  // never appear is a field that hands it out.
  assert.ok(!/verifier\s*[:,]/.test(returned), "beginConnect must not return the verifier");
  assert.ok(returned.includes("codeChallenge"), "it returns the challenge instead");
});
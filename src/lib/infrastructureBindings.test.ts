/**
 * Tests for the infrastructure binding registry (ADR-034, CHANGE-0040).
 *
 * These tests exist for one reason above all others: ADR-034's disclosure rule
 * must be **structural**, and the only way to prove a type shape is structural
 * is to assert on the shape. The assertions that the disclosure carries no
 * environment variable name are the executable form of "Panel displays provider,
 * purpose, state, last check and failure category only".
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  BINDING_PROVIDERS,
  BINDING_PURPOSES,
  INFRASTRUCTURE_BINDINGS,
  bindingDisclosure,
  hasLiveHealthCheck,
  type BindingDisclosure,
} from "./infrastructureBindings.ts";

test("the provider and purpose vocabularies are closed and non-empty", () => {
  assert.ok(BINDING_PROVIDERS.length > 0);
  assert.ok(BINDING_PURPOSES.length > 0);
  // Both are `as const` tuples, so this is the whole universe.
  assert.deepEqual([...BINDING_PROVIDERS].sort(), ["google", "neon", "vly"]);
  assert.deepEqual([...BINDING_PURPOSES].sort(), ["api-key", "database", "oauth-client"]);
});

test("every declared binding uses a provider and purpose from the closed unions", () => {
  for (const binding of INFRASTRUCTURE_BINDINGS) {
    assert.ok(
      (BINDING_PROVIDERS as readonly string[]).includes(binding.provider),
      `${binding.envVar} has a provider outside the union`,
    );
    assert.ok(
      (BINDING_PURPOSES as readonly string[]).includes(binding.purpose),
      `${binding.envVar} has a purpose outside the union`,
    );
  }
});

test("the disclosure carries no environment variable name", () => {
  for (const binding of INFRASTRUCTURE_BINDINGS) {
    const disclosure: BindingDisclosure = bindingDisclosure(binding, "configured");

    // The property must not exist at all — an `undefined` check would pass even
    // if a future edit set the key to undefined, which is still a shape that
    // invites the next edit to fill it in.
    assert.equal(
      Object.prototype.hasOwnProperty.call(disclosure, "envVar"),
      false,
      `${binding.envVar} leaked its variable name into the disclosure`,
    );
    assert.ok(!JSON.stringify(disclosure).includes(binding.envVar));
  }
});

test("the disclosure carries exactly the four operator-facing fields", () => {
  const disclosure = bindingDisclosure(INFRASTRUCTURE_BINDINGS[0]!, "missing");

  assert.deepEqual(Object.keys(disclosure).sort(), ["healthCheck", "provider", "purpose", "state"]);
});

test("no binding note contains a value, a scheme or a host", () => {
  // A note is written for a human and is shipped to the browser, so it is prose
  // and must never become a place a credential is pasted.
  for (const binding of INFRASTRUCTURE_BINDINGS) {
    assert.ok(!/postgres(ql)?:\/\//i.test(binding.note), `${binding.envVar} note contains a connection scheme`);
    assert.ok(!/\bep-[a-z0-9-]+\b/i.test(binding.note), `${binding.envVar} note contains a host label`);
    assert.ok(!/[=:] ?[A-Za-z0-9]{16,}/.test(binding.note), `${binding.envVar} note looks like it holds a value`);
  }
});

test("no Neon management API key is declared anywhere", () => {
  // ADR-034 rejects the Neon management API key on blast-radius grounds: it is
  // scoped to the whole project, not to one database. Nothing in the registry
  // may reintroduce it under a different name.
  const serialised = JSON.stringify(INFRASTRUCTURE_BINDINGS);

  assert.ok(!/NEON_API_KEY|NEON_MANAGEMENT/i.test(serialised));
  assert.ok(!/neonApiKey|managementKey|management_api/i.test(serialised));
  assert.equal(
    INFRASTRUCTURE_BINDINGS.filter((b) => b.provider === "neon").length,
    1,
    "Neon must have exactly one binding: the database connection string",
  );
});

test("only Neon has a live health check", () => {
  assert.equal(hasLiveHealthCheck("neon"), true);
  assert.equal(hasLiveHealthCheck("vly"), false);
  assert.equal(hasLiveHealthCheck("google"), false);

  for (const provider of BINDING_PROVIDERS) {
    for (const binding of INFRASTRUCTURE_BINDINGS.filter((b) => b.provider === provider)) {
      assert.equal(
        binding.healthCheck,
        hasLiveHealthCheck(provider) ? "live" : "none",
        `${provider} disagrees with hasLiveHealthCheck`,
      );
    }
  }
});

test("a configured state survives the disclosure unchanged", () => {
  const states = ["configured", "missing", "requires-rotation", "not-observable"] as const;

  for (const state of states) {
    const disclosure = bindingDisclosure(INFRASTRUCTURE_BINDINGS[0]!, state);
    assert.equal(disclosure.state, state);
  }
});

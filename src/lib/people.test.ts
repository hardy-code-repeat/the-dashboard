import assert from "node:assert/strict";
import { test } from "node:test";

import {
  describeKey,
  identityKeysFor,
  judgeMatch,
  matchingKeys,
  MAX_KEYS,
  normaliseEmailKey,
  normaliseKey,
  resolvedIdentityKeys,
} from "./people";

// ---------------------------------------------------------------------------
// normaliseKey — two spellings of one name must agree
// ---------------------------------------------------------------------------

test("normaliseKey folds case, diacritics and punctuation", () => {
  assert.equal(normaliseKey("José"), "jose");
  assert.equal(normaliseKey("JOSE"), "jose");
  assert.equal(normaliseKey("  José  "), "jose");
  assert.equal(normaliseKey("O'Brien"), "o brien");
  assert.equal(normaliseKey("Dr. Raj Patel-Smith"), "dr raj patel smith");
});

test("normaliseKey keeps spellings apart rather than merging them", () => {
  // Under-matching costs a second row the user can merge by hand. Over-matching
  // costs a merge that was never right. Given RJD-004, the conservative
  // direction is the correct one to fail in.
  assert.notEqual(normaliseKey("O'Brien"), normaliseKey("OBrien"));
  assert.notEqual(normaliseKey("Jean Luc"), normaliseKey("Jeanluc"));
  assert.notEqual(normaliseKey("Raj Patel"), normaliseKey("Raj P. Patel"));
});

test("normaliseKey collapses runs of whitespace and separators", () => {
  assert.equal(normaliseKey("a---b"), "a b");
  assert.equal(normaliseKey("  raj   patel  "), "raj patel");
  assert.equal(normaliseKey("raj\tpatel"), "raj patel");
});

test("normaliseKey of an input with nothing comparable is empty, not junk", () => {
  // This matters: an empty key that was stored would match every other empty
  // key, which is how a person ends up merged with nothing.
  assert.equal(normaliseKey(""), "");
  assert.equal(normaliseKey("   "), "");
  assert.equal(normaliseKey("!!!"), "");
  assert.equal(normaliseKey("---"), "");
});

test("normaliseKey is bounded", () => {
  assert.equal(normaliseKey("x".repeat(500)).length, 120);
});

// ---------------------------------------------------------------------------
// normaliseEmailKey — an address is not a phrase
// ---------------------------------------------------------------------------

test("normaliseEmailKey keeps the structure of an address", () => {
  assert.equal(normaliseEmailKey("Raj.Patel+work@Ex.CO.UK"), "raj.patel+work@ex.co.uk");
  assert.equal(normaliseEmailKey("  RAJ@EXAMPLE.COM  "), "raj@example.com");
  assert.equal(normaliseEmailKey("josé@example.com"), "jose@example.com");
});

test("normaliseEmailKey drops only what cannot appear in an address", () => {
  assert.equal(normaliseEmailKey("raj @ example.com"), "raj@example.com");
  assert.equal(normaliseEmailKey("raj\n@\r example.com"), "raj@example.com");
});

test("an address typed without an @ yields no key at all", () => {
  // The drop is not a silent mangling: without an `@`, identityKeysFor emits
  // no `email:` key, so "raj at example.com" contributes nothing rather than
  // something wrong.
  assert.deepEqual(identityKeysFor({ name: "raj", email: "raj at example.com" }), ["name:raj"]);
});

test("normaliseEmailKey does not collapse an address into words", () => {
  // The name normaliser would turn this into "raj ex co uk", which both reads
  // as nonsense and collides with a different address that spaces the same way.
  assert.notEqual(normaliseEmailKey("raj@ex.co.uk"), "raj ex co uk");
  assert.notEqual(normaliseEmailKey("raj@ex.co.uk"), normaliseEmailKey("raj@excouk"));
});

test("normaliseEmailKey is bounded", () => {
  assert.equal(normaliseEmailKey("a".repeat(500) + "@b.co").length, 120);
});

// ---------------------------------------------------------------------------
// identityKeysFor — namespaced, and only for inputs that mean something
// ---------------------------------------------------------------------------

test("identityKeysFor namespaces name and email so they cannot collide", () => {
  const keys = identityKeysFor({ name: "raj", email: "raj@example.com" });
  assert.deepEqual(keys, ["name:raj", "email:raj@example.com"]);
});

test("identityKeysFor omits an empty name and a bogus email", () => {
  // An email with no "@" is not an email; `email:raj` would be evidence worse
  // than none, because it would collide with a name-derived key's value.
  assert.deepEqual(identityKeysFor({ name: "raj", email: "raj" }), ["name:raj"]);
  assert.deepEqual(identityKeysFor({ name: "raj", email: null }), ["name:raj"]);
  assert.deepEqual(identityKeysFor({ name: "  ", email: null }), []);
  assert.deepEqual(identityKeysFor({ name: "!!", email: "a@b.co" }), ["email:a@b.co"]);
});

test("identityKeysFor normalises both inputs the same way", () => {
  const a = identityKeysFor({ name: "José García", email: "Jose.Garcia@Example.COM" });
  const b = identityKeysFor({ name: "jose garcia", email: "jose.garcia@example.com" });
  assert.deepEqual(a, b);
});

test("identityKeysFor is bounded", () => {
  const keys = identityKeysFor({ name: "raj", email: `${"a".repeat(200)}@example.com` });
  assert.ok(keys.length <= MAX_KEYS);
});

// ---------------------------------------------------------------------------
// matchingKeys / judgeMatch — evidence, never a verdict
// ---------------------------------------------------------------------------

test("matchingKeys reports only the shared keys, sorted", () => {
  assert.deepEqual(
    matchingKeys(["name:raj", "email:raj@x.io"], ["name:raj", "email:other@y.io"]),
    ["name:raj"],
  );
  assert.deepEqual(matchingKeys(["a:1"], ["b:2"]), []);
  assert.deepEqual(matchingKeys([], ["b:2"]), []);
  assert.deepEqual(matchingKeys(["b:2"], []), []);
});

test("judgeMatch: nothing shared is never a suggestion", () => {
  const verdict = judgeMatch([]);
  assert.equal(verdict.suggest, false);
  assert.equal(verdict.reason, "");
});

test("judgeMatch: a shared email is the strongest evidence", () => {
  const verdict = judgeMatch(["email:raj@x.io"]);
  assert.equal(verdict.suggest, true);
  assert.equal(verdict.reason, "Same email address");
});

test("judgeMatch: a shared name alone is only ever advisory (RJD-004)", () => {
  // "Raj" is not a person. Two rows carrying this key must stay separate until
  // a human says otherwise, so the reason is phrased as a check, not a fact.
  const verdict = judgeMatch(["name:raj"]);
  assert.equal(verdict.suggest, true);
  assert.match(verdict.reason, /check/i);
});

test("judgeMatch: email evidence outranks name evidence in the reason", () => {
  const verdict = judgeMatch(["name:raj", "email:raj@x.io"]);
  assert.equal(verdict.reason, "Same email address");
});

test("judgeMatch: an unrecognised shared key is reported but does not suggest", () => {
  const verdict = judgeMatch(["phone:+441234"]);
  assert.equal(verdict.suggest, false);
  assert.equal(verdict.shared.length, 1);
});

// ---------------------------------------------------------------------------
// resolvedIdentityKeys — a tombstone is reached through, not deleted
// ---------------------------------------------------------------------------

test("resolvedIdentityKeys of a live person is just its own keys, sorted", () => {
  const keys = resolvedIdentityKeys({ identityKeys: ["name:raj", "email:r@x.io"] }, () => null);
  assert.deepEqual(keys, ["email:r@x.io", "name:raj"]);
});

test("resolvedIdentityKeys follows mergedIntoId and unions the chain", () => {
  // This is the property that makes merge cheap: the source keeps its own keys
  // and gains the target's, without anything being copied between rows.
  const rows: Record<string, { identityKeys: string[]; mergedIntoId?: string }> = {
    a: { identityKeys: ["name:raj"] },
    b: { identityKeys: ["name:raj patel", "email:r@x.io"] },
  };
  const keys = resolvedIdentityKeys({ ...rows.a, mergedIntoId: "b" }, (id) => rows[id] ?? null);
  assert.deepEqual(keys, ["email:r@x.io", "name:raj", "name:raj patel"]);
});

test("resolvedIdentityKeys resolves a multi-hop chain", () => {
  const rows: Record<string, { identityKeys: string[]; mergedIntoId?: string }> = {
    a: { identityKeys: ["name:a"], mergedIntoId: "b" },
    b: { identityKeys: ["name:b"], mergedIntoId: "c" },
    c: { identityKeys: ["name:c"] },
  };
  const keys = resolvedIdentityKeys(rows.a, (id) => rows[id] ?? null);
  assert.deepEqual(keys, ["name:a", "name:b", "name:c"]);
});

test("resolvedIdentityKeys survives a cycle instead of hanging", () => {
  // A hang is a far worse failure than a short key list, so the walk is
  // bounded and cycle-guarded on purpose.
  const rows: Record<string, { identityKeys: string[]; mergedIntoId?: string }> = {
    a: { identityKeys: ["name:a"], mergedIntoId: "b" },
    b: { identityKeys: ["name:b"], mergedIntoId: "a" },
  };
  const keys = resolvedIdentityKeys(rows.a, (id) => rows[id] ?? null);
  assert.deepEqual(keys, ["name:a", "name:b"]);
});

test("resolvedIdentityKeys tolerates a dangling target", () => {
  const keys = resolvedIdentityKeys({ identityKeys: ["name:a"], mergedIntoId: "gone" }, () => null);
  assert.deepEqual(keys, ["name:a"]);
});

test("resolvedIdentityKeys of nothing is nothing", () => {
  assert.deepEqual(resolvedIdentityKeys({}, () => null), []);
});

test("resolvedIdentityKeys is bounded by MAX_KEYS however long the chain", () => {
  const rows: Record<string, { identityKeys: string[]; mergedIntoId?: string }> = {};
  for (let i = 0; i < 40; i += 1) {
    rows[`p${i}`] = {
      identityKeys: [`name:p${i}`, `email:p${i}@x.io`],
      mergedIntoId: i < 39 ? `p${i + 1}` : undefined,
    };
  }
  const keys = resolvedIdentityKeys(rows.p0, (id) => rows[id] ?? null);
  assert.equal(keys.length, MAX_KEYS);
});

// ---------------------------------------------------------------------------
// describeKey — machine strings must never reach the screen raw
// ---------------------------------------------------------------------------

test("describeKey renders a name key as a readable label", () => {
  assert.equal(describeKey("name:raj patel"), "name “raj patel”");
  assert.equal(describeKey("email:raj@example.com"), "raj@example.com");
  assert.equal(describeKey("phone:+441234"), "phone:+441234");
});

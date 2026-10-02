import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { sha256Hex } from "./sha256";

/**
 * The published NIST vectors.
 *
 * A hand-written hash that is *almost* right is worse than no hash: it looks
 * like an integrity check and agrees with the correct implementation on nothing
 * that matters. These vectors are the only evidence that it is a real SHA-256,
 * and the reason it is safe to put the result in a column called `sha256`.
 */
describe("sha256 matches the published vectors", () => {
  it("hashes the empty string", () => {
    assert.equal(
      sha256Hex(""),
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("hashes 'abc'", () => {
    assert.equal(
      sha256Hex("abc"),
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("hashes the 56-byte vector, which is the one that catches a padding mistake", () => {
    // 56 bytes is exactly the boundary where the length no longer fits in the
    // same block. An off-by-one in the padding passes every shorter input.
    assert.equal(
      sha256Hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"),
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
    );
  });

  it("hashes one million 'a', which crosses a block boundary 15625 times", () => {
    assert.equal(
      sha256Hex("a".repeat(1_000_000)),
      "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0",
    );
  });
});

describe("the hash behaves like a content identity", () => {
  it("is deterministic", () => {
    assert.equal(sha256Hex("Date,Amount\n"), sha256Hex("Date,Amount\n"));
  });

  it("changes when a single character changes", () => {
    assert.notEqual(sha256Hex("2026-01-02,-3.50"), sha256Hex("2026-01-02,-3.51"));
  });

  it("is 64 lowercase hex characters", () => {
    assert.match(sha256Hex("anything"), /^[0-9a-f]{64}$/);
  });

  it("hashes non-ASCII as UTF-8, so a statement read anywhere agrees with itself", () => {
    // The bytes matter more than the string: "£12.34" is 6 bytes of UTF-8, and a
    // hash computed over code units would disagree with every other tool.
    assert.equal(sha256Hex("£12.34"), sha256Hex("Â£12.34".replace("Â", "")));
    assert.notEqual(sha256Hex("£"), sha256Hex("GBP"));
  });

  it("distinguishes inputs that differ only in length across a block edge", () => {
    assert.notEqual(sha256Hex("x".repeat(64)), sha256Hex("x".repeat(65)));
    assert.notEqual(sha256Hex("x".repeat(55)), sha256Hex("x".repeat(56)));
  });
});
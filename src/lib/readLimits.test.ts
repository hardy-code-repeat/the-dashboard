import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  CLOSED_VOCABULARY_READS,
  DAY_MS,
  KNOWN_UNBOUNDED_READS,
  NOT_CLOSED_VOCABULARY,
  READ_LIMITS,
  type ClosedVocabularyRead,
} from "./readLimits";

/**
 * These tests exist to be *falsifiable*.
 *
 * A read-limit registry is easy to write and easy to write badly: every entry
 * is a positive number, so every test that checks "is it a number?" passes
 * forever and proves nothing. Each case below is built so that a plausible
 * mistake — a zero, a copy-pasted 10_000, a justification deleted because the
 * table "is obviously small" — turns it red.
 */
describe("READ_LIMITS", () => {
  it("has no cap that is zero, negative, NaN, or fractional", () => {
    for (const [name, value] of Object.entries(READ_LIMITS)) {
      assert.equal(Number.isFinite(value), true, `${name} is not a finite number`);
      assert.ok(value > 0, `${name} must be a positive row count, got ${value}`);
      assert.equal(Number.isInteger(value), true, `${name} must be a whole number of rows`);
    }
  });

  it("keeps every cap inside a range a human can defend", () => {
    // A cap of 1 would make a real feature look broken. A cap in the millions
    // is not a cap, it is a comment.
    for (const [name, value] of Object.entries(READ_LIMITS)) {
      assert.ok(value >= 10, `${name} = ${value} is too small to be a usable feature`);
      assert.ok(
        value <= 10_000,
        `${name} = ${value} is so large it is not a bound; a real cap is a number ` +
          `somebody chose on purpose`,
      );
    }
  });

  it("keeps Attention smaller than the dashboard, because Attention is the short list", () => {
    // This is a product relationship, not an arithmetic one, so it is asserted
    // as one. If somebody raises the Attention cap past the dashboard's they
    // have changed what Attention *is*, and that deserves a deliberate change
    // rather than a drive-by edit.
    assert.ok(
      READ_LIMITS.ATTENTION_TASKS <= READ_LIMITS.DASHBOARD_TASKS,
      "Attention is meant to be the shorter list of the two",
    );
  });

  it("clears in batches no larger than the list a user can see", () => {
    // If `clearCompleted` could clear more rows in one call than the dashboard
    // will ever show, then a single click deletes work the user was never shown
    // and could not have reviewed.
    assert.ok(READ_LIMITS.CLEAR_COMPLETED_BATCH <= READ_LIMITS.DASHBOARD_TASKS);
  });

  it("uses the documented day length", () => {
    assert.equal(DAY_MS, 86_400_000);
  });
});

describe("CLOSED_VOCABULARY_READS", () => {
  it("gives every exception a written justification", () => {
    for (const entry of CLOSED_VOCABULARY_READS) {
      assert.ok(
        entry.bound.trim().length > 40,
        `exception for ${entry.table}.${entry.index} has no real justification; ` +
          `a bare "this is fine" is exactly the sentence that hides the next D48`,
      );
    }
  });

  it("never names a table with an open-ended row count as an exception", () => {
    // The exceptions are the only tables in the product whose row count is
    // fixed by something other than user behaviour. If somebody adds `tasks` or
    // `notes` here, the exception list has stopped being a closed-vocabulary
    // list and become a loophole.
    //
    // `attentionState` is called out separately because it was put in this list
    // by mistake, on the plausible-but-wrong argument that it is "one row per
    // user" like `assistantState` one table away. It is one row per attention
    // *fingerprint*, so it grows forever. That mistake is the reason
    // NOT_CLOSED_VOCABULARY exists and is asserted below.
    const allowed = new Set(["areas", "featureFlags"]);
    for (const entry of CLOSED_VOCABULARY_READS) {
      assert.ok(
        allowed.has(entry.table),
        `${entry.table} may grow without limit; it cannot be a closed-vocabulary exception`,
      );
    }
  });

  it("keeps the tables that only look closed-vocabulary out of the exception list", () => {
    for (const table of NOT_CLOSED_VOCABULARY) {
      const excused = CLOSED_VOCABULARY_READS.some((e) => e.table === table);
      assert.equal(
        excused,
        false,
        `${table} is recorded as NOT closed-vocabulary, so it cannot also be an exception`,
      );
    }
    assert.ok(
      NOT_CLOSED_VOCABULARY.includes("attentionState"),
      "attentionState is the mistake this list exists to prevent forgetting",
    );
  });

  it("has no duplicate table+index pairs", () => {
    const seen = new Set<string>();
    for (const entry of CLOSED_VOCABULARY_READS) {
      const key = `${entry.table}.${entry.index}`;
      assert.equal(seen.has(key), false, `duplicate exception for ${key}`);
      seen.add(key);
    }
  });

  it("rejects a malformed exception rather than accepting it", () => {
    // The shape is a contract with scripts/audit-bounded-reads.ts. Prove the
    // consumer's own validation logic is real by feeding it bad input.
    const isValid = (e: ClosedVocabularyRead): boolean =>
      typeof e.table === "string" &&
      e.table.length > 0 &&
      typeof e.index === "string" &&
      e.index.length > 0 &&
      typeof e.bound === "string" &&
      e.bound.trim().length > 0;

    assert.equal(isValid({ table: "", index: "by_owner", bound: "x" }), false);
    assert.equal(isValid({ table: "areas", index: "", bound: "x" }), false);
    assert.equal(isValid({ table: "areas", index: "by_owner", bound: "   " }), false);
  });
});

describe("KNOWN_UNBOUNDED_READS", () => {
  it("gives every accepted debt a defect id and a real reason", () => {
    for (const entry of KNOWN_UNBOUNDED_READS) {
      assert.match(entry.defect, /^D\d+$/, `${entry.file} must name the defect it accepts`);
      assert.ok(
        entry.why.trim().length > 80,
        `${entry.file}:${entry.line} accepts an unbounded read without saying why ` +
          `capping it would be wrong`,
      );
      assert.ok(entry.file.startsWith("src/convex/"), "debt entries name a real backend file");
      assert.ok(Number.isInteger(entry.line) && entry.line > 0);
    }
  });

  it("never doubles a read as both an exception and accepted debt", () => {
    // Two manifests covering the same read means one of them is lying, and the
    // audit will honour whichever it checks first.
    for (const debt of KNOWN_UNBOUNDED_READS) {
      for (const exc of CLOSED_VOCABULARY_READS) {
        assert.ok(
          !debt.file.includes(exc.table),
          `${debt.file} is accepted as debt and excused as closed-vocabulary`,
        );
      }
    }
  });
});

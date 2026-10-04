import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  MAX_PAGE_NAME,
  PAGE_AREA_SLUGS,
  PAGE_BLOCK_KINDS,
  isPageAreaSlug,
  isPageBlockKind,
  requirePageArea,
  requirePageBlocks,
  requirePageName,
} from "./customPages";
import { PAGE_MAX_BLOCKS } from "./readLimits";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCHEMA = readFileSync(join(HERE, "..", "convex", "schema.ts"), "utf8");

/**
 * These tests exist to be *falsifiable*.
 *
 * A closed vocabulary is the single mechanism keeping Custom Pages away from
 * EAV (ADR-007, RJD-001). Every test below is written so that the plausible
 * mistake — one more kind "just for this", a cap quietly raised, a duplicate
 * silently collapsed, the schema drifting from the lib — turns it red. A test
 * that would still pass after the feature was widened proves nothing.
 */
describe("Custom Pages vocabulary", () => {
  it("is the exact set the schema validator declares", () => {
    // The single most important assertion in this file. If the lib and the
    // schema disagree, then one of the two is lying about what the database
    // will accept, and writes fail at runtime in a way no type check catches.
    const start = SCHEMA.indexOf("export const pageBlockKindValidator");
    const end = SCHEMA.indexOf(");", start);
    assert.ok(start > 0 && end > start, "pageBlockKindValidator is missing");
    const literals = [...SCHEMA.slice(start, end).matchAll(/v\.literal\("([^"]+)"\)/g)].map(
      (m) => m[1],
    );
    assert.deepEqual(
      [...literals].sort(),
      [...PAGE_BLOCK_KINDS].sort(),
      "the schema block vocabulary and src/lib/customPages.ts disagree",
    );
  });

  it("has no kind outside the vocabulary", () => {
    // The EAV test. A "custom" kind, or any name not in the union, would let a
    // page name something Panel cannot render — and would be the first step
    // toward user-defined fields.
    assert.equal(isPageBlockKind("custom"), false);
    assert.equal(isPageBlockKind("weather"), false);
    assert.equal(isPageBlockKind(""), false);
    assert.equal(isPageBlockKind(undefined), false);
    assert.equal(isPageBlockKind({ kind: "people" }), false);
  });

  it("keeps every kind resolvable to an existing product surface", () => {
    // If a kind is added with no renderer, the block renders as nothing and
    // the page looks broken in a way that is easy to miss. Each kind below is
    // documented against the query that serves it.
    const served: Record<string, string> = {
      headline: "assistant:getDashboard",
      taskList: "assistant:getDashboard",
      note: "assistant:getDashboard",
      people: "people:listPeople",
      money: "transactions:listBalances",
      commitments: "commitments:listCommitments",
      documents: "documents:listDocuments",
      expenses: "transactions:listTransactions",
    };
    assert.deepEqual(
      [...PAGE_BLOCK_KINDS].sort(),
      Object.keys(served).sort(),
      "a block kind exists with no existing query to render it",
    );
  });

  it("cannot be widened without changing the page count", () => {
    // Guards the cap itself. Raising PAGE_MAX_BLOCKS is a decision (Q-010's
    // basis), not an incidental edit, so it must move the number and not slip
    // past it.
    assert.equal(PAGE_MAX_BLOCKS, 12);
    assert.ok(PAGE_MAX_BLOCKS < PAGE_BLOCK_KINDS.length * 4);
  });
});

describe("requirePageBlocks", () => {
  it("accepts a valid arrangement and preserves its order", () => {
    const blocks = requirePageBlocks([
      { kind: "money" },
      { kind: "headline" },
    ]);
    assert.deepEqual(blocks, [{ kind: "money" }, { kind: "headline" }]);
  });

  it("refuses an empty page, which would render nothing", () => {
    assert.throws(() => requirePageBlocks([]), /at least one block/);
  });

  it("refuses more than the cap", () => {
    // Built from the real vocabulary and cycled, so this stays honest if the
    // vocabulary grows. It would otherwise need 13 hand-written kinds.
    const tooMany = Array.from({ length: PAGE_MAX_BLOCKS + 1 }, (_, i) => ({
      kind: PAGE_BLOCK_KINDS[i % PAGE_BLOCK_KINDS.length],
    }));
    assert.throws(() => requirePageBlocks(tooMany), /at most/);
  });

  it("accepts every kind at once, which is the reachable maximum", () => {
    // The other half of the cap tests. Every distinct kind is the most blocks a
    // page can actually hold today.
    const all = PAGE_BLOCK_KINDS.map((kind) => ({ kind }));
    assert.equal(requirePageBlocks(all).length, PAGE_BLOCK_KINDS.length);
  });

  it("records that the block cap sits above the vocabulary, so the length guard is defence in depth", () => {
    // Not a behaviour claim — a claim about an honest fact in the design, which
    // is D78's whole point.
    //
    // A page cannot hold 12 blocks today: duplicates are refused and there are
    // only 8 kinds, so `PAGE_MAX_BLOCKS = 12` is **unreachable** with the
    // current vocabulary. The length check therefore cannot fire on any input
    // the product accepts — it is a guard that only starts meaning something
    // the day a 13th kind exists.
    //
    // It is kept deliberately, and this assertion exists so that the situation
    // is *tracked* rather than forgotten: if somebody widens the vocabulary
    // past 12, this test is what makes them meet the cap, and a stale comment
    // claiming "you can have twelve" becomes visibly false instead of quietly
    // misleading (D60).
    assert.ok(
      PAGE_BLOCK_KINDS.length <= PAGE_MAX_BLOCKS,
      "the vocabulary now reaches PAGE_MAX_BLOCKS — the cap is load-bearing " +
        "and D78 must be revisited rather than left as an unreachable guard",
    );
  });

  it("refuses an unknown kind by name", () => {
    // The message matters: a validation layer that says "invalid" makes the
    // user guess, and guessing at a closed vocabulary is how it gets widened.
    assert.throws(
      () => requirePageBlocks([{ kind: "horoscope" }]),
      /"horoscope" is not a block Panel can show/,
    );
  });

  it("refuses a duplicate rather than silently collapsing it", () => {
    assert.throws(
      () => requirePageBlocks([{ kind: "money" }, { kind: "money" }]),
      /already on this page/,
    );
  });

  it("strips anything that is not a kind", () => {
    // Sanitising, not merely validating: the value returned is the value that
    // gets written, so a stray property cannot ride along into the row.
    const [block] = requirePageBlocks([
      { kind: "note", evil: "payload", props: { anything: 1 } } as never,
    ]);
    assert.deepEqual(Object.keys(block), ["kind"]);
  });
});

describe("page name and area", () => {
  it("trims a name and refuses an empty one", () => {
    assert.equal(requirePageName("  Monday  "), "Monday");
    assert.throws(() => requirePageName("   "), /needs a name/);
    assert.throws(() => requirePageName(""), /needs a name/);
  });

  it("refuses a name longer than the heading it is", () => {
    assert.throws(() => requirePageName("x".repeat(MAX_PAGE_NAME + 1)), /at most/);
    assert.equal(requirePageName("x".repeat(MAX_PAGE_NAME)).length, MAX_PAGE_NAME);
  });

  it("accepts only the existing closed area union", () => {
    // A Custom Page is not a seventh area. If a page could carry a new slug,
    // `areaSlugValidator` would have been widened and D66 would be live.
    for (const slug of PAGE_AREA_SLUGS) assert.equal(isPageAreaSlug(slug), true);
    assert.equal(isPageAreaSlug("custom"), false);
    assert.throws(() => requirePageArea("custom"), /not an area/);
    assert.equal(requirePageArea("health"), "health");
  });
});
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  PAGE_AREA_SLUGS,
  PAGE_BLOCK_KINDS,
  isPageAreaSlug,
  isPageBlockKind,
} from "./customPages";
import {
  PAGE_TEMPLATES,
  PAGE_TEMPLATE_IDS,
  applyPageTemplate,
  getPageTemplate,
  isPageTemplateId,
} from "./pageTemplates";
import { PAGE_MAX_BLOCKS } from "./readLimits";

const HERE = dirname(fileURLToPath(import.meta.url));
const SELF = readFileSync(join(HERE, "pageTemplates.ts"), "utf8");

/**
 * These tests exist to be falsifiable, like the Custom Pages ones they guard.
 *
 * A template catalogue is the easiest kind of code to grow carelessly: one more
 * entry with one more block kind, one more area, and a user gets a starting
 * point that the server will reject. So the plausible mistake — a template that
 * drifts out of the vocabulary, a fallback that fires on an unknown id, a
 * catalogue that quietly starts fetching — has to turn this file red.
 */
describe("the template catalogue is valid against the real validators", () => {
  it("holds at least one template, and every one applies without throwing", () => {
    // The tripwire. If the vocabulary moves under a template, this is what says
    // so — at test time, naming the offending kind, instead of a user
    // discovering it when the form silently fails to save.
    assert.ok(PAGE_TEMPLATES.length > 0, "the catalogue is empty");
    for (const id of PAGE_TEMPLATE_IDS) {
      const applied = applyPageTemplate(id);
      assert.ok(applied.blocks.length > 0, `${id} produced an empty page`);
      assert.ok(applied.name.length > 0, `${id} produced an unnamed page`);
    }
  });

  it("names no block kind outside the vocabulary", () => {
    // The EAV check at the catalogue level, and the reason a template cannot
    // become the front door to a user-defined field: every token the catalogue
    // puts in a `blocks: [...]` must already be one Panel renders.
    //
    // Scoped to the block arrays on purpose. A first draft scanned every quoted
    // word in the entry and failed on "Money" and "Paperwork" — the *display
    // names*. That was the test being wrong rather than the catalogue, and the
    // fix was to narrow it, not to rename the templates to something the regex
    // liked.
    const catalogue = SELF.slice(
      SELF.indexOf("const CATALOGUE = ["),
      SELF.indexOf("] as const", SELF.indexOf("const CATALOGUE = [")),
    );
    const unknown: string[] = [];
    for (const array of catalogue.matchAll(/blocks:\s*\[([^\]]*)\]/g)) {
      for (const m of array[1].matchAll(/"([^"]+)"/g)) {
        if (!isPageBlockKind(m[1])) unknown.push(m[1]);
      }
    }
    assert.deepEqual(
      unknown,
      [],
      `a template names a block Panel cannot render: ${unknown.join(", ")}`,
    );
  });

  it("declares every catalogue block against the real vocabulary", () => {
    // The "leans on the existing union rather than restating it" claim, checked
    // against `PAGE_BLOCK_KINDS` itself rather than by grepping this module's
    // source for a name. A first version asserted `SELF.includes(
    // "isPageBlockKind")`, which was really only asserting that a dead import
    // was still there — a check that would have failed if the import were
    // cleaned up, and proved nothing about the catalogue.
    const used = new Set(PAGE_TEMPLATES.flatMap((t) => [...t.blocks]));
    assert.ok(used.size > 0, "no template names a block at all");
    for (const kind of used) {
      assert.ok(
        isPageBlockKind(kind),
        `"${kind}" is not one of the ${PAGE_BLOCK_KINDS.length} blocks Panel renders`,
      );
    }
  });

  it("uses only existing areas, so a template is not a seventh area", () => {
    for (const t of PAGE_TEMPLATES) {
      assert.ok(
        (PAGE_AREA_SLUGS as readonly string[]).includes(t.area),
        `${t.id} is filed under "${t.area}", which is not an area`,
      );
      assert.equal(isPageAreaSlug("custom"), false, "D66 stays unreachable");
    }
  });

  it("keeps every template inside the caps it does not own", () => {
    for (const t of PAGE_TEMPLATES) {
      assert.ok(t.blocks.length <= PAGE_MAX_BLOCKS, `${t.id} is over the block cap`);
      assert.ok(t.name.length <= 60, `${t.id} has a name too long to be a heading`);
    }
    // Duplicates inside a template would be refused by requirePageBlocks, so
    // this cannot pass accidentally for a template that has one.
    for (const t of PAGE_TEMPLATES) {
      assert.equal(
        new Set(t.blocks).size,
        t.blocks.length,
        `${t.id} repeats a block kind`,
      );
    }
  });

  it("has unique ids", () => {
    assert.equal(new Set(PAGE_TEMPLATE_IDS).size, PAGE_TEMPLATE_IDS.length);
  });

  it("ships more than one template, because one is not a starting point", () => {
    // A catalogue of one is a default value with extra steps.
    assert.ok(PAGE_TEMPLATE_IDS.length >= 2);
  });
});

describe("template ids are closed", () => {
  it("refuses anything that is not one Panel ships", () => {
    // Including a near miss. A whitespace-tolerant lookup would be the first
    // step toward a user-facing free-text template name.
    assert.equal(isPageTemplateId("morning"), true);
    assert.equal(isPageTemplateId("morning "), false);
    assert.equal(isPageTemplateId(" Morning"), false);
    assert.equal(isPageTemplateId("custom"), false);
    assert.equal(isPageTemplateId(""), false);
    assert.equal(isPageTemplateId(undefined), false);
    assert.equal(isPageTemplateId({ id: "morning" }), false);
    assert.equal(isPageTemplateId(PAGE_TEMPLATES), false);
  });

  it("returns nothing for an unknown id rather than a default template", () => {
    // The fail-open test. A fallback would create a real page under a name
    // nobody chose, which is the failure where a system looks like it worked.
    assert.equal(getPageTemplate("morning")?.id, "morning");
    assert.equal(getPageTemplate("nope"), undefined);
    assert.equal(getPageTemplate(undefined), undefined);
    assert.throws(() => applyPageTemplate("nope" as never), /not a page template/);
  });
});

describe("applying a template cannot smuggle anything past the form", () => {
  it("returns exactly the three values the form already holds", () => {
    // Not a template object, not an id, not a partial: the shape `createPage`
    // is given, so there is no path by which a template adds an argument.
    const applied = applyPageTemplate("morning");
    assert.deepEqual(Object.keys(applied).sort(), ["area", "blocks", "name"]);
  });

  it("hands back plain block kinds, so nothing extra reaches the mutation", () => {
    for (const id of PAGE_TEMPLATE_IDS) {
      for (const block of applyPageTemplate(id).blocks) {
        assert.equal(typeof block, "string");
      }
    }
  });

  it("routes through the same validators a hand-built page uses", () => {
    // Proven structurally: the module calls requirePageName/requirePageArea/
    // requirePageBlocks and nothing else that could accept a value.
    assert.equal(/requirePageName\(template\.name\)/.test(SELF), true);
    assert.equal(/requirePageArea\(template\.area\)/.test(SELF), true);
    assert.equal(/requirePageBlocks\(/.test(SELF), true);
  });
});

describe("templates add no read and no second persistence", () => {
  it("imports nothing from Convex and fetches nothing", () => {
    // A template that fetched would be a read surface for a constant, which is
    // exactly the unbounded-read problem ADR-033 was written to avoid.
    assert.equal(/from "convex/.test(SELF), false, "the catalogue imports Convex");
    assert.equal(/useQuery\(/.test(SELF), false, "the catalogue runs a query");
    assert.equal(/\bfetch\(/.test(SELF), false, "the catalogue fetches");
    assert.equal(/\bapi\./.test(SELF), false, "the catalogue names a query");
  });

  it("stores nothing", () => {
    assert.equal(/defineTable\(/.test(SELF), false, "a template became a table");
    assert.equal(/ctx\.db\.(insert|patch|delete)/.test(SELF), false);
    assert.equal(/mutation\(|query\(/.test(SELF), false, "a template became a function");
  });

  it("references the closed vocabularies rather than restating them", () => {
    // Restating `"headline" | "taskList" | …` here would create a second place
    // for the vocabulary to live, and the two would drift.
    assert.equal(/v\.union\(/.test(SELF), false, "the catalogue redeclares a validator");
    assert.equal(
      /from "\.\/customPages"/.test(SELF),
      true,
      "the catalogue should lean on the existing validators, not reimplement them",
    );
  });
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { AREAS_WITHOUT_A_DOMAIN_MODEL, AREA_VERBS, VERBS, allTargets, targetsForArea, verbsForArea } from "./areaActions";

describe("every verb is bound to exactly one mutation", () => {
  it("no verb is offered without a target", () => {
    for (const verb of Object.values(VERBS)) {
      assert.match(verb.target, /^[a-z]+:[a-zA-Z]+$/, `${verb.id} has a malformed target`);
    }
  });

  it("no two verbs share a target, because that is a duplicate concept", () => {
    const targets = Object.values(VERBS).map((v) => v.target);
    assert.equal(new Set(targets).size, targets.length);
  });

  it("every verb says what it creates, in a hint a person can read", () => {
    for (const verb of Object.values(VERBS)) {
      assert.ok(verb.label.length > 0, `${verb.id} has no label`);
      assert.ok(verb.hint.length > 12, `${verb.id} has no usable hint`);
    }
  });
});

describe("an area offers its own domain, not the same list as everywhere else", () => {
  it("Finance leads with money, not with tasks", () => {
    const ids = AREA_VERBS.finance;
    assert.equal(ids[0], "transaction", "the first Finance verb is the one the area is for");
    assert.ok(ids.includes("account") && ids.includes("subscription") && ids.includes("expense"));
  });

  it("a task is never the first thing an area offers", () => {
    for (const [area, ids] of Object.entries(AREA_VERBS)) {
      assert.notEqual(ids[0], "task", `${area} opens with a task, which is the defect being fixed`);
    }
  });

  it("capture leads in General and trails everywhere else", () => {
    assert.equal(AREA_VERBS.general[0], "capture", "General is the universal capture surface");
    for (const [area, ids] of Object.entries(AREA_VERBS)) {
      if (area === "general") continue;
      assert.ok(ids.includes("capture"), `${area} removed universal capture`);
      if (!AREAS_WITHOUT_A_DOMAIN_MODEL.includes(area)) {
        assert.equal(ids[ids.length - 1], "capture", `${area} buries capture`);
      }
    }
  });

  it("only an area with no domain model may share another area's list", () => {
    const seen = new Map<string, string>();
    for (const [area, ids] of Object.entries(AREA_VERBS)) {
      const key = ids.join(",");
      const owner = seen.get(key);
      if (owner !== undefined) {
        assert.ok(
          AREAS_WITHOUT_A_DOMAIN_MODEL.includes(area) && AREAS_WITHOUT_A_DOMAIN_MODEL.includes(owner),
          `${area} is identical to ${owner}, and only an area with no domain model may be`,
        );
      }
      seen.set(key, area);
    }
  });

  it("the areas with no domain model say so by offering only what is true", () => {
    // Health is a mock (D50) and Home has no domain body. Neither may grow a
    // verb that implies an object kind it does not have.
    for (const area of AREAS_WITHOUT_A_DOMAIN_MODEL) {
      assert.deepEqual(AREA_VERBS[area], ["capture", "task"], `${area} claims a capability it lacks`);
    }
    assert.deepEqual(AREAS_WITHOUT_A_DOMAIN_MODEL, ["health", "home"]);
  });

  it("Relationships offers people and promises; Life Admin offers documents", () => {
    assert.ok(AREA_VERBS.relationships.includes("person"));
    assert.ok(AREA_VERBS.relationships.includes("commitment"));
    assert.equal(AREA_VERBS.life[0], "document");
  });
});

describe("an unknown area falls back rather than inventing a menu", () => {
  it("returns nothing rather than a guess", () => {
    assert.deepEqual(verbsForArea("not-an-area"), []);
    assert.deepEqual(targetsForArea("not-an-area"), []);
  });

  it("a verb id that no longer exists cannot be listed", () => {
    // The type system forbids this, so the check is that the lookup is total and
    // silent: a stale id yields no verb rather than a broken one.
    const bogus = "nope" as unknown as keyof typeof VERBS;
    assert.equal(VERBS[bogus], undefined);
  });
});

describe("the repository-wide target list", () => {
  it("is deduplicated and covers every area", () => {
    const all = allTargets();
    assert.equal(new Set(all).size, all.length);
    assert.ok(all.length >= Object.keys(VERBS).length);
  });

  it("names the finance and people writers that already exist", () => {
    const all = allTargets();
    for (const expected of [
      "transactions:createTransaction",
      "subscriptions:createAccount",
      "subscriptions:createSubscription",
      "life:addExpense",
      "documents:createDocument",
      "people:createPerson",
      "commitments:createCommitment",
      "assistant:addTask",
      "assistant:capture",
    ]) {
      assert.ok(all.includes(expected), `missing ${expected}`);
    }
  });
});

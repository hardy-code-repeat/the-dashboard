import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  ACCESS_LEVELS,
  can,
  canRead,
  defaultVisibility,
  EXPLICIT_ID_ONLY_KINDS,
  effectiveVisibility,
  grantCovers,
  grantIsLive,
  levelRank,
  levelsMeet,
  maxLevel,
  NEVER_SHARED_KINDS,
  resolveAccess,
  scopeAllows,
  scopeForViewer,
  type AccessLevel,
  type AccessTarget,
  type Grant,
  type Viewer,
} from "./permissions";

const NOW = 1_700_000_000_000;
const DAY = 86_400_000;

const alice = "user_alice";
const bob = "user_bob";
const accountant = "user_accountant";
const personalSpace = "space_alice_home";
const workSpace = "space_acme";

function target(over: Partial<AccessTarget> = {}): AccessTarget {
  return {
    spaceId: personalSpace,
    ownerUserId: alice,
    kind: "task",
    id: "task_1",
    ...over,
  };
}

function viewer(over: Partial<Viewer> = {}): Viewer {
  return { userId: bob, memberships: [], grants: [], ...over };
}

function grant(over: Partial<Grant> = {}): Grant {
  return {
    spaceId: personalSpace,
    granteeUserId: bob,
    level: "view",
    scopeKinds: ["task"],
    grantedBy: alice,
    grantedAt: NOW - DAY,
    ...over,
  };
}

function member(role: AccessLevel, spaceId = personalSpace): Viewer {
  return viewer({ memberships: [{ spaceId, role }] });
}

// ---------------------------------------------------------------------------
// level algebra
// ---------------------------------------------------------------------------

test("levelRank orders the four levels weakest to strongest", () => {
  const ranks = ACCESS_LEVELS.map(levelRank);
  assert.deepEqual(ranks, [0, 1, 2, 3]);
  for (let i = 1; i < ranks.length; i += 1) {
    assert.ok(ranks[i] > ranks[i - 1], `${ACCESS_LEVELS[i]} must outrank ${ACCESS_LEVELS[i - 1]}`);
  }
});

test("levelsMeet is inclusive of the required level", () => {
  assert.equal(levelsMeet("view", "view"), true);
  assert.equal(levelsMeet("edit", "view"), true);
  assert.equal(levelsMeet("view", "edit"), false);
  assert.equal(levelsMeet(null, "view"), false, "no access never meets any requirement");
});

test("maxLevel returns null only when both sides are absent", () => {
  assert.equal(maxLevel(null, null), null);
  assert.equal(maxLevel("view", null), "view");
  assert.equal(maxLevel(null, "manage"), "manage");
  assert.equal(maxLevel("view", "edit"), "edit");
  assert.equal(maxLevel("edit", "view"), "edit");
  assert.equal(maxLevel("edit", "edit"), "edit");
});

// ---------------------------------------------------------------------------
// resolveAccess — table driven
// ---------------------------------------------------------------------------

interface Case {
  name: string;
  viewer: Viewer;
  target: AccessTarget;
  required: AccessLevel;
  allowed: boolean;
  level: AccessLevel | null;
  reason: string;
}

const resolveCases: Case[] = [
  // --- owner -------------------------------------------------------------
  {
    name: "the owner always reaches their own object, at manage",
    viewer: viewer({ userId: alice, memberships: [], grants: [] }),
    target: target(),
    required: "manage",
    allowed: true,
    level: "manage",
    reason: "allow_owner",
  },
  {
    name: "ownership beats a missing membership",
    viewer: viewer({ userId: alice }),
    target: target({ spaceId: "space_they_do_not_belong_to" }),
    required: "view",
    allowed: true,
    level: "manage",
    reason: "allow_owner",
  },

  // --- owner-only tiers (§4.3) ------------------------------------------
  ...NEVER_SHARED_KINDS.map<Case>((kind) => ({
    name: `${kind} is owner-only even to a space manager`,
    viewer: member("manage"),
    target: target({ kind }),
    required: "view",
    allowed: false,
    level: null,
    reason: "deny_owner_only",
  })),
  ...NEVER_SHARED_KINDS.map<Case>((kind) => ({
    name: `${kind} is owner-only even to a full-space grant`,
    viewer: viewer({ grants: [grant({ level: "manage", scopeKinds: [kind] })] }),
    target: target({ kind }),
    required: "view",
    allowed: false,
    level: null,
    reason: "deny_owner_only",
  })),

  // --- membership --------------------------------------------------------
  {
    name: "a space member reads a space-visible task",
    viewer: member("view"),
    target: target(),
    required: "view",
    allowed: true,
    level: "view",
    reason: "allow_membership",
  },
  {
    name: "a view member cannot edit",
    viewer: member("view"),
    target: target(),
    required: "edit",
    allowed: false,
    level: "view",
    reason: "deny_level",
  },
  {
    name: "an edit member can edit",
    viewer: member("edit"),
    target: target(),
    required: "edit",
    allowed: true,
    level: "edit",
    reason: "allow_membership",
  },
  {
    name: "membership of another space does not reach this object",
    viewer: member("manage", workSpace),
    target: target(),
    required: "view",
    allowed: false,
    level: null,
    reason: "deny_no_membership",
  },
  {
    name: "a private object is owner-only however senior the member",
    viewer: member("manage"),
    target: target({ visibility: "private" }),
    required: "view",
    allowed: false,
    level: null,
    reason: "deny_private",
  },
  {
    name: "a note defaults to private and a member cannot read it",
    viewer: member("manage"),
    target: target({ kind: "note" }),
    required: "view",
    allowed: false,
    level: null,
    reason: "deny_private",
  },
  {
    name: "an expense defaults to private and a member cannot read it",
    viewer: member("manage"),
    target: target({ kind: "expense" }),
    required: "view",
    allowed: false,
    level: null,
    reason: "deny_private",
  },
  {
    name: "the owner may widen an expense to space visibility",
    viewer: member("view"),
    target: target({ kind: "expense", visibility: "space" }),
    required: "view",
    allowed: true,
    level: "view",
    reason: "allow_membership",
  },
  {
    name: "a taxProfile defaults to private",
    viewer: member("manage"),
    target: target({ kind: "taxProfile" }),
    required: "view",
    allowed: false,
    level: null,
    reason: "deny_private",
  },
  {
    name: "a private calendarEvent defaults to private",
    viewer: member("manage"),
    target: target({ kind: "calendarEvent" }),
    required: "view",
    allowed: false,
    level: null,
    reason: "deny_private",
  },
  {
    name: "a person defaults to space-visible",
    viewer: member("view"),
    target: target({ kind: "person" }),
    required: "view",
    allowed: true,
    level: "view",
    reason: "allow_membership",
  },

  // --- grants: the happy path -------------------------------------------
  {
    name: "a scoped grant reaches an object it covers",
    viewer: viewer({ grants: [grant({ level: "edit" })] }),
    target: target(),
    required: "edit",
    allowed: true,
    level: "edit",
    reason: "allow_grant",
  },
  {
    name: "a grant reaches a private object that a member cannot",
    viewer: viewer({ grants: [grant({ level: "view", scopeKinds: ["expense"] })] }),
    target: target({ kind: "expense", visibility: "private" }),
    required: "view",
    allowed: true,
    level: "view",
    reason: "allow_grant",
  },

  // --- grants fail closed ------------------------------------------------
  {
    name: "a grant with no scopeKinds covers nothing (fail closed)",
    viewer: viewer({ grants: [grant({ level: "manage", scopeKinds: undefined })] }),
    target: target(),
    required: "view",
    allowed: false,
    level: null,
    reason: "deny_no_scope",
  },
  {
    name: "a grant with an empty scopeKinds covers nothing (fail closed)",
    viewer: viewer({ grants: [grant({ level: "manage", scopeKinds: [] })] }),
    target: target(),
    required: "view",
    allowed: false,
    level: null,
    reason: "deny_no_scope",
  },
  {
    name: "a grant whose kinds exclude the object covers nothing",
    viewer: viewer({ grants: [grant({ level: "manage", scopeKinds: ["expense"] })] }),
    target: target({ kind: "task" }),
    required: "view",
    allowed: false,
    level: null,
    reason: "deny_no_scope",
  },
  {
    name: "a grant bounded to one area does not leak into another area",
    viewer: viewer({
      grants: [grant({ level: "manage", scopeKinds: ["expense"], scopeAreas: ["finance"] })],
    }),
    target: target({ kind: "expense", area: "health" }),
    required: "view",
    allowed: false,
    level: null,
    reason: "deny_no_scope",
  },
  {
    name: "a grant bounded to one area does reach that area",
    viewer: viewer({
      grants: [grant({ level: "edit", scopeKinds: ["expense"], scopeAreas: ["finance"] })],
    }),
    target: target({ kind: "expense", area: "finance" }),
    required: "edit",
    allowed: true,
    level: "edit",
    reason: "allow_grant",
  },
  {
    name: "an area-scoped grant does not reach an object with no area",
    viewer: viewer({
      grants: [grant({ level: "manage", scopeKinds: ["expense"], scopeAreas: ["finance"] })],
    }),
    target: target({ kind: "expense", area: null }),
    required: "view",
    allowed: false,
    level: null,
    reason: "deny_no_scope",
  },
  {
    name: "an object-id-scoped grant reaches only the named object",
    viewer: viewer({
      grants: [grant({ level: "manage", scopeKinds: ["expense"], scopeObjectIds: ["task_1"] })],
    }),
    target: target({ kind: "expense", id: "task_2" }),
    required: "view",
    allowed: false,
    level: null,
    reason: "deny_no_scope",
  },

  // --- explicit-id-only kinds (§4.3) ------------------------------------
  ...EXPLICIT_ID_ONLY_KINDS.map<Case>((kind) => ({
    name: `${kind} needs an explicit objectIds grant, not just a kinds grant`,
    viewer: viewer({ grants: [grant({ level: "manage", scopeKinds: [kind] })] }),
    target: target({ kind, id: "obj_1" }),
    required: "view",
    allowed: false,
    level: null,
    reason: "deny_no_scope",
  })),
  ...EXPLICIT_ID_ONLY_KINDS.map<Case>((kind) => ({
    name: `${kind} is reachable once the grant names the object`,
    viewer: viewer({
      grants: [grant({ level: "view", scopeKinds: [kind], scopeObjectIds: ["obj_1"] })],
    }),
    target: target({ kind, id: "obj_1" }),
    required: "view",
    allowed: true,
    level: "view",
    reason: "allow_grant",
  })),

  // --- expiry and revocation --------------------------------------------
  {
    name: "an expired grant reaches nothing, and reads as if it never existed",
    viewer: viewer({ grants: [grant({ level: "manage", expiresAt: NOW - 1 })] }),
    target: target(),
    required: "view",
    allowed: false,
    level: null,
    reason: "deny_no_membership",
  },
  {
    name: "a grant that expires in the future is still live",
    viewer: viewer({ grants: [grant({ level: "manage", expiresAt: NOW + DAY })] }),
    target: target(),
    required: "view",
    allowed: true,
    level: "manage",
    reason: "allow_grant",
  },
  {
    name: "a revoked grant reaches nothing even before it expires",
    viewer: viewer({
      grants: [grant({ level: "manage", expiresAt: NOW + DAY, revokedAt: NOW - 1 })],
    }),
    target: target(),
    required: "view",
    allowed: false,
    level: null,
    reason: "deny_no_membership",
  },
  {
    name: "expiry is evaluated against the injected clock, not Date.now",
    viewer: viewer({ grants: [grant({ level: "manage", expiresAt: NOW + 1 })] }),
    target: target(),
    required: "view",
    allowed: true,
    level: "manage",
    reason: "allow_grant",
  },

  // --- cross-tenant isolation -------------------------------------------
  {
    name: "a grant for another space does not reach this one",
    viewer: viewer({ grants: [grant({ spaceId: workSpace, level: "manage" })] }),
    target: target(),
    required: "view",
    allowed: false,
    level: null,
    reason: "deny_no_membership",
  },
  {
    name: "a stranger with no membership and no grant is denied",
    viewer: viewer({ userId: "user_stranger" }),
    target: target(),
    required: "view",
    allowed: false,
    level: null,
    reason: "deny_no_membership",
  },
  {
    name: "a stronger membership is not weakened by a weaker grant",
    viewer: viewer({
      memberships: [{ spaceId: personalSpace, role: "manage" }],
      grants: [grant({ level: "view" })],
    }),
    target: target(),
    required: "manage",
    allowed: true,
    level: "manage",
    reason: "allow_membership",
  },
  {
    name: "the strongest of several live grants wins",
    viewer: viewer({
      grants: [
        grant({ level: "view" }),
        grant({ level: "edit" }),
        grant({ level: "comment", expiresAt: NOW - 1 }),
      ],
    }),
    target: target(),
    required: "edit",
    allowed: true,
    level: "edit",
    reason: "allow_grant",
  },
];

test("resolveAccess — table", () => {
  for (const c of resolveCases) {
    const decision = can(c.viewer, c.target, c.required, NOW);
    assert.equal(decision.allowed, c.allowed, `${c.name} :: allowed`);
    assert.equal(decision.level, c.level, `${c.name} :: level`);
    assert.equal(decision.reason, c.reason, `${c.name} :: reason`);
  }
});

test("resolveAccess and can() agree whenever the requirement is 'view'", () => {
  for (const c of resolveCases) {
    if (c.required !== "view") continue;
    const exact = resolveAccess(c.viewer, c.target, NOW);
    assert.deepEqual(exact, can(c.viewer, c.target, "view", NOW), c.name);
  }
});

test("can() narrows resolveAccess by the required level", () => {
  const v = member("comment");
  assert.equal(can(v, target(), "view", NOW).allowed, true);
  assert.equal(can(v, target(), "comment", NOW).allowed, true);
  assert.equal(can(v, target(), "edit", NOW).allowed, false);
  assert.equal(can(v, target(), "edit", NOW).reason, "deny_level");
});

test("canRead is exactly can(.., 'view')", () => {
  for (const c of resolveCases) {
    assert.equal(
      canRead(c.viewer, c.target, NOW),
      can(c.viewer, c.target, "view", NOW).allowed,
      c.name,
    );
  }
});

test("every denial carries a non-null stable reason", () => {
  for (const c of resolveCases) {
    if (c.allowed) continue;
    assert.ok(c.reason.startsWith("deny_"), `${c.name} must use a deny_* code`);
  }
});

// ---------------------------------------------------------------------------
// grant helpers in isolation
// ---------------------------------------------------------------------------

test("grantIsLive covers revocation, expiry and the open-ended grant", () => {
  assert.equal(grantIsLive(grant(), NOW), true);
  assert.equal(grantIsLive(grant({ revokedAt: NOW }), NOW), false);
  assert.equal(grantIsLive(grant({ expiresAt: NOW }), NOW), false, "expiry is exclusive");
  assert.equal(grantIsLive(grant({ expiresAt: NOW + 1 }), NOW), true);
  assert.equal(grantIsLive(grant({ expiresAt: null, revokedAt: null }), NOW), true);
});

test("grantCovers is the pure scope test and ignores liveness", () => {
  const expired = grant({ expiresAt: NOW - 10, scopeKinds: ["task"] });
  assert.equal(grantCovers(expired, target()), true, "coverage is a separate question");
  assert.equal(grantIsLive(expired, NOW), false, "liveness is the other half");
});

// ---------------------------------------------------------------------------
// the cheap pre-filter
// ---------------------------------------------------------------------------

test("scopeForViewer collects membership and live-grant spaces", () => {
  const scope = scopeForViewer(
    viewer({
      memberships: [{ spaceId: personalSpace, role: "view" }],
      grants: [
        grant({ spaceId: workSpace, scopeKinds: ["expense"] }),
        grant({ spaceId: workSpace, scopeKinds: ["task"], expiresAt: NOW - 1 }),
      ],
    }),
    NOW,
  );
  assert.deepEqual([...scope.spaceIds].sort(), [workSpace, personalSpace].sort());
  assert.deepEqual(scope.grantKinds, ["expense"], "an expired grant opens nothing");
  assert.deepEqual([...scope.ownerOnlyKinds].sort(), [...NEVER_SHARED_KINDS].sort());
});

test("scopeForViewer ignores grants addressed to somebody else", () => {
  const scope = scopeForViewer(
    viewer({ grants: [grant({ granteeUserId: accountant, spaceId: workSpace })] }),
    NOW,
  );
  assert.deepEqual(scope.spaceIds, []);
  assert.deepEqual(scope.grantKinds, []);
});

test("scopeAllows only rejects what is impossible", () => {
  const scope = scopeForViewer(
    viewer({ memberships: [{ spaceId: personalSpace, role: "view" }] }),
    NOW,
  );

  assert.equal(scopeAllows(scope, target()), true, "member, own space");
  assert.equal(scopeAllows(scope, target({ spaceId: workSpace })), false, "not a member of that space");
  assert.equal(scopeAllows(scope, target({ ownerUserId: bob })), true, "your own rows always pass");
  assert.equal(
    scopeAllows(scope, target({ kind: "assistantState" })),
    false,
    "owner-only kinds never pass for anybody else",
  );
});

test("scopeAllows never hides a row the exact resolver would allow", () => {
  // The pre-filter is a performance shortcut. If it can ever reject something
  // `resolveAccess` permits, it becomes a silent data-loss bug.
  const scope = scopeForViewer(
    viewer({
      grants: [grant({ spaceId: workSpace, level: "view", scopeKinds: ["expense"] })],
    }),
    NOW,
  );

  const reachable: AccessTarget[] = [
    target({ spaceId: workSpace, kind: "expense" }),
    target({ spaceId: workSpace, kind: "task" }),
    target({ spaceId: personalSpace }),
  ];

  for (const t of reachable) {
    const exact = resolveAccess(
      viewer({
        grants: [grant({ spaceId: workSpace, level: "view", scopeKinds: ["expense"] })],
      }),
      t,
      NOW,
    );
    if (exact.allowed) {
      assert.equal(scopeAllows(scope, t), true, `pre-filter rejected ${t.kind} in ${t.spaceId}`);
    }
  }
});

// ---------------------------------------------------------------------------
// drift guard: the Convex validator must not widen away from this module
// ---------------------------------------------------------------------------

test("defaultVisibility matches the §4.3 privacy table", () => {
  assert.equal(defaultVisibility("note"), "private");
  assert.equal(defaultVisibility("expense"), "private");
  assert.equal(defaultVisibility("taxProfile"), "private");
  assert.equal(defaultVisibility("taxDocument"), "private");
  assert.equal(defaultVisibility("calendarEvent"), "private", "decided per object; private is the safe default");
  assert.equal(defaultVisibility("task"), "space");
  assert.equal(defaultVisibility("commitment"), "space");
  assert.equal(defaultVisibility("person"), "space");
  assert.equal(defaultVisibility("document"), "space");
  assert.equal(defaultVisibility("area"), "space");
  assert.equal(defaultVisibility("connection"), "space");
  assert.equal(defaultVisibility("somethingBrandNew"), "space", "unknown kinds default to visible, never private-by-omission of the check");
});

test("effectiveVisibility applies the default only when unset", () => {
  assert.equal(effectiveVisibility(target({ kind: "note" })), "private");
  assert.equal(effectiveVisibility(target({ kind: "note", visibility: "space" })), "space");
  assert.equal(effectiveVisibility(target({ kind: "note", visibility: null })), "private");
  assert.equal(effectiveVisibility(target({ kind: "task" })), "space");
  assert.equal(effectiveVisibility(target({ kind: "task", visibility: "private" })), "private");
});

test("schema.ts access levels match this module", () => {
  const source = readFileSync(new URL("../convex/schema.ts", import.meta.url), "utf8");
  const block = source.match(/ACCESS_LEVELS = \[([^\]]*)\]/)?.[1] ?? "";
  const fromSchema = [...block.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(fromSchema, [...ACCESS_LEVELS], "ACCESS_LEVELS has drifted from permissions.ts");
});

test("schema.ts owner-only kinds match this module", () => {
  const source = readFileSync(new URL("../convex/schema.ts", import.meta.url), "utf8");
  const block = source.match(/NEVER_SHARED_KINDS = \[([^\]]*)\]/)?.[1] ?? "";
  const fromSchema = [...block.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(
    [...fromSchema].sort(),
    [...NEVER_SHARED_KINDS].sort(),
    "NEVER_SHARED_KINDS has drifted from permissions.ts",
  );
});

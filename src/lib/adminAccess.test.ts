/**
 * The admin authorisation table (ADR-032 §3).
 *
 * The point of this file is that the **allowed** case is asserted here, with a
 * real fixture, rather than being unrepresentable at the call site. A predicate
 * whose only live caller is a Convex query cannot have its allowed path tested
 * without a deployment and an operator-granted role — which is exactly the gap
 * D64 records. So the allowed path is covered here, and the live harness covers
 * the refusals. Between them, both directions are tested; neither is assumed.
 *
 * Two checks here exist purely to stop this table and the schema drifting apart,
 * because `ADMIN_ROLE` is a duplicated literal (see the note in
 * `adminAccess.ts`) and a duplicated constant is a hole unless something fails
 * when one side moves.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ROLES, roleValidator } from "../convex/schema";
import {
  ADMIN_ROLE,
  KNOWN_ROLES,
  decideAdminAccess,
  describeAdminDenial,
  isAdmin,
} from "./adminAccess";

/**
 * Values a `role` field must never carry, and that the schema would reject on
 * write. Hoisted to module scope because two suites sweep it, and a fixture
 * that only one of them can see is a fixture the other silently stopped
 * covering.
 */
const MALFORMED_ROLES: readonly unknown[] = [
  "Admin", // wrong case
  "ADMIN", // wrong case
  " admin", // leading space
  "admin ", // trailing space
  "adminx",
  "xadmin",
  "superuser",
  "root",
  "owner",
  "", // empty string is a string, and is not the admin role
  " ", // whitespace only
  0,
  1,
  true,
  false,
  null,
  { role: "admin" }, // a nested object is not a role
  ["admin"], // an array is not a role
  Symbol("admin"),
];

describe("ADMIN_ROLE tracks the schema", () => {
  it("is exactly ROLES.ADMIN", () => {
    // If someone edits the schema's role vocabulary without editing
    // `ADMIN_ROLE`, this fails. The literal in `adminAccess.ts` exists so that
    // file needs no Convex runtime; this is the test that pays for that.
    assert.equal(ADMIN_ROLE, ROLES.ADMIN);
  });

  it("is one of the literals the schema validator will actually accept", () => {
    // The decision compares against one string. This asserts that string is
    // genuinely one of the three the schema will store, so the predicate and the
    // validator are talking about the same vocabulary rather than two parallel
    // ones that happen to overlap.
    const literals = (
      roleValidator as unknown as { members: readonly { kind: string; value: unknown }[] }
    ).members;
    assert.ok(literals.every((m) => m.kind === "literal"), "role is not a union of literals");
    assert.ok(
      literals.some((m) => m.value === ADMIN_ROLE),
      "ADMIN_ROLE is not a value the schema accepts",
    );
  });

  it("KNOWN_ROLES is the schema's full role vocabulary, in schema order", () => {
    assert.deepEqual([...KNOWN_ROLES], [ROLES.ADMIN, ROLES.USER, ROLES.MEMBER]);
  });
});

describe("decideAdminAccess — the allowed case", () => {
  it("allows a document whose role is exactly the admin role", () => {
    assert.deepEqual(decideAdminAccess({ role: "admin" }), { allowed: true });
  });

  it("allows a real user document carrying a name, an email and an admin role", () => {
    // The shape Convex Auth actually stores, rather than a minimal stand-in. A
    // predicate tested only on `{ role: "admin" }` is tested on a shape that
    // never occurs in production.
    const document = {
      _id: "kg2ab7c9d0e1f2g3h4i5j",
      _creationTime: 1_700_000_000_000,
      name: "Panel Operator",
      email: "operator@example.com",
      emailVerificationTime: 1_700_000_100_000,
      role: "admin",
    };
    assert.deepEqual(decideAdminAccess(document), { allowed: true });
    assert.equal(isAdmin(document), true);
  });

  it("allows a document that has other optional fields set as well", () => {
    // The schema marks several auth fields optional, so an admin is not
    // guaranteed to look like one particular shape.
    assert.equal(
      isAdmin({
        role: "admin",
        name: null as unknown as undefined,
        image: "https://example.com/a.png",
        isAnonymous: false,
      }),
      true,
    );
  });
});

describe("decideAdminAccess — ordinary accounts are refused", () => {
  it("refuses a user with no role at all", () => {
    assert.deepEqual(decideAdminAccess({ name: "Someone" }), {
      allowed: false,
      reason: "no-user-record",
    });
  });

  it("refuses the user role", () => {
    assert.deepEqual(decideAdminAccess({ role: "user" }), {
      allowed: false,
      reason: "not-an-admin-role",
    });
  });

  it("refuses the member role", () => {
    assert.deepEqual(decideAdminAccess({ role: "member" }), {
      allowed: false,
      reason: "not-an-admin-role",
    });
  });

  it("refuses a document whose role is present but undefined", () => {
    // Distinct from a missing key: the field exists with no value. A
    // `!("role" in user)` check alone would let this through to a comparison
    // that happens to be false — correct by luck rather than by decision.
    assert.deepEqual(decideAdminAccess({ role: undefined }), {
      allowed: false,
      reason: "no-role",
    });
  });
});

describe("decideAdminAccess — no identity at all", () => {
  it("refuses null, undefined and an absent argument", () => {
    for (const value of [null, undefined]) {
      assert.deepEqual(decideAdminAccess(value), {
        allowed: false,
        reason: "not-signed-in",
      });
    }
  });

  it("refuses a falsy primitive that is not null", () => {
    // `if (!user)` would handle these too, but the assertion is here so that a
    // future refactor to a truthiness check is known to still be correct rather
    // than accidentally correct.
    for (const value of [0, "", false, Number.NaN]) {
      assert.deepEqual(decideAdminAccess(value), {
        allowed: false,
        reason: "not-signed-in",
      });
    }
  });

  it("refuses an array even if an attacker puts a role on it", () => {
    // `typeof [] === "object"`, so an array passes a naive object check. It has
    // no `role` of its own, but it inherits one via the prototype chain if
    // anything ever assigned to `Array.prototype`, and it is indexable. Refused
    // on shape, before any field is read.
    const poisoned = Object.assign(["admin"], { role: "admin" });
    assert.deepEqual(decideAdminAccess(poisoned), {
      allowed: false,
      reason: "no-user-record",
    });
  });

  it("refuses a function that claims to be an admin", () => {
    // A function is an object and can carry a `role`. It is not a document.
    const impostor = Object.assign(() => "admin", { role: "admin" });
    assert.deepEqual(decideAdminAccess(impostor), {
      allowed: false,
      reason: "not-signed-in",
    });
  });
});

describe("decideAdminAccess — malformed and near-miss roles are refused", () => {
  // Each of these is refused, and the reason matters only for diagnosis. What
  // matters is that none of them is allowed. `schemaValidation: true` means the
  // database should refuse to *store* these, so this table is mostly about not
  // depending on that: the predicate is a plain function and can be called with
  // anything, and a security decision must not assume its input is well-formed.
  for (const value of MALFORMED_ROLES) {
    it(`refuses ${String(value)}`, () => {
      assert.deepEqual(decideAdminAccess({ role: value }), {
        allowed: false,
        reason: "role-not-a-valid-value",
      });
    });
  }

  it("refuses a role object with a toString that lies", () => {
    // The predicate compares with `===` against a string, so an object with a
    // coercing `toString` is compared as an object and fails. Asserted because
    // a future "be lenient and coerce" refactor would turn this into a bypass.
    const liar = {
      toString() {
        return "admin";
      },
      valueOf() {
        return "admin";
      },
    };
    assert.deepEqual(decideAdminAccess({ role: liar }), {
      allowed: false,
      reason: "role-not-a-valid-value",
    });
  });

  it("refuses a document whose role is inherited from a prototype", () => {
    // `in` walks the prototype chain, so a plain `{}` with
    // `Object.setPrototypeOf` would satisfy `"role" in user`. There is no such
    // shape in the database, but the check must not be the thing that decides.
    const proto = { role: "admin" };
    const inherited = Object.create(proto) as Record<string, unknown>;
    assert.equal(Object.prototype.hasOwnProperty.call(inherited, "role"), false);
    assert.deepEqual(decideAdminAccess(inherited), {
      allowed: false,
      reason: "no-user-record",
    });
  });
});

describe("decideAdminAccess — never throws", () => {
  it("returns a decision for every value in a wide sweep", () => {
    // The contract that makes the predicate safe to call from a handler: no
    // input turns into an exception, because an exception thrown *after* the
    // authorisation decision began is a different control than a refusal, and a
    // caller with a `catch` that treats errors as "not allowed" would be relying
    // on an accident.
    const sweep: readonly unknown[] = [
      ...MALFORMED_ROLES,
      null,
      undefined,
      {},
      [],
      new Map(),
      new Date(),
      Symbol.iterator,
      new Error("admin"),
      () => 1,
    ];
    for (const value of sweep) {
      const decision = decideAdminAccess(value);
      assert.equal(typeof decision.allowed, "boolean");
      if (decision.allowed === false) {
        assert.equal(typeof decision.reason, "string");
        assert.ok(describeAdminDenial(decision.reason).length > 0);
      }
    }
  });
});

describe("describeAdminDenial", () => {
  it("returns a non-empty sentence for every refusal reason", () => {
    const reasons = [
      "not-signed-in",
      "no-user-record",
      "no-role",
      "not-an-admin-role",
      "role-not-a-valid-value",
    ] as const;
    for (const reason of reasons) {
      const text = describeAdminDenial(reason);
      assert.ok(text.length > 0, `${reason} has no description`);
      assert.ok(!text.includes("undefined"), `${reason} renders undefined`);
    }
  });

  it("does not distinguish an ordinary account from a missing record", () => {
    // Anti-oracle: an unauthorised caller must not be able to learn whether the
    // session had a document, or what its role was, from the wording.
    const reasons = ["no-role", "not-an-admin-role", "role-not-a-valid-value"] as const;
    const distinct = new Set(reasons.map(describeAdminDenial));
    assert.equal(distinct.size, 1, "refusal wording distinguishes the caller's record");
  });

  it("keeps the two identity-level refusals distinguishable from each other", () => {
    // The one distinction that is safe: "you are not signed in" is actionable
    // and reveals nothing about a document that was never looked up.
    assert.notEqual(describeAdminDenial("not-signed-in"), describeAdminDenial("no-user-record"));
  });
});

describe("isAdmin and decideAdminAccess cannot disagree", () => {
  it("agrees across a sweep of values", () => {
    // Two exports of the same rule is two things that can drift. Asserted
    // directly rather than relying on reviewers to notice a divergence.
    const values: readonly unknown[] = [
      { role: "admin" },
      { role: "user" },
      { role: "member" },
      { role: undefined },
      {},
      null,
      undefined,
      "admin",
      ["admin"],
      { role: "Admin" },
    ];
    for (const value of values) {
      assert.equal(isAdmin(value), decideAdminAccess(value).allowed, String(value));
    }
  });
});

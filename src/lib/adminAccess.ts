/**
 * Internal admin access — the single decision of "may this request see the
 * Admin Control Centre?" (ADR-032, §2–3).
 *
 * ## Why this file exists rather than a line in a query handler
 *
 * A security rule that lives only inside a Convex handler is a rule with no
 * fixture: the only way to test it is to stand up a deployment and hope. That is
 * how a green check comes to mean nothing, which this project has already paid
 * for (D60). So the *decision* is a pure function here, with no Convex import,
 * no clock and no database, exactly as `permissions.ts` decides access to a
 * space. `src/convex/admin.ts` does nothing but resolve an identity, read the
 * document, and call {@link decideAdminAccess}.
 *
 * The split also makes the two halves auditable separately. This file is where
 * "who counts as an admin" is written down. The Convex file is where "is the
 * caller who they claim to be" is established. Conflating them is how a rule
 * ends up depending on a `ctx` it should not have.
 *
 * ## The rule
 *
 * An admin is a `users` document whose `role` is exactly the string
 * `ROLES.ADMIN` (`"admin"`). That is the whole of it.
 *
 * **Deny by default, structurally.** There is no branch that returns "allowed"
 * without matching that one exact value. Everything else — no document, a
 * document with no `role`, `null`, a number, an object, an array, a prototype
 * trick, a string that merely *starts with* `"admin"` — is a refusal. The
 * vocabulary is a closed three-value union in the schema (`roleValidator`), so
 * "anything that is not the admin role" is a type-level fact rather than a
 * comparison that a typo could widen.
 *
 * ## What this deliberately does NOT do
 *
 * - It does not look at a space, a grant, a permission level or an `AccessLevel`.
 *   System-level admin is an axis orthogonal to per-space access; mixing them
 *   would let a space grant become a system grant, which is the failure ADR-009
 *   exists to prevent.
 * - It does not accept an email, a domain, a list, or a "first user is the
 *   admin" rule. Each of those makes a mutable or guessable input into an
 *   authority.
 * - It has no notion of *what* is being accessed. Authorisation for the Control
 *   Centre is not parameterised, because there is exactly one capability and it
 *   is read-only. If a second capability ever appears, it needs its own
 *   predicate rather than a parameter here — a flag argument to an
 *   authorisation function is how a narrow grant becomes a broad one.
 *
 * ## Why the role survives a sign-in
 *
 * Because nothing in Convex Auth writes it: `@convex-dev/auth` creates a user
 * with `db.insert` and updates with `db.patch`, and has no `db.replace` on
 * `users` anywhere in the package. Verified in the installed 0.0.96, and
 * recorded in ADR-032 because the whole decision rests on it.
 */

/**
 * The one value that grants internal access.
 *
 * Declared as a literal rather than imported from `src/convex/schema.ts` on
 * purpose: this file stays importable by a plain `node:test` fixture with no
 * Convex runtime. {@link ADMIN_ROLE} is asserted equal to `ROLES.ADMIN` in
 * `adminAccess.test.ts`, so the two cannot drift apart silently — which is the
 * property an import would have given for free, bought back with a test that
 * fails the moment someone edits one side.
 */
export const ADMIN_ROLE = "admin";

/**
 * Every closed role, mirrored from `src/convex/schema.ts`.
 *
 * Carried because "user" and "member" are real values that appear on documents
 * and are **refusals**. A predicate that only knew about `"admin"` would treat
 * them as unknown shapes, and the fixture table would not be able to assert that
 * an ordinary account is actively denied rather than merely unrecognised.
 */
export const KNOWN_ROLES = ["admin", "user", "member"] as const;

/**
 * Why a request was refused. A closed union, so the caller cannot invent a
 * reason and the UI cannot render one it was not given.
 *
 * These strings are rendered in the Control Centre's own denial panel, so they
 * are written to be readable by a human operator, not just parseable. None of
 * them reveals anything about the refused caller.
 */
export type AdminRefusal =
  /** No authenticated identity at all. Not signed in, or the token was invalid. */
  | "not-signed-in"
  /** Signed in, but the user document no longer exists (deleted mid-session). */
  | "no-user-record"
  /** Signed in and the document exists, but it carries no `role` field. */
  | "no-role"
  /** The `role` is present and is a known non-admin role (`user` / `member`). */
  | "not-an-admin-role"
  /**
   * The `role` is present but is not a string the schema permits.
   *
   * Reachable in principle: `schemaValidation` is on, so a bad value cannot be
   * *written*, but this file is a plain function and a caller can pass anything.
   * A predicate that trusted its input because the database "should" have
   * validated it is a predicate with a hole in it, so this case is enumerated
   * and tested rather than assumed away.
   */
  | "role-not-a-valid-value";

/** The outcome of {@link decideAdminAccess}. Discriminated on `allowed`. */
export type AdminDecision =
  | { allowed: true }
  | { allowed: false; reason: AdminRefusal };

/** A `users` document, reduced to the one field this decision reads. */
export type AdminRoleCarrier = { role?: unknown } | null | undefined;

/**
 * Whether this document identifies an internal admin.
 *
 * The whole authorisation rule for the Control Centre, in one expression that
 * can be read in a sentence: *a document whose `role` is exactly `"admin"`*.
 *
 * Takes `unknown` deliberately. A predicate typed `(user: { role?: Role })`
 * would have the type system reject the malformed cases at the call site — and
 * the malformed cases are precisely the ones worth testing, because the whole
 * claim is that nothing but an exact match gets in. Taking `unknown` and
 * narrowing by hand means the fixtures can feed it `null`, `0`, `{}`, `[]`,
 * `"Admin"`, `"admin "` and an object with a poisoned `toString`, and each one
 * has an asserted outcome.
 *
 * Never throws, and never consults anything outside its argument — no clock, no
 * environment, no module state. A refusal is a value, not an exception, so a
 * caller cannot accidentally treat it as a successful check.
 */
export function decideAdminAccess(user: unknown): AdminDecision {
  // Not `if (!user)`: a document is an object, so this also rejects `0`, `""`
  // and `false` without needing to know they are impossible upstream.
  if (typeof user !== "object" || user === null) {
    return { allowed: false, reason: "not-signed-in" };
  }

  // A user document is a plain object. An array satisfies `typeof === "object"`
  // and has no `role`, so it lands on `no-role` below — refused either way, but
  // rejected explicitly here so the reason is about the shape rather than about
  // a missing field, and so an array can never be indexed like a document.
  if (Array.isArray(user)) {
    return { allowed: false, reason: "no-user-record" };
  }

  // `Object.prototype.hasOwnProperty`, **not** `"role" in user`.
  //
  // `in` walks the prototype chain, so `Object.create({ role: "admin" })`
  // satisfies it and would be allowed. No Convex document is ever shaped that
  // way — but a predicate that would allow it is a predicate whose safety
  // depends on the database never producing a shape, and this one is also
  // reachable from any future caller that builds an object rather than reading
  // one. Asserted by a fixture, and it is the reason the check is an own-
  // property test: `adminAccess.test.ts` caught this after the predicate was
  // first written with `in`.
  if (!Object.prototype.hasOwnProperty.call(user, "role")) {
    return { allowed: false, reason: "no-user-record" };
  }

  const role = (user as { role?: unknown }).role;

  if (role === undefined) {
    return { allowed: false, reason: "no-role" };
  }
  if (typeof role !== "string") {
    return { allowed: false, reason: "role-not-a-valid-value" };
  }
  if (role === ADMIN_ROLE) {
    return { allowed: true };
  }
  if ((KNOWN_ROLES as readonly string[]).includes(role)) {
    return { allowed: false, reason: "not-an-admin-role" };
  }
  return { allowed: false, reason: "role-not-a-valid-value" };
}

/**
 * Whether this document identifies an internal admin. The boolean form, for the
 * call sites that only need the answer.
 *
 * Exists so that a caller cannot write `if (decideAdminAccess(u).reason)`, which
 * would be true for `"no-role"` as well as for a real refusal and would turn a
 * *reason* into a grant. Reading `.allowed` is the only correct use of
 * {@link decideAdminAccess} for an authorisation decision; the reason exists for
 * the UI, and {@link describeAdminDenial} is the one function allowed to read it.
 */
export function isAdmin(user: unknown): boolean {
  return decideAdminAccess(user).allowed === true;
}

/**
 * One line explaining a refusal to a person, without revealing anything about
 * the refused caller.
 *
 * All four refusal shapes collapse into a single honest sentence for the UI
 * rather than four, because a control centre that enumerates *why* it refused
 * you is an oracle: "your document exists but you are not an admin" is a
 * confirmation that the account exists, and the distinction between
 * `no-user-record` and `not-an-admin-role` is not one an unauthorised caller is
 * entitled to. The specific reason is kept for the *authorised* view and for
 * test failure messages, where it has no attacker.
 */
export function describeAdminDenial(reason: AdminRefusal): string {
  switch (reason) {
    case "not-signed-in":
      return "Not signed in.";
    case "no-user-record":
      return "Signed in, but no user record was found for this session.";
    case "no-role":
    case "not-an-admin-role":
    case "role-not-a-valid-value":
      return "This account is not an internal administrator.";
    default: {
      // Unreachable while `AdminRefusal` is the closed union above. Exhaustive
      // on purpose: adding a reason to the union must break this function at
      // compile time rather than silently render `undefined`.
      const never: never = reason;
      return `Unrecognised refusal (${String(never)}).`;
    }
  }
}

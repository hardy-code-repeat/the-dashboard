/**
 * Infrastructure bindings (ADR-034, CHANGE-0040).
 *
 * ## What this module is
 *
 * The typed registry behind the Control Centre's **Infrastructure Bindings**
 * section: the set of credentials this *deployment* expects from outside, each
 * one named by provider and purpose, with a configuration **state** and never a
 * value.
 *
 * It is the Panel-side half of ADR-034's two tiers. The tenant OAuth tier —
 * per-user, per-space provider tokens in `connectionTokens` — is a different
 * thing governed by ADR-014 and is deliberately **not** described here.
 *
 * ## The invariant this module exists to protect
 *
 * > **Panel must never possess a credential capable of modifying the secret
 * > configuration of the infrastructure on which Panel itself runs.**
 *
 * Nothing here stores, reads, derives or returns a secret value, and nothing
 * here can write anything. The module has no database access, no network
 * access, and no Convex import — it is a pure declaration plus pure functions,
 * which is what makes it testable and what makes it incapable of doing damage.
 *
 * ## Why the environment variable *name* is not in the disclosure
 *
 * A name is not a secret. But `DATABASE_URL` disclosed to a reader tells them
 * which secret exists, which infrastructure is in use, and therefore what to
 * target next. ADR-034 therefore forbids displaying binding names in phase 1,
 * and this module enforces that **structurally**: {@link bindingDisclosure}
 * returns a {@link BindingDisclosure}, which has no `name` or `envVar` field to
 * populate. The rule cannot be satisfied by a UI that chooses to hide something
 * it was handed, because it is never handed it.
 *
 * The name is still needed — server-side, to read the variable's *presence* —
 * so it lives in {@link InfrastructureBinding.envVar} and is read only by
 * `admin.ts`, which reduces it to a {@link ConfigState} before returning.
 *
 * ## Why this is a closed literal list and not an enumeration
 *
 * `admin.ts` deliberately named its four platform variables by hand so that
 * "report every environment variable" could never happen. This module is the
 * same idea for providers: a **hardcoded array of a closed union**, so a new
 * provider is a visible edit in a diff, and `Object.keys(process.env)` appears
 * nowhere. The invariant that matters is not "the list is manual", it is
 * "nothing outside this list can enter the surface" — and a literal array of a
 * closed union satisfies it in a way an enumeration would not.
 *
 * ## What it is not
 *
 * Not a secret store. Not an EAV table. Not a plugin registry (ADR-011). Not a
 * second backend. It declares five rows.
 */

/**
 * The providers whose credentials this deployment may expect.
 *
 * A closed union on purpose: adding a provider is a compiler-visible edit here,
 * which is the same property ADR-007 gives typed entity tables and the reason
 * this is not a generic key/value registry.
 */
export const BINDING_PROVIDERS = ["neon", "vly", "google"] as const;
export type BindingProvider = (typeof BINDING_PROVIDERS)[number];

/**
 * What a credential is *for*, as a closed union.
 *
 * `database` is one database reachable with one statement. `api-key` is a
 * provider's API surface. `oauth-client` is the client half of a user-delegated
 * OAuth flow and carries no user data by itself.
 */
export const BINDING_PURPOSES = ["database", "api-key", "oauth-client"] as const;
export type BindingPurpose = (typeof BINDING_PURPOSES)[number];

/**
 * The configuration vocabulary, re-used from the findings registry rather than
 * reinvented, so a state cannot read "CONFIGURED" in one place and "configured"
 * in another.
 */
export type ConfigState = "configured" | "missing" | "requires-rotation" | "not-observable";

/**
 * Whether a safe health check exists for this provider.
 *
 * `live` means Panel can already prove the credential works using code that
 * exists today. `none` means Panel can report configuration state and **nothing
 * more**, and inventing a probe for it would mean either a new credential or a
 * new architecture — both out of scope (ADR-034 phase 1).
 */
export type BindingHealthCheck = "live" | "none";

/** One infrastructure binding, as declared in source. */
export interface InfrastructureBinding {
  provider: BindingProvider;
  purpose: BindingPurpose;
  /**
   * The deployment environment variable's name.
   *
   * **Never returned to a client.** Read server-side for presence only; see the
   * module header for why the name itself is withheld.
   */
  envVar: string;
  /** What breaks while this is absent, for a human operator. */
  note: string;
  healthCheck: BindingHealthCheck;
}

/**
 * Every infrastructure binding Panel declares, in display order.
 *
 * `readonly` and `as const`-typed through the interfaces, so an adapter cannot
 * add a row at runtime and no code can widen `provider` or `purpose` with a
 * string that is not in the union above.
 */
export const INFRASTRUCTURE_BINDINGS: readonly InfrastructureBinding[] = [
  {
    provider: "neon",
    purpose: "database",
    envVar: "DATABASE_URL",
    note: "Neon pooled connection string, scoped to one database. Used by the connectivity health check only; Panel stores no schema, table or data in Neon.",
    healthCheck: "live",
  },
  {
    provider: "vly",
    purpose: "api-key",
    envVar: "VLY_INTEGRATION_KEY",
    note: "Vly deployment token for the email and AI integration surface. Panel holds no LLM dependency on it.",
    healthCheck: "none",
  },
  {
    provider: "google",
    purpose: "oauth-client",
    envVar: "GOOGLE_CLIENT_ID",
    note: "Half of the Google OAuth client pair. Absent means the calendar integration is declared but cannot be exercised (D32).",
    healthCheck: "none",
  },
  {
    provider: "google",
    purpose: "oauth-client",
    envVar: "GOOGLE_CLIENT_SECRET",
    note: "The other half of the client pair. State only: Panel never reads, returns or logs the value.",
    healthCheck: "none",
  },
];

/**
 * Exactly what may cross the boundary to the Admin Control Centre.
 *
 * Note what is **absent by construction**: no `envVar`, no `note` carrying a
 * value, no fingerprint, no length, no prefix. Adding such a field here would
 * be visible in one place and would break the drift gate
 * `checkInfrastructureBindings`, which asserts this shape.
 */
export interface BindingDisclosure {
  provider: BindingProvider;
  purpose: BindingPurpose;
  state: ConfigState;
  healthCheck: BindingHealthCheck;
}

/**
 * Reduce a declared binding and its configuration state to the safe payload.
 *
 * The only path from {@link InfrastructureBinding} to anything a client can see,
 * so this is where the disclosure contract is enforced rather than remembered.
 * The environment variable's name is read by the caller and deliberately
 * dropped here.
 */
export function bindingDisclosure(
  binding: InfrastructureBinding,
  state: ConfigState,
): BindingDisclosure {
  return {
    provider: binding.provider,
    purpose: binding.purpose,
    state,
    healthCheck: binding.healthCheck,
  };
}

/** True when the provider has a live health check, which is Neon alone today. */
export function hasLiveHealthCheck(provider: BindingProvider): boolean {
  return INFRASTRUCTURE_BINDINGS.some((b) => b.provider === provider && b.healthCheck === "live");
}

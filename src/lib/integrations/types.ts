/**
 * The integration contract (SYSTEM_FUNDAMENTALS §7, ADR-012, ADR-013, ADR-014).
 *
 * One adapter shape, one normalised output, one writer. Adding a provider is
 * "write an adapter, add a registry entry" — never a new mutation, a new UI
 * path, or a second place that knows what a calendar is.
 *
 * Nothing in this file performs I/O, reads a clock or touches a database. It is
 * the vocabulary every other integration module speaks, and it is where the
 * two security invariants are expressed *as types* rather than as comments:
 *
 *  - `Adapter.scopes` is `readonly`, so an adapter cannot ask for more than its
 *    registry entry declares, and `assertScope` refuses a mutating scope
 *    outright. Panel never writes to a provider in v1 (ADR-013).
 *  - `IntegrationError.code` is a closed union. A provider's own error body
 *    never becomes a Panel error, because it ends up in a log and logs are read
 *    by people who should not see the user's provider payloads.
 */

/** The closed set of Panel-visible integration failures. */
export type IntegrationErrorCode =
  | "auth_revoked"
  | "auth_expired"
  | "rate_limited"
  | "network"
  | "provider_unavailable"
  | "invalid_scope"
  | "malformed_response"
  | "not_configured"
  | "unknown";

/**
 * The only shape an integration failure is allowed to take.
 *
 * `detail` is Panel's own sentence about what happened. There is no field for a
 * provider's response body, a stack, or a URL with a token in it — not because
 * they are discouraged but because they cannot be constructed here.
 */
export interface IntegrationError {
  code: IntegrationErrorCode;
  detail: string;
  /** True when the user must reconnect. Everything else can be retried. */
  reconnectRequired: boolean;
}

/** Why a connection ended. Persisted on `connections`. */
export type SyncState =
  | "idle"
  | "syncing"
  | "healthy"
  | "stale"
  | "error"
  | "revoked"
  | "disconnected";

/**
 * One normalised upstream object.
 *
 * `externalId` is the stable key and the whole of idempotency: applying the
 * same batch twice must produce the same row, not two. `kind` selects which
 * table the writer puts it in — there is no generic object table (ADR-007), so
 * the set of kinds is closed here rather than open at runtime.
 */
export type NormalizedKind = "calendarEvent" | "expense" | "task";

export interface NormalizedObject {
  kind: NormalizedKind;
  /** The provider's stable id. Never blank — a blank id is not idempotent. */
  externalId: string;
  /** Upstream last-changed. Used to decide staleness, never to overwrite. */
  changedAt?: number;
  /** Scalar fields only. No nested objects, no arrays of objects (ADR-008). */
  fields: Record<string, string | number | boolean | null>;
}

/**
 * One relationship between two normalised objects.
 *
 * `rel` is a closed vocabulary and `visibility` follows the same rules as every
 * other object: private by default.
 */
export interface NormalizedLink {
  rel: "attends" | "concerns" | "derived_from" | "pays_for";
  fromKind: NormalizedKind;
  fromExternalId: string;
  toKind: NormalizedKind;
  toExternalId: string;
  /** Upstream confidence, 0..1. Panel never invents one above what it was told. */
  confidence: number;
}

/**
 * What an adapter returns. Exactly one shape for every provider.
 *
 * `cursor` is opaque to Panel and is the only thing that decides where the next
 * fetch starts. Adapters that have no cursor return null and the framework does
 * a full sweep, which is correct if slow and never incorrect.
 */
export interface NormalizedBatch {
  provider: string;
  objects: NormalizedObject[];
  links: NormalizedLink[];
  cursor: string | null;
  /** Provider-reported change time for the whole page. */
  fetchedAt: number;
  /** True when the provider told us this page is the last of the sweep. */
  complete: boolean;
}

/**
 * The registry entry: everything Panel knows about a provider *before* it talks
 * to it. Nine questions from §7.2, answered as data.
 */
export interface IntegrationDef {
  slug: string;
  label: string;
  /** The one authority. Panel holds a cache and never becomes the source. */
  sourceOfTruth: string;
  /** v1 is inbound only. Recorded so a client cannot be told otherwise. */
  direction: "inbound";
  /** Panel may modify the external system in v1. Always false. */
  writable: false;
  /** Every OAuth scope this integration may ever request. */
  scopes: readonly string[];
  /** What happens when the object disappears upstream. */
  onUpstreamDelete: "delete-and-orphan" | "mark-cancelled";
  /** Hours without a sync before a banner, and before suppression. */
  staleBannerHours: number;
  staleSuppressHours: number;
  /** Env vars the user must provide. Never read from the client. */
  requiredEnvVars: readonly string[];
  /**
   * How the credential is obtained.
   *
   * `oauth-pkce` — Authorization Code with PKCE. Every OAuth 2.0 provider uses
   * this; there is no implicit or "plain" OAuth path in Panel, because an
   * intercepted authorisation code is replayable without a verifier.
   * `link-token` — the provider hands a token to the client SDK (Plaid's Link),
   * so there is no code to intercept and nothing for PKCE to protect.
   * `none` — no credential at all.
   */
  authFlow: "oauth-pkce" | "link-token" | "none";
  /** One line shown in the UI, so the user knows what they are agreeing to. */
  disclosure: string;
}

/**
 * The adapter interface.
 *
 * Fetching is an *action*, not a query: it performs network I/O and may be slow.
 * That is why it cannot be a Convex query, and why it cannot be reachable from
 * a public function that takes a user-supplied provider slug without a registry
 * check.
 */
export interface Adapter {
  readonly def: IntegrationDef;
  /** Pulls one page. Never mutates Panel state. */
  fetchPage(args: {
    accessToken: string;
    cursor: string | null;
    since: number | null;
  }): Promise<NormalizedBatch>;
}

/** Scopes Panel will never accept, whatever an adapter declares. */
const MUTATING_SCOPE_PATTERN =
  /(^|[.:/_-])(write|writes|modify|delete|create|update|send|publish|manage|full|all|compose|insert)([.:/_-]|$)/i;

/**
 * Refuses a registry entry that asks for anything Panel will not grant.
 *
 * "Minimum scope" is only a real constraint if something enforces it, and a
 * comment saying "read-only" is not a constraint — a provider could add a scope
 * to its defaults and the code would ask for it. This is that something.
 */
export function assertScope(def: IntegrationDef): void {
  if (def.authFlow === "none") return;
  if (def.scopes.length === 0) throw new IntegrationFailure("not_configured", "No scope declared.");
  for (const scope of def.scopes) {
    if (MUTATING_SCOPE_PATTERN.test(scope)) {
      throw new IntegrationFailure(
        "invalid_scope",
        "Panel does not ask for write access to a connected tool.",
      );
    }
  }
  if (def.writable) {
    throw new IntegrationFailure("invalid_scope", "Panel does not write to connected tools.");
  }
}

/** Thrown by adapters and framework code. Carries only a closed code. */
export class IntegrationFailure extends Error {
  readonly code: IntegrationErrorCode;
  readonly reconnectRequired: boolean;

  constructor(code: IntegrationErrorCode, detail: string, reconnectRequired = false) {
    super(detail);
    this.name = "IntegrationFailure";
    this.code = code;
    this.reconnectRequired = reconnectRequired;
  }
}

const CODE_TEXT: Record<IntegrationErrorCode, { detail: string; reconnect: boolean }> = {
  auth_revoked: { detail: "That connection was revoked at the provider.", reconnect: true },
  auth_expired: { detail: "That connection has expired.", reconnect: true },
  rate_limited: { detail: "The provider is asking us to slow down.", reconnect: false },
  network: { detail: "We could not reach the provider.", reconnect: false },
  provider_unavailable: { detail: "The provider is not available right now.", reconnect: false },
  invalid_scope: { detail: "That connection asked for access Panel does not grant.", reconnect: false },
  malformed_response: { detail: "The provider sent something we did not understand.", reconnect: false },
  not_configured: { detail: "That integration is not configured.", reconnect: false },
  unknown: { detail: "Something went wrong talking to that provider.", reconnect: false },
};

/**
 * Maps any provider failure onto the closed set.
 *
 * The provider's own body — which may contain the user's data, an internal
 * hostname, or a token echoed back in an error — is **never** read, logged or
 * forwarded. Only the shape of the failure is used, and only to pick a code.
 * That is the whole of ADR-014's "provider errors map to stable codes".
 */
export function mapProviderError(error: unknown): IntegrationError {
  if (error instanceof IntegrationFailure) {
    const text = CODE_TEXT[error.code];
    return { code: error.code, detail: text.detail, reconnectRequired: text.reconnect };
  }
  const status = extractStatus(error);
  const code: IntegrationErrorCode =
    status === 401
      ? "auth_expired"
      : status === 403
        ? "auth_revoked"
        : status === 429
          ? "rate_limited"
          : status !== null && status >= 500
            ? "provider_unavailable"
            : status === null
              ? "network"
              : "unknown";
  const text = CODE_TEXT[code];
  return { code, detail: text.detail, reconnectRequired: text.reconnect };
}

/** Reads only the numeric status, never the body. */
function extractStatus(error: unknown): number | null {
  if (typeof error !== "object" || error === null) return null;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" && Number.isFinite(status) ? status : null;
}

/** FNV-1a, matching the attention fingerprint. Same job, same shape. */
export function externalKey(kind: NormalizedKind, externalId: string): string {
  let hash = 0x811c9dc5;
  const input = `${kind}:${externalId}`;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}
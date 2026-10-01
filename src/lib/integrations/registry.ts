/**
 * The integration registry (§7.2, ADR-012, ADR-013).
 *
 * Pure data plus two lookups. This is where Panel's answer to "what does this
 * connector do, and what is it allowed to ask for?" lives, so that the answer
 * is the same in the OAuth start flow, the sync action, the connection list the
 * UI renders, and the tests.
 *
 * Nine questions per §7.2, all of them fields rather than prose, because a
 * connector that skips one is rejected here rather than discovered in
 * production. Google Calendar is the reference implementation; the others are
 * declared but not yet wired, and saying so in the data is the point.
 *
 * `assertScope` runs at module load. A registry entry that asked for a mutating
 * scope therefore fails the moment this module is imported — a build-time
 * failure rather than a request-time surprise.
 */

import { assertScope, type Adapter, type IntegrationDef } from "./types";

const DEFS: readonly IntegrationDef[] = [
  {
    slug: "google-calendar",
    label: "Google Calendar",
    sourceOfTruth: "Google. Panel holds a cache and is never the authority.",
    direction: "inbound",
    writable: false,
    // ADR-013: read-only, and nothing else. No events.write, and no freebusy
    // query that would leak attendee state.
    scopes: ["https://www.googleapis.com/auth/calendar.readonly"],
    onUpstreamDelete: "delete-and-orphan",
    staleBannerHours: 48,
    staleSuppressHours: 168,
    requiredEnvVars: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
    authFlow: "oauth-pkce",
    disclosure:
      "Reads your calendar only. Panel never writes to Google, and private events are stored as “Busy” with no title.",
  },
  {
    slug: "nylas",
    label: "Nylas (mail + calendar)",
    sourceOfTruth: "Nylas, which federates the underlying provider.",
    direction: "inbound",
    writable: false,
    scopes: ["email.read_only", "calendar.read_only"],
    onUpstreamDelete: "delete-and-orphan",
    staleBannerHours: 48,
    staleSuppressHours: 168,
    requiredEnvVars: ["NYLAS_CLIENT_ID", "NYLAS_API_KEY"],
    authFlow: "oauth-pkce",
    disclosure:
      "Read-only access to mail and calendar through Nylas. Panel never sends or deletes anything.",
  },
  {
    slug: "plaid",
    label: "Bank accounts",
    sourceOfTruth: "The bank, via Plaid.",
    direction: "inbound",
    writable: false,
    scopes: ["transactions"],
    onUpstreamDelete: "mark-cancelled",
    staleBannerHours: 48,
    staleSuppressHours: 72,
    requiredEnvVars: ["PLAID_CLIENT_ID", "PLAID_SECRET"],
    // Plaid hands a token to the client SDK rather than running a redirect, so
    // there is no authorisation code to intercept and nothing for PKCE to
    // protect. Stated explicitly rather than left blank.
    authFlow: "link-token",
    disclosure: "Read-only transaction data. Panel cannot move money.",
  },
];

const BY_SLUG = new Map(DEFS.map((d) => [d.slug, d] as const));

/** Every declared integration. Safe to send to a client — it holds no secrets. */
export function allIntegrations(): readonly IntegrationDef[] {
  return DEFS;
}

export function definitionFor(slug: string): IntegrationDef {
  const def = BY_SLUG.get(slug);
  if (!def) {
    throw new Error(
      `Unknown integration "${slug}". Add it to the registry before wiring it — an undeclared provider has no contract, and a provider with no contract has no scopes.`,
    );
  }
  return def;
}

export function hasIntegration(slug: string): boolean {
  return BY_SLUG.has(slug);
}

/**
 * Adapters, keyed by provider.
 *
 * Empty in phase 1.5 by design: the framework is the deliverable, and shipping
 * a half-written Google adapter would put untested network code on the path to
 * a user's data. Phase 2 registers the first one behind this same interface.
 */
const ADAPTERS = new Map<string, Adapter>();

export function adapterFor(slug: string): Adapter | null {
  return ADAPTERS.get(slug) ?? null;
}

/** Called by a provider module at import time. Phase 2's only caller. */
export function registerAdapter(adapter: Adapter): void {
  assertScope(adapter.def);
  const declared = definitionFor(adapter.def.slug);
  if (JSON.stringify(declared.scopes) !== JSON.stringify(adapter.def.scopes)) {
    throw new Error(
      `Adapter "${adapter.def.slug}" declares different scopes to the registry. The registry is the authority; an adapter may ask for less, never for more.`,
    );
  }
  ADAPTERS.set(adapter.def.slug, adapter);
}

/**
 * Module-load validation.
 *
 * Runs once, when this module is first imported, and fails loudly. A contract
 * that is only checked when someone remembers to check it is not a contract.
 */
for (const def of DEFS) {
  try {
    assertScope(def);
  } catch (e) {
    throw new Error(`Integration "${def.slug}" is misconfigured: ${(e as Error).message}`);
  }
}
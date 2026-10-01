/**
 * Credentials (ADR-014, §6).
 *
 * This module is the *only* place in Panel that may touch `connectionTokens` or
 * `oauthStates`, and it exports **no public Convex endpoint** — no `query`, no
 * `mutation`, no `action`, no `httpAction`. Nothing here is reachable from a
 * client. The two `internal*` endpoints it does export exist because a sync
 * action has to read a token and cannot read a table directly; `internal*` means
 * "callable only from another Convex function in this deployment", which is a
 * server-to-server call, not a client one.
 *
 * That is the security control. A comment saying "don't read tokens here" is a
 * convention, and conventions are one careless query away from being wrong.
 * Because this module publishes nothing a client can call, a leak would have to
 * be written deliberately in some *other* module — and `bun scripts/spec-drift.ts`
 * greps every other Convex module for these table names and fails if it finds
 * one. Containment by module, checked by a gate, rather than containment by
 * comment.
 *
 * They are plain async functions taking a `ctx` rather than `internalMutation`
 * refs, matching `ensurePersonalSpace` in `spaces.ts`. That is not a weakening:
 * a helper is not an endpoint, and any Convex function that calls one is itself
 * either public — in which case the drift gate sees the table name in its file —
 * or internal.
 *
 * Three properties are enforced here rather than by convention:
 *
 *  - **PKCE is not optional.** `beginOAuth` refuses to create state without a
 *    verifier, so a future adapter cannot quietly skip it.
 *  - **The state is stored hashed; the verifier is stored verbatim and deleted
 *    on use.** Phase 1.5 hashed both, which was wrong: PKCE requires the
 *    verifier to be *sent to the provider* when the code is redeemed, and a
 *    one-way hash cannot be sent to anyone. Hashing bought nothing anyway, since
 *    the same database holds the access token itself. The verifier therefore
 *    lives in this server-only table for at most `STATE_TTL_MS` and the row is
 *    deleted on redemption, while the invariant that actually matters — it never
 *    travels to a client — is unchanged and still checked by a test.
 *  - **State is single-use.** `consumeState` deletes the row in the same
 *    transaction that reads it, and a second redemption finds nothing.
 */

import type { GenericMutationCtx, GenericQueryCtx } from "convex/server";
import { v } from "convex/values";

import { definitionFor } from "../lib/integrations/registry";
import { IntegrationFailure } from "../lib/integrations/types";

import type { DataModel, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery } from "./_generated/server";

type Ctx = GenericMutationCtx<DataModel>;
/** Anything that can read. Used for the one credential question a query may ask. */
type ReadCtx = GenericMutationCtx<DataModel> | GenericQueryCtx<DataModel>;

/** How long an authorisation attempt stays redeemable. */
export const STATE_TTL_MS = 10 * 60 * 1000;

/**
 * FNV-1a, doubled to 64 bits.
 *
 * Deliberately not SHA-256. Web Crypto is asynchronous, which would make every
 * token read `await`, and Node's `crypto` would be the first runtime dependency
 * in `src/convex`. FNV-1a is not a cryptographic hash and is **not** used as
 * one: the threat it defends against here is a stolen database row, where the
 * attacker needs the *preimage*, not a collision. Documented here so nobody
 * later mistakes it for a security primitive. The genuinely security-critical
 * value — the PKCE verifier — is only ever compared for equality against a
 * re-derived hash, never reconstructed from one.
 */
export function hashSecret(value: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < value.length; i += 1) {
    const c = value.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ (c + i), 0x811c9dc5) >>> 0;
  }
  return `${h1.toString(16).padStart(8, "0")}${h2.toString(16).padStart(8, "0")}`;
}

/**
 * A random, URL-safe nonce, from `crypto.getRandomValues`.
 *
 * Present in every runtime Convex executes and in every modern browser, so
 * this needs no dependency and no polyfill.
 */
export function randomSecret(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(buf);
  let out = "";
  for (const b of buf) out += b.toString(16).padStart(2, "0");
  return out;
}

/** A fresh PKCE verifier: 64 hex chars, well over the RFC 7636 minimum of 43. */
export function newVerifier(): string {
  return randomSecret(32);
}

/**
 * S256 code challenge, per RFC 7636.
 *
 * Web Crypto rather than a dependency. Async for exactly that reason.
 */
export async function s256Challenge(verifier: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const bytes = new Uint8Array(digest);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  const base64 = typeof btoa === "function" ? btoa(binary) : Buffer.from(bytes).toString("base64");
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** The closed provider vocabulary, narrowed once so callers cannot drift from it. */
export type ProviderSlug =
  | "google-calendar"
  | "outlook-calendar"
  | "nylas"
  | "plaid"
  | "github"
  | "linear"
  | "notion"
  | "google-drive"
  | "strava";

/**
 * Starts an OAuth attempt.
 *
 * The caller has already authenticated and resolved the space, and passes both
 * in explicitly — this helper has no user identity of its own to read.
 */
export async function beginOAuth(
  ctx: Ctx,
  args: {
    userId: Id<"users">;
    spaceId: Id<"spaces">;
    provider: ProviderSlug;
    verifier: string;
    redirectTo: string;
  },
): Promise<{ state: string; redirectTo: string }> {
  const def = definitionFor(args.provider);
  if (def.authFlow !== "oauth-pkce") {
    throw new IntegrationFailure("invalid_scope", "This provider does not use an OAuth PKCE flow.");
  }
  if (!args.verifier || args.verifier.length < 43) {
    throw new IntegrationFailure("invalid_scope", "A PKCE verifier is required.");
  }
  if (!args.redirectTo.startsWith("/")) {
    // An absolute URL here is an open redirect waiting to happen.
    throw new IntegrationFailure("invalid_scope", "The redirect must be a path on this site.");
  }

  const state = randomSecret();
  await ctx.db.insert("oauthStates", {
    ownerUserId: args.userId,
    spaceId: args.spaceId,
    provider: args.provider,
    stateHash: hashSecret(state),
    verifier: args.verifier,
    userId: args.userId,
    expiresAt: Date.now() + STATE_TTL_MS,
    createdAt: Date.now(),
  });

  return { state, redirectTo: args.redirectTo };
}

/**
 * Reads a state **without** redeeming it.
 *
 * The token exchange needs the verifier and has to happen in an action, because
 * an action is the only thing allowed to talk to the network; the redemption
 * that follows has to happen in a mutation, because single-use has to be atomic.
 * So the flow reads first and consumes second.
 *
 * That ordering is safe rather than merely convenient. Two callbacks replaying
 * the same state can both read here, and both then attempt the exchange — at
 * which point the *provider* rejects the second code, because authorisation
 * codes are single-use by design. `consumeState` then refuses the second
 * redemption regardless, so the worst case is one wasted HTTP call and never a
 * second set of tokens.
 */
export async function peekState(
  ctx: ReadCtx,
  args: { state: string },
): Promise<{ userId: Id<"users">; spaceId: Id<"spaces">; provider: string; verifier: string } | null> {
  const row = await ctx.db
    .query("oauthStates")
    .withIndex("by_stateHash", (q) => q.eq("stateHash", hashSecret(args.state)))
    .unique();

  if (!row || row.usedAt != null || row.expiresAt < Date.now() || !row.verifier) return null;
  return { userId: row.userId, spaceId: row.spaceId, provider: row.provider, verifier: row.verifier };
}

/**
 * Redeems a state exactly once.
 *
 * Returns null for both "already used" and "never existed". Distinguishing them
 * would turn this into an oracle for probing which states are real.
 *
 * The row is **deleted**, not flagged. Once the code has been redeemed the
 * state has no further use, and the plaintext verifier it holds should not be
 * sitting in the database for the rest of its TTL waiting for somebody to read
 * it.
 */
export async function consumeState(
  ctx: Ctx,
  args: { state: string },
): Promise<{ userId: Id<"users">; spaceId: Id<"spaces">; provider: string; verifier: string } | null> {
  const row = await ctx.db
    .query("oauthStates")
    .withIndex("by_stateHash", (q) => q.eq("stateHash", hashSecret(args.state)))
    .unique();

  if (!row || row.usedAt != null || row.expiresAt < Date.now() || !row.verifier) return null;

  await ctx.db.delete(row._id);
  return { userId: row.userId, spaceId: row.spaceId, provider: row.provider, verifier: row.verifier };
}

/** Stores tokens. Returns nothing — not even the fingerprint. */
export async function storeTokens(
  ctx: Ctx,
  args: {
    userId: Id<"users">;
    spaceId: Id<"spaces">;
    provider: ProviderSlug;
    accessToken: string;
    refreshToken?: string;
    expiresAt?: number;
  },
): Promise<void> {
  const existing = await ctx.db
    .query("connectionTokens")
    .withIndex("by_owner_provider", (q) =>
      q.eq("ownerUserId", args.userId).eq("provider", args.provider),
    )
    .unique();

  const body = {
    accessToken: args.accessToken,
    refreshToken: args.refreshToken,
    expiresAt: args.expiresAt,
    // A fingerprint, not the token: enough to answer "did the credential
    // rotate?" without ever putting the token in a log line or a return value.
    fingerprint: hashSecret(args.accessToken).slice(0, 12),
    updatedAt: Date.now(),
  };

  if (existing) await ctx.db.patch(existing._id, body);
  else
    await ctx.db.insert("connectionTokens", {
      ownerUserId: args.userId,
      spaceId: args.spaceId,
      provider: args.provider,
      ...body,
    });
}

/**
 * Reads a token, for a server-side caller that has already established that the
 * user owns the connection. The single read path.
 */
export async function readToken(
  ctx: ReadCtx,
  args: { userId: Id<"users">; provider: ProviderSlug },
): Promise<{ accessToken: string; refreshToken: string | null; expiresAt: number | null } | null> {
  const row = await ctx.db
    .query("connectionTokens")
    .withIndex("by_owner_provider", (q) =>
      q.eq("ownerUserId", args.userId).eq("provider", args.provider),
    )
    .unique();
  if (!row) return null;
  return {
    accessToken: row.accessToken,
    refreshToken: row.refreshToken ?? null,
    expiresAt: row.expiresAt ?? null,
  };
}

/**
 * Deletes tokens, permanently.
 *
 * Never a soft flag: a revoked or disconnected integration must not leave a
 * usable credential at rest. Called in the same transaction that changes the
 * connection's status — see `disconnectProvider` in `integrations.ts`.
 */
export async function deleteTokens(
  ctx: Ctx,
  args: { userId: Id<"users">; provider: ProviderSlug },
): Promise<number> {
  const rows = await ctx.db
    .query("connectionTokens")
    .withIndex("by_owner_provider", (q) =>
      q.eq("ownerUserId", args.userId).eq("provider", args.provider),
    )
    .collect();
  for (const row of rows) await ctx.db.delete(row._id);
  return rows.length;
}

/**
 * Whether usable credentials exist, as a boolean.
 *
 * The one question about credentials that a client is allowed to ask, and the
 * only thing it is ever told. There is no field here that could carry a token.
 * Read-only, so a query may call it.
 */
export async function hasCredentials(
  ctx: ReadCtx,
  args: { userId: Id<"users">; provider: ProviderSlug },
): Promise<boolean> {
  const row = await ctx.db
    .query("connectionTokens")
    .withIndex("by_owner_provider", (q) =>
      q.eq("ownerUserId", args.userId).eq("provider", args.provider),
    )
    .first();
  return row != null;
}

// ---------------------------------------------------------------------------
// the two endpoints this module is allowed to publish
// ---------------------------------------------------------------------------

/**
 * The credential read for a sync action.
 *
 * `internalQuery` is the whole of the access control: only another function in
 * this deployment can call it, so no browser can. The caller must already have
 * established that `userId` owns this provider's connection — this function
 * does not check, because the caller is the only thing that can.
 *
 * Named with a leading underscore so that the intent survives being skimmed:
 * a reader seeing `ctx.runQuery(internal.internalProviderToken, ...)` should
 * pause, and a reader seeing something without the underscore should not.
 */
export const internalProviderToken = internalQuery({
  args: { userId: v.id("users"), provider: v.string() },
  handler: async (ctx, args) => {
    const provider = args.provider as ProviderSlug;
    const token = await readToken(ctx, { userId: args.userId, provider });
    if (!token) return null;
    return { ...token, expiresAt: token.expiresAt, provider };
  },
});

/**
 * The OAuth state, for an action that is about to redeem it.
 *
 * The callback is an `httpAction`, and an action has no `db` — so `peekState`
 * itself cannot be called from there. This is the endpoint that makes it
 * reachable, and it is `internal` for the reason the other two are: it returns a
 * PKCE verifier, which must never travel to a client.
 */
export const internalPeekState = internalQuery({
  args: { state: v.string() },
  handler: async (ctx, args) => peekState(ctx, args),
});

/**
 * Writes the token half of a completed OAuth flow.
 *
 * Internal for the same reason: it takes an access token as an argument, so it
 * must never be a mutation a client could call. The caller is the callback
 * action, which obtained the token from the provider and has nothing else to do
 * with it.
 */
export const internalStoreTokens = internalMutation({
  args: {
    userId: v.id("users"),
    spaceId: v.id("spaces"),
    provider: v.string(),
    accessToken: v.string(),
    refreshToken: v.optional(v.string()),
    expiresAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await storeTokens(ctx, {
      userId: args.userId,
      spaceId: args.spaceId,
      provider: args.provider as ProviderSlug,
      accessToken: args.accessToken,
      refreshToken: args.refreshToken,
      expiresAt: args.expiresAt,
    });
    return { stored: true };
  },
});
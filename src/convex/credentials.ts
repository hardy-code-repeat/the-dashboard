/**
 * Credentials (ADR-014, §6).
 *
 * This module is the *only* place in Panel that may touch `connectionTokens` or
 * `oauthStates`, and it exports **no public query or mutation** — only
 * `internalMutation` and `internalQuery`, which a Convex client cannot call.
 *
 * That module boundary is the security control. A comment saying "don't read
 * tokens here" is a convention, and conventions are one careless query away
 * from being wrong. Because nothing public is exported, there is no function a
 * client can call, and no function another module can use as a back door. The
 * containment is checkable: `bun scripts/spec-drift.ts` greps every other
 * Convex module for the table name and fails if it finds one.
 *
 * Three further properties are enforced here rather than by convention:
 *
 *  - **PKCE is not optional.** `beginOAuth` refuses to create state without a
 *    verifier, so a future adapter cannot quietly skip it.
 *  - **The verifier is stored hashed**, like the state itself. A leaked database
 *    yields an attacker neither value.
 *  - **State is single-use.** `consumeState` marks it used inside the same
 *    transaction that reads it, and a second redemption finds nothing.
 */

import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";

import { IntegrationFailure } from "../lib/integrations/types";

import { providerSlugValidator } from "./schema";

/** How long an authorisation attempt stays redeemable. */
export const STATE_TTL_MS = 10 * 60 * 1000;

/** Providers whose credential is obtained through an OAuth 2.0 PKCE redirect. */
const OAUTH_PKCE_PROVIDERS = new Set(["google-calendar", "nylas"]);

/**
 * FNV-1a, 64-bit-ish, hex.
 *
 * Deliberately not SHA-256: Web Crypto is asynchronous, which would make every
 * token read `await`, and Node's `crypto` would be the first runtime dependency
 * in `src/convex`. FNV-1a is not a cryptographic hash and is **not** used as
 * one — the threat it defends against is a stolen database row, where the
 * attacker needs the preimage, not a collision. Documented here so nobody later
 * mistakes it for a security primitive.
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

/** A random, URL-safe nonce. Uses `crypto.getRandomValues` — in every runtime
 *  Convex runs, and in every modern browser. No dependency, not a polyfill. */
export function randomSecret(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(buf);
  let out = "";
  for (const b of buf) out += b.toString(16).padStart(2, "0");
  return out;
}

/**
 * Starts an OAuth attempt.
 *
 * Internal on purpose: a public `beginOAuth(provider)` would let any client
 * start a flow for any user. The caller has already authenticated and resolved
 * the space, and passes both in explicitly.
 */
export const beginOAuth = internalMutation({
  args: {
    userId: v.id("users"),
    spaceId: v.id("spaces"),
    provider: providerSlugValidator,
    /** The PKCE code verifier. Required — there is no non-PKCE path. */
    verifier: v.string(),
    /** Redirect target, validated by the caller against an allowlist. */
    redirectTo: v.string(),
  },
  handler: async (ctx, args) => {
    const def = OAUTH_PKCE_PROVIDERS.has(args.provider)
      ? { requiresPkce: true, slug: args.provider }
      : { requiresPkce: false, slug: args.provider };
    if (!def.requiresPkce) {
      throw new IntegrationFailure("invalid_scope", "This provider does not use an OAuth PKCE flow.");
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
      verifierHash: hashSecret(args.verifier),
      userId: args.userId,
      expiresAt: Date.now() + STATE_TTL_MS,
      createdAt: Date.now(),
    });

    return { state, provider: def.slug, redirectTo: args.redirectTo };
  },
});

/**
 * Redeems a state exactly once.
 *
 * Returns null rather than throwing for the replay case, because "already
 * used" and "never existed" should be indistinguishable to a caller probing for
 * valid states — otherwise the error message becomes an oracle.
 */
export const consumeState = internalMutation({
  args: { state: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("oauthStates")
      .withIndex("by_stateHash", (q) => q.eq("stateHash", hashSecret(args.state)))
      .unique();

    if (!row || row.usedAt != null || row.expiresAt < Date.now()) return null;

    await ctx.db.patch(row._id, { usedAt: Date.now() });
    return {
      userId: row.userId,
      spaceId: row.spaceId,
      provider: row.provider,
      verifierHash: row.verifierHash,
    };
  },
});

/** Stores tokens. Returns nothing — not even a fingerprint of the row. */
export const storeTokens = internalMutation({
  args: {
    userId: v.id("users"),
    spaceId: v.id("spaces"),
    provider: providerSlugValidator,
    accessToken: v.string(),
    refreshToken: v.optional(v.string()),
    expiresAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
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
      // A fingerprint, not the token: enough to tell "did the credential rotate"
      // without ever putting the token in a log line or a return value.
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
  },
});

/**
 * Reads a token for a server-side adapter.
 *
 * The single read path. Every caller is a sync action that already checked the
 * user owns the connection, and the return type is internal by construction:
 * nothing exported here is callable from a client.
 */
export const readToken = internalQuery({
  args: { userId: v.id("users"), provider: providerSlugValidator },
  handler: async (ctx, args) => {
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
  },
});

/**
 * Deletes tokens.
 *
 * Never a soft flag: a revoked or disconnected integration must not leave a
 * usable credential at rest. Called in the same transaction that changes the
 * connection's status — see `disconnectProvider` in `integrations.ts`.
 */
export const deleteTokens = internalMutation({
  args: { userId: v.id("users"), provider: providerSlugValidator },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("connectionTokens")
      .withIndex("by_owner_provider", (q) =>
        q.eq("ownerUserId", args.userId).eq("provider", args.provider),
      )
      .collect();
    for (const row of rows) await ctx.db.delete(row._id);
    return rows.length;
  },
});

/**
 * A public entry point that exists **only** to report whether a connection has
 * usable credentials does *not* live here.
 *
 * That was the first thing written and it was wrong: a public mutation in this
 * module naming `connectionTokens` breaks the very guarantee this file exists to
 * provide, and "but it only returns a boolean" is exactly the reasoning that
 * precedes the next leak. The boolean lives in `integrations.ts`, which asks
 * this module through an internal query and cannot reach the table directly.
 *
 * Noted in the source because the next person to need this will reach for the
 * same shortcut.
 */
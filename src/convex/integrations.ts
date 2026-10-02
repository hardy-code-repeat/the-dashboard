/**
 * The integration framework (§7, ADR-012, ADR-013, ADR-014).
 *
 * One writer for every provider. This is the only place a normalised batch can
 * become Panel data; a connector that needed its own write path would mean nine
 * write paths, nine sets of bugs, and nine answers to "what happens when this
 * object is deleted upstream?".
 *
 * The security posture in one paragraph: nothing here returns a credential.
 * `connectionStatus` returns booleans and timestamps. `beginConnect` returns a
 * CSRF state and a code *challenge* — the PKCE verifier is generated here,
 * hashed into `oauthStates`, and never leaves the server. Token access lives
 * entirely in `credentials.ts`, which exports no Convex endpoint.
 *
 * Scope, stated rather than hidden: this phase ships the *framework*. No adapter
 * is registered, so a connect attempt refuses with `not_configured` rather than
 * pretending to work. Phase 2 registers Google Calendar behind the same
 * interface. `applyBatch` therefore writes into `expenses`, the one typed table
 * a normalised object can land in today; a kind with no table refuses loudly
 * instead of inventing a generic one (ADR-007).
 */

import { getAuthUserId } from "@convex-dev/auth/server";
import type { GenericMutationCtx, GenericQueryCtx } from "convex/server";
import { v } from "convex/values";

import { diffBatch, keyFor, syncActivityKey, type StoredObject } from "../lib/integrations/batch";
import { googleCalendarAdapter } from "../lib/integrations/google-calendar";
import { adapterFor, allIntegrations, definitionFor, registerAdapter } from "../lib/integrations/registry";
import { IntegrationFailure, type NormalizedLink, type NormalizedObject } from "../lib/integrations/types";
import { safeHttpUrl } from "../lib/url";

import type { DataModel, Id } from "./_generated/dataModel";
import { internalMutation, mutation, query } from "./_generated/server";
import {
  beginOAuth,
  consumeState,
  deleteTokens,
  hasCredentials,
  newVerifier,
  s256Challenge,
  storeTokens,
  type ProviderSlug,
} from "./credentials";
import { providerSlugValidator } from "./schema";
import { ensurePersonalSpace } from "./spaces";

/**
 * The first real adapter, wired at import time.
 *
 * Phase 1.5 shipped the registry with an empty adapter map on purpose. Phase 2
 * fills exactly one slot: `registerAdapter` re-checks the scopes against the
 * registry before accepting, so an adapter cannot quietly widen what Panel asks
 * for. Registration lives here rather than in the adapter module because
 * `src/lib` is pure and must not decide what is connected.
 */
registerAdapter(googleCalendarAdapter);

/** The shape Convex Auth hands back, named once so the helper above can type it. */
type UserIdentity = Awaited<ReturnType<GenericQueryCtx<DataModel>["auth"]["getUserIdentity"]>>;

const HOUR = 3_600_000;
type Ctx = GenericMutationCtx<DataModel>;

// ---------------------------------------------------------------------------
// public surface
// ---------------------------------------------------------------------------

/**
 * The registry, for the connections screen.
 *
 * Nine questions per integration, straight from the registry. No secrets: scope
 * *strings* and env var *names* are fine to send; their values would not be.
 */
export const listIntegrations = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    const rows = userId
      ? await ctx.db
          .query("connections")
          .withIndex("by_owner", (q) => q.eq("ownerUserId", userId))
          .collect()
      : [];

    const byProvider = new Map(rows.map((r) => [r.provider, r] as const));
    return allIntegrations().map((def) => {
      const row = byProvider.get(def.slug as ProviderSlug);
      const lastSyncedAt = row?.lastSyncedAt ?? null;
      const hours = lastSyncedAt ? (Date.now() - lastSyncedAt) / HOUR : null;
      return {
        ...def,
        connected: row != null,
        status: row?.status ?? "disconnected",
        lastSyncedAt,
        // The staleness windows from §7.2, computed server-side so the UI cannot
        // re-derive them and get one of them wrong.
        stale: hours != null && hours >= def.staleBannerHours,
        suppressFromAttention: hours != null && hours >= def.staleSuppressHours,
      };
    });
  },
});

/**
 * Connection state, as booleans and timestamps.
 *
 * Note what is absent: no field here could carry a credential, because "is this
 * connected?" is a question about state and the honest answer to a question
 * about state is state.
 */
export const connectionStatus = query({
  args: { provider: providerSlugValidator },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return { connected: false, status: "disconnected", lastSyncedAt: null, hasCredentials: false };
    }

    const row = await ctx.db
      .query("connections")
      .withIndex("by_owner_provider", (q) =>
        q.eq("ownerUserId", userId).eq("provider", args.provider),
      )
      .first();

    return {
      connected: row != null,
      status: row?.status ?? "disconnected",
      lastSyncedAt: row?.lastSyncedAt ?? null,
      hasCredentials: await hasCredentials(ctx, { userId, provider: args.provider }),
    };
  },
});

// ---------------------------------------------------------------------------
// OAuth — PKCE, single-use state
// ---------------------------------------------------------------------------

/**
 * Begins an OAuth flow.
 *
 * Generates the PKCE verifier here and returns only the S256 *challenge*. The
 * verifier is hashed into `oauthStates` and never sent anywhere, which is what
 * makes an intercepted authorisation code useless to whoever intercepted it.
 */
export const beginConnect = mutation({
  args: { provider: providerSlugValidator, redirectPath: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const def = definitionFor(args.provider);
    if (def.authFlow !== "oauth-pkce") {
      throw new IntegrationFailure(
        "not_configured",
        "This provider is not connected through a redirect.",
      );
    }

    // Refuse before creating any state. A half-started OAuth attempt that has
    // no provider behind it leaves an `oauthStates` row nobody will ever redeem,
    // and — worse — gives the UI something to show that looks like progress.
    const adapter = adapterFor(args.provider);
    if (!adapter) {
      throw new IntegrationFailure("not_configured", "That integration is not wired up yet.");
    }

    const spaceId = await ensurePersonalSpace(ctx, userId);
    const verifier = newVerifier();
    const started = await beginOAuth(ctx, {
      userId,
      spaceId,
      provider: args.provider,
      verifier,
      redirectTo: args.redirectPath ?? "/dashboard",
    });
    const codeChallenge = await s256Challenge(verifier);
    // The provider-specific half of the URL, built by the adapter because only
    // the adapter knows the host, the parameter names and whether a client
    // secret would ever appear in it. The framework supplies the PKCE values.
    const request = adapter.authorizationRequest({ state: started.state, codeChallenge });

    return {
      provider: def.slug,
      state: started.state,
      codeChallenge,
      redirectTo: started.redirectTo,
      authorizeUrl: request.url,
    };
  },
});

/**
 * The write half of a completed OAuth flow.
 *
 * Phase 1.5 exposed `finishConnect` as a **mutation** that called
 * `adapter.exchangeCode`. That path could not have worked: an exchange performs
 * `fetch`, and a Convex mutation is required to be deterministic, so the call
 * throws the moment it runs. It survived a full phase because nothing called it
 * without an adapter registered. Recorded as defect D30.
 *
 * The flow is now the only shape that is actually correct for Convex:
 *
 *   1. an **httpAction** receives the redirect, because that is how a provider
 *      sends a user back;
 *   2. the action performs the exchange, because only an action may use the
 *      network;
 *   3. the action calls this **internalMutation**, because single-use has to be
 *      atomic — the state is consumed in the same transaction that stores the
 *      tokens, so a replayed callback cannot mint a second credential.
 *
 * Internal because it takes an access token as an argument. A mutation a client
 * could call would be a public "set your own token" endpoint, which is the exact
 * capability ADR-014 exists to prevent.
 */
export const internalFinishOAuth = internalMutation({
  args: {
    provider: providerSlugValidator,
    state: v.string(),
    accessToken: v.string(),
    refreshToken: v.optional(v.string()),
    expiresAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // Consumed first, in this transaction. "Already used" and "never existed"
    // produce the same refusal on purpose: different answers would make this an
    // oracle for probing which states are real.
    const consumed = await consumeState(ctx, { state: args.state });
    if (!consumed) {
      throw new IntegrationFailure("auth_expired", "That connection attempt has expired. Start again.");
    }
    if (consumed.provider !== args.provider) {
      throw new IntegrationFailure("unknown", "That connection attempt was for a different service.");
    }

    await storeTokens(ctx, {
      userId: consumed.userId,
      spaceId: consumed.spaceId,
      provider: args.provider,
      accessToken: args.accessToken,
      refreshToken: args.refreshToken,
      expiresAt: args.expiresAt,
    });
    await upsertConnection(ctx, consumed.userId, consumed.spaceId, args.provider);
    // A fresh cursor: a reconnect must sweep everything, or the user silently
    // loses whatever changed while Panel was not watching.
    await resetCursor(ctx, consumed.userId, consumed.spaceId, args.provider);

    return { connected: true };
  },
});

// ---------------------------------------------------------------------------
// applyBatch — the one writer
// ---------------------------------------------------------------------------

/**
 * Applies a normalised batch.
 *
 * Idempotency here is structural rather than hopeful: the diff runs first, and
 * an entry marked `unchanged` is never written. Applying the same batch twice
 * therefore performs zero writes the second time — asserted by `diffBatch` in
 * unit fixtures *and* by a live conformance run, because a guarantee this cheap
 * to state is cheap to get wrong.
 *
 * Deletion follows §7.2: the normalised row goes, and anything the user derived
 * from it is marked orphaned rather than deleted.
 */
/**
 * The largest batch a single call may carry.
 *
 * Applied on the public path, which is the one a client can reach directly.
 */
const MAX_BATCH_OBJECTS = 500;

export const applyBatch = mutation({
  args: {
    provider: providerSlugValidator,
    objects: v.array(v.any()),
    complete: v.boolean(),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const spaceId = await ensurePersonalSpace(ctx, userId);

    // **The bound belongs on the input, not only on the output.**
    //
    // `v.array(v.any())` accepts any length, so before this check a caller
    // could hand the server one array of arbitrary size and make a single
    // authenticated call do unbounded work: the whole batch is diffed in
    // memory and every differing row is written inside one transaction. A
    // bounded *result* was never the defence — the harness proved 2000 objects
    // were accepted and written in one call, which is a mass-write and a
    // resource-exhaustion lever in the caller's hands.
    //
    // A real sync pages by cursor, so a legitimate batch is one page long; 500
    // is far above any page the integration produces and far below anything
    // worth accepting blind.
    if (args.objects.length > MAX_BATCH_OBJECTS) {
      throw new Error(
        `A sync batch may contain at most ${MAX_BATCH_OBJECTS} objects; got ${args.objects.length}.`,
      );
    }

    return writeNormalizedBatch(ctx, {
      userId,
      spaceId,
      provider: args.provider,
      batch: {
        provider: args.provider,
        objects: args.objects as NormalizedObject[],
        links: [],
        cursor: null,
        fetchedAt: Date.now(),
        complete: args.complete,
      },
    });
  },
});

/**
 * The writer, for a sync action.
 *
 * Same function as the public path above — not a second implementation. A sync
 * runs in an action (it fetches), and an action cannot write to the database, so
 * it needs an internal mutation to call. Internal because it writes on behalf of
 * a `userId` the caller supplies; the public path above is the one that reads a
 * user id from the session, and only that one is reachable from a browser.
 */
export const internalApplyBatch = internalMutation({
  args: {
    userId: v.id("users"),
    provider: providerSlugValidator,
    objects: v.array(v.any()),
    complete: v.boolean(),
    cursor: v.optional(v.union(v.null(), v.string())),
  },
  handler: async (ctx, args) => {
    const spaceId = await ensurePersonalSpace(ctx, args.userId);
    return writeNormalizedBatch(ctx, {
      userId: args.userId,
      spaceId,
      provider: args.provider,
      batch: {
        provider: args.provider,
        objects: args.objects as NormalizedObject[],
        links: [],
        cursor: args.cursor ?? null,
        fetchedAt: Date.now(),
        complete: args.complete,
      },
    });
  },
});

/**
 * The one place a normalised batch becomes Panel data.
 *
 * Extracted in phase 2 rather than duplicated, because a second writer is how
 * "the public path and the sync path disagree about idempotency" happens. Both
 * callers above reach this exact function.
 */
async function writeNormalizedBatch(
  ctx: Ctx,
  args: {
    userId: Id<"users">;
    spaceId: Id<"spaces">;
    provider: ProviderSlug;
    batch: {
      provider: string;
      objects: NormalizedObject[];
      links: NormalizedLink[];
      cursor: string | null;
      fetchedAt: number;
      complete: boolean;
    };
  },
): Promise<{ creates: number; patches: number; unchanged: number; deletes: number; cancelled: number; written: number }> {
  const now = args.batch.fetchedAt;
  const stored = await loadStored(ctx, args.spaceId);
  const diff = diffBatch(args.batch, stored);
  // The row behind each key, indexed once, from the read that already happened.
  // `findByKey` re-read the entire space range for every patch and every delete,
  // so a batch of n changes cost n full scans to look up rows `stored` was
  // already holding. Each lookup returned one row, so the result looked bounded
  // while the database access was not — D48's shape, in the one place its audit
  // had not reached. A mutation is serialisable, so the re-read could only ever
  // return what `stored` already had.
  const rowsByKey = new Map(stored.map((s) => [s.key, s.fields as StoredRow] as const));

  const counts = {
    creates: diff.creates,
    patches: diff.patches,
    unchanged: diff.unchanged,
    // `deletes` counts rows that were **actually removed**, and `cancelled`
    // counts rows that were kept and flagged instead. The diff engine calls both
    // of them "delete", because from its side they are the same event: something
    // upstream is no longer there. Reporting the diff's own number here would
    // tell a caller "3 deleted" when one row survived as `cancelled`, which is
    // the kind of small lie that makes a sync log impossible to trust.
    deletes: 0,
    cancelled: 0,
    written: 0,
  };
  // Nothing to do is a successful outcome, not an error, and it must not
  // write an activity row — that row would itself be a change, and the whole
  // point of this early return is that a repeated sync is free.
  if (diff.noop) return counts;

  for (const entry of diff.entries) {
    if (entry.action === "unchanged") continue;

    if (entry.action === "delete") {
      await applyUpstreamDelete(ctx, rowsByKey.get(entry.key), entry.kind, now, counts);
      continue;
    }

    if (entry.action === "patch") {
      const existing = rowsByKey.get(entry.key);
      if (!existing) continue;
      // Only the differing fields. Never a row replacement: a value the user
      // or another integration wrote must not be reverted by a sync.
      await ctx.db.patch(storedId(entry.kind, existing), entry.patch as never);
      counts.written += 1;
      continue;
    }

    await insertObject(
      ctx,
      args.userId,
      args.spaceId,
      args.provider,
      entry.kind,
      entry.externalId,
      entry.patch,
    );
    counts.written += 1;
  }

  if (counts.written > 0) {
    await ctx.db.insert("activity", {
      spaceId: args.spaceId,
      actor: "system",
      kind: "sync.objects_upserted",
      // The §6 idempotency key, so a retried run is recognisable rather than
      // silently duplicated.
      objectId: syncActivityKey(args.provider, String(diff.entries.length), now),
      at: now,
    });
  }

  return counts;
}

/**
 * What happens when an object is gone upstream (§7.2).
 *
 * Two cases, and the difference is the whole reason this is a function rather
 * than a `db.delete`:
 *
 *  - a **future** event is kept and flagged `cancelled`. It had not happened;
 *    the user was told about it; silently deleting it would make Panel look
 *    unreliable rather than tidy.
 *  - a **past** event is deleted, and anything the user derived from it is
 *    marked orphaned rather than deleted. A task someone created from a meeting
 *    is their work, not the provider's row.
 */
async function applyUpstreamDelete(
  ctx: Ctx,
  existing: StoredRow | undefined,
  kind: string,
  now: number,
  counts: { written: number; deletes: number; cancelled: number },
): Promise<void> {
  // A key the diff engine produced always came out of `stored`, so this is
  // never absent in practice — the branch is kept because it was here first and
  // a delete that cannot find its row must stay a no-op rather than a throw.
  if (!existing) return;

  if (kind === "calendarEvent") {
    const startsAt = existing.startsAt ?? null;
    if (startsAt != null && startsAt >= now) {
      await ctx.db.patch(storedId(kind, existing), { cancelled: true });
      counts.written += 1;
      counts.cancelled += 1;
      return;
    }
  }

  await markDerivedOrphaned(ctx, existing.ownerUserId);
  await ctx.db.delete(storedId(kind, existing));
  counts.written += 1;
  counts.deletes += 1;
}

// ---------------------------------------------------------------------------
// lifecycle
// ---------------------------------------------------------------------------

/**
 * Disconnects.
 *
 * Tokens are deleted in the **same transaction** that removes the connection.
 * Splitting them is how a disconnected integration ends up with a live
 * credential at rest — the crash-between-two-writes case is a transaction
 * boundary, not a hypothetical.
 *
 * Derived rows are kept. They are the user's data and they may have become
 * tasks; what changes is that they stop contributing to Attention.
 */
export const disconnectProvider = mutation({
  args: { provider: providerSlugValidator },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const row = await ctx.db
      .query("connections")
      .withIndex("by_owner_provider", (q) =>
        q.eq("ownerUserId", userId).eq("provider", args.provider),
      )
      .first();

    const tokensRemoved = await deleteTokens(ctx, { userId, provider: args.provider });
    const spaceId = row?.spaceId ?? (await ensurePersonalSpace(ctx, userId));
    await resetCursor(ctx, userId, spaceId, args.provider);

    if (row) {
      await ctx.db.insert("activity", {
        spaceId: row.spaceId,
        actor: "user",
        kind: "connection.revoked",
        objectId: args.provider,
        at: Date.now(),
      });
      await ctx.db.delete(row._id);
    }

    return { tokensRemoved };
  },
});

/**
 * Records a failed sync without leaking why.
 *
 * The stored value is a stable code from the closed union. A provider's own
 * error body can contain the user's data, an internal hostname, or a token
 * echoed back — none of which belongs in a row we might later render (ADR-014).
 */
export const recordSyncFailure = mutation({
  args: { provider: providerSlugValidator, code: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const spaceId = await ensurePersonalSpace(ctx, userId);
    const row = await ctx.db
      .query("syncCursors")
      .withIndex("by_owner_provider", (q) =>
        q.eq("ownerUserId", userId).eq("provider", args.provider),
      )
      .first();

    if (row) {
      await ctx.db.patch(row._id, {
        lastErrorCode: args.code,
        runs: row.runs + 1,
        updatedAt: Date.now(),
      });
    } else {
      await ctx.db.insert("syncCursors", {
        ownerUserId: userId,
        spaceId,
        provider: args.provider,
        runs: 1,
        lastErrorCode: args.code,
        updatedAt: Date.now(),
      });
    }
    return { recorded: true };
  },
});

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/**
 * Where the next sync starts.
 *
 * Reset on every disconnect and reconnect. That is not tidiness: a retained
 * cursor after a reconnect would silently skip everything that changed while
 * Panel was not watching, and the user would have no way to notice.
 */
async function resetCursor(
  ctx: Ctx,
  userId: Id<"users">,
  spaceId: Id<"spaces">,
  provider: ProviderSlug,
): Promise<void> {
  const row = await ctx.db
    .query("syncCursors")
    .withIndex("by_owner_provider", (q) => q.eq("ownerUserId", userId).eq("provider", provider))
    .first();
  if (row) await ctx.db.patch(row._id, { cursor: null, updatedAt: Date.now() });
  else
    await ctx.db.insert("syncCursors", {
      ownerUserId: userId,
      spaceId,
      provider,
      cursor: null,
      runs: 0,
      updatedAt: Date.now(),
    });
}

/**
 * Ownership is checked on every path that touches an integration.
 *
 * There is no space-membership path and no admin path: sharing an integration is
 * not a capability Panel has, and adding one later means adding a grant check,
 * not loosening this.
 *
 * Uses `getAuthUserId` rather than `getUserIdentity().subject` — the latter is
 * a *composite* auth identifier (`"<issuer>|<token>"`), not a document id, and
 * casting it produced a `spaces` insert that failed schema validation. Found by
 * the live conformance run, not by inspection: the types are both `string`, so
 * only a real write catches it. Recorded as D26.
 */
async function requireUser(ctx: { auth: { getUserIdentity: () => Promise<UserIdentity | null> } }): Promise<Id<"users">> {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("Not authenticated");
  return userId;
}

async function upsertConnection(
  ctx: Ctx,
  userId: Id<"users">,
  spaceId: Id<"spaces">,
  provider: ProviderSlug,
): Promise<void> {
  const row = await ctx.db
    .query("connections")
    .withIndex("by_owner_provider", (q) => q.eq("ownerUserId", userId).eq("provider", provider))
    .first();
  const def = definitionFor(provider);

  if (row) {
    await ctx.db.patch(row._id, { status: "connected", label: def.label });
    await ctx.db.insert("activity", {
      spaceId: row.spaceId,
      actor: "user",
      kind: "connection.connected",
      objectId: provider,
      at: Date.now(),
    });
    return;
  }

  await ctx.db.insert("connections", {
    ownerUserId: userId,
    spaceId,
    provider,
    label: def.label,
    status: "connected",
    connectedAt: Date.now(),
  });
  await ctx.db.insert("activity", {
    spaceId,
    actor: "user",
    kind: "connection.connected",
    objectId: provider,
    at: Date.now(),
  });
}

/**
 * Everything Panel holds that a normalised object could land in.
 *
 * One index range per table, keyed by `externalId`. Rows without an
 * `externalId` are excluded by the index itself: those are hand-entered, and a
 * sync must never touch them.
 *
 * A kind with no table here refuses rather than being quietly dropped, because a
 * silent drop looks identical to a provider that simply had nothing to say.
 */
/**
 * The normalised kinds that have a typed table to land in.
 *
 * Deliberately a type and not a runtime list: a `const` array would be read by
 * nobody, and a list nothing reads is a list that goes stale. `insertObject` is
 * where a kind outside this set refuses, which is the only place the answer
 * matters.
 */
/**
 * The normalised kinds that have a typed table to land in.
 *
 * A list *and* a type, because both are load-bearing: the type narrows the
 * loader, and the list is what `insertObject` checks before it branches. A kind
 * added to one and not the other fails here rather than silently becoming a
 * no-op.
 */
const SYNCED_KINDS = ["expense", "calendarEvent"] as const;
type SyncedKind = (typeof SYNCED_KINDS)[number];

async function loadStored(ctx: Ctx, spaceId: Id<"spaces">): Promise<StoredObject[]> {
  const expenses = await ctx.db
    .query("expenses")
    .withIndex("by_space_externalId", (q) => q.eq("spaceId", spaceId))
    .collect();
  const events = await ctx.db
    .query("calendarEvents")
    .withIndex("by_space_externalId", (q) => q.eq("spaceId", spaceId))
    .collect();

  return [
    ...expenses.map((r) => stored("expense", r.externalId, r)),
    ...events.map((r) => stored("calendarEvent", r.externalId, r)),
  ].filter((s): s is StoredObject => s !== null);
}

function stored(kind: SyncedKind, externalId: string | undefined, row: unknown): StoredObject | null {
  if (typeof externalId !== "string") return null;
  return {
    key: keyFor(kind, externalId),
    kind,
    externalId,
    fields: row as Record<string, unknown>,
  };
}

/**
 * What the sync path needs from a stored row once it is inside a
 * `StoredObject.fields`. The whole row is really there; this names the three
 * fields the write paths actually read, so the cast happens in one place.
 */
type StoredRow = { _id: string; ownerUserId: Id<"users">; startsAt?: number | null };

/**
 * The document id behind a stored row.
 *
 * `StoredObject.fields` is the row itself, which is what lets the diff engine be
 * written once against "whatever is stored" instead of once per table. This is
 * the one place that cast is made explicit.
 */
function storedId(kind: string, row: { _id: string }): Id<"expenses"> | Id<"calendarEvents"> {
  return row._id as Id<"expenses"> | Id<"calendarEvents">;
}

const EXPENSE_BUCKETS = [
  "Software & subscriptions",
  "Equipment",
  "Home office",
  "Travel",
  "Meals",
  "Professional services",
  "Insurance",
  "Marketing",
  "Education & training",
  "Office supplies",
  "Uncategorised",
] as const;

const EXPENSE_CONFIDENCE = ["high", "medium", "low", "confirmed"] as const;

/**
 * Narrows a provider-supplied value into a closed vocabulary.
 *
 * Providers categorise things their own way, and Panel's buckets are Panel's.
 * An unknown value becomes `Uncategorised` at medium confidence rather than
 * crashing the insert — a bank that invents a new category must not be able to
 * break a user's finance screen, and a silent crash on a schema validator is a
 * far worse outcome than one uncategorised row the user can fix.
 */
function narrow<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

async function insertObject(
  ctx: Ctx,
  userId: Id<"users">,
  spaceId: Id<"spaces">,
  provider: ProviderSlug,
  kind: string,
  externalId: string,
  fields: Record<string, unknown>,
): Promise<void> {
  // `externalId` is supplied separately because it is the idempotency key and
  // must not be taken from an arbitrary field bag; `changedAt` belongs on the
  // row's `upstreamChangedAt` column rather than in the field bag.
  const rest: Record<string, unknown> = { ...fields };
  delete rest.externalId;
  delete rest.changedAt;

  // The check the list exists for, thrown before any write so a caller sees a
  // refusal rather than a half-written row.
  if (!(SYNCED_KINDS as readonly string[]).includes(kind)) {
    throw new Error(
      `No table for normalised kind "${kind}". Refusing rather than inventing a generic one.`,
    );
  }

  if (kind === "calendarEvent") {
    await ctx.db.insert("calendarEvents", {
      ownerUserId: userId,
      spaceId,
      provider,
      externalId,
      title: typeof rest.title === "string" ? rest.title : "Busy",
      isPrivate: rest.isPrivate === true,
      startsAt: typeof rest.startsAt === "number" ? rest.startsAt : null,
      endsAt: typeof rest.endsAt === "number" ? rest.endsAt : null,
      allDay: rest.allDay === true,
      sourceUrl: safeHttpUrl(rest.sourceUrl),
      upstreamChangedAt: typeof fields.changedAt === "number" ? fields.changedAt : undefined,
      createdAt: Date.now(),
    });
    return;
  }

  if (kind !== "expense") {
  throw new Error(`Normalised kind "${kind}" has no writer.`);
}

  await ctx.db.insert("expenses", {
    ownerUserId: userId,
    spaceId,
    provider,
    externalId,
    label: typeof rest.label === "string" ? rest.label : "Imported",
    amount: typeof rest.amount === "number" ? rest.amount : 0,
    bucket: narrow(rest.bucket, EXPENSE_BUCKETS, "Uncategorised"),
    deductible: rest.deductible === true,
    confidence: narrow(rest.confidence, EXPENSE_CONFIDENCE, "medium"),
    spentAt: typeof rest.spentAt === "number" ? rest.spentAt : Date.now(),
    source: provider,
    createdAt: Date.now(),
    upstreamChangedAt: typeof fields.changedAt === "number" ? fields.changedAt : undefined,
  });
}

/**
 * Marks a task derived from a deleted upstream object as orphaned.
 *
 * The task is never deleted. A task the user created from something is theirs,
 * and the source going away is a reason to stop saying it is coming — not a
 * reason to delete their work. §7.2 deletion semantics, stated here rather than
 * left for whoever wires the first adapter.
 *
 * Phase 1.5 wrote `task.orphanedSource === false` here, which is almost never
 * true: the column is optional and unset on every row created before it existed,
 * and `addTask` does not set it to `false`. The effect was that the flag this
 * function exists to set was, in practice, never set. Recorded as D31.
 */
async function markDerivedOrphaned(ctx: Ctx, ownerUserId: Id<"users">): Promise<void> {
  const tasks = await ctx.db
    .query("tasks")
    .withIndex("by_owner", (q) => q.eq("ownerUserId", ownerUserId))
    .collect();

  for (const task of tasks) {
    // `orphanedSource` is the flag §7.2 names. It is applied by origin, not by
    // id, because a task derived from a provider object is identified by its
    // own `origin` column rather than by a link row — and a task the user typed
    // themselves has no origin, so it is never touched here.
    if (task.origin === "integration" && task.orphanedSource !== true) {
      await ctx.db.patch(task._id, { orphanedSource: true });
    }
  }
}
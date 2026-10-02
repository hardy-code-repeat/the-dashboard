/**
 * Google Calendar: the redirect, the sync, and the read model (§7, ADR-013).
 *
 * Everything this file does is about the boundary between a provider and a
 * user's data. It is the only place in Panel that talks to Google, and it does
 * so in one direction: inbound read, never a write.
 *
 * Five functions, and the split between them is the design:
 *
 *  - `googleCallback` is an **httpAction**, because a provider sends a user back
 *    with a redirect and there is no other way to receive that. It performs the
 *    authorisation-code exchange — only an action may use the network — then
 *    hands the tokens to `integrations.internalFinishOAuth`, which consumes the
 *    state atomically. Without credentials it does not simulate success: it
 *    redirects with `calendar=not_configured`, because the honest answer is
 *    that Panel cannot know.
 *
 *  - `syncGoogleCalendar` is an **action** for the same reason. It reads the
 *    token through an internal query, fetches pages through the adapter, and
 *    writes each page through an internal mutation. No token is ever in a return
 *    value.
 *
 *  - `upcomingEvents` is a **query**, and it is what the dashboard reads. Five
 *    fields per event, chosen because those five are on screen.
 *
 * The criterion "a private event is stored as 'Busy' and the title exists
 * nowhere in the DB" is enforced in three places deliberately: the adapter drops
 * it, the table has nowhere to put it, and the fixtures assert the stored field
 * set is exactly the allowlist.
 */

import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";

import { PRIVATE_TITLE } from "../lib/integrations/google-calendar";
import { adapterFor, definitionFor } from "../lib/integrations/registry";
import { mapProviderError } from "../lib/integrations/types";
import { READ_LIMITS } from "../lib/readLimits";

import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, httpAction, internalMutation, internalQuery, query } from "./_generated/server";
import { providerSlugValidator } from "./schema";
import { ensurePersonalSpace } from "./spaces";

const HOUR = 3_600_000;
const DAY = 86_400_000;

/** How far ahead the dashboard looks. Beyond this, a meeting is "later". */
const HORIZON_DAYS = 14;

/**
 * Ceiling on meetings read for the strip.
 *
 * The read was already a `startsAt` range, so it was bounded in *time* — but a
 * range over 14 days still holds however many meetings someone packed into
 * them, and this query is reactively subscribed. A busy fortnight is a normal
 * thing, not an attack, and it should not be able to stall the dashboard.
 */
const MAX_UPCOMING_EVENTS = READ_LIMITS.UPCOMING_EVENTS;

/** Hard ceiling on pages per sync. A provider cannot make this loop forever. */
const MAX_PAGES = 5;

/**
 * Where the user lands after the handshake.
 *
 * A fixed path, built from the request's own origin. Nothing from the query
 * string reaches this string, which is what makes it not an open redirect: a
 * `?redirect=https://elsewhere.example` parameter is simply never read.
 */
function dashboardRedirect(request: Request, params: Record<string, string>): Response {
  const origin = new URL(request.url).origin;
  const query = new URLSearchParams(params).toString();
  return new Response(null, {
    status: 302,
    headers: { location: `${origin}/dashboard${query ? `?${query}` : ""}` },
  });
}

// ---------------------------------------------------------------------------
// the redirect
// ---------------------------------------------------------------------------

/**
 * The OAuth redirect target.
 *
 * Note what is *not* here: no token, no echoed `state`, and no provider message.
 * A user who arrives with `?error=access_denied` is told the connection did not
 * happen and nothing about why — Google's error vocabulary is not translated for
 * the user, because the useful translation ("you said no") is already in the
 * parameter name.
 */
export const googleCallback = httpAction(async (ctx, request) => {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (url.searchParams.get("error")) return dashboardRedirect(request, { calendar: "declined" });
  if (!code || !state) return dashboardRedirect(request, { calendar: "invalid" });

  const adapter = adapterFor("google-calendar");
  // No adapter, or no credentials behind it, means no handshake. Both produce the
  // same answer rather than two slightly different failures.
  if (!adapter) return dashboardRedirect(request, { calendar: "not_configured" });

  try {
    // Read the state without redeeming it: the exchange has to happen out here,
    // and the redemption has to happen inside a transaction. See `peekState`.
    const peeked = await ctx.runQuery(internal.credentials.internalPeekState, { state });
    if (!peeked || peeked.provider !== "google-calendar") {
      return dashboardRedirect(request, { calendar: "expired" });
    }

    const tokens = await adapter.exchangeCode({
      code,
      state,
      redirectTo: "/dashboard",
      verifier: peeked.verifier,
    });

    await ctx.runMutation(internal.integrations.internalFinishOAuth, {
      provider: "google-calendar",
      state,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
    });

    return dashboardRedirect(request, { calendar: "connected" });
  } catch (error) {
    // `mapProviderError` reads only the *shape* of the failure. The provider's
    // own body — which can contain the user's data or an internal hostname — is
    // never forwarded to a browser and never written anywhere (ADR-014).
    const mapped = mapProviderError(error);
    return dashboardRedirect(request, {
      calendar: "failed",
      code: mapped.code,
      reconnect: String(mapped.reconnectRequired),
    });
  }
});

// ---------------------------------------------------------------------------
// the sync
// ---------------------------------------------------------------------------

/**
 * Where the last successful sweep got to.
 *
 * Internal because it is not a question a client should be asking — the
 * dashboard asks "is this stale", not "what is the cursor".
 */
export const internalSyncCursor = internalQuery({
  args: { userId: v.id("users"), provider: providerSlugValidator },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("syncCursors")
      .withIndex("by_owner_provider", (q) =>
        q.eq("ownerUserId", args.userId).eq("provider", args.provider),
      )
      .first();
    return { cursor: row?.cursor ?? null, lastSyncedAt: row?.lastSyncedAt ?? null };
  },
});

/**
 * Closes a sync run.
 *
 * `lastSyncedAt` is written here and only here, after every page has been
 * applied. A run that fails writes `recordSyncFailure` instead and leaves
 * `lastSyncedAt` alone — so a provider that is down cannot make a stale calendar
 * look fresh by failing loudly, which is the exact opposite of what a staleness
 * indicator is for.
 */
export const internalFinishSync = internalMutation({
  args: {
    userId: v.id("users"),
    provider: providerSlugValidator,
    pages: v.number(),
    synced: v.boolean(),
  },
  handler: async (ctx, args) => {
    const spaceId = await ensurePersonalSpace(ctx, args.userId);
    const now = Date.now();
    const row = await ctx.db
      .query("syncCursors")
      .withIndex("by_owner_provider", (q) =>
        q.eq("ownerUserId", args.userId).eq("provider", args.provider),
      )
      .first();

    if (row) {
      await ctx.db.patch(row._id, {
        runs: row.runs + 1,
        lastSyncedAt: args.synced ? now : row.lastSyncedAt,
        lastErrorCode: args.synced ? undefined : "sync_incomplete",
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("syncCursors", {
        ownerUserId: args.userId,
        spaceId,
        provider: args.provider,
        runs: 1,
        lastSyncedAt: args.synced ? now : undefined,
        updatedAt: now,
      });
    }

    if (args.synced) {
      const connection = await ctx.db
        .query("connections")
        .withIndex("by_owner_provider", (q) =>
          q.eq("ownerUserId", args.userId).eq("provider", args.provider),
        )
        .first();
      if (connection) {
        await ctx.db.patch(connection._id, { lastSyncedAt: now, status: "connected" });
      }
    }

    return { finished: true };
  },
});

/**
 * Fetches everything Google has, and applies it.
 *
 * An action, because it talks to the network. Called from the client when the
 * user asks for a refresh; a scheduled trigger would call this same function
 * later and nothing here would change.
 *
 * The loop is bounded by `MAX_PAGES` rather than by "until Google stops handing
 * out a cursor", because a provider that keeps paging would otherwise run until
 * the action times out — with the user's calendar half written. Each page is
 * applied before the next is fetched, so an interrupted sync leaves a consistent
 * prefix rather than a torn page.
 */
export const syncGoogleCalendar = action({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const provider = "google-calendar" as const;
    const adapter = adapterFor(provider);
    if (!adapter) throw new Error("That integration is not wired up yet.");

    const token = await ctx.runQuery(internal.credentials.internalProviderToken, {
      userId,
      provider,
    });
    if (!token) throw new Error("Not connected.");

    const start = await ctx.runQuery(internal.calendar.internalSyncCursor, { userId, provider });

    let cursor: string | null = start.cursor;
    let pages = 0;
    const totals = { creates: 0, patches: 0, unchanged: 0, deletes: 0, written: 0 };

    while (pages < MAX_PAGES) {
      const batch = await adapter.fetchPage({
        accessToken: token.accessToken,
        cursor,
        since: start.lastSyncedAt,
      });

      const written = await ctx.runMutation(internal.integrations.internalApplyBatch, {
        userId: userId as Id<"users">,
        provider,
        objects: batch.objects,
        complete: batch.complete,
        cursor: batch.cursor,
      });

      totals.creates += written.creates;
      totals.patches += written.patches;
      totals.unchanged += written.unchanged;
      totals.deletes += written.deletes;
      totals.written += written.written;

      pages += 1;
      if (batch.cursor === null) break;
      cursor = batch.cursor;
    }

    await ctx.runMutation(internal.calendar.internalFinishSync, { userId, provider, pages, synced: true });

    // Counts only. A caller learns how much changed and nothing about what.
    return { ...totals, pages, connected: true };
  },
});

// ---------------------------------------------------------------------------
// the read model
// ---------------------------------------------------------------------------

/**
 * What is next, from the user's own calendar.
 *
 * Bounded by an index range over `by_space_startsAt` and capped at ten rows,
 * because this feeds a dashboard block, not an export. Cancelled events are
 * filtered here rather than in the index, so the same rule holds for any future
 * caller.
 *
 * The returned shape has no field for anything §7.3 forbids, and none for
 * anything that is not on screen.
 */
export const upcomingEvents = query({
  args: { days: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    const now = Date.now();
    const empty = {
      connected: false,
      lastSyncedAt: null,
      stale: false,
      suppress: false,
      cancelled: 0,
      now,
      events: [],
    };
    if (!userId) return empty;

    const horizon = now + Math.min(args.days ?? HORIZON_DAYS, 90) * DAY;

    const space = await ctx.db
      .query("spaces")
      .withIndex("by_createdBy", (q) => q.eq("createdBy", userId))
      .first();
    if (!space) return empty;

    const rows = await ctx.db
      .query("calendarEvents")
      .withIndex("by_space_startsAt", (q) =>
        q.eq("spaceId", space._id).gte("startsAt", now).lte("startsAt", horizon),
      )
      .take(MAX_UPCOMING_EVENTS);

    const connection = await ctx.db
      .query("connections")
      .withIndex("by_owner_provider", (q) =>
        q.eq("ownerUserId", userId).eq("provider", "google-calendar"),
      )
      .first();

    const def = definitionFor("google-calendar");
    const lastSyncedAt = connection?.lastSyncedAt ?? null;
    const hours = lastSyncedAt ? (now - lastSyncedAt) / HOUR : null;

    return {
      connected: connection != null,
      lastSyncedAt,
      // The server's clock, so "today" on the client is the same day the query
      // filtered on. A client-side `Date.now()` would drift across midnight and
      // could disagree with the rows it was handed.
      now,
      // §7.2: a banner at 48h. The *suppression* threshold is applied where
      // items are produced, so a calendar that has not synced for a week cannot
      // reach the attention feed at all — it is not merely greyed out there.
      stale: hours != null && hours >= def.staleBannerHours,
      suppress: hours != null && hours >= def.staleSuppressHours,
      // How many meetings in the window upstream has cancelled. They are kept
      // rather than deleted (§7.2) and this is how a client — or the phase-2
      // conformance run — can tell "kept and flagged" from "gone".
      cancelled: rows.filter((r) => r.cancelled === true).length,
      events: rows
        .filter((r) => r.cancelled !== true)
        .slice(0, 10)
        .map((r) => ({
          id: r._id,
          title: r.isPrivate ? PRIVATE_TITLE : r.title,
          startsAt: r.startsAt ?? null,
          endsAt: r.endsAt ?? null,
          allDay: r.allDay === true,
          sourceUrl: r.sourceUrl ?? null,
          private: r.isPrivate === true,
        })),
    };
  },
});

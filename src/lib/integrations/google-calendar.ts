/**
 * The Google Calendar adapter (§7.3, ADR-012, ADR-013).
 *
 * The reference implementation of `Adapter`. Everything provider-specific about
 * calendar lives in this file and nowhere else: the authorisation URL, the token
 * exchange, the pagination, the field mapping, and — the part that matters most —
 * the decision about which fields Panel is willing to keep.
 *
 * **Minimisation is structural, not a filter.** `normalizeEvent` reads named
 * fields off Google's response and constructs a new object. `description`,
 * `attendees`, `location`, `conferenceData`, `reminders`, `organizer` and
 * `recurrence` are never read, so they cannot be written: there is no code path
 * by which a private title, a guest list or a dial-in reaches the database. A
 * filter (`delete payload.description`) would have been one refactor away from
 * forgetting a field; an allowlist cannot forget, because forgetting a field
 * means it is not on the list.
 *
 * Nothing here writes to Google. The registry declares `writable: false` and
 * only `calendar.readonly` is ever requested; there is no mutating endpoint in
 * this file, so there is no code to accidentally call.
 *
 * Purity and injectability, per ADR-002:
 *  - `normalizeEvent` is pure and takes `now`, so every date decision is
 *    testable from a literal.
 *  - every network call goes through an injected `fetch`, so the whole adapter
 *    is exercised offline in `google-calendar.test.ts` with a stub — no test in
 *    this suite touches Google's servers or needs credentials.
 *  - env vars are read inside the functions that need them, never at module
 *    load, so importing this module in a context with no credentials configured
 *    is not an error. It *reports* `not_configured` when asked to work.
 */

import { definitionFor } from "./registry";
import {
  IntegrationFailure,
  type Adapter,
  type NormalizedBatch,
  type NormalizedObject,
} from "./types";

/** Google's own token endpoint. The only OAuth host Panel talks to. */
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const EVENTS_ENDPOINT = "https://www.googleapis.com/calendar/v3/calendars/primary/events";

/** Google's documented maximum page size. Asking for more is a 400. */
const PAGE_SIZE = 250;

/** How far back a sweep looks. Panel does not keep a calendar archive. */
const HISTORY_DAYS = 90;

/** How far ahead. Beyond a fortnight a meeting is not "upcoming", it is later. */
const FUTURE_DAYS = 180;

/** The only title Panel will ever write for an event Google calls private. */
export const PRIVATE_TITLE = "Busy";

/** Fetch is injected so the adapter is testable without a network. */
export type FetchLike = (
  input: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

// ---------------------------------------------------------------------------
// configuration
// ---------------------------------------------------------------------------

/** The user must supply these; Panel refuses to pretend otherwise. */
export function googleConfig(): {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
} {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const site = process.env.CONVEX_SITE_URL;
  const redirectUri =
    process.env.GOOGLE_REDIRECT_URI ?? (site ? `${site.replace(/\/$/, "")}/oauth/google-calendar/callback` : "");

  if (!clientId || !clientSecret || !redirectUri) {
    throw new IntegrationFailure(
      "not_configured",
      "Google Calendar is not configured yet. It needs GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.",
    );
  }
  return { clientId, clientSecret, redirectUri };
}

/** Whether a live handshake is even possible. Drives the UI's honest "Unknown". */
export function isGoogleConfigured(): boolean {
  try {
    googleConfig();
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// authorisation
// ---------------------------------------------------------------------------

/**
 * The URL to send the user to.
 *
 * Pure, and therefore unit-testable without a browser. Three things are worth
 * checking in a test rather than in production:
 *
 *  - `access_type=offline`, without which Google issues no refresh token and
 *    the connection dies an hour later with no explanation;
 *  - `prompt=consent` on the first run, because a refresh token is only issued
 *    alongside a fresh consent;
 *  - **no `client_secret`**, ever. It is a query parameter here, which would put
 *    it in browser history, in a Referer header and in any proxy log.
 */
export function googleAuthorizeUrl(args: {
  clientId: string;
  state: string;
  codeChallenge: string;
  redirectUri: string;
}): string {
  const def = definitionFor("google-calendar");
  const params = new URLSearchParams({
    client_id: args.clientId,
    redirect_uri: args.redirectUri,
    response_type: "code",
    // The scopes come from the registry, never from this file. One authority.
    scope: def.scopes.join(" "),
    state: args.state,
    code_challenge: args.codeChallenge,
    code_challenge_method: "S256",
    access_type: "offline",
    include_granted_scopes: "true",
    prompt: "consent",
  });
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// minimisation
// ---------------------------------------------------------------------------

/** Google's own event fields, as far as Panel is willing to acknowledge them. */
interface GoogleEvent {
  id?: unknown;
  summary?: unknown;
  visibility?: unknown;
  status?: unknown;
  updated?: unknown;
  htmlLink?: unknown;
  start?: { dateTime?: unknown; date?: unknown };
  end?: { dateTime?: unknown; date?: unknown };
}

/**
 * Turns one Google event into one normalised object — or nothing at all.
 *
 * Returns null when the event is not something Panel can represent: no id (it
 * would not be idempotent), or a status it does not store. Refusing is the right
 * answer here. Skipping silently would make "we could not read your calendar"
 * look identical to "you have no meetings", and that is exactly the kind of
 * quiet failure this phase is supposed to eliminate.
 */
export function normalizeEvent(raw: unknown): NormalizedObject | null {
  if (typeof raw !== "object" || raw === null) return null;
  const event = raw as GoogleEvent;

  if (typeof event.id !== "string" || !event.id.trim()) return null;
  // `cancelled` arrives only when the caller asks for deleted events, which
  // Panel does not; the check is here so an upstream change cannot start
  // resurrecting cancelled meetings.
  if (event.status === "cancelled") return null;

  // §7.3: if Google reports the event private, the title is dropped *here*, in
  // the adapter, before it exists as a string Panel could write. Not hidden at
  // the UI, not encrypted at rest: never stored.
  const isPrivate = event.visibility === "private";
  const summary = typeof event.summary === "string" ? event.summary.trim() : "";

  const fields: Record<string, string | number | boolean | null> = {
    // The allowlist. Anything not named here does not exist as far as Panel is
    // concerned, and a unit test asserts the key set exactly.
    title: isPrivate ? PRIVATE_TITLE : summary || "Untitled",
    isPrivate,
    startsAt: readTime(event.start),
    endsAt: readTime(event.end),
    allDay: event.start?.date != null,
  };
  if (typeof event.htmlLink === "string") fields.sourceUrl = event.htmlLink;

  return {
    kind: "calendarEvent",
    externalId: event.id,
    changedAt: typeof event.updated === "string" ? Date.parse(event.updated) : undefined,
    fields,
  };
}

/**
 * One timestamp, from either an RFC 3339 date-time or a bare `YYYY-MM-DD`.
 *
 * All-day events have no time and no zone. Anchoring them to local midnight is
 * the least-wrong choice: an all-day meeting belongs to the user's day, not to
 * UTC's. `Number.isNaN` is checked because `Date.parse("")` is NaN and a NaN
 * `startsAt` would poison every comparison downstream — the same reasoning as
 * defects D16 and D23.
 */
function readTime(value: { dateTime?: unknown; date?: unknown } | undefined): number | null {
  if (!value) return null;
  const raw =
    typeof value.dateTime === "string"
      ? value.dateTime
      : typeof value.date === "string"
        ? value.date
        : null;
  if (!raw) return null;
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? null : parsed;
}

/** The window Panel asks Google for. */
function windowFor(now: number): { timeMin: string; timeMax: string } {
  const iso = (ms: number) => new Date(ms).toISOString();
  return {
    timeMin: iso(now - HISTORY_DAYS * 86_400_000),
    timeMax: iso(now + FUTURE_DAYS * 86_400_000),
  };
}

// ---------------------------------------------------------------------------
// the adapter
// ---------------------------------------------------------------------------

/**
 * Exchanges an authorisation code for tokens.
 *
 * `verifier` is the PKCE verifier, read from `oauthStates` on the server. It
 * goes into the request body and nowhere else — it is not logged, not returned
 * and not stored beyond the ten minutes it already had.
 */
export async function exchangeGoogleCode(
  fetchImpl: FetchLike,
  args: { code: string; verifier: string },
): Promise<{ accessToken: string; refreshToken?: string; expiresAt?: number }> {
  const { clientId, clientSecret, redirectUri } = googleConfig();

  const response = await fetchImpl(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: args.code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
      code_verifier: args.verifier,
    }).toString(),
  });

  const payload = (await response.json()) as {
    access_token?: unknown;
    refresh_token?: unknown;
    expires_in?: unknown;
    error?: unknown;
  };

  if (!response.ok || typeof payload.access_token !== "string") {
    // The provider's `error` string is deliberately not surfaced: it is Google's
    // own vocabulary, and `mapProviderError` exists to turn any failure into
    // one of Panel's codes. What reaches a user is Panel's sentence.
    throw new IntegrationFailure(
      response.status === 400 ? "auth_expired" : "provider_unavailable",
      "Google did not accept that authorisation code.",
      true,
    );
  }

  return {
    accessToken: payload.access_token,
    refreshToken: typeof payload.refresh_token === "string" ? payload.refresh_token : undefined,
    expiresAt:
      typeof payload.expires_in === "number" ? Date.now() + payload.expires_in * 1000 : undefined,
  };
}

/**
 * Pulls one page of events.
 *
 * `singleEvents=true` is a deliberate choice with two consequences. It asks
 * Google to expand recurring series into individual instances, each with its own
 * stable id — so a weekly standup is one row per occurrence, never duplicated,
 * and Panel never sees or stores the recurrence *rule* or the exception list,
 * both of which §7.3 forbids. It also means an edit to a series can change an
 * instance's id, which the deletion rule in §7.2 handles: the old row disappears
 * upstream, so it is deleted or cancelled exactly like any other removal.
 *
 * `showDeleted` is left at its default of false. A deleted event should arrive
 * as an *absence*, which the diff engine already understands, rather than as a
 * payload that would have to be interpreted.
 */
export async function fetchGooglePage(
  fetchImpl: FetchLike,
  args: { accessToken: string; cursor: string | null; now: number },
): Promise<NormalizedBatch> {
  const { timeMin, timeMax } = windowFor(args.now);
  const params = new URLSearchParams({
    timeMin,
    timeMax,
    maxResults: String(PAGE_SIZE),
    singleEvents: "true",
    orderBy: "startTime",
    // `updated` is what makes a resync cheap: the second sweep asks only for
    // what changed since the cursor.
    ...(args.cursor ? { updatedMin: new Date(Number(args.cursor)).toISOString() } : {}),
  });

  const response = await fetchImpl(`${EVENTS_ENDPOINT}?${params.toString()}`, {
    headers: { authorization: `Bearer ${args.accessToken}` },
  });

  if (!response.ok) {
    throw new IntegrationFailure(
      response.status === 401 || response.status === 403 ? "auth_revoked" : "provider_unavailable",
      "Google did not return the calendar.",
      response.status === 401 || response.status === 403,
    );
  }

  const payload = (await response.json()) as { items?: unknown; nextPageToken?: unknown };
  const rawItems = Array.isArray(payload.items) ? payload.items : [];
  if (!Array.isArray(payload.items) && payload.items !== undefined) {
    throw new IntegrationFailure("malformed_response", "Google returned something unexpected.");
  }

  const objects: NormalizedObject[] = [];
  for (const raw of rawItems) {
    const normalized = normalizeEvent(raw);
    if (normalized) objects.push(normalized);
  }

  const cursor = typeof payload.nextPageToken === "string" ? String(args.now) : null;

  return {
    provider: "google-calendar",
    objects,
    links: [],
    // `complete` is true only when there is no next page. This is the single
    // most consequential boolean in the whole framework: `diffBatch` deletes
    // rows missing from a *complete* page and deletes nothing otherwise, so a
    // wrong `true` here empties a user's calendar.
    complete: cursor === null,
    cursor,
    fetchedAt: args.now,
  };
}

/**
 * The adapter, as the framework consumes it.
 *
 * `fetch` is captured at call time rather than at module load so a test can
 * swap it by calling the two functions above directly, and so this object stays
 * a thin, honest binding rather than a second implementation.
 */
export const googleCalendarAdapter: Adapter = {
  def: definitionFor("google-calendar"),
  authorizationRequest({ state, codeChallenge }) {
    const { clientId, redirectUri } = googleConfig();
    return {
      url: googleAuthorizeUrl({ clientId, state, codeChallenge, redirectUri }),
      redirectUri,
    };
  },
  async exchangeCode({ code, verifier }) {
    if (!verifier) {
      // PKCE is not optional, and this is where that becomes real rather than
      // aspirational: an exchange with no verifier is refused instead of
      // silently performed, which is the mistake that would make an intercepted
      // authorisation code redeemable by whoever intercepted it.
      throw new IntegrationFailure("invalid_scope", "A PKCE verifier is required.");
    }
    return exchangeGoogleCode(fetch, { code, verifier });
  },
  async fetchPage({ accessToken, cursor }) {
    return fetchGooglePage(fetch, { accessToken, cursor, now: Date.now() });
  },
};

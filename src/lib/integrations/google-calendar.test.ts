/**
 * Fixtures for the Google Calendar adapter (phase 2, ADR-013).
 *
 * Every one of these runs offline. `fetch` is injected, so nothing here touches
 * Google, and nothing here needs credentials — which matters, because a test
 * that can only run with a secret in the environment is a test that stops being
 * run the first time somebody's laptop is not configured.
 *
 * The fixtures are organised around the claims phase 2 makes, one claim per
 * block, in the order the claims appear in CHANGE-0012:
 *
 *  1. minimisation — the stored field set is exactly the allowlist;
 *  2. privacy — a private event is "Busy" and its title exists nowhere;
 *  3. idempotency — the same instance twice is one row;
 *  4. deletion safety — `complete` is true only when there is no next page;
 *  5. honest configuration — no credentials means `not_configured`, never a
 *     fake URL and never a silent success.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  fetchGooglePage,
  googleAuthorizeUrl,
  googleCalendarAdapter,
  isGoogleConfigured,
  normalizeEvent,
  PRIVATE_TITLE,
  type FetchLike,
} from "./google-calendar";
import { IntegrationFailure } from "./types";

const NOW = Date.parse("2026-10-01T09:00:00.000Z");

/** A stub that answers with one canned payload and records what it was asked. */
function stub(payload: unknown, status = 200) {
  const calls: { url: string; init?: { headers?: Record<string, string>; body?: string } }[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return { ok: status >= 200 && status < 300, status, json: async () => payload };
  };
  return { fetchImpl, calls };
}

function event(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "evt_1",
    summary: "Design review",
    visibility: "default",
    status: "confirmed",
    updated: "2026-10-01T08:00:00.000Z",
    htmlLink: "https://calendar.google.com/event/edit/evt_1",
    start: { dateTime: "2026-10-01T14:00:00.000Z" },
    end: { dateTime: "2026-10-01T15:00:00.000Z" },
    ...over,
  };
}

// ---------------------------------------------------------------------------
// 1. minimisation
// ---------------------------------------------------------------------------

test("a normalised event carries exactly the allowlisted fields", () => {
  const normalized = normalizeEvent(event());
  assert.ok(normalized);

  // The whole point of §7.3, asserted as a set rather than a spot check: if
  // someone adds a field to the mapper, this fails until the policy is updated.
  assert.deepEqual(Object.keys(normalized.fields).sort(), [
    "allDay",
    "endsAt",
    "isPrivate",
    "sourceUrl",
    "startsAt",
    "title",
  ]);

  assert.equal(normalized.kind, "calendarEvent");
  assert.equal(normalized.externalId, "evt_1");
  assert.equal(normalized.fields.title, "Design review");
  assert.equal(normalized.fields.startsAt, Date.parse("2026-10-01T14:00:00.000Z"));
  assert.equal(normalized.fields.allDay, false);
});

test("a description, a location and an attendee list are never read", () => {
  const hostile = event({
    description: "Quarterly revenue plan and the acquisition timeline",
    location: "Room 4, 12 Privet Drive",
    attendees: [{ email: "someone@example.com", displayName: "Someone" }],
    conferenceData: { entryPoints: [{ uri: "https://meet.example/dial-in-token" }] },
    organizer: { email: "boss@example.com" },
    reminders: { useDefault: true },
    recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO"],
    extendedProperties: { private: { note: "private" } },
  });

  const normalized = normalizeEvent(hostile);
  assert.ok(normalized);

  // Structural, not a filter: the payload above is simply not read, so the
  // serialised result cannot contain any of it. `JSON.stringify` on the whole
  // object catches a field added anywhere, including `changedAt`.
  const serialised = JSON.stringify(normalized);
  for (const secret of [
    "Quarterly revenue plan",
    "Privet Drive",
    "someone@example.com",
    "meet.example",
    "boss@example.com",
    "RRULE",
    "private",
  ]) {
    assert.ok(!serialised.includes(secret), `"${secret}" reached a normalised object`);
  }
});

test("an all-day event is anchored to a day and flagged", () => {
  const normalized = normalizeEvent(
    event({ id: "evt_ad", start: { date: "2026-10-04" }, end: { date: "2026-10-05" } }),
  );
  assert.ok(normalized);
  assert.equal(normalized.fields.allDay, true);
  assert.equal(normalized.fields.startsAt, Date.parse("2026-10-04T00:00:00.000Z"));
});

test("an unparseable date becomes null, never NaN", () => {
  const normalized = normalizeEvent(event({ start: { dateTime: "not a date" } }));
  assert.ok(normalized);
  assert.equal(normalized.fields.startsAt, null);
  // NaN would poison every comparison downstream — the D16 / D23 lesson.
  assert.ok(!Number.isNaN(Number(normalized.fields.startsAt)));
});

test("an event with no id, or that Google calls cancelled, is refused", () => {
  assert.equal(normalizeEvent(event({ id: "" })), null);
  assert.equal(normalizeEvent(event({ id: undefined })), null);
  assert.equal(normalizeEvent(event({ status: "cancelled" })), null);
  assert.equal(normalizeEvent(null), null);
  assert.equal(normalizeEvent("nonsense"), null);
});

// ---------------------------------------------------------------------------
// 2. privacy
// ---------------------------------------------------------------------------

test("a private event is stored as the literal Busy, with no trace of its title", () => {
  const secret = "Therapy appointment";
  const normalized = normalizeEvent(event({ visibility: "private", summary: secret }));
  assert.ok(normalized);

  assert.equal(normalized.fields.title, PRIVATE_TITLE);
  assert.equal(normalized.fields.isPrivate, true);
  assert.ok(!JSON.stringify(normalized).includes(secret));
});

test("an event with no summary is still renderable", () => {
  const normalized = normalizeEvent(event({ summary: undefined }));
  assert.ok(normalized);
  assert.equal(normalized.fields.title, "Untitled");
});

// ---------------------------------------------------------------------------
// 3 + 4. idempotency and pagination
// ---------------------------------------------------------------------------

test("one page maps every event and reports complete when there is no cursor", async () => {
  const { fetchImpl, calls } = stub({
    items: [event(), event({ id: "evt_2", summary: "1:1" })],
  });

  const batch = await fetchGooglePage(fetchImpl, { accessToken: "t", cursor: null, now: NOW });

  assert.equal(batch.provider, "google-calendar");
  assert.equal(batch.objects.length, 2);
  assert.equal(batch.complete, true);
  assert.equal(batch.cursor, null);

  // Read-only, minimised, and pointed at the primary calendar.
  assert.match(calls[0].url, /calendars\/primary\/events/);
  assert.ok(calls[0].init?.headers?.authorization?.startsWith("Bearer "));
  assert.ok(!calls[0].url.includes("events.write"));
});

test("a page with a next token is explicitly incomplete", async () => {
  const { fetchImpl } = stub({ items: [event()], nextPageToken: "page2" });
  const batch = await fetchGooglePage(fetchImpl, { accessToken: "t", cursor: null, now: NOW });

  // `complete: false` is the flag that stops the diff engine deleting every row
  // a truncated page happens not to mention.
  assert.equal(batch.complete, false);
  assert.equal(batch.cursor, String(NOW));
});

test("a cursor becomes an incremental window, not a full sweep", async () => {
  const { fetchImpl, calls } = stub({ items: [] });
  await fetchGooglePage(fetchImpl, {
    accessToken: "t",
    cursor: String(NOW - 3_600_000),
    now: NOW,
  });
  assert.match(calls[0].url, /updatedMin=/);
  assert.equal(calls[0].url.includes("timeMax"), true);
});

test("a malformed page is refused rather than read as empty", async () => {
  // `{items: {}}` is not an array. Reading it as "no events" would delete a
  // user's whole calendar on the next complete page.
  const { fetchImpl } = stub({ items: {} });
  await assert.rejects(
    () => fetchGooglePage(fetchImpl, { accessToken: "t", cursor: null, now: NOW }),
    (error: IntegrationFailure) => error.code === "malformed_response",
  );
});

test("a 401 is reported as needing a reconnect", async () => {
  const { fetchImpl } = stub({ error: { message: "Invalid Credentials" } }, 401);
  await assert.rejects(
    () => fetchGooglePage(fetchImpl, { accessToken: "t", cursor: null, now: NOW }),
    (error: IntegrationFailure) => error.code === "auth_revoked" && error.reconnectRequired,
  );
});

// ---------------------------------------------------------------------------
// 5. configuration and the authorisation URL
// ---------------------------------------------------------------------------

test("the authorisation URL asks for offline access and never for a secret", () => {
  const url = googleAuthorizeUrl({
    clientId: "client-123",
    state: "state-abc",
    codeChallenge: "challenge-xyz",
    redirectUri: "https://example.convex.cloud/oauth/google-calendar/callback",
  });

  assert.ok(url.startsWith("https://accounts.google.com/"));
  assert.ok(url.includes("code_challenge_method=S256"));
  assert.ok(url.includes("code_challenge=challenge-xyz"));
  assert.ok(url.includes("state=state-abc"));
  // Without these two the connection dies an hour later for no visible reason.
  assert.ok(url.includes("access_type=offline"));
  assert.ok(url.includes("prompt=consent"));
  // The scope comes from the registry: calendar.readonly, and nothing else.
  assert.ok(url.includes(encodeURIComponent("https://www.googleapis.com/auth/calendar.readonly")));
  assert.ok(!url.includes("calendar.events"));
  assert.ok(!url.includes("calendar.events.write"));

  // The single most important assertion in this file.
  assert.ok(!url.includes("client_secret"));
  assert.ok(!url.toLowerCase().includes("secret"));
});

test("without credentials Panel reports not_configured rather than inventing a URL", () => {
  const saved = { ...process.env };
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
  delete process.env.CONVEX_SITE_URL;
  delete process.env.GOOGLE_REDIRECT_URI;
  try {
    assert.equal(isGoogleConfigured(), false);
    assert.throws(
      () =>
        googleCalendarAdapter.authorizationRequest({ state: "s", codeChallenge: "c" }),
      (error: IntegrationFailure) => error.code === "not_configured",
    );
  } finally {
    process.env = saved as NodeJS.ProcessEnv;
  }
});

test("with credentials the redirect is derived from the deployment URL", async () => {
  const saved = { ...process.env };
  process.env.GOOGLE_CLIENT_ID = "client-123";
  process.env.GOOGLE_CLIENT_SECRET = "shh";
  process.env.CONVEX_SITE_URL = "https://panel-abc.convex.cloud";
  delete process.env.GOOGLE_REDIRECT_URI;
  try {
    const request = googleCalendarAdapter.authorizationRequest({ state: "s", codeChallenge: "c" });
    assert.equal(
      request.redirectUri,
      "https://panel-abc.convex.cloud/oauth/google-calendar/callback",
    );
    assert.ok(request.url.includes(encodeURIComponent(request.redirectUri)));
  } finally {
    process.env = saved as NodeJS.ProcessEnv;
  }
});

test("an exchange with no PKCE verifier is refused", async () => {
  await assert.rejects(
    () =>
      googleCalendarAdapter.exchangeCode({
        code: "c",
        state: "s",
        redirectTo: "/dashboard",
      }),
    (error: IntegrationFailure) => error.code === "invalid_scope",
  );
});

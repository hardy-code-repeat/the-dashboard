/**
 * The one place a URL is allowed to become a link.
 *
 * ## Why this module exists
 *
 * `calendarEvents.sourceUrl` is written from integration data and rendered as
 * `href={event.sourceUrl}`. React escapes text, but it does **not** escape an
 * `href` — `href="javascript:alert(1)"` is a working link. The value reaches
 * the database through a public mutation that takes `v.array(v.any())`, so it
 * is caller-controlled, and the harness proved a stored
 * `javascript:alert(document.domain)` survives the write and comes back out of
 * `upcomingEvents` verbatim.
 *
 * ## The rule
 *
 * A stored URL is kept only if it parses as an absolute `http:` or `https:` URL.
 * Everything else — `javascript:`, `data:`, `vbscript:`, `file:`, a relative
 * fragment, a malformed string — returns `undefined`, and the caller renders no
 * link at all rather than rendering a broken or dangerous one.
 *
 * ## Control characters are rejected before parsing, not after
 *
 * `java&#9;script:alert(1)` is a real bypass of naive prefix checks, because the
 * WHATWG URL parser **strips** tabs and newlines and then resolves the scheme as
 * `javascript:`. Checking the parsed protocol catches it, but checking the raw
 * string first means the refusal is legible instead of relying on a spec's
 * normalisation to save us.
 */

/** Long enough for any real link, short enough that it cannot be a payload. */
const MAX_URL_LENGTH = 2048;

/**
 * Returns a safe absolute `http`/`https` URL, or `undefined`.
 *
 * `undefined` is the correct answer for anything unusable. It is never a
 * fallback to the original string — returning the input on failure is exactly
 * the bug this exists to remove.
 */
export function safeHttpUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;

  const text = value.trim();
  if (text.length === 0 || text.length > MAX_URL_LENGTH) return undefined;

  // C0 controls, DEL, and C1. Browsers strip \t \n \r from URLs before
  // resolving the scheme, so `java<TAB>script:` must never reach the parser.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f-\u009f]/.test(text)) return undefined;

  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    return undefined;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined;
  return parsed.toString();
}
/**
 * Neon health reporting (CHANGE-0039).
 *
 * ## What this module is
 *
 * The pure half of Panel's Neon connection check. It takes the outcome of one
 * probe — did the server answer, how long did it take, or did it fail, and if
 * it failed, in what coarse way — and returns what the operator is allowed to
 * see: a **state**, a **classification**, and a sentence written for a human.
 *
 * ## Why the classification is here and not in the action
 *
 * The one thing this module must never do is pass a driver's error text
 * through. A failed Postgres connection says things like `password
 * authentication failed for user "u_12345"`, and a Neon connection string
 * carries the hostname, the account, the database and the password in a single
 * value. An operator-facing payload containing that is a credential disclosure
 * wearing a status label.
 *
 * So the action reduces a failure to a **coarse class** first, and this module
 * decides what that class is *called* and what it *means*. Both halves keep a
 * closed vocabulary: nothing derived from a driver error crosses the boundary
 * except four fixed words.
 *
 * ## What this module is not
 *
 * It opens no connection, reads no environment variable and imports no
 * driver. It is pure, which is what makes the classification table testable
 * without a live Neon project — see `neonHealth.test.ts`.
 */

/**
 * How a probe ended.
 *
 * Four states, closed:
 *
 * - `ok` — the server answered the probe query.
 * - `unconfigured` — no `DATABASE_URL` is set on the deployment. Nothing was
 *   attempted, so this says nothing about Neon's health and must never be
 *   rendered as an outage.
 * - `timeout` — the probe exceeded {@link PROBE_TIMEOUT_MS}.
 * - `unreachable` — the probe failed for any other reason.
 *
 * There is deliberately no `disabled`, `degraded` or `partial`: one
 * connectivity probe can establish reachability and nothing else.
 */
export type NeonState = "ok" | "unconfigured" | "timeout" | "unreachable";

/**
 * The coarse classification of a failed probe.
 *
 * `unknown` is a real member, not a filler: it is the honest answer when a
 * failure matches no category we checked for, and it is what makes "we did not
 * recognise this" visible instead of guessing.
 */
export type NeonFailureClass = "auth" | "network" | "timeout" | "unknown";

/** The probe's own ceiling, and therefore the boundary of `timeout`. */
export const PROBE_TIMEOUT_MS = 5_000;

/** One probe result. `error` is driver text and never leaves the action. */
export interface NeonProbeResult {
  state: NeonState;
  latencyMs: number | null;
  error: string | null;
}

/** What the operator sees. Every field is a fixed word, a plain number or a sentence. */
export interface NeonHealthReport {
  state: NeonState;
  classification: NeonFailureClass | "none";
  latencyMs: number | null;
  /** The one sentence the operator reads. Every state has exactly one. */
  summary: string;
}

/**
 * The `ok` sentence, fixed on purpose.
 *
 * The probe deliberately does not return the database name, so there is
 * nothing variable to interpolate. That is why this is a constant rather than a
 * template: the honest summary is "the server answered", and padding it with a
 * database name would have meant querying for a value nobody needs.
 */
const OK_SUMMARY =
  "Neon answered the connection check. Panel holds no schema, table or migration in Neon yet.";

/**
 * The sentence for each coarse failure class.
 *
 * Each says what is *likely* and none claims a cause it cannot establish: an
 * operator with dashboard access reads these as the starting point for the
 * real diagnosis, not as its conclusion.
 */
const CAUSE: Record<NeonFailureClass, string> = {
  auth: "Neon rejected the credentials. Most likely the connection string is wrong, revoked, or was rotated after it was pasted in.",
  network: "Neon could not be reached from the deployment. Most likely a name-resolution or egress problem rather than a Neon outage.",
  timeout: `Neon did not answer within ${PROBE_TIMEOUT_MS}ms.`,
  unknown: "Neon could not be reached and the failure did not match any pattern this check recognises.",
};

/**
 * Name a coarse failure class. Pure and total: it always returns one of four
 * words, and never returns a substring of the driver's message.
 *
 * Substring checks read like a smell because they are one: Postgres driver
 * error text is not a stable interface. This one is kept for a specific
 * reason — it is a **diagnostic hint for an operator who already holds
 * dashboard access**, it is applied to text that never leaves the server, and
 * every branch including "no match" is tested. It narrows "something went
 * wrong" to "probably the credentials"; it never narrows anything further, and
 * the result is labelled a hint rather than a cause.
 *
 * @param error Driver error text. Never returned, never logged.
 */
export function classifyNeonFailure(error: string | null): NeonFailureClass {
  if (error === null) return "unknown";

  // SQLSTATE 28P01/28P02 are invalid- and expired-password; node-postgres
  // reports them as the class name, and they are far steadier than English.
  if (/28P0\d|password|authenticat/i.test(error)) return "auth";

  // DNS, refused, reset and TLS failures all mean "never got there".
  // `ENOTFOUND`, `ECONNREFUSED`, `EAI_AGAIN` and friends are Node error codes.
  if (/ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH|ENETDOWN|self.signed|certificate/i.test(error)) {
    return "network";
  }

  if (/timed?\s?out|timeout|ETIMEDOUT/i.test(error)) return "timeout";

  return "unknown";
}

/**
 * Reduce one probe result to the operator-facing report.
 *
 * `unconfigured` deliberately reports `latencyMs: null` and the class `none`:
 * nothing was attempted, so there is no duration to report and no failure to
 * classify. Rendering a zero there would invent a measurement.
 */
export function describeNeonHealth(result: NeonProbeResult): NeonHealthReport {
  if (result.state === "ok") {
    return {
      state: "ok",
      classification: "none",
      latencyMs: result.latencyMs,
      summary: OK_SUMMARY,
    };
  }

  if (result.state === "unconfigured") {
    return {
      state: "unconfigured",
      classification: "none",
      latencyMs: null,
      summary:
        "No DATABASE_URL is set on this deployment, so no connection was attempted. Set it to the connection string from the Neon console to enable this check.",
    };
  }

  const classification = classifyNeonFailure(result.error);
  return {
    state: result.state,
    // A `timeout` state is classified `timeout` regardless of the text, so a
    // driver that reports its own timeout by a different route still agrees
    // with the deadline that fired.
    classification: result.state === "timeout" ? "timeout" : classification,
    latencyMs: result.latencyMs,
    summary: CAUSE[result.state === "timeout" ? "timeout" : classification],
  };
}
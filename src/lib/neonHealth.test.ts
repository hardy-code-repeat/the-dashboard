/**
 * Tests for the Neon health classification (CHANGE-0039).
 *
 * The reason these tests exist at all is the connection-string problem: a
 * connection string is a single secret, and the assertion that matters most
 * here is not "does `auth` come back for a bad password" but "does no branch
 * of this file ever produce the text it was given". So every test asserts both
 * halves — the class chosen, and the absence of the input from the output.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  classifyNeonFailure,
  describeNeonHealth,
  PROBE_TIMEOUT_MS,
  type NeonProbeResult,
} from "./neonHealth.ts";

/**
 * The single most important test in this file.
 *
 * A driver error can contain a hostname, a role name or a password. Whatever
 * happens, the classifier must emit one of four fixed words.
 */
test("classification never echoes the error it was given", () => {
  const hostile =
    'password authentication failed for user "u_abcdef123" host="ep-cool-name-123456.us-east-2.aws.neon.tech" dbname="paneldb" password=hunter2';

  const result = classifyNeonFailure(hostile);

  assert.equal(result, "auth");
  assert.ok(!result.includes("hunter2"));
  assert.ok(!result.includes("ep-cool-name"));
  assert.ok(!result.includes("paneldb"));
  assert.ok(!result.includes("u_abcdef123"));
});

test("a SQLSTATE auth failure is classified without relying on English", () => {
  // No "password" or "authentication" in the text — only the SQLSTATE class.
  assert.equal(classifyNeonFailure("28P01"), "auth");
  assert.equal(classifyNeonFailure("error: 28P02 (in\n)"), "auth");
});

test("DNS and refused-connection failures are classified as network", () => {
  assert.equal(classifyNeonFailure("getaddrinfo ENOTFOUND neon.example"), "network");
  assert.equal(classifyNeonFailure("connect ECONNREFUSED 127.0.0.1:5432"), "network");
  assert.equal(classifyNeonFailure("self signed certificate in chain"), "network");
});

test("a timeout is classified as a timeout", () => {
  assert.equal(classifyNeonFailure("Connection terminated due to timeout"), "timeout");
});

test("an unrecognised failure stays unknown rather than guessing", () => {
  assert.equal(classifyNeonFailure("something entirely new happened"), "unknown");
  assert.equal(classifyNeonFailure(null), "unknown");
  assert.equal(classifyNeonFailure(""), "unknown");
});

test("ok reports a latency and no classification", () => {
  const report = describeNeonHealth({ state: "ok", latencyMs: 42, error: null });

  assert.equal(report.state, "ok");
  assert.equal(report.classification, "none");
  assert.equal(report.latencyMs, 42);
  assert.match(report.summary, /answered the connection check/);
});

test("an ok with no latency still reports null rather than inventing zero", () => {
  const report = describeNeonHealth({ state: "ok", latencyMs: null, error: null });

  assert.equal(report.latencyMs, null);
});

test("unconfigured attempts nothing and reports no measurement", () => {
  const report = describeNeonHealth({ state: "unconfigured", latencyMs: null, error: null });

  assert.equal(report.state, "unconfigured");
  // A zero here would be a measurement that was never taken.
  assert.equal(report.latencyMs, null);
  assert.equal(report.classification, "none");
  assert.match(report.summary, /DATABASE_URL/);
});

test("the report for any failure carries no part of the driver message", () => {
  const cases: Array<[NeonProbeResult, string]> = [
    [
      { state: "unreachable", latencyMs: 11, error: 'password auth failed for "u_1" pw=hunter2' },
      "auth",
    ],
    [
      { state: "unreachable", latencyMs: 12, error: "getaddrinfo ENOTFOUND ep-x.us-east-2.aws.neon.tech" },
      "network",
    ],
    [{ state: "unreachable", latencyMs: 13, error: "wat" }, "unknown"],
  ];

  for (const [result, expected] of cases) {
    const report = describeNeonHealth(result);
    assert.equal(report.classification, expected);
    assert.ok(!report.summary.includes("hunter2"));
    assert.ok(!report.summary.includes("u_1"));
    assert.ok(!report.summary.includes("ep-x"));
    assert.ok(!report.summary.includes("wat"));
  }
});

test("a timeout state classifies as timeout even when the text disagrees", () => {
  // The deadline fired; a driver that reports it in its own words must not make
  // the operator read "credentials" instead.
  const report = describeNeonHealth({
    state: "timeout",
    latencyMs: PROBE_TIMEOUT_MS,
    error: 'password authentication failed for user "u_9"',
  });

  assert.equal(report.classification, "timeout");
  assert.match(report.summary, new RegExp(String(PROBE_TIMEOUT_MS)));
  assert.ok(!report.summary.includes("u_9"));
});

test("every state in the closed vocabulary has a sentence", () => {
  const states: NeonProbeResult["state"][] = ["ok", "unconfigured", "timeout", "unreachable"];

  for (const state of states) {
    const report = describeNeonHealth({ state, latencyMs: 1, error: null });
    assert.ok(report.summary.length > 0, `${state} produced no summary`);
    assert.ok(report.summary.trim().endsWith("."), `${state} summary is not a sentence`);
  }
});

/**
 * A structural regression test, not a unit test, and deliberately so.
 *
 * The Neon driver's tagged template **binds interpolated values as parameters**,
 * so ``sql`${"SELECT 1"}` `` puts the literal text `SELECT $1` on the wire and
 * Postgres rejects it. That bug was written once in `neon.ts` and nothing in
 * the toolchain could catch it: the driver is typed for any interpolated value,
 * the string is a `string`, and the statement is only parsed by a real server.
 * Since no server can be reached from here, this asserts the shape of the call
 * instead — the one place the mistake is visible without one.
 */
test("the probe is sent through sql.query(), never the tagged template", () => {
  const source = readFileSync(
    fileURLToPath(new URL("../convex/neon.ts", import.meta.url)),
    "utf8",
  );

  // Strip comments so the file's own explanation of the hazard — which
  // necessarily quotes the wrong form — cannot satisfy or fail this check.
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

  assert.ok(
    code.includes("sql.query(NEON_PROBE_QUERY)"),
    "the probe must be sent with sql.query(), which sends the statement as written",
  );
  assert.ok(
    !/sql`\$\{/.test(code),
    "a tagged template would bind the statement as $1 and Postgres would reject it",
  );
});
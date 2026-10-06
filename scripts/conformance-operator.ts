/**
 * Operator Console conformance (ADR-032 observability scope).
 *
 *   bun scripts/conformance-operator.ts <convex-url>
 *
 * What this harness is for, stated against the failure modes this project has
 * actually hit:
 *
 *  - **A refusal must be a refusal, not a crash.** D60: a query that threw on a
 *    bad index looked identical to a correct denial from outside, and the
 *    security harness logged green while the feature was broken. Every live
 *    check below therefore asserts the *fixed refusal sentinel*, not merely
 *    "it threw".
 *  - **The guards must hold on every query, including future ones.** Query
 *    names are enumerated from the source at run time, so a sixth query added
 *    tomorrow is covered without editing this file.
 *  - **The disclosure contract is structural.** admin.ts emits counts, states
 *    and timestamps only; the property-read detectors below mirror the ones in
 *    `scripts/spec-drift.ts` (which runs with controls on every build), and the
 *    users table must not be queried at all.
 *  - **The console stays read-only.** No write endpoint, and the Neon probe
 *    remains a single SELECT 1.
 *
 * What this harness cannot verify, and says so rather than approximating: the
 * *authorised* admin path (K1). No admin session exists in this environment;
 * the role is grantable only out of band (D64), and fabricating one is exactly
 * the bypass this surface exists to refuse. The refusal side — anonymous,
 * guest, forged and malformed callers — is covered here and in
 * `conformance-admin.ts` (48 boundaries), and the allowed predicate is covered
 * by `src/lib/adminAccess.test.ts` fixtures.
 */
import { readFileSync } from "node:fs";

import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";

import { composeOverview, worstVerdict } from "../src/lib/operatorOverview";

const url = process.argv[2];
if (!url) {
  console.error("usage: bun scripts/conformance-operator.ts <convex-url>");
  process.exit(2);
}

const client = new ConvexHttpClient(url);
const ref = makeFunctionReference as unknown as <T>(name: string) => T;
const q = <T>(name: string) =>
  ref<{ (ctx: unknown, args: Record<string, never>): Promise<T> }>(name);

let passed = 0;
let failed = 0;
const notes: string[] = [];

function check(label: string, ok: boolean, detail?: string): void {
  if (ok) {
    passed += 1;
    console.log(`  [PASS] ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    failed += 1;
    console.log(`  [FAIL] ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function note(label: string, detail: string): void {
  notes.push(`${label} — ${detail}`);
  console.log(`  [NOTE] ${label} — ${detail}`);
}

/** The fixed refusal sentinel from src/convex/admin.ts. */
const DENIED = "Admin access required.";

const adminSource = readFileSync("src/convex/admin.ts", "utf8");
const emailOtpSource = readFileSync("src/convex/auth/emailOtp.ts", "utf8");
const findingsSource = readFileSync("src/lib/adminFindings.ts", "utf8");
const neonSource = readFileSync("src/convex/neon.ts", "utf8");

// Query names enumerated from source, so a new query is covered automatically.
const queryNames = [...adminSource.matchAll(/export const (\w+) = query\(/g)].map((m) => m[1]);

console.log(`\n── live: every admin query refuses an anonymous caller, as a refusal ──`);
check("the module exports at least one query", queryNames.length > 0, queryNames.join(", "));

for (const name of queryNames) {
  try {
    const result = await client.query(q<unknown>(`admin:${name}`), {} as never);
    check(`admin:${name} refuses an anonymous caller`, false, `returned ${JSON.stringify(result)?.slice(0, 80)}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // The distinction that matters (D60): a correct denial carries the fixed
    // sentinel. A TypeError, an index error or a Convex runtime error is a
    // *crash*, and a crash must never be recorded as a pass.
    check(
      `admin:${name} refuses with the fixed sentinel (not a crash)`,
      message.includes(DENIED),
      message.includes(DENIED) ? "denial" : `unexpected error: ${message.slice(0, 120)}`,
    );
  }
}

console.log(`\n── source: the console is read-only and discloses counts and states only ──`);

// 1. No write endpoint, alias-included (the full aliased control with its own
//    planted-mutant proof lives in spec-drift; this is the always-run echo).
const writeExport = /export const \w+(\s*:[^=\n]+)?\s*=\s*(mutation|action|internalMutation|internalAction|httpAction)\(/.test(
  adminSource,
);
check("admin.ts exports no write endpoint", !writeExport);

// 2. Every query calls requireAdmin before it touches data.
const unguarded: string[] = [];
for (const name of queryNames) {
  const start = adminSource.indexOf(`export const ${name} = query(`);
  const next = adminSource.indexOf("export const ", start + 1);
  const body = adminSource.slice(start, next === -1 ? undefined : next);
  const guardAt = body.search(/requireAdmin\s*\(/);
  const dataAt = body.search(/ctx\.db\./);
  if (guardAt === -1 || (dataAt !== -1 && guardAt > dataAt)) unguarded.push(name);
}
check("every query calls requireAdmin before any data access", unguarded.length === 0, unguarded.join(", ") || undefined);

check(
  "requireAdmin stays module-private",
  !/export (async )?function requireAdmin|export const requireAdmin/.test(adminSource),
);

// 3. No disclosing property reads — the same detector spec-drift runs with controls.
const DISCLOSING: Array<[string, RegExp]> = [
  [".accountHint", /\.accountHint\b/],
  [".label", /\.label\b/],
  [".email", /\.email\b/],
  [".fingerprint", /\.fingerprint\b/],
  [".cursor", /\.cursor\b/],
];
const disclosing = DISCLOSING.filter(([, re]) => re.test(adminSource)).map(([name]) => name);
check("admin.ts reads no disclosing property", disclosing.length === 0, disclosing.join(", ") || undefined);

check(
  "admin.ts never queries the users table",
  !/\.query\(\s*"users"\s*\)/.test(adminSource),
  "ADR-032: the users table is not read beyond the authorisation check",
);

// 4. Coverage disclosures are present where deployment-wide numbers are
//    produced. Each query names its own honesty vocabulary: the space-sampled
//    aggregates carry `sampled`, and the data-model survey carries `saturated`
//    (a per-table lower-bound flag, the D62 pattern applied to a range).
const COVERAGE_MARKERS: Record<string, RegExp> = {
  agentHealth: /sampled/,
  integrationHealth: /sampled/,
  dataModel: /saturated/,
};
for (const [name, marker] of Object.entries(COVERAGE_MARKERS)) {
  const start = adminSource.indexOf(`export const ${name} = query(`);
  const next = adminSource.indexOf("export const ", start + 1);
  const body = adminSource.slice(start, next === -1 ? undefined : next);
  check(`${name} flags its coverage honestly`, marker.test(body));
}

check(
  "agent proposal reads are capped by the shared registry",
  adminSource.includes("READ_LIMITS.ADMIN_AGENT_PROPOSALS_PER_SPACE"),
);

// 5. D54: the credential stays out of source, and the operator-facing finding
//    names the owner action rather than a credential.
check(
  "D54 — emailOtp.ts reads the key from deployment environment configuration",
  emailOtpSource.includes("PANEL_EMAIL_RELAY_API_KEY"),
);
check(
  "D54 — no credential-shaped literal in the email relay module",
  !/fb_email_[A-Za-z0-9]{8,}/.test(emailOtpSource),
);
check(
  "D54 — the recorded finding still names the outstanding owner action",
  findingsSource.includes('id: "D54"') &&
    /provision/i.test(findingsSource.slice(findingsSource.indexOf('id: "D54"'), findingsSource.indexOf('id: "D54"') + 900)),
);

// 6. Neon stays a health probe.
check("Neon probe runs SELECT 1", /SELECT\s+1/i.test(neonSource));
check(
  "Neon probe contains no data-definition or data-manipulation verb",
  !/\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE)\b/i.test(neonSource),
);

console.log(`\n── pure: the overview composer keeps its honesty rules ──`);

// The composer must degrade to unknown without data, rank worst-of, and carry
// the sampled qualifier. These run in this process — the same module the page
// imports — so a regression here is a regression on screen.
const empty = composeOverview({
  system: null,
  agents: null,
  integrations: null,
  data: null,
  security: null,
  neon: null,
});
check(
  "a section with no input is unknown, never ok",
  empty.sections.every((s) => s.verdict === "unknown") && empty.verdict === "unknown",
);
check("worstVerdict ranks bad above warn above unknown above ok", worstVerdict(["ok", "bad"]) === "bad" && worstVerdict(["ok", "warn"]) === "warn" && worstVerdict(["unknown", "ok"]) === "unknown");
check("an empty verdict set is unknown, not a pass", worstVerdict([]) === "unknown");

const sampled = composeOverview({
  system: null,
  agents: {
    runsObserved: 3,
    failuresObserved: 0,
    cappedObserved: 0,
    overflowObserved: 0,
    sampled: true,
    spacesSampled: 50,
  },
  integrations: null,
  data: null,
  security: null,
  neon: null,
});
const agentsSection = sampled.sections.find((s) => s.id === "agents");
check(
  "sampled agent coverage carries its qualifier",
  agentsSection !== undefined && /sampled/.test(agentsSection.detail ?? ""),
);

note(
  "K1 — authorised admin rendering",
  "NOT VERIFIED. No admin session exists in this environment; the role is grantable only out of band (D64). The refusal side is covered live above and in conformance-admin.ts; the allowed predicate is covered by src/lib/adminAccess.test.ts fixtures.",
);

console.log(`\n======================================================================`);
console.log(`RESULT: ${failed === 0 ? "PASS" : "FAIL"} — ${passed} checks passed, ${failed} failed, ${notes.length} unverified-by-design.`);
if (notes.length > 0) {
  console.log(`\nNOT VERIFIED (reported, not counted as passes):`);
  for (const n of notes) console.log(`  - ${n}`);
}
process.exit(failed === 0 ? 0 : 1);

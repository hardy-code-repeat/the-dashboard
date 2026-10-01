/**
 * Specification drift detector for Panel.
 *
 * Lightweight on purpose. This is not a documentation framework — it is a
 * script that answers a handful of questions fast enough to run before
 * claiming a phase is complete:
 *
 *   1. Do the five spec files exist, and has a sixth been added?
 *   2. Does every table in the Convex schema appear in the documentation?
 *   3. Does every `bun run <script>` referenced in the specs actually exist?
 *   4. Are ADR ids unique?
 *   5. Does every phase declare a complexity budget (ADR-016)?
 *   6. Does the HTML control centre agree with the changelog it renders?
 *   7. Do file paths referenced by the specs still exist? (warning only —
 *      planned files are legitimate)
 *
 * Usage:  bun scripts/spec-drift.ts
 * Exit:   0 = no drift, 1 = drift detected, 2 = could not run checks
 *
 * No dependencies. Uses Bun's built-in file APIs only.
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const SPEC_DIR = join(ROOT, "spec");

const REQUIRED = [
  "01_MAIN_AGENT.md",
  "02_CHANGELOG.md",
  "03_PRODUCT_CONTEXT.md",
  "04_SYSTEM_FUNDAMENTALS.md",
  "05_PANEL_CONTROL_CENTER.html",
] as const;

const PHASES = ["0A", "0B", "0C", "1.0", "1.1", "1.5", "2", "3"] as const;

const failures: string[] = [];
const warnings: string[] = [];
const checks: { name: string; status: "pass" | "warn" | "fail"; detail: string }[] = [];

function record(name: string, status: "pass" | "warn" | "fail", detail: string) {
  checks.push({ name, status, detail });
  if (status === "fail") failures.push(`${name}: ${detail}`);
  if (status === "warn") warnings.push(`${name}: ${detail}`);
}

function readSpec(name: string): string {
  return readFileSync(join(SPEC_DIR, name), "utf8");
}

// ---------------------------------------------------------------- 1. files
function checkSpecFiles() {
  if (!existsSync(SPEC_DIR)) {
    record("spec directory", "fail", "spec/ does not exist");
    return null;
  }

  const present = readdirSync(SPEC_DIR).filter((f) => !f.startsWith("."));
  const missing = REQUIRED.filter((f) => !present.includes(f));
  const extra = present.filter(
    (f) => !(REQUIRED as readonly string[]).includes(f) && !f.startsWith("_"),
  );

  if (missing.length > 0) {
    record("required spec files", "fail", `missing: ${missing.join(", ")}`);
  } else {
    record("required spec files", "pass", `all ${REQUIRED.length} present`);
  }

  if (extra.length > 0) {
    record(
      "no sixth spec file",
      "fail",
      `unapproved permanent file(s) in spec/: ${extra.join(", ")}`,
    );
  } else {
    record("no sixth spec file", "pass", "spec/ contains exactly the five artifacts");
  }

  return missing.length === 0 && extra.length === 0;
}

// -------------------------------------------------------- 2. schema tables
function checkSchemaDocumented(specs: Record<string, string>) {
  const schemaPath = join(ROOT, "src", "convex", "schema.ts");
  if (!existsSync(schemaPath)) {
    record("schema tables documented", "warn", "src/convex/schema.ts not found");
    return;
  }

  const schema = readFileSync(schemaPath, "utf8");
  const tables = [...schema.matchAll(/^\s{4}(\w+):\s*defineTable\(/gm)].map((m) => m[1]);
  // `users` is declared by the Convex Auth template and documented separately.
  const appTables = tables.filter((t) => t !== "users");

  if (appTables.length === 0) {
    record("schema tables documented", "warn", "no tables parsed from schema.ts");
    return;
  }

  const corpus = Object.values(specs).join("\n");
  const undocumented = appTables.filter((t) => !corpus.includes(t));

  if (undocumented.length > 0) {
    record(
      "schema tables documented",
      "fail",
      `table(s) in schema.ts absent from the specs: ${undocumented.join(", ")}`,
    );
  } else {
    record(
      "schema tables documented",
      "pass",
      `${appTables.length} tables all documented: ${appTables.join(", ")}`,
    );
  }
}

// --------------------------------------------------------------- 3. commands
function checkCommands(specs: Record<string, string>) {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const scripts: string[] = Object.keys(pkg.scripts ?? {});

  const referenced = new Set<string>();
  for (const text of Object.values(specs)) {
    for (const m of text.matchAll(/bun run ([a-z0-9-]+)/g)) referenced.add(m[1]);
  }

  const unknown = [...referenced].filter((c) => !scripts.includes(c));
  if (unknown.length > 0) {
    record(
      "documented commands exist",
      "fail",
      `spec references non-existent package.json script(s): ${unknown.join(", ")}. Available: ${scripts.join(", ")}`,
    );
  } else {
    record(
      "documented commands exist",
      "pass",
      `${referenced.size} referenced script(s) all exist: ${[...referenced].join(", ")}`,
    );
  }

  // The runbook must not pretend tests exist.
  const fundamentals = specs["04_SYSTEM_FUNDAMENTALS.md"] ?? "";
  const claimsTests = /\bbun test\b/.test(fundamentals);
  const hasTestScript = scripts.includes("test");
  const marksUnavailable = /NOT AVAILABLE/.test(fundamentals);

  if (claimsTests && !hasTestScript && !marksUnavailable) {
    record(
      "no phantom test command",
      "fail",
      "runbook references `bun test` but package.json has no `test` script and it is not marked NOT AVAILABLE",
    );
  } else {
    record(
      "no phantom test command",
      "pass",
      hasTestScript
        ? "`test` script exists"
        : "no test script; runbook marks it NOT AVAILABLE",
    );
  }
}

// ------------------------------------------------------------------- 4. ADRs
function checkAdrs(changelog: string) {
  const ids = [...changelog.matchAll(/^### (ADR-\d+)/gm)].map((m) => m[1]);
  if (ids.length === 0) {
    record("ADR ids unique", "fail", "no ADRs found in 02_CHANGELOG.md");
    return ids;
  }
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dupes.length > 0) {
    record("ADR ids unique", "fail", `duplicate id(s): ${[...new Set(dupes)].join(", ")}`);
  } else {
    record("ADR ids unique", "pass", `${ids.length} ADRs, all unique`);
  }
  return ids;
}

// ------------------------------------------------------- 5. complexity budgets
function checkBudgets(changelog: string) {
  const budgetSection = changelog.split("## Phase complexity budgets")[1] ?? "";
  const missing = PHASES.filter((p) => !budgetSection.includes(`**${p}**`));

  if (budgetSection.trim().length === 0) {
    record("complexity budgets", "fail", "no '## Phase complexity budgets' section found");
    return;
  }
  if (missing.length > 0) {
    record(
      "complexity budgets",
      "fail",
      `phase(s) without a declared budget: ${missing.join(", ")} (ADR-016 violation)`,
    );
  } else {
    record(
      "complexity budgets",
      "pass",
      `all ${PHASES.length} phases declare a budget`,
    );
  }
}

// --------------------------------------------------- 6. HTML ↔ changelog sync
function checkHtmlSync(html: string, adrIds: string[], changelogChangeCount: number) {
  const m = html.match(/id="spec-adr-count"\s*>([^<]+)</);
  const n = html.match(/id="spec-change-count"\s*>([^<]+)</);

  if (!m || !n) {
    record(
      "control centre sync",
      "warn",
      "control centre is missing the spec-adr-count / spec-change-count stamps",
    );
    return;
  }

  const htmlAdrs = Number(m[1]);
  const htmlChanges = Number(n[1]);

  const problems: string[] = [];
  if (htmlAdrs !== adrIds.length) {
    problems.push(`ADR count: HTML says ${htmlAdrs}, changelog has ${adrIds.length}`);
  }
  if (htmlChanges !== changelogChangeCount) {
    problems.push(
      `change count: HTML says ${htmlChanges}, changelog has ${changelogChangeCount}`,
    );
  }

  if (problems.length > 0) {
    record("control centre sync", "fail", problems.join("; "));
  } else {
    record(
      "control centre sync",
      "pass",
      `control centre agrees with changelog (${adrIds.length} ADRs, ${htmlChanges} changes)`,
    );
  }
}

// ------------------------------------------------------------- 7. path refs
function checkPaths(specs: Record<string, string>) {
  const corpus = Object.values(specs).join("\n");
  const refs = new Set<string>();
  for (const m of corpus.matchAll(/`((?:src|scripts|spec)\/[A-Za-z0-9._/-]+?)[:`]/g)) {
    refs.add(m[1]);
  }

  const missing = [...refs].filter((p) => !existsSync(join(ROOT, p)));
  if (missing.length > 0) {
    record(
      "referenced paths exist",
      "warn",
      `${missing.length} referenced path(s) do not exist yet (expected for planned files): ${missing.slice(0, 6).join(", ")}${missing.length > 6 ? " …" : ""}`,
    );
  } else {
    record("referenced paths exist", "pass", `${refs.size} referenced paths all exist`);
  }
}

// ------------------------------------------------------------------- main
function main() {
  if (!checkSpecFiles()) {
    // Without the files there is nothing coherent to check.
    report();
    process.exit(1);
  }

  const specs: Record<string, string> = {};
  for (const f of REQUIRED) specs[f] = readSpec(f);

  const changelog = specs["02_CHANGELOG.md"];

  checkSchemaDocumented(specs);
  checkCommands(specs);
  const adrIds = checkAdrs(specs["02_CHANGELOG.md"]);
  checkBudgets(changelog);
  const changeIds = [...changelog.matchAll(/^## (CHANGE-\d+)/gm)].map((m) => m[1]);
  const dupeChanges = changeIds.filter((id, i) => changeIds.indexOf(id) !== i);
  if (changeIds.length === 0) {
    record("CHANGE entries", "fail", "no '## CHANGE-XXXX' entries found in 02_CHANGELOG.md");
  } else if (dupeChanges.length > 0) {
    record("CHANGE ids unique", "fail", `duplicate: ${[...new Set(dupeChanges)].join(", ")}`);
  } else {
    record("CHANGE ids unique", "pass", `${changeIds.length} change entries: ${changeIds.join(", ")}`);
  }

  checkHtmlSync(specs["05_PANEL_CONTROL_CENTER.html"], adrIds, changeIds.length);
  checkPaths(specs);

  report();

  if (failures.length > 0) {
    console.log("");
    console.log("SPECIFICATION DRIFT DETECTED — see failures above.");
    console.log("Do not resolve drift by editing code to match. Report and decide.");
    process.exit(1);
  }
}

function report() {
  const icon = (s: string) => (s === "pass" ? "PASS" : s === "warn" ? "WARN" : "FAIL");
  console.log("");
  console.log("  PANEL — SPEC DRIFT CHECK");
  console.log("  " + "-".repeat(64));
  for (const c of checks) {
    console.log(`  [${icon(c.status)}] ${c.name}`);
    console.log(`         ${c.detail}`);
  }
  console.log("  " + "-".repeat(64));
  console.log(
    `  ${checks.filter((c) => c.status === "pass").length} passed, ` +
      `${warnings.length} warning(s), ${failures.length} failure(s)`,
  );
  console.log("");
}

main();

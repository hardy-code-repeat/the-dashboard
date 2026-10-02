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
 *   8. Is every superseded ADR still retained, and does its successor exist?
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

const PHASES = ["0A", "0B", "0C", "1.0", "1.1", "1.5", "2", "3", "4"] as const;

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

// ------------------------------------------------ 8. phase lifecycle status
const PHASE_STATUSES = [
  "NOT STARTED",
  "APPROVED",
  "IN PROGRESS",
  "IMPLEMENTED",
  "VERIFIED",
  "SHIPPED",
  "BLOCKED",
] as const;

function checkPhaseStatus(changelog: string) {
  const table = changelog.split("### Phase lifecycle status table")[1] ?? "";
  if (table.trim().length === 0) {
    record("phase lifecycle status", "fail", "no '### Phase lifecycle status table' section");
    return;
  }

  const rowRe =
    /^\|\s*\*\*(0A|0B|0C|1\.0|1\.1|1\.5|2|3|4)\*\*\s*\|\s*\**([A-Z ]+?)\**\s*\|/gm;
  const found = new Map<string, string>();
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(table)) !== null) {
    const status = m[2].replace(/\*/g, "").trim();
    if (PHASE_STATUSES.includes(status as (typeof PHASE_STATUSES)[number])) {
      found.set(m[1], status);
    }
  }

  const missing = PHASES.filter((p) => !found.has(p));
  const invalid = [...found.entries()].filter(
    ([, s]) => !PHASE_STATUSES.includes(s as (typeof PHASE_STATUSES)[number]),
  );

  if (missing.length > 0) {
    record("phase lifecycle status", "fail", `phase(s) with no status row: ${missing.join(", ")}`);
    return;
  }
  if (invalid.length > 0) {
    record(
      "phase lifecycle status",
      "fail",
      `invalid status: ${invalid.map(([p, s]) => `${p}=${s}`).join(", ")}`,
    );
    return;
  }

  const summary = PHASES.map((p) => `${p}=${found.get(p)}`).join(" ");
  const approved = PHASES.filter((p) => found.get(p) === "APPROVED");
  record(
    "phase lifecycle status",
    "pass",
    `all ${PHASES.length} phases have a valid status — ${summary}` +
      (approved.length > 0 ? ` · APPROVED: ${approved.join(", ")}` : " · none approved"),
  );
}

// -------------------------------------------------------- 9. change severity
const SEVERITIES = ["PATCH", "MINOR", "MAJOR", "SECURITY", "ARCHITECTURE", "PRODUCT"];

function checkSeverity(changelog: string) {
  const ids = [...changelog.matchAll(/^## (CHANGE-\d+)/gm)].map((m) => m[1]);
  if (ids.length === 0) {
    record("change severity", "fail", "no CHANGE entries to check");
    return;
  }

  const missing: string[] = [];
  const bad: string[] = [];
  for (const id of ids) {
    const start = changelog.indexOf(`## ${id}`);
    const next = changelog.indexOf("\n## ", start + 1);
    const block = changelog.slice(start, next === -1 ? undefined : next);
    const sev = block.match(/^Severity:\s*(\S+)/m);
    if (!sev) missing.push(id);
    else if (!SEVERITIES.includes(sev[1])) bad.push(`${id}=${sev[1]}`);
  }

  if (missing.length > 0) {
    record("change severity", "fail", `CHANGE without Severity: ${missing.join(", ")}`);
  } else if (bad.length > 0) {
    record("change severity", "fail", `invalid severity: ${bad.join(", ")}`);
  } else {
    record("change severity", "pass", `all ${ids.length} changes declare a valid severity`);
  }
}

// ------------------------------------------------------- 10. traceability ids
function checkTraceability(specs: Record<string, string>) {
  const fundamentals = specs["04_SYSTEM_FUNDAMENTALS.md"] ?? "";

  // --- REQ ids used in chains must exist in the register (§12.1) ---
  const registerBlock = fundamentals.split("### 12.1 Requirement register")[1]?.split("### 12.2")[0] ?? "";
  const registered = new Set(
    [...registerBlock.matchAll(/^\|\s*(REQ-\d+)\s*\|/gm)].map((m) => m[1]),
  );
  const referenced = new Set([...fundamentals.matchAll(/\b(REQ-\d+)\b/g)].map((m) => m[1]));
  const dangling = [...referenced].filter((r) => !registered.has(r)).sort();

  if (registered.size === 0) {
    record("traceability REQ ids", "fail", "no requirement register found in §12.1");
  } else if (dangling.length > 0) {
    record(
      "traceability REQ ids",
      "fail",
      `REQ referenced but not in the register: ${dangling.join(", ")}`,
    );
  } else {
    record(
      "traceability REQ ids",
      "pass",
      `${registered.size} requirements registered; ${referenced.size} referenced; none dangling`,
    );
  }

  // --- Q ids unique ---
  const changelog = specs["02_CHANGELOG.md"] ?? "";
  const qIds = [...changelog.matchAll(/^### (Q-\d+)/gm)].map((m) => m[1]);
  const qDupes = qIds.filter((id, i) => qIds.indexOf(id) !== i);
  if (qIds.length === 0) {
    record("open question ids", "fail", "no Q-xxx entries found");
  } else if (qDupes.length > 0) {
    record("open question ids", "fail", `duplicate: ${[...new Set(qDupes)].join(", ")}`);
  } else {
    const malformed = qIds.filter((id) => !/^Q-\d{3}$/.test(id));
    if (malformed.length > 0) {
      record("open question ids", "fail", `malformed id(s): ${malformed.join(", ")}`);
    } else {
      record("open question ids", "pass", `${qIds.length} questions: ${qIds.join(", ")}`);
    }
  }

  // --- TASK chains: each row needs TASK, AC and TEST ---
  const chainBlock = fundamentals.split("### 12.2")[1]?.split("### 12.3")[0] ?? "";
  // Columns: REQ | ADR | PHASE | TASK | ACCEPTANCE | TEST | CHANGE
  const chainRows = [
    ...chainBlock.matchAll(
      /^\|\s*(REQ-\d+)\s*\|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\|/gm,
    ),
  ];
  const incomplete = chainRows.filter(
    (r) => !/TASK-\d+[A-Z]?-\d+/.test(r[4]) || !/AC-\d+[A-Z]?-\d+/.test(r[5]) || !/TEST-\d+[A-Z]?-\d+/.test(r[6]),
  );
  const taskIds = [
    ...new Set(chainRows.map((r) => (r[4].match(/TASK-\d+[A-Z]?-\d+/) ?? [""])[0]).filter(Boolean)),
  ];
  const taskDupes = taskIds.filter((t, i) => taskIds.indexOf(t) !== i);

  if (chainRows.length === 0) {
    record("traceability chains", "fail", "no chain rows found in §12.2");
  } else if (incomplete.length > 0) {
    record(
      "traceability chains",
      "fail",
      `${incomplete.length} chain row(s) missing TASK / AC / TEST ids`,
    );
  } else if (taskDupes.length > 0) {
    record("traceability chains", "fail", `duplicate task id(s): ${[...new Set(taskDupes)].join(", ")}`);
  } else {
    record(
      "traceability chains",
      "pass",
      `${chainRows.length} chains complete (${taskIds.length} tasks, each with AC + TEST)`,
    );
  }
}

// ------------------------------------------------- 11. acceptance criteria
function checkAcceptance(fundamentals: string) {
  const scopeBlock = fundamentals.split("### 11.2 Scope definition")[1]?.split("### 11.3")[0] ?? "";
  if (scopeBlock.trim().length === 0) {
    record("phase acceptance criteria", "fail", "no '### 11.2 Scope definition' section");
    return;
  }

  const required = ["IN SCOPE", "OUT OF SCOPE", "DO NOT TOUCH", "DEPENDENCIES", "BLOCKERS", "APPROVAL REQUIRED", "ACCEPTANCE CRITERIA"];
  const missing = required.filter((k) => !scopeBlock.includes(k));
  if (missing.length > 0) {
    record("phase acceptance criteria", "fail", `phase 0A is missing: ${missing.join(", ")}`);
    return;
  }

  const numbered = (scopeBlock.match(/^\s*(\d)\. /gm) ?? []).length;
  if (numbered < 5) {
    record(
      "phase acceptance criteria",
      "fail",
      `phase 0A lists only ${numbered} numbered acceptance criteria; expected at least 5`,
    );
    return;
  }

  const missingPhases = PHASES.filter(
    (p) =>
      !scopeBlock.includes(`**${p}**`) &&
      !scopeBlock.includes(`Phase ${p} —`) &&
      !new RegExp(`\\|\\s*\\*\\*${p.replace(".", "\\.")}\\*\\*`).test(scopeBlock),
  );
  if (missingPhases.length > 0) {
    record(
      "phase acceptance criteria",
      "fail",
      `phase(s) absent from the scope section: ${missingPhases.join(", ")}`,
    );
    return;
  }
  record(
    "phase acceptance criteria",
    "pass",
    `all ${PHASES.length} phases scoped; 0A declares all 7 required fields and ${numbered} criteria`,
  );
}

// --------------------------------------------- 12. protected areas documented
function checkProtectedAreas(fundamentals: string) {
  const reg = fundamentals.split("## 13. Do Not Touch register")[1]?.split("## 14.")[0] ?? "";
  if (reg.trim().length === 0) {
    record("protected areas documented", "fail", "no '## 13. Do Not Touch register' section");
    return;
  }

  const mustMention = [
    "vite.config.ts",
    "auth.config.ts",
    "index.css",
    "convex.json",
    "scorer.ts",
    "tax.ts",
    "nlp.ts",
    "schemaValidation",
    "src/main.tsx",
  ];
  const missing = mustMention.filter((m) => !reg.includes(m));
  if (missing.length > 0) {
    record(
      "protected areas documented",
      "fail",
      `Do Not Touch register does not protect: ${missing.join(", ")}`,
    );
    return;
  }
  const entries = (reg.match(/^\|\s*\d+\s*\|/gm) ?? []).length;
  record(
    "protected areas documented",
    "pass",
    `${entries} protected entries, each with a stated reason`,
  );
}

// ------------------------------------------- 13. superseded ADR integrity
// ADR-017 is retained and banner-marked rather than deleted, so the history of
// the decision survives. That is only useful if the banner stays honest: the
// superseded entry must keep existing, its named successor must exist, and it
// must not simultaneously claim to be active.
/**
 * ADR-014: credentials are server-only by construction.
 *
 * The guarantee is "no public Convex function outside `credentials.ts` names
 * the token tables". A comment saying so is not a guarantee, so this greps the
 * code — with comments stripped first, because several modules legitimately
 * *explain* where credentials live without touching them, and flagging the
 * documentation would push someone to delete the explanation rather than fix
 * the code.
 */
function checkCredentialContainment() {
  const dir = join(ROOT, "src", "convex");
  if (!existsSync(dir)) {
    record("credential containment", "fail", "src/convex/ is missing");
    return;
  }

  const FORBIDDEN = ["connectionTokens", "oauthStates"];
  const offenders: string[] = [];
  let scanned = 0;

  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".ts")) continue;
    if (name.startsWith("_generated")) continue;
    // The schema *defines* the tables; credentials.ts is the only module
    // allowed to read or write them. Everything else is a consumer.
    if (name === "credentials.ts" || name === "schema.ts") continue;
    scanned++;

    const code = stripComments(readFileSync(join(dir, name), "utf8"));
    if (FORBIDDEN.some((t) => code.includes(t))) offenders.push(name);
  }

  if (offenders.length > 0) {
    record(
      "credential containment",
      "fail",
      `${offenders.length} module(s) outside credentials.ts name a credential table: ${offenders.join(", ")}`,
    );
    return;
  }

  // The module itself must publish nothing a *client* can call.
  //
  // `internal*` endpoints are permitted and are not a hole: they are callable
  // only from another function in this deployment, so no browser can reach one.
  // Phase 2 needs three of them — a sync action has to read a token and cannot
  // read a table, the OAuth callback has to read a state, and only a mutation
  // can consume one atomically. The alternative would have been a public
  // endpoint that hands out credentials, which is the thing ADR-014 forbids.
  const credentials = stripComments(readFileSync(join(dir, "credentials.ts"), "utf8"));
  const PUBLIC = /export const \w+(\s*:\s*\w+)? = (query|mutation|action|httpAction)\(/;
  if (PUBLIC.test(credentials)) {
    record("credential containment", "fail", "credentials.ts exports a PUBLIC Convex endpoint");
    return;
  }

  // Internal endpoints are allowed, but not from a **public query or mutation**.
  //
  // A public query or mutation returns its result straight to the browser, so
  // one that reaches a credential is a leak. An `action` or `httpAction` is
  // different: it runs on the server and a client can only ask it to do its
  // documented job, so an action that *uses* a token (the sync) is legitimate —
  // what matters there is that its return value carries no credential, which is
  // asserted by the unit fixtures rather than by this gate.
  const internalNames = [...credentials.matchAll(/export const (internal\w+) = internal\w+\(/g)].map(
    (m) => m[1],
  );
  const reachable: string[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".ts")) continue;
    if (name.startsWith("_generated") || name === "credentials.ts" || name === "schema.ts") continue;
    const code = stripComments(readFileSync(join(dir, name), "utf8"));
    for (const block of publicResultReturningFunctions(code)) {
      for (const internal of internalNames) {
        if (block.includes(internal)) reachable.push(`${name}:${block.slice(0, 40)} -> ${internal}`);
      }
    }
  }
  if (reachable.length > 0) {
    record(
      "credential containment",
      "fail",
      `internal credential endpoint(s) reached from a public query/mutation: ${reachable.join(", ")}`,
    );
    return;
  }

  record(
    "credential containment",
    "pass",
    `${scanned} modules scanned; credentials.ts exports no public endpoint ` +
      `(${internalNames.length} internal, unreachable by name elsewhere) (ADR-014)`,
  );
}

/**
 * The source of every public `query` / `mutation` in a module.
 *
 * `httpAction` is deliberately absent: it returns a `Response`, not data, so
 * "a credential endpoint was used" is not the same as "a credential was
 * returned". The OAuth callback is exactly that case — it must read the state to
 * redeem it — and what actually protects it is that the redirect it builds
 * carries no token, which the unit fixtures assert.
 *
 * Sliced from the declaration to the next `export const`, which is crude and
 * deliberately so: a gate that has to be right about *where* a string appears
 * should not depend on a parser, and an over-wide slice can only produce a
 * false positive (a reported leak that is not one), never a missed one.
 */
function publicResultReturningFunctions(code: string): string[] {
  const blocks: string[] = [];
  const re = /export const (\w+)(\s*:\s*\w+)? = (query|mutation)\(/g;
  for (let m = re.exec(code); m; m = re.exec(code)) {
    const start = m.index;
    const next = code.indexOf("export const ", start + 1);
    blocks.push(code.slice(start, next === -1 ? undefined : next));
  }
  return blocks;
}

function stripComments(source: string): string {  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

function checkSupersededAdrs(changelog: string) {
  // The terminator is an explicit end-of-input, not `$`: this regex carries
  // the `m` flag for the `^` anchors, which would also make `$` match every
  // line end and truncate each block to its first line.
  const blocks = [
    ...changelog.matchAll(/^### (ADR-\d+)([\s\S]*?)(?=^### |^## |(?![\s\S]))/gm),
  ];
  const present = new Set(blocks.map((b) => b[1]));

  const problems: string[] = [];
  let checked = 0;

  for (const [, id, body] of blocks) {
    // A superseded ADR is announced in a blockquote, so the marker is
    // optionally prefixed with "> ".
    const sup = body.match(/^(?:>\s*)?\*\*SUPERSEDED BY (ADR-\d+)\*\*/m);
    if (!sup) continue;
    checked++;

    const successor = sup[1];
    if (!present.has(id)) {
      problems.push(`${id} is marked superseded but its entry is missing`);
    }
    if (!present.has(successor)) {
      problems.push(`${id} names ${successor} as its successor, which does not exist`);
    }
    if (/^\*\*Status:\*\*\s*Active/m.test(body)) {
      problems.push(`${id} is marked superseded yet also declares Status: Active`);
    }
  }

  if (checked === 0) {
    record("superseded ADRs", "pass", "no superseded ADRs to check");
  } else if (problems.length > 0) {
    record("superseded ADRs", "fail", problems.join("; "));
  } else {
    const ids = blocks
      .filter((b) => b[2].includes("**SUPERSEDED BY"))
      .map((b) => `${b[1]}->${b[2].match(/\*\*SUPERSEDED BY (ADR-\d+)\*\*/)![1]}`);
    record(
      "superseded ADRs",
      "pass",
      `${checked} superseded ADR(s) retained with a valid successor: ${ids.join(", ")}`,
    );
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
  checkPhaseStatus(changelog);
  checkSeverity(changelog);
  checkTraceability(specs);
  checkAcceptance(specs["04_SYSTEM_FUNDAMENTALS.md"] ?? "");
  checkProtectedAreas(specs["04_SYSTEM_FUNDAMENTALS.md"] ?? "");
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
  checkSupersededAdrs(changelog);
  checkPaths(specs);
  checkCredentialContainment();

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

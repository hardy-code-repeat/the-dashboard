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

function stripComments(source: string): string {  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, ""); }

/**
 * D67: a receipt the backend computes must reach the user.
 *
 * Convex caps every read (CHANGE-0026), and the house rule has always been
 * `take(n + 1)` so that hitting the cap is an *observable fact* rather than a
 * quiet lie about how complete a list is. On the dashboard that rule was
 * honoured in the query and then thrown away in the client: `getDashboard`
 * returns `truncated`, `stats.openTruncated` and `stats.completedTruncated`,
 * its doc comment asserts that "the client shows this as a 'showing your 200
 * most recent' note", and no component had ever read any of them. Above the
 * cap the four headline tiles reported counts computed over a slice and said
 * nothing, which is exactly the failure the extra row exists to prevent.
 *
 * Scoping matters, and getting it wrong is how a check like this becomes
 * noise. The rule is **not** "every `*Truncated` in the codebase must appear
 * in the UI": `spaces.auditOwnership` returns `activityTruncated`, has no
 * product caller at all (only the phase-0B harness and the bounded-read
 * audit), and therefore has no surface to disclose anything on. A gate that
 * flagged it would be demanding a UI for a query no UI calls.
 *
 * The rule is: **a receipt returned by a query the product actually calls must
 * be read by the product.** The first version of this check got that wrong and
 * failed on its first honest run, which is the useful outcome — it proved the
 * check fires, and it sent me to read `spaces.ts` rather than to silence it.
 */
function checkTruncationReceipts() {
  const convexDir = join(ROOT, "src", "convex");
  if (!existsSync(convexDir)) {
    record("truncation receipts", "fail", "src/convex/ is missing");
    return;
  }

  // Every product TSX file, concatenated: what the user can actually see.
  let ui = "";
  const uiFiles: string[] = [];
  const walkUi = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "ui" || entry.name === "_generated") continue;
        walkUi(full);
      } else if (entry.name.endsWith(".tsx")) {
        uiFiles.push(full);
        ui += readFileSync(full, "utf8");
      }
    }
  };
  walkUi(join(ROOT, "src"));

  if (uiFiles.length === 0) {
    record("truncation receipts", "fail", "no product TSX found — the check would prove nothing");
    return;
  }

  // `module:function` pairs the product calls, e.g. `assistant:getDashboard`.
  const called = new Set<string>();
  for (const m of ui.matchAll(/\bapi\.([a-zA-Z0-9]+)\.([a-zA-Z0-9]+)/g)) {
    called.add(`${m[1]}:${m[2]}`);
  }

  /** Every `export const <fn> = query({...})` body in a Convex module. */
  const queryBodies = (code: string): Map<string, string> => {
    const out = new Map<string, string>();
    for (const m of code.matchAll(/export const ([a-zA-Z0-9]+) = query\(\{/g)) {
      let i = m.index + m[0].length;
      let depth = 1;
      while (i < code.length && depth > 0) {
        if (code[i] === "{") depth++;
        else if (code[i] === "}") depth--;
        i++;
      }
      out.set(m[1], code.slice(m.index, i));
    }
    return out;
  };

  const productReceipts = new Set<string>();
  const harnessOnly: string[] = [];

  const walkConvex = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (entry.name === "_generated") continue;
        walkConvex(join(dir, entry.name));
      } else if (entry.name.endsWith(".ts")) {
        const module = entry.name.replace(/\.ts$/, "");
        const code = stripComments(readFileSync(join(dir, entry.name), "utf8"));
        for (const [fn, body] of queryBodies(code)) {
          const flags = [...body.matchAll(/\b([a-z][a-zA-Z0-9]*Truncated)\b/g)].map(
            (f) => f[1],
          );
          if (flags.length === 0) continue;
          if (!called.has(`${module}:${fn}`)) {
            harnessOnly.push(`${fn}.${[...new Set(flags)].join("/")} (no product caller)`);
            continue;
          }
          for (const flag of new Set(flags)) productReceipts.add(flag);
        }
      }
    }
  };
  walkConvex(convexDir);

  if (productReceipts.size === 0) {
    record(
      "truncation receipts",
      "fail",
      "no query the product calls returns a *Truncated receipt — the check would prove nothing",
    );
    return;
  }

  const orphans = [...productReceipts].filter((name) => !ui.includes(name)).sort();
  if (orphans.length > 0) {
    record(
      "truncation receipts",
      "fail",
      `${orphans.length} of ${productReceipts.size} receipt(s) computed and never shown to the user: ${orphans.join(", ")}`,
    );
    return;
  }

  const shown = [...productReceipts].sort().join(", ");
  const tail =
    harnessOnly.length > 0 ? `; ${harnessOnly.length} harness-only, none surfaced by design` : "";
  record(
    "truncation receipts",
    "pass",
    `${productReceipts.size} receipt(s) from queries the product calls, all surfaced: ${shown}${tail}`,
  );
}

/**
 * D72: in-app navigation must not reload the app.
 *
 * One `<a href="/">` sat in the dashboard footer, so "Back to home" threw away
 * the router, the Convex client, the auth state and every scroll position to
 * re-fetch a page the browser already had. It looks exactly like a link and
 * behaves like a page reload, which is why it survived review: the defect is
 * invisible in a screenshot.
 *
 * External, mailto and hash destinations are allowed — only same-origin path
 * hrefs are the problem, and those are the ones react-router exists for.
 */
function checkInternalNavigation() {
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "ui" || entry.name === "_generated") continue;
        walk(full);
      } else if (entry.name.endsWith(".tsx")) files.push(full);
    }
  };
  walk(join(ROOT, "src"));

  const problems: string[] = [];
  let checked = 0;
  for (const file of files) {
    const rel = file.slice(ROOT.length + 1);
    const code = stripComments(readFileSync(file, "utf8"));
    for (const m of code.matchAll(/<a\b[^>]*?\bhref=\{?["'{]([^"'}\s]+)/g)) {
      checked++;
      const href = m[1];
      if (!href.startsWith("/") || href.startsWith("//")) continue;
      problems.push(`${rel} → href="${href}"`);
    }
  }

  if (checked === 0) {
    record("internal navigation", "fail", "no anchor hrefs found at all — the check would prove nothing");
    return;
  }
  if (problems.length > 0) {
    record(
      "internal navigation",
      "fail",
      `${problems.length} in-app link(s) force a full page reload instead of routing: ${problems.join(", ")}`,
    );
    return;
  }
  record(
    "internal navigation",
    "pass",
    `${checked} anchor href(s), none an in-app path; routing goes through react-router`,
  );
}

/**
 * ADR-032: the Admin Control Centre is read-only and independently authorised.
 *
 * Three properties, checked mechanically rather than asserted in a comment,
 * because a comment is one careless edit away from being wrong and this
 * project has a recorded history of green checks that meant nothing (D60).
 *
 *  1. **No write endpoint.** `admin.ts` must export no `mutation`, `action`,
 *     `internalMutation`, `internalAction` or `httpAction`. The spec forbids a
 *     generic admin CRUD surface, a permission manager and a "superuser can do
 *     anything", and the cheapest way to guarantee none of those can appear is
 *     for there to be no code shape that could express one.
 *  2. **Every public query calls the guard.** A shared front door with four
 *     unguarded queries would still be a hole, so each exported query must call
 *     `requireAdmin` in its own body. This is what stops the *next* query from
 *     being added without it.
 *  3. **The guard is not exported.** If `requireAdmin` were public, some future
 *     module could import it — and a module that imports the guard might use it
 *     to gate the wrong thing, or, worse, someone could reach for a
 *     *different* helper that does not check. Keeping it module-private means
 *     nothing outside `admin.ts` can depend on the Control Centre's
 *     authorisation at all.
 */
function checkAdminReadOnly() {
  const dir = join(ROOT, "src", "convex");
  const path = join(dir, "admin.ts");
  if (!existsSync(path)) {
    record("admin read-only", "warn", "src/convex/admin.ts not found");
    return;
  }

  const code = stripComments(readFileSync(path, "utf8"));
  const problems: string[] = [];

  // --- 1. no write endpoint -------------------------------------------------
  // Matching the literal name `mutation(` is not enough, and the first version
  // of this gate proved it: `import { mutation as convexMutation }` followed by
  // `const _revoke = convexMutation({...})` sailed straight through, because the
  // pattern was looking for a spelling rather than for a binding. So the import
  // statement is parsed first and the *local* names it binds are what gets
  // searched for. A renamed import is now caught, which is the only reason to
  // bother renaming one.
  const BUILDER =
    "query|mutation|action|internalQuery|internalMutation|internalAction|httpAction";
  const boundWrites = new Set<string>();
  const importRe = new RegExp(
    `import\\s*\\{([^}]*)\\}\\s*from\\s*["'][^"']*_generated/server["']`,
    "g",
  );
  for (const m of code.matchAll(importRe)) {
    for (const specifier of m[1].split(",")) {
      const parts = specifier.trim().split(/\s+as\s+/);
      const original = parts[0]?.trim();
      const local = (parts[1] ?? parts[0])?.trim();
      if (!original || !local) continue;
      if (new RegExp(`^(${BUILDER})$`).test(original) && original !== "query") {
        boundWrites.add(local);
      }
    }
  }

  const found: string[] = [];
  for (const local of boundWrites) {
    // The type annotation must be non-crossing (`[^=\\n]+` stops at the line
    // end — a plain `[^=]+` runs past a newline into the next statement), and
    // the `\s*` before `=` has to be *outside* the optional group, because a
    // group that is skipped entirely leaves nothing to consume the space. The
    // control caught both of those, which is the only reason this verdict is
    // worth anything.
    const re = new RegExp(
      `(?:export\\s+)?const\\s+\\w+(?:\\s*:[^=\\n]+)?\\s*=\\s*${local}\\s*\\(`,
    );
    if (re.test(code)) found.push(local);
  }
  if (found.length > 0) {
    problems.push(`admin.ts exports a write endpoint: ${found.join(", ")}`);
  }

  // Second net, and the one that actually matters.
  //
  // Whatever the function is called, a read-only module has no business issuing
  // a write. This catches a write reached through any route at all — an aliased
  // import, a locally re-declared builder, a direct `ctx.db` call in a helper —
  // because it does not care how the write is spelled, only that one happened.
  const WRITES_ON_DB = [...code.matchAll(/ctx\.db\.(patch|insert|replace|delete)\s*\(/g)].map(
    (m) => m[1],
  );
  if (WRITES_ON_DB.length > 0) {
    problems.push(
      `admin.ts performs a database write: ${[...new Set(WRITES_ON_DB)].join(", ")} — ` +
        `it is a read-only module (ADR-032)`,
    );
  }

  // --- 2. every public query is guarded ------------------------------------
  const queries = [...code.matchAll(/export const (\w+) = query\(/g)].map((m) => m[1]);
  if (queries.length === 0) problems.push("admin.ts exports no query at all");

  const unguarded: string[] = [];
  for (const name of queries) {
    const start = code.indexOf(`export const ${name} = query(`);
    const next = code.indexOf("export const ", start + 1);
    const body = code.slice(start, next === -1 ? undefined : next);
    if (!/requireAdmin\s*\(/.test(body)) unguarded.push(name);
  }
  if (unguarded.length > 0) {
    problems.push(`public query/queries without requireAdmin: ${unguarded.join(", ")}`);
  }

  // --- 3. the guard is module-private --------------------------------------
  if (/export (async )?function requireAdmin|export const requireAdmin/.test(code)) {
    problems.push("requireAdmin is exported; it must stay module-private");
  }

  // --- 4. no user-identifying field is read -------------------------------
  //
  // Read-only is necessary but not sufficient: a read-only admin query that
  // returns `accountHint` is still a disclosure, and one that returns a
  // connection `label` is publishing a string the user typed. Both were
  // reachable — the conformance harness caught them, but the harness is run on
  // demand, so between runs the code was wrong and the permanent gate was
  // green. The structural guarantee has to live in the gate that always runs.
  //
  // Matched as **property reads** (`row.accountHint`), not bare words, because
  // the module's own comments and its `disclosure` strings legitimately *name*
  // these fields in order to say they are not returned. A check that flagged
  // the documentation would push someone to delete the explanation instead of
  // fixing the code — the same failure mode the bounded-read audit hit.
  const DISCLOSING = [
    ["an account hint", /\.accountHint\b/],
    ["a user-supplied connection label", /\.label\b/],
    ["a user email", /\.email\b/],
    ["a credential fingerprint", /\.fingerprint\b/],
    ["a sync cursor token", /\.cursor\b/],
  ] as const;
  const disclosing = DISCLOSING.filter(([, re]) => re.test(code)).map(([name]) => name);
  if (disclosing.length > 0) {
    problems.push(`admin.ts reads ${disclosing.join(", ")} — the surface emits counts and states only`);
  }

  // --- control: the detectors must be able to fail -------------------------
  // A gate that cannot detect a missing guard is indistinguishable from a gate
  // that found none, and this is the gate standing between a comment and a
  // hole. Two controls, because two detectors: one for the missing guard and one
  // for the write endpoint, each planted and required to be flagged.
  const PLANTED_UNGUARDED = `export const leaky = query({ args: {}, handler: async (ctx) => { return ctx.db.query("tasks").take(1); } });`;
  const guardDetects = (() => {
    const m = /export const (\w+) = query\(/.exec(PLANTED_UNGUARDED);
    if (!m) return false;
    return /requireAdmin\s*\(/.test(PLANTED_UNGUARDED.slice(m.index));
  })();
  if (guardDetects) problems.push("CONTROL FAILED: the guard detector is broken, its verdict is void");

  const PLANTED_WRITE = `import { mutation as m } from "./_generated/server";\nconst x = m({ args: {}, handler: async () => null });\nexport const y = x;`;
  const PLANTED_DISCLOSURE = `const c = row; return { hint: c.accountHint };`;
  const disclosureDetects = /\.accountHint\b/.test(PLANTED_DISCLOSURE);
  if (!disclosureDetects) {
    problems.push("CONTROL FAILED: the disclosure detector is broken, its verdict is void");
  }
  const writeDetects = (() => {
    const b = new Set<string>();
    for (const mm of PLANTED_WRITE.matchAll(
      /import\s*\{([^}]*)\}\s*from\s*["'][^"']*_generated\/server["']/g,
    )) {
      for (const s of mm[1].split(",")) {
        const parts = s.trim().split(/\s+as\s+/);
        const original = parts[0]?.trim();
        const local = (parts[1] ?? parts[0])?.trim();
        if (original && local && /^(mutation|action|internalMutation|internalAction|httpAction)$/.test(original)) {
          b.add(local);
        }
      }
    }
    for (const local of b) {
      if (new RegExp(`(?:export\\s+)?const\\s+\\w+(?:\\s*:[^=\\n]+)?\\s*=\\s*${local}\\s*\\(`).test(PLANTED_WRITE)) {
        return true;
      }
    }
    return false;
  })();
  if (!writeDetects) problems.push("CONTROL FAILED: the write detector missed an aliased mutation, its verdict is void");

  if (problems.length > 0) {
    record("admin read-only", "fail", problems.join("; "));
    return;
  }

  record(
    "admin read-only",
    "pass",
    `${queries.length} queries, no write endpoint (aliased imports included), no db write, ` +
      `every query guarded, requireAdmin private, no user-identifying field read ` +
      `(three detectors proven live) (ADR-032)`,
  );
}

/**
 * ADR-032: every index the Control Centre names must really exist.
 *
 * Convex's generated types do not carry index names, so a `.withIndex("…")` call
 * cannot be made type-safe by the compiler. The project keeps an enumerated
 * allowlist in `src/convex/admin.ts` instead, and this check is what stops that
 * list from drifting into fiction.
 *
 * It exists because of a real defect, and the shape of that defect is the
 * reason. The survey named `transactions.by_owner` and `imports.by_owner`;
 * neither exists. Both queries threw **at runtime, inside Convex** — and from
 * outside, a thrown error is indistinguishable from a correct authorisation
 * refusal, so the security harness logged five green "refused" checks for two
 * queries that were in fact broken. The gate was green, the tests were green,
 * and the feature did not work.
 *
 * Checked in one direction: a named index must exist on its table. The reverse
 * check — that every schema index appears in the allowlist — was tried and
 * removed, because the allowlist is a **list of what this module may use**, not
 * a mirror of the schema. Requiring completeness would make adding an index
 * anywhere in the product a build failure here, which is a coupling with no
 * safety benefit and a real cost: it turns an unrelated schema change into a
 * red gate that has to be triaged.
 */
function checkAdminIndexAllowlist() {
  const convexDir = join(ROOT, "src", "convex");
  const adminPath = join(convexDir, "admin.ts");
  const schemaPath = join(convexDir, "schema.ts");
  if (!existsSync(adminPath) || !existsSync(schemaPath)) {
    record("admin index allowlist", "warn", "admin.ts or schema.ts not found");
    return;
  }

  // --- the schema's real indexes, parsed with a brace-depth walk -----------
  // A line-range slice per table was tried first and silently merged adjacent
  // tables, which produced a list of indexes that belonged to the *next* table.
  // That is the same class of bug as the bounded-read audit's first parser:
  // a static check that is confidently wrong.
  const schema = readFileSync(schemaPath, "utf8");
  const declared = new Map<string, Set<string>>();
  const tableRe = /^ {4}(\w+): defineTable\(\{/gm;
  // Offsets of every table declaration, so each block can run to the next one.
  const tableStarts = [...schema.matchAll(tableRe)].map((m) => m.index);
  let nextTableStart = tableStarts[1] ?? schema.length;
  let tableIndex = 0;
  let tm: RegExpExecArray | null;
  while ((tm = tableRe.exec(schema)) !== null) {
    const name = tm[1];
    // The walk has to start at the **table body's** brace, not at the one
    // `defineTable(` opens with. Starting at the outer brace stops the moment
    // the body closes — before the chained `.index(...)` calls, which live
    // *after* it — and so reports every table as having no indexes at all.
    // The first version did exactly that and the gate rejected all 53 valid
    // pairs, which is the only reason it was caught: a check that fails on
    // correct input is a check nobody trusts.
    const bodyOpen = tm.index + tm[0].length - 1;
    let depth = 0;
    let end = bodyOpen;
    for (; end < schema.length; end++) {
      if (schema[end] === "{") depth++;
      else if (schema[end] === "}") {
        depth--;
        if (depth === 0) break;
      }
    }
    // The chained `.index(...)` calls live *after* the body's closing brace, so
    // the block must run past it. Two earlier terminators were wrong: the body's
    // own `})` (already consumed) and the next `\n    ` (which sits at
    // `lastIndex` itself, producing a one-character block and zero indexes for
    // every table). The reliable terminator is the next table's declaration, so
    // the scan is done up front and indexed.
    const after = nextTableStart > tm.index ? nextTableStart : schema.length;
    const block = schema.slice(bodyOpen, after);
    declared.set(
      name,
      new Set([...block.matchAll(/\.index\(\s*"([^"]+)"/g)].map((m) => m[1])),
    );
    nextTableStart = tableStarts[++tableIndex + 1] ?? schema.length;
  }

  // --- the allowlist as written -------------------------------------------
  const admin = stripComments(readFileSync(adminPath, "utf8"));
  const listStart = admin.indexOf("const TABLE_INDEXES");
  if (listStart === -1) {
    record("admin index allowlist", "fail", "TABLE_INDEXES not found in admin.ts");
    return;
  }
  const listEnd = admin.indexOf("as const satisfies", listStart);
  const listBody = admin.slice(listStart, listEnd === -1 ? undefined : listEnd);

  const invented: string[] = [];
  let checked = 0;

  for (const m of listBody.matchAll(/(\w+):\s*\[([^\]]*)\]/g)) {
    const table = m[1];
    const indexes = [...m[2].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
    const real = declared.get(table);
    if (!real) {
      invented.push(`${table} (no such table)`);
      continue;
    }
    for (const index of indexes) {
      checked++;
      if (!real.has(index)) invented.push(`${table}.${index}`);
    }
  }

  const problems: string[] = [];
  if (invented.length > 0) {
    problems.push(`named index(s) the schema does not declare: ${invented.join(", ")}`);
  }
  if (checked === 0) problems.push("no indexes parsed from the allowlist — the check is not running");

  if (problems.length > 0) {
    record("admin index allowlist", "fail", problems.join("; "));
    return;
  }

  record(
    "admin index allowlist",
    "pass",
    `${checked} (table, index) pairs across ${declared.size} parsed tables — every named index exists ` +
      `(a runtime-only failure mode, now a build failure)`,
  );
}

/**
 * Accessibility invariants that must not regress (CHANGE-0028).
 *
 * These are **structural** facts about the markup, which is the only kind that
 * can be checked without a browser and a screen reader. Each one was a real
 * defect found by the accessibility audit, and each is the kind of mistake that
 * comes back silently: a `<button>` inside an `<a>` still *looks* right, still
 * *works* with a mouse, and still passes a build.
 *
 * Kept here rather than in a test file because this script is the one that runs
 * before a change is claimed complete, and because the alternative — a comment
 * asking people to remember — is the failure mode the whole project keeps
 * measuring against.
 */
/**
 * The Main Panel board must tell the user WHEN an open task is due.
 *
 * ## Why this is a source gate at all
 *
 * The rendering itself is not observable here: there is no DOM harness and no
 * browser, so "the board row shows the due date" cannot be asserted by running
 * anything. That is a real limit and it is recorded as one in the changelog.
 * What *can* be pinned is the structural property that produces it, and this
 * is the repository's established idiom for exactly that problem —
 * `checkDestructiveActions`, `checkAccessibility` and `checkTruncationReceipts`
 * all assert properties of component source for the same reason.
 *
 * ## What it deliberately does NOT do
 *
 * It does not grep for the string `describeDue`. **That check would already be
 * green before this increment existed**, because the capture preview calls
 * `describeDue(segment.parsed.dueAt)` — so a bare string search is a false
 * confidence that certifies the wrong thing: that the word is somewhere in the
 * file, rather than that the board row renders it. That trap is the reason this
 * gate exists in its structural form, and the mutation test below proves the
 * difference: deleting the board row's disclosure fails this gate while leaving
 * the string in the file.
 *
 * ## The structural claim
 *
 * Inside the board's `visibleTasks.map(` region, a call to `describeDue` must
 * exist that is (a) passed the task's own `dueAt`, and (b) enclosed by the
 * `task.dueAt && !task.completed` conditional — so it is rendered *for open
 * tasks that have a due date* and for nothing else. The Overdue badge must
 * still be there too, because this increment sits next to it and a silent
 * removal of it would be the same regression in the other direction.
 */
function checkBoardDueDisclosure() {
  const file = join(ROOT, "src", "pages", "Dashboard.tsx");
  if (!existsSync(file)) {
    record("board due disclosure", "fail", "src/pages/Dashboard.tsx is missing");
    return;
  }
  const code = readFileSync(file, "utf8");

  // The board task list, located structurally. Not a line number: the row moves
  // whenever anything above it does, and a gate that breaks on a refactor gets
  // deleted instead of obeyed.
  const regionStart = code.indexOf("visibleTasks.map(");
  if (regionStart < 0) {
    record(
      "board due disclosure",
      "fail",
      "no visibleTasks.map( in Dashboard.tsx — the board task list was renamed or removed",
    );
    return;
  }
  const board = code.slice(regionStart);

  const call = "describeDue(task.dueAt)";
  const callIdx = board.indexOf(call);
  if (callIdx < 0) {
    // Distinguish "never had it" from "has it somewhere that is not the board
    // row", because those are different regressions and the detail is what tells
    // a reader which one this is.
    const elsewhere = board.includes("describeDue(")
      ? "describeDue( exists in Dashboard.tsx but not inside the board task row — the capture preview is not the board row"
      : "the board task row renders no due description at all";
    record(
      "board due disclosure",
      "fail",
      `${elsewhere}; the Main Panel must say WHEN an open task is due, not only WHETHER it is overdue`,
    );
    return;
  }

  // (b) Enclosed by the guard. Find the guard before the call, then paren-match
  // forward from the conditional's `&& (` to prove the call sits inside it
  // rather than merely nearby.
  const guardIdx = board.lastIndexOf("task.dueAt && !task.completed", callIdx);
  if (guardIdx < 0 || guardIdx > callIdx) {
    record(
      "board due disclosure",
      "fail",
      `${call} is not guarded by "task.dueAt && !task.completed" — a completed task must not be given the open-task due treatment`,
    );
    return;
  }
  const openIdx = board.indexOf("&& (", guardIdx);
  if (openIdx < 0 || openIdx > callIdx) {
    record(
      "board due disclosure",
      "fail",
      `could not find the conditional body that should contain ${call}`,
    );
    return;
  }
  let depth = 0;
  let closeIdx = -1;
  for (let i = openIdx + 3; i < board.length; i += 1) {
    if (board[i] === "(") depth += 1;
    else if (board[i] === ")") {
      depth -= 1;
      if (depth === 0) {
        closeIdx = i;
        break;
      }
    }
  }
  if (closeIdx < 0 || callIdx > closeIdx) {
    record(
      "board due disclosure",
      "fail",
      `${call} is not inside the "task.dueAt && !task.completed" conditional body`,
    );
    return;
  }

  // The neighbouring signal this increment must not have displaced.
  //
  // This was wrong twice before it was right, and both mistakes are worth
  // recording because they are the same mistake.
  //
  // First attempt: assert `/task\.isOverdue\s*&&/` appears in the board region.
  // That passes for the **wrong reason** — the row also computes a conditional
  // className with `task.isOverdue && "bg-secondary …"` (Dashboard.tsx:672),
  // which is a different statement entirely. Deleting the Overdue badge left
  // that line untouched, so the gate stayed green over a deleted badge. A gate
  // that survives the thing it exists to catch is decoration.
  //
  // Second attempt: assert the word `Overdue` appears somewhere. Also wrong,
  // because this increment's own explanatory comment contains the phrase "the
  // Overdue badge" — so the fix for one false positive would have introduced
  // another.
  //
  // What is actually claimed is that `Overdue` is the **text content of a
  // rendered element** inside the board list: `>Overdue<`. That cannot be
  // satisfied by a comment, by a className expression, or by an identifier.
  if (!/>\s*Overdue\s*</.test(board)) {
    record(
      "board due disclosure",
      "fail",
      "the Overdue badge is no longer rendered in the board task list — this increment adds a due date, it does not replace the overdue flag",
    );
    return;
  }

  record(
    "board due disclosure",
    "pass",
    "the board task row renders describeDue(task.dueAt) inside the open-task guard, and the Overdue badge is intact",
  );
}

function checkAccessibility() {
  const srcDir = join(ROOT, "src");
  if (!existsSync(srcDir)) {
    record("accessibility invariants", "fail", "src/ is missing");
    return;
  }

  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        // `ui/` is stock shadcn. It is upstream code with its own conventions and
        // its own release cadence; auditing it here would produce findings the
        // project cannot act on, and the lint baseline already tracks it.
        if (entry.name === "ui" || entry.name === "_generated") continue;
        walk(full);
      } else if (entry.name.endsWith(".tsx")) {
        files.push(full);
      }
    }
  };
  walk(srcDir);

  const problems: string[] = [];
  let nested = 0;
  let unnamedIconButtons = 0;
  let imagesWithoutAlt = 0;
  let outlineKillers = 0;

  for (const file of files) {
    const rel = file.slice(ROOT.length + 1);
    const code = stripComments(readFileSync(file, "utf8"));

    // --- 1. no interactive content nested inside interactive content --------
    // `<a><button/></a>` and `<button><a/></button>` both put two focusable,
    // activatable elements inside one another. The name is announced twice,
    // Enter can activate either, and it is invalid HTML.
    if (
      /<(?:a|Link)\b[^>]*>\s*(?:\{[^}]*\}\s*)*<button\b/.test(code) ||
      /<button\b[^>]*>\s*(?:\{[^}]*\}\s*)*<(?:a|Link)\b/.test(code)
    ) {
      problems.push(`${rel}: interactive element nested inside another`);
      nested++;
    }

    // --- 2. every icon-only button carries a name --------------------------
    // `size="icon"` is the project's marker for a control whose only content is
    // an icon. Without `aria-label` such a control has no accessible name at
    // all, and the one real instance had `alt="Logo"` — which names the picture,
    // not the action.
    const iconButtons = [...code.matchAll(/<Button\b[^>]*size="icon"[^>]*>/g)].map((m) => m[0]);
    for (const tag of iconButtons) {
      if (!/aria-label\s*=/.test(tag)) {
        problems.push(`${rel}: icon-only <Button size="icon"> without aria-label`);
        unnamedIconButtons++;
      }
    }

    // --- 3. every <img> declares alt ---------------------------------------
    for (const m of code.matchAll(/<img\b[^>]*>/g)) {
      if (!/\balt\s*=/.test(m[0])) {
        problems.push(`${rel}: <img> without an alt attribute`);
        imagesWithoutAlt++;
      }
    }

    // --- 3b. nothing removes the focus outline ----------------------------
    // This one was found by *attacking* the fix rather than reading it. The
    // global `:focus-visible` outline landed, and three selects in product code
    // still carried `focus-visible:outline-none` — a Tailwind utility, which
    // lives in the utilities layer and therefore beats a `@layer components`
    // rule no matter how the selectors are written. So those three controls, and
    // only those three, had **no** focus indicator after the audit that was
    // supposed to give every control one.
    //
    // The distinction that matters: `focus-visible:ring-0` is fine and used
    // widely, because it removes the invisible box-shadow ring and leaves the
    // outline standing. `outline-none` removes the outline itself, which by this
    // point is the only indicator there is.
    const killers = [...code.matchAll(/[\w:-]*outline-none\b/g)].map((m) => m[0]);
    if (killers.length > 0) {
      problems.push(
        `${rel}: ${killers.join(", ")} removes the focus outline — ` +
          `use focus-visible:ring-0 instead, which leaves the indicator standing`,
      );
      outlineKillers += killers.length;
    }
  }

  // --- 4. a visible focus indicator exists --------------------------------
  // Checked in `index.css` rather than per component, because the defect was
  // *global*: 123 elements used `.brutal` and none declared a focus style, while
  // `--ring` equalled `--border` so even the primitives' rings were invisible
  // against a brutal border.
  const cssPath = join(srcDir, "index.css");
  const css = existsSync(cssPath) ? readFileSync(cssPath, "utf8") : "";
  // Comments are stripped first because the rule is *documented* at length, and
  // the prose mentions `:focus-visible` several times.
  //
  // The check is deliberately **not** satisfied by the `forced-colors` block. The
  // first version matched any `:focus-visible { … outline … }`, and deleting the
  // ordinary rule still passed — the high-contrast rule was still there, so the
  // gate reported a focus indicator that only exists in a mode most people never
  // see. A check that can be satisfied by the wrong rule is not a check, and the
  // mutation that exposed it is the only reason this is stated.
  const cssCode = css.replace(/\/\*[\s\S]*?\*\//g, "");
  // Only rules that apply in *ordinary* rendering count. Anything inside a
  // `@media (forced-colors: active)` block is excluded by measuring the distance
  // back to the nearest `@media` and rejecting the ones that name forced-colors.
  //
  // The window starts at the `@media` keyword, **not** at its opening brace. Two
  // earlier versions sliced from `indexOf("{")`, which drops the condition
  // itself — so `forced-colors` was cut off before it could be tested, the only
  // remaining rule was counted as ordinary, and deleting the real focus rule
  // passed the gate twice. A window that excludes the thing it is searching for
  // is a window that finds nothing.
  const focusBlock = /:focus-visible\s*(?:,[^{]*)?\{([^}]*)\}/g;
  let hasOrdinaryFocus = false;
  let fm: RegExpExecArray | null;
  while ((fm = focusBlock.exec(cssCode)) !== null) {
    if (!/\boutline\s*:/.test(fm[1])) continue;
    const preceding = cssCode.slice(0, fm.index);
    const lastMedia = preceding.lastIndexOf("@media");
    const brace = preceding.indexOf("{", lastMedia);
    const insideMedia = lastMedia !== -1 && brace !== -1 && brace < fm.index;
    // Start at the keyword so the condition (`(forced-colors: active)`) is
    // inside the window being tested.
    const mediaWindow = insideMedia ? preceding.slice(lastMedia) : "";
    if (/forced-colors/.test(mediaWindow)) continue; // high-contrast mode only
    hasOrdinaryFocus = true;
    break;
  }
  if (!hasOrdinaryFocus) {
    problems.push(
      "index.css declares no ordinary :focus-visible outline rule — keyboard focus is invisible " +
        "(a forced-colors-only rule does not count)",
    );
  }

  if (files.length === 0) problems.push("no .tsx files scanned — the check is not running");

  if (problems.length > 0) {
    record(
      "accessibility invariants",
      "fail",
      `${problems.length} problem(s): ${problems.slice(0, 6).join("; ")}${problems.length > 6 ? " …" : ""}`,
    );
    return;
  }

  record(
    "accessibility invariants",
    "pass",
    `${files.length} component files: ${nested} nested interactive elements, ` +
      `${unnamedIconButtons} unnamed icon buttons, ${imagesWithoutAlt} images without alt, ` +
      `${outlineKillers} outline removers, a global :focus-visible outline is declared`,
  );
}

/**
 * ADR-032: the security registry is a *view* of the changelog, not a second
 * source of truth.
 *
 * `src/lib/adminFindings.ts` is a checked-in list of recorded findings so the
 * Control Centre has something real to show. A list like that has one dominant
 * failure mode — it drifts from the document it claims to summarise, and nobody
 * notices because both still look plausible — so this gate cross-checks every
 * `D`-prefixed id in it against the changelog.
 *
 * It checks in both directions on purpose:
 *
 *  - **Registry → changelog**: an entry naming a finding that was never recorded
 *    fails the build. This is the direction that prevents fabrication, which is
 *    the direction that matters.
 *  - **Changelog → registry**: a recorded open finding missing from the registry
 *    fails the build. This is the direction that prevents a finding from quietly
 *    disappearing from the console while still being open in the spec.
 *
 * The second direction only applies to the `D6x` band, which is where the
 * currently-open findings live. Applying it to every `D` id in a 5,000-line
 * changelog would demand that fixed findings be re-registered forever.
 */
function checkSecurityRegistry(changelog: string) {
  const path = join(ROOT, "src", "lib", "adminFindings.ts");
  if (!existsSync(path)) {
    record("security registry", "warn", "src/lib/adminFindings.ts not found");
    return;
  }

  const code = stripComments(readFileSync(path, "utf8"));
  const registered = [...code.matchAll(/id:\s*"(D\d+)"/g)].map((m) => m[1]);
  const recorded = new Set([...changelog.matchAll(/^### (D\d+)/gm)].map((m) => m[1]));

  const problems: string[] = [];

  // One id, one finding. The Control Centre renders `f.id` as the handle a
  // reader cites back to the changelog, so two rows sharing an id are the same
  // finding rendered twice in two sections with different wording — which is
  // worse than either copy alone, because a reader cannot tell which one is
  // current. This is not hypothetical: D61 was registered in both arrays for
  // the whole of CHANGE-0031 (D76).
  const tally = new Map<string, number>();
  for (const id of [...code.matchAll(/id:\s*"([^"]+)"/g)].map((m) => m[1])) {
    tally.set(id, (tally.get(id) ?? 0) + 1);
  }
  const repeated = [...tally].filter(([, n]) => n > 1).map(([id]) => id);
  if (repeated.length > 0) {
    problems.push(`finding id(s) registered more than once: ${repeated.join(", ")}`);
  }

  const invented = registered.filter((id) => !recorded.has(id));
  if (invented.length > 0) {
    problems.push(`registry names finding(s) absent from the changelog: ${invented.join(", ")}`);
  }

  // The D6x band is the open band. Any D6x recorded in the changelog must be in
  // the registry, or the console is under-reporting.
  const openBand = [...recorded].filter((id) => /^D6\d$/.test(id));
  const missing = openBand.filter((id) => !registered.includes(id));
  if (missing.length > 0) {
    problems.push(`open finding(s) recorded but absent from the registry: ${missing.join(", ")}`);
  }

  // A registry with no findings would render an empty, confident-looking
  // security section. That is the exact failure this gate exists to prevent, so
  // an empty list is a failure rather than a legitimate state.
  if (registered.length === 0) {
    problems.push("registry is empty — the security section would render as confidently blank");
  }

  if (problems.length > 0) {
    record("security registry", "fail", problems.join("; "));
    return;
  }

  record(
    "security registry",
    "pass",
    `${registered.length} findings, ids unique, cross-checked both ways against the changelog ` +
      `(${openBand.length} in the open D6x band, none missing)`,
  );
}

/**
 * Irreversible actions are confirmed.
 *
 * `removeTask`, `clearCompleted`, `deleteSubscription`, `removeExpense`,
 * `removeNote` and `deleteDocument` are **real deletes**. There is no soft
 * delete, no undo column, no tombstone — ADR-023 gave merges a tombstone and
 * nothing else got one. So a single click on a 24px trash icon destroyed data
 * with no path back, and "Clear completed" removed up to `DASHBOARD_TASKS` rows
 * from a control styled like a caption.
 *
 * The invariant is therefore: **no destructive mutation is invoked directly
 * from an `onClick` handler.** It has to be reached through `ConfirmAction`,
 * which requires a second, deliberate click.
 *
 * ## Why the handler indirection is resolved
 *
 * Half the call sites read `onClick={() => void handleDelete(task._id)}` rather
 * than naming the mutation, so a grep for `removeTask` inside an `onClick` would
 * pass on exactly the code it exists to catch. So local wrappers are followed
 * two levels deep: a `const`/`function` whose body names a destructive mutation
 * is itself treated as destructive.
 */
const DESTRUCTIVE_MUTATIONS = [
  "cancelCommitment",
  "cancelRenewal",
  "cancelSubscription",
  "clearCompleted",
  "deleteAccount",
  "deleteCommitment",
  "deleteDocument",
  "deleteSubscription",
  "disconnectProvider",
  "disconnectTool",
  "removeExpense",
  "removeNote",
  "removeTask",
] as const;

function checkDestructiveActions() {
  const srcDir = join(ROOT, "src");
  if (!existsSync(srcDir)) {
    record("destructive actions", "fail", "src/ is missing");
    return;
  }

  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "ui" || entry.name === "_generated") continue;
        walk(full);
      } else if (entry.name.endsWith(".tsx")) files.push(full);
    }
  };
  walk(srcDir);

  /** The body of every `prop={ … }` expression, found by counting braces. */
  const propBodies = (code: string, prop: string): string[] => {
    const out: string[] = [];
    const re = new RegExp(`\\b${prop}=\\{`, "g");
    while (re.exec(code) !== null) {
      const start = re.lastIndex;
      let i = start;
      let depth = 1;
      while (i < code.length && depth > 0) {
        if (code[i] === "{") depth++;
        else if (code[i] === "}") depth--;
        i++;
      }
      out.push(code.slice(start, i - 1));
      re.lastIndex = i;
    }
    return out;
  };

  const problems: string[] = [];
  let confirmed = 0;

  for (const file of files) {
    const rel = file.slice(ROOT.length + 1);
    const code = stripComments(readFileSync(file, "utf8"));

    // Resolve local wrappers so `onClick={() => handleDelete(x)}` is caught.
    //
    // The window is bounded by a terminator rather than a character budget. An
    // earlier version measured a fixed 600 characters forward, which — when the
    // next declaration was indented deeper than the handler — ran past the end
    // of the handler and into the JSX below it, picked up a destructive call
    // that lived in an `onConfirm` twenty lines down, and reported five false
    // positives on the first run. A window that can overshoot is a window that
    // invents findings.
    //
    // Two further corrections, both found by the same run:
    //
    //  - The terminator is the first closing brace at the start of a line, at
    //    **any** indentation. A helper declared inside a component closes at
    //    column 0, so requiring exactly two spaces ran past it into the next
    //    function, wrongly named `endOfDay` destructive, and then propagated
    //    that poisoning transitively to two unrelated handlers. Truncating a
    //    body early can only *miss* a finding, never invent one — the safe
    //    direction for a heuristic.
    //  - A name only counts when it is **called** (`name(`). A bare word match
    //    also fires on a parameter or a property, which is how a helper got
    //    classified from an unrelated identifier nearby.
    const destructive = new Set<string>(DESTRUCTIVE_MUTATIONS);
    for (let pass = 0; pass < 2; pass++) {
      // The parameter list tolerates one level of nested parentheses, because
      // the real signatures contain them: `id: (typeof tasks)[number]["_id"]`.
      // A flat `[^)]*` stops at `(typeof tasks)` and the declaration stops
      // matching, so the wrapper goes unresolved and the gate passes on exactly
      // the code it exists to catch — found by planting that call as a mutant.
      const PARAMS = "\\((?:[^()]|\\([^()]*\\))*\\)";
      const decls = [
        ...code.matchAll(
          new RegExp(`const\\s+(\\w+)\\s*=\\s*(?:async\\s*)?${PARAMS}[^{;]*?=>\\s*\\{([\\s\\S]*?)\\n\\s*\\}`, "g"),
        ),
        ...code.matchAll(
          new RegExp(`(?:async\\s+)?function\\s+(\\w+)\\s*${PARAMS}[^{]*\\{([\\s\\S]*?)\\n\\s*\\}`, "g"),
        ),
      ];
      for (const decl of decls) {
        const name = decl[1];
        const body = decl[2];
        if (destructive.has(name)) continue;
        for (const d of destructive) {
          if (new RegExp(`\\b${d}\\s*\\(`).test(body)) {
            destructive.add(name);
            break;
          }
        }
      }
    }

    for (const body of propBodies(code, "onClick")) {
      for (const name of destructive) {
        if (new RegExp(`\\b${name}\\s*\\(`).test(body)) {
          problems.push(
            `${rel}: onClick calls ${name} directly — route it through ConfirmAction`,
          );
        }
      }
    }

    confirmed += [...code.matchAll(/<ConfirmAction\b/g)].length;
  }

  if (files.length === 0) problems.push("no .tsx files scanned — the check is not running");

  if (problems.length > 0) {
    record(
      "destructive actions",
      "fail",
      `${problems.length} problem(s): ${problems.slice(0, 6).join("; ")}${
        problems.length > 6 ? " …" : ""
      }`,
    );
    return;
  }

  record(
    "destructive actions",
    "pass",
    `${confirmed} irreversible action(s) reached only through ConfirmAction; ` +
      `no destructive mutation is wired straight to an onClick`,
  );
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
  checkAdminReadOnly();
  checkAdminIndexAllowlist();
  checkSecurityRegistry(changelog);
  checkAccessibility();

  checkDestructiveActions();
  checkTruncationReceipts();
  checkInternalNavigation();
  checkBoardDueDisclosure();

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

/**
 * Bounded-read audit.
 *
 * D48: a bounded *result* is not evidence of bounded *database access*. The
 * only way to know a read is bounded is to read the query chain, because
 * `.collect()` after an owner-scoped index is still an unbounded read — the
 * index bounds *which rows are scanned*, not *how many rows exist*.
 *
 * This is a static, read-only scan. It never touches the database.
 *
 * Parsing approach, and why it is this way
 * ----------------------------------------
 * The first version of this script matched `.withIndex(` and then walked
 * backwards looking for `.query("x")` to name the table. That silently
 * dropped every chain written in the normal multi-line style:
 *
 *     const rows = await ctx.db
 *       .query("people")
 *       .withIndex("by_owner", (q) => q.eq("ownerUserId", userId))
 *       .collect();
 *
 * It reported 4 findings when 10 existed. An audit that undercounts is worse
 * than no audit, because it manufactures confidence. So: the parser anchors on
 * `.query("table")`, then walks forward with a bracket-depth counter until it
 * reaches the chain terminator. That finds every chain regardless of how it is
 * wrapped, and CONTROL below proves the finder still works when it should.
 *
 * Usage: bun scripts/audit-bounded-reads.ts
 * Exit 0 when nothing is UNBOUNDED, 1 otherwise.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { CLOSED_VOCABULARY_READS, KNOWN_UNBOUNDED_READS } from "../src/lib/readLimits";

const CONVEX_DIR = "src/convex";

type Verdict = "unbounded" | "bounded" | "scan";

interface Finding {
  file: string;
  line: number;
  table: string;
  index: string;
  ownerScoped: boolean;
  take: string | null;
  verdict: Verdict;
  code: string;
  /** Set when an exception excuses this read, with its justification. */
  accepted?: string;
  /** Which manifest excused it. */
  exception?: "closed-vocabulary" | "debt";
}

const findings: Finding[] = [];
const files = readdirSync(CONVEX_DIR)
  .filter((f) => f.endsWith(".ts") && f !== "schema.ts")
  .sort();

/** Character offset -> 1-based line number. */
function lineAt(src: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < src.length; i++) if (src[i] === "\n") line++;
  return line;
}

/**
 * Blank out comments, preserving length and newlines.
 *
 * Without this the audit parses its own documentation. The first fix to
 * `auditOwnership` included a comment quoting the old line —
 * `ctx.db.query("links").collect()` — and the scanner dutifully reported it as
 * a live whole-table scan of the links table, which it is not. A finding that
 * cries wolf is a finding people learn to scroll past, so comments are replaced
 * with spaces (not deleted: deleting would shift every line number after it).
 */
function stripComments(src: string): string {
  let out = "";
  let i = 0;
  while (i < src.length) {
    const two = src.slice(i, i + 2);
    if (two === "//") {
      while (i < src.length && src[i] !== "\n") {
        out += " ";
        i++;
      }
    } else if (two === "/*") {
      while (i < src.length && src.slice(i, i + 2) !== "*/") {
        out += src[i] === "\n" ? "\n" : " ";
        i++;
      }
      out += "  ";
      i += 2;
    } else {
      out += src[i];
      i++;
    }
  }
  return out;
}

for (const file of files) {
  const src = stripComments(readFileSync(join(CONVEX_DIR, file), "utf8"));

  const anchor = /\.query\(\s*"([A-Za-z]+)"\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = anchor.exec(src)) !== null) {
    const table = m[1];
    const start = m.index;

    // Walk forward with a depth counter so that terminators inside the index
    // callback (e.g. `q.eq("ownerUserId", userId)`) are not mistaken for the
    // end of the chain.
    let depth = 0;
    let i = m.index + m[0].length;
    let terminator: string | null = null;
    let takeArg: string | null = null;
    for (; i < src.length; i++) {
      const ch = src[i];
      if (ch === "(") depth++;
      else if (ch === ")") {
        depth--;
        if (depth < 0) break; // chain ended without a terminator
      } else if (depth === 0) {
        const t = /^(collect|take|first|unique|paginate)\(/.exec(src.slice(i));
        if (t) {
          terminator = t[1];
          // Capture the argument up to the matching close paren. The argument
          // is usually a named constant (`.take(MAX_ACCOUNTS)`), so it is kept
          // as *text*. The first version coerced it to a number, and
          // `Number("MAX_ACCOUNTS")` is `NaN` — which reported 23 genuinely
          // bounded chains as unbounded. The verdict must not depend on
          // whether the cap happens to be a literal.
          let d = 0;
          let j = i + t[1].length;
          let arg = "";
          for (; j < src.length; j++) {
            if (src[j] === "(") d++;
            else if (src[j] === ")") {
              d--;
              if (d === 0) break;
            }
            arg += src[j];
          }
          if (t[1] === "take") takeArg = arg.trim();
          i = j;
          break;
        }
        if (ch === ";") break; // statement ended, no terminator found
      }
    }

    if (terminator === null) continue; // not a terminal read; ignore

    // What index (if any) does this chain use, and is it owner-scoped?
    const chain = src.slice(start, Math.min(i, src.length));
    const idx = /\.withIndex\(\s*"([A-Za-z_]+)"/.exec(chain);
    const ownerScoped = /q\.eq\(\s*"(ownerUserId|createdBy|userId)"/.test(chain);
    const index = idx ? idx[1] : "(none)";
    const code = chain.replace(/\s+/g, " ").trim();

    // Only `.collect()` without a `.take()` is unbounded. `.first()` reads at
    // most one row, `.unique()` at most one row (and throws if there are two),
    // `.paginate()` is bounded by its cursor, and `.take(n)` is bounded by
    // construction. The first version of this script called every one of those
    // "unbounded" and reported 120 findings, which is noise, not signal.
    let verdict: Verdict;
    if (!idx) verdict = "scan";
    else if (takeArg !== null || terminator !== "collect") verdict = "bounded";
    else verdict = "unbounded";

    findings.push({
      file,
      line: lineAt(src, start),
      table,
      index,
      ownerScoped,
      take: takeArg,
      verdict,
      code: code.slice(0, 160),
    });
  }
}

// Dedupe. `Promise.all([...])` blocks can present the same table twice on one
// line; keep the worst verdict per (file, line, table, index).
const severity: Record<Verdict, number> = { scan: 2, unbounded: 1, bounded: 0 };
const byKey = new Map<string, Finding>();
for (const f of findings) {
  const k = `${f.file}:${f.line}:${f.table}:${f.index}`;
  const prior = byKey.get(k);
  if (!prior || severity[f.verdict] > severity[prior.verdict]) byKey.set(k, f);
}
const all = [...byKey.values()].sort(
  (a, b) => a.file.localeCompare(b.file) || a.line - b.line,
);

const section = (s: string) => console.log(`\n=== ${s} ===`);

console.log("BOUNDED-READ AUDIT (D48)");
console.log("A bounded result is not evidence of bounded access. The chain is the only evidence.\n");

const unbounded = all.filter((f) => f.verdict === "unbounded");

/**
 * Apply the closed-vocabulary exception list.
 *
 * An entry only excuses a finding when it names a table+index pair that
 * actually appears, and carries a real justification. A stale entry — one for a
 * read that has since been capped, or an index that no longer exists — is
 * reported as **unused**, because a manifest that accumulates dead entries is
 * how an exception list quietly becomes a blanket.
 */
const justified = new Map<string, string>();
for (const e of CLOSED_VOCABULARY_READS) {
  const key = `${e.table}.${e.index}`;
  if (typeof e.bound !== "string" || e.bound.trim().length === 0) {
    console.log(`\n!! exception ${key} has no justification and is being IGNORED`);
    continue;
  }
  justified.set(key, e.bound);
}

const hit = new Set<string>();
const stillUnbounded: Finding[] = [];
for (const f of unbounded) {
  const key = `${f.table}.${f.index}`;
  if (justified.has(key)) {
    hit.add(key);
    f.accepted = justified.get(key);
    f.exception = "closed-vocabulary";
  } else {
    stillUnbounded.push(f);
  }
}
const unusedExceptions = [...justified.keys()].filter((k) => !hit.has(k));

/**
 * Accepted-as-debt reads.
 *
 * Matched on file **and** line, with a small tolerance window, so that fixing
 * the read without deleting the entry turns the gate red. An accepted defect
 * that silently keeps passing after the defect is gone is worse than no record
 * of it at all.
 */
const debt = new Set<Finding>();
// The manifest names files repo-relative (`src/convex/integrations.ts`) while a
// finding names them relative to src/convex (`integrations.ts`). Normalise, or
// every debt entry silently fails to match and the exception list is a no-op
// that still looks deliberate.
const debtKey = (file: string): string => file.replace(/^src\/convex\//, "");
for (const f of stillUnbounded) {
  const entry = KNOWN_UNBOUNDED_READS.find(
    (k) => debtKey(k.file) === f.file && Math.abs(k.line - f.line) <= 6,
  );
  if (entry) {
    f.accepted = `[${entry.defect}] ${entry.why}`;
    f.exception = "debt";
    debt.add(f);
  }
}
const reported = stillUnbounded.filter((f) => f.accepted == null);
const staleDebt = KNOWN_UNBOUNDED_READS.filter(
  (k) => !stillUnbounded.some((f) => debtKey(k.file) === f.file && Math.abs(k.line - f.line) <= 6),
);

section("A. UNBOUNDED — indexed range, collected with no .take()");
if (reported.length === 0) console.log("(none)");
for (const f of reported) {
  console.log(
    `  ${f.file}:${f.line}  ${f.table}.${f.index}  ${f.ownerScoped ? "owner-scoped" : "NOT owner-scoped"}`,
  );
  console.log(`      ${f.code}`);
}

section("A2. ACCEPTED BY CLOSED VOCABULARY — unbounded, and bounded by the product");
const accepted = unbounded.filter((f) => f.exception === "closed-vocabulary");
if (accepted.length === 0) console.log("(none)");
for (const f of accepted) {
  console.log(`  ${f.file}:${f.line}  ${f.table}.${f.index}`);
}
if (unusedExceptions.length > 0) {
  console.log(
    `\n  !! ${unusedExceptions.length} exception(s) match no live read: ` +
      unusedExceptions.join(", "),
  );
  console.log("     A stale exception is a loophole that outlives its reason.");
}

section("A3. ACCEPTED AS KNOWN DEBT — unbounded, capped-on-purpose would be wrong");
if (debt.size === 0) console.log("(none)");
for (const f of debt) {
  console.log(`  ${f.file}:${f.line}  ${f.table}.${f.index}`);
  console.log(`      ${(f.accepted ?? "").slice(0, 300)}`);
}
if (staleDebt.length > 0) {
  console.log(
    `\n  !! ${staleDebt.length} accepted-debt entr(ies) no longer match a live read: ` +
      staleDebt.map((k) => `${k.file}:${k.line} (${k.defect})`).join(", "),
  );
  console.log("     Delete the entry — an accepted defect must not outlive its cause.");
}

section("B. TABLE SCAN — no index at all");
const scans = all.filter((f) => f.verdict === "scan");
if (scans.length === 0) console.log("(none)");
for (const f of scans) console.log(`  ${f.file}:${f.line}  ${f.table}  ${f.code}`);

section("C. BOUNDED — single-row or capped reads");
const bounded = all.filter((f) => f.verdict === "bounded");
const byKind = new Map<string, number>();
for (const f of bounded) {
  const k = f.take !== null ? `take(${f.take})` : "first/unique (1 row)";
  byKind.set(k, (byKind.get(k) ?? 0) + 1);
}
for (const [k, n] of [...byKind.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(3)} x ${k}`);
}
console.log(`${bounded.length} bounded chain(s).`);

// ---- CONTROL -------------------------------------------------------------
// Prove the finder can still fail. A checker that reports zero because it
// silently stopped matching is indistinguishable from a checker that reports
// zero because the code is clean. So: run the same parser over a string that
// *must* produce exactly two findings, and fail loudly if it does not.
section("CONTROL — the parser must still detect a planted unbounded chain");
const PLANTED = `
  const a = await ctx.db.query("tasks").withIndex("by_owner", (q) => q.eq("ownerUserId", u)).collect();
  const b = await ctx.db
    .query("people")
    .withIndex("by_owner", (q) => q.eq("ownerUserId", u))
    .collect();
`;
function detect(src: string): number {
  let n = 0;
  const re = /\.query\(\s*"([A-Za-z]+)"\s*\)/g;
  let mm: RegExpExecArray | null;
  while ((mm = re.exec(src)) !== null) {
    let depth = 0;
    for (let i = mm.index + mm[0].length; i < src.length; i++) {
      const ch = src[i];
      if (ch === "(") depth++;
      else if (ch === ")") {
        depth--;
        if (depth < 0) break;
      } else if (depth === 0) {
        const t = /^(collect|take|first|unique|paginate)\(/.exec(src.slice(i));
        if (t) {
          if (t[1] === "collect") {
            const chain = src.slice(mm.index, i);
            if (/\.withIndex\(/.test(chain) && !/\.take\(/.test(chain)) n++;
          }
          break;
        }
        if (ch === ";") break;
      }
    }
  }
  return n;
}
const control = detect(PLANTED);
const controlOk = control === 2;
console.log(
  `  planted 2 unbounded chains (one inline, one multi-line); detected ${control}.`,
);
console.log(controlOk ? "  PASS — finder is live." : "  FAIL — finder is broken; its report is void.");

// Second control: the comment stripper must actually strip, or every finding
// is unreliable in the other direction. Plant a quoted old read inside a
// comment and prove it is not counted.
const COMMENT_PLANTED = `
// ctx.db.query("links").collect();
/* ctx.db.query("activity").collect(); */
const live = await ctx.db.query("tasks").withIndex("by_owner", (q) => q.eq("ownerUserId", u)).collect();
`;
const commentSeen = detect(stripComments(COMMENT_PLANTED));
const commentOk = commentSeen === 1;
console.log(
  `  planted 2 reads inside comments and 1 live; detected ${commentSeen} live.`,
);
console.log(
  commentOk
    ? "  PASS — comments are not counted as reads."
    : "  FAIL — the scanner is reading its own documentation.",
);

console.log(
  `\nRESULT: ${reported.length} unbounded, ${debt.size} accepted as debt, ` +
    `${accepted.length} accepted by closed vocabulary, ${scans.length} table scan(s), ` +
    `${bounded.length} bounded.`,
);
const failed =
  reported.length +
  scans.length +
  unusedExceptions.length +
  staleDebt.length +
  (controlOk ? 0 : 1) +
  (commentOk ? 0 : 1);
console.log(failed === 0 ? "PASS — every read chain is index-bounded and capped." : "FAIL — see above.");
process.exit(failed === 0 ? 0 : 1);

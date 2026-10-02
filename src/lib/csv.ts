/**
 * Statement CSV parsing, deterministic and dependency-free (phase 4B-2a).
 *
 * This module exists because ADR-016 makes a dependency a stop condition and
 * the research said a dependency is not needed for CSV: RFC 4180 is a small,
 * fully specified grammar, and the *interesting* part of reading a statement —
 * deciding which column is the date, which is the amount, and whether the rows
 * agree with the printed total — is Panel's own work either way.
 *
 * ## The four rules this module never breaks
 *
 * 1. **Never guess a date.** `03/04/2026` is ambiguous in most of the world and
 *    unambiguous in none of it. If both readings are possible the row is
 *    refused and the reason is stated. A wrong date on a financial record is
 *    worse than a missing one.
 * 2. **Never guess an amount.** A figure that is not a plain decimal in a known
 *    currency is refused, and the refusal carries the text that failed.
 * 3. **Never persist anything.** This module returns candidates and
 *    uncertainties. What gets written is decided by a human in a later step.
 * 4. **Never exceed a bound.** Rows, fields and bytes are capped here rather
 *    than by the caller, because a caller that forgets is how a hostile upload
 *    becomes a memory problem.
 *
 * ## Why the row id is a hash and not a counter
 *
 * Idempotency has to survive re-uploading the *same* statement, so the id must
 * come from the row's own content and not from a file name or a row number. FNV-1a
 * is 30 lines of arithmetic, deterministic across runs and platforms, and needs
 * no crypto library — which is the entire point of this increment.
 */

import { formatMinor, parseAmountToMinor } from "./money";
import type { CurrencyCode } from "./money";

/** Hard bounds. A statement is a list a person reads, not a data feed. */
export const LIMITS = {
  maxBytes: 256 * 1024,
  maxRows: 5_000,
  maxFieldsPerRow: 32,
  maxFieldLength: 512,
  /**
   * How many rows one import may write.
   *
   * This cap lives here, in the pure layer, rather than in each mutation, so
   * that the preview and the apply are guaranteed to truncate at the *same*
   * row. A cap applied separately on each side is a consent bug waiting to
   * happen: show 200, write 500, and the person agreed to something they never
   * saw.
   */
  maxCandidates: 200,
} as const;

/**
 * The currencies a statement may be in — the *same* closed set as `money.ts`
 * and the schema, by alias rather than by a second literal. A third copy of this
 * list is a currency that imports successfully and then cannot be stored.
 */
export type CsvCurrency = CurrencyCode;

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11,
};

export interface CsvLimits {
  maxBytes?: number;
  maxRows?: number;
  maxFieldsPerRow?: number;
  maxFieldLength?: number;
}

export type CsvParseResult =
  | { ok: true; rows: string[][]; truncated: boolean }
  | { ok: false; reason: string };

/**
 * RFC 4180: fields may be quoted, a quote inside a quoted field is doubled, and
 * a quoted field may contain the line break. Everything else is literal.
 *
 * Returns a **refusal with a reason** rather than a partial parse. Half a
 * statement is the worst possible outcome, because it looks like data.
 */
export function parseCsv(input: string, limits: CsvLimits = {}): CsvParseResult {
  const maxBytes = limits.maxBytes ?? LIMITS.maxBytes;
  const maxRows = limits.maxRows ?? LIMITS.maxRows;
  const maxFields = limits.maxFieldsPerRow ?? LIMITS.maxFieldsPerRow;
  const maxField = limits.maxFieldLength ?? LIMITS.maxFieldLength;

  if (input.length > maxBytes) {
    return { ok: false, reason: `File is larger than ${Math.round(maxBytes / 1024)} KB.` };
  }

  // A byte-order mark is not data; it is an artefact that would otherwise make
  // the first column name unmatchable.
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  if (text.length === 0) return { ok: false, reason: "File is empty." };

  // Refuse an encoding we cannot read *before* parsing it into nonsense.
  //
  // Panel receives text, never bytes, so a UTF-16 file arrives here already
  // decoded wrongly — interleaved with NULs — and a binary file arrives as NULs
  // and replacement characters. Both parse "successfully" into wrong numbers,
  // which is precisely the failure this module exists to prevent. Saying so is
  // cheaper than importing the wrong statement.
  if (text.charCodeAt(0) === 0xfffe) {
    return { ok: false, reason: "This file is UTF-16. Save it as UTF-8 CSV and try again." };
  }
  if (text.includes("\u0000")) {
    return { ok: false, reason: "This file contains null bytes, so it is not UTF-8 text." };
  }

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let truncated = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i] as string;

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
        // The bound applies inside a quoted field too: a hostile upload puts the
        // megabyte *between* the quotes rather than beside them.
        if (field.length > maxField) return { ok: false, reason: "A field is too long to be a statement cell." };
      }
      continue;
    }

    if (ch === '"') {
      // A quote may only open a field, never appear inside a bare one.
      if (field.length > 0) return { ok: false, reason: "A quote appeared inside an unquoted field." };
      inQuotes = true;
      continue;
    }

    if (ch === ",") {
      row.push(field);
      field = "";
      if (row.length > maxFields) return { ok: false, reason: `More than ${maxFields} columns.` };
      continue;
    }

    if (ch === "\r") continue;
    if (ch === "\n") {
      row.push(field);
      field = "";
      // Checked here as well as on the comma: the *last* field of a row is
      // added at the line break, so a bound checked only at the comma is a
      // bound the last column walks straight past.
      if (row.length > maxFields) return { ok: false, reason: `More than ${maxFields} columns.` };
      rows.push(row);
      row = [];
      if (rows.length > maxRows) {
        truncated = true;
        return { ok: true, rows: rows.slice(0, maxRows), truncated };
      }
      continue;
    }

    field += ch;
    if (field.length > maxField) return { ok: false, reason: "A field is too long to be a statement cell." };
  }

  if (inQuotes) return { ok: false, reason: "A quoted field was never closed." };
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (row.length > maxFields) return { ok: false, reason: `More than ${maxFields} columns.` };
    rows.push(row);
  }
  if (rows.length === 0) return { ok: false, reason: "File has no rows." };

  return { ok: true, rows, truncated };
}

// ---------------------------------------------------------------------------
// column identification — exact names only
// ---------------------------------------------------------------------------

/**
 * The header vocabulary. A column is identified by its **exact** name after
 * trimming and lower-casing, never by position and never by "the third column
 * looks like a date".
 *
 * Positions are how a parser starts working for a bank it was not written for,
 * and every such heuristic eventually misreads a balance column as an amount.
 */
const DATE_HEADERS = ["date", "posted date", "transaction date", "posting date", "value date"];
const DESC_HEADERS = ["description", "details", "narrative", "memo", "payee", "reference"];
const AMOUNT_HEADERS = ["amount", "value"];
const OUT_HEADERS = ["withdrawal", "debit", "money out", "paid out", "out"];
const IN_HEADERS = ["deposit", "credit", "money in", "paid in", "in"];
const BALANCE_HEADERS = ["balance", "running balance"];
const CURRENCY_HEADERS = ["currency", "ccy"];

export interface ColumnMap {
  date: number;
  description: number;
  /** Exactly one of these is set for a single-signed file; both for a split file. */
  amount?: number;
  out?: number;
  in?: number;
  balance?: number;
  currency?: number;
  /** Which shape the file uses. Stated, not inferred silently. */
  shape: "signed" | "split" | "unknown";
}

export type ColumnResult = { ok: true; map: ColumnMap } | { ok: false; reason: string };

export function identifyColumns(header: string[]): ColumnResult {
  const norm = header.map((h) => h.trim().toLowerCase().replace(/\s+/g, " "));
  const find = (names: string[]) => {
    for (const name of names) {
      const idx = norm.indexOf(name);
      if (idx >= 0) return idx;
    }
    return -1;
  };

  const date = find(DATE_HEADERS);
  const description = find(DESC_HEADERS);
  const amount = find(AMOUNT_HEADERS);
  const out = find(OUT_HEADERS);
  const amountIn = find(IN_HEADERS);
  const balance = find(BALANCE_HEADERS);
  const currency = find(CURRENCY_HEADERS);

  if (date < 0) return { ok: false, reason: "No date column found." };
  if (description < 0) return { ok: false, reason: "No description column found." };

  if (amount >= 0 && (out >= 0 || amountIn >= 0)) {
    return { ok: false, reason: "The file has both an amount column and a debit/credit split." };
  }

  if (out >= 0 || amountIn >= 0) {
    return {
      ok: true,
      map: {
        date,
        description,
        out: out >= 0 ? out : undefined,
        in: amountIn >= 0 ? amountIn : undefined,
        balance: balance >= 0 ? balance : undefined,
        currency: currency >= 0 ? currency : undefined,
        shape: "split",
      },
    };
  }

  if (amount >= 0) {
    return {
      ok: true,
      map: {
        date,
        description,
        amount,
        balance: balance >= 0 ? balance : undefined,
        currency: currency >= 0 ? currency : undefined,
        shape: "signed",
      },
    };
  }

  return { ok: false, reason: "No amount, debit or credit column found." };
}

// ---------------------------------------------------------------------------
// dates — never guessed
// ---------------------------------------------------------------------------

/** `"ambiguous"` is a refusal of its own kind, and must keep its own wording. */
type DateBuild = number | "ambiguous" | null;

const DATE_PATTERNS: { re: RegExp; build: (m: RegExpExecArray) => DateBuild }[] = [
  // ISO first: it is the only unambiguous numeric form.
  { re: /^(\d{4})-(\d{2})-(\d{2})$/, build: (m) => utc(+m[1], +m[2], +m[3]) },
  { re: /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, build: (m) => dayFirst(+m[1], +m[2], +m[3]) },
  { re: /^(\d{1,2})-(\d{1,2})-(\d{4})$/, build: (m) => dayFirst(+m[1], +m[2], +m[3]) },
  { re: /^(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})$/, build: (m) => namedDay(+m[1], m[2], +m[3]) },
  { re: /^([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})$/, build: (m) => namedDay(+m[2], m[1], +m[3]) },
];

function utc(year: number, month: number, day: number): number | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const ms = Date.UTC(year, month - 1, day);
  const back = new Date(ms);
  // Rejects 31 February rather than rolling it into March.
  return back.getUTCMonth() === month - 1 && back.getUTCDate() === day ? ms : null;
}

/**
 * Day-first, and **refuses the ambiguous case**.
 *
 * `03/04/2026` could be 3 April or 4 March and the file does not say which. A
 * transaction dated wrong by a month is a record that cannot be corrected by
 * looking at it, so the row is refused and the uncertainty is stated.
 */
function dayFirst(a: number, b: number, year: number): DateBuild {
  if (a > 12 && b <= 12) return utc(year, b, a);
  if (b > 12 && a <= 12) return utc(year, a, b);
  if (a === b) return utc(year, b, a);
  // Both readings survive and the file does not say which is meant. This module
  // has no opinion about where the user is, so the row is refused and says why.
  return "ambiguous";
}

function namedDay(day: number, monthName: string, year: number): number | null {
  const key = monthName.trim().slice(0, 4).toLowerCase();
  const month = MONTHS[key] ?? MONTHS[key.slice(0, 3)];
  if (month === undefined) return null;
  return utc(year, month + 1, day);
}

export type DateResult = { ok: true; at: number } | { ok: false; reason: string };

export function parseStatementDate(raw: string): DateResult {
  const text = raw.trim();
  if (text === "") return { ok: false, reason: "empty date" };
  for (const { re, build } of DATE_PATTERNS) {
    const m = re.exec(text);
    if (!m) continue;
    const at = build(m);
    if (at === "ambiguous") return { ok: false, reason: `"${text}" is ambiguous (day or month first?)` };
    if (at === null) return { ok: false, reason: `"${text}" is not a real date` };
    return { ok: true, at };
  }
  if (/^\d{1,2}[/.]\d{1,2}[/.]\d{2,4}$/.test(text)) {
    return { ok: false, reason: `"${text}" is ambiguous (day or month first?)` };
  }
  return { ok: false, reason: `"${text}" is not a recognised date format` };
}

// ---------------------------------------------------------------------------
// amounts
// ---------------------------------------------------------------------------

export type AmountResult =
  | { ok: true; amountMinor: number; direction: "in" | "out" }
  | { ok: false; reason: string };

/** A magnitude with no direction — in a debit/credit split the *column* says which. */
export type MagnitudeResult =
  | { ok: true; amountMinor: number }
  | { ok: false; reason: string };

/**
 * A signed or unsigned decimal. Parentheses mean out, because that is what they
 * mean on a statement, and a trailing minus is accepted for the same reason.
 *
 * The decimal-to-integer step is `money.ts`'s and not a second copy of it.
 * ADR-031 says amounts are integers in minor units and says so in one place; a
 * second rounding rule here would be a second, differently-behaving answer to
 * "what is 1.005 pounds", and the two would agree on 99.9% of statements.
 */
export function parseSignedAmount(raw: string, currency: CsvCurrency): AmountResult {
  let text = raw.trim();
  if (text === "") return { ok: false, reason: "empty amount" };

  // Currency symbols and thousands separators, once, explicitly.
  text = text.replace(/^[$£€₹¥]|CA\$|A\$/g, "").replace(/[\s,]/g, "");
  if (text.startsWith("(") && text.endsWith(")")) {
    const inner = parseUnsigned(text.slice(1, -1), currency);
    return inner.ok ? { ok: true, amountMinor: inner.amountMinor, direction: "out" } : inner;
  }
  // A leading or trailing minus both mean money out. Both have to set the flag:
  // trimming the sign without recording it turns a withdrawal into a deposit.
  let negative = text.startsWith("-");
  if (negative) text = text.slice(1);
  else if (text.endsWith("-")) {
    text = text.slice(0, -1);
    negative = true;
  }

  const inner = parseUnsigned(text, currency);
  if (!inner.ok) return inner;
  return {
    ok: true,
    amountMinor: inner.amountMinor,
    direction: negative ? "out" : "in",
  };
}

/** An unsigned magnitude — used for a debit/credit split, where the column says the direction. */
export function parseMagnitude(raw: string, currency: CsvCurrency): MagnitudeResult {
  const text = raw.trim().replace(/^[$£€₹¥]|CA\$|A\$/g, "").replace(/[\s,]/g, "");
  if (text === "") return { ok: false, reason: "empty amount" };
  return parseUnsigned(text, currency);
}

/**
 * The narrow grammar first, then `money.ts`'s arithmetic.
 *
 * The regex is what makes "an amount" mean one thing: digits, at most one dot,
 * no sign (the caller decided that), no exponent, nothing left over once
 * thousands separators are gone. Anything else is refused with the offending
 * cell quoted back, because "invalid amount" alone does not let anyone fix it.
 */
function parseUnsigned(text: string, currency: CsvCurrency): MagnitudeResult {
  if (!/^\d+(\.\d+)?$/.test(text)) return { ok: false, reason: `"${clamp(text)}" is not a plain amount` };
  const amountMinor = parseAmountToMinor(text, currency);
  if (amountMinor === null) return { ok: false, reason: `"${clamp(text)}" is not an amount we can store` };
  return { ok: true, amountMinor };
}

/** A refusal quotes the cell, bounded — a 200 KB cell is not echoed back. */
function clamp(text: string): string {
  return text.length > 24 ? `${text.slice(0, 24)}…` : text;
}

// ---------------------------------------------------------------------------
// row identity
// ---------------------------------------------------------------------------

/**
 * FNV-1a over the row's own content.
 *
 * Deterministic, dependency-free, and — the point — derived from the data rather
 * than from a file name or a row number, so the same statement uploaded twice
 * produces the same ids and the second upload writes nothing.
 */
export function rowId(fields: string[]): string {
  const normalised = fields.map((f) => f.trim().toLowerCase().replace(/\s+/g, " ")).join("");
  let hash = 0x811c9dc5;
  for (let i = 0; i < normalised.length; i += 1) {
    hash ^= normalised.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `csv:${hash.toString(16).padStart(8, "0")}`;
}

// ---------------------------------------------------------------------------
// the preview
// ---------------------------------------------------------------------------

export interface CsvCandidate {
  /** The row number in the file, 1-based, header included. Stated for the user. */
  row: number;
  externalId: string;
  postedAt: number;
  amountMinor: number;
  direction: "in" | "out";
  label: string;
}

export interface CsvPreview {
  ok: true;
  candidates: CsvCandidate[];
  /** Rows that were refused, with the reason. Never silently dropped. */
  rejected: { row: number; reason: string }[];
  /** Things a person must decide. Rendered, not logged. */
  uncertainty: string[];
  /** The signed total of what we would write, in minor units. */
  computedTotalMinor: number;
  /** The first running balance the file printed, when it printed one. */
  openingBalanceMinor: number | null;
  /** The last running balance the file printed, when it printed one. */
  closingBalanceMinor: number | null;
  /**
   * Whether the file's own arithmetic agrees with the rows.
   *
   * `null` when there is no balance column, and `null` is **not** a pass: there
   * is nothing to check against, which is a different state from checked.
   */
  totalsMatch: boolean | null;
  columnMap: ColumnMap;
  truncated: boolean;
}

export type PreviewResult = CsvPreview | { ok: false; reason: string };

/**
 * Turn statement text into **candidates** — nothing more.
 *
 * The caller shows these to a person, the person confirms, and only then does a
 * mutation write. That ordering is the whole safety story of an import, and it
 * is why this function has no access to a database at all.
 */
export function buildImportPreview(
  input: string,
  opts: { currency: CsvCurrency; limits?: CsvLimits },
): PreviewResult {
  const parsed = parseCsv(input, opts.limits);
  if (!parsed.ok) return { ok: false, reason: parsed.reason };

  const [header, ...body] = parsed.rows;
  if (!header) return { ok: false, reason: "File has no header row." };

  const columns = identifyColumns(header);
  if (!columns.ok) return { ok: false, reason: columns.reason };
  const map = columns.map;

  const uncertainty: string[] = [];
  const rejected: { row: number; reason: string }[] = [];
  const all: CsvCandidate[] = [];
  let computedTotalMinor = 0;

  // A running balance is the file's own arithmetic. If the opening balance and
  // the movements are both present, the last running balance is a *check* on
  // the rows rather than a number we trust.
  let opening: number | null = null;
  let closing: number | null = null;

  body.forEach((fields, index) => {
    const rowNumber = index + 2;
    if (fields.every((f) => f.trim() === "")) return;

    const date = parseStatementDate(fields[map.date] ?? "");
    if (!date.ok) {
      rejected.push({ row: rowNumber, reason: date.reason });
      return;
    }

    let amount: AmountResult;
    if (map.shape === "signed") {
      amount = parseSignedAmount(fields[map.amount ?? -1] ?? "", opts.currency);
    } else {
      const outRaw = map.out !== undefined ? (fields[map.out] ?? "").trim() : "";
      const inRaw = map.in !== undefined ? (fields[map.in] ?? "").trim() : "";
      if (outRaw !== "" && inRaw !== "") {
        rejected.push({ row: rowNumber, reason: "both a debit and a credit on one row" });
        return;
      }
      const side = outRaw !== "" ? (map.out as number) : inRaw !== "" ? (map.in as number) : -1;
      if (side < 0) {
        rejected.push({ row: rowNumber, reason: "neither a debit nor a credit" });
        return;
      }
      const magnitude = parseMagnitude(fields[side] ?? "", opts.currency);
      if (!magnitude.ok) {
        rejected.push({ row: rowNumber, reason: magnitude.reason });
        return;
      }
      amount = { ok: true, amountMinor: magnitude.amountMinor, direction: side === map.out ? "out" : "in" };
    }

    if (!amount.ok) {
      rejected.push({ row: rowNumber, reason: amount.reason });
      return;
    }

    // A row that moves no money is a balance line, not a transaction. Writing
    // one would be the same category error as storing a balance as a movement,
    // which is the single thing ADR-031 exists to prevent — and `0.00` in the
    // amount column of a statement is almost always an opening or carried
    // figure rather than a transaction.
    if (amount.amountMinor === 0) {
      rejected.push({
        row: rowNumber,
        reason: "this row has no amount, so it looks like a balance rather than a transaction",
      });
      return;
    }

    const signed = amount.direction === "out" ? -amount.amountMinor : amount.amountMinor;
    computedTotalMinor += signed;

    const label = (fields[map.description] ?? "").trim() || "(no description)";
    all.push({
      row: rowNumber,
      externalId: rowId(fields),
      postedAt: date.at,
      amountMinor: amount.amountMinor,
      direction: amount.direction,
      label: label.slice(0, 120),
    });

    if (map.balance !== undefined) {
      const b = parseSignedAmount(fields[map.balance] ?? "", opts.currency);
      if (b.ok) {
        // A negative balance is a real thing — an overdrawn account — so the
        // sign is kept rather than read off the magnitude.
        const at = b.direction === "out" ? -b.amountMinor : b.amountMinor;
        // The first row's balance is the balance **after** its own movement, so
        // the opening balance is that figure minus what the row did. Getting
        // this backwards makes every statement without an explicit opening row
        // report a false discrepancy — which is most of them — and a false
        // discrepancy blocks the import behind a warning about the user's own
        // bank being wrong.
        if (opening === null) opening = at - signed;
        closing = at;
      }
    }
  });

  if (rejected.length > 0) {
    uncertainty.push(
      `${rejected.length} row${rejected.length === 1 ? "" : "s"} could not be read and will not be imported.`,
    );
  }
  if (parsed.truncated) {
    uncertainty.push("The file had more rows than the limit, so only the first ones were read.");
  }

  const candidates = all.slice(0, LIMITS.maxCandidates);
  if (all.length > candidates.length) {
    uncertainty.push(
      `This statement has ${all.length} readable rows but only the first ${LIMITS.maxCandidates} will be imported. Split it to bring in the rest.`,
    );
  }
  // The reconciliation the file itself permits: closing − opening must equal the
  // sum of the rows. Compared against any other pair this check either always
  // passes or always fails, so it is the one piece of arithmetic in this module
  // worth writing out in full. The gap is reported as a magnitude — both
  // movements are already stated with their signs, so the sign of the difference
  // would only tell someone which of two visible numbers is smaller.
  let totalsMatch: boolean | null = null;
  if (opening !== null && closing !== null) {
    totalsMatch = closing - opening === computedTotalMinor;
    if (!totalsMatch) {
      uncertainty.push(
        `These rows move ${formatMinor(computedTotalMinor, opts.currency)} but the balance moves ${formatMinor(closing - opening, opts.currency)} — a difference of ${formatMinor(Math.abs((closing - opening) - computedTotalMinor), opts.currency)}. Check the statement before confirming.`,
      );
    }
  }

  return {
    ok: true,
    candidates,
    rejected,
    uncertainty,
    computedTotalMinor,
    openingBalanceMinor: opening,
    closingBalanceMinor: closing,
    totalsMatch,
    columnMap: map,
    truncated: parsed.truncated,
  };
}

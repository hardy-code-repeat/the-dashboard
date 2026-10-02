import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  buildImportPreview,
  identifyColumns,
  parseCsv,
  parseMagnitude,
  parseSignedAmount,
  parseStatementDate,
  rowId,
} from "./csv";
import type { CsvParseResult, PreviewResult } from "./csv";

/** Narrowing helpers: every test below is about the refusal branch too. */
function rowsOf(result: CsvParseResult): string[][] {
  assert.equal(result.ok, true, result.ok ? "" : `expected a parse: ${result.reason}`);
  return result.rows;
}

function reasonOf(result: CsvParseResult): string {
  assert.equal(result.ok, false, "expected a refusal, got a parse");
  return (result as { ok: false; reason: string }).reason;
}

function previewOf(input: string, currency: "GBP" | "USD" | "JPY" = "GBP"): Exclude<PreviewResult, { ok: false }> {
  const result = buildImportPreview(input, { currency });
  assert.equal(result.ok, true, result.ok ? "" : `expected a preview: ${result.reason}`);
  return result as Exclude<PreviewResult, { ok: false }>;
}

function refusalOf(input: string, currency: "GBP" | "USD" | "JPY" = "GBP"): string {
  const result = buildImportPreview(input, { currency });
  assert.equal(result.ok, false, "expected the import to be refused");
  return (result as { ok: false; reason: string }).reason;
}

const SIGNED_HEADER = "Date,Description,Amount,Balance";

describe("RFC 4180 parsing, including everything that is not simple", () => {
  it("reads a plain file", () => {
    const rows = rowsOf(parseCsv("a,b\n1,2\n"));
    assert.deepEqual(rows, [["a", "b"], ["1", "2"]]);
  });

  it("keeps a comma that is inside quotes", () => {
    const rows = rowsOf(parseCsv('Date,Description\n2026-01-02,"Smith, John"\n'));
    assert.deepEqual(rows[1], ["2026-01-02", "Smith, John"]);
  });

  it("turns a doubled quote inside a quoted field back into one quote", () => {
    const rows = rowsOf(parseCsv('Description\n"He said ""hi"""\n'));
    assert.equal(rows[1]?.[0], 'He said "hi"');
  });

  it("keeps a line break inside a quoted field, and does not split the row", () => {
    const rows = rowsOf(parseCsv('Date,Description,Amount\n2026-01-02,"Coffee\nShop",3.50\n'));
    assert.equal(rows.length, 2, "a newline in quotes is not a row break");
    assert.deepEqual(rows[1], ["2026-01-02", "Coffee\nShop", "3.50"]);
  });

  it("strips a byte-order mark so the first column name can match", () => {
    const rows = rowsOf(parseCsv("\uFEFFDate,Description\n2026-01-02,Coffee\n"));
    assert.equal(rows[0]?.[0], "Date", "the BOM is not part of the column name");
  });

  it("treats CRLF and a bare CR as line endings, not as content", () => {
    const rows = rowsOf(parseCsv("Date,Description\r\n2026-01-02,Coffee\r\n"));
    assert.deepEqual(rows[1], ["2026-01-02", "Coffee"]);
  });

  it("keeps a blank trailing field, which is how a debit/credit split says 'nothing here'", () => {
    const rows = rowsOf(parseCsv("Date,Debit,Credit\n2026-01-03,,1000.00\n"));
    assert.deepEqual(rows[1], ["2026-01-03", "", "1000.00"]);
  });
});

describe("a malformed file is refused, never half-read", () => {
  it("refuses an unclosed quote rather than swallowing the rest of the file", () => {
    const reason = reasonOf(parseCsv('Date,Description\n2026-01-02,"never closed\n'));
    assert.match(reason, /never closed/);
  });

  it("refuses a quote that opens in the middle of a bare field", () => {
    const reason = reasonOf(parseCsv('Date,Description\n2026-01-02,abc"def"\n'));
    assert.match(reason, /quote/i);
  });

  it("refuses an empty file with a reason a person can act on", () => {
    assert.match(reasonOf(parseCsv("")), /empty/i);
  });

  it("refuses a UTF-16 file instead of parsing it into mojibake", () => {
    const reason = reasonOf(parseCsv("\uFFFEDate,Description\n"));
    assert.match(reason, /UTF-16/i);
  });

  it("refuses null bytes, so a renamed binary cannot become a statement", () => {
    const reason = reasonOf(parseCsv("Date,Description\n2026-01-02,Co\u0000ffee\n"));
    assert.match(reason, /null bytes/i);
  });
});

describe("the bounds are enforced here, not by the caller", () => {
  it("refuses a file over the byte limit", () => {
    const reason = reasonOf(parseCsv("x".repeat(64), { maxBytes: 16 }));
    assert.match(reason, /larger than/i);
  });

  it("stops at the row limit and says that it stopped", () => {
    const input = "Date,Description,Amount\n" + "2026-01-02,Coffee,1.00\n".repeat(10);
    const parsed = parseCsv(input, { maxRows: 4 });
    assert.equal(parsed.ok, true);
    assert.equal(parsed.ok && parsed.rows.length, 4);
    assert.equal(parsed.ok && parsed.truncated, true, "truncation is stated, never silent");
  });

  it("surfaces truncation to the person as an uncertainty", () => {
    // Deliberately the *default* limit and no caller-supplied one: the bound has
    // to hold when nobody remembers to pass it. 6000 short rows stay under the
    // byte cap, so this exercises the row bound and not the size bound.
    const input = SIGNED_HEADER + "\n" + "2026-01-02,x,-1.00\n".repeat(6000);
    const result = previewOf(input);
    assert.equal(result.truncated, true);
    assert.ok(
      result.uncertainty.some((u) => /only the first ones were read/i.test(u)),
      `expected a truncation warning, got ${JSON.stringify(result.uncertainty)}`,
    );
  });

  it("refuses too many columns", () => {
    const reason = reasonOf(parseCsv("a,b,c,d\n1,2,3,4\n", { maxFieldsPerRow: 3 }));
    assert.match(reason, /columns/i);
  });

  it("refuses an over-long bare field", () => {
    const reason = reasonOf(parseCsv(`Description\n${"x".repeat(40)}\n`, { maxFieldLength: 10 }));
    assert.match(reason, /too long/i);
  });

  it("refuses an over-long field hidden inside quotes", () => {
    // The bound must apply between the quotes too, or it is not a bound.
    const reason = reasonOf(parseCsv(`Description\n"${"x".repeat(40)}"\n`, { maxFieldLength: 10 }));
    assert.match(reason, /too long/i);
  });
});

describe("a column is identified by its name, never by its position", () => {
  it("finds the columns whatever order they are in", () => {
    const found = identifyColumns(["Amount", "Balance", "Description", "Date"]);
    assert.equal(found.ok, true);
    assert.equal(found.ok && found.map.shape, "signed");
    assert.equal(found.ok && found.map.date, 3);
    assert.equal(found.ok && found.map.amount, 0);
    assert.equal(found.ok && found.map.balance, 1);
  });

  it("matches a header regardless of case and spacing", () => {
    const found = identifyColumns(["  POSTED   DATE ", "Payee", "Money Out", "Running Balance"]);
    assert.equal(found.ok, true);
    assert.equal(found.ok && found.map.shape, "split");
    assert.equal(found.ok && found.map.out, 2);
    assert.equal(found.ok && found.map.balance, 3);
  });

  it("refuses a file with no date column", () => {
    const found = identifyColumns(["Description", "Amount"]);
    assert.equal(found.ok, false);
    assert.match(found.ok ? "" : found.reason, /No date column/i);
  });

  it("refuses a file with no description column", () => {
    const found = identifyColumns(["Date", "Amount"]);
    assert.equal(found.ok, false);
    assert.match(found.ok ? "" : found.reason, /No description column/i);
  });

  it("refuses a file with no way to tell an amount from a balance", () => {
    const found = identifyColumns(["Date", "Description"]);
    assert.equal(found.ok, false);
    assert.match(found.ok ? "" : found.reason, /No amount, debit or credit column/i);
  });

  it("refuses a file carrying both a signed amount and a debit/credit split", () => {
    // Reading both shapes at once is how an importer silently doubles a row.
    const found = identifyColumns(["Date", "Description", "Amount", "Debit", "Credit"]);
    assert.equal(found.ok, false);
    assert.match(found.ok ? "" : found.reason, /both an amount column and a debit\/credit split/i);
  });

  it("does not identify a column by a name that merely resembles one", () => {
    const found = identifyColumns(["Date", "Description", "Amount GBP", "Value Date"]);
    assert.equal(found.ok, false, "'Amount GBP' is not the amount column; position is not permission");
  });
});

describe("a date is never guessed", () => {
  it("reads an unambiguous ISO date", () => {
    const got = parseStatementDate("2026-01-02");
    assert.equal(got.ok && new Date(got.at).toISOString(), "2026-01-02T00:00:00.000Z");
  });

  it("reads a day-first date when the day cannot be a month", () => {
    const got = parseStatementDate("25/12/2026");
    assert.equal(got.ok && new Date(got.at).toISOString(), "2026-12-25T00:00:00.000Z");
  });

  it("reads a day-first date when the month cannot be a day", () => {
    const got = parseStatementDate("03/25/2026");
    assert.equal(got.ok && new Date(got.at).toISOString(), "2026-03-25T00:00:00.000Z");
  });

  it("refuses the ambiguous case and says that is the reason", () => {
    // The reason matters: 'not a real date' would send someone looking for a
    // typo that is not there.
    const got = parseStatementDate("03/04/2026");
    assert.equal(got.ok, false);
    assert.match(got.ok ? "" : got.reason, /ambiguous/i);
  });

  it("refuses a date that is not a real day", () => {
    const got = parseStatementDate("31/02/2026");
    assert.equal(got.ok, false);
    assert.match(got.ok ? "" : got.reason, /not a real date/i);
  });

  it("reads a named month", () => {
    const got = parseStatementDate("3 Mar 2026");
    assert.equal(got.ok && new Date(got.at).toISOString(), "2026-03-03T00:00:00.000Z");
  });

  it("reads a month-first named date with a comma", () => {
    const got = parseStatementDate("Mar 3, 2026");
    assert.equal(got.ok && new Date(got.at).toISOString(), "2026-03-03T00:00:00.000Z");
  });

  it("refuses an empty date", () => {
    assert.equal(parseStatementDate("   ").ok, false);
  });

  it("refuses an unrecognised format", () => {
    const got = parseStatementDate("02.01.26");
    assert.equal(got.ok, false);
  });
});

describe("an amount is never guessed either", () => {
  it("reads a plain decimal", () => {
    const got = parseSignedAmount("12.34", "GBP");
    assert.equal(got.ok && got.amountMinor, 1234);
    assert.equal(got.ok && got.direction, "in");
  });

  it("reads a leading minus as money out", () => {
    const got = parseSignedAmount("-12.34", "GBP");
    assert.equal(got.ok && got.amountMinor, 1234, "magnitude stays positive");
    assert.equal(got.ok && got.direction, "out");
  });

  it("reads parentheses as money out, because that is what they mean", () => {
    const got = parseSignedAmount("(12.34)", "GBP");
    assert.equal(got.ok && got.amountMinor, 1234);
    assert.equal(got.ok && got.direction, "out");
  });

  it("reads a trailing minus as money out", () => {
    const got = parseSignedAmount("12.34-", "GBP");
    assert.equal(got.ok && got.direction, "out");
  });

  it("strips a currency symbol and thousands separators", () => {
    for (const [raw, expected] of [
      ["$1,234.56", 123456],
      ["£1,234.56", 123456],
      ["1 234,56".replace(",", "."), 123456],
      ["CA$1,234.56", 123456],
    ] as const) {
      const got = parseSignedAmount(raw, "USD");
      assert.equal(got.ok && got.amountMinor, expected, `expected ${raw} to read as ${expected}`);
    }
  });

  it("gives a currency with no minor unit no invented decimal place", () => {
    const got = parseSignedAmount("1500", "JPY");
    assert.equal(got.ok && got.amountMinor, 1500);
  });

  it("refuses anything that is not an amount, quoting the offending cell", () => {
    for (const bad of ["", "   ", "abc", "12.34abc", "1e3", "--5", "1.2.3"]) {
      const got = parseSignedAmount(bad, "GBP");
      assert.equal(got.ok, false, `expected ${JSON.stringify(bad)} to be refused`);
    }
  });

  it("reads a magnitude with no direction for a debit/credit split", () => {
    assert.equal(parseMagnitude("3.50", "GBP").ok, true);
    assert.equal(parseMagnitude("-3.50", "GBP").ok, false, "a signed cell in an unsigned column is refused");
  });
});

describe("a row is identified by its content, so a re-upload writes nothing", () => {
  it("is deterministic", () => {
    const fields = ["2026-01-02", "Coffee", "-3.50"];
    assert.equal(rowId(fields), rowId([...fields]));
  });

  it("ignores case and surrounding whitespace, because a bank is not that fussy", () => {
    assert.equal(rowId(["2026-01-02", "Coffee"]), rowId([" 2026-01-02 ", " coffee "]));
  });

  it("changes when the content changes", () => {
    assert.notEqual(rowId(["2026-01-02", "Coffee", "-3.50"]), rowId(["2026-01-02", "Coffee", "-3.51"]));
  });

  it("is not derived from the row's position in the file", () => {
    // Same row content at line 2 and at line 40 is the same row.
    const first = previewOf(`${SIGNED_HEADER}\n2026-01-02,Coffee,-3.50,10.00\n`);
    const padded = previewOf(
      `${SIGNED_HEADER}\n` + "2026-01-01,Padding,0.00,0.00\n".repeat(38) + "2026-01-02,Coffee,-3.50,10.00\n",
    );
    const coffeeIn = (r: ReturnType<typeof previewOf>) => r.candidates.find((c) => c.label === "Coffee");
    assert.equal(coffeeIn(first)?.externalId, coffeeIn(padded)?.externalId);
  });

  it("gives two identical rows the same id, so the second cannot be written twice", () => {
    const row = "2026-01-02,Coffee,-3.50,10.00\n";
    const result = previewOf(`${SIGNED_HEADER}\n${row}${row}`);
    assert.equal(result.candidates.length, 2, "the preview shows both rows honestly");
    assert.equal(
      result.candidates[0]?.externalId,
      result.candidates[1]?.externalId,
      "they share a key, so applying writes one",
    );
  });
});

describe("the preview reconciles the file against itself", () => {
  const agreeing = [
    SIGNED_HEADER,
    "2026-01-02,Coffee,-3.50,96.50",
    "2026-01-03,Salary,1000.00,1096.50",
    "",
  ].join("\n");

  it("accepts rows whose movement equals the movement of the balance", () => {
    const result = previewOf(agreeing);
    assert.equal(result.computedTotalMinor, 99650);
    assert.equal(result.openingBalanceMinor, 10000);
    assert.equal(result.closingBalanceMinor, 109650);
    assert.equal(result.totalsMatch, true);
    assert.equal(
      result.uncertainty.length,
      0,
      `an agreeing file raises no doubt: ${JSON.stringify(result.uncertainty)}`,
    );
  });

  it("says so when the rows do not add up to the balance", () => {
    const result = previewOf(agreeing.replace("1096.50", "1096.00"));
    assert.equal(result.totalsMatch, false);
    // The message states the *size* of the gap, not just two numbers to subtract.
    assert.ok(
      result.uncertainty.some((u) => /£996\.50/.test(u) && /£996\.00/.test(u) && /difference of £0\.50/.test(u)),
      `expected the discrepancy in the message, got ${JSON.stringify(result.uncertainty)}`,
    );
  });

  it("accepts a statement that has no opening-balance row", () => {
    // The first row's balance is the balance *after* its own movement. Treating
    // it as the opening balance makes a correct statement report a false
    // discrepancy of exactly the first row's amount — which would then block
    // the import behind a warning that the user's bank is wrong.
    const result = previewOf(
      [
        SIGNED_HEADER,
        "2026-01-02,Coffee,-3.50,96.50",
        "2026-01-03,Salary,1000.00,1096.50",
        "",
      ].join("\n"),
    );
    assert.equal(result.computedTotalMinor, 99650);
    assert.equal(result.openingBalanceMinor, 10000, "96.50 back-corrected by the 3.50 that row moved");
    assert.equal(result.closingBalanceMinor, 109650);
    assert.equal(result.totalsMatch, true, JSON.stringify(result.uncertainty));
    assert.deepEqual(result.uncertainty, []);
  });

  it("reports 'not checkable' as null, which is not the same as passing", () => {
    const result = previewOf("Date,Description,Amount\n2026-01-02,Coffee,-3.50\n");
    assert.equal(result.totalsMatch, null);
    assert.equal(result.openingBalanceMinor, null);
    assert.equal(
      result.uncertainty.some((u) => /does not add up/i.test(u)),
      false,
      "no balance column means nothing to complain about",
    );
  });

  it("reads a negative closing balance as a real overdraft, not a positive one", () => {
    const result = previewOf(
      [SIGNED_HEADER, "2026-01-01,Opening,0.00,-20.00", "2026-01-02,Fees,-1.00,-21.00", ""].join("\n"),
      "GBP",
    );
    assert.equal(result.closingBalanceMinor, -2100);
    assert.equal(result.totalsMatch, true);
  });
});

describe("a bad row is reported, never dropped", () => {
  it("keeps the good rows and states why each bad row was refused", () => {
    const result = previewOf(
      [
        SIGNED_HEADER,
        "2026-01-02,Coffee,-3.50,96.50",
        "03/04/2026,Ambiguous date,-1.00,95.50",
        "2026-01-04,Bad amount,not-a-number,1.00",
        ",Missing date,-1.00,0.00",
        "",
      ].join("\n"),
    );

    assert.equal(result.candidates.length, 1, "only the readable row is a candidate");
    assert.deepEqual(
      result.rejected.map((r) => r.row),
      [3, 4, 5],
      "rejections are located by row number so they can be found in the file",
    );
    assert.match(result.rejected[0]?.reason ?? "", /ambiguous/i);
    assert.match(result.rejected[1]?.reason ?? "", /plain amount/);
    assert.match(result.rejected[2]?.reason ?? "", /empty date/);
    assert.ok(result.uncertainty.some((u) => /3 rows could not be read/.test(u)));
  });

  it("refuses a split row that carries both a debit and a credit", () => {
    const result = previewOf("Date,Description,Debit,Credit\n2026-01-02,Both,3.50,4.00\n");
    assert.equal(result.candidates.length, 0);
    assert.match(result.rejected[0]?.reason ?? "", /both a debit and a credit/);
  });

  it("refuses a split row with neither a debit nor a credit", () => {
    const result = previewOf("Date,Description,Debit,Credit\n2026-01-02,Neither,,\n");
    assert.match(result.rejected[0]?.reason ?? "", /neither a debit nor a credit/);
  });

  it("refuses a row that moves no money, because that is a balance not a transaction", () => {
    const result = previewOf(
      [SIGNED_HEADER, "2026-01-01,Opening balance,0.00,100.00", "2026-01-02,Coffee,-3.50,96.50", ""].join(
        "\n",
      ),
    );
    assert.deepEqual(
      result.candidates.map((c) => c.label),
      ["Coffee"],
      "a 0.00 row is not money moving",
    );
    assert.match(result.rejected[0]?.reason ?? "", /no amount/i);
  });

  it("reconciles correctly even when the only zero-amount row is the opening one", () => {
    const result = previewOf(
      [SIGNED_HEADER, "2026-01-01,Opening balance,0.00,100.00", "2026-01-02,Coffee,-3.50,96.50", ""].join(
        "\n",
      ),
    );
    assert.equal(
      result.totalsMatch,
      true,
      `dropping the balance line must not lose the opening balance: ${JSON.stringify(result.uncertainty)}`,
    );
  });

  it("falls back to a stated label rather than an empty one", () => {
    const result = previewOf(`${SIGNED_HEADER}\n2026-01-02,,-3.50,10.00\n`);
    assert.equal(result.candidates[0]?.label, "(no description)");
  });

  it("returns nothing to import for a header-only file, without pretending it failed", () => {
    const result = previewOf(`${SIGNED_HEADER}\n`);
    assert.equal(result.ok, true);
    assert.equal(result.candidates.length, 0);
    assert.equal(result.rejected.length, 0);
  });
});

describe("a preview is refused as a whole, never returned half-built", () => {
  it("refuses a file whose header has no date column", () => {
    assert.match(refusalOf("Description,Amount\nCoffee,3.50\n"), /No date column/i);
  });

  it("refuses a file whose header names no amount, debit or credit", () => {
    assert.match(refusalOf("Date,Description\n2026-01-02,Coffee\n"), /No amount, debit or credit column/i);
  });

  it("refuses a header-only file that is entirely blank", () => {
    assert.match(refusalOf(""), /empty/i);
  });
});

describe("the currency is the caller's to state", () => {
  it("carries the caller's currency through to the rounding rule", () => {
    // 1.005 is 101 pence in GBP and 1.01 in JPY, which has no pence at all.
    assert.equal(previewOf("Date,Description,Amount\n2026-01-02,X,1.005\n", "GBP").computedTotalMinor, 101);
    assert.equal(previewOf("Date,Description,Amount\n2026-01-02,X,1.005\n", "JPY").computedTotalMinor, 1);
  });
});
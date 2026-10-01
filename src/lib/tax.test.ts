/**
 * Regression fixtures for the tax rules engine.
 *
 * TASK-0A-001 / REQ-021 / REQ-030.
 *
 * These figures were taken from the issuing authority and are recorded with a
 * source string. This suite is what stops a well-meaning edit from quietly
 * making one of them wrong — especially the 2026 US mileage change, where every
 * secondary source still quotes a single stale rate.
 *
 * Where the engine has a known gap, the fixture documents the gap and the debt
 * is recorded rather than the behaviour being quietly accepted.
 *
 * Uses `node:test` + `node:assert/strict` — see the note in `nlp.test.ts`.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  categoriseExpense,
  COUNTRIES,
  filingYearFor,
  mileageRateFor,
  readinessScore,
  US_1099K,
  US_HOME_OFFICE,
  US_MILEAGE,
  estimateTax,
} from "./tax";
import type { CountryCode, DeductionInput } from "./tax";

const d = (iso: string) => new Date(`${iso}T12:00:00`);

function input(over: Partial<DeductionInput> = {}): DeductionInput {
  return {
    country: "US" as CountryCode,
    taxYear: 2026,
    grossIncome: 0,
    expenses: [],
    businessMiles: 0,
    homeOfficeSqFt: 0,
    charitableMiles: 0,
    donations: 0,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// Mileage — the 2026 rate changed mid-year
// ---------------------------------------------------------------------------

test("mileage — first half of 2026 uses 72.5¢ (IR-2025-128)", () => {
  const r = mileageRateFor(d("2026-01-15"));
  assert.strictEqual(r?.business, 0.725);
  assert.strictEqual(r?.source, "IRS IR-2025-128");
});

test("mileage — second half of 2026 uses 76¢ (IR-2026-29)", () => {
  const r = mileageRateFor(d("2026-07-15"));
  assert.strictEqual(r?.business, 0.76);
  assert.strictEqual(r?.source, "IRS IR-2026-29");
});

test("mileage — 2025 was a flat 70¢", () => {
  assert.strictEqual(mileageRateFor(d("2025-01-01"))?.business, 0.7);
  assert.strictEqual(mileageRateFor(d("2025-12-31"))?.business, 0.7);
});

test("mileage — charity rate is unchanged across the 2026 split", () => {
  assert.strictEqual(mileageRateFor(d("2026-02-01"))?.charity, 0.14);
  assert.strictEqual(mileageRateFor(d("2026-09-01"))?.charity, 0.14);
});

test("mileage — dates outside the published table return null", () => {
  assert.strictEqual(mileageRateFor(d("2020-05-05")), null);
  assert.strictEqual(mileageRateFor(d("2030-05-05")), null);
});

test("mileage — the published table has no overlapping windows", () => {
  for (const a of US_MILEAGE) {
    for (const b of US_MILEAGE) {
      if (a === b) continue;
      assert.ok(a.to < b.from || b.to < a.from, `windows overlap: ${a.from}..${a.to} and ${b.from}..${b.to}`);
    }
  }
});

test("mileage — 1000 business miles in 2026 uses the later rate and warns", () => {
  const r = estimateTax(input({ grossIncome: 100_000, businessMiles: 1000 }));
  assert.strictEqual(r.totalDeductible, 760);
  const line = r.lines.find((l) => l.label.startsWith("Mileage"));
  assert.ok(line);
  assert.ok(line.note?.includes("72.5¢ to 76¢"), "mid-year change warning missing");
});

// ---------------------------------------------------------------------------
// Home office — $5/sq ft, capped at 300 sq ft
// ---------------------------------------------------------------------------

test("home office — constants match Rev. Proc. 2013-13", () => {
  assert.strictEqual(US_HOME_OFFICE.perSqFt, 5);
  assert.strictEqual(US_HOME_OFFICE.maxSqFt, 300);
  assert.strictEqual(US_HOME_OFFICE.maxDeduction, 1500);
});

test("home office — 200 sq ft claims $1,000", () => {
  const r = estimateTax(input({ homeOfficeSqFt: 200 }));
  assert.strictEqual(r.totalDeductible, 1000);
});

test("home office — 500 sq ft is capped at $1,500", () => {
  const r = estimateTax(input({ homeOfficeSqFt: 500 }));
  assert.strictEqual(r.totalDeductible, 1500);
  assert.ok(r.lines.some((l) => l.label.startsWith("Home office") && l.note?.includes("Capped")));
});

test("home office — is not calculated outside the US", () => {
  const r = estimateTax(input({ country: "UK", homeOfficeSqFt: 200 }));
  assert.strictEqual(r.totalDeductible, 0);
  assert.ok(r.warnings.some((w) => w.includes("only calculated for the US")));
});

// ---------------------------------------------------------------------------
// 1099-K — both thresholds in 2026
// ---------------------------------------------------------------------------

test("1099-K — requires both $20,000 and 200 transactions", () => {
  assert.strictEqual(US_1099K.amount, 20_000);
  assert.strictEqual(US_1099K.transactions, 200);
  assert.ok(US_1099K.note.includes("Both"));
});

// ---------------------------------------------------------------------------
// Estimate arithmetic
// ---------------------------------------------------------------------------

test("estimate — deductible expenses are summed", () => {
  const r = estimateTax(
    input({
      grossIncome: 50_000,
      expenses: [
        { label: "Adobe", amount: 600, deductible: true },
        { label: "Monitor", amount: 400, deductible: true },
      ],
    }),
  );
  assert.strictEqual(r.totalDeductible, 1000);
  assert.strictEqual(r.estimatedNet, 49_000);
});

test("estimate — non-deductible expenses are ignored", () => {
  const r = estimateTax(
    input({
      grossIncome: 50_000,
      expenses: [
        { label: "Adobe", amount: 600, deductible: true },
        { label: "Groceries", amount: 900, deductible: false },
      ],
    }),
  );
  assert.strictEqual(r.totalDeductible, 600);
});

test("estimate — donations never reduce the taxable total", () => {
  const r = estimateTax(input({ grossIncome: 50_000, donations: 2500 }));
  assert.strictEqual(r.totalDeductible, 0);
  assert.ok(r.lines.some((l) => l.label === "Charitable donations"));
  assert.strictEqual(r.estimatedNet, 50_000);
});

test("estimate — estimated profit floors at zero", () => {
  const r = estimateTax(
    input({ grossIncome: 500, expenses: [{ label: "Big", amount: 900, deductible: true }] }),
  );
  assert.strictEqual(r.estimatedNet, 0);
});

test("estimate — blended rate is 27% for the US", () => {
  const r = estimateTax(input({ grossIncome: 100_000 }));
  assert.strictEqual(r.estimatedTax, 27_000);
  assert.ok(r.warnings.some((w) => w.includes("27%")));
});

test("estimate — blended rate is 25% for the UK", () => {
  const r = estimateTax(input({ country: "UK", grossIncome: 100_000 }));
  assert.strictEqual(r.estimatedTax, 25_000);
});

test("estimate — blended rate is 20% elsewhere", () => {
  const r = estimateTax(input({ country: "IN", grossIncome: 100_000 }));
  assert.strictEqual(r.estimatedTax, 20_000);
});

test("estimate — the US always warns that self-employment tax is excluded", () => {
  const r = estimateTax(input({ grossIncome: 100_000 }));
  assert.ok(r.warnings.some((w) => w.includes("15.3%")));
});

test("estimate — every result carries the not-tax-advice warning", () => {
  for (const country of ["US", "UK", "IN", "CA", "AU"] as CountryCode[]) {
    const r = estimateTax(input({ country, grossIncome: 10_000 }));
    assert.ok(
      r.warnings.some((w) => w.includes("Not tax advice")),
      `${country} is missing the disclaimer`,
    );
  }
});

test("estimate — every deduction line names its rule and source", () => {
  const r = estimateTax(
    input({
      grossIncome: 100_000,
      expenses: [{ label: "Adobe", amount: 600, deductible: true }],
      businessMiles: 100,
      homeOfficeSqFt: 100,
    }),
  );
  assert.ok(r.lines.length >= 3);
  for (const line of r.lines) {
    assert.ok(line.rule.length > 0, `line "${line.label}" has no rule`);
    assert.ok(line.source.length > 0, `line "${line.label}" has no source`);
  }
});

test("estimate — mileage is not modelled outside the US", () => {
  const r = estimateTax(input({ country: "UK", grossIncome: 50_000, businessMiles: 100 }));
  assert.ok(r.warnings.some((w) => w.includes("not calculated outside the US")));
});

// ---------------------------------------------------------------------------
// Readiness
// ---------------------------------------------------------------------------

test("readiness — nothing gathered scores zero", () => {
  const r = readinessScore(COUNTRIES.US.documents, new Set());
  assert.strictEqual(r.score, 0);
  assert.strictEqual(r.missingRequired.length + r.missingOptional.length, COUNTRIES.US.documents.length);
});

test("readiness — required documents alone cap the score at 85", () => {
  const required = COUNTRIES.US.documents.filter((d) => !d.conditional);
  const r = readinessScore(COUNTRIES.US.documents, new Set(required.map((d) => d.id)));
  assert.strictEqual(r.score, 85);
  assert.strictEqual(r.missingRequired.length, 0);
  assert.strictEqual(r.missingOptional.length, COUNTRIES.US.documents.length - required.length);
});

test("readiness — everything gathered scores 100", () => {
  const r = readinessScore(COUNTRIES.US.documents, new Set(COUNTRIES.US.documents.map((d) => d.id)));
  assert.strictEqual(r.score, 100);
});

test("readiness — an empty checklist does not divide by zero", () => {
  assert.strictEqual(readinessScore([], new Set()).score, 100);
});

// ---------------------------------------------------------------------------
// Country catalogue
// ---------------------------------------------------------------------------

test("catalogue — exactly five countries are supported", () => {
  assert.strictEqual(Object.keys(COUNTRIES).length, 5);
  assert.deepStrictEqual(Object.keys(COUNTRIES), ["US", "UK", "IN", "CA", "AU"]);
});

test("catalogue — every deadline carries a parseable ISO date", () => {
  for (const country of Object.values(COUNTRIES)) {
    for (const dl of country.deadlines(2026)) {
      if (dl.date === null) continue;
      assert.match(dl.date, /^\d{4}-\d{2}-\d{2}$/, `${country.code}/${dl.id} bad format`);
      assert.ok(
        !Number.isNaN(new Date(dl.date).getTime()),
        `${country.code}/${dl.id} is not a real date`,
      );
    }
  }
});

test("catalogue — every deadline names an authority source", () => {
  for (const country of Object.values(COUNTRIES)) {
    for (const dl of country.deadlines(2026)) {
      assert.ok(dl.source.length > 0, `${country.code}/${dl.id} has no source`);
    }
  }
});

test("catalogue — every country exposes a currency, authority and label rule", () => {
  for (const country of Object.values(COUNTRIES)) {
    assert.ok(country.currencySymbol.length > 0);
    assert.ok(country.authority.length > 0);
    assert.match(country.authorityUrl, /^https:\/\//);
    assert.ok(country.taxYearLabel(2026).length > 0);
    assert.ok(country.documents.length > 0);
  }
});

test("catalogue — tax year labels differ by jurisdiction", () => {
  assert.strictEqual(COUNTRIES.US.taxYearLabel(2026), "2026");
  assert.strictEqual(COUNTRIES.UK.taxYearLabel(2026), "2026/27");
  assert.strictEqual(COUNTRIES.IN.taxYearLabel(2026), "AY 2627");
});

test("catalogue — document ids are unique per country", () => {
  for (const country of Object.values(COUNTRIES)) {
    const ids = country.documents.map((d) => d.id);
    assert.strictEqual(new Set(ids).size, ids.length, `${country.code} has duplicate document ids`);
  }
});

test("filing year — January through April targets the previous year", () => {
  assert.strictEqual(filingYearFor(new Date(2026, 0, 15)), 2025);
  assert.strictEqual(filingYearFor(new Date(2026, 3, 30)), 2025);
});

test("filing year — May onward targets the current year", () => {
  assert.strictEqual(filingYearFor(new Date(2026, 4, 1)), 2026);
  assert.strictEqual(filingYearFor(new Date(2026, 11, 31)), 2026);
});

// ---------------------------------------------------------------------------
// Expense categorisation
// ---------------------------------------------------------------------------

test("categorise — recognises SaaS with high confidence", () => {
  const r = categoriseExpense("Adobe Creative Cloud");
  assert.strictEqual(r.bucket, "Software & subscriptions");
  assert.strictEqual(r.confidence, "high");
  assert.ok(r.likelyDeductible);
});

test("categorise — recognises professional services", () => {
  assert.strictEqual(categoriseExpense("accountant fees").bucket, "Professional services");
});

test("categorise — recognises travel", () => {
  assert.strictEqual(categoriseExpense("Uber to the airport").bucket, "Travel");
});

test("categorise — meals stay low confidence and carry the 50% caveat", () => {
  const r = categoriseExpense("lunch with a client");
  assert.strictEqual(r.bucket, "Meals");
  assert.strictEqual(r.confidence, "low");
  assert.ok(r.reason.includes("50%"), "the 50% meals caveat must be shown");
});

test("categorise — an unrecognised expense is not deductible", () => {
  const r = categoriseExpense("xyzzy plugh frobnicate");
  assert.strictEqual(r.bucket, "Uncategorised");
  assert.strictEqual(r.likelyDeductible, false);
  assert.strictEqual(r.confidence, "low");
});

test("categorise — rule order is stable (notebook matches education, not office supplies)", () => {
  // "notebook" contains "book", and Education is checked before Office supplies.
  // Locks the current ordering so a reorder is a deliberate, reviewed change.
  assert.strictEqual(categoriseExpense("notebook").bucket, "Education & training");
});

test("categorise — charity mileage is dropped when there are no business miles (debt D17)", () => {
  // The charity block is nested inside the business-mileage branch, so a user
  // who logs only charitable mileage gets no line at all. Fixture documents the
  // gap; it must not be changed without also fixing estimateTax.
  const r = estimateTax(input({ grossIncome: 50_000, businessMiles: 0, charitableMiles: 200 }));
  assert.strictEqual(r.totalDeductible, 0);
  assert.strictEqual(r.lines.filter((l) => l.label.startsWith("Mileage")).length, 0);
});

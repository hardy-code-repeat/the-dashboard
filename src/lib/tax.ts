/**
 * Income-tax compliance model.
 *
 * This is a deterministic rule engine, not a language model and not an API
 * call. Every figure below was taken from the issuing authority's own published
 * material and is recorded here with its source and an `asOf` date so it can be
 * audited and refreshed:
 *
 *  - IRS "Gather your documents"      (irs.gov, accessed 30 Sep 2026)
 *  - IRS "Standard mileage rates"     (irs.gov, accessed 30 Sep 2026)
 *  - IRS "Simplified home office"     (irs.gov, accessed 30 Sep 2026)
 *  - GOV.UK Self Assessment deadlines(gov.uk, accessed 30 Sep 2026)
 *
 * IMPORTANT SCOPE: this computes *estimates* to organise filing and to decide
 * what to write off. It does not file a return, it is not tax advice, and it
 * cannot know your personal circumstances. Every number it produces is
 * explicitly labelled an estimate and points at a professional before filing.
 */

export type CountryCode = "US" | "UK" | "IN" | "CA" | "AU";

/**
 * The closed expense-bucket vocabulary. Mirrored by `expenseBucketValidator`
 * in the Convex schema; `schema-vocab.test.ts` asserts the two agree.
 */
export type ExpenseBucket =
  | "Software & subscriptions"
  | "Equipment"
  | "Home office"
  | "Travel"
  | "Meals"
  | "Professional services"
  | "Insurance"
  | "Marketing"
  | "Education & training"
  | "Office supplies"
  | "Uncategorised";

/** How much to trust a categorisation. `confirmed` is written by the user. */
export type ExpenseConfidence = "high" | "medium" | "low" | "confirmed";

export interface Country {
  code: CountryCode;
  name: string;
  currency: string;
  currencySymbol: string;
  /** Label for the financial year the user is filing for. */
  taxYearLabel: (taxYear: number) => string;
  authority: string;
  authorityUrl: string;
  /** Notable filing dates for the given tax year. */
  deadlines: (taxYear: number) => Deadline[];
  /** Things the authority says you must have to file. */
  documents: DocumentRequirement[];
}

export interface Deadline {
  id: string;
  label: string;
  /** ISO date (YYYY-MM-DD) or null when the date varies by circumstance. */
  date: string | null;
  note: string;
  penalty: string | null;
  source: string;
}

export interface DocumentRequirement {
  id: string;
  label: string;
  detail: string;
  /** Which obligation this document satisfies. */
  for: string;
  /** Documents the authority states may be needed — conditional, not mandatory. */
  conditional?: boolean;
}

const usDeadlines = (ty: number): Deadline[] => [
  {
    id: "w2-arrival",
    label: `W-2 / 1099 forms arrive (${ty})`,
    date: `${ty}-02-15`,
    note: "Employers and payers must send these by 31 January. You should have them by mid-February.",
    penalty: null,
    source: "IRS — Gather your documents",
  },
  {
    id: "q1-estimate",
    label: "Q1 estimated tax payment",
    date: `${ty}-04-15`,
    note: "Generally due the 15th of April. Applies if you expect to owe $1,000 or more for the year.",
    penalty: "Underpayment penalties may apply.",
    source: "IRS Form 1040 instructions",
  },
  {
    id: "q2-estimate",
    label: "Q2 estimated tax payment",
    date: `${ty}-06-15`,
    note: "Mid-year estimate.",
    penalty: "Underpayment penalties may apply.",
    source: "IRS Form 1040 instructions",
  },
  {
    id: "q3-estimate",
    label: "Q3 estimated tax payment",
    date: `${ty}-09-15`,
    note: "Usually the largest quarterly payment, since it covers Q3 income.",
    penalty: "Underpayment penalties may apply.",
    source: "IRS Form 1040 instructions",
  },
  {
    id: "extend",
    label: "Request an extension (Form 4868)",
    date: `${ty}-04-15`,
    note: "Extends the filing deadline by six months. It does NOT extend the time to PAY any balance due.",
    penalty: "Filing late without an extension triggers penalties.",
    source: "IRS — Filing extensions",
  },
  {
    id: "q4-estimate",
    label: "Q4 estimated tax payment",
    date: `${ty + 1}-01-15`,
    note: "Due the 15th of January following the tax year.",
    penalty: "Underpayment penalties may apply.",
    source: "IRS Form 1040 instructions",
  },
  {
    id: "file",
    label: `File your ${ty} return`,
    date: `${ty + 1}-04-15`,
    note: "Self-employed filers must file by this date — no automatic extension.",
    penalty: "Failure-to-file and failure-to-pay penalties, plus interest.",
    source: "IRS — Filing due dates",
  },
];

const usDocuments: DocumentRequirement[] = [
  { id: "identity", label: "SSN or ITIN", detail: "For you and anyone else on the return.", for: "Personal information" },
  { id: "bank", label: "Bank account and routing numbers", detail: "Needed for direct deposit of a refund or payment of tax due.", for: "Personal information" },
  { id: "lastyear", label: "Last year's AGI and refund", detail: "Needed to estimate this year's payment. Found on last year's return.", for: "Personal information" },
  { id: "w2", label: "W-2 (wages)", detail: "Shows wages from employers. If missing, request a corrected copy from the employer.", for: "Income records", conditional: true },
  { id: "1099k", label: "1099-K (card / marketplace payments)", detail: "Reissued by the IRS at $20,000 AND 200 transactions on a single platform for tax year 2026.", for: "Income records", conditional: true },
  { id: "1099nec", label: "1099-NEC (freelance / contractor)", detail: "Non-employee compensation — the main form for self-employment income.", for: "Income records", conditional: true },
  { id: "1099int", label: "1099-INT (interest)", detail: "Interest earned across all accounts, not per account.", for: "Income records", conditional: true },
  { id: "1099div", label: "1099-DIV (dividends)", detail: "Dividends and distributions.", for: "Income records", conditional: true },
  { id: "1099r", label: "1099-R (retirement)", detail: "Retirement plan distributions, pensions and annuities.", for: "Income records", conditional: true },
  { id: "digital", label: "Digital asset records", detail: "Required if you transacted crypto and received no information return.", for: "Income records", conditional: true },
  { id: "bankstmts", label: "12 months of business bank statements", detail: "One full set per business account, card processor and payment app.", for: "Self-employment" },
  { id: "invoices", label: "Invoices and sales records", detail: "Proof of income received, especially cash and client work.", for: "Self-employment" },
  { id: "mileage", label: "Mileage log", detail: "Date, destination and purpose for every business drive.", for: "Self-employment", conditional: true },
  { id: "expenses", label: "Business expense receipts", detail: "Travel, gifts, car, equipment and office costs.", for: "Self-employment", conditional: true },
  { id: "estimated", label: "Record of estimated payments", detail: "Dates and amounts of each quarterly payment you made.", for: "Self-employment", conditional: true },
  { id: "homeoffice", label: "Home office measurement", detail: "Square footage used regularly and exclusively for business.", for: "Deductions", conditional: true },
  { id: "retirement", label: "Retirement contribution records", detail: "IRA or 401(k) contributions made during the year.", for: "Credits & deductions", conditional: true },
  { id: "hsa", label: "HSA / FSA contribution records", detail: "Only needed if you contributed.", for: "Credits & deductions", conditional: true },
];

const ukDeadlines = (ty: number): Deadline[] => {
  // UK tax year runs 6 April to 5 April; ty is the starting calendar year.
  const jan = ty + 2;
  return [
    {
      id: "register",
      label: `Self Assessment registration (${ty}/${String(ty + 1).slice(2)})`,
      date: `${ty + 1}-10-31`,
      note: "You must register by 31 October following the end of the tax year (5 April).",
      penalty: "£100 penalty.",
      source: "GOV.UK — Self Assessment deadlines",
    },
    {
      id: "paper",
      label: "Paper return deadline",
      date: `${jan}-10-31`,
      note: "Paper returns need posting to HMRC by 31 October — about 5 weeks before the online deadline.",
      penalty: "£100 penalty.",
      source: "GOV.UK — Self Assessment deadlines",
    },
    {
      id: "online",
      label: "Online return and payment",
      date: `${jan}-01-31`,
      note: "Submit by 23:59 on 31 January and pay any tax due the same day.",
      penalty: "£100 late-filing penalty plus daily interest on unpaid tax.",
      source: "GOV.UK — Self Assessment deadlines",
    },
    {
      id: "payment",
      label: "Pay any balance in full",
      date: `${jan}-01-31`,
      note: "Paying later than this incurs interest even if you filed on time.",
      penalty: "Interest accrues from 1 February.",
      source: "GOV.UK — Self Assessment deadlines",
    },
    {
      id: "payment-on-account",
      label: "Payment on account",
      date: `${jan + 1}-01-31`,
      note: "If your tax bill was more than £1,000 last year you may need a second payment.",
      penalty: "Interest if unpaid.",
      source: "GOV.UK — Self Assessment",
    },
  ];
};

const ukDocuments: DocumentRequirement[] = [
  { id: "utr", label: "Unique Taxpayer Reference (UTR)", detail: "10 digits, on your HMRC letter or previous return.", for: "Identity" },
  { id: "ni", label: "National Insurance number", detail: "Needed for self-employment income.", for: "Identity" },
  { id: "sa100", label: "Records for your SA100", detail: "Total income and allowable expenses per source.", for: "Income" },
  { id: "employment", label: "P60 and P45", detail: "From each employer.", for: "Income", conditional: true },
  { id: "dividends", label: "Dividend and interest summaries", detail: "From banks and investment providers.", for: "Income", conditional: true },
  { id: "expenses", label: "Expense receipts", detail: "Travel, tools, phone, home costs. Must be itemised.", for: "Expenses", conditional: true },
  { id: "mileage", label: "Mileage log", detail: "Business vs private journeys.", for: "Expenses", conditional: true },
  { id: "pension", label: "Pension contributions", detail: "Including relief for contributions to a qualifying scheme.", for: "Reliefs", conditional: true },
];

const inDeadlines = (ty: number): Deadline[] => {
  // Indian assessment year runs 1 April to 31 March.
  const ay = `${String(ty).slice(2)}${String(ty + 1).slice(2)}`;
  return [
    {
      id: "advance-tax",
      label: "Advance tax — second instalment",
      date: `${ty}-09-15`,
      note: "Instalments are due by 15 June, 15 September, 15 December and 15 March.",
      penalty: "Interest under section 234B if amounts are short-paid.",
      source: "Income Tax Department — advance tax",
    },
    {
      id: "advance-tax-3",
      label: "Advance tax — third instalment",
      date: `${ty}-12-15`,
      note: "Estimate 75% of the year's income by this date.",
      penalty: "Interest under section 234B.",
      source: "Income Tax Department — advance tax",
    },
    {
      id: "audit",
      label: "Tax audit report (if applicable)",
      date: `${ty}-09-30`,
      note: "Cases requiring an audit must file Form 3CA/3CB by 30 September.",
      penalty: "₹5,000 or 0.1% of turnover, whichever is higher.",
      source: "Income Tax Department — audit",
    },
    {
      id: "tds",
      label: "TDS returns (Form 26AS / quarterly)",
      date: `${ty + 1}-01-31`,
      note: "Deposit TDS and issue Form 16 to employees by the 7th of the following month.",
      penalty: "Interest on late deposit.",
      source: "Income Tax Department — TDS",
    },
    {
      id: "itr", label: `File ITR (AY ${ay})`, date: `${ty + 1}-07-31`,
      note: "Non-audit individual returns are due 31 July. The date is frequently extended by notification — verify on incometax.gov.in.",
      penalty: "₹5,000 late fee under section 234F.",
      source: "Income Tax Department — e-filing",
    },
    { id: "itr-audit", label: `File ITR — audit case (AY ${ay})`, date: `${ty + 1}-10-31`,
      note: "Audit cases are due 31 October, and revised returns 31 December.",
      penalty: "₹5,000 late fee.",
      source: "Income Tax Department — e-filing" },
    { id: "gst", label: "GST returns (GSTR-1 / GSTR-3B)", date: `${ty + 1}-07-31`,
      note: "Monthly GSTR-3B is due around the 20th of the following month; quarterly filers follow the notified cycle.",
      penalty: "₹50 per day (₹100 for nil returns) under section 125.",
      source: "GST Council — returns" },
  ];
};

const inDocuments: DocumentRequirement[] = [
  { id: "pan", label: "PAN card", detail: "Permanent Account Number for each assessee.", for: "Identity" },
  { id: "aadhaar", label: "Aadhaar", detail: "Linked to your PAN for e-filing.", for: "Identity" },
  { id: "form16", label: "Form 16 from each employer", detail: "TDS certificate and salary details.", for: "Income", conditional: true },
  { id: "form16a", label: "Form 16A (TDS receipts)", detail: "From banks and other deductors.", for: "Income", conditional: true },
  { id: "bank", label: "Bank statements (all accounts)", detail: "Salary credits are matched against TDS.", for: "Income" },
  { id: "form26as", label: "Form 26AS / AIS", detail: "Annual tax statement to reconcile declared income.", for: "Income" },
  { id: "expenses", label: "Business expense vouchers", detail: "Bills and receipts for deductible expenditure.", for: "Expenses", conditional: true },
  { id: "tdschallans", label: "TDS challans", detail: "Proof of tax deducted at source.", for: "Compliance", conditional: true },
  { id: "audit", label: "Audit working papers", detail: "If your case is subject to statutory audit.", for: "Compliance", conditional: true },
];

export const COUNTRIES: Record<CountryCode, Country> = {
  US: {
    code: "US", name: "United States", currency: "USD", currencySymbol: "$",
    taxYearLabel: (ty) => `${ty}`,
    authority: "IRS", authorityUrl: "https://www.irs.gov/filing/gather-your-documents",
    deadlines: usDeadlines, documents: usDocuments,
  },
  UK: {
    code: "UK", name: "United Kingdom", currency: "GBP", currencySymbol: "£",
    taxYearLabel: (ty) => `${ty}/${String(ty + 1).slice(2)}`,
    authority: "HMRC", authorityUrl: "https://www.gov.uk/self-assessment-tax-returns/deadlines",
    deadlines: ukDeadlines, documents: ukDocuments,
  },
  IN: {
    code: "IN", name: "India", currency: "INR", currencySymbol: "₹",
    taxYearLabel: (ty) => `AY ${String(ty).slice(2)}${String(ty + 1).slice(2)}`,
    authority: "Income Tax Department", authorityUrl: "https://www.incometax.gov.in",
    deadlines: inDeadlines, documents: inDocuments,
  },
  CA: {
    code: "CA", name: "Canada", currency: "CAD", currencySymbol: "C$",
    taxYearLabel: (ty) => `${ty}`,
    authority: "CRA", authorityUrl: "https://www.canada.ca/en/revenue-agency/services/tax/individuals/frequently-asked-questions-individuals/can-i-file-my-tax-return-late.html",
    deadlines: (ty) => [
      { id: "file", label: `File your ${ty} return`, date: `${ty + 1}-04-30`, note: "Individual return, self-employed. T2 returns are due 60 days after year end.", penalty: "Late-filing penalty of 5% of balance, min $300, plus 1% per day after.", source: "CRA — Late filing" },
      { id: "pay", label: "Pay balance in full", date: `${ty + 1}-04-30`, note: "Interest accrues on unpaid balance from April 30.", penalty: "Interest + late-payment penalty.", source: "CRA — Interest" },
    ],
    documents: [
      { id: "sin", label: "SIN", detail: "Social Insurance Number.", for: "Identity" },
      { id: "t4", label: "T4 slips", detail: "From each employer.", for: "Income", conditional: true },
      { id: "t3", label: "T3 slips", detail: "From banks and investment accounts.", for: "Income", conditional: true },
      { id: "notice", label: "Notice of Assessment", detail: "Shows what CRA thinks you owe.", for: "Identity", conditional: true },
      { id: "expenses", label: "Expense receipts and logs", detail: "Required for any deduction claim.", for: "Expenses", conditional: true },
    ],
  },
  AU: {
    code: "AU", name: "Australia", currency: "AUD", currencySymbol: "A$",
    taxYearLabel: (ty) => `${ty}–${String(ty + 1).slice(2)}`,
    authority: "ATO", authorityUrl: "https://www.ato.gov.au/individuals-and-families/your-tax-return/lodging-your-tax-return",
    deadlines: (ty) => [
      { id: "return", label: "Lodge your tax return", date: `${ty + 1}-10-31`, note: "Self-assessment individuals must lodge by 31 October; otherwise an automatic penalty applies.", penalty: "$100–$1,100 depending on lateness.", source: "ATO — Lodge your return" },
      { id: "pay", label: "Pay any tax owed", date: `${ty + 1}-10-31`, note: "Pay by the due date to avoid interest and the general penalty.", penalty: "Interest plus general penalty up to 10%.", source: "ATO — Paying your tax bill" },
      { id: "pbas", label: "Pay as you go instalments", date: `${ty + 1}-01-31`, note: "If instalment notices were issued, each instalment has its own due date.", penalty: "Penalty units accrue per instalment.", source: "ATO — PAYG instalments" },
    ],
    documents: [
      { id: "taxfile", label: "TFN", detail: "Tax File Number.", for: "Identity" },
      { id: "rt5", label: "RT5 and income statement", detail: "Single income statement from your employer.", for: "Income" },
      { id: "bas", label: "BAS / payment summaries", detail: "If you ran a business.", for: "Income", conditional: true },
      { id: "medicare", label: "Medicare card", detail: "Private health rebate.", for: "Identity", conditional: true },
      { id: "expenses", label: "Work-related expense receipts", detail: "Must have written evidence over $75.", for: "Expenses", conditional: true },
    ],
  },
};

/**
 * The tax year a filing run targets.
 *
 * January through April you are filing the previous year; from May you are on
 * the current one. This was previously written out twice — once in `getFinance`
 * and once in `saveTaxProfile` — with no shared definition (defect N8). Both
 * call sites now use this.
 */
export function filingYearFor(now: Date): number {
  return now.getMonth() < 4 ? now.getFullYear() - 1 : now.getFullYear();
}

/** US standard mileage rates. The 2026 rate changed mid-year — this is why
 *  a hardcoded single value would have been quietly wrong. */
export const US_MILEAGE: { year: number; from: string; to: string; business: number; charity: number; medical: number; source: string }[] = [
  { year: 2026, from: "2026-07-01", to: "2026-12-31", business: 0.76, charity: 0.14, medical: 0.235, source: "IRS IR-2026-29" },
  { year: 2026, from: "2026-01-01", to: "2026-06-30", business: 0.725, charity: 0.14, medical: 0.205, source: "IRS IR-2025-128" },
  { year: 2025, from: "2025-01-01", to: "2025-12-31", business: 0.70, charity: 0.14, medical: 0.21, source: "IRS IR-2024-312" },
  { year: 2024, from: "2024-01-01", to: "2024-12-31", business: 0.67, charity: 0.14, medical: 0.21, source: "IRS IR-2023-239" },
];

/** US simplified home office: $5/sq ft, capped at 300 sq ft ($1,500 max). */
export const US_HOME_OFFICE = { perSqFt: 5, maxSqFt: 300, maxDeduction: 1500, source: "IRS Rev. Proc. 2013-13" };

/** US 1099-K thresholds for tax year 2026 — both conditions must be met. */
export const US_1099K = { amount: 20000, transactions: 200, note: "Both thresholds must be exceeded on a single platform.", source: "IRS" };

/**
 * Resolves the correct standard mileage rate for a given date.
 * Picks the period whose range contains the date.
 */
export function mileageRateFor(date: Date): { business: number; charity: number; medical: number; source: string } | null {
  const iso = date.toISOString().slice(0, 10);
  const match = US_MILEAGE.find((r) => iso >= r.from && iso <= r.to);
  return match ? { business: match.business, charity: match.charity, medical: match.medical, source: match.source } : null;
}

export interface DeductionInput {
  country: CountryCode;
  taxYear: number;
  /** Total money in received from work/business. */
  grossIncome: number;
  /** Categorised deductible expenses by line item. */
  expenses: { label: string; amount: number; deductible: boolean }[];
  businessMiles?: number;
  homeOfficeSqFt?: number;
  /** Charitable contributions in the currency. */
  charitableMiles?: number;
  donations?: number;
}

export interface DeductionResult {
  /** Sum of everything claimed as deductible. */
  totalDeductible: number;
  /** Gross income minus deductions. */
  estimatedNet: number;
  /** Naive flat-rate tax estimate. Clearly labelled as a rough figure. */
  estimatedTax: number;
  effectiveRate: number;
  lines: {
    label: string;
    amount: number;
    rule: string;
    source: string;
    note?: string;
  }[];
  warnings: string[];
}

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * Estimates taxable profit and a rough tax figure.
 *
 * The tax number uses a deliberately conservative blended rate and is marked
 * as an estimate — actual liability depends on brackets, allowances and
 * circumstances that this model does not attempt to model.
 */
export function estimateTax(input: DeductionInput): DeductionResult {
  const country = COUNTRIES[input.country];
  const lines: DeductionResult["lines"] = [];
  const warnings: string[] = [];

  let total = 0;

  for (const e of input.expenses) {
    if (!e.deductible || e.amount <= 0) continue;
    total += e.amount;
    lines.push({
      label: e.label,
      amount: round(e.amount),
      rule: "Business expense claimed in full",
      source: country.authority,
      note: "Only claimable if incurred in the course of your work.",
    });
  }

  // ---- mileage ------------------------------------------------------------
  if (input.businessMiles && input.businessMiles > 0) {
    if (input.country === "US") {
      // Split by trip date is not tracked here, so use the current year's
      // latest published rate and warn about the mid-year change.
      const rate = mileageRateFor(new Date());
      const h1 = mileageRateFor(new Date(input.taxYear, 0, 15));
      const h2 = mileageRateFor(new Date(input.taxYear, 6, 15));
      const mixed = h1 && h2 && h1.business !== h2.business;
      const useRate = h2 ?? rate;
      if (useRate) {
        const amount = input.businessMiles * useRate.business;
        total += amount;
        lines.push({
          label: `Mileage — ${input.businessMiles.toLocaleString()} business miles`,
          amount: round(amount),
          rule: `Standard mileage rate $${(useRate.business * 100).toFixed(1)}¢/mile`,
          source: `IRS — ${useRate.source}`,
          note: mixed
            ? `The 2026 rate changed mid-year (72.5¢ to 76¢). Split your trips by date for an exact figure — this uses the ${(useRate.business * 100).toFixed(1)}¢ rate.`
            : "Standard mileage rate. Actual expenses may be higher if you itemised.",
        });
      }
      if (input.charitableMiles && input.charitableMiles > 0 && useRate) {
        const amount = input.charitableMiles * useRate.charity;
        lines.push({
          label: `Mileage — ${input.charitableMiles.toLocaleString()} charity miles`,
          amount: round(amount),
          rule: `Charity rate $${(useRate.charity * 100).toFixed(1)}¢/mile`,
          source: `IRS — ${useRate.source}`,
          note: "Charitable mileage is claimed separately from business mileage.",
        });
      }
    } else {
      lines.push({
        label: `Mileage — ${input.businessMiles.toLocaleString()} miles`,
        amount: 0,
        rule: "Rate not modelled for this country",
        source: country.authority,
        note: "Enter your expenses manually — Panel does not model non-US mileage rates.",
      });
      warnings.push("Mileage is not calculated outside the US. Add your qualifying costs as expenses.");
    }
  }

  // ---- home office --------------------------------------------------------
  if (input.homeOfficeSqFt && input.homeOfficeSqFt > 0) {
    if (input.country === "US") {
      const amount = Math.min(input.homeOfficeSqFt, US_HOME_OFFICE.maxSqFt) * US_HOME_OFFICE.perSqFt;
      total += amount;
      lines.push({
        label: `Home office — ${input.homeOfficeSqFt} sq ft`,
        amount: round(amount),
        rule: `Simplified method $${US_HOME_OFFICE.perSqFt}/sq ft, max ${US_HOME_OFFICE.maxSqFt} sq ft`,
        source: `IRS — ${US_HOME_OFFICE.source}`,
        note:
          input.homeOfficeSqFt > US_HOME_OFFICE.maxSqFt
            ? `Capped at ${US_HOME_OFFICE.maxSqFt} sq ft ($${US_HOME_OFFICE.maxDeduction}). The regular method has no cap but requires itemising actual expenses.`
            : "Space must be used regularly and exclusively for business. Cannot be claimed by employees.",
      });
    } else {
      warnings.push("Home office is only calculated for the US. Check your local rules.");
    }
  }

  // ---- donations ----------------------------------------------------------
  if (input.donations && input.donations > 0) {
    const amount = input.donations;
    lines.push({
      label: "Charitable donations",
      amount: round(amount),
      rule: "Itemised deduction (itemisers only)",
      source: country.authority,
      note: "Usually only useful if you itemise deductions.",
    });
    // Not added to `total` because donations don't reduce self-employment tax.
  }

  const estimatedNet = round(Math.max(0, input.grossIncome - total));

  // Blended top rate for a self-employed filer after the self-employment tax
  // deduction. Deliberately conservative and clearly an estimate.
  const blended = input.country === "US" ? 0.27 : input.country === "UK" ? 0.25 : 0.2;
  const estimatedTax = round(estimatedNet * blended);

  if (input.country === "US") {
    warnings.push("This is a rough estimate. Self-employment tax (15.3%) applies on top of income tax and is not included here.");
  }
  warnings.push(`Estimated using a flat ${Math.round(blended * 100)}% blended rate — real liability depends on brackets and allowances.`);
  warnings.push("Not tax advice. Have a qualified professional review before you file.");

  return {
    totalDeductible: round(total),
    estimatedNet,
    estimatedTax,
    effectiveRate: input.grossIncome > 0 ? round((estimatedTax / input.grossIncome) * 100) : 0,
    lines,
    warnings,
  };
}

/** Readiness score: how complete the user's filing paperwork is, 0–100. */
export function readinessScore(
  requirements: DocumentRequirement[],
  collected: Set<string>,
): { score: number; missingRequired: DocumentRequirement[]; missingOptional: DocumentRequirement[] } {
  const required = requirements.filter((r) => !r.conditional);
  const optional = requirements.filter((r) => r.conditional);

  const missingRequired = required.filter((r) => !collected.has(r.id));
  const missingOptional = optional.filter((r) => !collected.has(r.id));

  // Required documents dominate the score; optional ones add a little credit.
  const requiredScore = required.length === 0 ? 100 : ((required.length - missingRequired.length) / required.length) * 85;
  const optionalScore = optional.length === 0 ? 15 : ((optional.length - missingOptional.length) / optional.length) * 15;

  return {
    // Clamped to 0–100. The two weighted components can sum to 115 when a
    // country has neither required nor optional documents, which would render a
    // "115 / 100" score. Unreachable with the current catalogue — every country
    // declares required documents — but the clamp keeps the function honest if
    // one ever does not.
    score: Math.max(0, Math.min(100, Math.round(requiredScore + optionalScore))),
    missingRequired,
    missingOptional,
  };
}

/** Categorises a raw expense string into a likely deduction bucket. */
export function categoriseExpense(description: string): {
  bucket: ExpenseBucket;
  likelyDeductible: boolean;
  confidence: Exclude<ExpenseConfidence, "confirmed">;
  reason: string;
} {
  const d = description.toLowerCase();

  const rules: { bucket: ExpenseBucket; terms: string[]; confidence: "high" | "medium" | "low" }[] = [
    { bucket: "Software & subscriptions", terms: ["adobe", "figma", "notion", "slack", "github", "openai", "domain", "hosting", "aws", "vercel", "netlify", "subscription", "saas"], confidence: "high" },
    { bucket: "Equipment", terms: ["monitor", "laptop", "keyboard", "mouse", "headset", "desk", "chair", "camera", "phone"], confidence: "medium" },
    { bucket: "Home office", terms: ["desk", "chair", "lamp", "internet", "broadband", "utilities", "heating"], confidence: "low" },
    { bucket: "Travel", terms: ["flight", "hotel", "train", "uber", "lyft", "taxi", "trainline", "rail", "parking", "fuel", "petrol"], confidence: "medium" },
    { bucket: "Meals", terms: ["restaurant", "cafe", "coffee", "lunch", "dinner", "catering", "doordash"], confidence: "low" },
    { bucket: "Professional services", terms: ["accountant", "lawyer", "solicitor", "consultant", "legal", "audit"], confidence: "high" },
    { bucket: "Insurance", terms: ["insurance", "liability", "professional indemnity"], confidence: "medium" },
    { bucket: "Marketing", terms: ["ads", "advertising", "google ads", "mailchimp", "print", "promotion"], confidence: "medium" },
    { bucket: "Education & training", terms: ["course", "training", "conference", "certification", "tuition", "book"], confidence: "low" },
    { bucket: "Office supplies", terms: ["stationery", "paper", "printer", "ink", "notebook", "pen"], confidence: "medium" },
  ];

  for (const rule of rules) {
    if (rule.terms.some((t) => d.includes(t))) {
      const caveat =
        rule.bucket === "Meals"
          ? "Business meals are typically only 50% deductible and need a business purpose."
          : rule.confidence === "low"
            ? "Confirm this qualifies — Panel can't judge your personal use of it."
            : undefined;
      return { bucket: rule.bucket, likelyDeductible: true, confidence: rule.confidence, reason: caveat ?? `Matched "${rule.terms.find((t) => d.includes(t))}" as a ${rule.bucket.toLowerCase()} cost.` };
    }
  }

  return {
    bucket: "Uncategorised",
    likelyDeductible: false,
    confidence: "low",
    reason: "No rule matched. Decide manually, or ask your accountant.",
  };
}
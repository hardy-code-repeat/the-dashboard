/**
 * Money in minor units (ADR-031).
 *
 * A transaction amount is an **integer count of minor units** — cents, pence.
 * It is never a float, because a float cannot represent 0.10 and a balance that
 * is off by a penny is a balance the user stops trusting.
 *
 * ## Why this module exists at all
 *
 * `expenses.amount` is a guarded float and stays one: it is protected, it has a
 * regression suite, and migrating it is a separate change with its own
 * arithmetic risk. So two representations of money now coexist — a float on the
 * legacy expense row and an integer everywhere a transaction is concerned. That
 * is only safe if exactly one place converts between them, which is
 * {@link floatToMinor} / {@link minorToFloat} below. One boundary, one test
 * file, one place to audit.
 *
 * ## The parsing rule
 *
 * A decimal **string** is parsed digit by digit and never converted to a
 * number until the integer minor value exists. `parseAmountToMinor("0.1")` is
 * `10`, not `0.1 * 100 === 10.000000000000002`. That is the whole reason this
 * is hand-written instead of `Math.round(amount * 100)`.
 */

/** ISO 4217 codes Panel knows the minor-unit exponent for. */
export type CurrencyCode = "USD" | "GBP" | "EUR" | "INR" | "CAD" | "AUD" | "JPY";

/**
 * Currencies whose minor unit is not 1/100.
 *
 * JPY has no decimal place at all, which is the case that catches an
 * implementation that hardcodes `* 100`.
 */
const MINOR_EXPONENT: Record<CurrencyCode, number> = {
  USD: 2,
  GBP: 2,
  EUR: 2,
  INR: 2,
  CAD: 2,
  AUD: 2,
  JPY: 0,
};

const CURRENCY_SYMBOL: Record<CurrencyCode, string> = {
  USD: "$",
  GBP: "£",
  EUR: "€",
  INR: "₹",
  CAD: "CA$",
  AUD: "A$",
  JPY: "¥",
};

/** Closed union, mirrored in `schema.ts`. A new currency is a decision, not a string. */
export function isCurrencyCode(value: string): value is CurrencyCode {
  return Object.prototype.hasOwnProperty.call(MINOR_EXPONENT, value);
}

export function minorExponent(currency: CurrencyCode): number {
  return MINOR_EXPONENT[currency];
}

export function currencySymbol(currency: CurrencyCode): string {
  return CURRENCY_SYMBOL[currency];
}

/**
 * Parses a decimal amount into integer minor units, or returns `null`.
 *
 * `null` is returned — never `NaN` and never `0` — for anything that is not a
 * plain positive decimal: an empty string, `NaN`, `Infinity`, an exponent
 * (`1e3`), a comma decimal separator, or trailing junk (`12.34abc`). The
 * grammar is deliberately narrow because a narrow grammar is one that cannot be
 * surprised.
 *
 * Half-up rounding on the **digit**, not on a scaled float: `"1.005"` is 101
 * minor units (round half away from zero on the third decimal), where
 * `Math.round(1.005 * 100)` is 100 because `1.005` is stored as
 * `1.00499999…`.
 */
export function parseAmountToMinor(value: string, currency: CurrencyCode): number | null {
  const text = value.trim();
  if (text.length === 0) return null;
  // Only digits, at most one dot, at least one digit. No sign, no exponent, no
  // separators: a user typing "-" means something else (a refund, a reversal)
  // and this function is not where that is decided.
  if (!/^\d*\.?\d+$/.test(text)) return null;
  if (text === "." || text.length === 0) return null;

  const [whole = "0", fraction = ""] = text.split(".");
  const exponent = minorExponent(currency);

  // More precision than the currency has is rounded, not rejected — but the
  // rounding is done here, on the string, so it cannot inherit a float error.
  const digits = fraction.padEnd(exponent, "0").slice(0, exponent);
  const nextDigit = fraction.charAt(exponent);
  let minorDigits = Number(whole) * Math.pow(10, exponent) + (digits === "" ? 0 : Number(digits));
  if (nextDigit !== undefined && Number(nextDigit) >= 5) minorDigits += 1;

  if (!Number.isSafeInteger(minorDigits)) return null;
  return minorDigits;
}

/**
 * The **only** boundary between the legacy float world and minor units.
 *
 * It goes through the decimal string on purpose: `floatToMinor(0.1)` must be
 * `10`, and `Math.round(0.1 * 100)` is 10 by luck while
 * `Math.round(1.005 * 100)` is 100 by accident. Going via the string makes the
 * result a function of the *displayed* number rather than of its binary
 * neighbour.
 */
export function floatToMinor(amount: number, currency: CurrencyCode): number | null {
  if (!Number.isFinite(amount)) return null;
  return parseAmountToMinor(amount.toFixed(minorExponent(currency) + 1), currency);
}

/** The inverse boundary. Lossy by construction — a float cannot hold every minor value. */
export function minorToFloat(amountMinor: number, currency: CurrencyCode): number {
  return amountMinor / Math.pow(10, minorExponent(currency));
}

/** `"£12.34"` — for display only. Never parse this back. */
export function formatMinor(amountMinor: number, currency: CurrencyCode): string {
  const exponent = minorExponent(currency);
  const negative = amountMinor < 0;
  const digits = String(Math.abs(Math.trunc(amountMinor))).padStart(exponent + 1, "0");
  const whole = digits.slice(0, digits.length - exponent);
  const fraction = exponent === 0 ? "" : `.${digits.slice(digits.length - exponent)}`;
  return `${negative ? "-" : ""}${currencySymbol(currency)}${whole}${fraction}`;
}

/** An amount without the symbol, for an input field. */
export function minorToInput(amountMinor: number, currency: CurrencyCode): string {
  return formatMinor(amountMinor, currency).replace(currencySymbol(currency), "");
}

/**
 * The signed value a balance sums.
 *
 * Direction is an explicit field rather than a convention about the sign of the
 * stored amount, because "out" and "in" are the two facts a statement states and
 * deriving one from the other's negation is how a sign error survives review.
 * `out` is money leaving the account, so it is **negative** in the sum.
 */
export type TransactionDirection = "in" | "out";

export function signedMinor(amountMinor: number, direction: TransactionDirection): number {
  return direction === "out" ? -Math.abs(amountMinor) : Math.abs(amountMinor);
}

/**
 * Sums minor units. Integer addition, so order cannot change the answer and no
 * intermediate rounding exists to accumulate.
 */
export function sumMinor(amounts: readonly number[]): number {
  let total = 0;
  for (const a of amounts) {
    if (!Number.isSafeInteger(a)) return Number.NaN;
    total += a;
  }
  return total;
}

/**
 * The deterministic idempotency key for an imported transaction (ADR-009, §6).
 *
 * Readable on purpose — like `agentKey`, an auditor should be able to read what
 * de-duplicated a row. It is built from the four fields a statement guarantees
 * are stable, and nothing else: including the file name or an import counter
 * would make a re-import of the *same* statement look new.
 */
export function transactionKey(args: {
  postedAt: number;
  amountMinor: number;
  direction: TransactionDirection;
  externalId: string | undefined;
  label: string;
}): string {
  const external = args.externalId ?? "";
  const label = args.label.trim().toLowerCase().replace(/\s+/g, " ");
  return [
    "txn",
    args.direction,
    String(args.postedAt),
    String(Math.abs(args.amountMinor)),
    external || label,
  ].join(":");
}

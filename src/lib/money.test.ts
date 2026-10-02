import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  floatToMinor,
  formatMinor,
  minorToFloat,
  minorToInput,
  parseAmountToMinor,
  signedMinor,
  sumMinor,
  transactionKey,
  isCurrencyCode,
  minorExponent,
} from "./money";

describe("parsing never goes through a float", () => {
  it("0.1 is ten pence, whatever the float does next to it", () => {
    assert.equal(parseAmountToMinor("0.1", "GBP"), 10);
    // The float traps are additions and roundings, not this multiplication.
    assert.equal(String(0.1 + 0.2), "0.30000000000000004");
    assert.equal(parseAmountToMinor(String(0.1 + 0.2), "GBP"), 30, "read as displayed");
  });

  it("1.005 rounds half up on the digit, so it is 101 and not 100", () => {
    assert.equal(parseAmountToMinor("1.005", "GBP"), 101);
    assert.equal(Math.round(1.005 * 100), 100, "the float rounding this replaces");
  });

  it("a currency with no minor unit does not get one invented", () => {
    assert.equal(minorExponent("JPY"), 0);
    assert.equal(parseAmountToMinor("1500", "JPY"), 1500);
    assert.equal(parseAmountToMinor("1500.75", "JPY"), 1501, "rounds, does not truncate");
  });

  it("extra precision is rounded rather than rejected", () => {
    assert.equal(parseAmountToMinor("12.345", "USD"), 1235);
    assert.equal(parseAmountToMinor("12.344", "USD"), 1234, "rounds down, not toward zero");
    assert.equal(parseAmountToMinor("12.999", "USD"), 1300, "and carries into the units");
  });

  it("refuses anything that is not a plain positive decimal", () => {
    for (const bad of ["", "  ", ".", "abc", "1e3", "1,234.00", "-5", "12.34abc", "+3"]) {
      assert.equal(parseAmountToMinor(bad, "GBP"), null, `expected ${JSON.stringify(bad)} to be refused`);
    }
  });

  it("trims, because a pasted amount arrives with a space", () => {
    assert.equal(parseAmountToMinor("  7.50 ", "GBP"), 750);
  });

  it("NaN and Infinity never become an amount", () => {
    assert.equal(floatToMinor(Number.NaN, "GBP"), null);
    assert.equal(floatToMinor(Number.POSITIVE_INFINITY, "GBP"), null);
  });
});

describe("the float boundary is one boundary", () => {
  it("round trips an expense float that is exactly representable in minor units", () => {
    assert.equal(floatToMinor(12.34, "GBP"), 1234);
    assert.equal(floatToMinor(0.01, "GBP"), 1);
    assert.equal(floatToMinor(99.99, "USD"), 9999);
  });

  it("is a function of the displayed number, not its binary neighbour", () => {
    // 0.1 + 0.2 === 0.30000000000000004 in float. What the user sees is 0.3.
    assert.equal(floatToMinor(0.1 + 0.2, "GBP"), 30);
  });

  it("minorToFloat exists for display and is not a storage path", () => {
    assert.equal(minorToFloat(1234, "GBP"), 12.34);
    assert.equal(minorToFloat(1500, "JPY"), 1500);
  });
});

describe("formatting", () => {
  it("renders minor units as the currency the user recognises", () => {
    assert.equal(formatMinor(1234, "GBP"), "£12.34");
    assert.equal(formatMinor(-1234, "USD"), "-$12.34");
    assert.equal(formatMinor(5, "GBP"), "£0.05");
    assert.equal(formatMinor(0, "JPY"), "¥0");
  });

  it("an input field gets the number without the symbol", () => {
    assert.equal(minorToInput(1234, "GBP"), "12.34");
    assert.equal(minorToInput(-1234, "GBP"), "-12.34");
  });
});

describe("direction is explicit, so a sign error cannot hide", () => {
  it("money out is negative in the sum and money in is positive", () => {
    assert.equal(signedMinor(500, "out"), -500);
    assert.equal(signedMinor(500, "in"), 500);
  });

  it("direction wins over the sign the caller passed, rather than trusting it", () => {
    assert.equal(signedMinor(-500, "in"), 500);
    assert.equal(signedMinor(500, "out"), -500);
  });
});

describe("a balance is a sum, so order cannot change it", () => {
  it("adds integer minor units exactly", () => {
    assert.equal(sumMinor([100, 250, -75]), 275);
    assert.equal(sumMinor([]), 0);
  });

  it("a float in the list is refused rather than silently rounded", () => {
    assert.ok(Number.isNaN(sumMinor([100, 10.5])));
  });
});

describe("the idempotency key", () => {
  const base = {
    postedAt: 1_757_000_000_000,
    amountMinor: 1234,
    direction: "out" as const,
    externalId: undefined,
    label: "  ADOBE   Creative Cloud ",
  };

  it("is stable for the same statement row", () => {
    assert.equal(transactionKey(base), transactionKey({ ...base }));
  });

  it("normalises the label, because a statement pads it inconsistently", () => {
    assert.equal(transactionKey(base), transactionKey({ ...base, label: "adobe creative cloud" }));
  });

  it("changes when any guaranteed-stable field changes", () => {
    const key = transactionKey(base);
    assert.notEqual(key, transactionKey({ ...base, postedAt: base.postedAt + 1 }));
    assert.notEqual(key, transactionKey({ ...base, amountMinor: 1235 }));
    assert.notEqual(key, transactionKey({ ...base, direction: "in" }));
    assert.notEqual(key, transactionKey({ ...base, externalId: "abc-123" }));
  });

  it("is readable, because an auditor should not need a hash to read a dedupe", () => {
    assert.match(transactionKey(base), /^txn:out:1757000000000:1234:adobe creative cloud$/);
  });

  it("does not include the file name, so re-importing a statement is still an import", () => {
    const a = transactionKey({ ...base, externalId: "stmt-1-row-7" });
    const b = transactionKey({ ...base, externalId: "stmt-1-row-7" });
    assert.equal(a, b);
  });
});

describe("the currency vocabulary is closed", () => {
  it("accepts only known codes", () => {
    assert.equal(isCurrencyCode("GBP"), true);
    assert.equal(isCurrencyCode("XYZ"), false);
    assert.equal(isCurrencyCode("toString"), false);
  });
});

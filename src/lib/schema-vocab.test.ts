import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { AREAS, PROVIDERS } from "./areas";
import { categoriseExpense, COUNTRIES } from "./tax";

/**
 * The Convex schema cannot import the catalogues, because a Convex validator
 * has to be a static literal union — there is no way to build one from an
 * array at module load and keep the literal types. So the vocabularies are
 * written out twice, and this file is the thing that stops them drifting.
 *
 * If it fails, the correct fix is to widen the schema validator *and* the
 * catalogue together, never one on its own: a catalogue that gains a value the
 * schema does not know about is a write that will be rejected at runtime with
 * no compile-time warning anywhere.
 */

const SCHEMA_PATH = new URL("../convex/schema.ts", import.meta.url);

function readSchema(): string {
  return readFileSync(SCHEMA_PATH, "utf8");
}

/** Extracts the string literals from a named union in the schema source. */
function schemaUnion(name: string, source = readSchema()): string[] {
  const match = source.match(new RegExp(`${name} = v\\.union\\(([\\s\\S]*?)\\n\\);`));
  assert.ok(match, `could not find ${name} in schema.ts`);
  return [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

function sorted(values: Iterable<string>): string[] {
  return [...values].sort();
}

test("areas.slug validator matches the life-area catalogue", () => {
  assert.deepEqual(sorted(schemaUnion("areaSlugValidator")), sorted(AREAS.map((a) => a.slug)));
});

test("connections.provider validator matches the provider catalogue", () => {
  assert.deepEqual(sorted(schemaUnion("providerSlugValidator")), sorted(PROVIDERS.map((p) => p.slug)));
});

test("taxProfile.country validator matches the tax engine's countries", () => {
  assert.deepEqual(sorted(schemaUnion("countryCodeValidator")), sorted(Object.keys(COUNTRIES)));
});

test("every expense bucket the categoriser can produce is a valid bucket", () => {
  const buckets = schemaUnion("expenseBucketValidator");
  // One representative phrase per rule, plus a miss that must fall back.
  const samples = [
    "adobe subscription", "new monitor", "desk lamp", "flight to lisbon", "lunch",
    "accountant fee", "public liability cover", "google ads", "online course",
    "notebooks and pens", "zzz nothing matches",
  ];
  for (const sample of samples) {
    const { bucket } = categoriseExpense(sample);
    assert.ok(buckets.includes(bucket), `bucket "${bucket}" (from "${sample}") is not in the schema`);
  }
});

test("confidence is a closed four-value vocabulary", () => {
  assert.deepEqual(sorted(schemaUnion("confidenceValidator")), ["confirmed", "high", "low", "medium"]);
});

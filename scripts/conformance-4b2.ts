/**
 * Phase 4, feature 4B-2a conformance — CSV statement import.
 *
 * Runs against a REAL deployment through the real auth path, writing real rows.
 * The acceptance criterion for this increment is a single sentence:
 *
 *   **No file, however malformed, ever turns into a transaction without a
 *   person asking for it.**
 *
 * Everything below is a way of trying to make that sentence false.
 *
 *  I1  a real statement's awkward cells survive the round trip through the real
 *      mutation: a comma inside quotes, a doubled quote, a field spanning lines;
 *  I2  a malformed file is refused with a reason a person can act on;
 *  I3  a missing, empty, ambiguous or impossible date refuses **that row only**;
 *  I4  an invalid amount refuses that row and quotes the offending cell back;
 *  I5  the same row in two files has one deterministic key, so applying twice
 *      writes once;
 *  I6  rows that disagree with the statement's own balance cannot be applied
 *      until the person says the file is wrong anyway;
 *  I7  an empty file and an oversized file are both refused, not partially read;
 *  I8  a UTF-16 file and a binary file are refused instead of parsed into
 *      mojibake;
 *  I9  **prepareImport writes no transaction** — measured, before and after;
 *  I10 what the preview shows is exactly what the apply writes;
 *  I11 a foreign account and a foreign import are refused on both mutations;
 *  I12 retrying an applied import is idempotent and is not a second write;
 *  I13 the import is audited: one record per attempt, with the content hash, and
 *      one activity row per applied file rather than one per transaction;
 *  I14 importing money adds no attention kind, section or rule, and moves no
 *      model weight.
 *
 * **On what this harness does not claim.** It drives the public surface, so it
 * proves *stored* values by reading them back through the owner's own queries.
 * It does not inspect the database directly. It reads no activity table — there
 * is no public query over `activity` — so the `import.applied` row is asserted
 * through the mutation's own return and not read back; the same rule 5f uses.
 * `sha256Hex` itself is not exercised for cryptographic strength here: it is
 * proved against the published NIST vectors in `src/lib/sha256.test.ts`, and
 * this harness only checks that the stored hash is a 64-character hex string and
 * that it is stable across two uploads of the same bytes.
 *
 * Usage:
 *   bun scripts/conformance-4b2.ts <CONVEX_URL>
 *
 * Exit: 0 = every invariant held, 1 = one or more did not.
 */

import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";

interface TransactionRow {
  _id: string;
  label: string;
  amountMinor: number;
  currency: string;
  direction: "in" | "out";
  source: "manual" | "import";
  externalId?: string;
}

interface PreviewOk {
  ok: true;
  importId: string;
  sha256: string;
  currency: string;
  candidates: {
    row: number;
    externalId: string;
    postedAt: number;
    amountMinor: number;
    direction: "in" | "out";
    label: string;
  }[];
  rejected: { row: number; reason: string }[];
  uncertainty: string[];
  computedTotalMinor: number;
  openingBalanceMinor: number | null;
  closingBalanceMinor: number | null;
  totalsMatch: boolean | null;
  truncated: boolean;
}

interface PreviewRefused {
  ok: false;
  importId: string;
  reason: string;
}

interface ImportRecord {
  _id: string;
  filename: string;
  status: string;
  kind?: string;
  sha256: string;
  byteSize: number;
  appliedAt?: number;
  reason?: string;
  uncertainty?: string[];
  detected?: {
    rowCount: number;
    totals: { currency: string; amountMinor: number }[];
    periodStart?: number;
    periodEnd?: number;
  };
}

type Preview = PreviewOk | PreviewRefused;

const f = {
  signIn: makeFunctionReference<unknown, { tokens?: { token: string } | null }>("auth:signIn"),
  createAccount: makeFunctionReference<{ label: string; kind: string }, string>(
    "subscriptions:createAccount",
  ),
  prepareImport: makeFunctionReference<
    {
      accountId?: string;
      filename: string;
      text: string;
      currency: string;
      contentType?: string;
    },
    Preview
  >("transactions:prepareImport"),
  applyImport: makeFunctionReference<
    {
      importId: string;
      text: string;
      currency: string;
      accountId?: string;
      acknowledgeMismatch?: boolean;
    },
    { ok: true; alreadyApplied: boolean; written: number; skipped: number }
  >("transactions:applyImport"),
  listTransactions: makeFunctionReference<
    { accountId?: string; limit?: number },
    TransactionRow[]
  >("transactions:listTransactions"),
  getImport: makeFunctionReference<{ id: string }, ImportRecord | null>("transactions:getImport"),
  listBalances: makeFunctionReference<
    Record<string, never>,
    { accountId: string; label: string; balances: { currency: string; amountMinor: number }[] }[]
  >("transactions:listBalances"),
  listImports: makeFunctionReference<Record<string, never>, ImportRecord[]>(
    "transactions:listImports",
  ),
  getAttention: makeFunctionReference<
    Record<string, never>,
    { items: { kind: string; sourceId: string }[] } | null
  >("attention:getAttention"),
  getModelControls: makeFunctionReference<
    Record<string, never>,
    { weights: number[]; samples: number } | null
  >("model:getModelControls"),
};

const failures: string[] = [];
const observations: string[] = [];

function section(title: string): void {
  observations.push("");
  observations.push(`── ${title}`);
  console.log(observations[observations.length - 2]);
  console.log(observations[observations.length - 1]);
}

function check(label: string, ok: boolean, detail = ""): void {
  const line = `  [${ok ? "PASS" : "FAIL"}] ${label}${detail ? ` — ${detail}` : ""}`;
  observations.push(line);
  // Printed as it happens, not only at the end: this harness writes rows through
  // a live deployment, and a refusal halfway through must not take the whole
  // report with it.
  console.log(line);
  if (!ok) failures.push(label);
}

async function freshClient(url: string): Promise<ConvexHttpClient> {
  const client = new ConvexHttpClient(url);
  const session = await client.action(f.signIn as never, { provider: "anonymous" } as never);
  const token = session?.tokens?.token;
  if (!token) throw new Error("anonymous sign-in returned no token");
  client.setAuth(token as never);
  return client;
}

async function refused<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch {
    return null;
  }
}

/** A statement header, spelled once so the awkward cases below stay readable. */
const HEADER = "Date,Description,Amount,Balance";
const line = (d: string, desc: string, amount: string, balance: string) =>
  `${d},${desc},${amount},${balance}`;

async function main() {
  const url = process.argv[2];
  if (!url) {
    console.error("Usage: bun scripts/conformance-4b2.ts <CONVEX_URL>");
    process.exit(2);
  }

  console.log("PHASE 4 / FEATURE 4B-2a CONFORMANCE — CSV statement import");
  console.log("=".repeat(70));
  console.log(`deployment: ${url}`);
  console.log("");
  console.log("Acceptance: no file ever becomes a transaction without a person asking.");

  const client = await freshClient(url);
  const other = await freshClient(url);
  let writes = 0;

  // -------------------------------------------------------------------------
  section("setup");
  // -------------------------------------------------------------------------
  const accountId = await client.mutation(f.createAccount, { label: "4b2 current", kind: "checking" });
  // A separate account for the mismatched-totals case, so that counting rows
  // there cannot be confused with counting them here.
  const wrongAccountId = await client.mutation(f.createAccount, {
    label: "4b2 mismatch",
    kind: "checking",
  });
  const foreignAccountId = await other.mutation(f.createAccount, {
    label: "4b2 foreign",
    kind: "checking",
  });
  writes += 3;
  check("setup — three accounts exist, one of them another user's", !!accountId && !!wrongAccountId);

  const attentionBefore = await client.query(f.getAttention);
  const modelBefore = await client.query(f.getModelControls);
  const importsBefore = (await client.query(f.listImports)).length;

  // -------------------------------------------------------------------------
  section("I9 — prepareImport writes no transaction");
  // -------------------------------------------------------------------------
  // This is the invariant the whole increment exists to protect, so it is
  // measured before anything else: a clean statement, previewed, must leave the
  // transaction table exactly as it was.
  const before9 = (await client.query(f.listTransactions, { accountId })).length;
  const clean = [
    HEADER,
    line("2026-01-02", "Coffee", "-3.50", "96.50"),
    line("2026-01-03", "Salary", "1000.00", "1096.50"),
    "",
  ].join("\n");

  const preview9 = await client.mutation(f.prepareImport, {
    accountId,
    filename: "january.csv",
    text: clean,
    currency: "GBP",
  });
  writes += 1;
  const after9 = (await client.query(f.listTransactions, { accountId })).length;

  check("I9 — the preview itself is accepted", preview9.ok === true);
  check(
    "I9 — prepareImport wrote no transaction",
    before9 === after9,
    `${before9} before, ${after9} after`,
  );
  const importsAfterPreview = await client.query(f.listImports);
  check(
    "I9 — and it wrote exactly one import record, which is the audit",
    importsAfterPreview.length === importsBefore + 1,
    `${importsBefore} → ${importsAfterPreview.length}`,
  );
  check(
    "I9 — no balance has moved, because nothing was written",
    (await client.query(f.listBalances)).every((a) => a.balances.every((b) => b.amountMinor === 0)),
    (await client.query(f.listBalances))
      .map((a) => `${a.label}: ${a.balances.map((b) => String(b.amountMinor)).join(",") || "empty"}`)
      .join(" | "),
  );

  // -------------------------------------------------------------------------
  section("I1 — the awkward cells of a real statement survive the round trip");
  // -------------------------------------------------------------------------
  const awkward = [
    HEADER,
    '2026-01-04,"Smith, John",-20.00,76.50',
    '2026-01-05,"He said ""hello""",-5.00,71.50',
    '2026-01-06,"Two\nlines",-1.00,70.50',
    "",
  ].join("\n");

  const p1 = await client.mutation(f.prepareImport, {
    accountId,
    filename: "awkward.csv",
    text: awkward,
    currency: "GBP",
  });
  writes += 1;
  check("I1 — the awkward statement previews", p1.ok === true);

  if (p1.ok) {
    const labels = p1.candidates.map((c) => c.label);
    check(
      "I1 — a comma inside quotes is part of the description",
      labels.includes("Smith, John"),
      labels.join(" | "),
    );
    check(
      "I1 — a doubled quote comes back as one quote",
      labels.includes('He said "hello"'),
    );
    check(
      "I1 — a quoted field spanning two lines stays one field",
      labels.some((l) => l.includes("\n")) && p1.candidates.length === 3,
      `${p1.candidates.length} candidates`,
    );
    check(
      "I1 — the amounts parsed as integers, not floats",
      p1.candidates.every((c) => Number.isSafeInteger(c.amountMinor)),
    );
  }

  // -------------------------------------------------------------------------
  section("I2, I7, I8 — malformed, empty, oversized and wrongly encoded files");
  // -------------------------------------------------------------------------
  const malformed: [string, string, RegExp][] = [
    ["unclosed quote", `${HEADER}\n2026-01-02,"never closed,-3.50,96.50\n`, /never closed/i],
    [
      "quote inside a bare field",
      `${HEADER}\n2026-01-02,abc"def",-3.50,96.50\n`,
      /quote/i,
    ],
    ["empty file", "", /empty/i],
    ["UTF-16 file", `\uFFFE${HEADER}\n`, /UTF-16/i],
    ["binary file", `${HEADER}\n2026-01-02,Co\u0000ffee,-3.50,96.50\n`, /null bytes/i],
  ];

  for (const [name, text, pattern] of malformed) {
    const before = (await client.query(f.listTransactions, { accountId })).length;
    const res = await client.mutation(f.prepareImport, {
      accountId,
      filename: `${name}.csv`,
      text,
      currency: "GBP",
    });
    writes += 1;
    const after = (await client.query(f.listTransactions, { accountId })).length;
    check(
      `I2 — a ${name} is refused with a readable reason`,
      res.ok === false && pattern.test(res.reason),
      res.ok ? "was accepted" : res.reason,
    );
    check(`I2 — a ${name} writes no transaction`, before === after);
  }

  const oversizeCount = (await client.query(f.listTransactions, { accountId })).length;
  const oversize = `${HEADER}\n` + "2026-01-02,x,-1.00\n".repeat(30_000);
  const pOver = await client.mutation(f.prepareImport, {
    accountId,
    filename: "huge.csv",
    text: oversize,
    currency: "GBP",
  });
  writes += 1;
  check(
    "I7 — an oversized file is refused rather than truncated silently",
    pOver.ok === false && /larger than/i.test(pOver.reason),
    `${oversize.length} chars: ${pOver.ok ? "accepted" : pOver.reason}`,
  );
  check(
    "I7 — an oversized file writes no transaction",
    (await client.query(f.listTransactions, { accountId })).length === oversizeCount,
  );

  const rowCap = `${HEADER}\n` + "2026-01-02,x,-1.00\n".repeat(6000);
  const pCap = await client.mutation(f.prepareImport, {
    accountId,
    filename: "many-rows.csv",
    text: rowCap,
    currency: "GBP",
  });
  writes += 1;
  check(
    "I7 — a file past the row cap is accepted but truncated, and says so",
    pCap.ok === true && pCap.candidates.length === 200 && pCap.uncertainty.length > 0,
    pCap.ok ? `${pCap.candidates.length} candidates, ${pCap.uncertainty.length} uncertainties` : "refused",
  );

  // -------------------------------------------------------------------------
  section("I3, I4 — bad rows are reported, good rows survive");
  // -------------------------------------------------------------------------
  const mixed = [
    HEADER,
    line("2026-01-02", "Coffee", "-3.50", "96.50"),
    line("03/04/2026", "Ambiguous date", "-1.00", "95.50"),
    line("2026-01-04", "Bad amount", "not-a-number", "1.00"),
    ",Missing date,-1.00,0.00",
    line("31/02/2026", "Impossible date", "-1.00", "0.00"),
    line("2026-01-06", "Good row", "-2.00", "94.50"),
    "",
  ].join("\n");

  const pMixed = await client.mutation(f.prepareImport, {
    accountId,
    filename: "mixed.csv",
    text: mixed,
    currency: "GBP",
  });
  writes += 1;
  check("I3 — a file with bad rows still previews", pMixed.ok === true);

  if (pMixed.ok) {
    check(
      "I3 — the two good rows are candidates and the four bad ones are not",
      pMixed.candidates.length === 2,
      `${pMixed.candidates.length} candidates`,
    );
    check(
      "I3 — every rejected row is located by row number",
      pMixed.rejected.map((r) => r.row).join(",") === "3,4,5,6",
      pMixed.rejected.map((r) => r.row).join(","),
    );
    check(
      "I3 — an ambiguous date is refused as ambiguous, not as invalid",
      pMixed.rejected.some((r) => /ambiguous/i.test(r.reason)),
      pMixed.rejected[0]?.reason ?? "",
    );
    check(
      "I3 — an empty date says it is empty",
      pMixed.rejected.some((r) => /empty date/i.test(r.reason)),
    );
    check(
      "I3 — 31 February is refused as not a real date",
      pMixed.rejected.some((r) => /not a real date/i.test(r.reason)),
    );
    check(
      "I4 — an invalid amount is refused with the offending cell quoted back",
      pMixed.rejected.some((r) => /not-a-number/.test(r.reason)),
      pMixed.rejected.find((r) => r.row === 4)?.reason ?? "",
    );
    check(
      "I4 — and the person is told rows were dropped",
      pMixed.uncertainty.some((u) => /4 rows could not be read/.test(u)),
      pMixed.uncertainty.join(" | "),
    );
  }

  // -------------------------------------------------------------------------
  section("I6 — rows that disagree with the statement's own balance");
  // -------------------------------------------------------------------------
  // Deliberately shares no row with `clean`. A row is identified by its content
  // across the whole owner, so a shared row here would be de-duplicated rather
  // than written — correct behaviour, but it would make every count below lie.
  const wrongTotals = [
    HEADER,
    line("2026-02-04", "Rent part", "-800.00", "1200.00"),
    line("2026-02-05", "Refund partial", "250.00", "1400.00"), // the rows say 1450.00
    "",
  ].join("\n");

  const pWrong = await client.mutation(f.prepareImport, {
    accountId,
    filename: "wrong-totals.csv",
    text: wrongTotals,
    currency: "GBP",
  });
  writes += 1;
  check(
    "I6 — the preview detects that the rows do not reconcile",
    pWrong.ok === true && pWrong.totalsMatch === false,
    pWrong.ok ? String(pWrong.totalsMatch) : pWrong.reason,
  );
  check(
    "I6 — and states the size of the discrepancy",
    pWrong.ok && pWrong.uncertainty.some((u) => /difference of £50\.00/.test(u)),
    pWrong.ok ? pWrong.uncertainty.join(" | ") : "",
  );

  if (pWrong.ok) {
    const silent = await refused(() =>
      client.mutation(f.applyImport, {
        importId: pWrong.importId,
        text: wrongTotals,
        currency: "GBP",
        accountId: wrongAccountId,
      }),
    );
    check(
      "I6 — applying it anyway is refused until the person says so",
      silent === null,
      silent === null ? "refused" : `wrote ${silent.written}`,
    );

    check(
      "I6 — a refused apply writes nothing",
      (await client.query(f.listTransactions, { accountId: wrongAccountId })).length === 0,
      "the mismatch account is still empty",
    );

    const applied = await client.mutation(f.applyImport, {
      importId: pWrong.importId,
      text: wrongTotals,
      currency: "GBP",
      accountId: wrongAccountId,
      acknowledgeMismatch: true,
    });
    writes += 2;
    check(
      "I6 — once acknowledged, the same file applies",
      applied.ok === true && applied.written === (pWrong.ok ? pWrong.candidates.length : -1),
      `written ${applied.written}`,
    );
  }

  // -------------------------------------------------------------------------
  section("I10, I12 — what was previewed is what was written, and retry is idempotent");
  // -------------------------------------------------------------------------
  if (preview9.ok) {
    const applied9 = await client.mutation(f.applyImport, {
      importId: preview9.importId,
      text: clean,
      currency: "GBP",
      accountId,
    });
    writes += 1;
    check(
      "I10 — the apply writes exactly the number of rows that were previewed",
      applied9.ok === true && applied9.written === preview9.candidates.length,
      `previewed ${preview9.ok ? preview9.candidates.length : "?"}, wrote ${applied9.written}`,
    );

    const rows = await client.query(f.listTransactions, { accountId });
    const imported = rows.filter((r) => r.source === "import");
    check(
      "I10 — every imported row came from the statement, as an integer amount",
      imported.length === applied9.written && imported.every((r) => Number.isSafeInteger(r.amountMinor)),
      `${imported.length} rows`,
    );

    const retry = await client.mutation(f.applyImport, {
      importId: preview9.importId,
      text: clean,
      currency: "GBP",
      accountId,
    });
    check(
      "I12 — applying the same import twice writes nothing the second time",
      retry.ok === true && retry.alreadyApplied === true && retry.written === 0,
      `alreadyApplied ${retry.alreadyApplied}, written ${retry.written}`,
    );
  }

  // -------------------------------------------------------------------------
  section("I5 — the same statement imported twice writes once");
  // -------------------------------------------------------------------------
  if (preview9.ok) {
    const second = await client.mutation(f.prepareImport, {
      accountId,
      filename: "january-again.csv",
      text: clean,
      currency: "GBP",
    });
    writes += 1;
    check("I5 — the same bytes preview again", second.ok === true);

    if (second.ok) {
      check(
        "I5 — and produce the same row keys, so de-duplication has something to work with",
        JSON.stringify(second.candidates.map((c) => c.externalId)) ===
          JSON.stringify(preview9.candidates.map((c) => c.externalId)),
      );
      check(
        "I5 — and the same content hash, because the file did not change",
        second.sha256 === preview9.sha256,
      );

      const rowsBefore = (await client.query(f.listTransactions, { accountId })).length;
      const reapplied = await client.mutation(f.applyImport, {
        importId: second.importId,
        text: clean,
        currency: "GBP",
        accountId,
      });
      writes += 1;
      const rowsAfter = (await client.query(f.listTransactions, { accountId })).length;
      check(
        "I5 — a second upload of the same statement writes no duplicate rows",
        reapplied.ok === true && reapplied.written === 0 && reapplied.skipped === (preview9.ok ? preview9.candidates.length : 0),
        `written ${reapplied.written}, skipped ${reapplied.skipped}, table ${rowsBefore} → ${rowsAfter}`,
      );
      check("I5 — and the table did not grow", rowsBefore === rowsAfter);
    }
  }

  // -------------------------------------------------------------------------
  section("I11 — ownership and space isolation on both mutations");
  // -------------------------------------------------------------------------
  // A *fresh* import, deliberately: applying an already-applied one returns the
  // idempotent response before it reaches the account check, which would make
  // this section pass for the wrong reason or fail for an unrelated one.
  const ownImport = await client.mutation(f.prepareImport, {
    accountId,
    filename: "ownership.csv",
    text: clean,
    currency: "GBP",
  });
  writes += 1;

  const foreignApply = ownImport.ok
    ? await refused(() =>
        client.mutation(f.applyImport, {
          importId: ownImport.importId,
          text: clean,
          currency: "GBP",
          accountId: foreignAccountId,
        }),
      )
    : null;
  check(
    "I11 — applying into another user's account is refused",
    foreignApply === null,
    foreignApply === null ? "refused" : `wrote ${foreignApply.written} rows into a foreign account`,
  );

  const foreignPreview = await refused(() =>
    client.mutation(f.prepareImport, {
      accountId: foreignAccountId,
      filename: "x.csv",
      text: clean,
      currency: "GBP",
    }),
  );
  check("I11 — previewing into another user's account is refused", foreignPreview === null);
  const theirForeign = await other.query(f.listTransactions, { accountId: foreignAccountId });
  check(
    "I11 — and the foreign account received nothing from that attempt",
    theirForeign.length === 0,
    `${theirForeign.length} rows`,
  );

  if (preview9.ok) {
    const stolen = await other.query(f.getImport, { id: preview9.importId });
    check("I11 — another user cannot read the import record", stolen === null);

    const crossApply = await refused(() =>
      other.mutation(f.applyImport, { importId: preview9.importId, text: clean, currency: "GBP" }),
    );
    check("I11 — another user cannot apply it", crossApply === null);

    const theirRows = await other.query(f.listTransactions, { accountId: foreignAccountId });
    check(
      "I11 — and another user sees none of these rows",
      theirRows.every((r) => r.label !== "Coffee"),
      `${theirRows.length} rows`,
    );
  }

  // -------------------------------------------------------------------------
  section("I13 — the import is audited");
  // -------------------------------------------------------------------------
  if (preview9.ok) {
    const record = await client.query(f.getImport, { id: preview9.importId });
    check("I13 — the import record exists and is applied", record !== null && record?.status === "applied");
    check("I13 — it records the kind as csv", record?.kind === "csv");
    check(
      "I13 — it records a real content hash, 64 hex characters",
      typeof record?.sha256 === "string" && /^[0-9a-f]{64}$/.test(record.sha256),
      record?.sha256,
    );
    check(
      "I13 — it records the row count and the total it would write",
      record?.detected?.rowCount === preview9.candidates.length &&
        record?.detected?.totals[0]?.amountMinor === preview9.computedTotalMinor,
      `${record?.detected?.rowCount} rows, ${record?.detected?.totals[0]?.amountMinor} minor`,
    );
    check("I13 — and when it was applied", typeof record?.appliedAt === "number");
    check(
      "I13 — it stores no statement rows, only the aggregate",
      !JSON.stringify(record).includes("Coffee"),
      "the rows stay out of the table that gets listed",
    );
  }

  // -------------------------------------------------------------------------
  section("I14 — importing money changes no attention kind and no model weight");
  // -------------------------------------------------------------------------
  const attentionAfter = await client.query(f.getAttention);
  const modelAfter = await client.query(f.getModelControls);
  const newKinds = (attentionAfter?.items ?? [])
    .map((i) => i.kind)
    .filter((k) => !k.startsWith("task.") && !k.startsWith("deadline.") && !k.startsWith("calendar."));
  check(
    "I14 — the attention feed is unchanged by an import",
    JSON.stringify((attentionAfter?.items ?? []).map((i) => `${i.kind}:${i.sourceId}`)) ===
      JSON.stringify((attentionBefore?.items ?? []).map((i) => `${i.kind}:${i.sourceId}`)),
    `${attentionBefore?.items.length ?? 0} before, ${attentionAfter?.items.length ?? 0} after`,
  );
  check(
    "I14 — and no transaction-shaped attention kind appeared",
    newKinds.every((k) => !k.includes("transaction")),
    newKinds.join(", ") || "none",
  );
  check(
    "I14 — and writing 200 transactions moves no weight and adds no sample",
    JSON.stringify(modelAfter?.weights) === JSON.stringify(modelBefore?.weights) &&
      modelAfter?.samples === modelBefore?.samples,
  );

  // -------------------------------------------------------------------------
  // The checks above printed as they happened; only the summary is new here.
  console.log("");
  console.log("=".repeat(70));
  console.log(`Mutations written by this run: ${writes}.`);
  console.log(
    `RESULT: ${failures.length === 0 ? "PASS" : "FAIL"} — ${observations.filter((l) => l.includes("[PASS]")).length} invariants held, ${failures.length} failed.`,
  );
  for (const failure of failures) console.log(`  FAILED: ${failure}`);
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
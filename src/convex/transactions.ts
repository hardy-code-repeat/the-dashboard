/**
 * Transactions: first-class money facts (ADR-031, phase 4 feature 4B).
 *
 * The whole module is built around one refusal: **there is no balance column**.
 * A balance is a sum over these rows, taken at read time. That is what keeps
 * Panel a system that knows about money rather than one that re-accounts for
 * it — a stored balance is the number that drifts from the bank with nothing to
 * check it, and ADR-028's real target was always that number rather than the
 * existence of a transaction.
 *
 * ## Read discipline
 *
 * Every read here is index-scoped and bounded. `listTransactions` narrows by
 * owner *or* account through a scope-first index and takes an explicit limit;
 * `getAccountBalance` reads one account's range and sums it. No query collects
 * a user's transactions and filters afterwards — the collect-then-filter shape
 * recorded as D42, D43 and D48 is designed out rather than reviewed for.
 *
 * ## Import (phase 4B-2a)
 *
 * Two mutations, in this order, and the order is the feature:
 *
 * 1. `prepareImport` — reads a CSV, produces a **preview**, and writes exactly
 *    one row to `imports`. It writes no transaction. Nothing about the file
 *    becomes durable except a record that someone tried it.
 * 2. `applyImport` — takes the same text, verifies it still hashes to the same
 *    value, and only then writes transactions, one per confirmed candidate.
 *
 * The caller therefore has to do two things to import a statement, and the
 * second one is the one that writes money. That is the whole safety story: there
 * is no code path from "a file arrived" to "transactions exist" that does not go
 * through a person asking for it.
 *
 * Why the text is passed twice rather than cached: the `imports` row stores
 * aggregates only — totals, a period, a row count, and the words of anything
 * uncertain — and the schema says so. Caching the rows there to avoid a second
 * parse would mean storing someone's raw statement in the one table that gets
 * listed and exported. Re-parsing the text the caller already holds is cheaper
 * than that, and the sha256 check means the bytes applied are provably the
 * bytes that were previewed.
 *
 * ## What is deliberately absent
 *
 * No agent writes a transaction: `AgentAction` remains
 * `{kind:"flag"} | {kind:"log"}`, so the tier system cannot express a financial
 * write at all. There is no reconciliation against a bank, no transfer pairing,
 * and no XLSX or PDF pipeline — those are separate changes with their own
 * approvals, and this module does not hint at them.
 */

import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";

import { buildImportPreview, LIMITS } from "../lib/csv";
import { isCurrencyCode, signedMinor, transactionKey } from "../lib/money";
import { sha256Hex } from "../lib/sha256";
import type { Id } from "./_generated/dataModel";
import { requireUserId } from "./assistant";
import { mutation, query } from "./_generated/server";
import {
  confidenceValidator,
  currencyValidator,
  expenseBucketValidator,
  transactionDirectionValidator,
} from "./schema";
import { ensurePersonalSpace } from "./spaces";

/** A surface is a list, not an export. The bound belongs to the read. */
const MAX_TRANSACTIONS = 100;
const MAX_IMPORTS = 20;
/** Accounts are user-created and few; the cap exists so the fan-out is bounded. */
const MAX_ACCOUNTS = 20;
const MAX_LABEL = 120;
/**
 * How many rows one import may write.
 *
 * Referenced rather than restated: the cap lives in `csv.ts` so that the preview
 * and the apply cannot truncate at different rows, and this constant exists only
 * so the write loop has a bound to state in its own documentation.
 */
const MAX_IMPORT_ROWS = LIMITS.maxCandidates;

/**
 * Rejects an amount that is not a whole number of minor units.
 *
 * `v.number()` accepts a float, so this cannot be left to the type system. The
 * error text names the fix rather than the rule, because the only caller that
 * can hit it is the boundary that converts from the legacy expense float.
 */
function assertMinorUnits(amountMinor: number): void {
  if (!Number.isSafeInteger(amountMinor)) {
    throw new Error("Amount must be a whole number of minor units (pence or cents).");
  }
  if (amountMinor <= 0) {
    throw new Error("Amount must be greater than zero. Use direction to say which way it went.");
  }
}

/** A point read by id, then an ownership comparison. Never a scan. */
async function ownedAccount(ctx: { db: { get: (id: Id<"accounts">) => Promise<unknown> } }, id: Id<"accounts">, userId: Id<"users">) {
  const row = (await ctx.db.get(id)) as { ownerUserId?: Id<"users"> } | null;
  if (!row || row.ownerUserId !== userId) return null;
  return row;
}

// ---------------------------------------------------------------------------
// manual entry
// ---------------------------------------------------------------------------

/**
 * A transaction the user typed.
 *
 * Idempotent on `externalId`: re-running the same import twice returns the row
 * that already exists and writes nothing (ADR-009, §6). The key is readable on
 * purpose, so an auditor can see what de-duplicated a row without a hash.
 */
export const createTransaction = mutation({
  args: {
    accountId: v.optional(v.id("accounts")),
    postedAt: v.number(),
    amountMinor: v.number(),
    currency: currencyValidator,
    direction: transactionDirectionValidator,
    label: v.string(),
    merchant: v.optional(v.string()),
    bucket: v.optional(expenseBucketValidator),
    deductible: v.optional(v.boolean()),
    confidence: v.optional(confidenceValidator),
    externalId: v.optional(v.string()),
    importId: v.optional(v.id("imports")),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const spaceId = await ensurePersonalSpace(ctx, userId);

    assertMinorUnits(args.amountMinor);
    if (!Number.isFinite(args.postedAt)) throw new Error("A transaction needs a real date.");
    if (!isCurrencyCode(args.currency)) throw new Error("Unknown currency.");

    const label = args.label.trim();
    if (label.length === 0) throw new Error("A transaction needs a label.");
    if (label.length > MAX_LABEL) throw new Error(`Label is longer than ${MAX_LABEL} characters.`);

    if (args.accountId && !(await ownedAccount(ctx, args.accountId, userId))) {
      throw new Error("That account is not yours.");
    }
    if (args.importId) {
      const file = await ctx.db.get(args.importId);
      if (!file || file.ownerUserId !== userId) throw new Error("That import is not yours.");
    }

    // Idempotency. A point read on a scope-first index — one row, never a scan.
    if (args.externalId) {
      const existing = await ctx.db
        .query("transactions")
        .withIndex("by_owner_externalId", (q) =>
          q.eq("ownerUserId", userId).eq("externalId", args.externalId),
        )
        .unique();
      if (existing) return { id: existing._id, created: false as const };
    }

    const id = await ctx.db.insert("transactions", {
      ownerUserId: userId,
      spaceId,
      accountId: args.accountId,
      postedAt: args.postedAt,
      amountMinor: Math.abs(args.amountMinor),
      currency: args.currency,
      direction: args.direction,
      label,
      merchant: args.merchant?.trim() || undefined,
      bucket: args.bucket,
      deductible: args.deductible,
      confidence: args.confidence,
      source: args.externalId ? ("import" as const) : ("manual" as const),
      externalId: args.externalId,
      importId: args.importId,
    });

    await ctx.db.insert("activity", {
      spaceId,
      actor: "user",
      kind: "transaction.created",
      objectId: transactionKey({
        postedAt: args.postedAt,
        amountMinor: Math.abs(args.amountMinor),
        direction: args.direction,
        externalId: args.externalId,
        label,
      }),
      at: Date.now(),
    });

    return { id, created: true as const };
  },
});

// ---------------------------------------------------------------------------
// reads
// ---------------------------------------------------------------------------

/**
 * The most recent transactions for one owner, or for one of their accounts.
 *
 * `.take` with a clamped limit rather than `collect` then `slice`: the bound has
 * to belong to the read, or a long history makes the query grow without limit.
 */
export const listTransactions = query({
  args: {
    accountId: v.optional(v.id("accounts")),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const limit = Math.max(1, Math.min(args.limit ?? MAX_TRANSACTIONS, MAX_TRANSACTIONS));

    if (args.accountId) {
      if (!(await ownedAccount(ctx, args.accountId, userId))) return [];
      return await ctx.db
        .query("transactions")
        .withIndex("by_account_postedAt", (q) => q.eq("accountId", args.accountId))
        .order("desc")
        .take(limit);
    }

    return await ctx.db
      .query("transactions")
      .withIndex("by_owner_postedAt", (q) => q.eq("ownerUserId", userId))
      .order("desc")
      .take(limit);
  },
});

/**
 * The balance of one account, **derived**.
 *
 * Summing happens here, per read, which is the only reason there is no number
 * in the database that can be wrong. The result is grouped by currency rather
 * than summed into one figure: an account row carries a label and a kind but no
 * currency (ADR-028), so two currencies in one account is representable, and
 * adding pounds to dollars would be the exact class of small lie this project
 * keeps refusing elsewhere.
 */
export const getAccountBalance = query({
  args: {
    accountId: v.id("accounts"),
    from: v.optional(v.number()),
    to: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    if (!(await ownedAccount(ctx, args.accountId, userId))) return null;

    const rows = await ctx.db
      .query("transactions")
      .withIndex("by_account_postedAt", (q) => {
        const scoped = q.eq("accountId", args.accountId);
        return args.from != null && args.to != null
          ? scoped.gte("postedAt", args.from).lt("postedAt", args.to)
          : scoped;
      })
      .collect();

    const byCurrency = new Map<string, { amountMinor: number; count: number }>();
    for (const row of rows) {
      const entry = byCurrency.get(row.currency) ?? { amountMinor: 0, count: 0 };
      entry.amountMinor += signedMinor(row.amountMinor, row.direction);
      entry.count += 1;
      byCurrency.set(row.currency, entry);
    }

    return {
      accountId: args.accountId,
      derived: true as const,
      balances: [...byCurrency.entries()]
        .map(([currency, e]) => ({ currency, amountMinor: e.amountMinor, count: e.count }))
        .sort((a, b) => a.currency.localeCompare(b.currency)),
    };
  },
});

/**
 * Every account the caller owns, each with its derived balance.
 *
 * **This reads more rows than any other read in the module, and that is the
 * honest price of ADR-031.** A derived balance is a sum, and a sum needs every
 * row; a stored balance would make this query cheap by introducing a number
 * that can be wrong. The trade is taken deliberately, and it is contained in
 * three ways: the account list is **capped**, every read is **index-scoped to
 * one account**, and they are issued **in parallel** rather than in a loop.
 * The access is bounded by *this user's own* history — the same per-user bound
 * already accepted as A6 for the attention feed and the dashboard.
 */
export const listBalances = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const accounts = await ctx.db
      .query("accounts")
      .withIndex("by_owner", (q) => q.eq("ownerUserId", userId))
      .take(MAX_ACCOUNTS);

    return await Promise.all(
      accounts.map(async (account) => {
        const rows = await ctx.db
          .query("transactions")
          .withIndex("by_account_postedAt", (q) => q.eq("accountId", account._id))
          .collect();
        const byCurrency = new Map<string, number>();
        for (const row of rows) {
          byCurrency.set(
            row.currency,
            (byCurrency.get(row.currency) ?? 0) + signedMinor(row.amountMinor, row.direction),
          );
        }
        return {
          accountId: account._id,
          label: account.label,
          kind: account.kind,
          balances: [...byCurrency.entries()]
            .map(([currency, amountMinor]) => ({ currency, amountMinor }))
            .sort((a, b) => a.currency.localeCompare(b.currency)),
        };
      }),
    );
  },
});

/**
 * The import records for one owner, newest first.
 *
 * The rows exist before the pipeline that writes them. Reading an empty list is
 * the honest current answer: Panel has no upload surface yet, and this query
 * must not imply otherwise.
 */
export const listImports = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    return await ctx.db
      .query("imports")
      .withIndex("by_owner_createdAt", (q) => q.eq("ownerUserId", userId))
      .order("desc")
      .take(MAX_IMPORTS);
  },
});

/** One import record. A storage id is never returned to a second user. */
export const getImport = query({
  args: { id: v.id("imports") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const row = await ctx.db.get(args.id);
    if (!row || row.ownerUserId !== userId) return null;
    return row;
  },
});

// ---------------------------------------------------------------------------
// import — preview first, apply on request
// ---------------------------------------------------------------------------

/**
 * Reads a statement and shows the user what it contains. **Writes no
 * transaction.**
 *
 * The single row it does write is the audit record: one row per attempt,
 * including attempts that failed, because "I uploaded it and nothing happened"
 * is the state a person cannot otherwise explain to themselves. A failed attempt
 * stores the reason in words and never stores the file.
 *
 * `LIMITS.maxCandidates` has already truncated the candidate list inside the
 * pure parser, so the response is bounded by construction rather than by this
 * function remembering to bound it.
 */
export const prepareImport = mutation({
  args: {
    accountId: v.optional(v.id("accounts")),
    filename: v.string(),
    text: v.string(),
    currency: currencyValidator,
    contentType: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const spaceId = await ensurePersonalSpace(ctx, userId);

    if (args.accountId && !(await ownedAccount(ctx, args.accountId, userId))) {
      throw new Error("That account is not yours.");
    }
    if (!isCurrencyCode(args.currency)) throw new Error("Unknown currency.");

    const preview = buildImportPreview(args.text, { currency: args.currency });

    // A total that has outgrown an exact integer is refused even as a total:
    // "approximately right" is not a thing Panel is willing to store.
    const overflow =
      preview.ok && !Number.isSafeInteger(preview.computedTotalMinor)
        ? "The amounts in that file add up to more than Panel can represent exactly."
        : null;
    const readable = preview.ok && overflow === null;

    const period =
      readable && preview.candidates.length > 0
        ? preview.candidates.reduce(
            (acc, c) => ({ lo: Math.min(acc.lo, c.postedAt), hi: Math.max(acc.hi, c.postedAt) }),
            { lo: Infinity, hi: -Infinity },
          )
        : null;

    const importId = await ctx.db.insert("imports", {
      ownerUserId: userId,
      spaceId,
      filename: args.filename.trim().slice(0, 200) || "statement.csv",
      byteSize: new TextEncoder().encode(args.text).length,
      contentType: args.contentType ?? "text/csv",
      sha256: sha256Hex(args.text),
      status: readable ? ("extracted" as const) : ("failed" as const),
      kind: "csv" as const,
      // Aggregates only. The rows stay in the caller's hands until they ask for
      // them to be written, so the one table that gets listed holds no statement.
      detected: readable
        ? {
            periodStart: period?.lo,
            periodEnd: period?.hi,
            totals: [{ currency: args.currency, amountMinor: preview.computedTotalMinor }],
            rowCount: preview.candidates.length,
          }
        : undefined,
      uncertainty: preview.ok ? preview.uncertainty : undefined,
      reason: preview.ok ? (overflow ?? undefined) : preview.reason,
      createdAt: Date.now(),
    });

    if (!preview.ok) return { ok: false as const, importId, reason: preview.reason };
    if (!readable) return { ok: false as const, importId, reason: overflow as string };

    return {
      ok: true as const,
      importId,
      sha256: sha256Hex(args.text),
      currency: args.currency,
      candidates: preview.candidates,
      rejected: preview.rejected,
      uncertainty: preview.uncertainty,
      computedTotalMinor: preview.computedTotalMinor,
      openingBalanceMinor: preview.openingBalanceMinor,
      closingBalanceMinor: preview.closingBalanceMinor,
      totalsMatch: preview.totalsMatch,
      truncated: preview.truncated,
      columnMap: preview.columnMap,
    };
  },
});

/**
 * Writes the transactions a person confirmed.
 *
 * Four things have to be true before this writes anything, and each one is a
 * refusal rather than a repair:
 *
 * 1. The import is the caller's, and has not already been applied. Retrying an
 *    applied import returns what it did rather than writing it twice.
 * 2. The text still hashes to the sha256 that was previewed. If the file
 *    changed underneath, the confirmation was given about different bytes.
 * 3. If the statement's own balance disagrees with its own rows, the caller has
 *    said so out loud with `acknowledgeMismatch`.
 * 4. The account, if given, is the caller's.
 *
 * Rows already present are skipped by `externalId`, which is derived from the
 * row's content, so uploading the same statement twice writes once.
 */
export const applyImport = mutation({
  args: {
    importId: v.id("imports"),
    text: v.string(),
    currency: currencyValidator,
    accountId: v.optional(v.id("accounts")),
    acknowledgeMismatch: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const spaceId = await ensurePersonalSpace(ctx, userId);

    const file = await ctx.db.get(args.importId);
    if (!file || file.ownerUserId !== userId) throw new Error("That import is not yours.");

    // Retrying an applied import is not an error and is not a second write.
    if (file.status === "applied") {
      return { ok: true as const, alreadyApplied: true as const, written: 0, skipped: 0 };
    }
    if (file.status === "failed") {
      throw new Error("That file was never read, so there is nothing to apply. Upload it again.");
    }
    if (file.kind !== "csv") {
      throw new Error("That kind of file cannot be applied yet.");
    }

    if (sha256Hex(args.text) !== file.sha256) {
      throw new Error("That file has changed since you previewed it. Preview it again.");
    }
    if (args.accountId && !(await ownedAccount(ctx, args.accountId, userId))) {
      throw new Error("That account is not yours.");
    }
    if (!isCurrencyCode(args.currency)) throw new Error("Unknown currency.");

    const preview = buildImportPreview(args.text, { currency: args.currency });
    if (!preview.ok) throw new Error(`That file can no longer be read: ${preview.reason}`);
    if (preview.candidates.length === 0) throw new Error("There is nothing in that file to import.");

    // `totalsMatch === null` means there was no balance to check against, which
    // is not the same as a failure and does not need acknowledging.
    if (preview.totalsMatch === false && !args.acknowledgeMismatch) {
      throw new Error(
        "These rows do not agree with the statement's own balance. Look at the difference, then confirm to apply anyway.",
      );
    }

    // The same cap the preview used, so what was reviewed is what gets written.
    const rows = preview.candidates.slice(0, MAX_IMPORT_ROWS);

    // One point read per row on a two-field index prefix — the narrowest read
    // Convex offers, and issued in parallel rather than in a loop. This is
    // deliberately *not* "read the owner's transactions and filter in memory":
    // that shape is D48, and it would read every row the user has ever imported
    // to answer a question about 200 of them.
    const already = await Promise.all(
      rows.map(async (row) => {
        const found = await ctx.db
          .query("transactions")
          .withIndex("by_owner_externalId", (q) =>
            q.eq("ownerUserId", userId).eq("externalId", row.externalId),
          )
          .unique();
        return found ? row.externalId : null;
      }),
    );
    const present = new Set(already.filter((id): id is string => id !== null));

    let written = 0;
    let skipped = 0;
    for (const row of rows) {
      if (present.has(row.externalId)) {
        skipped += 1;
        continue;
      }
      await ctx.db.insert("transactions", {
        ownerUserId: userId,
        spaceId,
        accountId: args.accountId,
        postedAt: row.postedAt,
        amountMinor: row.amountMinor,
        currency: args.currency,
        direction: row.direction,
        label: row.label.slice(0, MAX_LABEL),
        source: "import" as const,
        externalId: row.externalId,
        importId: args.importId,
      });
      written += 1;
    }

    await ctx.db.patch(args.importId, { status: "applied" as const, appliedAt: Date.now() });

    // One activity row for the file, not one per transaction: an import of 200
    // rows is a single event, and 200 feed entries would bury the thing that
    // actually happened.
    if (written > 0) {
      await ctx.db.insert("activity", {
        spaceId,
        actor: "user",
        kind: "import.applied",
        objectId: file.sha256,
        at: Date.now(),
      });
    }

    return { ok: true as const, alreadyApplied: false as const, written, skipped };
  },
});

import { getAuthUserId } from "@convex-dev/auth/server";
import type { GenericMutationCtx } from "convex/server";
import { v } from "convex/values";

import { AREAS, areaBySlug, DEFAULT_AREA_SLUG, PROVIDERS } from "../lib/areas";
import {
  categoriseExpense,
  COUNTRIES,
  estimateTax,
  filingYearFor,
  readinessScore,
} from "../lib/tax";

import type { DataModel, Id } from "./_generated/dataModel";
import { requireUserId } from "./assistant";
import { type AreaSlug, type CountryCodeT, type ExpenseBucket, type ProviderSlug } from "./schema";

import { mutation, query } from "./_generated/server";
import { ensurePersonalSpace } from "./spaces";

const DAY_MS = 86_400_000;

/** Slug that always exists for every user, whether or not they added anything. */
const DEFAULT_AREA: AreaSlug = DEFAULT_AREA_SLUG;

/**
 * Ensures the default area row exists so ordering and filtering always have a
 * stable anchor. Called from any mutation that touches areas.
 */
async function ensureDefaultArea(
  ctx: GenericMutationCtx<DataModel>,
  userId: Id<"users">,
  spaceId: Id<"spaces">,
) {
  const existing = await ctx.db
    .query("areas")
    .withIndex("by_owner_slug", (q) => q.eq("ownerUserId", userId).eq("slug", DEFAULT_AREA))
    .first();
  if (existing) return;

  const def = areaBySlug(DEFAULT_AREA)!;
  await ctx.db.insert("areas", {
    ownerUserId: userId,
    spaceId,
    slug: def.slug as AreaSlug,
    label: def.label,
    order: 0,
    createdAt: Date.now(),
  });
}

// ---------------------------------------------------------------------------
// Life areas
// ---------------------------------------------------------------------------

export const listAreas = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const rows = await ctx.db
      .query("areas")
      .withIndex("by_owner", (q) => q.eq("ownerUserId", userId))
      .collect();

    return rows
      .sort((a, b) => a.order - b.order)
      .map((row) => {
        const def = areaBySlug(row.slug);
        return {
          slug: row.slug,
          label: row.label,
          kind: def?.kind ?? "tasks",
          accent: def?.accent ?? "card",
          blurb: def?.blurb ?? "",
        };
      });
  },
});

export const getAvailableAreas = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return AREAS;

    const rows = await ctx.db
      .query("areas")
      .withIndex("by_owner", (q) => q.eq("ownerUserId", userId))
      .collect();
    const enabled = new Set<string>(rows.map((r) => r.slug));

    return AREAS.filter((a) => !enabled.has(a.slug));
  },
});

/**
 * Narrows a caller-supplied slug to a catalogue value.
 *
 * Mutation *arguments* stay `v.string()` on purpose. The client legitimately
 * holds these slugs as plain strings (they come from the catalogue, typed as
 * `string`), and a Convex validator rejection at the boundary would surface to
 * the user as an opaque argument error. Checking here instead turns the same
 * mistake into "Unknown area" — and the storage column is still a closed union,
 * so nothing invalid can ever be written.
 */
function requireAreaSlug(slug: string): AreaSlug {
  const def = areaBySlug(slug);
  if (!def) throw new Error("Unknown area");
  return def.slug as AreaSlug;
}

const EXPENSE_BUCKETS = new Set<string>([
  "Software & subscriptions",
  "Equipment",
  "Home office",
  "Travel",
  "Meals",
  "Professional services",
  "Insurance",
  "Marketing",
  "Education & training",
  "Office supplies",
  "Uncategorised",
]);

function requireBucket(bucket: string): ExpenseBucket {
  if (!EXPENSE_BUCKETS.has(bucket)) throw new Error("Unknown expense category");
  return bucket as ExpenseBucket;
}

export const enableArea = mutation({
  args: { slug: v.string(), seed: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const spaceId = await ensurePersonalSpace(ctx, userId);
    await ensureDefaultArea(ctx, userId, spaceId);

    const slug = requireAreaSlug(args.slug);
    const def = areaBySlug(slug)!;

    const existing = await ctx.db
      .query("areas")
      .withIndex("by_owner_order", (q) => q.eq("ownerUserId", userId))
      .collect();
    if (existing.some((a) => a.slug === slug)) return;

    await ctx.db.insert("areas", {
      ownerUserId: userId,
      spaceId,
      slug: def.slug as AreaSlug,
      label: def.label,
      order: existing.length,
      createdAt: Date.now(),
    });

    // Optional starter tasks — off by default so enabling an area is instant
    // and the user decides whether they want the sample content.
    if (args.seed && def.starterTasks?.length) {
      for (const title of def.starterTasks) {
        await ctx.db.insert("tasks", {
          ownerUserId: userId,
          spaceId,
          title,
          completed: false,
          priority: 1,
          dueAt: null,
          createdAt: Date.now(),
          completedAt: null,
          tags: [],
          recurrence: null,
          area: def.slug as AreaSlug,
        });
      }
    }
  },
});

export const disableArea = mutation({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const slug = requireAreaSlug(args.slug);
    if (slug === DEFAULT_AREA) throw new Error("The General area can't be removed");

    const target = await ctx.db
      .query("areas")
      .withIndex("by_owner_slug", (q) => q.eq("ownerUserId", userId).eq("slug", slug))
      .first();
    if (!target) return;

    await ctx.db.delete(target._id);

    // Re-home the area's tasks into General rather than deleting user data.
    const orphaned = await ctx.db
      .query("tasks")
      .withIndex("by_owner_area", (q) => q.eq("ownerUserId", userId).eq("area", slug))
      .collect();
    for (const task of orphaned) {
      await ctx.db.patch(task._id, { area: DEFAULT_AREA });
    }
  },
});

// ---------------------------------------------------------------------------
// Finance / tax
// ---------------------------------------------------------------------------

export const getFinance = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const now = new Date();
    // January through April is filing the previous year. Shared with
    // `saveTaxProfile` so the two can never diverge (defect N8).
    const filingYear = filingYearFor(now);

    const [profile, expenses, gathered] = await Promise.all([
      ctx.db
        .query("taxProfile")
        .withIndex("by_owner", (q) => q.eq("ownerUserId", userId))
        .unique()
        .catch(() => null),
      ctx.db
        .query("expenses")
        .withIndex("by_owner", (q) => q.eq("ownerUserId", userId))
        .collect(),
      ctx.db
        .query("taxDocuments")
        .withIndex("by_owner", (q) => q.eq("ownerUserId", userId))
        .collect(),
    ]);

    const countryCode = (profile?.country ?? "US") as keyof typeof COUNTRIES;
    const country = COUNTRIES[countryCode] ?? COUNTRIES.US;
    const taxYear = profile?.taxYear ?? filingYear;

    const yearExpenses = expenses.filter((e) => new Date(e.spentAt).getFullYear() === taxYear);
    const estimate = estimateTax({
      country: country.code,
      taxYear,
      grossIncome: profile?.grossIncome ?? 0,
      expenses: yearExpenses.map((e) => ({
        label: e.label,
        amount: e.amount,
        deductible: e.deductible,
      })),
      businessMiles: profile?.businessMiles ?? 0,
      charitableMiles: profile?.charitableMiles ?? 0,
      homeOfficeSqFt: profile?.homeOfficeSqFt ?? 0,
      donations: profile?.donations ?? 0,
    });

    const gatheredIds = new Set(gathered.map((g) => g.requirementId));
    const readiness = readinessScore(country.documents, gatheredIds);

    // Group upcoming deadlines, flagging anything overdue or inside 30 days.
    const deadlines = country.deadlines(taxYear).map((d) => {
      let daysAway: number | null = null;
      let state: "upcoming" | "urgent" | "passed" | "none" = "upcoming";
      if (d.date) {
        const t = new Date(`${d.date}T23:59:59`);
        daysAway = Math.round((t.getTime() - now.getTime()) / DAY_MS);
        state = daysAway < 0 ? "passed" : daysAway <= 30 ? "urgent" : "upcoming";
      } else {
        state = "none";
      }
      return {
        id: d.id,
        label: d.label,
        date: d.date,
        note: d.note,
        penalty: d.penalty,
        source: d.source,
        daysAway,
        state,
      };
    });

    const byBucket = new Map<string, { bucket: string; amount: number; count: number }>();
    for (const e of yearExpenses.filter((x) => x.deductible)) {
      const cur = byBucket.get(e.bucket) ?? { bucket: e.bucket, amount: 0, count: 0 };
      cur.amount += e.amount;
      cur.count += 1;
      byBucket.set(e.bucket, cur);
    }

    // `Country` carries two function properties (`taxYearLabel`, `deadlines`).
    // Returning the catalogue entry itself would hand Convex a function to
    // serialise, which it cannot do — the whole query would throw and the
    // Finance area would render an error instead of the user's figures. So the
    // country is projected down to its scalar fields, and the two computed
    // values are resolved here rather than shipped.
    const countrySummary = {
      code: country.code,
      name: country.name,
      currencySymbol: country.currencySymbol,
      authority: country.authority,
      authorityUrl: country.authorityUrl,
    };

    return {
      country: countrySummary,
      countries: Object.values(COUNTRIES).map((c) => ({
        code: c.code, name: c.name, currencySymbol: c.currencySymbol,
      })),
      taxYear,
      taxYearLabel: country.taxYearLabel(taxYear),
      profile: {
        grossIncome: profile?.grossIncome ?? 0,
        businessMiles: profile?.businessMiles ?? 0,
        charitableMiles: profile?.charitableMiles ?? 0,
        homeOfficeSqFt: profile?.homeOfficeSqFt ?? 0,
        donations: profile?.donations ?? 0,
      },
      estimate,
      readiness,
      deadlines,
      documents: country.documents.map((d) => ({
        id: d.id,
        label: d.label,
        detail: d.detail,
        for: d.for,
        conditional: d.conditional === true,
        gathered: gatheredIds.has(d.id),
      })),
      expenses: yearExpenses.sort((a, b) => b.spentAt - a.spentAt),
      buckets: [...byBucket.values()].sort((a, b) => b.amount - a.amount),
    };
  },
});

export const saveTaxProfile = mutation({
  args: {
    country: v.string(),
    grossIncome: v.number(),
    businessMiles: v.optional(v.number()),
    charitableMiles: v.optional(v.number()),
    homeOfficeSqFt: v.optional(v.number()),
    donations: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const country = COUNTRIES[args.country as CountryCodeT];
    if (!country) throw new Error("Unsupported country");
    if (args.grossIncome < 0) throw new Error("Income cannot be negative");
    const spaceId = await ensurePersonalSpace(ctx, userId);

    const now = new Date();
    const taxYear = filingYearFor(now);

    const existing = await ctx.db
      .query("taxProfile")
      .withIndex("by_owner", (q) => q.eq("ownerUserId", userId))
      .unique();

    const row = {
      country: args.country as CountryCodeT,
      taxYear,
      grossIncome: args.grossIncome,
      businessMiles: args.businessMiles ?? 0,
      charitableMiles: args.charitableMiles ?? 0,
      homeOfficeSqFt: args.homeOfficeSqFt ?? 0,
      donations: args.donations ?? 0,
      updatedAt: Date.now(),
    };

    if (existing) await ctx.db.patch(existing._id, row);
    else await ctx.db.insert("taxProfile", { ownerUserId: userId, spaceId, ...row });
  },
});

/**
 * Logs an expense and auto-categorises it.
 *
 * The categoriser is a keyword rule set, so it deliberately errs toward
 * `low` confidence and leaves the judgement to the user.
 */
export const addExpense = mutation({
  args: {
    label: v.string(),
    amount: v.number(),
    spentAt: v.optional(v.number()),
    deductible: v.optional(v.boolean()),
    bucket: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const label = args.label.trim();
    if (!label) throw new Error("Expense needs a description");
    if (args.amount <= 0) throw new Error("Amount must be greater than zero");
    const spaceId = await ensurePersonalSpace(ctx, userId);

    const guess = categoriseExpense(label);
    const bucket = args.bucket ? requireBucket(args.bucket) : (guess.bucket as ExpenseBucket);

    await ctx.db.insert("expenses", {
      ownerUserId: userId,
      spaceId,
      label,
      amount: args.amount,
      bucket,
      deductible: args.deductible ?? guess.likelyDeductible,
      confidence: guess.confidence,
      spentAt: args.spentAt ?? Date.now(),
      source: "manual",
      createdAt: Date.now(),
    });

    return guess;
  },
});

export const setExpenseDeductible = mutation({
  args: { id: v.id("expenses"), deductible: v.boolean() },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const row = await ctx.db.get(args.id);
    if (!row || row.ownerUserId !== userId) throw new Error("Expense not found");
    // User overrides are trusted and stop being flagged as a guess.
    await ctx.db.patch(args.id, { deductible: args.deductible, confidence: "confirmed" });
  },
});

export const removeExpense = mutation({
  args: { id: v.id("expenses") },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const row = await ctx.db.get(args.id);
    if (!row || row.ownerUserId !== userId) throw new Error("Expense not found");
    await ctx.db.delete(args.id);
  },
});

export const toggleDocument = mutation({
  args: { requirementId: v.string(), gathered: v.boolean() },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const existing = await ctx.db
      .query("taxDocuments")
      .withIndex("by_owner_requirement", (q) =>
        q.eq("ownerUserId", userId).eq("requirementId", args.requirementId),
      )
      .first();

    if (args.gathered && !existing) {
      const spaceId = await ensurePersonalSpace(ctx, userId);
      await ctx.db.insert("taxDocuments", {
        ownerUserId: userId, spaceId, requirementId: args.requirementId, gatheredAt: Date.now(),
      });
    } else if (!args.gathered && existing) {
      await ctx.db.delete(existing._id);
    }
  },
});

// ---------------------------------------------------------------------------
// Connections
// ---------------------------------------------------------------------------

export const listConnections = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return { connected: [], providers: PROVIDERS.map((p) => ({ ...p, connected: false })) };
    }

    const rows = await ctx.db
      .query("connections")
      .withIndex("by_owner", (q) => q.eq("ownerUserId", userId))
      .collect();

    const connectedByProvider = new Set<string>(rows.map((r) => r.provider));
    return {
      connected: rows,
      providers: PROVIDERS.map((p) => ({ ...p, connected: connectedByProvider.has(p.slug) })),

    };
  },
});

/**
 * Starts a connection.
 *
 * For providers whose OAuth handshake is not implemented yet this records the
 * user's intent explicitly as `pending-credentials` rather than pretending the
 * link is live. Nothing here silently reports success.
 */
export const connectTool = mutation({
  args: { provider: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const provider = PROVIDERS.find((p) => p.slug === args.provider);
    if (!provider) throw new Error("Unknown provider");
    const providerSlug = provider.slug as ProviderSlug;
    const spaceId = await ensurePersonalSpace(ctx, userId);

    const rows = await ctx.db
      .query("connections")
      .withIndex("by_owner_provider", (q) =>
        q.eq("ownerUserId", userId).eq("provider", providerSlug),
      )
      .first();
    if (rows) return;

    const status =
      provider.status === "available"
        ? "pending-credentials"
        : "coming-soon";

    await ctx.db.insert("connections", {
      ownerUserId: userId,
      spaceId,
      provider: providerSlug,
      label: provider.label,
      status,
      connectedAt: Date.now(),
    });
  },
});

export const disconnectTool = mutation({
  args: { provider: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const provider = PROVIDERS.find((p) => p.slug === args.provider);
    if (!provider) throw new Error("Unknown provider");

    const row = await ctx.db
      .query("connections")
      .withIndex("by_owner_provider", (q) =>
        q.eq("ownerUserId", userId).eq("provider", provider.slug as ProviderSlug),
      )
      .first();
    if (row) await ctx.db.delete(row._id);
  },
});

// ---------------------------------------------------------------------------
// Area-scoped task helpers
// ---------------------------------------------------------------------------

export const setTaskArea = mutation({
  args: { id: v.id("tasks"), area: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const task = await ctx.db.get(args.id);
    if (!task || task.ownerUserId !== userId) throw new Error("Task not found");
    const area = args.area ? requireAreaSlug(args.area) : DEFAULT_AREA;
    await ctx.db.patch(args.id, { area });
  },
});

export const getAreaTasks = query({
  args: { area: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const area = requireAreaSlug(args.area);

    return await ctx.db
      .query("tasks")
      .withIndex("by_owner_area", (q) => q.eq("ownerUserId", userId).eq("area", area))
      .collect();
  },
});
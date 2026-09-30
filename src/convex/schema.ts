import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { Infer, v } from "convex/values";

// default user roles. can add / remove based on the project as needed
export const ROLES = {
  ADMIN: "admin",
  USER: "user",
  MEMBER: "member",
} as const;

export const roleValidator = v.union(
  v.literal(ROLES.ADMIN),
  v.literal(ROLES.USER),
  v.literal(ROLES.MEMBER),
);
export type Role = Infer<typeof roleValidator>;

const schema = defineSchema(
  {
    // default auth tables using convex auth.
    ...authTables, // do not remove or modify

    // the users table is the default users table that is brought in by the authTables
    users: defineTable({
      name: v.optional(v.string()), // name of the user. do not remove
      image: v.optional(v.string()), // image of the user. do not remove
      email: v.optional(v.string()), // email of the user. do not remove
      emailVerificationTime: v.optional(v.number()), // email verification time. do not remove
      isAnonymous: v.optional(v.boolean()), // is the user anonymous. do not remove

      role: v.optional(roleValidator), // role of the user. do not remove
    }).index("email", ["email"]), // index for the email. do not remove or modify

    /** A single dashboard task, owned by exactly one user. */
    tasks: defineTable({
      userId: v.id("users"),
      title: v.string(),
      completed: v.boolean(),
      /** 0 = now (default), 1..3 = pinned to the top of the active list. */
      priority: v.number(),
      /** Epoch ms this task is scheduled for; null means "someday". */
      dueAt: v.optional(v.union(v.null(), v.number())),
      createdAt: v.number(),
      completedAt: v.optional(v.union(v.null(), v.number())),

      // ---- assistant fields (see src/lib/nlp.ts and src/lib/scorer.ts) ----
      /** `#tags` parsed out of the input. */
      tags: v.optional(v.array(v.string())),
      /** Normalised recurrence rule, e.g. "daily", "weekly:monday". */
      recurrence: v.optional(v.union(v.null(), v.string())),
      /** Feature vector captured when the task was resolved, used to train. */
      featuresAtCompletion: v.optional(v.array(v.number())),

      /** Life area this task belongs to; "general" is the built-in default. */
      area: v.optional(v.string()),
    })
      .index("by_user", ["userId"])
      .index("by_user_created", ["userId", "createdAt"]),

    /** A short free-form note pinned to the dashboard. */
    notes: defineTable({
      userId: v.id("users"),
      body: v.string(),
      createdAt: v.number(),
    }).index("by_user", ["userId"]),

    /**
     * The user's trained model: a logistic-regression weight vector learned
     * from their own completion history, plus rolled-up behaviour counters.
     * One row per user, upserted as they complete and delete tasks.
     */
    assistantState: defineTable({
      userId: v.id("users"),
      weights: v.array(v.number()),
      /** Completion count per 6-hour bucket. */
      byHour: v.array(v.number()),
      /** Completion count per weekday (0 = Sunday). */
      byWeekday: v.array(v.number()),
      /** Completion counts keyed by tag. */
      byTag: v.record(v.string(), v.object({ done: v.number(), total: v.number() })),
      shortDone: v.number(),
      shortTotal: v.number(),
      longDone: v.number(),
      longTotal: v.number(),
      /** Total labelled events seen so far — drives the "still learning" hint. */
      samples: v.number(),
      updatedAt: v.number(),
    }).index("by_user", ["userId"]),

    // ---------- life areas -------------------------------------------------

    /**
     * One row per life area the user has switched on. `order` drives the tab
     * strip; areas are created on first enable rather than seeded for
     * everyone so nobody carries tabs they don't care about.
     */
    areas: defineTable({
      userId: v.id("users"),
      slug: v.string(),
      /** Display name — defaults to the catalogue label but stays editable. */
      label: v.string(),
      order: v.number(),
      createdAt: v.number(),
    })
      .index("by_user", ["userId"])
      .index("by_user_order", ["userId", "order"]),

    // ---------- finance ----------------------------------------------------

    /** Tax profile: country, year, income figures for the estimate. */
    taxProfile: defineTable({
      userId: v.id("users"),
      country: v.string(),
      taxYear: v.number(),
      grossIncome: v.number(),
      businessMiles: v.optional(v.number()),
      charitableMiles: v.optional(v.number()),
      homeOfficeSqFt: v.optional(v.number()),
      donations: v.optional(v.number()),
      updatedAt: v.number(),
    }).index("by_user", ["userId"]),

    /** A deductible expense the user logged by hand or imported. */
    expenses: defineTable({
      userId: v.id("users"),
      label: v.string(),
      amount: v.number(),
      bucket: v.string(),
      deductible: v.boolean(),
      /** How confident the categoriser was — drives the "check this" flag. */
      confidence: v.string(),
      /** Expense date, used for the tax-year filter. */
      spentAt: v.number(),
      source: v.string(),
      createdAt: v.number(),
    }).index("by_user", ["userId"]),

    /** Which filing documents the user has gathered. */
    taxDocuments: defineTable({
      userId: v.id("users"),
      /** Requirement id from the country's catalogue. */
      requirementId: v.string(),
      gatheredAt: v.number(),
    }).index("by_user", ["userId"]),

    // ---------- integrations ----------------------------------------------

    /**
     * A tool the user has connected. `credentials` holds the token supplied by
     * the provider's own OAuth flow; it never leaves the server.
     */
    connections: defineTable({
      userId: v.id("users"),
      /** Catalogue slug, e.g. "google-calendar". */
      provider: v.string(),
      label: v.string(),
      status: v.string(),
      /** Display identity returned by the provider (email, handle, org). */
      accountHint: v.optional(v.string()),
      scopes: v.optional(v.array(v.string())),
      connectedAt: v.number(),
      lastSyncedAt: v.optional(v.number()),
    }).index("by_user", ["userId"]),
  },
  {
    schemaValidation: false,
  },
);

export default schema;
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

/**
 * Closed vocabularies (ADR-008, §3.4, MAIN_AGENT S1).
 *
 * An unrecognised value is a *type error*, not a runtime surprise. These are
 * unions rather than bare strings precisely so that a typo cannot become data.
 */

/** Access levels. Ordered by strength; comparison uses rank, not string order. */
export const ACCESS_LEVELS = ["view", "comment", "edit", "manage"] as const;
export const accessLevelValidator = v.union(
  v.literal("view"),
  v.literal("comment"),
  v.literal("edit"),
  v.literal("manage"),
);
export type AccessLevel = Infer<typeof accessLevelValidator>;

/** Object kinds that may appear as the subject of a link. */
export const OBJECT_KINDS = [
  "task",
  "note",
  "person",
  "commitment",
  "document",
  "expense",
  "taxProfile",
  "taxDocument",
  "calendarEvent",
  "area",
  "connection",
] as const;
export const objectKindValidator = v.union(
  v.literal("task"),
  v.literal("note"),
  v.literal("person"),
  v.literal("commitment"),
  v.literal("document"),
  v.literal("expense"),
  v.literal("taxProfile"),
  v.literal("taxDocument"),
  v.literal("calendarEvent"),
  v.literal("area"),
  v.literal("connection"),
);
export type ObjectKind = Infer<typeof objectKindValidator>;

/**
 * Relationship vocabulary (ADR-008). Closed by design: `links` holds
 * relationships only, and any attribute that needs to be *queried by* belongs on
 * an entity as a typed indexed column instead.
 */
export const LINK_RELS = [
  "blocks",
  "relatesTo",
  "partOf",
  "assignedTo",
  "waitingOn",
  "owedBy",
  "occursBefore",
  "occursAfter",
  "fundedBy",
  "evidencedBy",
  "concerns",
  "supersedes",
] as const;
export const linkRelValidator = v.union(
  v.literal("blocks"),
  v.literal("relatesTo"),
  v.literal("partOf"),
  v.literal("assignedTo"),
  v.literal("waitingOn"),
  v.literal("owedBy"),
  v.literal("occursBefore"),
  v.literal("occursAfter"),
  v.literal("fundedBy"),
  v.literal("evidencedBy"),
  v.literal("concerns"),
  v.literal("supersedes"),
);
export type LinkRel = Infer<typeof linkRelValidator>;

/**
 * Activity taxonomy (§3.4). Closed: unknown kinds are a type error.
 * `meta` is scalar values only and is explicitly NOT a schema.
 */
export const ACTIVITY_KINDS = [
  "task.created",
  "task.completed",
  "task.deleted",
  "note.created",
  "expense.added",
  "capture.committed",
  "person.created",
  "commitment.made",
  "attention.acted",
  "attention.dismissed",
  "attention.snoozed",
  "attention.rejected",
  "sync.started",
  "sync.completed",
  "sync.failed",
  "sync.objects_upserted",
  "connection.connected",
  "connection.revoked",
  "area.enabled",
  "area.disabled",
  "model.reset",
  "model.rolled_back",
  "model.paused",
  "account.deletion_requested",
  "agent.proposed",
  "agent.executed",
  "agent.skipped",
] as const;
export const activityKindValidator = v.union(
  v.literal("task.created"),
  v.literal("task.completed"),
  v.literal("task.deleted"),
  v.literal("note.created"),
  v.literal("expense.added"),
  v.literal("capture.committed"),
  v.literal("person.created"),
  v.literal("commitment.made"),
  v.literal("attention.acted"),
  v.literal("attention.dismissed"),
  v.literal("attention.snoozed"),
  v.literal("attention.rejected"),
  v.literal("sync.started"),
  v.literal("sync.completed"),
  v.literal("sync.failed"),
  v.literal("sync.objects_upserted"),
  v.literal("connection.connected"),
  v.literal("connection.revoked"),
  v.literal("area.enabled"),
  v.literal("area.disabled"),
  v.literal("model.reset"),
  v.literal("model.rolled_back"),
  v.literal("model.paused"),
  v.literal("account.deletion_requested"),
  v.literal("agent.proposed"),
  v.literal("agent.executed"),
  v.literal("agent.skipped"),
);
export type ActivityKind = Infer<typeof activityKindValidator>;

export const ACTIVITY_ACTORS = ["user", "sync", "system", "agent"] as const;
export const activityActorValidator = v.union(
  v.literal("user"),
  v.literal("sync"),
  v.literal("system"),
  v.literal("agent"),
);
export type ActivityActor = Infer<typeof activityActorValidator>;

/**
 * Scalar-only metadata (ADR-008). Explicitly capped: no objects, no arrays, no
 * nesting. A richer meta is how a generic links table quietly becomes a second
 * database, which is the failure mode ADR-008 exists to prevent.
 */
export const scalarMetaValidator = v.record(
  v.string(),
  v.union(v.string(), v.number(), v.boolean()),
);

// ---------------------------------------------------------------------------
// Phase 0C — enum-ish vocabularies (defect N7).
//
// Every value below was a bare `v.string()` or `v.number()`. A closed union
// turns a typo into a type error at the call site and a rejected write at
// runtime, which is the whole point: "Undefined is not a plan" is cheap to say
// and only real if the storage layer enforces it.
//
// Each list is asserted against its source of truth in
// `src/lib/schema-vocab.test.ts`, so a catalogue gaining a value without a
// matching schema change fails the suite rather than silently rejecting writes.
// ---------------------------------------------------------------------------

/** Matches `Priority` in src/lib/nlp.ts: 0 = NOW, 1 = SOON, 2 = LATER. */
export const priorityValidator = v.union(v.literal(0), v.literal(1), v.literal(2));

/** The life-area catalogue in src/lib/areas.ts. */
export const areaSlugValidator = v.union(
  v.literal("general"),
  v.literal("finance"),
  v.literal("relationships"),
  v.literal("health"),
  v.literal("home"),
);

/** The provider catalogue in src/lib/areas.ts. */
export const providerSlugValidator = v.union(
  v.literal("google-calendar"),
  v.literal("outlook-calendar"),
  v.literal("nylas"),
  v.literal("plaid"),
  v.literal("github"),
  v.literal("linear"),
  v.literal("notion"),
  v.literal("google-drive"),
  v.literal("strava"),
);

/** Connection lifecycle states. `connected` and `revoked` arrive in phase 1.5. */
export const connectionStatusValidator = v.union(
  v.literal("pending-credentials"),
  v.literal("coming-soon"),
  v.literal("connected"),
  v.literal("error"),
  v.literal("revoked"),
);

/** Countries the tax engine actually implements. */
export const countryCodeValidator = v.union(
  v.literal("US"),
  v.literal("UK"),
  v.literal("IN"),
  v.literal("CA"),
  v.literal("AU"),
);

/** Expense buckets produced by the categoriser, plus the explicit fallback. */
export const expenseBucketValidator = v.union(
  v.literal("Software & subscriptions"),
  v.literal("Equipment"),
  v.literal("Home office"),
  v.literal("Travel"),
  v.literal("Meals"),
  v.literal("Professional services"),
  v.literal("Insurance"),
  v.literal("Marketing"),
  v.literal("Education & training"),
  v.literal("Office supplies"),
  v.literal("Uncategorised"),
);

/** How much to trust a categorisation. `confirmed` means the user said so. */
export const confidenceValidator = v.union(
  v.literal("high"),
  v.literal("medium"),
  v.literal("low"),
  v.literal("confirmed"),
);

/**
 * Per-user feature switches.
 *
 * Each one exists because a named phase needs an off-switch: if generalised
 * ranking misbehaves for someone, they turn it off without losing their data or
 * waiting for a release. Closed, so a typo cannot create a flag that nothing
 * ever reads.
 */
export const featureFlagValidator = v.union(
  v.literal("generalisedRanking"),
  v.literal("exploration"),
  v.literal("attentionGrouping"),
);

/** Why a model snapshot was taken. */
export const snapshotReasonValidator = v.union(
  v.literal("manual"),
  v.literal("automatic"),
  v.literal("rollback"),
);

// Inferred forms, so a Convex function can annotate its own signatures with
// exactly the vocabulary its storage enforces. This is the single source of
// truth for the backend; `src/lib/schema-vocab.test.ts` asserts it still
// matches the catalogues it was derived from.
export type AreaSlug = Infer<typeof areaSlugValidator>;
export type ProviderSlug = Infer<typeof providerSlugValidator>;
export type CountryCodeT = Infer<typeof countryCodeValidator>;
export type ExpenseBucket = Infer<typeof expenseBucketValidator>;
export type ExpenseConfidence = Infer<typeof confidenceValidator>;
export type ConnectionStatus = Infer<typeof connectionStatusValidator>;
export type FeatureFlag = Infer<typeof featureFlagValidator>;
export type Priority = 0 | 1 | 2;

/** Object visibility: `private` (owner only) or `space` (whole home space). */
export const visibilityValidator = v.union(v.literal("private"), v.literal("space"));
export type Visibility = Infer<typeof visibilityValidator>;

/**
 * Object kinds that are owner-only and are excluded from *every* grant scope
 * check (§4.3). The learned model, its snapshots and attention feedback are
 * behavioural fingerprints; they are never shared, not even to a space member.
 */
export const NEVER_SHARED_KINDS = [
  "assistantState",
  "modelSnapshots",
  "attentionState",
] as const;

const ownedBy = {
  /** ADR-009: who the object belongs to. Never changed by sharing. */
  ownerUserId: v.id("users"),
  /** ADR-009: the one space this object lives in. */
  spaceId: v.id("spaces"),
};

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

    // ---------- ownership and access (ADR-009, §4) --------------------------

    /**
     * A container objects live in. Personal, family, work.
     * Deliberately has **no owner column** — membership is many-to-many via
     * `spaceMembers`, so a space outlives any single member.
     */
    spaces: defineTable({
      name: v.string(),
      kind: v.union(
        v.literal("personal"),
        v.literal("family"),
        v.literal("work"),
        v.literal("custom"),
      ),
      /** Exactly one personal space exists per user; it is never deletable. */
      isPersonal: v.boolean(),
      createdBy: v.id("users"),
      createdAt: v.number(),
      archivedAt: v.optional(v.number()),
      /**
       * Set once this user's pre-0B rows have been normalised. Unset means
       * "still to do", and every write path heals it — see
       * `ensurePersonalSpace` in src/convex/spaces.ts.
       */
      migratedAt: v.optional(v.number()),
    }).index("by_createdBy", ["createdBy"]),

    /** Which spaces a user belongs to, and their baseline role in each. */
    spaceMembers: defineTable({
      spaceId: v.id("spaces"),
      userId: v.id("users"),
      role: accessLevelValidator,
      joinedAt: v.number(),
    })
      .index("by_space", ["spaceId"])
      .index("by_user", ["userId"]),

    /**
     * A narrow, optional, **expirable** exception that lets a named user reach
     * a space they are not a member of (§4.4).
     *
     * Grants fail closed: an absent `scopeKinds` means those kinds are
     * *excluded*, not that everything is included.
     */
    grants: defineTable({
      spaceId: v.id("spaces"),
      granteeUserId: v.id("users"),
      level: accessLevelValidator,
      scopeKinds: v.optional(v.array(objectKindValidator)),
      scopeAreas: v.optional(v.array(v.string())),
      scopeObjectIds: v.optional(v.array(v.string())),
      grantedBy: v.id("users"),
      grantedAt: v.number(),
      expiresAt: v.optional(v.number()),
      revokedAt: v.optional(v.number()),
    })
      .index("by_space", ["spaceId"])
      .index("by_grantee", ["granteeUserId"]),

    /**
     * Who opened what, when, and by which path (MAINAGENT S8: every access is
     * attributable). Append-only.
     */
    accessLog: defineTable({
      spaceId: v.id("spaces"),
      viewerUserId: v.id("users"),
      objectKind: objectKindValidator,
      objectId: v.string(),
      via: v.union(v.literal("membership"), v.literal("grant")),
      at: v.number(),
    })
      .index("by_space_at", ["spaceId", "at"])
      .index("by_viewer", ["viewerUserId"]),

    /**
     * Relationships between objects (ADR-008). A closed `LinkRel` vocabulary
     * with direction, provenance, confidence and visibility. Domain attributes
     * stay on the entity tables.
     */
    links: defineTable({
      spaceId: v.id("spaces"),
      fromKind: objectKindValidator,
      fromId: v.string(),
      rel: linkRelValidator,
      toKind: objectKindValidator,
      toId: v.string(),
      direction: v.union(v.literal("out"), v.literal("in")),
      provenance: v.optional(v.string()),
      confidence: v.optional(v.number()),
      visibility: v.optional(visibilityValidator),
      validFrom: v.optional(v.number()),
      validTo: v.optional(v.optional(v.number())),
      /** Scalar values only, capped. Never a nested document. */
      meta: v.optional(scalarMetaValidator),
    })
      .index("by_space", ["spaceId"])
      .index("by_from", ["fromKind", "fromId"])
      .index("by_to", ["toKind", "toId"]),

    /**
     * Append-only history with a closed taxonomy (§3.4). Powers the activity
     * timeline and gives every agent run an auditable record.
     */
    activity: defineTable({
      spaceId: v.id("spaces"),
      actor: activityActorValidator,
      kind: activityKindValidator,
      actorId: v.optional(v.string()),
      objectKind: v.optional(objectKindValidator),
      objectId: v.optional(v.string()),
      meta: v.optional(scalarMetaValidator),
      /** Deterministic key; a repeat insert is absorbed, never duplicated. */
      idempotencyKey: v.optional(v.string()),
      at: v.number(),
    })
      .index("by_space_at", ["spaceId", "at"])
      .index("by_key", ["idempotencyKey"]),

    // ---------- product objects -------------------------------------------

    /** A single dashboard task, owned by exactly one user. */
    tasks: defineTable({
      ...ownedBy,
      title: v.string(),
      completed: v.boolean(),
      /** 0 = NOW (default), 1 = SOON, 2 = LATER. Matches `Priority` in src/lib/nlp.ts. */
      priority: priorityValidator,
      /** Epoch ms this task is scheduled for; null means "someday". */
      dueAt: v.optional(v.union(v.null(), v.number())),
      createdAt: v.number(),
      completedAt: v.optional(v.union(v.null(), v.number())),

      // ---- assistant fields (see src/lib/nlp.ts and src/lib/scorer.ts) ----
      /** `#tags` parsed out of the input. */
      tags: v.optional(v.array(v.string())),
      /**
       * Normalised recurrence rule.
       *
       * The grammar is `daily` | `weekly` | `monthly` | `weekly:<weekday>` |
       * `every:<n>:day` | `every:<n>:week`, and only `src/lib/nlp.ts` ever
       * writes it. This is the one enum-ish field that stays a string, because
       * the parameterised forms cannot be written as a Convex literal union;
       * the grammar is enforced at the single write path instead of being
       * merely documented. See `recurrenceGrammar.test.ts`.
       */
      recurrence: v.optional(v.union(v.null(), v.string())),
      /** Feature vector captured when the task was resolved, used to train. */
      featuresAtCompletion: v.optional(v.array(v.number())),

      /**
       * Life area this task belongs to; "general" is the built-in default.
       *
       * Required, not optional: area filtering is an index range, and a row
       * with no area would fall out of every range and become invisible to
       * the area views. Pre-0B rows are normalised by the ownership backfill.
       */
      area: areaSlugValidator,

      /** Where this row came from. Panel-created rows are the only ones we may
       *  ever write back upstream (ADR-013). */
      origin: v.optional(
        v.union(v.literal("panel"), v.literal("import"), v.literal("integration")),
      ),
      /** Set when an upstream source this row came from disappeared. */
      orphanedSource: v.optional(v.boolean()),
      sourceDisconnected: v.optional(v.boolean()),
    })
      .index("by_space", ["spaceId"])
      .index("by_owner", ["ownerUserId"])
      .index("by_owner_created", ["ownerUserId", "createdAt"])
      // Phase 0B query-idiom fix: area filtering happens in the index, not in
      // JavaScript after a full collect.
      .index("by_owner_area", ["ownerUserId", "area"]),

    /** A short free-form note pinned to the dashboard. */
    notes: defineTable({
      ...ownedBy,
      /** Private by default (§4.3): a note is shareable only via an explicit grant. */
      visibility: v.optional(visibilityValidator),
      area: v.optional(v.string()),
      tags: v.optional(v.array(v.string())),
      body: v.string(),
      createdAt: v.number(),
    })
      .index("by_space", ["spaceId"])
      .index("by_owner", ["ownerUserId"]),

    /**
     * The user's trained model: a logistic-regression weight vector learned
     * from their own completion history, plus rolled-up behaviour counters.
     * One row per user. **Owner-only forever** (§4.3) — this is a behavioural
     * fingerprint and is excluded from every grant scope check.
     */
    assistantState: defineTable({
      ...ownedBy,
      weights: v.array(v.number()),
      /** Feature layout version. Bumped whenever indices 0–7 change (ADR-010). */
      weightsVersion: v.optional(v.number()),
      /** Increments on every snapshot. */
      modelVersion: v.optional(v.number()),
      /** User toggle. Hard rules are unaffected by pausing learning. */
      learningPaused: v.optional(v.boolean()),
      /** Completion count per 6-hour bucket. */
      byHour: v.array(v.number()),
      /** Completion count per weekday (0 = Sunday). */
      byWeekday: v.array(v.number()),
      /** Completion counts keyed by tag. */
      byTag: v.record(v.string(), v.object({ done: v.number(), total: v.number() })),
      /**
       * Phase 1.1 counters for the appended features 8–11.
       *
       * Optional rather than required so every row written before 1.1 stays
       * valid and **no data migration is needed** — `extractFeatures` reads an
       * absent counter exactly as it reads a zero one: no evidence, feature 0.
       */
      byArea: v.optional(v.record(v.string(), v.object({ done: v.number(), total: v.number() }))),
      bySource: v.optional(v.record(v.string(), v.object({ done: v.number(), total: v.number() }))),
      byPerson: v.optional(v.record(v.string(), v.object({ done: v.number(), total: v.number() }))),
      byDueBucket: v.optional(v.record(v.string(), v.object({ done: v.number(), total: v.number() }))),
      /**
       * Explicit, user-authored category suppression (RJD-006, §5.5.5).
       *
       * Written **only** by an explicit "not for me". There is deliberately no
       * negative category *feature*: if suppression could be learned it would
       * be learned from habit, and habit is not a decision. Capped at
       * `MAX_SUPPRESSION_ENTRIES` because an unbounded set written from a
       * mutation is an unbounded row.
       */
      suppressedKinds: v.optional(v.array(v.string())),
      suppressedAreas: v.optional(v.array(v.string())),
      shortDone: v.number(),
      shortTotal: v.number(),
      longDone: v.number(),
      longTotal: v.number(),
      /** Total labelled events seen so far — drives the "still learning" hint. */
      samples: v.number(),
      updatedAt: v.number(),
    })
      .index("by_space", ["spaceId"])
      .index("by_owner", ["ownerUserId"]),

    /**
     * A point-in-time copy of the weight vector, so a bad model is a
     * one-click undo rather than a lost week of learning.
     *
     * The vector is stored whole and verbatim. Restoring is a byte-for-byte
     * assignment, never a re-derivation, so a snapshot always restores the
     * model that was actually in use. At most 10 are kept per user; pruning
     * the oldest is the only thing that ever deletes a row here.
     */
    modelSnapshots: defineTable({
      ...ownedBy,
      weights: v.array(v.number()),
      /** Layout the snapshot was taken under, so a restore knows how to align. */
      weightsVersion: v.number(),
      modelVersion: v.number(),
      samples: v.number(),
      reason: snapshotReasonValidator,
      createdAt: v.number(),
    })
      .index("by_space", ["spaceId"])
      .index("by_owner_modelVersion", ["ownerUserId", "modelVersion"]),

    /**
     * Per-user feature switches. See `featureFlagValidator` for why each flag
     * needs an off-switch. Owner-only, like the model it governs.
     */
    featureFlags: defineTable({
      ...ownedBy,
      key: featureFlagValidator,
      enabled: v.boolean(),
      updatedAt: v.number(),
    })
      .index("by_space", ["spaceId"])
      .index("by_owner", ["ownerUserId"])
      .index("by_owner_key", ["ownerUserId", "key"]),

    /**
     * Feedback about one attention item (§3.5).
     *
     * Attention itself is **computed, never stored** (ADR-003) — this table
     * holds only what the user *did* about an item. There is deliberately no
     * impressions table: being shown something forty times is not a signal
     * (ADR-004, no learning from absence).
     *
     * Owner-only. A snooze, a rejection and a dismissal are all statements
     * about how this person wants to be interrupted, and that is exactly the
     * kind of behavioural fingerprint that is never shared.
     */
    attentionState: defineTable({
      ...ownedBy,
      /** `hash(kind : sourceId : dueBucket)`. See `fingerprint` in the pipeline. */
      fingerprint: v.string(),
      /** How many times the item has been rendered. Display only. */
      seenCount: v.optional(v.number()),
      actedAt: v.optional(v.number()),
      dismissedAt: v.optional(v.number()),
      /** Epoch ms. A snooze with no end date is rejected for level-2 items. */
      snoozedUntil: v.optional(v.number()),
      rejectedAt: v.optional(v.number()),
      /** Highest escalation level the user was shown, so the rules stay honest. */
      escalation: v.optional(v.union(v.literal(0), v.literal(1), v.literal(2))),
      updatedAt: v.number(),
    })
      .index("by_space", ["spaceId"])
      .index("by_owner", ["ownerUserId"])
      // One row per fingerprint per user: the lookup every query does.
      .index("by_owner_fingerprint", ["ownerUserId", "fingerprint"]),

    // ---------- life areas -------------------------------------------------

    /**
     * One row per life area the user has switched on. `order` drives the tab
     * strip; areas are created on first enable rather than seeded for
     * everyone so nobody carries tabs they don't care about.
     */
    areas: defineTable({
      ...ownedBy,
      slug: areaSlugValidator,
      /** Display name — defaults to the catalogue label but stays editable. */
      label: v.string(),
      order: v.number(),
      createdAt: v.number(),
    })
      .index("by_space", ["spaceId"])
      .index("by_owner", ["ownerUserId"])
      .index("by_owner_order", ["ownerUserId", "order"])
      // Phase 0B query-idiom fix: slug lookups are index ranges, not a scan.
      .index("by_owner_slug", ["ownerUserId", "slug"]),

    // ---------- finance ----------------------------------------------------

    /** Tax profile: country, year, income figures for the estimate. */
    taxProfile: defineTable({
      ...ownedBy,
      country: countryCodeValidator,
      taxYear: v.number(),
      grossIncome: v.number(),
      businessMiles: v.optional(v.number()),
      charitableMiles: v.optional(v.number()),
      homeOfficeSqFt: v.optional(v.number()),
      donations: v.optional(v.number()),
      updatedAt: v.number(),
    })
      .index("by_space", ["spaceId"])
      .index("by_owner", ["ownerUserId"]),

    /** A deductible expense the user logged by hand or imported. */
    expenses: defineTable({
      ...ownedBy,
      label: v.string(),
      amount: v.number(),
      bucket: expenseBucketValidator,
      deductible: v.boolean(),
      /** How confident the categoriser was — drives the "check this" flag. */
      confidence: confidenceValidator,
      /** Expense date, used for the tax-year filter. */
      spentAt: v.number(),
      source: v.string(),
      createdAt: v.number(),
    })
      .index("by_space", ["spaceId"])
      .index("by_owner", ["ownerUserId"]),

    /** Which filing documents the user has gathered. */
    taxDocuments: defineTable({
      ...ownedBy,
      /** Requirement id from the country's catalogue. */
      requirementId: v.string(),
      gatheredAt: v.number(),
    })
      .index("by_space", ["spaceId"])
      .index("by_owner", ["ownerUserId"])
      // Phase 0B query-idiom fix: the toggle is a point lookup, not a scan.
      .index("by_owner_requirement", ["ownerUserId", "requirementId"]),

    // ---------- integrations ----------------------------------------------

    /**
     * A tool the user has connected. `credentials` holds the token supplied by
     * the provider's own OAuth flow; it never leaves the server.
     */
    connections: defineTable({
      ...ownedBy,
      /** Catalogue slug, e.g. "google-calendar". */
      provider: providerSlugValidator,
      label: v.string(),
      status: connectionStatusValidator,
      /** Account identity returned by the provider (email, handle, org). */
      accountHint: v.optional(v.string()),
      scopes: v.optional(v.array(v.string())),
      connectedAt: v.number(),
      lastSyncedAt: v.optional(v.number()),
    })
      .index("by_space", ["spaceId"])
      .index("by_owner", ["ownerUserId"])
      // Phase 0B query-idiom fix: one connection per provider per user.
      .index("by_owner_provider", ["ownerUserId", "provider"]),
  },
  {
    // Phase 0C. Validation is ON. Every enum-ish field is a closed union, every
    // product object carries ownerUserId + spaceId, and a full-conformance
    // audit against the live deployment reported zero non-conforming rows
    // across all 357 tasks and every other product table before this flag was
    // flipped. Accepted debt A1 is closed.
    //
    // If a future push is ever rejected for a non-conforming document, the fix
    // is to run `spaces:migrateOwnership` (which normalises ownership, area,
    // priority and the required task scalars, and recreates any row still
    // carrying the pre-0B `userId` column) until it reports zero, and push
    // again — never to turn this back off.
    schemaValidation: true,
  },
);

export default schema;
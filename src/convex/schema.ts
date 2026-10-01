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
  // Phase 3 feature 5. The two new object kinds, so `subscription.*` and
  // `account.created` activity rows can name what they are about. Same
  // reasoning as every other literal in this file: a closed union means an
  // activity row cannot claim to be about something that does not exist.
  v.literal("subscription"),
  v.literal("account"),
  v.literal("agentProposal"),
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
/**
 * What an account is *for*, as a closed union (phase 3, feature 5, ADR-028).
 *
 * Deliberately narrow and deliberately useless for arithmetic. The point is to
 * let the Finance area group obligations without asking the user to name things
 * consistently, and to make an unknown value a compile error rather than a
 * filter that silently drops a row.
 */
export const ACCOUNT_KINDS = ["checking", "savings", "cash", "credit", "investment"] as const;
export const accountKindValidator = v.union(
  v.literal("checking"),
  v.literal("savings"),
  v.literal("cash"),
  v.literal("credit"),
  v.literal("investment"),
);
export type AccountKind = Infer<typeof accountKindValidator>;

/**
 * How often a subscription bills (phase 3, feature 5).
 *
 * A closed union rather than a free-form number of days, because the annual
 * cost is derived from it and a derived number is only trustworthy if its
 * vocabulary is finite and its boundary cases have one place to be pinned by a
 * fixture. `annualCost` in `src/lib/subscriptions.ts` is the only reader.
 */
export const SUBSCRIPTION_INTERVALS = ["weekly", "monthly", "quarterly", "yearly"] as const;
export const subscriptionIntervalValidator = v.union(
  v.literal("weekly"),
  v.literal("monthly"),
  v.literal("quarterly"),
  v.literal("yearly"),
);
export type SubscriptionInterval = Infer<typeof subscriptionIntervalValidator>;

export const ACTIVITY_KINDS = [
  "task.created",
  "task.completed",
  "task.deleted",
  "note.created",
  "expense.added",
  "capture.committed",
  "person.created",
  "person.updated",
  "person.merged",
  "person.unmerged",
  // Phase 3 feature 3. All four are written on their own write path and read
  // back by `documents:documentAudit` — R-005 found kinds that were declared
  // here and never written anywhere, and D38 is that defect. Declaring less
  // would not have fixed it; writing them did.
  "document.created",
  "document.deleted",
  "document.renewal_started",
  "document.renewed",
  "commitment.made",
  "commitment.fulfilled",
  "commitment.cancelled",
  "commitment.followed_up",
  // Phase 3 feature 5. `expense.added` is the last of D38's four leftovers:
  // declared since phase 0B and written by nothing, because `life:addExpense`
  // inserted its row and no activity row. Finance was the only product area
  // mutating user data with no audit trail at all. The other four are this
  // feature's own events, and all five are written and read back by
  // `subscriptions:financeAudit`.
  "subscription.created",
  "subscription.updated",
  "subscription.cancelled",
  "subscription.deleted",
  "account.created",
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
  v.literal("person.updated"),
  v.literal("person.merged"),
  v.literal("person.unmerged"),
  // Phase 3 feature 3. Mirrors ACTIVITY_KINDS above; the two lists are written
  // out separately because a Convex validator has to be a static literal union.
  v.literal("document.created"),
  v.literal("document.deleted"),
  v.literal("document.renewal_started"),
  v.literal("document.renewed"),
  v.literal("commitment.made"),
  // Phase 3 feature 4. `commitment.made` was declared here since phase 0B and
  // never written by anything (D38); this feature makes the declaration true
  // and adds the three events that actually happen.
  v.literal("commitment.fulfilled"),
  v.literal("commitment.cancelled"),
  v.literal("commitment.followed_up"),
  // Phase 3 feature 5. Mirrors ACTIVITY_KINDS above.
  v.literal("subscription.created"),
  v.literal("subscription.updated"),
  v.literal("subscription.cancelled"),
  v.literal("subscription.deleted"),
  v.literal("account.created"),
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
  // Phase 3 feature 6. The runner requires this flag on enrolment **and**
  // re-checks it on every run, so switching it off stops scheduled agents for
  // everybody immediately. A gate that can only be turned on is not a gate.
  v.literal("debug_agents_v1"),
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

/**
 * Which way a commitment runs (phase 3, feature 4, ADR-027).
 *
 * Mirrored in `src/lib/commitments.ts` and asserted against it by
 * `schema-vocab.test.ts`.
 */
export const commitmentDirectionValidator = v.union(v.literal("owed"), v.literal("owedTo"));

/** The life-area catalogue in src/lib/areas.ts. */
export const areaSlugValidator = v.union(
  v.literal("general"),
  v.literal("finance"),
  v.literal("relationships"),
  v.literal("health"),
  v.literal("home"),
  // Phase 3 feature 3. A passport is not part of running a place, so widening
  // `home` would have misdescribed an area that is already correct. This is one
  // more row in the *existing* tab list, not a second page system.
  //
  // Note for the next editor: `schema-vocab.test.ts` reads this union's source
  // with a regex and treats every double-quoted string as a literal, so no
  // comment in here may contain a quoted phrase.
  v.literal("life"),
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
  // Phase 3 feature 6 — the agent framework's off switch. Required on
  // enrolment and re-checked on every run, so it can stop scheduled agents as
  // well as start them.
  v.literal("debug_agents_v1"),
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
    /**
     * When this space is next due for a scheduled agent run (phase 3,
     * feature 6).
     *
     * **This column is the entire scheduler.** A scheduled run has no idea who
     * it is running for — Convex cron delivers one invocation and no context —
     * so the set of spaces to process has to be found by an **index range**,
     * not by collecting every space in the deployment and filtering in
     * JavaScript. That is the D37/D39/D41/D42/D43 lesson applied to the one
     * path in the product that would otherwise be an unbounded table scan.
     *
     * **Absent means "never scheduled".** Convex omits a document from an index
     * when the indexed field is absent, so a space nobody has opted in is not
     * in the range and cannot be picked up — opt-out is structural rather than
     * a flag someone has to remember to honour. That is also the safest
     * posture for a process that runs with nobody watching.
     *
     * The runner only advances the rows it actually processed, so a backlog
     * drains at a fixed rate without starving the spaces at the back: they
     * simply stay in the past, at the head of the range, until there is room.
     */
    nextAgentRunAt: v.optional(v.number()),
  })
    .index("by_createdBy", ["createdBy"])
    .index("by_nextAgentRunAt", ["nextAgentRunAt"]),

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
      /**
       * Phase 3: the person this task is about.
       *
       * An id, not a name — feature 10 (`PEOPLE_FIT`) keys its completion
       * counters on this value, and two people called "Raj" must not share
       * evidence about each other's follow-ups.
       *
       * It may point at a **tombstone**, and that is deliberate: a merge rewrites
       * nothing (see `people.mergedIntoId`), so a task keeps pointing at exactly
       * the row the user picked, and unmerging restores it without touching a
       * single task. Reads resolve through `mergedIntoId`.
       */
      personId: v.optional(v.id("people")),

      /**
       * Phase 3 feature 3: the life-admin document this task renews.
       *
       * The renewal is an **ordinary task**, not a sub-record of the document.
       * The task points at the document and the document holds no reference
       * back (ADR-026) — the same shape as `personId` above, and for the same
       * three reasons: the lookup is an index range rather than a reverse scan,
       * the document never has to be patched when a task is created, completed
       * or deleted, and a row can always answer a question about itself.
       *
       * It may point at a **deleted** document. `deleteDocument` clears this
       * field rather than deleting the task, because Do-Not-Touch #9 forbids
       * deleting user data as a side effect of another action.
       */
      documentId: v.optional(v.id("documents")),

      /**
       * Phase 3 feature 4: the waiting item this follow-up chases.
       *
       * Set **only** by `commitments:followUp`, and only when the user pressed
       * the button. Panel never creates a task for a commitment on its own,
       * because inventing work is how a system becomes a nag.
       *
       * Completing this task does **not** settle the commitment: chasing
       * someone is not receiving from them, and conflating the two would be a
       * lie about another person's behaviour (ADR-027).
       */
      commitmentId: v.optional(v.id("commitments")),
    })
      .index("by_space", ["spaceId"])
      .index("by_owner", ["ownerUserId"])
      .index("by_owner_created", ["ownerUserId", "createdAt"])
      // Phase 0B query-idiom fix: area filtering happens in the index, not in
      // JavaScript after a full collect.
      .index("by_owner_area", ["ownerUserId", "area"])
      /**
       * Phase 3: tasks that are *about somebody*, and nothing else.
       *
       * Convex omits a document from an index when an indexed field is
       * `undefined`, so this range holds exactly the tasks carrying a
       * `personId` — never a full scan of the user's tasks. `listPeople` and
       * `getPerson` need every task with a person to resolve open counts and
       * links through tombstones, and before this index they were reading every
       * task the user has ever created, on a reactively-subscribed query.
       *
       * Tombstone ids appear here too, and deliberately: a merged-away row is
       * still the row a task points at (ADR-023), and the read resolves the
       * chain rather than needing the index to follow it.
       */
      .index("by_owner_person", ["ownerUserId", "personId"])

      /**
       * Phase 3 feature 3: tasks that are *renewals*, and nothing else.
       *
       * Same reasoning as `by_owner_person` above, and the same failure it was
       * added to prevent. Convex omits a document from an index when the
       * indexed field is absent, so this range holds exactly the tasks carrying
       * a `documentId`. Without it, every read of "does this document have a
       * renewal?" would be a full scan of the user's tasks — on a reactively
       * subscribed query, which is the shape of D37 and D39.
       */
      .index("by_owner_document", ["ownerUserId", "documentId"])

      /**
       * Phase 3 feature 3/4: follow-up tasks, and nothing else.
       *
       * Same reasoning as `by_owner_document`: Convex omits a document from an
       * index when the indexed field is absent, so this range holds only the
       * tasks that chase a waiting item.
       */
      .index("by_owner_commitment", ["ownerUserId", "commitmentId"]),

    /**
     * A person (phase 3, feature 1).
     *
     * People were previously faked: `PeopleArea` stored "catch up with mum every
     * week" in `tasks.title`, which meant a person could not be shared, synced,
     * linked, or reasoned about, and two captures of the same person were two
     * unrelated strings.
     *
     * **Identity is a set of keys, never a name.** RJD-004 settled it: "Raj" ≠
     * "Raj". `identityKeys` holds normalised, namespaced keys (`name:raj`,
     * `email:…`) that a future provider can contribute to without a schema
     * change. Sharing a key is *evidence* shown to the user, never an automatic
     * merge — see `src/lib/people.ts`.
     *
     * **A merge rewrites nothing.** `mergedIntoId` is set on the source and the
     * row is kept as a tombstone; reads resolve through it and identity keys are
     * derived by following the chain. Nothing is copied, so unmerge is clearing
     * two fields and is exact by construction — there is no restoration step
     * that could get it wrong.
     */
    people: defineTable({
      ...ownedBy,
      /** Display name. Editable, and deliberately *not* the identity. */
      name: v.string(),
      /**
       * Normalised identity keys. Bounded (`MAX_KEYS`) because a mutation
       * writes them, and computed rather than accepted verbatim so a client
       * cannot invent a key that matches somebody else's evidence.
       */
      identityKeys: v.array(v.string()),
      /** Optional contact detail. Contributes an `email:` key; never exported. */
      email: v.optional(v.string()),
      note: v.optional(v.string()),
      /**
       * Set when this person was merged into another. The row is **kept**, not
       * deleted: it is the indirection that makes unmerge exact.
       */
      mergedIntoId: v.optional(v.id("people")),
      mergedAt: v.optional(v.number()),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
      .index("by_space", ["spaceId"])
      .index("by_owner", ["ownerUserId"])
      .index("by_space_name", ["spaceId", "name"]),

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
     * OAuth tokens and refresh tokens.
     *
     * **ADR-014 containment.** This table is reachable only from the
     * `internalMutation` / `internalQuery` functions in
     * `src/convex/credentials.ts`, which exports no public query. That module
     * boundary is the mechanism; a comment here is not. `scripts/spec-drift.ts`
     * greps for any other public function naming this table, so the guarantee is
     * checked rather than asserted.
     *
     * Nothing is ever returned from this table to a client — not masked, not
     * truncated. There is no field a caller could use to reconstruct the value.
     */
    connectionTokens: defineTable({
      ...ownedBy,
      /** One row per (space, provider). A second connect replaces, never adds. */
      provider: providerSlugValidator,
      /** Provider's encrypted-at-rest blob. Never logged, never returned. */
      accessToken: v.string(),
      refreshToken: v.optional(v.string()),
      /** Provider's own expiry, in ms. Panel does not extend it. */
      expiresAt: v.optional(v.number()),
      /** Panel-only fingerprint of the token, for "did it change?" without the token. */
      fingerprint: v.string(),
      updatedAt: v.number(),
    })
      .index("by_space", ["spaceId"])
      .index("by_owner_provider", ["ownerUserId", "provider"]),

    /**
     * Where a sync got to.
     *
     * The cursor is opaque to everything except the adapter that produced it.
     * Reset to null on reconnect, which forces a full sweep — that is how a
     * reconnect avoids silently skipping objects that changed while Panel was
     * not watching.
     */
    syncCursors: defineTable({
      ...ownedBy,
      provider: providerSlugValidator,
      /** Opaque continuation token. Null means "start from the beginning". */
      cursor: v.optional(v.nullable(v.string())),
      /** Last successful sync, used for the staleness windows in §7.2. */
      lastSyncedAt: v.optional(v.number()),
      /** Increments on every attempted run, successful or not. Observable. */
      runs: v.number(),
      /** Stable code only. Never a provider response body (ADR-014). */
      lastErrorCode: v.optional(v.string()),
      updatedAt: v.number(),
    })
      .index("by_space", ["spaceId"])
      .index("by_owner_provider", ["ownerUserId", "provider"]),

    /**
     * Single-use OAuth state, with the PKCE verifier.
     *
     * The state is a CSRF token and is stored **hashed** — a stolen database
     * does not let an attacker forge a callback. The verifier is different, and
     * the difference is not an oversight: PKCE requires the verifier to be
     * *sent to the provider* at token-exchange time, and a one-way hash cannot
     * be sent to anyone. So it is stored verbatim, in this server-only table,
     * for the shortest possible life: a ten-minute expiry, and the whole row
     * is **deleted** on redemption. What it can never do is travel — no
     * endpoint returns it, no client ever sees it, and the module that owns
     * this table exports no public function (ADR-014).
     */
    oauthStates: defineTable({
      ...ownedBy,
      provider: providerSlugValidator,
      /** The CSRF nonce we sent, hashed. */
      stateHash: v.string(),
      /**
       * The PKCE verifier. There is no non-PKCE path: `beginOAuth` refuses to
       * create a row without one, and `peekState`/`consumeState` refuse to
       * redeem a row that has none.
       *
       * `v.optional` for the same reason phase 1.1's counters are: so the few
       * rows written before phase 2 stay valid and no data migration is needed.
       * Every one of them is long past its ten-minute expiry, and a row with no
       * verifier is treated as un-redeemable rather than as a fallback path.
       */
      verifier: v.optional(v.string()),
      /**
       * **Retired.** Phase 1.5 stored a hash of the verifier here; phase 2
       * stores the verifier itself (see the note above) because PKCE has to
       * *send* it. The column survives only so the deployment can be pushed
       * without a data migration: Convex validates existing documents against
       * the new schema, and the handful of rows written by the 1.5 conformance
       * run carry it. They are all far past their ten-minute expiry, nothing
       * reads this field, and nothing ever will. Deleting the rows and the
       * column is a one-line follow-up whenever a real migration is convenient.
       */
      verifierHash: v.optional(v.string()),
      /** Binds the state to the user who started it. */
      userId: v.id("users"),
      /** Short expiry. A stale authorisation attempt is not worth honouring. */
      expiresAt: v.number(),
      usedAt: v.optional(v.number()),
      createdAt: v.number(),
    })
      .index("by_space", ["spaceId"])
      .index("by_stateHash", ["stateHash"]),

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
      /**
       * Phase 1.5: the provider's stable id, when this expense came from a
       * sync. Optional, so every hand-entered expense stays valid and no
       * migration is needed. **The** idempotency key: an expense with an
       * externalId is upserted on that value, so replaying a sync cannot create
       * it twice. Null means "the user typed this", which is never overwritten
       * by a sync.
       */
      externalId: v.optional(v.string()),
      /** Which integration produced it, when it came from one. */
      provider: v.optional(providerSlugValidator),
      /** Upstream last-changed. Drives staleness, never overwrites a local edit. */
      upstreamChangedAt: v.optional(v.number()),
    })
      .index("by_space", ["spaceId"])
      .index("by_owner", ["ownerUserId"])
      .index("by_space_externalId", ["spaceId", "externalId"])
      // Phase 3 feature 5 — D43. `getFinance` collected **every** expense the
      // user had ever created on a reactively-subscribed query and filtered to
      // the tax year in JavaScript. N4 closed that defect in phase 0B by
      // asserting the set was "bounded", which is false: owner-scoped is not
      // bounded, and an expense table only grows. This is D42's exact shape,
      // arriving one feature earlier on the same query family. The range is on
      // the local-time tax year so the rows returned are byte-identical to the
      // `getFullYear()` filter it replaces, on any UTC offset.
      .index("by_owner_spentAt", ["ownerUserId", "spentAt"]),

    /**
     * A meeting, cached from a connected calendar (§7.3, ADR-013).
     *
     * The column list *is* the minimisation policy, which is the point: there
     * is nowhere to put an attendee list, a description, a location or a dial-in
     * because no such column exists. A provider that starts sending one cannot
     * leak it, and a future contributor cannot accidentally add it without
     * making that visible in a schema review.
     *
     * `title` is the one text field, and it is the literal `"Busy"` whenever
     * `isPrivate` is true — the private title is dropped in the adapter, before
     * the value ever exists as a string Panel could write.
     */
    calendarEvents: defineTable({
      ...ownedBy,
      /** The provider's stable id. **The** idempotency key for a sync. */
      externalId: v.string(),
      /** Which integration produced it. Always inbound (ADR-013). */
      provider: providerSlugValidator,
      /**
       * The meeting title, or the literal `"Busy"` for a private event.
       * `v.string()` rather than optional: every row has *something* to show,
       * and "we dropped the title" is better expressed as "Busy" than as a hole.
       */
      title: v.string(),
      /** True when upstream reported this event as private. */
      isPrivate: v.optional(v.boolean()),
      /** Epoch ms. Null for an event with no start, which Google does emit. */
      startsAt: v.optional(v.union(v.null(), v.number())),
      endsAt: v.optional(v.union(v.null(), v.number())),
      allDay: v.optional(v.boolean()),
      /**
       * Set when upstream deleted or cancelled an event that has not happened
       * yet (§7.2). The row is kept rather than deleted so a meeting the user
       * was told about does not simply vanish from history. Past events are
       * deleted outright instead — they have no forward meaning.
       */
      cancelled: v.optional(v.boolean()),
      /** A link back to the provider, for "open in Google". Never fetched. */
      sourceUrl: v.optional(v.string()),
      /** Upstream last-changed. Drives staleness, never overwrites a local edit. */
      upstreamChangedAt: v.optional(v.number()),
      createdAt: v.number(),
    })
      .index("by_space", ["spaceId"])
      .index("by_owner", ["ownerUserId"])
      // The dashboard reads "what is next" — an index range, not a filter.
      .index("by_space_startsAt", ["spaceId", "startsAt"])
      .index("by_space_externalId", ["spaceId", "externalId"]),

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

    /**
     * A life-admin document (phase 3, feature 3).
     *
     * **This is metadata about keeping a credential valid. It is not the
     * document.** A label, a date it stops being valid, and how early to warn.
     * No file, no image, no document number, no storage reference — R-007, and
     * the same reasoning ADR-013 used to store a private calendar event as the
     * literal string `"Busy"`. The safest data is the data that was never
     * stored, and every failure mode this feature exists to prevent is
     * calendar-shaped rather than storage-shaped.
     *
     * **There is no status column, on purpose (ADR-025).** The seven states are
     * a pure function of `expiresAt`, the linked renewal task and `now`
     * (`src/lib/documents.ts`). A status would be a *copy* of two other fields,
     * and a copy is exactly where they disagree without anything noticing —
     * the D34 defect class, which was a roll-up permanently zero because its
     * fields were never populated, and which compiled cleanly throughout.
     *
     * This table is deliberately **not** a generalisation of `taxDocuments`.
     * That table is a filing checklist: one row per requirement id in a closed
     * static country catalogue, with no label, no date and no lifecycle.
     * `requirementId` is a key into `COUNTRIES[c].documents`, `readinessScore`
     * maps it back to a catalogue entry, and `by_owner_requirement` allows one
     * row per requirement. A passport is in no tax catalogue, so none of that
     * applies to it, and coupling the two would drag a user domain object into
     * Do-Not-Touch #1.
     */
    documents: defineTable({
      ...ownedBy,

      /** What the user calls it. The only free text on the row; 1–80, trimmed. */
      label: v.string(),

      /**
       * Epoch ms this document stops being valid. **Optional**: absent means
       * "no expiry recorded", which is a real, watchable, permanently silent
       * state — not an error and not a missing field.
       */
      expiresAt: v.optional(v.number()),

      /**
       * How many days before `expiresAt` the renewal has to start (R-006).
       *
       * Not a constant: Virginia DMV reminds at 90 days, Utah opens renewal at
       * 60, and a passport needs 4–6 weeks plus mailing. Optional, falling back
       * to `DEFAULT_LEAD_DAYS`, and the UI says it is a default rather than a
       * figure from an authority — a table of real lead times would be
       * `tax.ts` again, and Do-Not-Touch #1 exists because unverifiable figures
       * are a liability.
       */
      leadDays: v.optional(v.number()),

      /** Whose document this is. Reuses phase 3 feature 1 wholesale. */
      personId: v.optional(v.id("people")),

      createdAt: v.number(),
    })
      .index("by_space", ["spaceId"])
      .index("by_owner", ["ownerUserId"])
      /**
       * Convex omits a document from an index when the indexed field is absent,
       * so this range holds **exactly the documents that have an expiry** —
       * which is precisely the set the Attention rule needs, and narrower than
       * the list read. This index exists so the attention query is bounded by
       * what it actually uses rather than by how many documents a person owns
       * (D37, D39).
       */
      .index("by_owner_expiry", ["ownerUserId", "expiresAt"]),

    /**
     * A commitment, or a wait (phase 3, feature 4).
     *
     * **One object, two directions.** A row is an expectation between the user
     * and one person: `owed` is something the user promised, `owedTo` is
     * something the user is waiting for. They share a shape and a lifecycle and
     * differ by one field — who holds the next move (ADR-027, R-008).
     *
     * **Why `owedTo` cannot be a task.** `taskRules` emits `task.overdue` for
     * any open dated task. A delegation stored as a task would therefore be
     * reported overdue — about something the user is physically unable to do,
     * which is worse than silence because it teaches the reader to ignore the
     * feed. Every published definition of GTD's Waiting For list keeps it
     * *outside* the action list for the same reason.
     *
     * **No status column.** Four states are derived from `(expectedAt,
     * completed, now)` by `src/lib/commitments.ts`. A stored status would be a
     * copy of two other fields, and a copy is where they disagree silently —
     * ADR-025.
     *
     * **`completed` is always the user's assertion.** For `owed` they did the
     * thing and Panel knows. For `owedTo` nobody in the system observed
     * anything, so the surface must say "you marked this received" and never
     * "Raj sent this". The wording carries that honesty; no column can.
     */
    commitments: defineTable({
      ...ownedBy,

      /**
       * The counterparty. **Required, not optional** — a commitment to nobody
       * is just a task, and making it optional would let the feature quietly
       * become a second task list.
       *
       * May point at a **tombstone**, deliberately: a merge rewrites nothing
       * (ADR-023), so a commitment keeps pointing at exactly the row the user
       * chose, unmerging restores it without touching a single row, and reads
       * resolve through `mergedIntoId`.
       */
      personId: v.id("people"),

      /** What was promised, or what is expected. The only free text; 1-160. */
      title: v.string(),

      /** Which way the obligation runs. Closed: see ADR-027. */
      direction: commitmentDirectionValidator,

      /**
       * When the user said it would happen. **Optional**: plenty of promises
       * have no date, and inventing one would be a lie about what they said.
       * For `owedTo` this is the date the user would tell the other person.
       */
      expectedAt: v.optional(v.number()),

      /** The user's own assertion that it is settled. Never an observation. */
      completed: v.boolean(),
      completedAt: v.optional(v.union(v.null(), v.number())),

      createdAt: v.number(),
    })
      .index("by_space", ["spaceId"])
      .index("by_owner", ["ownerUserId"])
      /**
       * **The only range Attention ever needs**, and the reason this table has
       * three indexes rather than one.
       *
       * Only a commitment that is unsettled *and* dated *and* past its date can
       * produce an attention item — the derived machine says so, and the other
       * three states are silent. That is precisely an index range on
       * `(completed, expectedAt)`, so the hot query filters in the database
       * instead of collecting every commitment the user has ever made and
       * discarding most of them in JavaScript.
       *
       * Convex omits a document from an index when an indexed field is absent,
       * so an **undated** commitment never appears here — and an undated one
       * can never be overdue. The index is not a filter somebody has to
       * re-check afterwards; it *is* the candidate set.
       *
       * This is the `by_owner_expiry` argument from feature 3 applied a second
       * time, and it corrects the original scope block, which declined to add
       * any index beyond `by_owner` on the grounds that a single owner-scoped
       * read was enough. It is not enough on the query that re-runs on every
       * dashboard write — which is the D37/D39/D41 lesson arriving one feature
       * late rather than three.
       */
      .index("by_owner_open", ["ownerUserId", "completed", "expectedAt"]),

    /**
     * A place money leaves from — a label, and nothing else (phase 3, feature 5,
     * ADR-028).
     *
     * **There is no balance column, and that is the decision rather than an
     * omission.** A balance is a derived value over transactions, a
     * transaction is a ledger row, and §2.3 names the ledger as the thing Panel
     * must not become: these products stop where an action is needed, and
     * Panel's value is the part after that point.
     *
     * The minimisation argument is ADR-013's, applied to money. A private
     * calendar event is stored as the literal `"Busy"` because the safest data
     * is the data that was never stored. **The safest account is one that cannot
     * be drained, because no column exists to type a number into** — and no
     * account number, sort code, IBAN, card or merchant token exists either.
     * A user who wants a balance has a ledger app; a user who wants to know
     * what renews on the 14th does not, and that is what Panel now answers.
     *
     * A `kind` is a closed union rather than free text so the Finance area can
     * group without the user having to name things consistently, and so an
     * unknown value is a compile error instead of a filter that silently
     * drops a row.
     */
    accounts: defineTable({
      ...ownedBy,

      /** What the user calls it: "Joint current". 1–60, trimmed. */
      label: v.string(),

      kind: accountKindValidator,

      createdAt: v.number(),
    })
      .index("by_space", ["spaceId"])
      .index("by_owner", ["ownerUserId"]),

    /**
     * A recurring charge with a known price and a known next renewal date
     * (phase 3, feature 5, ADR-029).
     *
     * **The expiry logic is not here and never will be.** `documentId` points
     * at a real `documents` row that `createSubscription` inserts in the same
     * mutation, and every read resolves through it. `document.expiring`
     * already exists, already fires, and its `by_owner_expiry` range already
     * narrows the attention read to exactly the documents that have an
     * expiry — so this feature adds **no attention kind, no section, no rule
     * and no read** to `getAttention`. The same shape as `tasks.documentId`
     * (ADR-026) and `tasks.commitmentId` (ADR-027): the related row holds
     * nothing, and the relation resolves on read.
     *
     * **Why not a `renewsAt` column plus a new rule.** That is a second expiry
     * model, and two expiry models disagree the moment a lead time or a
     * boundary case is fixed in one and not the other. It would also re-open
     * F3's one-renewal-one-item guard, which exists precisely because one
     * renewal producing two feed items is a defect.
     *
     * **The money cannot live on `documents`.** A passport has no price and
     * no billing interval, and R-007 defines a document as a label, an expiry
     * and a lead time. Putting `amount` on `documents` would drag Life Admin
     * into Finance, so the two compose through a pointer instead.
     *
     * **No currency column.** There is no rate source and no approved
     * integration, so an amount is in the user's profile currency and Panel
     * does not convert. Storing a currency without a conversion story would
     * be a number that is silently wrong rather than visibly absent.
     *
     * `amount` is a float and deliberately stays one. See ADR-028's sibling
     * note in the scope block: every write path rejects a non-finite amount,
     * because a NaN reaching `estimateTax` yields a *plausible* number, which
     * is worse than a crash.
     */
    subscriptions: defineTable({
      ...ownedBy,

      /** What the user calls it: "Netflix". 1–80, trimmed. */
      label: v.string(),

      /**
       * What it costs per billing period. Finite, positive and bounded — see
       * `MAX_AMOUNT` in `src/lib/subscriptions.ts`, which is the one place
       * that rule is defined.
       */
      amount: v.number(),

      /**
       * A **closed** interval, not a free-form "every 17 days". A closed union
       * is what makes the derived annual cost checkable: an open vocabulary
       * would push a calendar-arithmetic branch into every read, and the
       * boundary cases (February, leap years, 28-day months) would have no
       * single place to be pinned by a fixture.
       */
      interval: subscriptionIntervalValidator,

      /**
       * Where the money leaves from. Optional, and it is a **label pointer**:
       * deleting an account detaches its subscriptions and reports the count
       * rather than cascading, so tidying a label cannot destroy an
       * obligation. Same rule `deleteDocument` and `deleteCommitment` use.
       */
      accountId: v.optional(v.id("accounts")),

      /**
       * The renewal document (ADR-029). **Always present.** A subscription
       * with no recorded renewal date is expressible — the document simply
       * has no `expiresAt`, which is a real and permanently silent state — but
       * a subscription that has lost its document is not expressible at all.
       */
      documentId: v.id("documents"),

      /**
       * Cancel stops the charging and the reminders. `reactivating` is the
       * inverse and is what keeps "cancel" from being a one-way door.
       */
      cancelled: v.optional(v.boolean()),
      cancelledAt: v.optional(v.number()),

      createdAt: v.number(),
    })
      .index("by_space", ["spaceId"])
      .index("by_owner", ["ownerUserId"])
      // One subscription per document, and — more importantly — the read that
      // resolves `documentId` back to a subscription is a point lookup rather
      // than a per-row `get`. A subscription list is bounded at 200, so a
      // per-row get would be a 200-query N+1 on a reactively-subscribed
      // query: D41 again, in a new hat.
      .index("by_owner_document", ["ownerUserId", "documentId"])
      .index("by_owner_account", ["ownerUserId", "accountId"]),

    /**
     * One row per scheduled agent execution (phase 3, feature 6, ADR-030).
     *
     * **Non-sensitive by construction, which is why it always persists.** §6.1
     * gated `agentRuns` behind `debug_agents_v1` because a trace could contain
     * whatever an agent happened to look at. This table contains only counts,
     * a duration, and a boolean — no labels, no amounts, no titles, no ids
     * beyond the space the run belongs to. There is nothing in it to leak, so
     * gating it would have made the audit trail optional, and an optional
     * audit trail is not one.
     *
     * The `overflow` column is the reason §6.1 says "never silently
     * truncated": a cap that discards work invisibly is indistinguishable from
     * an agent with nothing to do, and the difference matters when someone is
     * asking why their review did not appear.
     */
    agentRuns: defineTable({
      /** Which space the run was for. The tenant boundary (ADR-009). */
      spaceId: v.id("spaces"),

      /** Which agent. A closed vocabulary — see `REGISTERED_AGENTS`. */
      agent: v.optional(v.string()),

      /** The deterministic key this run is accounted under. */
      key: v.optional(v.string()),

      /** Epoch ms. The daily cap is a window over this column. */
      at: v.number(),

      /** Wall-clock duration in ms. A number, not a profile. */
      durationMs: v.optional(v.number()),

      /** `ok` | `skipped` | `capped` | `failed`. Never "succeeded" on a crash. */
      result: v.string(),

      /** How many agent executions ran. What the caps actually bound. */
      executions: v.optional(v.number()),

      proposals: v.optional(v.number()),
      skipped: v.optional(v.number()),

      /**
       * How many were held back by a cap. Zero in the ordinary case; the whole
       * point of the column is that it is not *assumed* to be zero.
       */
      overflow: v.optional(v.number()),

      /**
       * A failure message, when there was one. Bounded and sanitised by the
       * runner — never a stack, never an argument value.
       */
      error: v.optional(v.string()),
    })
      .index("by_space_at", ["spaceId", "at"]),

    /**
     * A proposal an agent made, for the user to act on (phase 3, feature 6,
     * ADR-011's `proposed` tier).
     *
     * **Proposals never execute.** A row here is a thing to read and a thing
     * to accept or dismiss — nothing more, and there is no column that would
     * let a proposal cause a write to a financial row.
     *
     * **`key` is the idempotency guarantee** (Do-Not-Touch #9). The runner
     * looks the key up before writing, so the same finding on the same input
     * does not produce a second row, a second activity row, or a second
     * notification — a plain index lookup rather than a filter, because the
     * alternative is a scan that grows with the user's history.
     */
    agentProposals: defineTable({
      spaceId: v.id("spaces"),
      ownerUserId: v.id("users"),

      /** The deterministic key. Unique in practice, enforced by the runner. */
      key: v.string(),

      agent: v.string(),

      title: v.string(),
      detail: v.string(),

      /**
       * Bounded scalar evidence, capped at a handful of pairs by the runner.
       * Deliberately **not** a JSON blob (ADR-008) and deliberately not a copy
       * of the rows it summarises: a proposal is a pointer to something the
       * user can already open, not a duplicate of it.
       */
      evidence: v.optional(v.array(v.object({ label: v.string(), value: v.string() }))),

      at: v.number(),

      /** `open` until the user acts on it. Never mutated by the agent. */
      status: v.optional(v.string()),
      resolvedAt: v.optional(v.number()),
    })
      // No by_owner index, and deliberately so: every read is already scoped by
      // space, and the caller's space comes from an index scoped to them.
      .index("by_space_at", ["spaceId", "at"])
      .index("by_space_key", ["spaceId", "key"]),

    /**
     * A tool the user has connected. `credentials` holds the token supplied by
     * the provider's own OAuth flow; it never leaves the server.
     */
    // ---------- integrations ----------------------------------------------

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
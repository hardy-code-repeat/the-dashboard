/**
 * The data inventory — what an export may contain, and what it must never
 * contain. Pure, no Convex import, so it is table-testable (D59's lesson: a
 * security boundary that cannot be unit-tested is a convention).
 *
 * ## Why this is code and not a paragraph
 *
 * A privacy policy written as prose drifts from the schema the moment anyone
 * adds a column. This file is the single place that classifies every table, so
 * "what leaves the system" is answerable by reading one array, and an
 * unclassified table is a compile-time-visible gap rather than an oversight.
 *
 * ## The four tiers (GDPR Art. 4/15/20 shape, adapted to a personal OS)
 *
 * 1. **USER-OWNED** — data the user created or that describes them. Exported
 *    in full. This is the portability payload (Art. 20) and most of Art. 15.
 * 2. **SHARED** — data in a space the user belongs to but does not own. Exported
 *    **read-only and attributed**, because another member's row is not the
 *    requester's personal data; it is another data subject's. Exporting a
 *    co-member's private note to them would be a fresh disclosure, not a
 *    portability right.
 * 3. **SECURITY / AUDIT** — access logs, grants, agent runs. Counted and
 *    summarised, never dumped: these contain third-party user ids and their
 *    purpose is evidence, not portability. Art. 15(3) and Recital 63 allow
 *    restriction here.
 * 4. **SYSTEM / SECRET** — OAuth tokens, connection tokens, hashed verifiers,
 *    API keys. **Never exported in any form.** A portable backup that carries
 *    a live bearer token is a credential exfiltration channel with a download
 *    button.
 *
 * ## The rule that keeps this honest
 *
 * A table appears in exactly one tier. `classifyTable` returns `null` for an
 * unknown table rather than defaulting to "export it", so adding a table
 * without classifying it **fails the export loudly** instead of leaking it.
 */

export type ExportTier =
  | "userOwned"
  | "shared"
  | "securityAudit"
  | "systemSecret";

export type ExportClassification = {
  tier: ExportTier;
  /** The JSON key this table's rows appear under, or null when never emitted. */
  key: string | null;
  /** One line explaining the placement, shown in the export's own manifest. */
  why: string;
};

/**
 * Every table in `src/convex/schema.ts`, classified.
 *
 * `key: null` means the table is never emitted — either it is a secret, or it
 * is security evidence summarised as a count in the manifest instead.
 */
export const EXPORT_CLASSIFICATION: Record<string, ExportClassification> = {
  // ---- 1. user-owned: created by the user, about the user --------------
  tasks: { tier: "userOwned", key: "tasks", why: "Tasks the user created." },
  people: { tier: "userOwned", key: "people", why: "People the user recorded." },
  notes: { tier: "userOwned", key: "notes", why: "Notes the user wrote." },
  areas: { tier: "userOwned", key: "areas", why: "The user's own areas." },
  taxProfile: { tier: "userOwned", key: "taxProfile", why: "The user's tax profile." },
  taxDocuments: { tier: "userOwned", key: "taxDocuments", why: "Tax document metadata." },
  expenses: { tier: "userOwned", key: "expenses", why: "Expenses the user recorded." },
  documents: {
    tier: "userOwned",
    key: "documents",
    why: "Life-admin document metadata (label, expiry, lead time — no file).",
  },
  commitments: {
    tier: "userOwned",
    key: "commitments",
    why: "Commitments the user asserted.",
  },
  accounts: { tier: "userOwned", key: "accounts", why: "Account labels the user chose." },
  subscriptions: {
    tier: "userOwned",
    key: "subscriptions",
    why: "Subscriptions the user recorded.",
  },
  transactions: {
    tier: "userOwned",
    key: "transactions",
    why: "Transactions the user typed or imported.",
  },
  imports: {
    tier: "userOwned",
    key: "imports",
    why: "Import metadata and its audit record (no source file bytes).",
  },
  calendarEvents: {
    tier: "userOwned",
    key: "calendarEvents",
    why: "Synced calendar events. Private events are stored as 'Busy' already.",
  },
  connections: {
    tier: "userOwned",
    key: "connections",
    why:
      "Which provider accounts the user linked, and with what scope. Carries the provider's account hint and NO token — the live credential is connectionTokens, which is never exported.",
  },

  // ---- 2. shared: in the user's spaces, owned by someone else -----------
  // Deliberately empty. Every product table is owner-scoped today, and a
  // shared row is currently reachable through per-object queries rather than
  // bulk listing. If a shared-space table appears here, it must also state
  // whether co-owned rows are attributed — which is a product decision, not a
  // default. See the D56 note in CHANGELOG.

  // ---- 3. security / audit: summarised as counts, never dumped ----------
  spaceMembers: {
    tier: "securityAudit",
    key: null,
    why: "Membership is a grant record naming other users. Counted only.",
  },
  grants: {
    tier: "securityAudit",
    key: null,
    why: "Grants name a grantee and a scope. Counted only.",
  },
  accessLog: {
    tier: "securityAudit",
    key: null,
    why: "Access evidence naming viewer and target. Counted only.",
  },
  activity: {
    tier: "securityAudit",
    key: null,
    why: "Activity log naming actors. Counted only.",
  },
  agentRuns: {
    tier: "securityAudit",
    key: null,
    why: "Agent execution evidence, including overflow. Counted only.",
  },
  agentProposals: {
    tier: "securityAudit",
    key: null,
    why: "Agent proposals name their target space and actor. Counted only.",
  },
  links: {
    tier: "securityAudit",
    key: null,
    why: "Relationship rows reference objects in other users' spaces. Counted only.",
  },

  // ---- 4. system / secret: never exported, not even hashed --------------
  connectionTokens: {
    tier: "systemSecret",
    key: null,
    why: "Live provider access tokens. Never exported.",
  },
  oauthStates: {
    tier: "systemSecret",
    key: null,
    why: "OAuth state and hashed PKCE verifiers. Never exported.",
  },
  syncCursors: {
    tier: "systemSecret",
    key: null,
    why: "Sync state can disclose provider cursor internals. Never exported.",
  },
  featureFlags: {
    tier: "systemSecret",
    key: null,
    why: "Internal rollout state. Not user data.",
  },
  attentionState: {
    tier: "systemSecret",
    key: null,
    why: "Behavioural fingerprint. Owner-only by ADR-009; not portable.",
  },
  assistantState: {
    tier: "systemSecret",
    key: null,
    why: "Behavioural fingerprint. Owner-only by ADR-009; not portable.",
  },
  modelSnapshots: {
    tier: "systemSecret",
    key: null,
    why: "Learned weights. Owner-only and not user data.",
  },

  // ---- the identity record itself --------------------------------------
  // The user row is exported as a narrow profile rather than a raw dump,
  // because `authTables` rows can gain provider ids. See `profileFields`.
  users: { tier: "userOwned", key: "profile", why: "The user's own profile fields." },
  spaces: {
    tier: "userOwned",
    key: "spaces",
    why: "Spaces the user created or belongs to.",
  },
};

/**
 * Exactly the `users` columns an export may contain.
 *
 * An allowlist, never a blocklist. `authTables` is owned by the auth library
 * and can gain columns at any upgrade — a blocklist would silently start
 * exporting whatever was added, which is how a provider account id ends up in
 * a download.
 */
export const PROFILE_FIELDS = [
  "name",
  "email",
  "isAnonymous",
  "role",
  "emailVerificationTime",
] as const;

/** Columns stripped from every emitted row. Defence in depth, not the primary control. */
export const NEVER_EXPORT_FIELDS = [
  "token",
  "accessToken",
  "refreshToken",
  "secret",
  "apiKey",
  "password",
  "privateKey",
  "stateHash",
  "codeVerifier",
  "connectionToken",
] as const;

/**
 * Classify a table. **Unknown tables return `null`.**
 *
 * That is the load-bearing part: an unclassified table must not be guessed
 * into the export, because "default to including it" is the failure mode where
 * a future `apiKeys` table ships silently inside a user's backup.
 */
export function classifyTable(table: string): ExportClassification | null {
  return EXPORT_CLASSIFICATION[table] ?? null;
}

/** Tables whose rows are emitted under `key`. Empty for secret tables. */
export function exportableTables(): Array<{ table: string; key: string }> {
  return Object.entries(EXPORT_CLASSIFICATION)
    .filter(([, c]) => c.key !== null)
    .map(([table, c]) => ({ table, key: c.key as string }));
}

/**
 * Table names that must never appear in an export. Used by the harness to
 * assert absence by name, so adding a secret table without classifying it
 * fails loudly.
 */
export function secretTables(): string[] {
  return Object.entries(EXPORT_CLASSIFICATION)
    .filter(([, c]) => c.tier === "systemSecret")
    .map(([table]) => table);
}

/**
 * The deterministic header of every export.
 *
 * `exportedAt` is passed in rather than read so the export is reproducible in a
 * fixture; two exports of unchanged data differ only in this field.
 */
export function buildManifest(input: {
  userId: string;
  exportedAt: number;
  counts: Record<string, number>;
  withheld: Record<string, number>;
}): {
  format: "panel-export";
  version: 1;
  userId: string;
  exportedAt: number;
  guarantees: string[];
  counts: Record<string, number>;
  withheld: Record<string, number>;
} {
  return {
    format: "panel-export",
    version: 1,
    userId: input.userId,
    exportedAt: input.exportedAt,
    guarantees: [
      "Contains only rows you own, plus counts for records that name other people.",
      "Contains no credentials, tokens, keys, or session material of any kind.",
      "Contains no co-member's private data, even inside a space you share.",
      "Rows are the live values; no balance, total or derived figure is stored.",
    ],
    counts: input.counts,
    withheld: input.withheld,
  };
}
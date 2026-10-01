/**
 * Access resolution — the single place Panel decides "may this viewer reach
 * this object?" (ADR-009, SYSTEM_FUNDAMENTALS §4.2, §4.3, §4.4).
 *
 * This module is pure. It has no Convex import, no clock of its own, and no
 * knowledge of the database. Every decision it makes is a function of its
 * arguments, which is what makes the security model table-testable rather than
 * a pile of `if` statements scattered through query handlers.
 *
 * Three properties are load-bearing and are asserted in `permissions.test.ts`:
 *
 *  1. **Deny by default.** No membership and no grant means no access. There
 *     is no path through this file that returns `allowed` without a positive
 *     reason.
 *  2. **Grants fail closed.** An absent scope list excludes, it never includes.
 *     A grant with no `scopeKinds` reaches nothing.
 *  3. **Owner-only is absolute.** The learned model, its snapshots and the
 *     attention state are behavioural fingerprints. They are excluded before
 *     any grant is considered, so no grant — not even an over-broad one with
 *     no scope at all — can reach them.
 */

export type AccessLevel = "view" | "comment" | "edit" | "manage";

/** Ordered weakest to strongest. Comparison uses rank, never string order. */
export const ACCESS_LEVELS = ["view", "comment", "edit", "manage"] as const;

const LEVEL_RANK: Record<AccessLevel, number> = {
  view: 0,
  comment: 1,
  edit: 2,
  manage: 3,
};

/** The weakest level. Used as the "no access at all" sentinel. */

export function isAccessLevel(value: unknown): value is AccessLevel {
  return typeof value === "string" && value in LEVEL_RANK;
}

export function levelRank(level: AccessLevel): number {
  return LEVEL_RANK[level];
}

export function levelsMeet(have: AccessLevel | null, required: AccessLevel): boolean {
  if (have === null) return false;
  return levelRank(have) >= levelRank(required);
}

/** The stronger of two levels, or `null` when neither exists. */
export function maxLevel(a: AccessLevel | null, b: AccessLevel | null): AccessLevel | null {
  if (a === null) return b;
  if (b === null) return a;
  return levelRank(a) >= levelRank(b) ? a : b;
}

/**
 * Kinds excluded from every grant scope check (§4.3).
 *
 * These are not "private" in the ordinary sense — they are excluded from the
 * access *model*, so no scope combination can produce access to them.
 */
export const NEVER_SHARED_KINDS = [
  "assistantState",
  "modelSnapshots",
  "attentionState",
] as const;

/**
 * Kinds a grant can only ever reach by naming the specific object (§4.3).
 *
 * A note is private by default and "requires an explicit `objectIds` grant";
 * a private calendar event is never shared at all. A bare `kinds: ["note"]`
 * grant is therefore not enough for either.
 */
export const EXPLICIT_ID_ONLY_KINDS = ["note", "calendarEvent"] as const;

export type Visibility = "private" | "space";

/** The closed object-kind vocabulary mirrored from `src/convex/schema.ts`. */
export type ObjectKind =
  | "task"
  | "note"
  | "person"
  | "commitment"
  | "document"
  | "expense"
  | "taxProfile"
  | "taxDocument"
  | "calendarEvent"
  | "area"
  | "connection";

function isNeverShared(kind: string): boolean {
  return (NEVER_SHARED_KINDS as readonly string[]).includes(kind);
}

function isExplicitIdOnly(kind: string): boolean {
  return (EXPLICIT_ID_ONLY_KINDS as readonly string[]).includes(kind);
}

/**
 * Privacy tiers (§4.3), expressed as code rather than convention.
 *
 * A row that has not set `visibility` is *not* automatically space-visible:
 * these are the defaults, and a new table that forgets to write a visibility
 * field inherits the private default rather than leaking.
 */
const PRIVATE_BY_DEFAULT = new Set<string>([
  "note",
  "expense",
  "taxProfile",
  "taxDocument",
]);

/** Kinds whose visibility is decided per object rather than per kind. */
const VISIBILITY_PER_OBJECT = new Set<string>(["calendarEvent"]);

export function defaultVisibility(kind: string): Visibility {
  if (VISIBILITY_PER_OBJECT.has(kind)) return "private";
  return PRIVATE_BY_DEFAULT.has(kind) ? "private" : "space";
}

/** The visibility actually in force for an object, default applied. */
export function effectiveVisibility(target: AccessTarget): Visibility {
  return target.visibility ?? defaultVisibility(target.kind);
}

export type Grant = {
  spaceId: string;
  granteeUserId: string;
  level: AccessLevel;
  scopeKinds?: readonly string[] | null;
  scopeAreas?: readonly string[] | null;
  scopeObjectIds?: readonly string[] | null;
  grantedBy: string;
  grantedAt: number;
  expiresAt?: number | null;
  revokedAt?: number | null;
};

export type Membership = {
  spaceId: string;
  role: AccessLevel;
};

/** Everything the resolver is allowed to know about a viewer. */
export type Viewer = {
  userId: string;
  memberships: readonly Membership[];
  /** Only grants where this user is the grantee. Callers must pre-filter. */
  grants: readonly Grant[];
};

/** The subset of an object's fields that participate in an access decision. */
export type AccessTarget = {
  spaceId: string;
  ownerUserId: string;
  kind: string;
  id: string;
  /** Absent is treated as `space` for anything not explicitly private. */
  visibility?: Visibility | null;
  area?: string | null;
};

export type AccessVia = "owner" | "membership" | "grant";

export type AccessDecision = {
  allowed: boolean;
  level: AccessLevel | null;
  via: AccessVia | null;
  /** A stable machine code. Never a message, never interpolated from input. */
  reason:
    | "allow_owner"
    | "allow_membership"
    | "allow_grant"
    | "deny_owner_only"
    | "deny_private"
    | "deny_no_scope"
    | "deny_level"
    | "deny_no_membership"
    | "deny_unknown_level";
};

/**
 * A grant is live only while it is unrevoked and unexpired.
 *
 * A grant with `expiresAt` in the past is indistinguishable from one that
 * never existed. `now` is injected rather than read so expiry is testable
 * without a fake timer.
 */
export function grantIsLive(grant: Grant, now: number): boolean {
  if (grant.revokedAt != null) return false;
  if (grant.expiresAt != null && grant.expiresAt <= now) return false;
  return true;
}

/**
 * Whether a grant's scope reaches this object. **Fails closed.**
 *
 * Each scope dimension narrows. An absent or empty dimension is treated as
 * "this grant does not cover that axis", never as "no restriction", because the
 * alternative is that a malformed grant silently becomes a whole-space grant.
 */
export function grantCovers(grant: Grant, target: AccessTarget): boolean {
  if (isNeverShared(target.kind)) return false;

  // Fail closed: no kinds list means no coverage whatsoever.
  const kinds = grant.scopeKinds;
  if (!kinds || kinds.length === 0) return false;
  if (!kinds.includes(target.kind)) return false;

  // Names that only an explicit object id can unlock.
  if (isExplicitIdOnly(target.kind) && !namesObject(grant, target.id)) return false;

  // An area restriction narrows to objects that actually declare an area.
  const areas = grant.scopeAreas;
  if (areas && areas.length > 0) {
    if (!target.area) return false;
    if (!areas.includes(target.area)) return false;
  }

  // An object-id restriction narrows to exactly those objects.
  const ids = grant.scopeObjectIds;
  if (ids && ids.length > 0) {
    if (!ids.includes(target.id)) return false;
  }

  return true;
}

function namesObject(grant: Grant, objectId: string): boolean {
  const ids = grant.scopeObjectIds;
  return !!ids && ids.length > 0 && ids.includes(objectId);
}

/**
 * The access a viewer has to one object, without a required-level comparison.
 *
 * The owner always gets `manage` on their own objects: ownership is not a
 * permission that can be downgraded, and every read/write path in the app
 * already assumes the owner can reach their own data.
 */
export function resolveAccess(viewer: Viewer, target: AccessTarget, now: number): AccessDecision {
  if (target.ownerUserId === viewer.userId) {
    return { allowed: true, level: "manage", via: "owner", reason: "allow_owner" };
  }

  // Absolute: evaluated before membership and before any grant.
  if (isNeverShared(target.kind)) {
    return { allowed: false, level: null, via: null, reason: "deny_owner_only" };
  }

  const membership = viewer.memberships.find((m) => m.spaceId === target.spaceId);
  const isPrivate = effectiveVisibility(target) === "private";

  // The membership path: baseline role, but `private` objects are owner-only
  // however senior the member is.
  let level: AccessLevel | null = null;
  let via: AccessVia | null = null;
  let reason: AccessDecision["reason"] = "deny_no_membership";

  if (membership) {
    if (isPrivate) {
      reason = "deny_private";
    } else if (isAccessLevel(membership.role)) {
      level = membership.role;
      via = "membership";
      reason = "allow_membership";
    } else {
      reason = "deny_unknown_level";
    }
  }

  // The grant path: independent of membership and of the object's visibility,
  // because a grant is an explicit, scoped, expiring exception. Several grants
  // may reach the same object; the strongest live one wins.
  let grantLevel: AccessLevel | null = null;
  let sawCandidateGrant = false;
  for (const grant of viewer.grants) {
    if (grant.spaceId !== target.spaceId) continue;
    if (!grantIsLive(grant, now)) continue;
    sawCandidateGrant = true;
    if (!isAccessLevel(grant.level)) continue;
    if (!grantCovers(grant, target)) continue;
    grantLevel = maxLevel(grantLevel, grant.level);
  }

  if (grantLevel !== null) {
    if (maxLevel(level, grantLevel) === grantLevel) {
      level = grantLevel;
      via = "grant";
      reason = "allow_grant";
    }
    // Otherwise membership already gave the stronger level and the grant adds
    // nothing; the winning path stays the membership one.
  } else if (sawCandidateGrant && level === null) {
    // A live grant exists for this space but its scope does not reach this
    // object. That is the most common way sharing goes wrong, so it gets its
    // own code rather than being reported as "not a member".
    reason = "deny_no_scope";
  }

  if (level === null) {
    return { allowed: false, level: null, via: null, reason };
  }

  return { allowed: true, level, via, reason };
}

/** The single question the rest of the app asks: may this viewer read it? */
export function canRead(viewer: Viewer, target: AccessTarget, now: number): boolean {
  return can(viewer, target, "view", now).allowed;
}

/** Full level check, for the write paths. */
export function can(
  viewer: Viewer,
  target: AccessTarget,
  required: AccessLevel,
  now: number,
): AccessDecision {
  const decision = resolveAccess(viewer, target, now);
  if (!decision.allowed) return decision;
  if (!levelsMeet(decision.level, required)) {
    return { allowed: false, level: decision.level, via: decision.via, reason: "deny_level" };
  }
  return decision;
}

/**
 * The coarse filter a query applies *before* it loads rows.
 *
 * `resolveAccess` is exact but needs a row in hand. `scopeForViewer` answers
 * the cheap question "could anything in this space ever be readable by this
 * viewer at all?", so a query can narrow by index and then confirm per object.
 * It is a pre-filter, never an allow: `scopeAllows` returning true only means
 * "worth loading", not "permitted".
 */
export type ViewerScope = {
  userId: string;
  /** Spaces that contain at least one object this viewer could reach. */
  spaceIds: readonly string[];
  /** Kinds a grant could ever open up beyond the membership path. */
  grantKinds: readonly string[];
  /** Kinds no other viewer can ever reach. */
  ownerOnlyKinds: readonly string[];
};

export function scopeForViewer(viewer: Viewer, now: number): ViewerScope {
  const spaceIds = new Set<string>();
  for (const m of viewer.memberships) spaceIds.add(m.spaceId);
  for (const g of viewer.grants) {
    if (g.granteeUserId === viewer.userId && grantIsLive(g, now)) spaceIds.add(g.spaceId);
  }

  const grantKinds = new Set<string>();
  for (const g of viewer.grants) {
    if (g.granteeUserId !== viewer.userId) continue;
    if (!grantIsLive(g, now)) continue;
    for (const k of g.scopeKinds ?? []) grantKinds.add(k);
  }

  return { userId: viewer.userId, spaceIds: [...spaceIds], grantKinds: [...grantKinds], ownerOnlyKinds: [...NEVER_SHARED_KINDS] };
}

/**
 * Pre-filter membership test. Deliberately cheap and deliberately permissive:
 * it only rejects what is *impossible*, so it can never be the thing that
 * silently hides a row the user is entitled to.
 */
export function scopeAllows(scope: ViewerScope, target: AccessTarget): boolean {
  if (target.ownerUserId === scope.userId) return true;
  if (isNeverShared(target.kind)) return false;
  return scope.spaceIds.includes(target.spaceId);
}

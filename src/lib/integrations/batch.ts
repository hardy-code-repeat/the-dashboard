/**
 * The diff engine behind `applyBatch` (§7.1, ADR-012).
 *
 * Pure, total, and deliberately boring: given what the provider said and what
 * Panel currently holds, decide what to create, what to patch and what to
 * delete. No database, no clock, no network.
 *
 * Splitting the decision from the write is the whole point. Idempotency is a
 * property of *this function* and can therefore be tested with plain literals,
 * rather than being a property of a mutation that is only observable by running
 * it twice against a real deployment and hoping.
 *
 * The rules it enforces, in order:
 *
 *  1. **Identical input writes nothing.** An object whose fields already match
 *     is reported as `unchanged`. This is what makes a retried sync free and
 *     what stops a reconnect storm from churning rows.
 *  2. **A changed field is the only field written.** The patch is a shallow diff,
 *     not a row replacement, so a value another integration or the user wrote is
 *     not silently reverted by an upstream sync.
 *  3. **Deletion is explicit, never inferred.** An object absent from a
 *     complete page is a deletion; an object absent from an *incomplete* page is
 *     not, because "I did not fetch it" and "it is gone" are different facts.
 *     Getting this wrong deletes a user's data.
 */

import { externalKey, type NormalizedBatch, type NormalizedKind, type NormalizedObject } from "./types";

/** A key by which a stored row is addressed: kind + the provider's id. */
export type ExternalKey = string;

export function keyFor(kind: NormalizedKind, externalId: string): ExternalKey {
  return externalKey(kind, externalId);
}

/** What Panel currently holds, reduced to the fields the writer cares about. */
export interface StoredObject {
  key: ExternalKey;
  kind: NormalizedKind;
  externalId: string;
  fields: Record<string, unknown>;
}

export type DiffAction = "create" | "patch" | "unchanged" | "delete";

export interface DiffEntry {
  key: ExternalKey;
  kind: NormalizedKind;
  externalId: string;
  action: DiffAction;
  /** Only the fields that actually differ. Empty unless the action is patch. */
  patch: Record<string, unknown>;
  changedAt?: number;
}

export interface BatchDiff {
  entries: DiffEntry[];
  creates: number;
  patches: number;
  unchanged: number;
  deletes: number;
  /** True when nothing would be written. The idempotency assertion. */
  noop: boolean;
}

/** Scalar fields only — matching the `NormalizedObject.fields` type exactly. */
function isScalar(v: unknown): boolean {
  return (
    v === null ||
    typeof v === "string" ||
    typeof v === "number" ||
    typeof v === "boolean"
  );
}

/**
 * Rejects a batch that carries something we should not be storing.
 *
 * Cheap insurance with a real failure mode behind it: a provider that starts
 * returning an object where a string used to be would otherwise write a nested
 * document into a typed table, which is exactly the EAV-shaped accident ADR-008
 * exists to prevent.
 */
export function assertScalarFields(object: NormalizedObject): void {
  for (const [key, value] of Object.entries(object.fields)) {
    if (!isScalar(value)) {
      throw new Error(
        `Field "${key}" on ${object.kind}:${object.externalId} is not a scalar. Panel stores attributes, not documents.`,
      );
    }
  }
  if (!object.externalId.trim()) {
    throw new Error("A normalised object without an externalId is not idempotent.");
  }
}

/**
 * Decides what a batch would do. Writes nothing; the caller writes.
 *
 * `complete` comes from the provider and is the difference between "this object
 * is gone" and "this page did not include it".
 */
export function diffBatch(batch: NormalizedBatch, stored: StoredObject[]): BatchDiff {
  const byKey = new Map(stored.map((s) => [s.key, s] as const));
  const seen = new Set<ExternalKey>();
  const entries: DiffEntry[] = [];

  for (const object of batch.objects) {
    assertScalarFields(object);
    const key = keyFor(object.kind, object.externalId);
    if (seen.has(key)) {
      // The same object twice in one page. First one wins; a duplicate upstream
      // is a provider bug and must not become two rows here.
      continue;
    }
    seen.add(key);

    const current = byKey.get(key);
    if (!current) {
      entries.push({
        key,
        kind: object.kind,
        externalId: object.externalId,
        action: "create",
        patch: { ...object.fields },
        changedAt: object.changedAt,
      });
      continue;
    }

    // Shallow diff. `null` is a real value — it means "the provider says this
    // field is now empty" — so it is compared, not treated as absent.
    const patch: Record<string, unknown> = {};
    for (const [field, value] of Object.entries(object.fields)) {
      if (!Object.is(current.fields[field], value)) patch[field] = value;
    }

    entries.push({
      key,
      kind: object.kind,
      externalId: object.externalId,
      action: Object.keys(patch).length === 0 ? "unchanged" : "patch",
      patch,
      changedAt: object.changedAt,
    });
  }

  // Deletions, but only when we are sure the page was the whole truth.
  if (batch.complete) {
    for (const [key, row] of byKey) {
      if (seen.has(key)) continue;
      entries.push({
        key,
        kind: row.kind,
        externalId: row.externalId,
        action: "delete",
        patch: {},
      });
    }
  }

  const counts = { creates: 0, patches: 0, unchanged: 0, deletes: 0 };
  for (const e of entries) {
    if (e.action === "create") counts.creates += 1;
    else if (e.action === "patch") counts.patches += 1;
    else if (e.action === "unchanged") counts.unchanged += 1;
    else counts.deletes += 1;
  }

  return {
    entries,
    ...counts,
    noop: counts.creates === 0 && counts.patches === 0 && counts.deletes === 0,
  };
}



/**
 * The activity key `applySync` uses (§6 idempotency table).
 *
 * `sha256("sync" + provider + externalId + upstreamChangedAt)` in the spec; the
 * same string is produced here in a form that can be hashed by the caller with
 * whatever it has. Kept as a pure string builder so the hash function stays
 * outside `src/lib` (ADR-001: no crypto dependency for one string join).
 */
export function syncActivityKey(provider: string, externalId: string, changedAt: number): string {
  return `sync:${provider}:${externalId}:${changedAt}`;
}
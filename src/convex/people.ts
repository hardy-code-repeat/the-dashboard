/**
 * People (phase 3, feature 1).
 *
 * A person is a row. Before this, `PeopleArea` stored "catch up with mum every
 * week" in `tasks.title`, which meant a person could not be shared, linked,
 * reasoned about, or kept — only typed about.
 *
 * ## The design decision that shapes this file
 *
 * **A merge rewrites nothing.** `mergePeople` sets `mergedIntoId` on the source
 * row and stops. It does not move tasks, does not copy identity keys, does not
 * rewrite links. Everything that pointed at the source still points at the
 * source; every read resolves through the tombstone instead.
 *
 * That is what makes unmerge *exact*. There is no restoration step that could
 * half-run: unmerging clears two fields and every task, link and counter is
 * exactly where it was, because nothing was ever moved. A merge implemented as
 * "move the children" needs a journal to be reversible; this one does not.
 *
 * ## The decision this file refuses to make
 *
 * Nothing here merges automatically. A shared identity key produces a
 * *suggestion* the user sees and accepts or ignores (RJD-004: "Raj" ≠ "Raj").
 * `createPerson` refuses a probable duplicate unless the user passes `force`,
 * and refusing is not the same as merging: it declines to create a second row
 * and it tells the user which row it thought of.
 *
 * ## Authorisation
 *
 * Every read and every write is scoped by `ownerUserId`, which is the caller's
 * own id from the session — never an argument. There is no "view as" path and
 * no sharing path here: sharing a person is not a capability Panel has, and
 * adding one later means adding a grant check rather than loosening this.
 */

import { getAuthUserId } from "@convex-dev/auth/server";
import type { GenericMutationCtx, GenericQueryCtx } from "convex/server";
import { v } from "convex/values";

import {
  identityKeysFor,
  judgeMatch,
  matchingKeys,
  resolvedIdentityKeys,
} from "../lib/people";

import type { DataModel, Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { requireUserId } from "./assistant";
import { ensurePersonalSpace } from "./spaces";

type Ctx = GenericMutationCtx<DataModel> | GenericQueryCtx<DataModel>;

/** Longest display name. Bounded because a mutation writes it. */
const MAX_NAME = 120;
const MAX_NOTE = 2_000;
const MAX_EMAIL = 200;

/** People returned per query. The surface is a list; it is not an export. */
const MAX_PEOPLE = 200;

// ---------------------------------------------------------------------------
// reads
// ---------------------------------------------------------------------------

/**
 * Every live person, with the things the UI needs to be useful.
 *
 * Two things are deliberately *not* here: tombstones, and identity keys as raw
 * strings. A tombstone is not a person any more, and a raw key is machine data.
 * `matchHint` is the readable version, and it is only filled in when there is
 * something to say.
 */
export const listPeople = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return { people: [], mergedCount: 0 };

    const rows = await ctx.db
      .query("people")
      .withIndex("by_owner", (q) => q.eq("ownerUserId", userId))
      .collect();

    const live = rows.filter((r) => r.mergedIntoId === undefined);
    const byId = new Map(rows.map((r) => [r._id, r] as const));

    // Open tasks per person, resolved through tombstones so a task that points
    // at a merged-away row is still counted against the person the user sees.
    //
    // Read through `by_owner_person`, not `by_owner`: Convex leaves a document
    // out of an index when the indexed field is absent, so this range holds only
    // the tasks that actually name somebody. The alternative read every task the
    // user has ever created, on a query the dashboard subscribes to reactively.
    const tasks = await ctx.db
      .query("tasks")
      .withIndex("by_owner_person", (q) => q.eq("ownerUserId", userId))
      .collect();
    const openByPerson = new Map<string, number>();
    for (const task of tasks) {
      if (task.completed || !task.personId) continue;
      const resolved = resolveThroughTombstone(byId, task.personId);
      if (!resolved) continue;
      openByPerson.set(resolved, (openByPerson.get(resolved) ?? 0) + 1);
    }

    const liveIds = new Set(live.map((p) => p._id));
    const people = live.slice(0, MAX_PEOPLE).map((p) => {
      const keys = resolvedIdentityKeys(p, (id) => byId.get(id as Id<"people">) ?? null);
      const duplicate = findDuplicate(liveIds, byId, keys, p._id);
      return {
        id: p._id,
        name: p.name,
        note: p.note ?? null,
        hasEmail: typeof p.email === "string" && p.email.length > 0,
        createdAt: p.createdAt,
        openTasks: openByPerson.get(p._id) ?? 0,
        // "You already have someone called Raj" — evidence, not a verdict.
        matchHint: duplicate
          ? { id: duplicate._id, name: duplicate.name, ...judgeMatch(matchingKeys(keys, resolvedIdentityKeys(duplicate, (id) => byId.get(id as Id<"people">) ?? null))) }
          : null,
      };
    });

    people.sort((a, b) => a.name.localeCompare(b.name));

    return {
      people,
      // Shown so the user can see that a merge happened and can undo it. Hidden
      // merges are the thing this whole design exists to prevent.
      mergedCount: rows.length - live.length,
    };
  },
});

/**
 * One person and their open work.
 *
 * Resolved through tombstones: asking for a merged-away row returns the person
 * who absorbed it, because that is the person the user is asking about.
 */
export const getPerson = query({
  args: { id: v.id("people") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const row = await ctx.db.get(args.id);
    if (!row || row.ownerUserId !== userId) return null;

    const all = await ctx.db
      .query("people")
      .withIndex("by_owner", (q) => q.eq("ownerUserId", userId))
      .collect();
    const byId = new Map(all.map((r) => [r._id, r] as const));
    const resolved = resolveThroughTombstone(byId, args.id);
    const person = resolved ? byId.get(resolved) : null;
    if (!person) return null;

    // Only tasks that name somebody are relevant here, so the read is scoped to
    // them by the index rather than by a filter over everything the user owns.
    const tasks = await ctx.db
      .query("tasks")
      .withIndex("by_owner_person", (q) => q.eq("ownerUserId", userId))
      .collect();

    const mine = tasks.filter((t) => {
      if (!t.personId) return false;
      const target = resolveThroughTombstone(byId, t.personId);
      return target === person._id;
    });

    // Identity keys are shown as readable evidence, never as raw strings.
    const keys = resolvedIdentityKeys(person, (id) => byId.get(id as Id<"people">) ?? null);

    return {
      id: person._id,
      name: person.name,
      note: person.note ?? null,
      email: person.email ?? null,
      keys,
      mergedFrom: all
        .filter((r) => r.mergedIntoId === person._id)
        .map((r) => ({ id: r._id, name: r.name, mergedAt: r.mergedAt ?? null })),
      tasks: mine.map((t) => ({
        id: t._id,
        title: t.title,
        completed: t.completed,
        dueAt: t.dueAt ?? null,
        area: t.area,
      })),
    };
  },
});

// ---------------------------------------------------------------------------
// writes
// ---------------------------------------------------------------------------

/**
 * Creates a person.
 *
 * Refuses a probable duplicate unless `force` is set. The refusal is the point:
 * Panel has just been told it may not auto-merge (RJD-004), and the cheapest
 * honest implementation of that is to *decline to create the second row* and
 * name the row it thought of. Nothing is merged, nothing is deleted, and the
 * user can always insist.
 */
export const createPerson = mutation({
  args: {
    name: v.string(),
    email: v.optional(v.string()),
    note: v.optional(v.string()),
    /** Set by the user after reading the refusal. Never set automatically. */
    force: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const spaceId = await ensurePersonalSpace(ctx, userId);

    const name = args.name.trim().slice(0, MAX_NAME);
    if (!name) throw new Error("A person needs a name");

    const keys = identityKeysFor({ name, email: args.email ?? null });
    if (keys.length === 0) throw new Error("A person needs a name we can recognise");

    const existing = await ctx.db
      .query("people")
      .withIndex("by_owner", (q) => q.eq("ownerUserId", userId))
      .collect();

    const live = existing.filter((r) => r.mergedIntoId === undefined);
    const byId = new Map(existing.map((r) => [r._id, r] as const));
    for (const candidate of live) {
      const candidateKeys = resolvedIdentityKeys(candidate, (id) => byId.get(id as Id<"people">) ?? null);
      const verdict = judgeMatch(matchingKeys(keys, candidateKeys));
      if (!verdict.suggest) continue;
      if (args.force !== true) {
        return {
          created: false as const,
          duplicateOf: { id: candidate._id, name: candidate.name, reason: verdict.reason },
        };
      }
    }

    const id = await ctx.db.insert("people", {
      ownerUserId: userId,
      spaceId,
      name,
      // Computed server-side from the input, never accepted verbatim: a client
      // that could invent a key could manufacture evidence against somebody.
      identityKeys: keys,
      email: normaliseEmail(args.email),
      note: args.note?.trim().slice(0, MAX_NOTE) || undefined,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    await record(ctx, spaceId, "person.created", id);
    return { created: true as const, id };
  },
});

/**
 * Edits a person.
 *
 * Identity keys are **recomputed**, never merged with the old set: if the name
 * changes, the old `name:` key stops being evidence. Keeping it would mean the
 * person's old name kept matching things forever, which is how a "Raj" ends up
 * merged with three different people over the years.
 */
export const updatePerson = mutation({
  args: {
    id: v.id("people"),
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const row = await owned(ctx, args.id, userId);

    const name = args.name === undefined ? row.name : args.name.trim().slice(0, MAX_NAME);
    if (!name) throw new Error("A person needs a name");

    const email = args.email === undefined ? row.email : normaliseEmail(args.email);
    const keys = identityKeysFor({ name, email: email ?? null });

    await ctx.db.patch(args.id, {
      name,
      identityKeys: keys,
      email,
      note: args.note === undefined ? row.note : args.note?.trim().slice(0, MAX_NOTE) || undefined,
      updatedAt: Date.now(),
    });

    await record(ctx, row.spaceId, "person.updated", args.id);
    return { updated: true };
  },
});

/**
 * Merges one person into another. **Reversible.**
 *
 * Two writes' worth of work, and that is the entire implementation: set
 * `mergedIntoId` on the source. Tasks, links and counters are not touched,
 * because reads resolve through the tombstone. The source row is kept — deleting
 * it would break every task that points at it, and would make unmerge impossible.
 *
 * Refuses a self-merge, a merge into a tombstone (merge the real person), and a
 * merge that would create a cycle.
 */
export const mergePeople = mutation({
  args: { targetId: v.id("people"), sourceId: v.id("people") },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    if (args.targetId === args.sourceId) throw new Error("A person cannot be merged into themselves");

    const target = await owned(ctx, args.targetId, userId);
    const source = await owned(ctx, args.sourceId, userId);
    if (target.mergedIntoId !== undefined) {
      throw new Error("That person has already been merged into another");
    }
    if (source.mergedIntoId !== undefined) {
      throw new Error("That person has already been merged into another");
    }
    if (target.spaceId !== source.spaceId) {
      throw new Error("People in different spaces cannot be merged");
    }

    // Cycle guard: following the source's chain must not reach the target.
    let cursor: typeof source | undefined = source;
    for (let hop = 0; hop < 8 && cursor; hop += 1) {
      if (cursor._id === target._id) throw new Error("That would merge a person into themselves");
      cursor = cursor.mergedIntoId ? ((await ctx.db.get(cursor.mergedIntoId)) ?? undefined) : undefined;
    }

    await ctx.db.patch(source._id, { mergedIntoId: target._id, mergedAt: Date.now(), updatedAt: Date.now() });
    await record(ctx, target.spaceId, "person.merged", target._id, {
      merged: source.name,
      into: target.name,
    });

    return { merged: true, from: source.name, into: target.name };
  },
});

/**
 * Undoes a merge. **Exact.**
 *
 * Clears the two fields the merge set. Nothing else was changed, so nothing
 * else needs restoring — which is the whole reason merge was implemented this
 * way. A conformance run merges, unmerges, and asserts the row count, the task
 * links and the identity keys are identical either side.
 */
export const unmergePerson = mutation({
  args: { id: v.id("people") },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const row = await owned(ctx, args.id, userId);
    if (row.mergedIntoId === undefined) {
      return { unmerged: false as const, reason: "That person is not merged" };
    }

    await ctx.db.patch(args.id, {
      mergedIntoId: undefined,
      mergedAt: undefined,
      updatedAt: Date.now(),
    });
    await record(ctx, row.spaceId, "person.unmerged", args.id, { was: row.name });

    return { unmerged: true as const, name: row.name };
  },
});

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** The caller's own row, or nothing. `ownerUserId` is never an argument. */
async function owned(ctx: Ctx, id: Id<"people">, userId: Id<"users">) {
  const row = await ctx.db.get(id);
  if (!row || row.ownerUserId !== userId) {
    // Deliberately the same error for "does not exist" and "not yours": a
    // different message would confirm that someone else's person id is real.
    throw new Error("Person not found");
  }
  return row;
}

/** Follows `mergedIntoId` to the live person, cycle-guarded. */
/**
 * Follows a `mergedIntoId` chain to the live person at the end of it.
 *
 * **Exported** so anything holding a `personId` resolves it the same way —
 * `commitments.ts` needs this, and two copies of a tombstone walk is how one of
 * them ends up with a subtly different hop limit and quietly losing a row.
 *
 * The hop limit and the `seen` set are not decoration: they are what make a
 * cycle (which a merge bug or a hand-edited row could produce) terminate
 * instead of hanging a query.
 */
export function resolveThroughTombstone(
  byId: Map<Id<"people">, { _id: Id<"people">; mergedIntoId?: Id<"people"> }>,
  start: Id<"people">,
): Id<"people"> | null {
  let current: Id<"people"> = start;
  const seen = new Set<Id<"people">>();
  for (let hop = 0; hop < 8; hop += 1) {
    if (seen.has(current)) return null;
    seen.add(current);
    const row: { mergedIntoId?: Id<"people"> } | undefined = byId.get(current);
    if (!row) return null;
    if (!row.mergedIntoId) return current;
    current = row.mergedIntoId;
  }
  return null;
}

/**
 * Every person the caller owns, including tombstones, keyed by id.
 *
 * One read for the whole set, because a tombstone walk needs the whole chain in
 * memory: resolving row-by-row would be one query per hop, which is the N+1
 * shape D37/D41 were recorded for. Owner-scoped and index-scoped, which is what
 * makes the bound real rather than aspirational.
 *
 * **Exported** so anything that holds a `personId` resolves it identically —
 * `commitments.ts` and `attention.ts` both need the name behind a counterparty,
 * and a second tombstone walk is a second thing to get wrong.
 */
export async function peopleById(
  ctx: GenericQueryCtx<DataModel> | GenericMutationCtx<DataModel>,
  userId: Id<"users">,
): Promise<Map<Id<"people">, { _id: Id<"people">; name: string; mergedIntoId?: Id<"people"> }>> {
  const rows = await ctx.db
    .query("people")
    .withIndex("by_owner", (q) => q.eq("ownerUserId", userId))
    .collect();
  return new Map(rows.map((r) => [r._id, r]));
}

/**
 * The live person behind a `personId`, following tombstones.
 *
 * Returns `null` rather than throwing when the chain dangles or the target is
 * not in the map. A row pointing at somebody who has since been removed degrades
 * to "no counterparty" instead of making an entire list unreadable — and a list
 * that cannot be read is a much worse failure than a missing name.
 */
export function resolvePersonName(
  byId: Map<Id<"people">, { _id: Id<"people">; name: string }>,
  personId: Id<"people">,
): { _id: Id<"people">; name: string } | null {
  const target = resolveThroughTombstone(byId, personId);
  if (!target) return null;
  const row = byId.get(target);
  return row ? { _id: row._id, name: row.name } : null;
}

/** The first other live person sharing a key with `keys`, if any. */
function findDuplicate(
  liveIds: Set<Id<"people">>,
  byId: Map<Id<"people">, { _id: Id<"people">; name: string; identityKeys: string[]; mergedIntoId?: Id<"people"> }>,
  keys: readonly string[],
  self: Id<"people">,
) {
  if (keys.length === 0) return null;
  for (const id of liveIds) {
    if (id === self) continue;
    const row = byId.get(id);
    if (!row) continue;
    const shared = matchingKeys(keys, resolvedIdentityKeys(row, (x) => byId.get(x as Id<"people">) ?? null));
    if (judgeMatch(shared).suggest) return row;
  }
  return null;
}

/** An email is trimmed and lowercased; anything without an `@` is discarded. */
function normaliseEmail(email: string | undefined): string | undefined {
  const trimmed = email?.trim().toLowerCase().slice(0, MAX_EMAIL) ?? "";
  return trimmed.includes("@") ? trimmed : undefined;
}

async function record(
  ctx: GenericMutationCtx<DataModel>,
  spaceId: Id<"spaces">,
  kind: "person.created" | "person.updated" | "person.merged" | "person.unmerged",
  objectId: string,
  meta?: Record<string, string>,
): Promise<void> {
  await ctx.db.insert("activity", {
    spaceId,
    actor: "user",
    kind,
    objectKind: "person",
    objectId,
    meta,
    at: Date.now(),
  });
}

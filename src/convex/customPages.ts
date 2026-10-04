/**
 * Custom Pages (ADR-033, persistence shape resolved by Q-010).
 *
 * A Custom Page is a **saved view**: a named, ordered composition of capability
 * Panel already has. It is not a saved schema. That distinction is the entire
 * feature, and it is enforced structurally rather than by convention:
 *
 * - **One table, and it holds no domain data.** A row is a name, an area, and
 *   an ordered array of block kinds drawn from a closed union. There is nowhere
 *   to put a user-defined attribute even if a future editor wanted one, which
 *   is what keeps RJD-001 (the generic object table) unreachable rather than
 *   merely discouraged.
 * - **Every block resolves to a query that already exists.** `headline`,
 *   `taskList` and `note` read the dashboard's own payload; `people`, `money`,
 *   `commitments`, `documents` and `expenses` read their existing list queries.
 *   So opening a page issues no read the Main Panel would not have issued
 *   anyway. This module therefore contains **no aggregate data query at all** —
 *   the most important line in this file is the absence of one.
 * - **No attention kind.** A page cannot nag, cannot rank and cannot train, so
 *   ADR-006's guarantee (a tax deadline cannot be personalised away) holds on
 *   a surface the user fully controls.
 *
 * ## Why blocks are embedded and not rows (Q-010)
 *
 * The owner chose embedded. Rendering a page is the hot path, so one read beats
 * 1 + N; and because a page is capped at {@link PAGE_MAX_BLOCKS} blocks,
 * rewriting the array on edit costs nothing measurable. The argument that
 * decided it is atomicity: an embedded array means a page cannot half-exist,
 * which is the same reasoning ADR-029 used for a subscription and its renewal.
 */

import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";

import {
  requirePageArea,
  requirePageBlocks,
  requirePageName,
} from "../lib/customPages";
import { PAGES } from "../lib/readLimits";
import type { DataModel } from "./_generated/dataModel";
import { requireUserId } from "./assistant";
import { mutation, query } from "./_generated/server";
import { ensurePersonalSpace } from "./spaces";

/**
 * Every saved page, most recent first.
 *
 * **The cap is a receipt, not a truncation.** The read takes `PAGES + 1` and
 * reports `capped` when the extra row comes back — the same "cap + 1" pattern
 * `getDashboard` uses for its own truncation (D67). A page silently dropped from
 * a list is a page the user believes they saved and cannot find, which is the
 * exact failure the dashboard receipt exists to prevent.
 */
export const listPages = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return { pages: [], capped: false };

    const rows = await ctx.db
      .query("customPages")
      .withIndex("by_owner_createdAt", (q) => q.eq("ownerUserId", userId))
      // Ascending by creation, so the oldest are the ones that fall off the end
      // of a full list — the newest arrangement is never the one that vanishes.
      .take(PAGES + 1);

    const capped = rows.length > PAGES;
    return {
      pages: rows.slice(0, PAGES).map(view),
      capped,
    };
  },
});

/**
 * Save a page.
 *
 * Both caps are enforced here rather than trusted to the caller, because this
 * is the only place a page can come into existence. Convex cannot express a
 * length-bounded array, so `PAGE_MAX_BLOCKS` has to be checked in code; and
 * `PAGES` bounds a collection nothing else in the product would notice growing.
 */
export const createPage = mutation({
  args: {
    name: v.string(),
    area: v.string(),
    blocks: v.array(v.object({ kind: v.string() })),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const name = requirePageName(args.name);
    const blocks = requirePageBlocks(args.blocks);
    const area = requirePageArea(args.area);
    const spaceId = await ensurePersonalSpace(ctx, userId);

    const existing = await ctx.db
      .query("customPages")
      .withIndex("by_owner", (q) => q.eq("ownerUserId", userId))
      .take(PAGES);
    if (existing.length >= PAGES) {
      throw new Error(
        `You already have ${PAGES} pages. Delete one before saving another.`,
      );
    }

    const id = await ctx.db.insert("customPages", {
      ownerUserId: userId,
      spaceId,
      name,
      area,
      blocks,
      createdAt: Date.now(),
    });

    await ctx.db.insert("activity", {
      spaceId,
      actor: "user",
      kind: "page.created",
      objectKind: "page",
      objectId: id,
      at: Date.now(),
    });

    return id;
  },
});

/**
 * Change a saved page.
 *
 * **This mutation exists because its absence was a defect.** The first version
 * of Custom Pages could create a page and delete one but not change one, so a
 * user who picked the wrong blocks had to throw the whole arrangement away and
 * rebuild it. A feature that can only be right once is not finished, and the
 * cost here is one mutation reusing three validators that already exist.
 *
 * It is a `patch`, not a replace-and-reinsert, so the page keeps its identity
 * and its `createdAt` — and therefore its position in the list order — which is
 * what "editing" has to mean for a thing described as a saved arrangement.
 */
export const updatePage = mutation({
  args: {
    id: v.id("customPages"),
    name: v.optional(v.string()),
    area: v.optional(v.string()),
    blocks: v.optional(v.array(v.object({ kind: v.string() }))),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const row = await ctx.db.get(args.id);
    // Indistinguishable from "does not exist", so the id cannot be probed.
    if (!row || row.ownerUserId !== userId) throw new Error("Page not found");

    // Validate everything **before** the patch.
    //
    // The reason is *not* atomicity. An earlier version of this comment claimed
    // that patching as it validated could leave a half-applied page, and that
    // was false: a Convex mutation is transactional, so the throw rolls the
    // whole call back. Proving it took a planted mutation — patching the name
    // before validating the area — and P8.7 still passed, because the platform
    // reverted the patch along with everything else. Correcting a comment that
    // credited this function with a guarantee the database provides is the
    // whole point of running the mutation rather than reasoning about it.
    //
    // Validating first is still right: the error names the offending value
    // before any work is done, and a rejected update costs nothing.
    const name = args.name === undefined ? undefined : requirePageName(args.name);
    const area = args.area === undefined ? undefined : requirePageArea(args.area);
    const blocks = args.blocks === undefined ? undefined : requirePageBlocks(args.blocks);

    await ctx.db.patch(args.id, {
      ...(name === undefined ? {} : { name }),
      ...(area === undefined ? {} : { area }),
      ...(blocks === undefined ? {} : { blocks }),
    });

    return { updated: 1 };
  },
});

/**
 * Delete a page.
 *
 * Irreversible, and reachable in the interface only through `ConfirmAction`.
 * It deletes the arrangement and nothing else: a page owns no domain rows, so
 * there is no cascade here to get wrong and no task, document or commitment
 * that can be lost by removing the view that listed it.
 */
export const deletePage = mutation({
  args: { id: v.id("customPages") },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const row = await ctx.db.get(args.id);
    // A page belonging to somebody else is indistinguishable from one that
    // does not exist, so the id cannot be probed for existence.
    if (!row || row.ownerUserId !== userId) throw new Error("Page not found");

    await ctx.db.delete(args.id);

    await ctx.db.insert("activity", {
      spaceId: row.spaceId,
      actor: "user",
      kind: "page.deleted",
      objectKind: "page",
      objectId: args.id,
      at: Date.now(),
    });

    return { deleted: 1 };
  },
});

// ---------------------------------------------------------------------------
// The row shape the client receives.
//
// Note what is NOT here: no `props`, no `filter`, no per-block configuration.
// A block is a kind, so a saved page cannot express a query Panel does not
// already run. That is the structural half of ADR-033 — the other half being
// the closed union above, which no caller can widen.
// ---------------------------------------------------------------------------

function view(row: DataModel["customPages"]["document"]) {
  return {
    id: row._id,
    name: row.name,
    area: row.area,
    blocks: row.blocks,
  };
}
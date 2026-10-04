/**
 * Custom Pages — the pure rules (ADR-033, resolved by Q-010).
 *
 * Everything here is a total function over plain data with no clock, no
 * database and no Convex import, which is the `src/lib` half of ADR-002. The
 * reason it is split out rather than living inside `src/convex/customPages.ts`
 * is not tidiness: **a rule that only exists inside a mutation cannot be
 * tested**, and the whole point of the closed block vocabulary is that it
 * cannot be widened. So the enforcement is here, in a file `bun test` can
 * reach, and the mutation calls it.
 *
 * ## What these functions refuse, and why each refusal is a real one
 *
 * - **An empty block array.** A page with no blocks renders nothing. Catching
 *   it at write time costs one comparison; catching it later costs a blank
 *   screen and a confused user.
 * - **More than {@link PAGE_MAX_BLOCKS}.** The cap is what made embedded
 *   storage the right answer to Q-010; it has to actually hold.
 * - **An unknown block kind.** This is the one that protects the architecture.
 *   A block that may name anything is RJD-001 — the generic object table that
 *   ADR-007 rejected — reached through the front door rather than the back.
 * - **A duplicate kind.** Silently collapsing two identical blocks would make
 *   the saved page differ from the one the user built, and the *next* save
 *   would then remove a block they could still see.
 *
 * Every error message names the offending value. A validation layer that
 * reports "invalid input" makes the user guess, and guessing at a closed
 * vocabulary is how a vocabulary gets widened by accident.
 */

import { PAGE_MAX_BLOCKS } from "./readLimits";

/**
 * The closed block vocabulary (ADR-033).
 *
 * Every kind resolves to a query Panel already had before this file existed:
 * `headline`, `taskList` and `note` read the dashboard payload; `people`,
 * `money`, `commitments`, `documents` and `expenses` read their own list
 * queries. Adding a kind here therefore has a cost that is visible in review —
 * it demands a renderer and an existing read — which is the mechanism that
 * keeps the vocabulary closed without anyone policing it.
 */
export const PAGE_BLOCK_KINDS = [
  "headline",
  "taskList",
  "people",
  "money",
  "commitments",
  "documents",
  "expenses",
  "note",
] as const;

export type PageBlockKind = (typeof PAGE_BLOCK_KINDS)[number];

/** One block: a kind and nothing else. See `pageBlockValidator` in the schema. */
export interface PageBlock {
  readonly kind: PageBlockKind;
}

/**
 * The areas a page may be filed under.
 *
 * Deliberately the **existing** closed union. A Custom Page is not a seventh
 * area and not a new tab kind, so `areaSlugValidator` is never widened and D66
 * (the unreachable `custom` kind) stays unreachable.
 */
export const PAGE_AREA_SLUGS = [
  "general",
  "finance",
  "relationships",
  "health",
  "home",
  "life",
] as const;

export type PageAreaSlug = (typeof PAGE_AREA_SLUGS)[number];

/** Longest page name accepted. A page name is a heading, not a document. */
export const MAX_PAGE_NAME = 60;

/** True when `kind` is in the vocabulary. Exported for the client renderer. */
export function isPageBlockKind(value: unknown): value is PageBlockKind {
  return (
    typeof value === "string" &&
    (PAGE_BLOCK_KINDS as readonly string[]).includes(value)
  );
}

export function isPageAreaSlug(value: unknown): value is PageAreaSlug {
  return (
    typeof value === "string" &&
    (PAGE_AREA_SLUGS as readonly string[]).includes(value)
  );
}

/** Trim, and refuse a name that is empty or absurdly long. */
export function requirePageName(raw: string): string {
  const name = raw.trim();
  if (name.length === 0) throw new Error("A page needs a name.");
  if (name.length > MAX_PAGE_NAME) {
    throw new Error(`A page name can be at most ${MAX_PAGE_NAME} characters.`);
  }
  return name;
}

/**
 * Validate a page's ordered blocks and return them narrowed.
 *
 * Returns the blocks *in the order given* and with no other property, so the
 * caller's row cannot carry anything this function did not check. That is the
 * difference between validating input and sanitising it: the value written to
 * the database is exactly the value returned here.
 */
export function requirePageBlocks(raw: ReadonlyArray<{ kind: string }>): PageBlock[] {
  if (raw.length === 0) throw new Error("A page needs at least one block.");
  if (raw.length > PAGE_MAX_BLOCKS) {
    throw new Error(
      `A page can hold at most ${PAGE_MAX_BLOCKS} blocks (got ${raw.length}).`,
    );
  }

  const blocks: PageBlock[] = [];
  const seen = new Set<string>();
  for (const block of raw) {
    if (!isPageBlockKind(block.kind)) {
      throw new Error(`"${String(block.kind)}" is not a block Panel can show.`);
    }
    if (seen.has(block.kind)) {
      throw new Error(`"${block.kind}" is already on this page.`);
    }
    seen.add(block.kind);
    blocks.push({ kind: block.kind });
  }
  return blocks;
}

export function requirePageArea(raw: string): PageAreaSlug {
  if (!isPageAreaSlug(raw)) {
    throw new Error(`"${raw}" is not an area.`);
  }
  return raw;
}
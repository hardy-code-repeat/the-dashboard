/**
 * Page templates — the closed catalogue of Custom Page starting arrangements.
 *
 * ## What problem this actually solves
 *
 * Custom Pages (ADR-033) let a user compose a saved view from eight block kinds.
 * Reading `src/components/CustomPages.tsx` before this file existed: the create
 * form was a blank name field, an area select, and **eight raw checkboxes** with
 * no indication of which combination is worth having. A user who guesses wrong
 * gets a saved page that is not useful, and — because they cannot see what a
 * good page looks like — no way to tell that it is not.
 *
 * So the problem is a **starting point**, and the whole increment is scoped to
 * that word. It is not a template *system*.
 *
 * ## Why this is not a table, and must never become one
 *
 * Every field here is a compile-time constant. There is nothing to administer,
 * nothing to migrate, nothing to author at runtime and nothing to delete. A
 * `pageTemplates` table would be a second persistence system whose entire
 * contents are known at build time — the same mistake ADR-007 rejected when it
 * declined a generic object table, reached from the other direction.
 *
 * The decisive constraint is the one the catalogue inherits for free: a template
 * holds **block kinds only**, so it cannot name a query Panel does not already
 * run and cannot carry a user-defined attribute. The template catalogue cannot
 * become an EAV door, because it is not a place data goes.
 *
 * ## What a template is not allowed to do
 *
 * - It does not **validate** anything. It hands values to the *existing*
 *   `requirePageName` / `requirePageArea` / `requirePageBlocks`, which are
 *   already the single enforcement point in `customPages.ts`. A template that
 *   could save a page directly would be a second write path.
 * - It does not **persist** anything. Applying one fills the form; the user
 *   still edits freely and still presses Save. What gets stored is an ordinary
 *   page with an ordinary lifecycle.
 * - It does not **nag**. No attention kind, no ranking, no training — so
 *   ADR-006's guarantee holds on this surface too.
 * - It does not **fail open**. `getPageTemplate` returns `undefined` for an
 *   unknown id rather than a default, because a default would silently create
 *   the wrong page under a name the user did not choose.
 */

import {
  requirePageArea,
  requirePageBlocks,
  requirePageName,
  type PageAreaSlug,
  type PageBlockKind,
} from "./customPages";

/**
 * The catalogue.
 *
 * `as const` is load-bearing: it is what makes `PageTemplateId` a **closed
 * union** below rather than `string`. A template id that was a free string would
 * eventually be used to look something up, and "look up" is where a table
 * arrives.
 *
 * Each entry is a real arrangement of things Panel already has — no new read,
 * no new kind, no new area. `area` is the *existing* union, so a template is
 * not a seventh area.
 */
const CATALOGUE = [
  {
    id: "morning",
    name: "Morning briefing",
    area: "general",
    // What you want before you have done anything yet today.
    blocks: ["headline", "taskList", "note"],
  },
  {
    id: "money",
    name: "Money",
    area: "finance",
    // Balances answer "where do I stand"; expenses answer "where did it go".
    blocks: ["money", "expenses"],
  },
  {
    id: "owed",
    name: "Who owes what",
    area: "life",
    // Commitments carry the titles; people carry who to ask.
    blocks: ["commitments", "people"],
  },
  {
    id: "paperwork",
    name: "Paperwork",
    area: "life",
    // Documents and commitments overlap on purpose: a form to sign is both.
    blocks: ["documents", "commitments"],
  },
] as const;

/** Every template id Panel knows. Closed — see the note on `as const`. */
export type PageTemplateId = (typeof CATALOGUE)[number]["id"];

/** One starting arrangement. No payload, no filter, no configuration. */
export interface PageTemplate {
  readonly id: PageTemplateId;
  readonly name: string;
  readonly area: PageAreaSlug;
  readonly blocks: readonly PageBlockKind[];
}

/** The catalogue, typed for consumers. The id union is preserved above. */
export const PAGE_TEMPLATES: readonly PageTemplate[] = CATALOGUE;

export const PAGE_TEMPLATE_IDS: readonly PageTemplateId[] = CATALOGUE.map((t) => t.id);

/** True when `id` names a template Panel ships. */
export function isPageTemplateId(value: unknown): value is PageTemplateId {
  return (
    typeof value === "string" && (PAGE_TEMPLATE_IDS as readonly string[]).includes(value)
  );
}

/**
 * Look up a template, or nothing.
 *
 * Returning `undefined` for an unknown id is deliberate. A fallback to the first
 * template would mean that a stale or hand-edited id produces a real page under
 * a name nobody chose — the failure mode where a system looks like it worked.
 */
export function getPageTemplate(id: unknown): PageTemplate | undefined {
  if (!isPageTemplateId(id)) return undefined;
  return PAGE_TEMPLATES.find((t) => t.id === id);
}

/**
 * Turn a template into the three values the create form already holds.
 *
 * The blocks go through **`requirePageBlocks`**, which is the whole point: a
 * template is not trusted, it is a convenience. If the vocabulary ever moved
 * under a template, applying it would throw here with the offending kind named,
 * at the moment of use, rather than producing a page the server will reject.
 *
 * The returned blocks are the ones the form will submit, so a template cannot
 * smuggle an extra field past the form and into `createPage`.
 */
export function applyPageTemplate(id: PageTemplateId): {
  name: string;
  area: PageAreaSlug;
  blocks: PageBlockKind[];
} {
  const template = getPageTemplate(id);
  if (!template) throw new Error(`"${String(id)}" is not a page template.`);

  const name = requirePageName(template.name);
  const area = requirePageArea(template.area);
  const blocks = requirePageBlocks(
    template.blocks.map((kind) => ({ kind })),
  );

  return {
    name,
    area,
    blocks: blocks.map((b) => b.kind),
  };
}

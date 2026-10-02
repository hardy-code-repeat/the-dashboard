/**
 * Contextual Add: what an area offers, declared as data (phase 4, feature 4A).
 *
 * The problem this solves is not "where do I put a button". It is that a single
 * generic Add made *every* capture become a task, so an area with real domain
 * objects — accounts, subscriptions, expenses, transactions, people, documents —
 * could only offer to create a task. Tasks became the universal representation
 * because the UI had exactly one verb.
 *
 * ## The rule this module exists to enforce
 *
 * **A verb may only appear if a mutation for it already exists.** Every entry
 * below names the exact `module:function` it resolves to, and the conformance
 * harness asserts each name is reachable on the generated API. A verb with no
 * capability behind it cannot be declared here, which is the structural version
 * of "do not expose fake actions" — not a review convention.
 *
 * ## Why a descriptor table and not per-area components
 *
 * Six areas × N verbs is N×6 near-identical components whose only difference is
 * a label. Data is the cheaper shape, and it is the one that can be *checked*:
 * the set of verbs is a value, so a test can assert it. Six components could
 * only be asserted by reading them.
 *
 * ## What it deliberately does not do
 *
 * It does not create anything, it does not know what a form looks like, and it
 * does not import React or Convex. The area supplies the handlers keyed by verb
 * id; this module decides which ids are offered.
 */

/** The closed verb vocabulary. A verb is a domain object the user can create. */
export type AreaVerbId =
  | "task"
  | "capture"
  | "expense"
  | "income"
  | "account"
  | "subscription"
  | "transaction"
  | "document"
  | "person"
  | "commitment"
  | "note";

export interface AreaVerb {
  id: AreaVerbId;
  /** What the button says. */
  label: string;
  /** One line saying what it creates, so the menu is not a list of nouns. */
  hint: string;
  /**
   * The mutation this verb writes through, as `module:function`.
   *
   * Named rather than imported so the binding can be asserted at runtime
   * against the generated API — a test that a symbol exists is worth more than a
   * type that says it might.
   */
  target: string;
}

/**
 * Every verb Panel can offer, and the one mutation behind it.
 *
 * A `direction` of `owedTo` is the same mutation as `owed` with a different
 * argument, so it is one verb with a label that says which is which — two verbs
 * pointing at one mutation would be a duplicate concept in the vocabulary.
 */
export const VERBS: Record<AreaVerbId, AreaVerb> = {
  transaction: {
    id: "transaction",
    label: "Transaction",
    hint: "Money in or out, with a date. Panel keeps the fact, never a balance.",
    target: "transactions:createTransaction",
  },
  account: {
    id: "account",
    label: "Account",
    hint: "A name for where money leaves from. No balance is stored.",
    target: "subscriptions:createAccount",
  },
  subscription: {
    id: "subscription",
    label: "Subscription",
    hint: "Something recurring, with a price and a renewal date.",
    target: "subscriptions:createSubscription",
  },
  expense: {
    id: "expense",
    label: "Expense",
    hint: "One spend, categorised for the tax estimate.",
    target: "life:addExpense",
  },
  income: {
    id: "income",
    label: "Income",
    hint: "Total income for the year, used by the estimate.",
    target: "life:saveTaxProfile",
  },
  document: {
    id: "document",
    label: "Document",
    hint: "Something with an expiry — a policy, a licence, a statement.",
    target: "documents:createDocument",
  },
  person: {
    id: "person",
    label: "Person",
    hint: "Somebody worth keeping track of. Never merged automatically.",
    target: "people:createPerson",
  },
  commitment: {
    id: "commitment",
    label: "Promise or wait",
    hint: "Something you owe, or something you are waiting on.",
    target: "commitments:createCommitment",
  },
  task: {
    id: "task",
    label: "Task",
    hint: "Something to do. One object among several, not the default.",
    target: "assistant:addTask",
  },
  note: {
    id: "note",
    label: "Note",
    hint: "Something worth writing down that is not an obligation.",
    target: "assistant:addNote",
  },
  capture: {
    id: "capture",
    label: "Capture",
    hint: "Type naturally and let the parser decide what it is.",
    target: "assistant:capture",
  },
};

/**
 * What each area offers.
 *
 * Read this as a product statement, not a menu: General is the universal
 * capture surface and may be task-centric; Finance is a money workspace, so its
 * most prominent verbs are money; Relationships is about people and promises;
 * Life Admin is about things that expire. An area whose list is identical to
 * another's is the defect this whole change exists to remove.
 *
 * Order is display order: the area's own domain first, universal capture last.
 */
export const AREA_VERBS: Record<string, readonly AreaVerbId[]> = {
  // General is the universal capture surface, so capture leads here — and only
  // here. Everywhere else, an area's own domain leads and capture is the last
  // resort, because a menu that starts with the generic verb is what made every
  // area feel identical.
  general: ["capture", "task", "commitment", "person", "note"],
  finance: [
    "transaction",
    "expense",
    "account",
    "subscription",
    "income",
    "document",
    "task",
    "capture",
  ],
  relationships: ["person", "commitment", "task", "capture"],
  life: ["document", "task", "capture"],
  health: ["capture", "task"],
  home: ["capture", "task"],
};

/**
 * Areas with **no domain model at all** today.
 *
 * Health renders a mock habit tracker (D50, deliberately unfixed by product
 * decision) and Home has never had a domain body — it falls through to the
 * generic task surface. Both therefore offer exactly the two things that are
 * genuinely true of them, and claiming more would be a menu describing
 * capability that does not exist.
 *
 * This list is exported so the rule is checkable rather than a comment: these
 * are the only areas allowed to share a verb list, and the moment one of them
 * gains a real domain model it must come out of this set.
 */
export const AREAS_WITHOUT_A_DOMAIN_MODEL: readonly string[] = ["health", "home"];

export function verbsForArea(area: string): readonly AreaVerb[] {
  const ids = AREA_VERBS[area] ?? [];
  return ids
    .map((id) => VERBS[id])
    .filter((verb): verb is AreaVerb => verb !== undefined);
}

/** The mutations an area's menu depends on — what the harness asserts exists. */
export function targetsForArea(area: string): string[] {
  return verbsForArea(area).map((v) => v.target);
}

/** Every target the whole product can reach, for one repository-wide check. */
export function allTargets(): string[] {
  return [...new Set(Object.values(AREA_VERBS).flatMap((ids) => ids.map((id) => VERBS[id].target)))];
}

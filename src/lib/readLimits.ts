/**
 * Read limits — the one place a row cap is decided.
 *
 * ## Why this file exists
 *
 * Caps were previously scattered: `AUDIT_SCAN_LIMIT` was defined three times
 * (assistant.ts, commitments.ts, documents.ts) and `MAX_ACCOUNTS` twice, with
 * no shared record of what each number was *for*. Duplicated constants drift,
 * and a drifted cap is invisible — nothing fails when two audit scans disagree
 * about their limit. So the numbers live here once, and every read that needs
 * one imports it.
 *
 * ## The rule this file encodes
 *
 * D48: a bounded *result* is not evidence of bounded *database access*. Every
 * user-facing read in `src/convex/` must terminate in one of:
 *
 * - `.take(n)` — a cap, and
 * - an index **range** — an equality or inequality that narrows the scan.
 *
 * A cap without a range still scans an entire index partition; a range without
 * a cap still reads every row a user has ever written. Both are required, and
 * that is why the audit in `scripts/audit-bounded-reads.ts` reports the index
 * alongside the verdict rather than just "is there a take".
 *
 * ## The one honest exception
 *
 * A handful of reads are unbounded *by construction*: the row count is fixed by
 * a closed vocabulary in the product, not by anything the user can do. An
 * `areas` row can only exist for a slug in the area catalogue, so "every area
 * this user has enabled" is at most `AREAS.length` rows no matter how hard
 * anyone pushes. Those are listed in {@link CLOSED_VOCABULARY_READS} with the
 * reason attached.
 *
 * That list is deliberately narrow and deliberately *written down*. The
 * alternative — leaving exceptions implicit — is how a bounded read audit turns
 * into a rubber stamp, and this project has already been bitten by a green
 * check that meant nothing (D60). Every entry must name a bound that is
 * enforced somewhere in the product; `readLimits.test.ts` fails if an entry
 * loses its justification.
 */

/**
 * Cap on the task list the dashboard ranks.
 *
 * The dashboard computes a score per task and shows the results in score order,
 * which means the *whole* open set is genuinely needed to find the best one —
 * there is no index that yields "the top 200 by a computed score". So this cap
 * is a real trade, not a free win, and it is the one number in this file raised
 * as a product question (D61).
 *
 * What it bounds is the **scan**, and it is applied to a deterministic order:
 * `by_owner_open` ordered newest-first. A user with more open tasks than this
 * gets the most recent ones, and the payload says so via `tasksTruncated`
 * rather than pretending the board is complete. Truncating silently would be
 * worse than the unbounded read it replaces, because the ranking would then
 * depend on index order and nobody would know.
 *
 * 200 sits above every comparable task surface (Todoist, Things and TickTick all
 * render or fetch in the tens-to-low-hundreds) while staying small enough that
 * scoring and rendering stay well inside a single request.
 */
export const DASHBOARD_TASKS = 200;

/**
 * Cap on the task read behind `clearCompleted`.
 *
 * A mutation, so this one matters more than a read: unbounded, it both scans
 * and deletes without limit inside a single transaction. It is capped and the
 * result reports what was cleared, so the UI can tell the user the clear was
 * partial instead of quietly leaving rows behind.
 */
export const CLEAR_COMPLETED_BATCH = 200;

/**
 * Cap on the task read behind the Attention feed.
 *
 * The feed produces a ranked, capped list of *signals*, not a task browser, so
 * the number of tasks it may consider is a product decision bounded by the
 * size of a screen. Deliberately smaller than the dashboard's: Attention is
 * meant to be the short list.
 */
export const ATTENTION_TASKS = 200;

/**
 * How far ahead the Attention feed looks for meetings.
 *
 * The previous read was `by_space` with no bound at all — every calendar event
 * the user has ever had, in their entire history, on every Attention load. It is
 * now a `startsAt` range over this window, which is what the feed means by
 * "what is coming up", plus a cap for the pathological case of a very busy
 * week.
 */
export const ATTENTION_CALENDAR_DAYS = 14;
export const ATTENTION_CALENDAR_EVENTS = 100;

/** Cap on `calendar:upcomingEvents` — already time-bounded, still needs a cap. */
export const UPCOMING_EVENTS = 200;

/** Cap on the people a single list read returns. */
export const PEOPLE = 200;

/**
 * Cap on a user's model snapshots.
 *
 * `takeSnapshot` already deletes all but `MAX_SNAPSHOTS` after each write, but
 * the *read* that finds the surplus was an unbounded collect — so a user who
 * somehow accumulated extra rows paid for them on every version bump. Bounding
 * the read with the same number the write keeps is what makes the two agree.
 */
export const MODEL_SNAPSHOTS = 20;

/** Cap on documents in a list read. */
export const DOCUMENTS = 200;

/**
 * Cap on expenses behind the tax estimate.
 *
 * Feeds a *number*, so it carries the same warning as
 * {@link TRANSACTION_AGGREGATE}. The read is a `spentAt` range over a single
 * tax year, so it is bounded in time, and 2000 expenses in a year is far past
 * anything a real person files — but a cap that only holds because the
 * estimate is probably small is not a cap.
 */
export const EXPENSES = 2000;

/**
 * Cap on tasks that point at *another* object — a renewal, a follow-up chase,
 * a person.
 *
 * These read through `by_owner_document` / `by_owner_commitment` /
 * `by_owner_person`, which is much narrower than "every task": Convex drops a
 * row from an index when the indexed field is absent, so each range holds only
 * the tasks that actually name their subject. Narrow is not the same as
 * bounded, though, and a user who has chased the same thing for two years
 * should not make every list read scale with how long they have been waiting.
 *
 * One cap for all three, because they are the same decision: how much
 * association data is worth loading in order to annotate a list.
 */
export const ASSOCIATED_TASKS = 500;

/**
 * Cap on a user's integration connections.
 *
 * Bounded in practice by the provider catalogue, but the read is on the hot
 * path and "in practice" is not a cap.
 */
export const CONNECTIONS = 50;

/** Cap on commitments in a list read. */
export const COMMITMENTS = 200;

/**
 * Cap on a user's spaces and memberships.
 *
 * One personal space plus whatever they have been invited to, so this is
 * bounded by the product in practice — but "in practice" is not a cap, and the
 * reads that use it are on the hot path.
 */
export const SPACES = 100;

/**
 * Cap on attention feedback rows.
 *
 * NOT a closed vocabulary, despite living next to the two tables that are. A
 * row is one per distinct attention item the user has seen, keyed by
 * fingerprint, so this grows with how long someone has used the product. See
 * {@link NOT_CLOSED_VOCABULARY}.
 */
export const ATTENTION_FEEDBACK = 500;

/** Cap on stored provider tokens for one (owner, provider) pair. */
export const CONNECTION_TOKENS = 50;

/** Cap on subscriptions / accounts / imports, matching the existing constants. */
export const SUBSCRIPTIONS = 200;
export const ACCOUNTS = 20;
export const IMPORTS = 20;

/**
 * How many Custom Pages one user may keep (ADR-033, Q-010).
 *
 * Bounded on the **write** path as well as the read, because an uncapped
 * collection here is the one place a Custom Page could grow without limit: the
 * page stores no data of its own, so nothing else in the product would ever
 * notice a user accumulating thousands of them. The cap is enforced on
 * `createPage` and reported by `listPages` as `capped`, so the limit is a
 * receipt rather than a silent truncation (D67).
 *
 * 50 is well above the number of arrangements a person actually composes. A
 * page is a saved arrangement of existing capability, not a document, so the
 * useful set is small; the cap is here to bound the read, not to ration a
 * feature.
 */
export const PAGES = 50;

/**
 * How many blocks one Custom Page may hold (ADR-033).
 *
 * This is the number that decided Q-010. Because it is small and fixed, an
 * embedded array is the cheaper shape: rewriting twelve blocks on every edit
 * costs nothing measurable, while one-row-per-block would turn rendering a page
 * into 1 + N reads on the hot path.
 *
 * Enforced at the single write path, because Convex cannot express a
 * length-bounded array in a validator. That is a real gap in the type system
 * and it is closed here, in one place, rather than trusted to each caller.
 */
export const PAGE_MAX_BLOCKS = 12;

/**
 * Cap on the transaction rows behind a **derived balance**.
 *
 * This one carries a warning the other caps do not. See "The two kinds of
 * truncation" at the top of the file: a truncated sum is a wrong number wearing
 * a currency symbol.
 *
 * Both balance queries therefore read `cap + 1` rows and return
 * `provisional: true` when the extra row comes back, and the UI says the figure
 * is partial. The real fix for a user with more history than this is a
 * maintained balance column or a rollup, not a larger constant — recorded as
 * D62 rather than pretended away here.
 */
export const TRANSACTION_AGGREGATE = 5000;

/** Cap on a bounded audit scan over the activity log. */
export const AUDIT_SCAN_LIMIT = 500;

/** Cap on the ownership audit's per-table count. */
export const OWNERSHIP_AUDIT_ROWS = 5000;

/**
 * Caps for the Admin Control Centre (ADR-032, CHANGE-0027).
 *
 * These are different in kind from every cap above, and the difference is worth
 * stating before the numbers, because it is the whole design of that surface.
 *
 * Every other cap here bounds a read of **one user's own rows**, where the
 * index equality does the narrowing and the cap bounds what one request can
 * cost. The Control Centre cannot use an equality at all: its entire purpose is
 * a **deployment-wide** view, and there is no `ownerUserId` to equal. So these
 * reads take a **bounded sample of index order** and report the result as a
 * *sample*, never as a count.
 *
 * That is why the UI says "sampled, index order" and why
 * {@link ADMIN_TABLE_SAMPLE} is described as a sample rather than a limit. The
 * honest alternative — `collect()` and count — is the D48 defect this registry
 * exists to prevent, at deployment scale, on a surface an internal operator can
 * call repeatedly. A biased number that says it is biased is worth more than an
 * exact number that costs a table scan to produce.
 */

/**
 * How many rows one table read may return in the Control Centre's data-model
 * survey.
 *
 * The reader takes `sample + 1` and reports `saturated` when the extra row comes
 * back, which is the same "cap + 1" trick the balance queries use for D62 —
 * except that here it reports a range rather than a provisional total, because
 * the number being described is "is this table in use and roughly how much",
 * and a lower bound answers that without pretending to be an exact count.
 *
 * 50 across ~26 tables is about 1,300 documents in one request, which sits well
 * inside Convex's read limits while still being enough rows to distinguish "one
 * row in a test deployment" from "a table with real history".
 */
export const ADMIN_TABLE_SAMPLE = 50;

/**
 * How many spaces the deployment-wide aggregates enumerate.
 *
 * A space is found by reading the `by_createdBy` index in its natural order and
 * stopping, so this is a **prefix of that order**, not a random sample and not
 * every space. On a deployment with more spaces than this the figures are
 * marked `sampled` in the payload and the UI says so; below it, the sample is
 * the whole set and the marker is absent. That conditional honesty is the point:
 * the number is exact when it can be and labelled when it cannot.
 *
 * 50 is well above the number of accounts a pre-launch product has, so in
 * practice this is exact today and becomes a labelled sample on a day when that
 * stops being true.
 */
export const ADMIN_SPACES = 50;

/** Agent runs read per enumerated space, newest first. */
export const ADMIN_AGENT_RUNS_PER_SPACE = 5;

/** Integration connections read per enumerated space. */
export const ADMIN_CONNECTIONS_PER_SPACE = 20;

/** Sync cursors read per enumerated space. */
export const ADMIN_SYNC_CURSORS_PER_SPACE = 20;

/**
 * How long a connection may go without a sync before it is reported stale.
 *
 * The 36 hours is not a quality target — it is the point at which "this has not
 * synced" becomes a fact rather than an expectation, chosen because it is one
 * missed daily run plus a working day of slack. It is declared here rather than
 * inlined in the query so the Control Centre and the connector's own staleness
 * window (§7.2) can be compared without one of them drifting.
 */
export const ADMIN_STALE_SYNC_MS = 36 * 60 * 60 * 1000;

/**
 * Reads that are unbounded by construction, with the reason.
 *
 * Every entry is `table` + `index` + a non-empty justification. The audit
 * refuses to pass an exception with an empty reason, because "this one is
 * fine" is exactly the sentence that hides the next D48.
 *
 * `bound` must name something the product enforces — a closed catalogue, a
 * uniqueness constraint, a one-row-per-owner invariant. It is a string rather
 * than a computed value because the enforcement lives in the schema and the
 * product catalogue, not here; what this file does is make the claim explicit
 * and testable, so it has to be written down to be checked at all.
 */
export interface ClosedVocabularyRead {
  readonly table: string;
  readonly index: string;
  /** What fixes the row count, and where that is enforced. */
  readonly bound: string;
}

export const CLOSED_VOCABULARY_READS: readonly ClosedVocabularyRead[] = [
  {
    table: "areas",
    index: "by_owner",
    bound:
      "A user may only have a row for a slug in the closed area catalogue " +
      "(src/lib/areas.ts); `addArea` refuses a slug that is not in it, so the " +
      "range holds at most AREAS.length rows forever.",
  },
  {
    table: "areas",
    index: "by_owner_order",
    bound:
      "The same rows as by_owner, read in a different order: one per catalogue " +
      "slug, written only by addArea, which rejects an unknown slug.",
  },
  {
    table: "featureFlags",
    index: "by_owner",
    bound:
      "One row per owner per known key, and the only keys ever written are the " +
      "three in `loadFlags` (generalisedRanking, exploration, " +
      "attentionGrouping). Writes are upserts against `by_owner_key`, so the " +
      "row count is fixed at 3 by the product, not by the user.",
  },
];

/**
 * Tables that look closed-vocabulary and are **not**.
 *
 * Written down because `attentionState` was put in the exception list above on
 * the reasoning that it is "one row per user" — the same reasoning that is
 * correct for `assistantState` one table away. It is wrong: the row is keyed by
 * `fingerprint = hash(kind : sourceId : dueBucket)`, so a user accumulates one
 * per distinct attention item they have ever been shown, forever. An exception
 * list that can absorb a wrong entry on a plausible argument is not a control,
 * it is a loophole with documentation.
 *
 * The test asserts this set is empty of any table named here, so re-adding one
 * fails the build rather than shipping.
 */
export const NOT_CLOSED_VOCABULARY: readonly string[] = ["attentionState", "notes", "tasks", "documents"];

/**
 * Reads that are unbounded **on purpose**, and why capping them would be worse.
 *
 * This list is different from {@link CLOSED_VOCABULARY_READS} in the important
 * way: those are bounded by the product, these are not bounded at all and are
 * accepted as a known defect. A closed-vocabulary read is *fine*; one of these
 * is a debt with an owner.
 *
 * The audit cross-checks each entry against the file it names, so fixing the
 * read without deleting the entry fails the gate — the exception cannot quietly
 * outlive its own reason and become a permanent pass.
 */
export interface KnownUnboundedRead {
  readonly file: string;
  /** 1-based line the read starts on. Kept exact so drift is visible. */
  readonly line: number;
  readonly defect: string;
  readonly why: string;
}

export const KNOWN_UNBOUNDED_READS: readonly KnownUnboundedRead[] = [
  {
    file: "src/convex/integrations.ts",
    line: 741,
    defect: "D63",
    why:
      "loadStored reads every expense and calendar event in a space to build " +
      "the externalId upsert lookup. Capping it would hide rows from the " +
      "diff engine, which would then treat existing events as new and write " +
      "duplicates into a financial ledger — a worse failure than a slow " +
      "query. The bound has to come from the batch (a multi-key index read), " +
      "not from a constant. Accepted as debt, reported by the audit, owned by " +
      "the integration layer.",
  },
];

/**
 * Every cap, keyed by the name the backend imports it under.
 *
 * A flat record rather than free-floating consts so a test can walk it and
 * assert that no cap is zero, negative, NaN, or absurdly large. A cap of
 * `NaN` would silently read as "no rows" in `.take(NaN)` and a cap of 0 would
 * silently read as "the feature is empty" — both are the kind of bug that is
 * invisible until a user reports a blank page.
 */
export const READ_LIMITS = {
  DASHBOARD_TASKS,
  CLEAR_COMPLETED_BATCH,
  ATTENTION_TASKS,
  ATTENTION_CALENDAR_DAYS,
  ATTENTION_CALENDAR_EVENTS,
  UPCOMING_EVENTS,
  PEOPLE,
  MODEL_SNAPSHOTS,
  DOCUMENTS,
  EXPENSES,
  ASSOCIATED_TASKS,
  CONNECTIONS,
  COMMITMENTS,
  SPACES,
  ATTENTION_FEEDBACK,
  CONNECTION_TOKENS,
  SUBSCRIPTIONS,
  ACCOUNTS,
  IMPORTS,
  PAGES,
  PAGE_MAX_BLOCKS,
  TRANSACTION_AGGREGATE,
  AUDIT_SCAN_LIMIT,
  OWNERSHIP_AUDIT_ROWS,
  ADMIN_TABLE_SAMPLE,
  ADMIN_SPACES,
  ADMIN_AGENT_RUNS_PER_SPACE,
  ADMIN_CONNECTIONS_PER_SPACE,
  ADMIN_SYNC_CURSORS_PER_SPACE,
  ADMIN_STALE_SYNC_MS,
} as const;

export type ReadLimitName = keyof typeof READ_LIMITS;

/** The day in milliseconds, used by the calendar window. */
export const DAY_MS = 24 * 60 * 60 * 1000;

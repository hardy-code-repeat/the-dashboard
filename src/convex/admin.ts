/**
 * The Admin Control Centre's backend (ADR-032, CHANGE-0027).
 *
 * ## What this module is
 *
 * Five **read-only** queries that answer, for an internal operator, what is
 * healthy, what is incomplete, what is verified, and what is merely configured.
 * They are the internal engineering console Panel has been describing on paper
 * since phase 0A; this is the part of it that can be backed by real state.
 *
 * ## What this module is not
 *
 * **It exports no mutation, no action, no `internalMutation` and no
 * `internalAction`.** Not "not yet" — structurally, and enforced by
 * `scripts/spec-drift.ts`, which fails if this file gains a write endpoint. The
 * spec forbids a generic admin CRUD surface, a permission manager, a database
 * browser and a "superuser can do anything", and the cheapest way to guarantee
 * none of those ever appears here is for there to be no code path that could
 * express one.
 *
 * It also **cannot grant the role that opens it.** There is no `grantAdmin`
 * here, and there will not be one — a client-reachable privilege grant is an
 * escalation primitive whatever its intent, and "we'll delete it later" is not a
 * property any compiler enforces. See ADR-032 §4 and D64.
 *
 * ## The authorisation contract
 *
 * Every one of the five queries calls {@link requireAdmin} as its first
 * statement, before any read. Not one shared front door and four unguarded
 * queries: each query is independently authorised, so a future query added here
 * without the guard is a defect a reviewer must catch rather than an inherited
 * property. The drift gate greps for exactly that.
 *
 * The check itself is `users.role === "admin"`, decided by the pure predicate in
 * `src/lib/adminAccess.ts` and evaluated **fresh on every call** — never cached,
 * never in client state, never a route name. A browser calling any of these
 * without an admin session is refused inside the handler.
 *
 * ## The disclosure contract
 *
 * Three rules, and they are enforced by shaping the output rather than by
 * promising to be careful:
 *
 *  1. **No row content ever leaves.** The deployment-wide reads take samples of
 *     rows and emit **counts, result codes and timestamps**. Not one title,
 *     label, name, email, amount, note body or document metadata crosses the
 *     boundary. The reads exist to answer "is anything in here", and only a
 *     number answers that.
 *  2. **No identifiers.** No user id, no space id, no proposal key. A control
 *     console that can name a user is a directory, and the operator has no need
 *     for one.
 *  3. **No configuration values.** Sensitive configuration is reported as a
 *     state from a closed vocabulary — `configured`, `missing`, `requires-
 *     rotation`, `not-observable` — never as a value, a length, or a prefix.
 *     `process.env` is read for its *presence* and nothing else; see
 *     {@link configState}.
 *
 * ## Sampling, and why the numbers are labelled
 *
 * Every deployment-wide read here is a **bounded sample of index order**, not a
 * count, because there is no `ownerUserId` to narrow on — the point of the
 * surface is to look across tenants. The caps live in `src/lib/readLimits.ts`
 * with their reasoning, and the payloads carry a `sampled` flag that is set when
 * the cap was actually reached. The UI renders that flag as a visible qualifier
 * next to the number. A bounded read that silently looks like an exact one is
 * the D48 defect wearing a new hat, and this is the place it would be easiest
 * to reintroduce.
 *
 * ## What is deliberately NOT here
 *
 * No user list, no per-user drill-down, no session list, no error-body surface.
 * `agentRuns.error` exists and is sanitised by the runner, but it is still text
 * from inside someone's space, so only a boolean "this run failed" is reported.
 * Counting users is reported as `not-collected` rather than counted: an internal
 * console has no operational need for it, and a read that enumerates accounts is
 * the first step toward a user-management feature this module must not become.
 */

import { getAuthUserId } from "@convex-dev/auth/server";

import { adminDecisionFor, CONFIG_STATES } from "../lib/adminFindings";
import { decideAdminAccess } from "../lib/adminAccess";import { MAX_EXECUTIONS_PER_RUN, MAX_EXECUTIONS_PER_SPACE_PER_DAY } from "../lib/agents";
import { AREAS, PROVIDERS } from "../lib/areas";
import { allIntegrations } from "../lib/integrations/registry";
import { READ_LIMITS } from "../lib/readLimits";

import { query } from "./_generated/server";
import { hasCredentials } from "./credentials";
import {
  INFRASTRUCTURE_BINDINGS,
  bindingDisclosure,
  type BindingDisclosure,
} from "../lib/infrastructureBindings";
import type { DataModel, Id } from "./_generated/dataModel";
import type { GenericQueryCtx } from "convex/server";

type Ctx = GenericQueryCtx<DataModel>;

/**
 * Every `(table, index)` pair the data-model survey may name.
 *
 * Convex's generated types do not expose index names, so a `withIndex("…")` call
 * cannot be made type-safe by the compiler alone. The next best thing is to
 * **enumerate them here and check the list against the schema mechanically**,
 * which `scripts/spec-drift.ts` does.
 *
 * That is not a workaround, it is the same shape as the bounded-read registry: a
 * claim written down once and verified by a gate, rather than a string trusted
 * because it compiled. The bug this replaced is worth recording, because it is
 * the most dangerous kind this project keeps finding:
 *
 *  - the survey named `transactions.by_owner` and `imports.by_owner`, and
 *    **neither index exists** (`transactions` has `by_owner_postedAt`,
 *    `imports` has `by_owner_createdAt`);
 *  - the queries threw at runtime, inside Convex;
 *  - **from outside, a throw is indistinguishable from a refusal**, so the
 *    security harness recorded "correctly denied" and the feature was simply
 *    broken behind a green result.
 *
 * A harness that cannot tell "denied" from "crashed" manufactures confidence.
 * Hence the enumerated allowlist, and hence the drift gate that keeps it honest.
 */
const TABLE_INDEXES = {
  spaces: ["by_createdBy", "by_nextAgentRunAt"],
  spaceMembers: ["by_space", "by_user"],
  tasks: ["by_space", "by_owner", "by_owner_created", "by_owner_open"],
  people: ["by_space", "by_owner", "by_space_name"],
  notes: ["by_space", "by_owner"],
  documents: ["by_space", "by_owner", "by_owner_expiry"],
  commitments: ["by_space", "by_owner", "by_owner_open"],
  expenses: ["by_space", "by_owner", "by_owner_spentAt"],
  transactions: ["by_owner_postedAt", "by_space_postedAt", "by_owner_import"],
  accounts: ["by_space", "by_owner"],
  subscriptions: ["by_space", "by_owner"],
  calendarEvents: ["by_space", "by_owner", "by_space_startsAt"],
  links: ["by_space", "by_from", "by_to"],
  activity: ["by_space_at", "by_key"],
  agentProposals: ["by_space_at", "by_space_key"],
  featureFlags: ["by_space", "by_owner", "by_owner_key"],
  areas: ["by_space", "by_owner", "by_owner_order"],
  attentionState: ["by_space", "by_owner", "by_owner_fingerprint"],
  assistantState: ["by_space", "by_owner"],
  modelSnapshots: ["by_space", "by_owner_modelVersion"],
  connections: ["by_space", "by_owner", "by_owner_provider"],
  syncCursors: ["by_space", "by_owner_provider"],
  imports: ["by_owner_createdAt", "by_space_status"],
  taxProfile: ["by_space", "by_owner"],
  taxDocuments: ["by_space", "by_owner"],
  grants: ["by_space", "by_grantee"],
} as const satisfies Record<string, readonly string[]>;

// Referenced only through `typeof` below, which the compiler and the linter do
// not treat as a use. The value is never read at runtime, and the comment above
// explains why it exists.
void TABLE_INDEXES;

type TableName = keyof typeof TABLE_INDEXES;
type IndexNameOf<T extends TableName> = (typeof TABLE_INDEXES)[T][number];

/**
 * Refusal sentinel.
 *
 * These queries **throw** rather than returning `null` when the caller is not an
 * admin, and that is a deliberate choice against the softer alternative.
 *
 * Returning `null` would make "you are not an administrator" and "this section
 * has nothing to report" the same wire value, and a client that renders an empty
 * panel for both has told a non-admin nothing and told an admin something false.
 * A thrown error is unambiguous at the boundary, and the client turns it into a
 * refusal panel — which is the honest rendering of "you may not see this".
 *
 * The message is fixed on purpose. Carrying the specific
 * {@link AdminRefusal} reason into the error would confirm to an unauthorised
 * caller whether their session resolved to a document and what its role was;
 * `describeAdminDenial` exists for the *authorised* side, and the two are kept
 * apart for that reason.
 */
const DENIED = "Admin access required.";

/**
 * Establish that the caller is an internal admin, or refuse.
 *
 * Returns the caller's **id only**, never the row. That is deliberate and it was
 * not the first version: this originally returned the whole `users` document,
 * which made a leak one careless `return requireAdmin(ctx)` away — the caller's
 * email, name and image would have gone into a payload with a single word
 * changed. Returning the id makes that mistake impossible to make *silently*:
 * there is no row in scope to hand back.
 *
 * No caller needs more than the id. If one ever did, the right answer is a
 * separate, narrowly-typed read of that one field — not a wider return value
 * from the guard.
 */
async function requireAdmin(ctx: Ctx): Promise<Id<"users">> {
  const userId = await getAuthUserId(ctx);
  if (userId === null) throw new Error(DENIED);

  // Read the document on every call rather than trusting a claim in the token.
  // A JWT says who signed in; it does not say what role they hold now, and a
  // role is exactly the sort of thing that has to be revokable. `db.get` is a
  // single point read, so this costs nothing and is always current.
  const user = await ctx.db.get(userId);
  if (user === null) throw new Error(DENIED);

  if (!decideAdminAccess(user).allowed) throw new Error(DENIED);
  return userId;
}

/**
 * The closed vocabulary for anything this surface reports about configuration.
 *
 * Re-exported from the findings module so the state a caller sees and the state
 * the findings registry declares are literally the same strings. A UI cannot
 * render "CONFIGURED" for one and "configured" for another.
 */
export const CONFIG_STATE = CONFIG_STATES;

export type ConfigState = (typeof CONFIG_STATE)[number];

/**
 * Configuration state from **presence only**, never from a value.
 *
 * `process.env` is read here and the result is immediately reduced to one of
 * four states. The value is never returned, never length-checked, never
 * prefix-matched and never logged — a `Configured` that leaked four characters
 * of a key would be a credential disclosure wearing a status label, and the
 * whole reason this surface is allowed to look at configuration at all is that
 * it cannot see any of it.
 *
 * `not-observable` is a real answer, not a failure: Convex does not expose
 * deployment environment variables to every runtime, and where it does not, the
 * honest state is that Panel cannot know — which is what this returns rather
 * than a `missing` that would read as a misconfiguration.
 */
function configState(name: string, isReadable: boolean): ConfigState {
  if (!isReadable) return "not-observable";
  const value = process.env[name];
  if (value === undefined || value === "") return "missing";
  return "configured";
}

/**
 * Whether deployment environment variables can be read in this runtime at all.
 *
 * Split out of `configurationStates` because two surfaces now need the answer
 * and they must agree: if the platform variables reported `not-observable` while
 * the bindings reported `missing`, the page would be telling an operator two
 * different things about the same deployment.
 *
 * An unreadable environment is `not-observable`, never `missing`: an
 * environment Panel cannot read is not the same claim as one that is absent.
 */
function envIsReadable(): boolean {
  try {
    void process.env.CONVEX_SITE_URL;
    return true;
  } catch {
    return false;
  }
}

/**
 * Infrastructure bindings, as disclosures (ADR-034).
 *
 * The Control Centre's answer to "which providers does this deployment expect,
 * and is each one actually working?" — built from the typed registry in
 * `src/lib/infrastructureBindings.ts`.
 *
 * Three properties are structural rather than promised:
 *
 *  1. **No environment variable name crosses the boundary.** The name is read
 *     here to establish presence and then dropped; {@link bindingDisclosure}
 *     returns a shape with no field to put it in (ADR-034).
 *  2. **No value, length, prefix or fingerprint** — `configState` reduces the
 *     variable to one of four words before it is handed on, exactly as it does
 *     for the four platform variables above.
 *  3. **No write path.** This is a query, it reads no product table, and it
 *     calls nothing that could modify a deployment. Panel holds no credential
 *     capable of changing its own secret configuration, so there is nothing
 *     here that *could* be pressed.
 */
function infrastructureBindingStates(): BindingDisclosure[] {
  const readable = envIsReadable();
  return INFRASTRUCTURE_BINDINGS.map((binding) =>
    bindingDisclosure(binding, configState(binding.envVar, readable)),
  );
}

/**
 * The four sensitive configuration values this deployment needs, as states.
 *
 * Named explicitly rather than iterated from a list so that adding a variable
 * to this function is a visible act in a diff, and so the surface cannot grow by
 * accident into "report every environment variable" — which would turn a status
 * page into a configuration dump.
 */
function configurationStates(): Array<{ name: string; state: ConfigState; note: string }> {
  // `process.env` access can throw in some Convex runtimes rather than return
  // undefined; treating a throw as "not observable" is correct, because an
  // unreadable configuration is not the same claim as an absent one.
  const readable = envIsReadable();

  return [
    {
      name: "CONVEX_SITE_URL",
      state: configState("CONVEX_SITE_URL", readable),
      note: "Issued by Convex. Required for the deployment's own OIDC provider; a wrong value breaks sign-in confirmation.",
    },
    {
      name: "VLY_CONVEX_AUTH_ISSUER",
      state: configState("VLY_CONVEX_AUTH_ISSUER", readable),
      note: "Federated identity issuer. Optional: absent means the deployment falls back to https://freebuff.com.",
    },
    {
      name: "GOOGLE_CLIENT_ID",
      state: configState("GOOGLE_CLIENT_ID", readable),
      note: "Google Calendar OAuth. Absent means phase 2 is configured but cannot be exercised (D32).",
    },
    {
      name: "GOOGLE_CLIENT_SECRET",
      state: configState("GOOGLE_CLIENT_SECRET", readable),
      note: "Google Calendar OAuth. State only — the value is never read, returned or logged by this module.",
    },
  ];
}

/**
 * System status: what the deployment is made of, and what it is configured with.
 *
 * The only query here that reads no product table at all, which is why it is the
 * one an operator can rely on when the rest of the console is reporting a
 * problem. Everything in it is either a compile-time constant of this codebase
 * or an environment *state* — never a runtime measurement dressed up as one.
 *
 * Note what is absent: no uptime, no error rate, no request count, no "last 24h"
 * anything. Convex gives a query no access to the request history, and inventing
 * a number to fill that space is precisely the fabrication this surface exists to
 * stop.
 */
export const systemStatus = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);

    return {
      // --- what this codebase is -----------------------------------------
      schemaValidation: true,
      areaCatalogue: AREAS.length,
      providerCatalogue: PROVIDERS.length,
      adapters: allIntegrations().length,
      agentPolicy: {
        maxExecutionsPerRun: MAX_EXECUTIONS_PER_RUN,
        maxExecutionsPerSpacePerDay: MAX_EXECUTIONS_PER_SPACE_PER_DAY,
      },
      // The schedule is *declared* here and nowhere else in this surface. It is
      // a constant copied from `convex.config.ts`, and it is labelled
      // `declared` for the reason in `agentHealth` below.
      cron: {
        path: "agents/daily",
        schedule: "0 7 * * *",
        timezone: "UTC",
        state: "declared-not-verified" as const,
      },
      configuration: configurationStates(),
      // Provider credentials this deployment expects, as metadata only. Phase 1
      // of ADR-034: reported, never written, and carrying no variable name.
      infrastructureBindings: infrastructureBindingStates(),
      // The two things this surface genuinely cannot know, said out loud rather
      // than omitted. A gap that is visible is a gap; a gap that is absent
      // reads as a pass.
      notObservable: [
        "Uptime, request count and error rate: a Convex query has no access to the deployment's request history.",
        "Whether the 07:00 cron has ever fired: the CLI cannot read a schedule back, and no delivery is observable from inside a request.",
        "Test, lint and drift results: those are facts about a build, not about this deployment, and are reported by `bun test` / `bun run lint` / `bun scripts/spec-drift.ts`.",
        "Secrets: this surface reports configuration *state* only and cannot read a value even in principle.",
      ],
    };
  },
});

/**
 * Agent and cron health.
 *
 * Reads `agentRuns` for a bounded sample of spaces and reports **when runs last
 * happened and how they ended** — never what they said. This is the query that
 * exists to answer the standing question "is the 07:00 job actually running?",
 * and the honest answer has two halves that must not be merged:
 *
 *  - **declared**: `0 7 * * *` is in `convex.config.ts`. True, and it means
 *    nothing about execution.
 *  - **observed**: the newest `agentRuns` row in the deployment. Real evidence.
 *
 * They are reported separately, and the payload refuses to combine them into a
 * single "cron: healthy" line, because the two can disagree — a schedule can be
 * declared and never delivered, and that is exactly the unverified state D-record
 * keeps open. Note also that an `agentRuns` row is written by `runMyAgentsNow`
 * as well as by cron, so a recent row is evidence that *the runner ran*, never
 * evidence that *the schedule fired*.
 */
export const agentHealth = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);

    const cap = READ_LIMITS.ADMIN_AGENT_RUNS_PER_SPACE;

    // A bounded prefix of the `by_createdBy` index order. The flag is set when
    // the cap is reached, so the payload can say "sampled" rather than implying
    // coverage it does not have.
    const spaces = await ctx.db
      .query("spaces")
      .withIndex("by_createdBy")
      .take(READ_LIMITS.ADMIN_SPACES + 1);
    const sampled = spaces.length > READ_LIMITS.ADMIN_SPACES;
    const sampledSpaces = sampled ? spaces.slice(0, READ_LIMITS.ADMIN_SPACES) : spaces;

    let runs = 0;
    let failures = 0;
    let capped = 0;
    let overflow = 0;
    let executions = 0;
    let oldestAt: number | null = null;

    for (const space of sampledSpaces) {
      // `.order("desc")` so the read is the *newest* runs for the space, which
      // is what "when did this last run" means. An ascending read of a space
      // with a long history would answer with its first day.
      const recent = await ctx.db
        .query("agentRuns")
        .withIndex("by_space_at", (q) => q.eq("spaceId", space._id))
        .order("desc")
        .take(cap);

      for (const run of recent) {
        runs += 1;
        executions += run.executions ?? 0;
        overflow += run.overflow ?? 0;
        if (run.result === "failed") failures += 1;
        if (run.result === "capped") capped += 1;
        if (oldestAt === null || run.at < oldestAt) oldestAt = run.at;
      }
    }

    return {
      // The cap only binds once there is more history than the read window, so
      // the figure is a count of what was in range rather than a total.
      runsObserved: runs,
      failuresObserved: failures,
      cappedObserved: capped,
      overflowObserved: overflow,
      executionsObserved: executions,
      oldestRunInWindow: oldestAt,
      spacesSampled: sampledSpaces.length,
      sampled,
      perSpaceCap: cap,
      // Present, and deliberately not combined with the observed figures above.
      // `agentRuns` is written by the cron *and* by the user-triggered
      // `runMyAgentsNow`, so no row here can distinguish the two sources.
      cronFiring: "not-observable" as const,
      cronFiringReason:
        "A run row is written by the scheduled function and by runMyAgentsNow alike, so its presence proves the runner ran, not that the schedule fired.",
    };
  },
});

/**
 * Integration health: what is connected, and what has stopped syncing.
 *
 * Reports provider, connection status, sync recency and **whether a credential
 * exists** — the last of which is a boolean obtained through
 * `hasCredentials`, the single credential question `credentials.ts` documents
 * itself as safe to ask. It never returns a token, a fingerprint, an account
 * hint, or the user's own label for a connection: the operator needs to know
 * that a credential is *present*, and nothing about what it is.
 */
export const integrationHealth = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);

    const now = Date.now();

    const spaces = await ctx.db
      .query("spaces")
      .withIndex("by_createdBy")
      .take(READ_LIMITS.ADMIN_SPACES + 1);
    const sampled = spaces.length > READ_LIMITS.ADMIN_SPACES;
    const sampledSpaces = sampled ? spaces.slice(0, READ_LIMITS.ADMIN_SPACES) : spaces;

    const byProvider = new Map<
      string,
      { connections: number; withCredential: number; stale: number; failing: number; lastSyncAt: number | null }
    >();
    for (const def of PROVIDERS) {
      byProvider.set(def.slug, {
        connections: 0,
        withCredential: 0,
        stale: 0,
        failing: 0,
        lastSyncAt: null,
      });
    }

    for (const space of sampledSpaces) {
      const connections = await ctx.db
        .query("connections")
        .withIndex("by_space", (q) => q.eq("spaceId", space._id))
        .take(READ_LIMITS.ADMIN_CONNECTIONS_PER_SPACE);

      for (const connection of connections) {
        const bucket =
          byProvider.get(connection.provider) ??
          // A provider not in the catalogue: a row the product would not write.
          // Counted rather than dropped, so an unknown provider is visible
          // instead of silently absent.
          (() => {
            const fresh = {
              connections: 0,
              withCredential: 0,
              stale: 0,
              failing: 0,
              lastSyncAt: null as number | null,
            };
            byProvider.set(connection.provider, fresh);
            return fresh;
          })();

        bucket.connections += 1;
        if (await hasCredentials(ctx, { userId: connection.ownerUserId, provider: connection.provider as never })) {
          bucket.withCredential += 1;
        }
        if (connection.status === "error") bucket.failing += 1;

        const synced = connection.lastSyncedAt;
        if (synced !== undefined) {
          bucket.lastSyncAt = bucket.lastSyncAt === null ? synced : Math.max(bucket.lastSyncAt, synced);
          if (now - synced > READ_LIMITS.ADMIN_STALE_SYNC_MS) bucket.stale += 1;
        }
      }
    }

    return {
      providers: [...byProvider.entries()].map(([provider, s]) => ({ provider, ...s })),
      spacesSampled: sampledSpaces.length,
      sampled,
      staleAfterMs: READ_LIMITS.ADMIN_STALE_SYNC_MS,
      // Named so a reader cannot mistake this for an integration list.
      disclosure: "Counts, statuses and recency only. No token, fingerprint, account hint or user-supplied label is returned by this query.",
    };
  },
});

/**
 * The data model, as it actually is: which tables hold anything.
 *
 * Each table is read for at most {@link READ_LIMITS.ADMIN_TABLE_SAMPLE} rows and
 * reported as a **sample**, never as a count. The `saturated` flag is set when
 * the table holds more rows than the read window, which is the honest signal
 * that the number below it is a lower bound.
 *
 * Two tables are excluded from the survey, and the exclusion is part of the
 * payload rather than a comment. They are the credential tables ADR-014 confines
 * to `credentials.ts`, and they are **not named here by design**: the
 * credential-containment gate fails any module outside `credentials.ts` that so
 * much as mentions a credential table, and that gate cannot tell a disclosure
 * apart from a read — nor should it. Naming them in a "we do not read this"
 * list would have meant relaxing the one check that makes the confinement
 * structural. The exclusion is reported as a count and a reference to ADR-014
 * instead, which tells an operator everything they need and keeps the
 * containment guarantee absolute.
 */
export const dataModel = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);

    const sample = READ_LIMITS.ADMIN_TABLE_SAMPLE;

    /**
     * One bounded sample of a table, named by index.
     *
     * The index is a **type parameter**, not a string, so a name that does not
     * exist on the table is a compile error rather than a runtime one. That is
     * not a nicety: the first version of this took `index: string` and used
     * `as never`, and it named two indexes that do not exist
     * (`transactions.by_owner`, `imports.by_owner`). Both only failed at
     * runtime, inside Convex, and both were **invisible from outside** — the
     * query threw, the harness recorded a refusal, and the refusal was
     * indistinguishable from the authorisation working. A security harness that
     * cannot tell "correctly denied" from "crashed" is a harness that reports
     * green while the feature is broken, which is the D60 failure mode
     * reproduced in new code.
     *
     * The compiler is the control that closes it. `TableNames` and `IndexNameOf`
     * below are what turn a typo in a table or index name into a build failure.
     */
    const read = async <T extends TableName>(table: T, index: IndexNameOf<T>) => {
      const rows = await ctx.db.query(table).withIndex(index).take(sample + 1);
      // `sample + 1`, so "saturated" is a fact about the read rather than a
      // guess from comparing the result to the cap. This is the D62 pattern
      // applied to a range instead of a sum.
      return { rows: Math.min(rows.length, sample), saturated: rows.length > sample };
    };

    // Spelled out one by one, for the same reason `export.ts` and
    // `auditOwnership` do it: a loop over a table list has to be proved to have
    // read each one, and a table that is added to the list but never measured
    // would report as an empty table, which is a false clean bill of health.
    const [spaces, members, tasks, notes, people, documents, commitments, expenses, transactions, accounts, subscriptions, calendarEvents, links, activity, agentProposals, featureFlags, areas, attention, assistant, modelSnapshots, connections, syncCursors, imports, taxProfiles, taxDocs, grants] =
      await Promise.all([
        read("spaces", "by_createdBy"),
        read("spaceMembers", "by_user"),
        read("tasks", "by_owner_created"),
        read("notes", "by_owner"),
        read("people", "by_space_name"),
        read("documents", "by_owner"),
        read("commitments", "by_owner"),
        read("expenses", "by_owner_spentAt"),
        read("transactions", "by_owner_postedAt"),
        read("accounts", "by_owner"),
        read("subscriptions", "by_owner"),
        read("calendarEvents", "by_space_startsAt"),
        read("links", "by_from"),
        read("activity", "by_space_at"),
        read("agentProposals", "by_space_at"),
        read("featureFlags", "by_owner"),
        read("areas", "by_owner"),
        read("attentionState", "by_owner"),
        read("assistantState", "by_owner"),
        read("modelSnapshots", "by_owner_modelVersion"),
        read("connections", "by_owner"),
        read("syncCursors", "by_owner_provider"),
        read("imports", "by_owner_createdAt"),
        read("taxProfile", "by_owner"),
        read("taxDocuments", "by_owner"),
        read("grants", "by_space"),
      ]);

    const named: Array<[string, { rows: number; saturated: boolean }]> = [
      ["spaces", spaces],
      ["spaceMembers", members],
      ["tasks", tasks],
      ["notes", notes],
      ["people", people],
      ["documents", documents],
      ["commitments", commitments],
      ["expenses", expenses],
      ["transactions", transactions],
      ["accounts", accounts],
      ["subscriptions", subscriptions],
      ["calendarEvents", calendarEvents],
      ["links", links],
      ["activity", activity],
      ["agentProposals", agentProposals],
      ["featureFlags", featureFlags],
      ["areas", areas],
      ["attentionState", attention],
      ["assistantState", assistant],
      ["modelSnapshots", modelSnapshots],
      ["connections", connections],
      ["syncCursors", syncCursors],
      ["imports", imports],
      ["taxProfile", taxProfiles],
      ["taxDocuments", taxDocs],
      ["grants", grants],
    ];

    return {
      sample,
      tables: named.map(([table, s]) => ({ table, ...s })),
      notRead: [
        {
          table: "credential tables (2)",
          why: "ADR-014 confines the OAuth token and PKCE-state tables to credentials.ts, and they are deliberately not named here: the containment gate fails any other module that so much as mentions them, and that gate should not be relaxed to make a status page read better. Not even a count is reported.",
        },
        {
          table: "users",
          why: "Not collected. An internal console has no operational need to enumerate accounts, and a read that lists users is the first step toward the user management this module must not become.",
        },
      ],
      disclosure:
        "Each figure is a bounded sample of index order, not a count. `saturated: true` means the table holds more rows than the sample window.",
    };
  },
});

/**
 * The recorded security posture: open findings, and the gaps that are not
 * defects but are not passes either.
 *
 * This query reads **no tables at all**. It returns a registry from
 * `src/lib/adminFindings.ts`, which exists so the Control Centre's security
 * section has exactly one source and that source is a checked-in, reviewable
 * list of *recorded* state rather than anything inferred at runtime.
 *
 * A registry rather than a scan, on purpose: the honest report of "is there a
 * live credential in the source" is not something a database query can answer,
 * and a surface that guessed would be worse than one that cites the finding. The
 * `scripts/spec-drift.ts` gate cross-checks every id here against the
 * changelog, so an entry cannot be invented, silently dropped, or left behind
 * after the finding it names has been closed.
 */
export const securityPosture = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    return adminDecisionFor();
  },
});

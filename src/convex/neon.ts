"use node";

/**
 * Panel's Neon connection check (CHANGE-0039).
 *
 * ## What this module is
 *
 * One action, `neonHealth`, that answers a single question: **can the
 * deployment reach Neon at all?** It opens one pooled connection, runs
 * `SELECT 1`, closes it, and reports what happened.
 *
 * The user-visible purpose of the Neon connection is **undecided**. This module
 * is therefore deliberately the smallest thing that can honestly be called an
 * integration: a connection and a health check, and no more. There is no
 * schema, no table, no migration, no Panel data in Neon, and nothing here
 * reads or writes application data. When a purpose is chosen, it should land
 * as an addition to this module rather than as a reason this one grew.
 *
 * ## Why an action and not a query
 *
 * A Convex query runs in the V8 runtime, which has no `process.env` for
 * deployment environment variables and cannot open a raw Postgres socket. Both
 * of those are exactly what this check needs, so the file is `"use node"` and
 * exports an `action`. It is an action rather than a scheduled function for
 * the same reason: this is a probe somebody asked for, not work that happens
 * on a timer.
 *
 * ## The authorisation contract
 *
 * `neonHealth` is client-reachable — any browser can name an action — so it
 * refuses on its own, before it reads a single byte of configuration. The check
 * is `users.role === "admin"`, decided by the **same pure predicate** the
 * Control Centre uses (`decideAdminAccess` in `src/lib/adminAccess.ts`), with
 * the role read fresh from the database on every call rather than trusted from
 * the token, because a JWT says who signed in and not what they may do now.
 *
 * The guard is written out here rather than imported, and that duplication is
 * correct: `requireAdmin` in `admin.ts` is module-private on purpose, and the
 * drift gate `checkAdminReadOnly` enforces that nothing outside that file can
 * depend on the Control Centre's authorisation. This module does not borrow
 * that authority — it re-establishes the same one and pays for it in three
 * lines. Importing the helper would have been a hole in that gate.
 *
 * ## The disclosure contract
 *
 * The reason most of this file is not the interesting part:
 *
 *  1. **The connection string never leaves the server.** It is read into a
 *     local, handed to the driver, and dropped. It is not returned, not
 *     length-checked, not prefix-matched, not logged.
 *  2. **No driver error is returned.** A failed Postgres connection carries the
 *     role name, the host and sometimes the credential. `classifyNeonFailure`
 *     reduces the message to one of four fixed words *before* anything is
 *     returned, and the report itself never contains text the caller supplied.
 *  3. **No caller input reaches the query, and no value is ever bound.** The
 *     probe is a constant with no parameters, and it is sent through the
 *     driver's `query()` rather than its tagged template — see
 *     {@link NEON_PROBE_QUERY} for why that distinction is not cosmetic.
 *  4. **The one derived value is a host label, and only if it matches.** A Neon
 *     hostname begins `ep-` followed by the project slug. Knowing *which* Neon
 *     project a deployment points at prevents the genuine failure of debugging
 *     the wrong one, and the regex below cannot emit a username, a database
 *     name, or anything after the first dot.
 *
 * ## What this does not do
 *
 * It does not migrate data, and it does not exist because Convex failed — the
 * Convex deployment's usage limit is an unrelated incident, and Neon is not a
 * remedy for it. `readLimits` and `TABLE_INDEXES` do not apply here: those
 * govern Convex table reads, and this reads no Convex table except a single
 * point `get` of the caller's own user row.
 */

import { action, type ActionCtx } from "./_generated/server";
import { makeFunctionReference } from "convex/server";
import { neon } from "@neondatabase/serverless";

import {
  describeNeonHealth,
  PROBE_TIMEOUT_MS,
  type NeonHealthReport,
  type NeonProbeResult,
} from "../lib/neonHealth";

/** Fixed on purpose, and shared with the refusal in `admin.ts`. */
const DENIED = "Admin access required.";

/**
 * The deployment environment variable holding the Neon connection string.
 *
 * Named rather than inlined so the Keys tab instruction and this module cannot
 * drift apart.
 */
export const NEON_ENV_VAR = "DATABASE_URL";

/**
 * The exact statement the health check runs.
 *
 * Exported so the report can name it and the operator can see that the check
 * reads no schema, no table and no data.
 *
 * ## It must be sent through `sql.query()`, not the tagged template
 *
 * This is the one thing in this module a reviewer should not "simplify". A
 * tagged template **binds every interpolated value as a query parameter**, so
 * ``sql`${NEON_PROBE_QUERY}` `` sends the literal text `SELECT $1` — which
 * Postgres rejects as a syntax error. That bug was written here once, and no
 * typecheck could have caught it: the driver is typed for any interpolated
 * value, and the failure only appears when a real server parses the statement.
 *
 * `sql.query(text)` takes a statement string with optional `$n` placeholders
 * and no parameter array, which is exactly the right shape for a constant that
 * has nothing to bind. `sql.unsafe()` would also inline the text and is
 * deliberately **not** used: it exists to splice trusted fragments into a
 * larger statement, and reaching for it here would be a signal that a query is
 * being assembled from parts — which this module never does.
 *
 * There is no `$n` in {@link NEON_PROBE_QUERY} and nothing to interpolate,
 * which is the second reason the statement is a constant rather than a
 * template: the shape that is safe here is only safe because it is literal.
 */
export const NEON_PROBE_QUERY = "SELECT 1";

/**
 * Extract the Neon project slug from a connection string, or `null`.
 *
 * Returns **only** the leading `ep-<slug>` label of the host, and only when
 * that label is entirely `[a-z0-9-]`. Anything else returns `null` — including
 * a host with no `ep-` prefix, a username, a port or a path. The value is
 * derived from a secret but is not itself secret material, and it is the one
 * piece of this check that would otherwise make "am I pointing at the right
 * Neon project?" unanswerable from the console.
 */
export function neonProjectSlug(connectionString: string): string | null {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    // An unparseable string is not reported by guessing at its shape.
    return null;
  }

  const match = /^ep-([a-z0-9-]+)$/.exec(url.hostname.split(".")[0] ?? "");
  return match?.[1] ? `ep-${match[1]}` : null;
}

/**
 * Reference to {@link file://./authorization.ts} `callerIsAdmin`.
 *
 * **This string is not type-checked, and that is a known, accepted gap.**
 * `api.authorization.callerIsAdmin` would be checked, but it cannot be written
 * yet: the generated API types for a brand-new module only appear after a
 * codegen pass, and a codegen pass cannot run while this file references a type
 * it does not have. `makeFunctionReference` breaks that deadlock — it resolves
 * the name at runtime and resolves to nothing if it is wrong.
 *
 * So this is a real coupling with no compiler behind it, and it is recorded as
 * such rather than papered over: the first live call to `neonHealth` is what
 * proves the name resolves. Until that happens the authorisation path is
 * **NOT VERIFIED**, not verified-with-caution. Renaming the query in
 * `authorization.ts` must be treated as a breaking change to this line.
 */
const CALLER_IS_ADMIN = makeFunctionReference<"query", Record<string, never>, boolean>(
  "authorization:callerIsAdmin",
);

/**
 * Refuse unless the caller is an internal admin.
 *
 * An `action` context has **no `db`** — a Convex runtime property, not an
 * oversight — and a `"use node"` file may declare only actions, so the role is
 * read in {@link CALLER_IS_ADMIN} and reached with `ctx.runQuery`. That is the
 * supported path for exactly this situation.
 *
 * The refusal message is the same fixed string `admin.ts` uses, carrying no
 * reason, for the same reason: telling an unauthorised caller *why* would
 * confirm whether their session resolved to a document.
 */
async function requireAdmin(ctx: ActionCtx): Promise<void> {
  const allowed: boolean = await ctx.runQuery(CALLER_IS_ADMIN);
  if (!allowed) throw new Error(DENIED);
}

/**
 * Read `DATABASE_URL` for its value, tolerating a runtime that does not
 * expose environment variables at all.
 *
 * The distinction that matters: a runtime where `process.env` throws yields
 * `null`, which the report calls `unconfigured` — the honest answer, because
 * Panel cannot tell "not set" from "not readable" here. Guessing the other way
 * would tell an operator their credential is missing when it is not.
 */
function readConnectionString(): string | null {
  let value: string | undefined;
  try {
    value = globalThis.process?.env?.[NEON_ENV_VAR];
  } catch {
    return null;
  }
  if (typeof value !== "string" || value === "") return null;
  return value;
}

/**
 * Run one `SELECT 1` against Neon, bounded by {@link PROBE_TIMEOUT_MS}.
 *
 * The deadline is ours rather than the driver's because a health check that can
 * hang is not a health check — an operator clicking a button needs a verdict,
 * not a spinner.
 */
async function probe(connectionString: string): Promise<NeonProbeResult> {
  const sql = neon(connectionString);
  const startedAt = Date.now();

  const attempt = sql.query(NEON_PROBE_QUERY).then(() => "ok" as const);

  // A rejection arriving *after* the deadline already resolved the race would
  // otherwise surface as an unhandled rejection. Attaching a handler here
  // silences exactly that case and nothing else: `attempt` still rejects, and
  // the race still sees it, when the failure happens in time.
  void attempt.catch(() => {});

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const outcome = await Promise.race([
      attempt,
      new Promise<"timeout">((resolve) => {
        timer = setTimeout(() => resolve("timeout"), PROBE_TIMEOUT_MS);
      }),
    ]);

    if (outcome === "timeout") {
      return { state: "timeout", latencyMs: Date.now() - startedAt, error: null };
    }
    return { state: "ok", latencyMs: Date.now() - startedAt, error: null };
  } catch (error) {
    return {
      state: "unreachable",
      latencyMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * The health check itself.
 *
 * Returns the operator-facing report plus two facts about *what was run*: the
 * statement text, and the Neon project slug if the host had one. Neither is
 * configuration, and both make the result checkable by hand.
 *
 * Never throws for a *connectivity* failure — a dead Neon is a reported state,
 * not an error, because an action that throws cannot distinguish "Neon is down"
 * from "Panel is broken" for the caller. It does throw for an unauthorised
 * caller, which is a refusal and not a health verdict.
 */
export const neonHealth = action({
  args: {},
  handler: async (ctx): Promise<NeonHealthReport & { probeQuery: string; project: string | null }> => {
    await requireAdmin(ctx);

    const connectionString = readConnectionString();

    // Nothing is attempted when there is nothing to attempt it with, so no
    // latency and no failure class are invented for an absent credential.
    if (connectionString === null) {
      return {
        ...describeNeonHealth({ state: "unconfigured", latencyMs: null, error: null }),
        probeQuery: NEON_PROBE_QUERY,
        project: null,
      };
    }

    const result = await probe(connectionString);
    return {
      ...describeNeonHealth(result),
      probeQuery: NEON_PROBE_QUERY,
      project: neonProjectSlug(connectionString),
    };
  },
});
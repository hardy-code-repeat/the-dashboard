/**
 * Shared authorisation primitive (CHANGE-0039).
 *
 * ## What this module is
 *
 * One `internalQuery` that answers a single question: **is the caller an
 * internal admin right now?** It exists because the Neon health check runs in
 * the Node runtime, where a query cannot be declared, and needs the same
 * decision the Control Centre makes for itself.
 *
 * ## Why this is a separate module
 *
 * Two independent constraints forced it out of `neon.ts`:
 *
 *  1. A `"use node"` file may declare **only** actions. An `action` context has
 *     no `db`, so the role has to be read in a query — and that query cannot
 *     live in the same file as the action.
 *  2. `admin.ts` must stay self-contained. The drift gate `checkAdminReadOnly`
 *     requires `requireAdmin` to be **module-private**, precisely so nothing
 *     outside the Control Centre can depend on its authorisation. Importing it
 *     from here would have opened exactly that hole.
 *
 * So the Control Centre keeps its own private guard, and this module
 * re-establishes the same decision independently. Two implementations of one
 * rule is a duplication worth naming: it is bought on purpose, and the shared
 * part is the *predicate* — both call `decideAdminAccess` from
 * `src/lib/adminAccess.ts`, so the rule itself is written once.
 *
 * ## The disclosure contract
 *
 * Returns a **boolean about the caller** and nothing else — no user id, no
 * email, no name, no row. A caller that needs an identity has another reason
 * and should read it where it needs it.
 *
 * The role is read from the database on every call rather than trusted from the
 * token, because a JWT says who signed in and not what they may do now, and a
 * role is exactly the kind of claim that has to be revocable.
 *
 * ## Why `internalQuery`
 *
 * An internal function is not reachable from a browser, which is the correct
 * shape for a question about "whoever is calling". Exported only because
 * `ctx.runQuery` requires a generated function reference; exporting it does not
 * make it client-callable.
 */

import { internalQuery } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";

import { decideAdminAccess } from "../lib/adminAccess";

/**
 * Whether the caller is an internal admin, decided fresh on every call.
 *
 * `false` covers three distinct situations that are deliberately not told apart
 * to the caller: nobody signed in, the session resolved to no row, and the row
 * exists with a role that is not `admin`. An unauthorised caller learns only
 * that they are not an admin, which is the whole of what they should learn.
 */
export const callerIsAdmin = internalQuery({
  args: {},
  handler: async (ctx): Promise<boolean> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return false;

    // `db.get` is a single point read, so it costs nothing and is always
    // current — which is the point: the role is checked now, not at sign-in.
    const user = await ctx.db.get(userId);
    if (user === null) return false;

    return decideAdminAccess(user).allowed;
  },
});
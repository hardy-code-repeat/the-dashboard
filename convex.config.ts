/**
 * The scheduler (phase 3, feature 6, ADR-030).
 *
 * One entry, one cadence, one target. This is the **only** scheduling
 * mechanism in Panel — there is no external scheduler, no queue, no worker
 * service and no second backend, and adding one would be the first sign that
 * the agent framework had started growing instead of being used.
 *
 * ## Daily, deliberately
 *
 * The work is a once-a-day review of numbers that do not change meaningfully
 * between breakfast and bedtime, run by nobody, on a product where each user
 * is their own tenant. Hourly would be twelve times the wakes for no extra
 * signal: the `finreview` finding only moves when the user logs an expense or
 * confirms a category, and this process is watching for neither.
 *
 * ## The invocation carries no authority
 *
 * A cron delivery has no user and no context. It answers **"when should the
 * runner wake up?"** and nothing else — what an agent may do is decided by the
 * return type in `src/lib/agents.ts`, and nothing here can widen it. There is
 * no argument in this file that could promote a tier, grant access, or bypass a
 * feature flag.
 */

import { defineScheduledFunction } from "convex/server";
import { v } from "convex/values";

import { internal } from "./convex/_generated/api";

/**
 * 07:00 UTC daily.
 *
 * UTC rather than local because the run is a daily aggregate rather than
 * something tied to anyone's working day — a proposal that lands at 07:00 for
 * everyone is never *nearly* midnight for someone.
 */
const scheduledDailyAgentRun = defineScheduledFunction({
  path: "agents/daily",
  schedule: { cron: "0 7 * * *" },
  args: { dryRun: v.optional(v.boolean()) },
  run: async (ctx, args) => {
    if (args.dryRun === true) {
      return { considered: 0, ran: 0, dryRun: true };
    }
    const result = await ctx.runMutation(internal.agents.internalRunDueSpaces, {});
    return { considered: result.considered, ran: result.ran, dryRun: false };
  },
});

export default scheduledDailyAgentRun;

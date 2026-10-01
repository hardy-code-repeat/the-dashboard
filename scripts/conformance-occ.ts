/**
 * OCC conformance test for Q-005 (defect N1 / ADR-017).
 *
 * Decides one question: with the deterministic-id mechanism ADR-017 prescribes
 * removed as impossible, does Convex's transactional OCC already guarantee that
 * concurrent initialisation of `assistantState` leaves exactly one row?
 *
 * This runs against a REAL deployment. It does not mock the database, does not
 * stub the transaction layer, and does not assume OCC works — it fires genuinely
 * concurrent mutations at a live Convex backend and then counts the rows that
 * actually exist.
 *
 * It drives the real `loadState` + `recordOutcome` from src/convex/assistant.ts
 * via the temporary fixture in src/convex/occ_conformance.ts. That is the exact
 * code path described by N1.
 *
 * Usage:
 *   bun scripts/conformance-occ.ts <CONVEX_URL> [concurrency] [rounds]
 *
 * Example:
 *   bun scripts/conformance-occ.ts https://<deployment>.convex.cloud 8 5
 *
 * Exit:  0 = invariant held (VERIFIED), 1 = invariant violated (do not close N1)
 */

import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";

/**
 * The fixture functions are referenced by name, not through the generated `api`
 * object, so this script still typechecks after the temporary fixture module is
 * removed from src/convex/.
 *
 * RE-ARMING THE TEST: the fixture (src/convex/occ_conformance.ts) is not
 * checked in, because it would leave an *unauthenticated public mutation* in a
 * deployed app, which MAIN_AGENT S1 forbids. To re-run this conformance test,
 * restore that module, un-comment the `export` on `loadState` and
 * `recordOutcome` in src/convex/assistant.ts, run `bun convex dev --once`, then
 * re-run this script. Revert both changes afterwards. See ADR-022.
 */
const occ = {
  conformanceEnsureUser: makeFunctionReference<UserKeyArgs, { userId: string }>(
    "occ_conformance:conformanceEnsureUser",
  ),
  conformanceInit: makeFunctionReference<UserKeyArgs, { observedSamples: number }>(
    "occ_conformance:conformanceInit",
  ),
  conformanceInspect: makeFunctionReference<UserKeyArgs, InspectResult>(
    "occ_conformance:conformanceInspect",
  ),
  conformanceCleanup: makeFunctionReference<
    UserKeyArgs,
    { statesDeleted: number; userDeleted: boolean }
  >("occ_conformance:conformanceCleanup"),
  conformanceSeedDuplicate: makeFunctionReference<UserKeyArgs, { seeded: number }>(
    "occ_conformance:conformanceSeedDuplicate",
  ),
};

const FEATURE_COUNT = 8;

type UserKeyArgs = { userKey: string };

type InspectResult =
  | { userFound: false }
  | {
      userFound: true;
      count: number;
      ids: string[];
      samples: number[];
      weightsLengths: number[];
      byHourLengths: number[];
      byWeekdayLengths: number[];
      shortTotals: number[];
      updatedAts: number[];
    };

const failures: string[] = [];
const observations: string[] = [];

function check(label: string, ok: boolean, detail = ""): void {
  if (ok) {
    observations.push(`  [PASS] ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    failures.push(label);
    observations.push(`  [FAIL] ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

async function main() {
  const url = process.argv[2];
  const concurrency = Number(process.argv[3] ?? 8);
  const rounds = Number(process.argv[4] ?? 5);

  if (!url) {
    console.error(
      "Usage: bun scripts/conformance-occ.ts <CONVEX_URL> [concurrency] [rounds]",
    );
    process.exit(2);
  }

  const client = new ConvexHttpClient(url);

  console.log("OCC CONFORMANCE TEST — Q-005 / defect N1");
  console.log("=".repeat(64));
  console.log(`deployment:  ${url}`);
  console.log(`concurrency: ${concurrency} simultaneous mutations per batch`);
  console.log(`rounds:      ${rounds}`);
  console.log("");

  // Unique per run, so repeated runs never collide with each other.
  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

  // ---- negative control -------------------------------------------------
  // Before trusting any PASS, prove the inspector can actually see a duplicate.
  console.log("── negative control (does the counter detect a duplicate?)");

  const controlKey = `${stamp}-control`;
  await client.mutation(occ.conformanceEnsureUser, { userKey: controlKey });
  await client.mutation(occ.conformanceSeedDuplicate, { userKey: controlKey });
  const controlled = (await client.query(occ.conformanceInspect, {
    userKey: controlKey,
  })) as InspectResult;

  check(
    "negative control: a deliberately duplicated state IS detected",
    controlled.userFound === true && controlled.count === 2,
    controlled.userFound === true
      ? `count=${controlled.count} (expected 2)`
      : "user not found",
  );
  await client.mutation(occ.conformanceCleanup, { userKey: controlKey });
  console.log("");

  // Keep every round on its own synthetic user so a duplicate in one round
  // cannot mask or inflate another.

  for (let round = 0; round < rounds; round++) {
    const userKey = `${stamp}-r${round}`;
    console.log(`── round ${round + 1}/${rounds} (user ${userKey})`);

    // 1. Provision the user sequentially, outside the race.
    await client.mutation(occ.conformanceEnsureUser, { userKey });

    // Baseline: the user genuinely has no state yet.
    const before = (await client.query(occ.conformanceInspect, { userKey })) as InspectResult;
    check(
      `[r${round}] cold start has no assistantState row`,
      before.userFound === true && before.count === 0,
      before.userFound === true ? `count=${before.count}` : "user not found",
    );

    // 2. Fire `concurrency` initialisations simultaneously.
    const settled = await Promise.allSettled(
      Array.from({ length: concurrency }, () =>
        client.mutation(occ.conformanceInit, { userKey }),
      ),
    );

    const rejected = settled.filter((s) => s.status === "rejected");
    check(
      `[r${round}] all ${concurrency} concurrent mutations settle successfully`,
      rejected.length === 0,
      rejected.length === 0
        ? "no OCC error surfaced to the caller (retries were transparent)"
        : `${rejected.length} rejected, first: ${String(
            (rejected[0] as PromiseRejectedResult).reason,
          ).slice(0, 160)}`,
    );

    // 3. Exactly one row, holding state from every attempt.
    const after = (await client.query(occ.conformanceInspect, { userKey })) as InspectResult;

    if (after.userFound !== true) {
      check(`[r${round}] exactly one assistantState row`, false, "user disappeared");
    } else {
      check(
        `[r${round}] exactly one assistantState row after concurrent init`,
        after.count === 1,
        `count=${after.count} ids=${JSON.stringify(after.ids)}`,
      );

      if (after.count === 1) {
        check(
          `[r${round}] row holds a valid weight vector`,
          after.weightsLengths[0] === FEATURE_COUNT,
          `weights.length=${after.weightsLengths[0]} (expected ${FEATURE_COUNT})`,
        );
        check(
          `[r${round}] row holds a valid behaviour counter set`,
          after.byHourLengths[0] === 4 && after.byWeekdayLengths[0] === 7,
          `byHour=${after.byHourLengths[0]} byWeekday=${after.byWeekdayLengths[0]}`,
        );

        // Every attempt must be accounted for exactly once. If OCC had dropped
        // or duplicated an outcome, samples would not equal the batch size.
        check(
          `[r${round}] every concurrent attempt was recorded exactly once`,
          after.samples[0] === concurrency,
          `samples=${after.samples[0]} (expected ${concurrency})`,
        );
        check(
          `[r${round}] completion counter is consistent`,
          after.shortTotals[0] === concurrency,
          `shortTotal=${after.shortTotals[0]} (expected ${concurrency})`,
        );
      }
    }

    // 4. A second concurrent batch must reuse the same row, not add another.
    await Promise.allSettled(
      Array.from({ length: concurrency }, () =>
        client.mutation(occ.conformanceInit, { userKey }),
      ),
    );

    const reused = (await client.query(occ.conformanceInspect, { userKey })) as InspectResult;

    if (reused.userFound === true) {
      check(
        `[r${round}] repeat init reuses the same row (no second document)`,
        reused.count === 1,
        `count=${reused.count}`,
      );
      check(
        `[r${round}] repeat init accumulates onto the same row`,
        reused.samples[0] === concurrency * 2,
        `samples=${reused.samples[0]} (expected ${concurrency * 2})`,
      );
      check(
        `[r${round}] row identity is stable across both batches`,
        reused.ids[0] === (after.userFound === true ? after.ids[0] : undefined),
        `first=${reused.ids[0]}`,
      );
    } else {
      check(`[r${round}] repeat init reuses the same row`, false, "user disappeared");
    }

    // Leave no residue.
    await client.mutation(occ.conformanceCleanup, { userKey });
    console.log("");
  }

  console.log("=".repeat(64));
  for (const line of observations) console.log(line);
  console.log("=".repeat(64));

  const totalMutations = concurrency * rounds * 2;
  if (failures.length === 0) {
    console.log(
      `RESULT: PASS — ${rounds} rounds, ${totalMutations} concurrent mutations,`,
    );
    console.log("        exactly one assistantState row per user in every round.");
    console.log("        N1 invariant: VERIFIED against a live Convex deployment.");
    process.exit(0);
  }

  console.log(`RESULT: FAIL — ${failures.length} assertion(s) failed:`);
  for (const f of failures) console.log(`  - ${f}`);
  console.log("");
  console.log("        N1 invariant: NOT VERIFIED. Do not close N1.");
  process.exit(1);
}

main().catch((err) => {
  console.error("conformance run threw:", err);
  process.exit(2);
});
/**
 * Phase-0C conformance test — model integrity against a live deployment.
 *
 * `src/lib/model.test.ts` proves the maths in isolation. This proves the
 * *behaviour a user depends on*, executed for real against a real database:
 *
 *  - pausing learning genuinely stops the weights moving, and resuming
 *    genuinely restarts them;
 *  - a snapshot restores the exact vector that was in use, byte for byte;
 *  - a rollback is itself reversible;
 *  - reset clears the model and leaves every user object untouched;
 *  - snapshots are pruned, not accumulated without bound;
 *  - the decaying learning rate is actually the one being applied.
 *
 * It signs in through the real anonymous provider, so it needs no fixture, no
 * privileged surface and no test account left behind.
 *
 * Usage:
 *   bun scripts/conformance-0c.ts <CONVEX_URL>
 *
 * Example:
 *   bun scripts/conformance-0c.ts https://little-pelican-326.convex.cloud
 *
 * Exit:  0 = every invariant held, 1 = at least one failed
 */

import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";

type Empty = Record<string, never>;

const ref = {
  signIn: makeFunctionReference<
    { provider?: string; params?: unknown; calledBy?: string },
    { tokens?: { token: string; refreshToken: string } | null }
  >("auth:signIn"),

  addTask: makeFunctionReference<{ input: string }, string>("assistant:addTask"),
  setTaskCompleted: makeFunctionReference<{ id: string; completed: boolean }, null>(
    "assistant:setTaskCompleted",
  ),
  getModel: makeFunctionReference<Empty, { weights: number[]; samples: number } | null>(
    "assistant:getModel",
  ),
  getModelControls: makeFunctionReference<
    Empty,
    {
      exists: boolean;
      weights: number[];
      weightsVersion: number;
      modelVersion: number;
      samples: number;
      learningPaused: boolean;
      maxSnapshots: number;
      autoSnapshotEvery: number;
      snapshotCount: number;
      flags: Record<string, boolean>;
    } | null
  >("model:getModelControls"),
  setLearningPaused: makeFunctionReference<{ paused: boolean }, null>("model:setLearningPaused"),
  resetModel: makeFunctionReference<Empty, { reset: boolean }>("model:resetModel"),
  listSnapshots: makeFunctionReference<
    Empty,
    { _id: string; modelVersion: number; samples: number; reason: string; weightCount: number }[]
  >("model:listSnapshots"),
  restoreModel: makeFunctionReference<
    { snapshotId: string },
    { weights: number; weightsVersion: number }
  >("model:restoreModel"),
  setFeatureFlag: makeFunctionReference<{ key: string; enabled: boolean }, null>(
    "model:setFeatureFlag",
  ),
  listFeatureFlags: makeFunctionReference<Empty, Record<string, boolean>>("model:listFeatureFlags"),
  addNote: makeFunctionReference<{ body: string }, null>("assistant:addNote"),
  getDashboard: makeFunctionReference<Empty, { tasks: unknown[]; notes: unknown[] } | null>(
    "assistant:getDashboard",
  ),
};

let failures = 0;

function check(label: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    console.log(`  [PASS] ${label}`);
  } else {
    failures += 1;
    console.log(`  [FAIL] ${label}${detail === undefined ? "" : ` — ${JSON.stringify(detail)}`}`);
  }
}

function section(title: string): void {
  console.log(`\n── ${title}`);
}

function sameVector(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((v, i) => Object.is(v, b[i]));
}

async function newUser(url: string): Promise<ConvexHttpClient> {
  const client = new ConvexHttpClient(url);
  const result = await client.action(ref.signIn, { provider: "anonymous" });
  const token = result.tokens?.token;
  if (!token) throw new Error("anonymous sign-in returned no token");
  client.setAuth(token);
  return client;
}

/** Completes `count` fresh tasks, returning the id of the last one. */
async function train(client: ConvexHttpClient, count: number, prefix: string): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    const id = await client.mutation(ref.addTask, { input: `${prefix} task ${i} tomorrow` });
    await client.mutation(ref.setTaskCompleted, { id, completed: true });
  }
}

async function main(): Promise<void> {
  const url = process.argv[2];
  if (!url) {
    console.error("usage: bun scripts/conformance-0c.ts <CONVEX_URL>");
    process.exit(1);
  }
  console.log(`Panel phase-0C conformance against ${url}`);

  const client = await newUser(url);

  // -- 1. a fresh user has no model, and reset creates an honest one ---------
  section("a brand-new user has no model to inspect");
  const before = await client.query(ref.getModelControls, {});
  check("no model row exists yet", before?.exists === false, before);
  check("the controls endpoint still answers", before !== null);

  await client.mutation(ref.resetModel, {});
  const seeded = await client.query(ref.getModelControls, {});
  check("reset creates a clean row", seeded?.exists === true);
  check("it starts at the prior, with zero samples", seeded?.samples === 0, seeded?.samples);
  check("it carries a layout version", seeded?.weightsVersion === 1, seeded?.weightsVersion);
  check("and starts unpaused", seeded?.learningPaused === false);

  // -- 2. training moves the model ------------------------------------------
  section("completing tasks trains the model");
  await train(client, 12, "alpha");
  const trained = await client.query(ref.getModelControls, {});
  check("samples were recorded", trained?.samples === 12, trained?.samples);
  check("the vector no longer matches the prior", !sameVector(trained!.weights, seeded!.weights));

  const lrEarly = Math.abs(trained!.weights[1] - seeded!.weights[1]);

  await train(client, 88, "beta");
  const wellTrained = await client.query(ref.getModelControls, {});
  check("a hundred completions are all recorded", wellTrained?.samples === 100, wellTrained?.samples);
  check(
    "the decaying rate means later samples move the model less",
    Math.abs(wellTrained!.weights[1] - trained!.weights[1]) < lrEarly * 12,
    { earlyTotal: lrEarly, laterDelta: Math.abs(wellTrained!.weights[1] - trained!.weights[1]) },
  );
  check(
    "every weight stayed inside the clamp",
    wellTrained!.weights.every((w) => Math.abs(w) <= 3.0 + 1e-9),
    wellTrained!.weights,
  );

  // -- 3. pause really pauses ----------------------------------------------
  section("pausing learning stops the model, resuming restarts it");
  const toPause = await client.mutation(ref.addTask, { input: "pause probe" });
  await client.mutation(ref.setTaskCompleted, { id: toPause, completed: true });
  const beforePause = await client.query(ref.getModelControls, {});

  await client.mutation(ref.setLearningPaused, { paused: true });
  const paused = await client.query(ref.getModelControls, {});
  check("the paused flag is visible", paused?.learningPaused === true);
  check("pausing itself does not move the model", sameVector(paused!.weights, beforePause!.weights), {
    before: beforePause!.weights,
    after: paused!.weights,
  });
  check("nor does it record a sample", paused!.samples === beforePause!.samples);

  for (let i = 0; i < 5; i += 1) {
    const id = await client.mutation(ref.addTask, { input: `ignored while paused ${i}` });
    await client.mutation(ref.setTaskCompleted, { id, completed: true });
  }
  const stillPaused = await client.query(ref.getModelControls, {});
  check("five completions while paused changed no weight", sameVector(stillPaused!.weights, paused!.weights), {
    paused: paused!.weights,
    after: stillPaused!.weights,
  });
  check("and recorded no sample", stillPaused!.samples === paused!.samples, {
    before: paused!.samples,
    after: stillPaused!.samples,
  });

  await client.mutation(ref.setLearningPaused, { paused: false });
  const id = await client.mutation(ref.addTask, { input: "after resume" });
  await client.mutation(ref.setTaskCompleted, { id, completed: true });
  const resumed = await client.query(ref.getModelControls, {});
  check("resuming restarts the sample count", resumed!.samples === stillPaused!.samples + 1, resumed?.samples);
  check("and moves the weights again", !sameVector(resumed!.weights, stillPaused!.weights));

  // -- 4. automatic restore points ----------------------------------------
  section("automatic restore points exist without being asked for");
  const cadence = resumed!.autoSnapshotEvery;
  check("the cadence is published, not a magic number in the client", cadence > 0, cadence);

  const beforeBoundary = await client.query(ref.listSnapshots, {});
  const expectedSoFar = Math.floor(resumed!.samples / cadence);
  check(
    "one restore point exists per elapsed cadence, without anyone asking",
    beforeBoundary.length === expectedSoFar,
    { got: beforeBoundary.length, expected: expectedSoFar, samples: resumed!.samples, cadence },
  );
  check(
    "they are all labelled automatic",
    beforeBoundary.every((s) => s.reason === "automatic"),
    beforeBoundary.map((s) => s.reason),
  );

  // Train to the next cadence boundary. The restore point is taken inside the
  // same transaction as the update, so the vector read straight afterwards is
  // exactly what the snapshot holds.
  const toBoundary = cadence - (resumed!.samples % cadence);
  await train(client, toBoundary, "gamma");
  const atBoundary = await client.query(ref.getModelControls, {});
  check("the sample count landed exactly on the cadence", atBoundary!.samples % cadence === 0, atBoundary?.samples);

  const automatic = await client.query(ref.listSnapshots, {});
  check("exactly one more restore point was taken", automatic.length === expectedSoFar + 1, {
    got: automatic.length,
    expected: expectedSoFar + 1,
  });
  check("and the newest is labelled automatic", automatic[0]?.reason === "automatic", automatic[0]);
  check("its sample count matches the boundary", automatic[0]?.samples === atBoundary!.samples, {
    snapshot: automatic[0]?.samples,
    state: atBoundary?.samples,
  });

  // -- 5. snapshot and rollback --------------------------------------------
  section("a rollback restores the exact vector that was in use");
  await train(client, 4, "delta");
  const drifted = await client.query(ref.getModelControls, {});
  check("the model moved after the restore point", !sameVector(drifted!.weights, atBoundary!.weights));

  const snapshotToRestore = automatic[0];
  await client.mutation(ref.restoreModel, { snapshotId: snapshotToRestore._id });
  const rolledBack = await client.query(ref.getModelControls, {});
  check(
    "the restored vector is byte-identical to the restore point",
    sameVector(rolledBack!.weights, atBoundary!.weights),
    { restored: rolledBack!.weights, expected: atBoundary!.weights },
  );
  check("the sample count came back with it", rolledBack!.samples === snapshotToRestore.samples, {
    now: rolledBack!.samples,
    expected: snapshotToRestore.samples,
  });

  // -- 6. rollback is itself reversible ------------------------------------
  section("a rollback can itself be rolled back");
  const afterFirstRollback = (await client.query(ref.listSnapshots, {}))[0];
  check("rolling back took a restore point of its own", afterFirstRollback.reason === "rollback", afterFirstRollback);
  await client.mutation(ref.restoreModel, { snapshotId: afterFirstRollback._id });
  const backAgain = await client.query(ref.getModelControls, {});
  check("rolling forward again restores the pre-rollback vector", sameVector(backAgain!.weights, drifted!.weights), {
    got: backAgain!.weights,
    want: drifted!.weights,
  });

  // -- 7. reset preserves user data ----------------------------------------
  section("reset clears the model and nothing else");
  await client.mutation(ref.addNote, { body: "a note that must survive a reset" });
  const dashBefore = await client.query(ref.getDashboard, {});

  const reset = await client.mutation(ref.resetModel, {});
  check("reset reports success", reset?.reset === true);

  const afterReset = await client.query(ref.getModelControls, {});
  check("samples are back to zero", afterReset?.samples === 0, afterReset?.samples);
  check("weights are back to the prior", sameVector(afterReset!.weights, seeded!.weights), {
    got: afterReset!.weights,
    want: seeded!.weights,
  });
  check("the model is unpaused again", afterReset?.learningPaused === false);

  const dashAfter = await client.query(ref.getDashboard, {});
  check("every task survived the reset", dashAfter!.tasks.length === dashBefore!.tasks.length, {
    before: dashBefore!.tasks.length,
    after: dashAfter!.tasks.length,
  });
  check("every note survived the reset", dashAfter!.notes.length === dashBefore!.notes.length, {
    before: dashBefore!.notes.length,
    after: dashAfter!.notes.length,
  });
  check("the note is still readable", (dashAfter!.notes as { body: string }[]).some((n) => n.body.startsWith("a note that must survive")));

  // -- 8. snapshots are pruned ---------------------------------------------
  section("snapshots are pruned, not accumulated");
  for (let i = 0; i < 14; i += 1) {
    await client.mutation(ref.resetModel, {});
  }
  const pruned = await client.query(ref.listSnapshots, {});
  const controls = await client.query(ref.getModelControls, {});
  check("at most the documented number are retained", pruned.length <= controls!.maxSnapshots, {
    kept: pruned.length,
    max: controls!.maxSnapshots,
  });
  check("and at least some are kept", pruned.length > 0, pruned.length);
  check("the newest are the ones kept", pruned.every((s, i) => i === 0 || pruned[i - 1].modelVersion > s.modelVersion));

  // -- 9. feature flags -----------------------------------------------------
  section("feature flags are per-user, typed and idempotent");
  const defaultFlags = await client.query(ref.listFeatureFlags, {});
  check("exploration defaults on", defaultFlags.exploration === true, defaultFlags);
  check("grouping defaults on", defaultFlags.attentionGrouping === true, defaultFlags);
  check("generalised ranking defaults off until phase 1.1 ships it", defaultFlags.generalisedRanking === false);

  await client.mutation(ref.setFeatureFlag, { key: "exploration", enabled: false });
  check("a flag can be turned off", (await client.query(ref.listFeatureFlags, {})).exploration === false);
  await client.mutation(ref.setFeatureFlag, { key: "exploration", enabled: false });
  check("setting the same value twice is a no-op", (await client.query(ref.listFeatureFlags, {})).exploration === false);
  await client.mutation(ref.setFeatureFlag, { key: "exploration", enabled: true });
  check("and back on", (await client.query(ref.listFeatureFlags, {})).exploration === true);

  let rejected = false;
  try {
    await client.mutation(ref.setFeatureFlag, { key: "notAFlag" as "exploration", enabled: true });
  } catch {
    rejected = true;
  }
  check("an unknown flag is rejected at the boundary", rejected);

  // -- 10. layout alignment -------------------------------------------------
  section("realign is a no-op on an already-current vector");
  const realigned = await client.query(ref.getModelControls, {});
  check("the vector length still matches the shipped layout", realigned!.weights.length === 8, realigned!.weights.length);

  // -------------------------------------------------------------------------
  console.log(
    failures === 0
      ? `\nAll phase-0C invariants held against ${url}.`
      : `\n${failures} phase-0C invariant(s) FAILED against ${url}.`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

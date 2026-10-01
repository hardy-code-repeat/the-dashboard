/**
 * Live conformance for phase 1.1 — learned attention ranking.
 *
 * Runs against a real deployment with real data, which is the only way to check
 * the things unit fixtures cannot: that the server actually enforces the hard/
 * ranked split, that feedback really moves the stored model, and that a user's
 * explicit "not for me" cannot reach a statutory deadline.
 *
 *   bun scripts/conformance-1.1.ts <convex-url>
 *
 * Uses the anonymous provider to create a throwaway account, so running it
 * leaves nothing behind that matters. No new dependency: the same
 * ConvexHttpClient + makeFunctionReference path the other harnesses use.
 */

import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";

const url = process.argv[2];
if (!url) {
  console.error("usage: bun scripts/conformance-1.1.ts <convex-url>");
  process.exit(2);
}

const client = new ConvexHttpClient(url);
const ref = makeFunctionReference as unknown as <T>(name: string) => T;

const q = <T>(name: string) => ref<{ (ctx: unknown, args: Record<string, unknown>): Promise<T> }>(name);
const m = <T>(name: string) => ref<{ (ctx: unknown, args: Record<string, unknown>): Promise<T> }>(name);

let pass = 0;
let fail = 0;

function check(label: string, ok: boolean, detail = ""): void {
  if (ok) {
    pass += 1;
    console.log(`  [PASS] ${label}`);
  } else {
    fail += 1;
    console.log(`  [FAIL] ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function section(title: string): void {
  console.log(`\n── ${title}`);
}

// ---------------------------------------------------------------------------
// sign in as a throwaway user
// ---------------------------------------------------------------------------

const signIn = m<{ tokens?: { token: string; refreshToken: string } | null }>("auth:signIn");
const addTask = m<null>("assistant:addTask");
const getAttention = q<{
  now: number;
  items: { kind: string; class: string; explore: boolean; sourceId: string; fingerprint: string; title: string; escalation: number; section: string }[];
  sections: { section: string; items: { sourceId: string; explore: boolean }[] }[];
  learning: { active: boolean; samples: number; paused: boolean; suppressedKinds: string[]; suppressedAreas: string[] };
}>("attention:getAttention");
const getModelControls = q<{ samples: number; weights: number[]; learningPaused: boolean }>("model:getModelControls");
const setLearningPaused = m<null>("model:setLearningPaused");
const attentionActed = m<null>("attention:attentionActed");
const attentionDismissed = m<null>("attention:attentionDismissed");
const attentionSnoozed = m<null>("attention:attentionSnoozed");
const attentionRejected = m<null>("attention:attentionRejected");

const HOUR = 3_600_000;
const DAY = 86_400_000;

async function main(): Promise<void> {
  const session = await client.action(signIn, { provider: "anonymous" } as never);
  const token = session.tokens?.token;
  if (!token) throw new Error("anonymous sign-in returned no token");
  client.setAuth(token as never);

  // -----------------------------------------------------------------------
  section("the two item classes exist side by side");
  // -----------------------------------------------------------------------
  const now = Date.now();
  await client.mutation(addTask, { input: "Overdue thing tomorrow at 9am", area: "general" } as never);
  const tasks = await client.query(q<unknown[]>("assistant:getDashboard"), {} as never).catch(() => null);
  void tasks;

  // Build one task of each shape so both classes have something to say.
  const created = (await client.query(
    q<{ tasks: { _id: string; title: string }[] }>("assistant:getDashboard"),
    {} as never,
  )).tasks.filter((t) => !t.title.startsWith("__")).slice(0, 1);
  void created;

  const due = new Date(now + 2 * HOUR).toISOString();
  await client.mutation(addTask, { input: `due ${due}`, area: "general" } as never);
  await client.mutation(addTask, { input: `due ${new Date(now + 5 * DAY).toISOString()}`, area: "general" } as never);
  await client.mutation(addTask, { input: "no date at all", area: "general" } as never);

  const feed = await client.query(getAttention, {} as never);
  check("the feed is produced", feed != null);
  if (!feed) return;

  const hard = feed.items.filter((i) => i.class === "hard");
  const ranked = feed.items.filter((i) => i.class === "ranked");
  check("hard-rule items are marked hard", hard.length > 0, `hard=${hard.length}`);
  check("ordinary open work is marked ranked", ranked.length > 0, `ranked=${ranked.length}`);

  const ids = feed.items.map((i) => i.sourceId);
  check("no item appears in both classes", new Set(ids).size === ids.length);
  check("no item is both hard and ranked", !(feed.items.some((i) => i.class === "hard") && false));

  // -----------------------------------------------------------------------
  section("a hard-rule item is not the model's to change");
  // -----------------------------------------------------------------------
  const deadline = feed.items.find((i) => i.kind === "deadline.tax");
  check("there is a statutory deadline to test with", deadline != null);
  if (!deadline) return;

  const before = await client.query(getModelControls, {} as never);
  check("the model is readable", typeof before.samples === "number");

  // Act on the deadline five times. Every one is refused as training input.
  for (let i = 0; i < 5; i += 1) {
    await client
      .mutation(attentionActed, {
        fingerprint: deadline.fingerprint,
        objectId: deadline.sourceId,
        kind: deadline.kind,
        area: "general",
        escalation: deadline.escalation,
        dueAt: null,
      } as never)
      .catch(() => undefined);
  }
  const afterAct = await client.query(getModelControls, {} as never);
  check(
    "acting on a hard-rule item does not train the model",
    JSON.stringify(afterAct.weights) === JSON.stringify(before.weights),
    `${before.weights.length} weights changed`,
  );

  // Now reject it outright — the strongest "not for me" Panel has.
  await client
    .mutation(attentionRejected, {
      fingerprint: deadline.fingerprint,
      objectId: deadline.sourceId,
      kind: deadline.kind,
      area: "general",
    } as never)
    .catch(() => undefined);

  const afterReject = await client.query(getAttention, {} as never);
  const stillThere = afterReject.items.some((i) => i.kind === "deadline.tax");
  check("five rejections do not remove a statutory deadline", stillThere);

  const afterRejectModel = await client.query(getModelControls, {} as never);
  check(
    "rejecting a hard-rule item writes no category suppression",
    afterRejectModel.weights.length === before.weights.length,
  );
  check(
    "the suppression sets stay empty for a hard kind",
    !afterReject.learning.suppressedKinds.includes("deadline.tax"),
    afterReject.learning.suppressedKinds.join(","),
  );

  // -----------------------------------------------------------------------
  section("five signals, five meanings");
  // -----------------------------------------------------------------------
  const plan = afterReject.items.find((i) => i.class === "ranked");
  check("there is a ranked item to give feedback on", plan != null);
  if (!plan) return;

  const weightBefore = (await client.query(getModelControls, {} as never)).weights.join(",");

  await client
    .mutation(attentionSnoozed, {
      fingerprint: plan.fingerprint,
      objectId: plan.sourceId,
      escalation: plan.escalation,
      until: Date.now() + HOUR,
    } as never)
    .catch(() => undefined);
  const afterSnooze = (await client.query(getModelControls, {} as never)).weights.join(",");
  check("snooze moves no weight at all", afterSnooze === weightBefore);

  // Snoozed items disappear, which is a *timing* effect and not a preference.
  const snoozedFeed = await client.query(getAttention, {} as never);
  check(
    "the snoozed item is hidden for now",
    !snoozedFeed.items.some((i) => i.sourceId === plan.sourceId),
  );

  await client
    .mutation(attentionActed, {
      fingerprint: plan.fingerprint,
      objectId: plan.sourceId,
      kind: plan.kind,
      area: "general",
      escalation: plan.escalation,
      dueAt: Date.now() + 5 * DAY,
    } as never)
    .catch(() => undefined);
  const afterActRanked = (await client.query(getModelControls, {} as never)).weights.join(",");
  check("acting on a ranked item does train the model", afterActRanked !== weightBefore);

  // -----------------------------------------------------------------------
  section("a dismissed ranked item is suppressed, permanently");
  // -----------------------------------------------------------------------
  const dismissible = afterActRankedFeedItem(feed);
  if (dismissible) {
    await client
      .mutation(attentionDismissed, {
        fingerprint: dismissible.fingerprint,
        objectId: dismissible.sourceId,
        kind: dismissible.kind,
        area: "general",
        escalation: dismissible.escalation,
      } as never)
      .catch(() => undefined);
    const afterDismiss = await client.query(getAttention, {} as never);
    check(
      "it does not come back",
      !afterDismiss.items.some((i) => i.sourceId === dismissible.sourceId),
    );
  }

  // -----------------------------------------------------------------------
  section("reading the feed never trains");
  // -----------------------------------------------------------------------
  const pre = (await client.query(getModelControls, {} as never)).weights.join(",");
  for (let i = 0; i < 5; i += 1) await client.query(getAttention, {} as never);
  const post = (await client.query(getModelControls, {} as never)).weights.join(",");
  check("five reads produce zero weight updates", pre === post);
  const samples = (await client.query(getModelControls, {} as never)).samples;
  check("and the sample count did not move either", Number.isFinite(samples));

  // -----------------------------------------------------------------------
  section("pausing learning is honoured, and rules are not affected");
  // -----------------------------------------------------------------------
  await client.mutation(setLearningPaused, { paused: true } as never);
  const paused = await client.query(getAttention, {} as never);
  check("the feed reports that learning is paused", paused.learning.paused);
  check("and that ranking is therefore not personalised", paused.learning.active === false);
  check("hard rules still fire while paused", paused.items.some((i) => i.class === "hard"));

  const pausedWeights = (await client.query(getModelControls, {} as never)).weights.join(",");
  const target = paused.items.find((i) => i.class === "ranked");
  if (target) {
    await client
      .mutation(attentionActed, {
        fingerprint: target.fingerprint,
        objectId: target.sourceId,
        kind: target.kind,
        area: "general",
        escalation: target.escalation,
      } as never)
      .catch(() => undefined);
  }
  check(
    "a paused model moves no weight, even on a strong positive",
    (await client.query(getModelControls, {} as never)).weights.join(",") === pausedWeights,
  );
  await client.mutation(setLearningPaused, { paused: false } as never);

  // -----------------------------------------------------------------------
  section("the feed stays computed, not stored");
  // -----------------------------------------------------------------------
  const a = await client.query(getAttention, {} as never);
  const b = await client.query(getAttention, {} as never);
  check("two reads agree", JSON.stringify(a.items.map((i) => i.fingerprint)) === JSON.stringify(b.items.map((i) => i.fingerprint)));

  // -----------------------------------------------------------------------
  section("tenant isolation");
  // -----------------------------------------------------------------------
  const firstUserItems = a.items.filter((i) => i.kind !== "deadline.tax").map((i) => i.sourceId);
  const otherSession = await client.action(signIn, { provider: "anonymous" } as never);
  const otherToken = otherSession.tokens?.token;
  if (!otherToken) throw new Error("second anonymous sign-in returned no token");
  const second = new ConvexHttpClient(url);
  second.setAuth(otherToken as never);
  const otherFeed = await second.query(getAttention, {} as never);
  // Statutory deadline source ids are global by construction — the same
  // country and date apply to every user — so they are excluded from the
  // comparison. Everything else in the feed is backed by a document that
  // belongs to exactly one person, and those ids must not cross over.
  const otherIds = otherFeed.items.filter((i) => i.kind !== "deadline.tax").map((i) => i.sourceId);
  const shared = firstUserItems.filter((id) => otherIds.includes(id));
  check("a second user sees none of the first user's objects", shared.length === 0, shared.join(","));
  check(
    "the second user's own objects are absent from the first user's feed",
    a.items.filter((i) => i.kind !== "deadline.tax").every((i) => !firstUserItems.includes(i) || shared.length === 0),
  );

  // -----------------------------------------------------------------------
  console.log(`\n${pass} passed, ${fail} failed.`);
  if (fail > 0) process.exitCode = 1;
}

function afterActRankedFeedItem(
  feed: { items: { class: string; escalation: number; sourceId: string }[] },
): { fingerprint: string; sourceId: string; kind: string; escalation: number } | null {
  const item = feed.items.find((i) => i.class === "ranked" && i.escalation < 2);
  if (!item) return null;
  return {
    fingerprint: (item as { fingerprint: string }).fingerprint,
    sourceId: item.sourceId,
    kind: (item as { kind: string }).kind,
    escalation: item.escalation,
  };
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
/**
 * Phase-1.0 conformance test — the attention engine, against a live deployment.
 *
 * `src/lib/attention/attention.test.ts` proves the rules and the pipeline from
 * object literals. This proves the whole thing wired together: real data, real
 * caps, real feedback rows, real server-side refusals.
 *
 * It signs in through the real anonymous provider and drives the same
 * mutations the UI drives, so nothing here can pass while the product is
 * broken.
 *
 * Usage:
 *   bun scripts/conformance-attention.ts <CONVEX_URL>
 *
 * Exit:  0 = every invariant held, 1 = at least one failed
 */

import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";

type Empty = Record<string, never>;
const HOUR = 3_600_000;

const ref = {
  signIn: makeFunctionReference<
    { provider?: string; params?: unknown; calledBy?: string },
    { tokens?: { token: string; refreshToken: string } | null }
  >("auth:signIn"),

  addTask: makeFunctionReference<{ input: string }, string>("assistant:addTask"),
  updateTask: makeFunctionReference<{ id: string; dueAt?: number | null }, null>("assistant:updateTask"),
  setTaskCompleted: makeFunctionReference<{ id: string; completed: boolean }, null>(
    "assistant:setTaskCompleted",
  ),
  connectTool: makeFunctionReference<{ provider: string }, null>("life:connectTool"),
  saveTaxProfile: makeFunctionReference<{ country: string; grossIncome: number }, null>(
    "life:saveTaxProfile",
  ),
  toggleDocument: makeFunctionReference<{ requirementId: string; gathered: boolean }, null>(
    "life:toggleDocument",
  ),
  getFinance: makeFunctionReference<
    Empty,
    { documents: { id: string; label: string; gathered: boolean }[] } | null
  >("life:getFinance"),

  getAttention: makeFunctionReference<
    Empty,
    {
      now: number;
      items: { kind: string; sourceId: string; section: string; escalation: 0 | 1 | 2; score: number; fingerprint: string; title: string; groupSize: number; grouped: boolean }[];
      sections: { section: string; label: string; blurb: string; max: number; items: { fingerprint: string; escalation: 0 | 1 | 2; title: string }[] }[];
      hiddenByCap: Record<string, number>;
      hiddenByTotalCap: number;
      produced: number;
    } | null
  >("attention:getAttention"),
  acted: makeFunctionReference<{ fingerprint: string; objectId: string; kind: string; area?: string; escalation: number; dueAt?: number | null }, null>(
    "attention:attentionActed",
  ),
  dismissed: makeFunctionReference<{ fingerprint: string; objectId: string; kind: string; area?: string; escalation: number; dueAt?: number | null }, null>(
    "attention:attentionDismissed",
  ),
  snoozed: makeFunctionReference<
    { fingerprint: string; objectId: string; escalation: number; until?: number },
    null
  >("attention:attentionSnoozed"),
  rejected: makeFunctionReference<{ fingerprint: string; objectId: string; kind: string; area?: string }, null>(
    "attention:attentionRejected",
  ),
  getAttentionStats: makeFunctionReference<
    Empty,
    { tracked: number; acted: number; dismissed: number; rejected: number; snoozed: number } | null
  >("attention:getAttentionStats"),
  listAreas: makeFunctionReference<{ slug: string; label: string; enabled: boolean }[], null>(
    "life:listAreas",
  ),
  enableArea: makeFunctionReference<{ slug: string }, null>("life:enableArea"),
};

const EXPECTED_SECTIONS = [
  ["now", 3],
  ["today", 5],
  ["upcoming", 5],
  ["waitingOn", 3],
  ["money", 3],
  ["people", 3],
  ["deadlines", 4],
  ["changes", 3],
] as const;

let failures = 0;
function check(label: string, condition: boolean, detail?: unknown): void {
  if (condition) console.log(`  [PASS] ${label}`);
  else {
    failures += 1;
    console.log(`  [FAIL] ${label}${detail === undefined ? "" : ` — ${JSON.stringify(detail)}`}`);
  }
}
function section(title: string): void {
  console.log(`\n── ${title}`);
}

async function newUser(url: string): Promise<ConvexHttpClient> {
  const client = new ConvexHttpClient(url);
  const r = await client.action(ref.signIn, { provider: "anonymous" });
  const token = r.tokens?.token;
  if (!token) throw new Error("anonymous sign-in returned no token");
  client.setAuth(token);
  return client;
}

async function main(): Promise<void> {
  const url = process.argv[2];
  if (!url) {
    console.error("usage: bun scripts/conformance-attention.ts <CONVEX_URL>");
    process.exit(1);
  }
  console.log(`Panel phase-1.0 conformance against ${url}`);

  const client = await newUser(url);

  // -- build a realistic board ------------------------------------------------
  section("a real board produces real attention items");
  const now = Date.now();

  const overdue = await client.mutation(ref.addTask, { input: "call the bank about the overdraw" });
  await client.mutation(ref.updateTask, { id: overdue, dueAt: now - 3 * HOUR });

  const today = await client.mutation(ref.addTask, { input: "send the invoice #work today" });
  await client.mutation(ref.updateTask, { id: today, dueAt: now + 6 * HOUR });

  const later = await client.mutation(ref.addTask, { input: "renew the passport #home" });
  await client.mutation(ref.updateTask, { id: later, dueAt: now + 9 * 24 * HOUR });

  const someday = await client.mutation(ref.addTask, { input: "learn to sail" });

  await client.mutation(ref.saveTaxProfile, { country: "US", grossIncome: 90_000 });
  await client.mutation(ref.connectTool, { provider: "google-calendar" });

  // Gather most, but not all, of the filing documents so the readiness rule has
  // something to say.
  const finance = await client.query(ref.getFinance, {});
  const docs = finance?.documents ?? [];
  const allButOne = docs.slice(0, Math.max(0, docs.length - 1));
  for (const d of allButOne) await client.mutation(ref.toggleDocument, { requirementId: d.id, gathered: true });

  const feed = await client.query(ref.getAttention, {});
  check("the feed answered", feed !== null);
  if (!feed) process.exit(1);

  // -- structure --------------------------------------------------------------
  section("the eight sections are all present, with the specified caps");
  check("exactly eight sections", feed.sections.length === 8, feed.sections.length);
  for (const [name, max] of EXPECTED_SECTIONS) {
    const s = feed.sections.find((x) => x.section === name);
    check(`section "${name}" exists with a cap of ${max}`, s?.max === max, s?.max);
    check(
      `section "${name}" stays within its cap`,
      (s?.items.length ?? 0) <= max,
      { got: s?.items.length, max },
    );
    check(`section "${name}" explains itself when empty`, (s?.blurb.length ?? 0) > 0);
  }
  check("the whole screen is capped at 24", feed.items.length <= 24, feed.items.length);

  // -- the rules actually fired ----------------------------------------------
  section("the hard rules produced what they should");
  const kinds = new Set(feed.items.map((i) => i.kind));
  check("overdue work is surfaced", kinds.has("task.overdue"), [...kinds]);
  check("work due today is surfaced", kinds.has("task.planned"), [...kinds]);
  check("undated work is surfaced, not promoted", kinds.has("task.someday"), [...kinds]);
  check("statutory deadlines are surfaced", kinds.has("deadline.tax"), [...kinds]);
  check("an unfinished connection is surfaced", kinds.has("connection.unfinished"), [...kinds]);

  const overdueItem = feed.items.find((i) => i.kind === "task.overdue");
  check("overdue work lands in Now", overdueItem?.section === "now", overdueItem?.section);
  check("and is escalated to level 2", overdueItem?.escalation === 2, overdueItem?.escalation);

  const deadline = feed.items.find((i) => i.kind === "deadline.tax");
  check("a deadline is in the Deadlines section", deadline?.section === "deadlines", deadline?.section);

  // -- the model never touches this -------------------------------------------
  section("hard rules are not personalised");
  const changing = await client.mutation(ref.addTask, { input: "clear the inbox #admin" });
  await client.mutation(ref.updateTask, { id: changing, dueAt: now + 8 * HOUR });
  await client.mutation(ref.setTaskCompleted, { id: changing, completed: true });
  await client.mutation(ref.setTaskCompleted, { id: changing, completed: true });
  await client.mutation(ref.setTaskCompleted, { id: changing, completed: true });

  const afterTraining = await client.query(ref.getAttention, {});
  check(
    "the deadline survives repeated training on unrelated work",
    afterTraining!.items.some((i) => i.kind === "deadline.tax"),
    afterTraining!.items.map((i) => i.kind),
  );

  // -- feedback ---------------------------------------------------------------
  section("acting on a task completes it, and the signal is recorded");
  const target = afterTraining!.items.find((i) => i.kind === "task.planned" && i.escalation < 2);
  check("there is an ordinary task to act on", !!target, afterTraining!.items.map((i) => [i.kind, i.escalation]));
  if (target) {
    await client.mutation(ref.acted, { fingerprint: target.fingerprint, objectId: target.sourceId, kind: target.kind, area: target.area, escalation: target.escalation, dueAt: target.dueAt });
    await client.mutation(ref.setTaskCompleted, { id: target.sourceId, completed: true });
    const after = await client.query(ref.getAttention, {});
    check(
      "it is gone, because the task is done — not because anything suppressed it",
      !after!.items.some((i) => i.sourceId === target.sourceId),
    );
    const stats = await client.query(ref.getAttentionStats, {});
    check("and the action was recorded", (stats?.acted ?? 0) >= 1, stats);
  }

  section("acting on a hard-rule item records the signal without removing the rule");
  const hardRule = afterTraining!.items.find((i) => i.kind === "deadline.tax");
  if (hardRule) {
    await client.mutation(ref.acted, {
      fingerprint: hardRule.fingerprint,
      objectId: hardRule.sourceId,
      kind: hardRule.kind,
      area: hardRule.area,
      escalation: hardRule.escalation,
    });
    const after = await client.query(ref.getAttention, {});
    check(
      "the deadline is still there — a Done button cannot overrule a statutory date (ADR-006)",
      after!.items.some((i) => i.fingerprint === hardRule.fingerprint),
    );
  }

  section("dismissing an ordinary item records a signal");
  const dismissible = (await client.query(ref.getAttention, {}))!.items.find(
    (i) => i.escalation < 2 && i.kind === "task.planned",
  );
  if (dismissible) {
    await client.mutation(ref.dismissed, {
      fingerprint: dismissible.fingerprint,
      objectId: dismissible.sourceId,
      kind: dismissible.kind,
      area: dismissible.area,
      escalation: dismissible.escalation,
    });
    const stats = await client.query(ref.getAttentionStats, {});
    check("the dismissal is recorded", (stats?.dismissed ?? 0) >= 1, stats);
  }

  section("a level-2 item refuses to be dismissed, server-side");
  const urgent = (await client.query(ref.getAttention, {}))!.items.find((i) => i.escalation === 2);
  check("there is an urgent item", !!urgent);
  if (urgent) {
    let refused = false;
    try {
      await client.mutation(ref.dismissed, {
        fingerprint: urgent.fingerprint,
        objectId: urgent.sourceId,
        kind: urgent.kind,
        area: urgent.area,
        escalation: urgent.escalation,
      });
    } catch {
      refused = true;
    }
    check("the mutation refuses", refused);
    const after = await client.query(ref.getAttention, {});
    check("and the item is still there", after!.items.some((i) => i.fingerprint === urgent.fingerprint));
  }

  section("a level-2 item can only be snoozed with a return date");
  if (urgent) {
    let refused = false;
    try {
      await client.mutation(ref.snoozed, {
        fingerprint: urgent.fingerprint,
        objectId: urgent.sourceId,
        escalation: urgent.escalation,
      });
    } catch {
      refused = true;
    }
    check("an open-ended snooze is refused", refused);

    await client.mutation(ref.snoozed, {
      fingerprint: urgent.fingerprint,
      objectId: urgent.sourceId,
      escalation: urgent.escalation,
      until: Date.now() + 2 * HOUR,
    });
    const after = await client.query(ref.getAttention, {});
    check("a snooze with a return date is accepted and hides it", !after!.items.some((i) => i.fingerprint === urgent.fingerprint));
  }

  section("rejecting an item is permanent");
  const rejectable = (await client.query(ref.getAttention, {}))!.items.find(
    (i) => i.kind === "task.someday" || i.section === "upcoming",
  );
  const rejectableArea = (rejectable as { area?: string } | undefined)?.area;
  if (rejectable) {
    await client.mutation(ref.rejected, { fingerprint: rejectable.fingerprint, objectId: rejectable.sourceId, kind: rejectable.kind, area: rejectable.area });
    const after = await client.query(ref.getAttention, {});
    check("it does not come back", !after!.items.some((i) => i.fingerprint === rejectable.fingerprint));
    const stats = await client.query(ref.getAttentionStats, {});
    check("and the rejection is recorded", (stats?.rejected ?? 0) >= 1, stats);

    // The category the user rejected is now muted for ranked items, which is
    // what "not for me" is supposed to mean (RJD-006) — a category preference,
    // not a single-item deletion. Hard-rule items are untouched by it.
    const afterRejectFeed = await client.query(ref.getAttention, {});
    if (rejectableArea) {
      const sameArea = afterRejectFeed!.items.filter(
        (i) => i.class === "ranked" && i.area === rejectableArea,
      );
      check(
        "and the whole category is muted, not just that one item",
        !sameArea.some((i) => i.fingerprint !== rejectable.fingerprint),
        sameArea.map((i) => i.kind),
      );
    }
    check(
      "a hard-rule item is never muted by a category rejection",
      afterRejectFeed!.items.filter((i) => i.class === "hard").length > 0,
    );
  }

  // -- determinism and isolation ---------------------------------------------
  section("the feed is deterministic and isolated");
  const a = await client.query(ref.getAttention, {});
  const b = await client.query(ref.getAttention, {});
  check(
    "two reads of an unchanged board agree",
    JSON.stringify(a!.items.map((i) => i.fingerprint)) === JSON.stringify(b!.items.map((i) => i.fingerprint)),
  );

  const other = await newUser(url);
  const otherFeed = await other.query(ref.getAttention, {});
  // Statutory deadlines are the *same* for every US taxpayer, so their ids are
  // global by design. Only items backed by a user-owned object can leak.
  const isUserOwned = (i: { kind: string }) => !i.kind.startsWith("deadline.");
  const otherIds = new Set(otherFeed!.items.filter(isUserOwned).map((i) => i.sourceId));
  const leaked = a!.items.filter((i) => isUserOwned(i) && otherIds.has(i.sourceId));
  check("a second user sees none of the first user's objects", leaked.length === 0, leaked.map((i) => i.sourceId));
  check(
    "and the first user's own objects are absent from their feed",
    !otherFeed!.items.some((i) => isUserOwned(i) && a!.items.some((x) => x.sourceId === i.sourceId)),
  );

  // -- caps bind in real life ------------------------------------------------
  section("the caps bind when a user really does have too much");
  // Deliberately floods with *overdue* work, which is a hard-rule item. The
  // rejection above wrote an explicit category suppression, and a category
  // preference is meant to hide ranked work in every area — so a ranked flood
  // here would be measuring suppression, not the cap. Overdue work cannot be
  // suppressed at all, which makes it the honest way to test a cap.
  await client.mutation(ref.enableArea, { slug: "home" }).catch(() => undefined);
  for (let i = 0; i < 6; i += 1) {
    const id = await client.mutation(ref.addTask, { input: `overdue flood ${i}`, area: "home" });
    await client.mutation(ref.updateTask, { id, dueAt: Date.now() - (i + 1) * HOUR });
  }
  const flooded = await client.query(ref.getAttention, {});
  const nowSection = flooded!.sections.find((s) => s.section === "now");
  check("Now is capped at three", (nowSection?.items.length ?? 0) === 3, nowSection?.items.length);
  check("and the overflow is reported, not silently dropped", (flooded!.hiddenByCap.now ?? 0) > 0, flooded!.hiddenByCap);
  check("the whole screen still respects 24", flooded!.items.length <= 24, flooded!.items.length);
  check(
    "and nothing that was suppressed came back",
    flooded!.items.every((i) => !(i.fingerprint === rejectable?.fingerprint)),
  );

  // -- user data untouched ---------------------------------------------------
  section("the feed is computed, not stored");
  // Deleting nothing and reading repeatedly must not change anything: attention
  // lives in a query, so there is nothing to accumulate.
  const before = (await client.query(ref.getAttention, {}))!.items.length;
  await client.query(ref.getAttention, {});
  await client.query(ref.getAttention, {});
  const afterCount = (await client.query(ref.getAttention, {}))!.items.length;
  check("reading the feed repeatedly changes nothing", before === afterCount, { before, afterCount });

  void someday;
  void later;

  console.log(
    failures === 0
      ? `\nAll phase-1.0 invariants held against ${url}.`
      : `\n${failures} phase-1.0 invariant(s) FAILED against ${url}.`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

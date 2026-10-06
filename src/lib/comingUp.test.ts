import assert from "node:assert/strict";
import { test } from "node:test";

import { COMING_UP_DAYS, COMING_UP_MAX, selectComingUp } from "./comingUp";

// A fixed Tuesday so day-boundary assertions are stable whenever this runs.
// 2026-10-06 is a Tuesday; 09:00 local.
const NOW = new Date(2026, 9, 6, 9, 0, 0);
// Arithmetic happens in milliseconds, never on the Date itself: `NOW + HOUR`
// is string concatenation in JavaScript, and the fixture that did it produced
// a due "date" that compared lexicographically — silently outside every window.
const NOW_MS = NOW.getTime();
const HOUR = 3_600_000;
const DAY = 86_400_000;

function task(over: Partial<{ id: string; title: string; dueAt: number | null; completed: boolean }> = {}) {
  return {
    id: over.id ?? "t1",
    title: over.title ?? "Thing",
    dueAt: over.dueAt ?? null,
    completed: over.completed ?? false,
  };
}

function startOfNow(): number {
  const s = new Date(NOW);
  s.setHours(0, 0, 0, 0);
  return s.getTime();
}

test("an empty board produces an empty window, not an error", () => {
  const result = selectComingUp([], NOW);
  assert.deepEqual(result.items, []);
  assert.equal(result.more, 0);
  assert.equal(result.horizonEnd, startOfNow() + COMING_UP_DAYS * DAY);
});

test("undated and completed tasks never appear", () => {
  const result = selectComingUp(
    [
      task({ id: "no-date", dueAt: null }),
      task({ id: "done", dueAt: NOW_MS + 2 * HOUR, completed: true }),
      task({ id: "live", dueAt: NOW_MS + 2 * HOUR }),
    ],
    NOW,
  );
  assert.deepEqual(
    result.items.map((i) => i.id),
    ["live"],
  );
});

test("overdue belongs to Needs you, not to a forward-looking card", () => {
  const oneHourLate = new Date(NOW);
  oneHourLate.setHours(NOW.getHours() - 1);
  const result = selectComingUp(
    [task({ id: "late", dueAt: oneHourLate.getTime() })],
    NOW,
  );
  assert.deepEqual(result.items, []);
  assert.equal(result.more, 0);
});

test("a task due exactly now counts as coming up", () => {
  const result = selectComingUp([task({ id: "now", dueAt: NOW.getTime() })], NOW);
  assert.equal(result.items.length, 1);
});

test("the horizon closes midnight at the end of the seventh day", () => {
  const endOfSeventhDay = startOfNow() + COMING_UP_DAYS * DAY - 1;
  const afterHorizon = startOfNow() + COMING_UP_DAYS * DAY;

  const inside = selectComingUp([task({ id: "in", dueAt: endOfSeventhDay })], NOW);
  assert.equal(inside.items.length, 1);

  const outside = selectComingUp([task({ id: "out", dueAt: afterHorizon })], NOW);
  assert.equal(outside.items.length, 0);

  // Friday evening stays in the window on Tuesday morning — the horizon is a
  // calendar boundary, not now + 168h.
  const fridayEvening = startOfNow() + 5 * DAY + 20 * HOUR;
  assert.equal(selectComingUp([task({ id: "fri", dueAt: fridayEvening })], NOW).items.length, 1);
});

test("rows bucket as today, tomorrow and later against the injected clock", () => {
  const result = selectComingUp(
    [
      task({ id: "a", dueAt: NOW_MS + HOUR }),
      task({ id: "b", dueAt: startOfNow() + DAY + 10 * HOUR }),
      task({ id: "c", dueAt: startOfNow() + 3 * DAY + 10 * HOUR }),
    ],
    NOW,
  );
  assert.deepEqual(
    result.items.map((i) => i.bucket),
    ["today", "tomorrow", "later"],
  );
});

test("rows sort soonest first, regardless of input order", () => {
  const result = selectComingUp(
    [
      task({ id: "third", dueAt: NOW_MS + 3 * DAY }),
      task({ id: "first", dueAt: NOW_MS + HOUR }),
      task({ id: "second", dueAt: NOW_MS + DAY }),
    ],
    NOW,
  );
  assert.deepEqual(
    result.items.map((i) => i.id),
    ["first", "second", "third"],
  );
});

test("the cap is reported as a count, never absorbed", () => {
  const tasks = Array.from({ length: COMING_UP_MAX + 3 }, (_, i) =>
    task({ id: `t${i}`, dueAt: NOW_MS + (i + 1) * HOUR }),
  );
  const result = selectComingUp(tasks, NOW);
  assert.equal(result.items.length, COMING_UP_MAX);
  assert.equal(result.more, 3);
});

test("a short window reports no remainder", () => {
  const result = selectComingUp(
    Array.from({ length: 3 }, (_, i) => task({ id: `t${i}`, dueAt: NOW_MS + (i + 1) * HOUR })),
    NOW,
  );
  assert.equal(result.more, 0);
});

/**
 * Natural-language task parser.
 *
 * Deliberately dependency-free and fully deterministic — no external API, no
 * model. This is rule-based extraction, the same class of technique Todoist
 * uses for its own quick-add: recognise a small vocabulary of temporal and
 * priority cues, consume the tokens they match, and keep the rest as the title.
 *
 * Parsing is token-based rather than regex-over-the-whole-string so that the
 * original casing of the title survives (we only lowercase for matching).
 */

export type Priority = 0 | 1 | 2; // 0 = NOW, 1 = SOON, 2 = LATER

export interface ParsedTask {
  /** Task text with every recognised cue stripped out. */
  title: string;
  /** Epoch ms deadline, or null when nothing temporal was recognised. */
  dueAt: number | null;
  priority: Priority;
  /** Normalised recurrence rule, e.g. "daily" | "weekly" | "monthly". */
  recurrence: string | null;
  /** `#tag` values found in the input. */
  tags: string[];
}

const WEEKDAYS: Record<string, number> = {
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3, weds: 3,
  thursday: 4, thu: 4, thur: 4, thurs: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
};

const MONTHS: Record<string, number> = {
  january: 0, jan: 0, february: 1, feb: 1, march: 2, mar: 2,
  april: 3, apr: 3, may: 4, june: 5, jun: 5, july: 6, jul: 6,
  august: 7, aug: 7, september: 8, sep: 8, sept: 8,
  october: 9, oct: 9, november: 10, nov: 10, december: 11, dec: 11,
};

/** Word → hour-of-day. Tasks default to a deadline, not an appointment. */
const DAY_PARTS: Record<string, number> = {
  morning: 9, noon: 12, midday: 12, afternoon: 14, evening: 18,
  tonight: 20, eod: 17, "end": 17,
};

const URGENT_WORDS = new Set([
  "urgent", "asap", "critical", "immediately", "right", "now", "emergency", "!!!", "!!",
]);
const SOON_WORDS = new Set(["soon", "important", "priority", "this", "week", "urgent-ish"]);
const LATER_WORDS = new Set([
  "someday", "later", "eventually", "whenever", "someday-maybe", "nohurry",
  "noplans", "eventually", "maybe", "when",
]);

interface Token {
  raw: string;
  lower: string;
  used: boolean;
}

function tokenize(input: string): Token[] {
  return input
    .split(/\s+/)
    .filter(Boolean)
    .map((raw) => ({ raw, lower: raw.toLowerCase().replace(/[^\w:/.+#-]/g, ""), used: false }));
}

/** Monday-start day index (0 = Monday) for a JS day (0 = Sunday). */
function toMondayIndex(jsDay: number): number {
  return (jsDay + 6) % 7;
}

function atHour(base: Date, hour: number, minute = 0): number {
  const d = new Date(base);
  d.setHours(hour, minute, 0, 0);
  return d.getTime();
}

function startOfToday(now: Date): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Resolves a bare weekday name to its next occurrence (today counts as "this
 * week" if it hasn't passed yet, otherwise it rolls to the following week).
 */
function nextWeekday(now: Date, target: number): number {
  const d = new Date(now);
  const delta = (target - d.getDay() + 7) % 7;
  d.setDate(d.getDate() + delta);
  return atHour(d, 17);
}

const DAY_MS = 86_400_000;

/**
 * Parses free-form input into a structured task.
 *
 * @param input  Raw text typed by the user.
 * @param now    Injected for testability; defaults to the current time.
 */
export function parseTaskInput(input: string, now: Date = new Date()): ParsedTask {
  const tokens = tokenize(input);
  const tags: string[] = [];
  let dueAt: number | null = null;
  let priority: Priority | null = null;
  let recurrence: string | null = null;
  let hour: number | null = null;
  let minute = 0;
  let dateOnly = false;

  const consume = (i: number, len = 1) => {
    for (let k = 0; k < len; k++) tokens[i + k].used = true;
  };
  const peek = (i: number, len = 1) =>
    tokens.slice(i, i + len).map((t) => t.lower);

  const applyHour = (h: number, m = 0) => {
    hour = h;
    minute = m;
  };

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.used) continue;
    const word = t.lower;

    // --- tags: #work, #errands -------------------------------------------
    // A hash followed by digits is almost always an issue/PR reference
    // (#42, #1234) rather than a tag, so leave those in the title.
    if (word.startsWith("#") && word.length > 1 && !/^#\d+$/.test(word)) {
      tags.push(word.slice(1));
      t.used = true;
      continue;
    }

    // --- interval recurrence: "every 3 days", "every 2 weeks" --------------
    if ((word === "every" || word === "each") && /^\d+$/.test(peek(i + 1)[0] ?? "")) {
      const n = parseInt(peek(i + 1)[0], 10);
      const unit = peek(i + 2)[0] ?? "";
      if (n >= 1 && n <= 365 && unit.startsWith("day")) {
        recurrence = `every:${n}:day`;
        consume(i, 3);
        continue;
      }
      if (n >= 1 && n <= 52 && unit.startsWith("week")) {
        recurrence = `every:${n}:week`;
        consume(i, 3);
        continue;
      }
    }

    // --- recurrence: "every day", "daily", "every monday" -----------------
    if (word === "every" || word === "each") {
      const next = peek(i + 1, 3);
      if (next.includes("day") || next.includes("morning")) {
        recurrence = "daily";
        consume(i, next.includes("morning") ? 3 : 2);
        continue;
      }
      if (next.includes("week")) {
        recurrence = "weekly";
        consume(i, 2);
        continue;
      }
      if (next.includes("month")) {
        recurrence = "monthly";
        consume(i, 2);
        continue;
      }
      if (next.some((n) => n in WEEKDAYS)) {
        recurrence = `weekly:${next.find((n) => n in WEEKDAYS)}`;
        consume(i, 2);
        continue;
      }
    }
    if (word === "daily") { recurrence = "daily"; t.used = true; continue; }
    if (word === "weekly") { recurrence = "weekly"; t.used = true; continue; }
    if (word === "monthly") { recurrence = "monthly"; t.used = true; continue; }

    // --- relative offsets: "in 3 days", "in 2 weeks" ----------------------
    if (word === "in" && /^\d+$/.test(peek(i + 1)[0] ?? "")) {
      const n = parseInt(peek(i + 1)[0], 10);
      const unit = peek(i + 2)[0] ?? "";
      let days = 0;
      if (unit.startsWith("day")) days = n;
      else if (unit.startsWith("week")) days = n * 7;
      else if (unit.startsWith("month")) days = n * 30;
      if (days > 0) {
        const d = new Date(now);
        d.setDate(d.getDate() + days);
        dueAt = atHour(d, hour ?? 17);
        dateOnly = true;
        consume(i, 3);
        continue;
      }
    }

    // --- relative keywords -------------------------------------------------
    if (word === "today") { dueAt = atHour(now, hour ?? 17); dateOnly = true; t.used = true; continue; }
    if (word === "tomorrow" || word === "tmr" || word === "tmrw") {
      const d = new Date(now); d.setDate(d.getDate() + 1);
      dueAt = atHour(d, hour ?? 17); dateOnly = true; t.used = true; continue;
    }
    if (word === "yesterday") { t.used = true; continue; }
    if (word === "tonight") { applyHour(20); dueAt = atHour(now, 20); t.used = true; continue; }

    // "day after tomorrow" — two tokens, handled before single-word checks.
    if (word === "day" && peek(i + 1, 2).join(" ") === "after tomorrow") {
      const d = new Date(now); d.setDate(d.getDate() + 2);
      dueAt = atHour(d, 17); dateOnly = true; consume(i, 3); continue;
    }

    // --- explicit ISO date: 2026-10-03 -------------------------------------
    if (/^\d{4}-\d{2}-\d{2}$/.test(word)) {
      const [y, m, d] = word.split("-").map(Number);
      const date = new Date(y, m - 1, d);
      dueAt = atHour(date, hour ?? 17); dateOnly = true; t.used = true; continue;
    }

    // --- numeric date: 10/3 or 3/10 (US month-first) ------------------------
    if (/^\d{1,2}\/\d{1,2}$/.test(word)) {
      const [a, b] = word.split("/").map(Number);
      const date = new Date(now.getFullYear(), a - 1, b);
      // If the month has already passed, assume next year.
      if (date.getTime() < startOfToday(now)) date.setFullYear(date.getFullYear() + 1);
      dueAt = atHour(date, hour ?? 17); dateOnly = true; t.used = true; continue;
    }

    // --- month + day: "oct 3" / "3 oct" ------------------------------------
    const monthIdx = MONTHS[word];
    if (monthIdx !== undefined) {
      const nextNum = peek(i + 1)[0] ?? "";
      if (/^\d{1,2}$/.test(nextNum)) {
        const date = new Date(now.getFullYear(), monthIdx, parseInt(nextNum, 10));
        if (date.getTime() < startOfToday(now)) date.setFullYear(date.getFullYear() + 1);
        dueAt = atHour(date, hour ?? 17); dateOnly = true; consume(i, 2); continue;
      }
    }
    const maybeMonthIdx = MONTHS[peek(i + 1)[0] ?? ""];
    if (maybeMonthIdx !== undefined && /^\d{1,2}$/.test(word)) {
      const date = new Date(now.getFullYear(), maybeMonthIdx, parseInt(word, 10));
      if (date.getTime() < startOfToday(now)) date.setFullYear(date.getFullYear() + 1);
      dueAt = atHour(date, hour ?? 17); dateOnly = true; consume(i, 2); continue;
    }

    // --- "next friday" / "this friday" -------------------------------------
    const nextWords = peek(i, 2);
    if (nextWords[1] && nextWords[1] in WEEKDAYS && (word === "next" || word === "this")) {
      const target = WEEKDAYS[nextWords[1]];
      const d = new Date(now);
      let delta = (target - d.getDay() + 7) % 7;
      if (word === "next" && delta === 0) delta = 7;
      if (word === "next") delta += delta === 7 ? 0 : 7;
      d.setDate(d.getDate() + delta);
      dueAt = atHour(d, hour ?? 17); dateOnly = true; consume(i, 2); continue;
    }

    // --- bare weekday ------------------------------------------------------
    if (word in WEEKDAYS) {
      dueAt = nextWeekday(now, WEEKDAYS[word]);
      dateOnly = true; t.used = true; continue;
    }

    // --- times: "3pm", "3:30pm", "at 9", "9-5" -----------------------------
    const meridiem = /am|pm/.test(word) ? (word.match(/am|pm/)![0] as "am" | "pm") : null;
    if (/^\d{1,2}(:\d{2})?(am|pm)?$/.test(word) && (meridiem || word.includes(":"))) {
      const [hRaw, mRaw] = word.replace(/(am|pm)$/, "").split(":");
      let h = parseInt(hRaw, 10);
      if (meridiem === "pm" && h < 12) h += 12;
      if (meridiem === "am" && h === 12) h = 0;
      applyHour(h, mRaw ? parseInt(mRaw, 10) : 0);
      t.used = true;
      if (dueAt !== null) dueAt = atHour(new Date(dueAt), h, mRaw ? parseInt(mRaw, 10) : 0);
      continue;
    }
    if (word === "at" && /^\d{1,2}$/.test(peek(i + 1)[0] ?? "")) {
      const h = parseInt(peek(i + 1)[0], 10);
      applyHour(h >= 0 && h <= 23 ? h : 9);
      consume(i, 2);
      continue;
    }
    if (word in DAY_PARTS && !(word === "end" && peek(i + 1)[0] !== "of")) {
      const h = DAY_PARTS[word];
      applyHour(h);
      t.used = true;
      if (dueAt !== null) dueAt = atHour(new Date(dueAt), h);
      continue;
    }
    // "end of day" as a phrase
    if (word === "end" && peek(i + 1, 2).join(" ") === "of day") {
      applyHour(17); consume(i, 3);
      if (dueAt !== null) dueAt = atHour(new Date(dueAt), 17);
      continue;
    }

    // --- priority cues -----------------------------------------------------
    if (URGENT_WORDS.has(word)) { priority = 0; t.used = true; continue; }
    if (word === "no" && peek(i + 1)[0] === "rush") { priority = 2; consume(i, 2); continue; }
    if (LATER_WORDS.has(word) && !(word === "this" && peek(i + 1)[0] === "week")) {
      priority = 2; t.used = true; continue;
    }
    if (word === "this" && peek(i + 1)[0] === "week") { priority = 1; consume(i, 2); continue; }
    if (SOON_WORDS.has(word) && word !== "this" && word !== "week") { priority = 1; t.used = true; continue; }
  }

  // Fall back the time-of-day on any date we resolved without an explicit one.
  if (dueAt !== null && hour !== null) dueAt = atHour(new Date(dueAt), hour, minute);
  else if (dueAt !== null && dateOnly) dueAt = atHour(new Date(dueAt), 17);

  // Drop a dangling connective left behind when "at" was consumed for a time
  // ("review PR at 4pm" -> "review PR at").
  const strayConnective = /\s+(at|on|in|by|due|re)$/i;

  const title = tokens
    .filter((t) => !t.used)
    .map((t) => t.raw)
    .join(" ")
    .replace(/\s+([,.;:!?])/g, "$1")   // tidy punctuation left behind
    .replace(/[\s,;:]+$/, "")
    .replace(strayConnective, "")
    .replace(/\s+/g, " ")
    .trim();

  // Default priority from due date when the user gave no explicit cue.
  let finalPriority: Priority = priority ?? (dueAt === null ? 2 : dueAt < now.getTime() ? 0 : 1);

  if (recurrence?.startsWith("weekly:")) {
    // Nudge recurring chores to SOON rather than NOW.
    if (finalPriority === 0 && priority === null) finalPriority = 1;
  }

  return {
    title: title || input.trim(),
    dueAt,
    priority: finalPriority,
    recurrence,
    tags,
  };
}

/** Advances a due date by one step for a recurrence rule. */
export function nextOccurrence(dueAt: number, recurrence: string): number {
  const d = new Date(dueAt);

  // Interval form: "every:3:day" / "every:2:week"
  const interval = /^every:(\d+):(day|week)$/.exec(recurrence);
  if (interval) {
    const n = parseInt(interval[1], 10);
    if (interval[2] === "day") d.setDate(d.getDate() + n);
    else d.setDate(d.getDate() + n * 7);
    return d.getTime();
  }

  switch (recurrence) {
    case "daily":
      d.setDate(d.getDate() + 1);
      return d.getTime();
    case "weekly":
      d.setDate(d.getDate() + 7);
      return d.getTime();
    case "monthly":
      d.setMonth(d.getMonth() + 1);
      return d.getTime();
    default:
      if (recurrence.startsWith("weekly:")) {
        d.setDate(d.getDate() + 7);
        return d.getTime();
      }
      return dueAt;
  }
}

/** Human-readable label for a parsed due date, used in the capture preview. */
export function describeDue(dueAt: number | null, now: Date = new Date()): string | null {
  if (dueAt === null) return null;
  const today = startOfToday(now);
  const target = new Date(dueAt);
  const targetStart = new Date(target).setHours(0, 0, 0, 0);
  const days = Math.round((targetStart - today) / DAY_MS);

  if (days === 0) return `TODAY ${target.getHours()}:${String(target.getMinutes()).padStart(2, "0")}`;
  if (days === 1) return `TOMORROW ${target.getHours()}:${String(target.getMinutes()).padStart(2, "0")}`;
  if (days === -1) return "YESTERDAY";
  if (days < 0) return `${Math.abs(days)}D LATE`;
  if (days < 7) return `${target.toLocaleDateString("en-US", { weekday: "short" }).toUpperCase()} ${target.getHours()}:${String(target.getMinutes()).padStart(2, "0")}`;
  return target.toLocaleDateString("en-US", { month: "short", day: "numeric" }).toUpperCase();
}
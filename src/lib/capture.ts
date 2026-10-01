/**
 * Multi-object capture — segmentation (phase 3, feature 2).
 *
 * The parser in `nlp.ts` already answers "what is a task" with a closed,
 * tested vocabulary. This module answers the only genuinely new question:
 * **"did the user mean one thing, or several?"** It splits, and nothing else.
 *
 * ## The one decision this file exists to enforce
 *
 * **Only explicit structure separates objects. A bare "and" never does.**
 *
 * "Call the dentist and book the dentist" is one task. "Buy milk and eggs" is
 * one task. "Pick up bread and jam from the shop" is one task. Splitting those
 * would silently destroy a correct task and invent a second one, and the user
 * would not be told, because from their point of view the capture succeeded.
 *
 * This is not timidity. Mature products reach the same place by a different
 * route: Todoist separates date, label, priority, reminder and project with
 * explicit symbols (`%label`, `p1`, `!14:00`, `#Project`) and has multi-task
 * capture through *text/image/document* input, not through prose splitting.
 * Multi-intent detection is an open research problem, and a word list is the
 * least reliable version of it available. The asymmetry decides it: failing to
 * split costs a user three lines of typing, and splitting wrongly costs them
 * data they did not know they had lost.
 *
 * ## What this file does not do
 *
 * It does not create, merge, resolve, or authorise anything. It calls no
 * mutation, reads no clock unless handed one, and returns plain data. People
 * are still matched through `resolvedIdentityKeys` and still obey ADR-024: no
 * merge, ever, and no person is created from a capture at all.
 *
 * Pure and dependency-free, like every other module in `src/lib` (ADR-002).
 */

import { parseTaskInput, type ParsedTask } from "./nlp";

/** Longest capture accepted. A mutation writes every segment of it. */
export const MAX_CAPTURE_LENGTH = 400;

/**
 * Segments per capture.
 *
 * Bounded because the capture creates one row per segment. The cap is
 * generous for a list a person would actually type, and the excess is
 * **reported** rather than silently dropped — a count the user can see is
 * honest; a count they cannot is not.
 */
export const MAX_SEGMENTS = 12;

/**
 * How sure we are that a segment was meant to be its own object.
 *
 * Deliberately about *segmentation*, not comprehension. The parser's closed
 * vocabulary already decides what a task is; this only measures whether the
 * boundary was stated or inferred.
 */
export type SegmentConfidence = "high" | "medium" | "low";

export interface CaptureSegment {
  /** The segment's own text, before parsing. */
  text: string;
  /** The parse of that text alone, using the same parser a single task uses. */
  parsed: ParsedTask;
  confidence: SegmentConfidence;
  /** One short line a person can read and judge for themselves. */
  reason: string;
  /**
   * A person the user named at the *start* of this segment, if any.
   *
   * Detection is deliberately narrow: the segment must open with a name the
   * caller already knows, and there must be something left to do. "Email Raj
   * about the invoice" links to Raj; "the Raj invoice" does not, because the
   * name is a modifier there, not the subject. Never inferred from a name
   * appearing anywhere in the segment.
   */
  leadingPerson: { id: string; name: string } | null;
}

export interface DroppedSegment {
  text: string;
  reason: string;
}

export interface CapturePlan {
  segments: CaptureSegment[];
  /** Segments that were recognised but not used, with the reason for each. */
  dropped: DroppedSegment[];
  /**
   * How many segments the cap did not take, or 0. Non-zero means the user's
   * input was longer than MAX_SEGMENTS; the UI must say so rather than let the
   * capture look complete.
   */
  overflow: number;
  /**
   * True when the whole capture was refused and **nothing should be created**.
   *
   * This happens when there is no usable segment at all — empty input, or input
   * that is entirely separators. It is the "low confidence must not silently
   * create damaging structured data" rule: no object, and a reason.
   */
  refused: boolean;
  refusalReason: string | null;
}

/** Someone Panel can recognise, used only to detect a leading name. */
export interface KnownPerson {
  id: string;
  name: string;
}

/**
 * The separators, as one pattern.
 *
 * Newline and semicolon are unambiguous: no English task title contains a bare
 * semicolon as part of its meaning. `" and then "` is a phrase, not a
 * conjunction — "and" is a conjunction, and treating it as a separator is the
 * bug this file exists to prevent. The surrounding whitespace is required, so
 * "Andrew" is not split into "And" + "rew".
 *
 * A tab is *not* in this pattern, deliberately: it is whitespace, and a task
 * title may contain one. Only a line break asserts a boundary.
 */
/** Longest segment worth creating. Shorter than this is punctuation, not a task. */
const MIN_SEGMENT_LENGTH = 3;

/**
 * The separators, as one pattern, with the boundaries captured so a single pass
 * can attribute each one.
 *
 * Kept as a named constant rather than an inline literal in `labelSegments` so
 * the rule is stated once, where the reasoning for it lives.
 */
const SEPARATOR_PATTERN = /(\r\n|\r|\n|;|\s+and\s+then\s+)/i;

/**
 * Splits one capture into segments, parsing each independently.
 *
 * The clock is injected for the same reason `parseTaskInput` takes one: a
 * fixture that recomputed `Date.now()` would produce a genuinely different
 * result each run, and a test that passes only on the day it was written is not
 * a test (ADR-002).
 */
export function planCapture(
  input: string,
  knownPeople: readonly KnownPerson[] = [],
  now: Date = new Date(),
): CapturePlan {
  const raw = input.trim();

  if (!raw) {
    return {
      segments: [],
      dropped: [],
      overflow: 0,
      refused: true,
      refusalReason: "Nothing to capture",
    };
  }

  const truncated = raw.slice(0, MAX_CAPTURE_LENGTH);
  const lengthWasCapped = truncated.length < raw.length;

  // --- split on explicit structure only ----------------------------------
  const labelled = labelSegments(truncated);
  // Confidence is about whether segmentation was *stated* at all. In a capture
  // where the user typed a separator, every segment was stated — including the
  // trailing one, which the separator in front of it already committed to.
  // Only a capture with no separator anywhere is a guess, and it gets the
  // lower level so the UI can say so.
  const stated = labelled.some((p) => p.label !== WHOLE_CAPTURE);

  // --- parse each segment, and decide whether to keep it ------------------
  const segments: CaptureSegment[] = [];
  const dropped: DroppedSegment[] = [];
  let overflow = 0;

  for (const { text, label } of labelled) {
    if (text.length < MIN_SEGMENT_LENGTH) {
      dropped.push({
        text,
        reason: `Only ${text.length} character${text.length === 1 ? "" : "s"} — too short to be a task`,
      });
      continue;
    }

    const parsed = parseTaskInput(text, now);
    // A segment that is *entirely* a temporal cue ("tomorrow", "next week",
    // "every friday") leaves no action text: the parser consumes every token
    // and falls back to the input as the title. The tell is that the parse
    // produced a date or a recurrence *and* the title came back unchanged —
    // "call the dentist" also has an unchanged title, but produces no date, so
    // the two are distinguishable without duplicating the parser's vocabulary.
    //
    // Creating a task called "tomorrow" is noise, so such a segment is dropped
    // and reported. A single bare priority word is deliberately *not* dropped:
    // it is odd, but it is not damaging, and the rule must not be broader than
    // the thing it is for.
    if (parsed.title.trim() === text && (parsed.dueAt !== null || parsed.recurrence !== null)) {
      dropped.push({
        text,
        reason: "Nothing left to do after reading the date and recurrence cues",
      });
      continue;
    }

    if (segments.length >= MAX_SEGMENTS) {
      overflow += 1;
      continue;
    }

    segments.push({
      text,
      parsed,
      confidence: stated ? "high" : "medium",
      reason: stated ? `Separated by a ${label === WHOLE_CAPTURE ? "separator" : label}` : REASON_UNSTATED,
      leadingPerson: matchLeadingPerson(text, knownPeople),
    });
  }

  if (lengthWasCapped && overflow === 0) {
    // The text was cut mid-segment. Say so, rather than letting a silently
    // truncated capture look like a complete one.
    overflow = 1;
  }

  if (segments.length === 0) {
    return {
      segments: [],
      dropped,
      overflow: 0,
      refused: true,
      refusalReason:
        dropped.length > 0
          ? "Nothing in that was a task — it was separators and dates with nothing to do"
          : "Nothing to capture",
    };
  }

  return { segments, dropped, overflow, refused: false, refusalReason: null };
}

/** The label a piece carries when no separator ever split it off. */
const WHOLE_CAPTURE = "the whole capture";

const REASON_UNSTATED =
  "No separator found, so this is one task — type a new line or a semicolon to capture several";

/**
 * Splits on any separator, and records which one actually fired.
 *
 * One combined pattern with a capture group, so a single pass attributes each
 * boundary correctly. Doing this as one-rule-at-a-time is the obvious
 * alternative and it is wrong: a first pass on newlines labels its output as
 * "newline", and a later pass then refuses to re-split that output — so
 * `"a\nb; c"` would keep its semicolon inside the second segment. The first
 * implementation had exactly that bug, and the fixture that caught it is the
 * reason this comment exists.
 */
function labelSegments(input: string): { text: string; label: string }[] {
  const pieces: { text: string; label: string }[] = [];

  for (const part of input.split(SEPARATOR_PATTERN)) {
    if (part === "") continue;

    const label = labelForSeparator(part);
    if (label !== null) {
      // A separator closes the piece before it, which is what named it.
      if (pieces.length > 0) pieces[pieces.length - 1].label = label;
      continue;
    }

    const text = part.trim();
    if (text) pieces.push({ text, label: WHOLE_CAPTURE });
  }

  return pieces;
}

/** The rule a separator string belongs to, or null if it is content. */
function labelForSeparator(part: string): string | null {
  if (part === "\r\n" || part === "\r" || part === "\n") return "line break";
  if (part === ";") return "semicolon";
  if (/^\s+and\s+then\s+$/i.test(part)) return '"and then"';
  return null;
}

/**
 * The person a segment is *about*, when the segment opens with their name.
 *
 * Longest name first, so "Raj Patel" is not shadowed by "Raj". The remainder
 * must be non-empty, because "Raj" alone is a person, not something to do.
 *
 * Matching is against a list the caller already owns and has already read, so
 * this function cannot surface anyone the user could not already see. It never
 * merges and never creates — ADR-024.
 */
function matchLeadingPerson(
  text: string,
  knownPeople: readonly KnownPerson[],
): { id: string; name: string } | null {
  if (knownPeople.length === 0) return null;

  const lower = text.toLowerCase();
  const candidates = [...knownPeople].sort((a, b) => b.name.length - a.name.length);

  for (const person of candidates) {
    const name = person.name.trim();
    const nameLower = name.toLowerCase();
    if (!nameLower) continue;
    if (!lower.startsWith(nameLower)) continue;

    // Check the character immediately after the name, *before* trimming. This
    // is what stops "Raja" from matching "Raj": the next character is "a",
    // not a boundary. Trimming first would delete the very space the test
    // depends on, and the first implementation did exactly that — the
    // "Raj Patel call the dentist" fixture is what caught it.
    const after = text[name.length];
    if (after === undefined) continue; // the segment is only the name
    if (!/[\s,.:;!?-]/.test(after)) continue;

    const remainder = text.slice(name.length).trim();
    // The segment must be *about* something. "Raj Patel" alone is the person,
    // and creating an empty task for them would be noise.
    if (remainder.length === 0) continue;

    return { id: person.id, name: person.name };
  }

  return null;
}

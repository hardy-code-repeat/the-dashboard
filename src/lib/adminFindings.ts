/**
 * The recorded security posture, as data (ADR-032, CHANGE-0027).
 *
 * ## Why a registry and not a scan
 *
 * The Admin Control Centre has a security section. The obvious way to build it
 * is to have the backend *detect* things — grep the source for credential
 * patterns, diff the schema, judge whether a session was revoked. Every one of
 * those is a fabrication waiting to happen, and this project has a recorded
 * habit of green checks that mean nothing (D60).
 *
 * So this is a **registry**: a checked-in list of findings that have actually
 * been established, each with the id it was recorded under, who owns it, and
 * what state it is in. It is a *view of the changelog*, not a second source of
 * truth, and `scripts/spec-drift.ts` cross-checks every id here against
 * `spec/02_CHANGELOG.md`. An entry naming a finding the changelog does not
 * contain fails the gate, and a recorded finding quietly dropped from this list
 * is a diff a reviewer sees rather than an omission nobody notices.
 *
 * ## The states, and why there are three
 *
 * `open-human` and `open-accepted` are the same severity question with different
 * answers about *who acts*. `verified` is not "we believe it is fine" — it is
 * "a harness or a fixture asserted it, and the assertion is named".
 *
 * Note what is **not** a state: `resolved`. A finding that has been fixed is
 * deleted from this registry rather than marked, because a permanent "resolved"
 * column is a list that only grows and a status nobody has to maintain. D51,
 * D52, D53 and D58 are all fixed and all absent here; the changelog keeps the
 * history, and the gate is what stops absence from becoming invisibility.
 */

import { describeAdminDenial, type AdminRefusal } from "./adminAccess";

/** Configuration state. The closed vocabulary, shared with the Convex module. */
export const CONFIG_STATES = ["configured", "missing", "requires-rotation", "not-observable"] as const;
export type ConfigState = (typeof CONFIG_STATES)[number];

/** What a finding is waiting on. */
export const FINDING_OWNERS = ["owner", "agent", "none"] as const;
export type FindingOwner = (typeof FINDING_OWNERS)[number];

export interface RecordedFinding {
  /** The id it was recorded under, e.g. `D54`. Cross-checked against the changelog. */
  readonly id: string;
  readonly title: string;
  /**
   * Why it is still open, in one sentence.
   *
   * This is the most-read text in the whole payload, and a finding whose only
   * description is its title tells an operator nothing they can act on.
   */
  readonly detail: string;
  /** Who has to act. `agent` means it is within the agent's remit to resolve. */
  readonly owner: FindingOwner;
  /** Whether the fix is a human decision, an accepted trade, or already asserted. */
  readonly state: "open-human" | "open-accepted" | "verified";
  /** The evidence, when there is any. Names the assertion rather than asserting. */
  readonly evidence?: string;
}

/**
 * Findings that are open right now.
 *
 * Every entry here is a finding recorded in `spec/02_CHANGELOG.md` under this
 * id, and the drift gate asserts that correspondence — an entry that was never
 * recorded fails the build.
 */
export const OPEN_FINDINGS: readonly RecordedFinding[] = [
  {
    id: "D54",
    title: "A live email-relay credential committed to source",
    detail:
      "The relay key is a literal in the source tree. Panel cannot rotate it: the owner must invalidate it at the provider and supply a replacement through the project's keys UI. Until that happens the key is both valid and public.",
    owner: "owner",
    state: "open-human",
    evidence: "conformance-sec.ts S11 reports this red on purpose, as a canary",
  },
  {
    id: "D56",
    title: "No account deletion semantics",
    detail:
      "What deleting an account must do to shared-space rows, the audit log, and per-user model state is a product decision rather than an implementation detail. Export shipped without it; deletion has not been designed.",
    owner: "owner",
    state: "open-human",
  },
  {
    id: "D59",
    title: "Sign-out does not revoke an already-issued token",
    detail:
      "Convex Auth issues self-contained JWTs, so a token stays valid until it expires — a 3600s replay window after sign-out. The mitigation is the per-call session check. Deliberately not 'fixed' by editing auth.ts, which is read-only.",
    owner: "agent",
    state: "open-accepted",
    evidence: "conformance-auth.ts A4 measures the window rather than asserting revocation",
  },
  {
    id: "D61",
    title: "The dashboard task cap is a product decision",
    detail:
      "Above 200 open tasks, 'what should I do next' is answered from the most recent 200 rather than from all of them. That trade belongs to the user, not to the engineering.",
    owner: "owner",
    state: "open-human",
  },
  {
    id: "D62",
    title: "Balances are derived by reading a capped row window",
    detail:
      "A deployment with more than 5000 transactions per currency reports a provisional balance. The fix is a maintained rollup or a balance column — a schema decision and a ledger question, not a larger constant.",
    owner: "agent",
    state: "open-accepted",
    evidence: "listBalances and getAccountBalance return provisional: true rather than a wrong number",
  },
  {
    id: "D63",
    title: "One read left unbounded on purpose",
    detail:
      "integrations.loadStored reads every expense and calendar event in a space to build its upsert lookup. Capping it would make the diff engine treat existing events as new and write duplicates into a financial ledger — a worse failure than a slow query.",
    owner: "agent",
    state: "open-accepted",
    evidence: "KNOWN_UNBOUNDED_READS, with the audit failing if the read is fixed and the entry is not deleted",
  },
  {
    id: "D64",
    title: "The admin role is granted out of band, by the deployment owner",
    detail:
      "No code path in Panel can write users.role, by design (ADR-032). Until the owner sets it through Convex's own data tooling, the Control Centre refuses every request — including the operator's own.",
    owner: "owner",
    state: "open-human",
  },
];

/**
 * Things that are neither defects nor passes.
 *
 * Separate from {@link OPEN_FINDINGS} because conflating them is how a status
 * page starts lying: a verification gap is not a security finding, and putting
 * "cron firing is unverified" next to "a live credential in source" invites a
 * reader to treat them as the same kind of bad.
 */
export const VERIFICATION_GAPS: readonly RecordedFinding[] = [
  {
    id: "cron-firing",
    title: "The 07:00 schedule is declared; its firing is unverified",
    detail:
      "convex.config.ts declares agents/daily at 0 7 * * *, and the runner has been exercised live through runMyAgentsNow. A scheduled delivery cannot be observed from inside a request, and the CLI cannot read a schedule back.",
    owner: "agent",
    state: "open-human",
    evidence: "conformance-6f.ts records this as a note, not a pass",
  },
  {
    id: "export-download",
    title: "Export is verified on the backend, not in a browser",
    detail:
      "Every export invariant is asserted against the live deployment. The browser download step — the part a user actually touches — has no automated confirmation.",
    owner: "agent",
    state: "open-human",
    evidence: "conformance-export.ts, 26 live checks",
  },
  {
    id: "D65",
    title: "One conformance harness cannot currently run",
    detail:
      "scripts/conformance-occ.ts needs a fixture module that is deliberately not checked in, because an unauthenticated public mutation in a deployed app is forbidden. It used to exit 2 with an opaque server error on every run, which is indistinguishable from a broken deployment.",
    owner: "agent",
    state: "open-accepted",
    evidence:
      "The harness now separates the absent-module case and exits 0 with RESULT: NOT RUN. The OCC invariant itself is unchanged and still verified as ADR-022 records it.",
  },
  {
    id: "D66",
    title: "A vocabulary member with no producer, and copy describing it",
    detail:
      "AreaDef.kind declares \"custom\" and no area uses it. A custom area cannot be created either — areaSlugValidator is a closed six-value union — yet TasksArea's copy told users a custom area lands there. Copy removed; the dead member is deferred to the Custom Pages decision (ADR-033).",
    owner: "agent",
    state: "open-accepted",
    evidence:
      "src/lib/schema-vocab.test.ts still guards the closed union, so the dead member cannot be reached, only believed in.",
  },
  {
    id: "D67",
    title: "The dashboard's truncation receipt was computed and thrown away",
    detail:
      "getDashboard has always taken cap+1 rows and reported truncated/openTruncated/completedTruncated so that hitting the cap would be observable. Its own doc comment claimed the client showed a cap note. No component read any of them, so above 200 open tasks the four headline tiles reported counts taken from a slice and said nothing.",
    owner: "agent",
    state: "open-accepted",
    evidence:
      "The receipt is now rendered (+ at least on the Open and Overdue tiles, a dashed cap note above the list, a note-cap line). spec-drift gates every receipt a product-called query returns, and conformance-dashboard.ts drives the live board to the exact boundary — mutation-tested: hardcoding openTruncated to false makes it fail. What 200 should be, and whether to page past it, remains D61.",
  },
  {
    id: "D68",
    title: "The landing page claimed the product runs on-device",
    detail:
      "The hero badge read \"Runs on-device. No AI API.\" and the model card read \"Nothing is sent anywhere.\" Parsing, scoring and ranking all run server-side in Convex; the records live on a hosted deployment. The no-LLM half was true and the locality half was not.",
    owner: "agent",
    state: "open-accepted",
    evidence:
      "The badge now reads \"Deterministic. No AI API.\", and both surfaces state plainly that the records live on Panel's server and no model provider receives a task.",
  },
  {
    id: "D69",
    title: "The landing page carried invented customer testimonials",
    detail:
      "A \"What people say\" section presented three quotes with names and job titles for a product that has never shipped. The people, the quotes and the roles were fabricated, which is the same failure the spec is written against: a confident surface standing in for a missing one.",
    owner: "agent",
    state: "open-accepted",
    evidence:
      "Replaced with \"What isn't built yet\" — three checkable statements, each one a recorded finding (D50 health, the absent Home domain model, integrations awaiting user keys). No testimonial is asserted anywhere in the product.",
  },
  {
    id: "D70",
    title: "The Main Panel rendered a confident empty state before its data arrived",
    detail:
      "getDashboard was read as data?.tasks ?? [], so the first paint of the product's primary surface showed \"Nothing here\", \"No notes yet\" and four zeroed tiles during every cold load. CHANGE-0029 fixed exactly this in TasksArea and missed the panel that is the product.",
    owner: "agent",
    state: "open-accepted",
    evidence:
      "The board now renders a status region while the query is undefined. The defect cannot come back silently through a new query because undefined and empty are now different branches at the top of the page.",
  },
  {
    id: "D71",
    title: "The crash screen told users \"Preview runtime error\" and dumped a stack trace",
    detail:
      "The root error boundary — the last thing a person sees when the app breaks — was framed as preview tooling and showed an unframed stack trace. The preview framing is false for anyone using the product, and the trace is for whoever is debugging, not for the user.",
    owner: "agent",
    state: "open-accepted",
    evidence:
      "It now says what happened, suggests a reload, and puts the message and stack behind a \"Technical detail\" disclosure. The boundary still never renders a blank page.",
  },
  {
    id: "D72",
    title: "An in-app link forced a full page reload",
    detail:
      "The dashboard footer's \"Back to home\" was an <a href=\"/\"> rather than a router link, throwing away the router, the Convex client, the auth state and the scroll position to re-fetch a page the browser already had. It looks exactly like a link, which is why it survived review.",
    owner: "agent",
    state: "open-accepted",
    evidence:
      "Converted to react-router's Link, and spec-drift now fails on any anchor whose href is an in-app path. Eight anchor hrefs remain and none of them is one.",
  },
  {
    id: "D61",
    title: "What the dashboard cap should be is an open product decision",
    detail:
      "The board is capped at 200 open and 200 completed. Whether that is the right number, and whether the board should page past it rather than stop, has never been decided — so D67 could only make the truncation visible, not remove it.",
    owner: "owner",
    state: "open-human",
    evidence:
      "conformance-dashboard.ts pins the behaviour of the cap as it exists, at its exact boundary, and explicitly does not settle it.",
  },
  {
    id: "D73",
    title: "Custom Pages persistence shape is undecided and blocks implementation",
    detail:
      "ADR-033 decides that a Custom Page is a saved view through a closed block vocabulary, but whether blocks are embedded in the page row or stored one row per block is a schema decision. It changes the read count of the hot path, so it is the owner's to make.",
    owner: "owner",
    state: "open-human",
    evidence:
      "Recorded as Q-010 with the recommendation (embedded, capped at 12 blocks) and the comparison table in spec/02_CHANGELOG.md. No table, file, dependency or migration exists for it yet.",
  },
  {
    id: "D74",
    title: "Panel holds no health measurements, and whether it should is undecided",
    detail:
      "The Health area is now real recurring obligations (CHANGE-0032 closed D50's mock). The measurement half — weight, blood pressure, sleep scores, medication schedules — is deliberately absent. Those are a different kind of object with no attention budget, and no wearable or health-data service exists in the service catalog to sync them from.",
    owner: "owner",
    state: "open-human",
    evidence:
      "Recorded as Q-011. The area states its own boundary in the interface, and the Health blurb no longer promises sleep or training tracking.",
  },
  {
    id: "no-telemetry",
    title: "No analytics and no request metrics exist",
    detail:
      "Most of the metrics the product context defines are unmeasurable today, and this surface does not invent them. The honest state is that Panel cannot see itself.",
    owner: "owner",
    state: "open-human",
  },
];

/**
 * What this surface deliberately does not collect.
 *
 * Rendered by the Control Centre as its own section, because a console that
 * states what it refuses to show is more trustworthy than one whose omissions
 * have to be discovered by reading its source.
 */
export const NOT_COLLECTED: readonly string[] = [
  "User email addresses, names, images or any account detail. The users table is read by no query here except the authorisation check itself.",
  "Task, note, person, document, commitment or transaction content. Reads produce counts; no row content is returned.",
  "Tokens, refresh tokens, PKCE verifiers, fingerprints or account hints (ADR-014).",
  "Per-user drill-down of any kind. No identifier of any kind appears in any payload from this surface.",
  "Configuration values. Environment variables are reduced to a state before they leave the backend.",
];

/** The whole security payload, in the shape the query returns it. */
export interface SecurityPosture {
  findings: readonly RecordedFinding[];
  verificationGaps: readonly RecordedFinding[];
  notCollected: readonly string[];
}

/**
 * The registry, as a payload.
 *
 * A function rather than a bare constant so the query has something to call and
 * each read gets a fresh object — a module-level constant returned directly
 * would be structurally shared, which is a mutable global reachable from a query
 * result.
 */
export function adminDecisionFor(): SecurityPosture {
  return {
    findings: OPEN_FINDINGS,
    verificationGaps: VERIFICATION_GAPS,
    notCollected: NOT_COLLECTED,
  };
}

/**
 * The sentence shown to a caller who was refused.
 *
 * Kept beside the registry rather than in a component so the Control Centre and
 * the backend agree on the wording, and so the wording is reviewable as part of
 * the security story rather than as a string literal buried in JSX.
 */
export function adminDenialMessage(reason: AdminRefusal): string {
  return describeAdminDenial(reason);
}

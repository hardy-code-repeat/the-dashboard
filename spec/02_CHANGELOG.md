# 02 — CHANGELOG

**Development changelog and architectural decision record for Panel.**

Status: `ACTIVE` · Last updated: 2026-10-01

This file has two jobs:

1. Record every meaningful change, with its reason.
2. Record every architectural decision **once**, permanently, so it is not
   re-litigated without new evidence.

---

## CHANGE-0001

```
Date:       2026-10-01
Phase:      Pre-Phase (baseline establishment)
Type:       architecture
Summary:    Established the spec-driven development system and recorded the
            baseline architecture as it actually exists in the repository.
Why:        The project had a strong architecture review but no durable record
            of it. Decisions were being re-derived from conversation each
            session, which is how architecture silently drifts.
Previous:    Architecture existed only in conversation and in code comments.
New:         Five authoritative specification files under /spec, plus a drift
             detector and a read-only HTML control centre.
Files:       spec/01_MAIN_AGENT.md, spec/02_CHANGELOG.md,
             spec/03_PRODUCT_CONTEXT.md, spec/04_SYSTEM_FUNDAMENTALS.md,
             spec/05_PANEL_CONTROL_CENTER.html, scripts/spec-drift.ts
Schema:      None. No application code, no schema, no dependency was changed.
Tests:       scripts/spec-drift.ts passes. bunx tsc -b --noEmit clean.
Risks:      Specs can drift from code. Mitigated by scripts/spec-drift.ts and
             the MAIN_AGENT §6 drift rule.
Decision:    Markdown is authoritative; the HTML is a view only.
Related ADR: ADR-019
```

---

## CHANGE-0002

```
Date:       2026-10-01
Phase:      Pre-Phase (baseline establishment)
Type:       refactor
Summary:    Recorded eight verified defects (N1–N9) found during the second
            architecture review. No fixes applied — they are scheduled.
Why:        Two are production-breaking and neither is visible by using the app
            normally. They must not be rediscovered late.
Previous:    Undocumented.
New:         Documented under "Known Technical Debt → Immediate", each with
             file references and a scheduled phase.
Schema:      None.
Tests:       None — these are recorded defects awaiting regression tests.
Risks:      Known and scheduled.
Decision:    N1 and N2 are Phase 0A blockers.
Related ADR: ADR-017, ADR-018
```

---

## CHANGE-0003

```
Date:       2026-10-01
Phase:      Pre-Phase (baseline establishment)
Type:       refactor
Summary:    Recorded the validation baseline and disclosed that `bun run lint`
            does not currently pass.
Why:        MAIN_AGENT §8 lists lint as a post-coding gate. A gate that already
            fails on untouched code is not a gate — it is noise that trains
            everyone to ignore it.
Previous:    "Run lint" was specified without anyone having run it.
New:         The real numbers are recorded (12 errors, 19 warnings, all
             pre-existing, zero in spec/ or scripts/). Until a cleanup phase,
             the lint gate is "no NEW problems", not "zero problems".
             scripts/spec-drift.ts also gained an exact CHANGE-id count check.
Files:       spec/02_CHANGELOG.md, spec/04_SYSTEM_FUNDAMENTALS.md,
             spec/05_PANEL_CONTROL_CENTER.html, scripts/spec-drift.ts
Schema:      None.
Tests:       bun scripts/spec-drift.ts → 8 pass, 1 warn, 0 fail.
             bunx tsc -b --noEmit → clean. bun run lint → fails at baseline.
Risks:      A known-failing gate can mask new failures. Mitigated by fixing the
             comparison baseline to "no new problems".
Decision:    Disclose rather than quietly fix or quietly ignore.
Related ADR: ADR-019
```

---

## Architecture Decisions

Permanent IDs. **Do not re-open a decision unless new evidence invalidates it.**
Revisiting is allowed only by adding a new ADR that explicitly supersedes an old
one, with the invalidating evidence recorded.

---

### ADR-001 — No external AI or LLM API

**Decision.** Panel uses no external AI/LLM inference service. All intelligence
is deterministic, in-house TypeScript: a token-based parser (`src/lib/nlp.ts`),
an online logistic-regression ranker (`src/lib/scorer.ts`), and rule engines
(`src/lib/tax.ts`).

**Context.** The value proposition depends on the intelligence being inspectable
and on it costing nothing per user. A hosted model would make every ranked item
an opaque, per-request, network-dependent decision.

**Alternatives considered.**
- Hosted LLM for parsing and ranking — rejected: non-deterministic, unauditable,
  per-user cost, network dependency.
- On-device model (Llama class) — rejected: far beyond the feature space; a
  linear model is the correct model class for 8 well-understood features.
- No learning at all — rejected: the learn-from-your-own-history property is the
  differentiator.

**Why chosen.** Determinism makes the intelligence testable with plain fixtures,
makes every ranking explainable, and removes an entire class of failure.

**Consequences.** Parsing coverage is bounded by a hand-written vocabulary.
Adding a new sentence pattern is a code change, not a prompt change.

**Revisit when.** A use case genuinely cannot be expressed as deterministic rules,
and only after proving no LLM dependency can be avoided.

---

### ADR-002 — Three-layer architecture

**Decision.** `src/lib/*` (pure intelligence) → `src/convex/*` (persistence,
orchestration, learning) → `src/pages` + `src/components` (UI). The dependency
direction never reverses.

**Context.** The existing code already follows this. Preserving it keeps pure
logic testable without a database.

**Alternatives considered.** Collapsing into a single layer — rejected: makes
pure logic untestable in isolation and couples UI to persistence.

**Why chosen.** Testability and a clear place for every responsibility.

**Consequences.** Anything in `src/lib` must be a pure function with an
injectable clock. Anything that writes belongs in `src/convex`.

**Revisit when.** Never without a documented failure of this split.

---

### ADR-003 — Attention is computed, never stored

**Decision.** Attention items are produced by a pure function at query time from
source data. Only user *feedback about* items (seen/dismissed/snoozed/acted/
rejected) is persisted.

**Context.** Two options existed: store attention items, or compute them.

**Alternatives considered.**
- Stored attention items — rejected: every new data source would need a write
  path, a staleness policy and new UI. Computing it means a new source
  contributes automatically.
- Streaming/precomputed attention — rejected: unnecessary at personal scale.

**Why chosen.** It is the mechanism by which "no two Panel dashboards look alike"
costs nothing: different enabled areas and connections simply produce different
computed output.

**Consequences.** Query cost grows with data volume. Requires indexed queries and
per-section budgets (ADR-006).

**Revisit when.** Measured query cost makes on-demand computation untenable.

---

### ADR-004 — No learning from absence

**Decision.** Training happens **only** on explicit user feedback: act, complete,
reject, dismiss. If the user does nothing about an item, no weight is updated.

**Context.** A planner proposed an `attentionImpressions` table to distinguish
"shown and ignored" from "never shown". The deeper question is whether silence
is evidence.

**Alternatives considered.**
- Train on non-action as label 0 — **rejected.** This is the mechanism by which a
  ranking model eats itself: it hides an item, the absence reads as rejection,
  and the item sinks further.
- `attentionImpressions` table — **rejected.** Adds a table, a write per
  dashboard load, and a Convex problem (queries cannot write), to solve a
  question the answer to which is "no".

**Why chosen.** Silence is not a judgement. Only deliberate action is evidence.

**Consequences.** The model learns from a smaller, cleaner signal. Slower, but it
cannot collapse.

**Revisit when.** There is evidence of a *positive* signal in absence, which there
is not.

---

### ADR-005 — Snooze is a timing signal, not negative feedback

**Decision.** Snoozing produces **no** label. It writes `snoozedUntil` and, if the
item is later acted on, contributes positive evidence to the due-bucket timing
feature.

**Context.** Snooze and dismissal feel similar in a UI but mean opposite things.

**Alternatives considered.** Treating snooze as label 0 — **rejected**: it teaches
the model that useful items are irrelevant, which is precisely backwards.

**Why chosen.** "Useful, but not now" and "not relevant" are different claims and
must not share an encoding.

**Consequences.** The timing features (`HOUR_FIT`, `DUE_BUCKET_FIT`) carry the
snooze signal. There is no "irrelevant" learning from snooze at all.

**Revisit when.** Never. This is a semantic invariant.

---

### ADR-006 — Hard attention rules bypass the learned ranker

**Decision.** Hard-rule items (overdue, expiring document, payment due, pinned,
escalated) are produced by a separate pure rule engine, are never passed to the
scorer, are ordered by deterministic severity, and are immune to learned
suppression.

**Context.** A learned ranker trained on past behaviour will, over time,
down-weight categories the user habitually ignores — including a tax deadline
they ignore every year until it bites.

**Alternatives considered.**
- Ordering rule ("hard rules sort above ranked items") — rejected: the item is
  still scored, so a strongly negative weight can still bury it.
- A penalty feature for hard items — rejected: the model can learn to absorb the
  penalty.

**Why chosen.** Structural separation is the only guarantee. If the scorer never
sees the item, personalisation cannot suppress it.

**Consequences.** Two item classes to reason about. The rule engine must be
independently testable.

**Revisit when.** Never without a structural reason.

---

### ADR-007 — Typed entity tables, no generic object table

**Decision.** One Convex table per object kind (`tasks`, `people`, `commitments`,
`documents`, …). No `objects` table with a JSON blob. No EAV.

**Context.** A uniform envelope would allow arbitrary kinds but would destroy
type safety and real indexes.

**Alternatives considered.**
- `objects` table with `kind` + `fields: JSON` — **rejected**: every read becomes
  untyped, no index can reach a field, validation becomes runtime-only.
- EAV (`attributes` / `values`) — **rejected**: same, worse.

**Why chosen.** Convex is a document database; discrete typed tables are its
native idiom and preserve compile-time guarantees.

**Consequences.** A new object kind means a new table — which is precisely why new
tables require approval.

**Revisit when.** Never. This is load-bearing.

---

### ADR-008 — `links` holds relationships only

**Decision.** The `links` table stores a closed vocabulary of edges
(`LinkRel`) with direction, provenance, confidence, visibility and optional
temporal bounds. Core business attributes stay on the entity tables.

**Context.** A generic links table with free-form `meta` degenerates into a
second database.

**Alternatives considered.** Free-form `meta` — **rejected**: it becomes the long-
term data model by accident, and nothing can index it.

**Why chosen.** Promotes a clean rule: if you ever need to *query* by something in
a link, it gets promoted to a typed, indexed column on an entity table.

**Consequences.** `meta` is capped at scalars and excluded from export contract
guarantees.

**Revisit when.** A relation genuinely needs a queryable attribute.

---

### ADR-009 — Ownership is separate from access

**Decision.** Every object carries `ownerUserId` and `spaceId`. Membership is a
many-to-many `spaceMembers` table — **not** an owner column on `spaces`. Sharing is
a `grants` row that never writes `ownerUserId` or `spaceId`.

**Context.** Plan v1 proposed `spaces { userId }`, which hard-codes one space per
user and makes "my family space" and "my accountant" require a rewrite.

**Alternatives considered.**
- `spaces.userId` — **rejected**: assumes one user = one space forever.
- An `objectSpaces` join table — **rejected**: two sources of truth for "where
  does this live".
- Sharing by copying the object — **rejected**: copies diverge, ownership is lost.

**Why chosen.** Answers the required questions directly: ownership never changes on
sharing; a user may own many spaces and belong to many; an object has exactly one
home space and visibility elsewhere is a grant.

**Consequences.** Every read query must resolve access through one helper. Deny by
default.

**Revisit when.** Never without a structural reason.

---

### ADR-010 — Feature layout frozen; weights are versioned

**Decision.** Feature indices 0–7 are frozen. New features append at index 8+.
`assistantState` gains `weightsVersion`; `alignWeights()` pads or truncates on
read. A regression test asserts indices 0–7 are bit-identical.

**Context.** `scorer.ts` currently hard-codes `FEATURE_COUNT = 8` and indexes by
position. Changing the meaning of an existing index silently corrupts every
saved weight vector.

**Alternatives considered.** Free renumbering — **rejected**: silently changes the
meaning of stored weights, with no error and no recovery path.

**Why chosen.** Stored weights outlive the code that wrote them.

**Consequences.** Every feature addition requires a version bump and an
`alignWeights` review.

**Revisit when.** Never — this is the mechanism that makes model change safe.

---

### ADR-011 — Agents are pure functions with three safety tiers

**Decision.** Agents are pure functions returning one of three typed results:
`automatic` (safe internal operations), `proposed` (user accepts), or `confirm`
(money, external communication, sharing, deletion, tax/legal, irreversible).
Agents never mutate user data without acceptance.

**Context.** The brief explicitly warns against a generic agent framework, and
against agents silently doing risky things.

**Alternatives considered.**
- A DAG/trigger framework — **rejected**: becomes a Zapier clone.
- Agents that execute directly — **rejected**: silent risk, no undo.

**Why chosen.** Safety is enforced by the return type, not by convention.

**Consequences.** Every agent needs fixtures. Automatic is deliberately narrow.

**Revisit when.** Never without a concrete product problem the tiers cannot express.

---

### ADR-012 — Integrations normalize through one provider-agnostic path

**Decision.** Every connector implements a `ConnectorAdapter` returning a
`NormalizedBatch`, applied by a single `internalMutation` (`applyBatch`) that is
idempotent on `(provider, externalId)` and diff-then-patches. No connector gets
its own UI or business logic.

**Context.** The brief requires that integrations not each require custom UI and
business logic.

**Alternatives considered.** Per-provider mutations — **rejected**: nine providers
would mean nine write paths, nine sets of bugs.

**Why chosen.** Adding an integration becomes: write an adapter, add a registry
entry.

**Consequences.** The normaliser is a bottleneck by design. It must stay small.

**Revisit when.** A provider's semantics genuinely cannot be normalised.

---

### ADR-013 — Google Calendar is inbound-only, minimum scope, minimised

**Decision.** Calendar sync reads only (`calendar.readonly`). Panel never writes to
Google. Panel persists a whitelisted field set; events Google marks
`visibility: "private"` are stored with the literal title `"Busy"` and the real
title is **never written to the database**.

**Context.** Privacy is a product feature (MAIN_AGENT P6). Storing a private
meeting title and hiding it in the UI would be privacy theatre.

**Alternatives considered.**
- Store and hide — **rejected**: the sensitive value would exist at rest.
- Request broader scopes — **rejected**: minimum scope is a design constraint.

**Why chosen.** The safest data is the data that was never stored.

**Consequences.** Some calendar detail is deliberately unavailable.

**Revisit when.** The user explicitly asks for a feature that needs more.

---

### ADR-014 — Credentials are server-only by construction

**Decision.** Tokens live in `connectionTokens`, reachable **only** from
`internalMutation`/`internalQuery` in a module that exports no public query. No
public query or mutation outside that module may reference the table. Provider
errors map to a fixed set of stable codes; provider response bodies never reach a
user-visible message or a log.

**Context.** Convex's public functions are callable by any authenticated client.
Module-level containment is the actual mechanism; a comment is not.

**Alternatives considered.** Relying on convention — **rejected**: one careless
query is a credential leak.

**Why chosen.** The guarantee is structural and grep-checkable.

**Consequences.** A drift check asserts no public function mentions the table.

**Revisit when.** Never.

---

### ADR-015 — Attention ships in two phases

**Decision.** Phase 1.0 delivers hard rules, sections, budget, decay, grouping and
feedback state **with no learning in the loop at all**. Phase 1.1 adds learned
ranking and the five-signal feedback semantics.

**Context.** The original plan bundled Attention and the learned ranker into one
phase. The feedback semantics — the part most likely to corrupt the model
silently — would then be designed without a real, inspectable item set.

**Alternatives considered.** Single combined phase — **rejected**: hard to
evaluate, and a model bug would be indistinguishable from a rule bug.

**Why chosen.** 1.0 is a complete, useful, fully testable product slice that a
human can evaluate before any model is involved.

**Consequences.** Attention value is delivered earlier; learning arrives later.

**Revisit when.** Never without cause.

---

### ADR-016 — Complexity budget is mandatory

**Decision.** Every phase declares max new files, tables, dependencies,
abstractions, and an explicit must-not-introduce list. Exceeding it is a stop
condition requiring approval.

**Context.** The largest strategic risk to Panel is building infrastructure faster
than users. The plan proposed roughly ten tables and twenty-five files for a
product with no users.

**Alternatives considered.** Soft guidance — **rejected**: it does not stop
anything.

**Why chosen.** A budget that is not enforced is not a budget.

**Consequences.** Some legitimate work will pause for approval. That is intended.

**Revisit when.** The product has real users and the risk profile changes.

---

### ADR-017 — State rows use deterministic ids

**Decision.** Single-row-per-user state (`assistantState`, and future
model/flag rows) is upserted with a **deterministic document id**, not
read-then-insert.

**Context.** `recordOutcome` currently reads, and inserts when absent. Two
concurrent completions can both see "absent" and both insert. `loadState` uses
`.unique()`, which throws on two documents — breaking `getDashboard` and
`getModel` permanently. This is defect **N1**.

**Alternatives considered.**
- Relying on optimistic concurrency — rejected: the two inserts touch different
  new documents, so there is no conflict to detect.
- Catching the `.unique()` error — rejected: hides duplicate state, and the
  learned weights are then ambiguous.

**Why chosen.** Makes the invariant structural rather than timing-dependent.

**Consequences.** Deterministic-id upsert helper needed.

**Revisit when.** Never.

---

### ADR-018 — Guest accounts require a claim path or removal

**Decision.** An anonymous ("guest") account must either have a documented
migration path to a real account, or guest sign-in must be removed.

**Context.** `src/pages/Auth.tsx` offers `signIn("anonymous")` with no claim
flow. A guest who later signs in by email receives a **different user id** and
every task, expense and note is silently orphaned. This is defect **N2** and it
violates MAIN_AGENT E8 (no silent data loss).

**Alternatives considered.** Accepting the loss — **rejected**: silent data loss
is prohibited.

**Why chosen.** Either fix the path or remove the promise.

**Consequences.** Phase 0A must resolve this before any sharing work, because
sharing built on an account model that loses data is indefensible.

**Revisit when.** A claim flow is implemented.

---

### ADR-019 — Spec-driven development; Markdown is authoritative

**Decision.** Five persistent control artefacts under `/spec`. The HTML control
centre is a read-only view. `scripts/spec-drift.ts` mechanically detects drift.
No sixth permanent specification file without approval.

**Context.** Architecture decisions were being re-derived from conversation each
session.

**Alternatives considered.**
- Many small documents — rejected: fragmentation is its own failure mode.
- A wiki/external tool — rejected: not in-repo, not reviewable.
- HTML as the source of truth — rejected: it cannot be diffed meaningfully and
  would diverge.

**Why chosen.** Five files is enough to be authoritative and few enough to stay
accurate.

**Consequences.** The HTML embeds a snapshot; the drift script compares them.

**Revisit when.** Five files demonstrably cannot hold the information.

---

## Rejected Decisions

Do not re-raise these without new evidence that invalidates the original reasoning.

| ID | Decision | Rejected because |
|---|---|---|
| RJD-001 | Generic `objects` table / EAV | Destroys type safety and indexing. See ADR-007. |
| RJD-002 | Generic agent framework (DAG, triggers, marketplace) | Becomes a Zapier clone. See ADR-011. |
| RJD-003 | Push / email / SMS notifications in v1 | Notification permission is the fastest route to being a spam app. Pull-only preserves the attention budget. |
| RJD-004 | Auto-merging people by name match | "Raj" ≠ "Raj". Merge is user-confirmed and reversible. |
| RJD-005 | A settings / configuration screen | The dashboard is computed from enabled areas and connections. Config stays: enable / disable / reorder. |
| RJD-006 | A learned negative *category* feature | Would let personalisation discover "suppress tax" — explicitly forbidden. Category suppression is an explicit user-authored set that hard rules ignore. |
| RJD-007 | Deleting four of five tax countries for depth | Removes working functionality. Chosen instead: modularise into `src/lib/tax/`, keep all five, add a visible depth badge. |
| RJD-008 | `objectSpaces` join table | Two sources of truth for where an object lives. Single home space + grants. |
| RJD-009 | `attentionImpressions` table | Solves a question whose answer is "no". See ADR-004. |
| RJD-010 | Dashboard block/plugin framework | One 757-line file would become a hierarchy of abstractions. Chosen instead: an explicit `switch` over the concrete blocks that exist. |
| RJD-011 | Training on non-action as label 0 | Self-reinforcing collapse. See ADR-004. |

---

## Known Technical Debt

### Immediate — scheduled, blocking later phases

| ID | Issue | Evidence | Scheduled |
|---|---|---|---|
| **N1** | Duplicate `assistantState` row breaks the dashboard permanently. Two concurrent completions both insert; `.unique()` then throws in `getDashboard` and `getModel`. | `src/convex/assistant.ts:373-378`, `:45-48` | Phase 0A (ADR-017) |
| **N2** | Guest accounts have no claim path → silent data loss on account upgrade. | `src/pages/Auth.tsx:83-95` | Phase 0A (ADR-018) |
| **N5** | `rankTasks` returns `score: -Infinity` for completed tasks; that value is returned to the client. `JSON.stringify(-Infinity)` is `null`. **Not verified** whether Convex round-trips it. | `src/lib/scorer.ts:222`, `src/convex/assistant.ts:187` | Phase 0A — verify, replace with a finite sentinel regardless |
| **N7** | No enum validators: `area`, `bucket`, `recurrence`, `provider`, `country`, `status`, `priority` are bare `v.string()` / `v.number()`, with `schemaValidation: false`. | `src/convex/schema.ts` | Phase 0C |
| **N4** | Query idiom is "collect everything, filter in JS": `getAreaTasks` (hot path), `toggleDocument`, `connectTool`, `disconnectTool`, `disableArea`, `getFinance` expense year filter. | `src/convex/life.ts` | Phase 0B |
| **N3** | `previewCapture` is exported but referenced nowhere; its comment claims the contract is single-sourced, which is false. | `src/convex/assistant.ts:78` | Phase 0A — wire or delete |
| **N6** | Three sources of truth: feature names in `explain()` vs `FEATURE_NAMES` in `Dashboard.tsx`; priority semantics differ between schema comment, type, and `PRIORITY` map. | `src/lib/scorer.ts:196`, `src/pages/Dashboard.tsx:722`, `:35`, `src/convex/schema.ts:45` | Phase 0A |
| **N8** | `filingYear` logic duplicated in `getFinance` and `saveTaxProfile`. | `src/convex/life.ts:172`, `:273` | Phase 0A |

### Deferred — real, not urgent

| ID | Issue | Why deferred |
|---|---|---|
| D1 | No `internalMutation` / `internalQuery` / `httpAction` / cron exists anywhere. | Required by Attention (1.1) and agents (Phase 3), not before. |
| D2 | `getDashboard` loads every task ever, unbounded `.collect()`. | Fine at personal scale; fixed with D3 before Phase 1. |
| D3 | `clearCompleted` deletes in a loop, unbounded. | Same. |
| D4 | Health counters are component-local `useState` and reset on reload. | Needs a table; scheduled after 0B supplies `spaceId`. |
| D5 | Recurring tasks parse and display but never respawn. `nextOccurrence` is exported and tested but called by no mutation. | **Phase 0A** — currently a broken promise in the UI. |
| D6 | Area-scoped task creation takes two round-trips (`addTask` then `setTaskArea`); a failure between them orphans the task. | **Phase 0A** — atomicity defect. |
| D7 | `AssistantDoc` uses `any` for `_id` / `userId` — a documented workaround for a `DataModel["table"]` wrapper-type issue. | Revisit during 0B when types change anyway. |
| D8 | `requireUserId` duplicated in `assistant.ts` and `life.ts`. | Phase 0A, trivial. |
| D9 | Stray `}` after the `--sidebar-ring` block in `src/index.css`. Harmless; CSS compiles. | Cosmetic. |
| D10 | No test files exist. The three original harnesses (`parse-check`, `scorer-check`, `tax-check`) passed and were deleted, taking all regression protection with them. | **Phase 0A is the highest priority item.** |
| D11 | `package.json` has no `test` script. | Phase 0A adds one, or documents `bun test` directly. |
| D12 | **`bun run lint` fails at baseline: 12 errors, 19 warnings.** All pre-existing, in `src/hooks/use-mobile.ts`, `src/lib/nlp.ts`, `src/main.tsx`, `src/pages/Dashboard.tsx`, `src/convex/assistant.ts`, `src/convex/life.ts`, `src/convex/_generated/*`, `vly-toolbar-readonly.tsx`, and stock shadcn components. **Zero in `spec/` or `scripts/`.** | Gate is "no NEW problems" until a cleanup phase. See CHANGE-0003. |
| D13 | `toMondayIndex()` in `src/lib/nlp.ts` is defined but never used. | Dead helper, caught by `no-unused-vars`. Remove during 0A. |

### Intentionally accepted

| ID | Issue | Why accepted |
|---|---|---|
| A1 | `schemaValidation: false` today. | Enabling it before enum validators land would surface junk we are about to create. Scheduled for Phase 0C with a dry-run audit. |
| A2 | Template `users.role` (`admin`/`user`/`member`) exists and is unused. | Must be explicitly quarantined from the real grants model so it is never mistaken for one. |
| A3 | `vite.config.ts` contains `server.hmr: { overlay: false }`. | Pre-existing template config. The platform forbids modifying it. **Do not touch.** |
| A4 | Tax engine supports 5 countries; only US has full arithmetic. | All five are working. Depth is expressed with a visible badge, not by deleting capability. |
| A5 | `assistantState.weights` is a mild behavioural fingerprint. | It is never shared and never leaves the user's space. Documented in the export manifest as user data. |

---

## Phase complexity budgets

Mandatory per ADR-016. **Exceeding any figure is a stop condition requiring
approval**, not a note.

| Phase | New files | New tables | New deps | New abstractions | Must NOT introduce |
|---|---|---|---|---|---|
| **0A** | 4 | 0 | 1 (optional: test script only — `bun test` needs none) | 1 (deterministic-id upsert helper) | New object kinds · new public exports · behaviour changes beyond the listed defects · schema changes |
| **0B** | 9 | 5 (`spaces`, `spaceMembers`, `grants`, `accessLog`, `links`) | 0 | 1 (`permissions.can` + `scopeForViewer`) | Object/EAV tables · per-entity sharing logic · a second access path |
| **0C** | 5 | 2 (`modelSnapshots`, `featureFlags`) | 0 | 1 (deterministic-id upsert, shared with 0A) | Renumbering feature indices 0–7 · a migration framework |
| **1.0** | 11 | 1 (`attentionState`) | 0 | 1 (attention pipeline) | The scorer in the hard-rule path · an impressions table · notification delivery · a block/plugin framework |
| **1.1** | 8 | 1 (`modelSnapshots` if not added in 0C) | 0 | 1 (generalised `extractFeatures`) | Negative category features · training from absence · changes to indices 0–7 |
| **1.5** | 7 | 3 (`connectionTokens`, `syncCursors`, `oauthStates`) | 0 | 1 (`NormalizedBatch` + `applyBatch`) | Per-provider mutations · per-provider UI · broader than minimum scopes · mutating calendar scopes |
| **2** | 5 | 1 (`calendarEvents`) | 0 | 0 (Google adapter only) | Writing to Google · storing private event titles · storing attendees/descriptions/locations · a second OAuth path |
| **3** | per-feature | per-feature | 0 | per-feature | Any of it without its own spec section, ADR, budget and approval |

**Standing exclusions, all phases:** no external AI/LLM API · no new dependency
without approval · no generic object/EAV table · no agent framework · no settings
screen · no push notifications · no sixth spec file · no modification of
`vite.config.ts` · no edits to `.env` · no hand-edits to `src/convex/_generated`.

---

## Current Development State

```
Current phase:        Pre-Phase — spec system establishment (CHANGE-0001)
Current objective:    Establish the development control system.
Last completed:       CHANGE-0001 — /spec established, drift detector added.
Next phase:           0A — awaiting explicit approval. NOT STARTED.

Blockers:             None technical.
                      One decision pending: Phase 0A approval.

Failing tests:        None. No test suite exists yet (D10/D11).

Known risks:
  R1  Concurrent user actions duplicate or corrupt state  → ADR-017, Phase 0A
  R2  Model self-reinforcement                             → ADR-004/005, Phase 1.1
  R3  Personalisation suppressing a legal deadline         → ADR-006, Phase 1.0
  R4  Cross-tenant leak from mixed userId/spaceId scoping   → ADR-009, Phase 0B
  R13 Infrastructure growing faster than product value     → ADR-016, every phase
  R15 Convex serialisation of -Infinity (unverified)       → N5, Phase 0A

Phase status:
  0A  Specified — awaiting approval
  0B  Specified — depends on 0A
  0C  Specified — depends on 0B
  1.0 Specified — depends on 0C
  1.1 Specified — depends on 1.0
  1.5 Specified — depends on 1.1
  2   Specified — depends on 1.5; needs Google OAuth credentials
  3   Specified — depends on 2
```

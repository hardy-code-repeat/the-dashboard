# 02 — CHANGELOG

**Development changelog and architectural decision record for Panel.**

Status: `ACTIVE` · Last updated: 2026-10-01

This file has three jobs:

1. Record every meaningful change, with its reason.
2. Record every architectural decision **once**, permanently, so it is not
   re-litigated without new evidence.
3. Hold the **Open Questions register** and the authoritative **phase status**.

### Severity taxonomy

Every CHANGE entry carries a `Severity` field:

| Severity | Meaning |
|---|---|
| `PATCH` | Fixes a defect with no behavioural or architectural consequence. |
| `MINOR` | Adds capability inside an existing structure. No new entity, dependency or abstraction. |
| `MAJOR` | Adds a new entity, dependency, or architectural abstraction. |
| `SECURITY` | Changes a security or privacy invariant. Always requires an ADR. |
| `ARCHITECTURE` | Changes an existing architectural decision. Requires a new ADR superseding an old one. |
| `PRODUCT` | Changes product scope, direction, or a product decision. Requires explicit user approval. |

**Type** (feature / bug / architecture / security / product / refactor) and
**Severity** are separate axes: a `refactor` can be `PATCH`; a `feature` can be
`MAJOR`.

---

## CHANGE-0001

```
Date:       2026-10-01
Phase:      Pre-Phase (baseline establishment)
Type:       architecture
Severity:   ARCHITECTURE
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
Severity:   PATCH
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
Severity:   PATCH
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

## CHANGE-0004

```
Date:       2026-10-01
Phase:      Pre-Phase (governance hardening)
Type:       architecture
Severity:   ARCHITECTURE
Summary:    Hardened the spec system into an operating system: explicit phase
            lifecycle, an Open Questions register, end-to-end traceability ids,
            a Source of Truth Matrix, a Do Not Touch register, scope protection,
            an agent authority matrix, an evidence hierarchy, change severity, a
            formal completion contract, and a Current Reality / Target State
            split.
Why:        The first pass documented Panel. It did not yet *govern* it. An
            agent could satisfy it literally and still invent a requirement,
            silently make a product decision, expand scope, delete working
            functionality, or claim completion without evidence. These are the
            five failure modes that matter most, and each now has a structural
            control rather than a good intention.
Previous:    Architecture was documented; governance was implicit.
New:         Every phase has a lifecycle status. Every approval-requiring
             decision has a durable Q-xxx record. Every substantive requirement
             is traceable REQ -> ADR -> PHASE -> TASK -> AC -> TEST -> CHANGE.
             Ownership of each kind of truth is explicit with tie-break rules.
             Protected code is listed with reasons. Agent authority is a matrix,
             not a paragraph. Completion has a formal contract.
Files:       spec/01-05, scripts/spec-drift.ts
Schema:      None. No application code, Convex schema, dependency, test or
             behaviour was touched. Phase 0A remains unimplemented.
Tests:       bun scripts/spec-drift.ts (extended); bunx tsc -b --noEmit clean.
Risks:      Governance can grow faster than product value — the same failure
             mode the complexity budget guards against. Mitigated by keeping the
             drift script dependency-free and the control centre a plain view.
Decision:    The agent is the executor of approved decisions, not the owner of
             those decisions.
Related ADR: ADR-019, ADR-020, ADR-021
```

---

## CHANGE-0005

```
Date:       2026-10-01
Phase:      0A (Foundation and defect fixes)
Type:       bug
Severity:   MINOR
Summary:    Added the Phase 0A regression suite (102 fixtures across three
            files) and fixed defects N3, N5, N6, N8 and D5, D6, D8, D13.
            TASK-0A-002 (N1) and TASK-0A-003 (N2) were NOT completed: the
            first is blocked by Q-005, the second by Q-001.
Why:        D10 — the original verification harnesses were deleted and took all
            regression protection with them, leaving the intelligence layer
            untestable against change. Everything shipped in 0A is now
            covered by fixtures rather than by having been run once.
Previous:    No test files existed. Task creation took two round-trips.
            Recurring tasks parsed and displayed but never respawned.
            rankTasks returned -Infinity to the client. filingYear and
            requireUserId were duplicated across two Convex modules.
            previewCapture was exported dead; toMondayIndex was dead.
New:         src/lib/{nlp,scorer,tax}.test.ts — 102 fixtures on a fixed clock.
            addTask is a single atomic mutation taking an optional area.
            Completing a recurring task spawns its next occurrence exactly once,
            guarded by a not-completed -> completed transition check.
            Scorer exposes FEATURE_NAMES and a finite COMPLETED_TASK_SCORE.
            Tax exposes filingYearFor and a clamped readinessScore.
            Areas exposes DEFAULT_AREA_SLUG.
Files:       src/lib/nlp.ts, src/lib/scorer.ts, src/lib/tax.ts,
             src/lib/areas.ts, src/lib/utils.ts,
             src/lib/nlp.test.ts, src/lib/scorer.test.ts, src/lib/tax.test.ts,
             src/convex/assistant.ts, src/convex/life.ts, src/convex/schema.ts,
             src/components/Areas.tsx, src/pages/Dashboard.tsx
Schema:      None. The tasks.priority change is a comment correction only —
             the stored values (0/1/2 = NOW/SOON/LATER) were already correct.
Tests:       bun test -> 102 pass, 0 fail.
             bunx tsc -b --noEmit -> clean.
             bun convex dev --once -> Convex functions ready.
             bun scripts/spec-drift.ts -> 16 pass, 1 warn (planned files), 0 fail.
             bun run lint -> 10 errors / 19 warnings, down from the 12 / 19
             baseline. Zero problems in any new or modified lib file.
Risks:      The -Infinity round-trip question (N5) was resolved by replacing
             the value with a finite sentinel rather than by proving Convex
             mangles it; the original "not verified" claim stands unproven but
             is now moot. Deterministic-id upsert (ADR-017) remains unbuilt —
             see Q-005.
Decision:    Report the contradiction rather than route around it (ADR-021).
             Q-005 is recorded; ADR-017 is left untouched because superseding
             it is the user's decision, not the agent's.
Related ADR: ADR-016, ADR-017 (unimplemented), ADR-019, ADR-021
```

---

## Open Questions / Decisions Required

**Durable register of decisions that require Hardik's approval.**

> **The agent must never silently choose between product options merely to
> unblock implementation.** If work is blocked on one of these, it stops and
> asks. An unresolved question that blocks a phase makes that phase `BLOCKED`.

### Q-001 — Guest account data on upgrade

| Field | Value |
|---|---|
| **ID** | Q-001 |
| **Question** | What should happen to anonymous guest data when the user later signs into an email account? |
| **Why it matters** | `Auth.tsx` offers `signIn("anonymous")` with no claim path. A guest who later signs in by email receives a **different user id**, so every task, expense and note is silently orphaned. This is defect **N2** and it violates MAIN_AGENT E8 (no silent data loss) and ADR-018. It is not a UI bug — it is an account-model decision. |
| **Option A** | **Migrate** anonymous data into the authenticated account on first sign-in (requires linking the anonymous user id to the new one). |
| **Option B** | **Remove guest sign-in** entirely. One account model, no migration path needed. |
| **Option C** | Another explicitly approved approach. |
| **Info needed to decide** | (1) Is guest sign-in a conversion tool or a demo affordance? (2) What is the acceptable migration window — does data older than N days get dropped? (3) Does Convex Auth expose a hook to claim an anonymous identity, or would Panel need its own marker column on `users`? |
| **Decision owner** | Hardik |
| **Status** | **OPEN — BLOCKING** |
| **Blocks** | **Phase 0A** (task TASK-0A-003 / N2 only; the rest of 0A is unaffected) |
| **Created** | 2026-10-01 |
| **Resolved** | — |
| **ADR created** | none yet — ADR-018 currently states the constraint, not the resolution |

### Q-002 — Tax country depth

| Field | Value |
|---|---|
| **ID** | Q-002 |
| **Question** | Keep five tax countries (US deep, UK/IN/CA/AU deadlines-only), or narrow to fewer? |
| **Why it matters** | The brief says prefer depth over breadth, but also do not remove working functionality. RJD-007 already chose *modularise + depth badge* over deletion. This question is whether that is sufficient, or whether non-US arithmetic should eventually be added. |
| **Option A** | Keep as-is: US deep, others deadlines-only with a visible badge. |
| **Option B** | Promote UK and IN to deep over time. |
| **Option C** | Narrow the UI to one country. |
| **Info needed to decide** | Whether any real user needs a non-US calculation. No evidence either way exists today. |
| **Decision owner** | Hardik |
| **Status** | OPEN — non-blocking |
| **Blocks** | Nothing today. Relevant to Phase 3 Finance expansion. |
| **Created** | 2026-10-01 |
| **Resolved** | — |
| **ADR created** | — |

### Q-003 — Model inspector visibility

| Field | Value |
|---|---|
| **ID** | Q-003 |
| **Question** | Should the learned weights remain a visible dashboard feature (today: a `Brain` toggle showing live weights), or move behind a settings/debug surface? |
| **Why it matters** | It is simultaneously the trust story ("here is exactly what Panel learned about you") and a distraction on a brutalist attention surface. It is currently wired into `Dashboard.tsx` and its feature names are defined in two places (defect N6). |
| **Option A** | Keep on the dashboard as a trust feature. |
| **Option B** | Move to a dedicated `/model` route. |
| **Option C** | Remove from the product surface, keep only in dev. |
| **Info needed to decide** | Whether users actually read it. No evidence either way. |
| **Decision owner** | Hardik |
| **Status** | OPEN — non-blocking |
| **Blocks** | Nothing. Relevant to TASK-0A-007 (resolving N6 touches this surface). |
| **Created** | 2026-10-01 |
| **Resolved** | — |
| **ADR created** | — |

### Q-004 — Monetisation validation

| Field | Value |
|---|---|
| **ID** | Q-004 |
| **Question** | Is the proposed free/pro boundary (1 free connected tool) validated at all? |
| **Why it matters** | Every business-model figure in PRODUCT_CONTEXT §4 is `HYPOTHESIS`. Nothing has been tested with a user. This is the largest unvalidated assumption in the project. |
| **Option A** | Defer entirely until there are users. |
| **Option B** | Run a pricing smoke test with a landing page before building more. |
| **Info needed to decide** (1) Is there any realistic path to first users? (2) Does Panel need to be economically real before Phase 3 investment continues? |
| **Decision owner** | Hardik |
| **Status** | OPEN — non-blocking |
| **Blocks** | Nothing. Relevant to Phase 3 scope. |
| **Created** | 2026-10-01 |
| **Resolved** | — |
| **ADR created** | — |

### Q-005 — ADR-017 is not implementable on Convex, and its premise appears wrong

| Field | Value |
|---|---|
| **ID** | Q-005 |
| **Question** | ADR-017 mandates a deterministic-id upsert for `assistantState`. Convex cannot do that. Do we supersede ADR-017, and on what mechanism? |
| **Why it matters** | TASK-0A-002 / defect N1 exists solely to implement ADR-017. Two independent findings make it unbuildable as written (Level 1/6 evidence, verified 2026-10-01). **(a) No API.** `ctx.db.insert` has exactly two overloads in Convex 1.42.1 (the installed version) — `insert(table, value)` and `insert(value)` — and neither accepts a document id. `patch` and `replace` both *throw* if the document does not exist, so neither can upsert. The changelog through 1.47.0-unreleased adds no explicit-id insert. Document ids are generated by the system and are not caller-settable. **(b) Wrong premise.** ADR-017 rejects OCC because "the two inserts touch different new documents, so there is no conflict to detect". That reasoning does not hold for Convex. Convex's read set records the **index range scanned**, not just point reads, and the committer retries any transaction whose read set overlaps a concurrent write. `loadState` reads `assistantState.by_user` via `.withIndex(...)`, so a concurrent insert of another `assistantState` row lands *inside* that read range and is detected as a conflict; the loser is rolled back and re-executed deterministically, at which point it observes the row and patches instead of inserting. N1 as described may therefore never occur. |
| **Option A** | **Supersede ADR-017.** Record that Convex OCC already makes read-then-insert safe, and close N1 as *not a defect* — with an explicit conformance test proving two concurrent completions leave one row. Cheapest, and matches the platform's documented guarantee. Requires evidence-grade proof, not just reading. |
| **Option B** | **Keep the invariant, change the mechanism.** Enforce exactly-one-row with a status column (`v.union`) and a patch-only write path, so a duplicate becomes impossible rather than merely unlikely. Costs a schema change, which Phase 0A's budget forbids (0 new tables, no schema changes) — so it moves to 0C. |
| **Option C** | **Accept read-then-insert as-is** and rely on OCC, documenting the reasoning in ADR-017 without changing code. |
| **Info needed to decide** | (1) Is a conformance test against a live Convex deployment acceptable as the evidence that closes N1, or does N1 need to stand on reasoning alone? (2) If Option A or C, does ADR-017 get superseded or amended? (3) If Option B, is deferring it to 0C acceptable given R1? |
| **Decision owner** | Hardik |
| **Status** | **OPEN — BLOCKING** |
| **Blocks** | **Phase 0A** (TASK-0A-002 only; the rest of 0A is unaffected) |
| **Created** | 2026-10-01 |
| **Resolved** | — |
| **ADR created** | none yet — ADR-017 states the constraint; this records that the constraint is unsatisfiable on the current platform |

---

## Architecture Decisions

Permanent IDs, stable forever. **They are not stored in numeric order.** Do not
re-open a decision unless new evidence invalidates it.
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

### ADR-020 — Phase lifecycle and approval are explicit states

**Decision.** Every phase carries exactly one status: `NOT STARTED`, `APPROVED`,
`IN PROGRESS`, `IMPLEMENTED`, `VERIFIED`, `SHIPPED`, `BLOCKED`. `IMPLEMENTED`
means code exists but verification is incomplete. Only the user sets `SHIPPED`.

**Context.** Without explicit states, "the plan mentions it" drifts into "it's
being worked on" drifts into "it's done".

**Alternatives considered.**
- Implicit status inferred from activity — rejected: unfalsifiable.
- Boolean done/not-done — rejected: loses the implemented-but-unverified state,
  which is where the most dangerous overclaiming happens.

**Why chosen.** The dangerous moment is between "code written" and "verified". A
status that names that moment makes overclaiming visible.

**Consequences.** An agent must check status before implementing. A detailed
specification is never an approval.

**Revisit when.** Never. This is a governance invariant.

---

### ADR-021 — The agent executes decisions; it does not own them

**Decision.** Product decisions, ADR decisions, security invariants, complexity
budgets and phase approval state may be changed **only** by the user. The agent
may modify implementation artifacts freely within an approved scope.

**Context.** An agent optimising for "task complete" will rationalise its way
past any soft governance. The only reliable control is a hard boundary.

**Alternatives considered.**
- Soft guidance ("use judgement") — rejected: unfalsifiable, and exactly the
  failure mode being prevented.
- Agent may self-authorise low-risk changes — rejected: there is no low-risk
  category once precedent exists.

**Why chosen.** Turnkey ownership of decisions is how an agent rewrites the
specification to match its own implementation.

**Consequences.** Blocked work produces an Open Question, not a workaround.
Authority is a matrix (MAIN_AGENT §9), not a paragraph.

**Revisit when.** Never without a superseding ADR and explicit user approval.

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
| **N1** | Duplicate `assistantState` row breaks the dashboard permanently. Two concurrent completions both insert; `.unique()` then throws in `getDashboard` and `getModel`. **Premise now in question — see Q-005.** ADR-017's prescribed fix (deterministic-id upsert) is not implementable on Convex, and Convex's OCC may already prevent this. Not fixed. | `src/convex/assistant.ts` (`recordOutcome`) | Phase 0A — **BLOCKED by Q-005** |
| **N2** | Guest accounts have no claim path → silent data loss on account upgrade. | `src/pages/Auth.tsx:83-95` | Phase 0A (ADR-018) |
| **N5** | `rankTasks` returned `score: -Infinity` for completed tasks. | **RESOLVED (CHANGE-0005)** — `COMPLETED_TASK_SCORE = -1_000_000` is finite, so the value survives serialisation regardless of how Convex handles `-Infinity`. | `src/lib/scorer.ts` | Done |
| **N7** | No enum validators: `area`, `bucket`, `recurrence`, `provider`, `country`, `status`, `priority` are bare `v.string()` / `v.number()`, with `schemaValidation: false`. | `src/convex/schema.ts` | Phase 0C |
| **N4** | Query idiom is "collect everything, filter in JS": `getAreaTasks` (hot path), `toggleDocument`, `connectTool`, `disconnectTool`, `disableArea`, `getFinance` expense year filter. | `src/convex/life.ts` | Phase 0B |
| **N3** | `previewCapture` was exported but referenced nowhere; its comment claimed the contract is single-sourced, which is false. | **RESOLVED (CHANGE-0005)** — deleted; parsing already happens server-side in `addTask`. | — | Done |
| **N6** | Three sources of truth: feature names in `explain()` vs `FEATURE_NAMES` in `Dashboard.tsx`; priority semantics differ between schema comment, type, and `PRIORITY` map. | **RESOLVED (CHANGE-0005)** — `FEATURE_NAMES` is exported from `src/lib/scorer.ts` and imported by the dashboard; the `tasks.priority` schema comment now states 0/1/2 = NOW/SOON/LATER. | — | Done |
| **N8** | `filingYear` logic duplicated in `getFinance` and `saveTaxProfile`. | **RESOLVED (CHANGE-0005)** — single `filingYearFor(now)` exported from `src/lib/tax.ts`. | — | Done |

### Deferred — real, not urgent

| ID | Issue | Why deferred |
|---|---|---|
| D1 | No `internalMutation` / `internalQuery` / `httpAction` / cron exists anywhere. | Required by Attention (1.1) and agents (Phase 3), not before. |
| D2 | `getDashboard` loads every task ever, unbounded `.collect()`. | Fine at personal scale; fixed with D3 before Phase 1. |
| D3 | `clearCompleted` deletes in a loop, unbounded. | Same. |
| D4 | Health counters are component-local `useState` and reset on reload. | Needs a table; scheduled after 0B supplies `spaceId`. |
| D5 | Recurring tasks parse and display but never respawn. `nextOccurrence` is exported and tested but called by no mutation. | **RESOLVED (CHANGE-0005)** — wired into `setTaskCompleted`. |
| D6 | Area-scoped task creation takes two round-trips (`addTask` then `setTaskArea`); a failure between them orphans the task. | **RESOLVED (CHANGE-0005)** — `addTask({ input, area })` is one atomic mutation. |
| D7 | `AssistantDoc` uses `any` for `_id` / `userId` — a documented workaround for a `DataModel["table"]` wrapper-type issue. | Revisit during 0B when types change anyway. |
| D8 | `requireUserId` duplicated in `assistant.ts` and `life.ts`. | **RESOLVED (CHANGE-0005)** — `life.ts` imports the exported helper. |
| D9 | Stray `}` after the `--sidebar-ring` block in `src/index.css`. Harmless; CSS compiles. | Cosmetic. |
| D10 | No test files exist. The three original harnesses (`parse-check`, `scorer-check`, `tax-check`) passed and were deleted, taking all regression protection with them. | **RESOLVED (CHANGE-0005)** — 102 fixtures. |
| D11 | `package.json` has no `test` script. | **RESOLVED (CHANGE-0005)** — `bun test` runs the suites directly; no script needed. |
| D12 | **`bun run lint` fails at baseline: 12 errors, 19 warnings.** All pre-existing, in `src/hooks/use-mobile.ts`, `src/lib/nlp.ts`, `src/main.tsx`, `src/pages/Dashboard.tsx`, `src/convex/assistant.ts`, `src/convex/life.ts`, `src/convex/_generated/*`, `vly-toolbar-readonly.tsx`, and stock shadcn components. **Zero in `spec/` or `scripts/`.** | Gate is "no NEW problems" until a cleanup phase. See CHANGE-0003. CHANGE-0005 reduced this to 10 errors / 19 warnings. |
| D13 | `toMondayIndex()` in `src/lib/nlp.ts` is defined but never used. | **RESOLVED (CHANGE-0005)** — removed. |

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
Current phase:        0A — Foundation and defect fixes (CHANGE-0005)
Current objective:    Phase 0A is BLOCKED on two user decisions. Five of
                      seven tasks are implemented and verified; two are not.
Last completed:       CHANGE-0005 — regression suite + N3/N5/N6/N8, D5/D6/D8/D13.
Next phase:           0A — resumes the moment Q-005 and Q-001 are answered.

Blockers:             Q-005 (ADR-017 is unimplementable on Convex) — BLOCKING
                      for TASK-0A-002.
                      Q-001 (guest account data) — BLOCKING for TASK-0A-003.
                      Non-blocking: Q-002, Q-003, Q-004.

Failing tests:        None. 102 fixtures pass (D10/D11 resolved).

Known risks:
  R1  Concurrent user actions duplicate or corrupt state  → Q-005, unresolved
  R2  Model self-reinforcement                             → ADR-004/005, Phase 1.1
  R3  Personalisation suppressing a legal deadline         → ADR-006, Phase 1.0
  R4  Cross-tenant leak from mixed userId/spaceId scoping   → ADR-009, Phase 0B
  R13 Infrastructure growing faster than product value     → ADR-016, every phase
  R15 Convex serialisation of -Infinity                    → CLOSED by CHANGE-0005

Phase status (authoritative — see MAIN_AGENT §5):
  PHASE  STATUS        BLOCKED BY        NOTE
  0A     BLOCKED       Q-005, Q-001      5 of 7 tasks done. Both open items are
                                         user decisions; the agent may not make
                                         either (ADR-021).
  0B     NOT STARTED   —                 Depends on 0A
  0C     NOT STARTED   —                 Depends on 0B
  1.0    NOT STARTED   —                 Depends on 0C
  1.1    NOT STARTED   —                 Depends on 1.0
  1.5    NOT STARTED   —                 Depends on 1.1
  2      NOT STARTED   credentials       Depends on 1.5; needs GOOGLE_CLIENT_ID/SECRET
  3      NOT STARTED   —                 Depends on 2
```

### Phase lifecycle status table

| Phase | Status | Approved by | Date | Blocked by | Notes |
|---|---|---|---|---|---|
| **0A** | **BLOCKED** | Hardik | 2026-10-01 | `Q-005` blocks TASK-0A-002; `Q-001` blocks TASK-0A-003 | Approved explicitly: "Implement Phase 0A exactly as specified." Five of seven tasks implemented and verified (CHANGE-0005). The remaining two are blocked on decisions only the user can make, so the phase is `BLOCKED`, not `VERIFIED`. |
| **0B** | NOT STARTED | — | — | — | Depends on 0A |
| **0C** | NOT STARTED | — | — | — | Depends on 0B |
| **1.0** | NOT STARTED | — | — | — | Depends on 0C |
| **1.1** | NOT STARTED | — | — | — | Depends on 1.0 |
| **1.5** | NOT STARTED | — | — | — | Depends on 1.1 |
| **2** | NOT STARTED | — | — | user credentials | Depends on 1.5 |
| **3** | NOT STARTED | — | — | — | Depends on 2 |

**No phase is APPROVED. Nothing is IN PROGRESS. Nothing is IMPLEMENTED,
VERIFIED or SHIPPED.**

> A written specification is never an approval (MAIN_AGENT §12). The existence of
> a detailed plan for Phase 0A does not authorise beginning it.

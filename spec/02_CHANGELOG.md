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

## CHANGE-0006

```
Date:       2026-10-01
Phase:      0A (decision resolution only — no feature work)
Type:       architecture
Severity:   ARCHITECTURE
Summary:    Superseded ADR-017 with ADR-022 and verified defect N1 against a
            live Convex deployment. No application behaviour changed.
Why:        Q-005 was blocking Phase 0A. ADR-017 prescribed a deterministic-id
            upsert that Convex does not offer, and rejected OCC on a premise
            that does not hold for Convex's range-based read sets. The
            question had to be decided on evidence, not reasoning, so N1 could
            not be closed by argument.
Previous:    ADR-017 stood, unbuilt, with N1 recorded as an open defect and
            TASK-0A-002 unstarted.
New:        ADR-022 replaces it. The existing read-then-insert path is correct
            by construction and requires no code change. N1 is VERIFIED.
Files:       spec/02_CHANGELOG.md, spec/04_SYSTEM_FUNDAMENTALS.md,
             spec/05_PANEL_CONTROL_CENTER.html, scripts/conformance-occ.ts,
             scripts/spec-drift.ts
Schema:      None. No table, field or index was added, changed or removed.
Code:        No application behaviour changed. `recordOutcome` keeps the
            read-then-insert it always had; only its comment was corrected to
            cite ADR-022 instead of the unresolved Q-005.
Deps:        None added. The test uses `convex/browser`'s ConvexHttpClient,
            which ships with the existing `convex` dependency.
Tests:       bun scripts/conformance-occ.ts <url> 32 10
               -> PASS. 10 rounds, 640 concurrent mutations, 0 duplicates.
               Negative control reports count=2 as expected.
             Earlier runs: 8x5 (80), 24x8 (384) and 32x10 (640), all PASS.
             Total 1,744 concurrent mutations over 33 rounds, 0 duplicates.
             bun test -> 102 pass, 0 fail.
             bunx tsc -b --noEmit -> clean.
             bun convex dev --once -> Convex functions ready.
             bun scripts/spec-drift.ts -> 17 pass, 1 warn, 0 fail.
             bun run lint -> 10 errors / 19 warnings, unchanged from the
             pre-existing baseline; zero problems in any new file.
Risks:      The invariant now rests on a platform guarantee Panel does not own.
            Mitigated by making the dependency explicit in ADR-022, by
            naming the access pattern (`loadState` reads through `by_user`) that
            the guarantee depends on, and by defining a failure path that
            escalates to a schema-level constraint rather than a workaround.
            The conformance fixture is deliberately NOT checked in, so no
            unauthenticated public mutation ships (MAINAGENT S1); re-arming
            requires the documented two-file procedure.
Decision:    Decide the question on executed evidence, and preserve the
            superseded ADR rather than deleting it.
Related ADR: ADR-022 (new), ADR-017 (superseded), ADR-021, ADR-019
```

---

## CHANGE-0007

```
Date:       2026-10-01
Phase:      0B — Ownership and access foundation
Type:       architecture
Severity:   ARCHITECTURE
Summary:    Every product object now carries ownerUserId + spaceId. Six new
            tables, one pure access-resolution module, six collect-all query
            sites replaced by index ranges, and a critical pre-existing defect
            in the Finance area found and fixed by the new conformance test.
Why:        ADR-009 requires ownership to be separate from access, and §4.2
            requires a single deny-by-default resolution path. The repository
            had a bare `userId` column doing both jobs, which is exactly the
            mixed-scoping risk R4 describes.
Previous:    Product tables had `userId`. `AssistantDoc` used `any`. Six query
            handlers collected a whole table and filtered in JavaScript.
New:        `ownedBy` spread on every product table; six new tables; a personal
            space created on first write; an idempotent backfill for rows
            written before the rename; `src/lib/permissions.ts` as the only
            place an access decision is made.
Files:       src/convex/schema.ts, src/convex/assistant.ts, src/convex/life.ts,
             src/convex/spaces.ts (new), src/lib/permissions.ts (new),
             src/lib/permissions.test.ts (new), scripts/conformance-0b.ts (new)
             — 2 new Convex modules + 1 new lib + 2 new test files of the
             9-file budget; 4 files modified in place.
Schema:     +6 tables (spaces, spaceMembers, grants, accessLog, links, activity).
             +2 required columns on 8 product tables (ownerUserId, spaceId).
             `tasks.area` promoted from optional to required.
             Renamed: by_user -> by_owner, by_user_created -> by_owner_created,
             by_user_order -> by_owner_order.
             +4 compound indexes: tasks.by_owner_area, areas.by_owner,
             areas.by_owner_slug, taxDocuments.by_owner_requirement,
             connections.by_owner_provider.
             schemaValidation remains false (scheduled for 0C).
Code:       Every insert path resolves the caller's personal space first and
            stamps both ownership columns, so an object can never be written
            without a home space. `getAreaTasks`, `toggleDocument`,
            `connectTool`, `disconnectTool`, `disableArea` and `resolveArea`
            are index ranges instead of full collects.
Tests:       bun test -> 120 pass, 0 fail (18 new permission fixtures).
             bun scripts/conformance-0b.ts <url> 40 -> all invariants held.
             Same with --legacy against a temporary fixture -> the pre-0B
             backfill reported exactly 1 row, the row became owned and
             reachable through the area index, and a second run reported 0.
             bunx tsc -b --noEmit -> clean.
             bun convex dev --once -> Convex functions ready.
             bun run lint -> 7 errors / 19 warnings, down from 10/19; the three
             removed were the `any` in AssistantDoc (D7). Zero new problems.
Defect found and fixed (unplanned, inside scope):
            `getFinance` returned the raw COUNTRIES entry, which carries two
            function properties (`taxYearLabel`, `deadlines`). Convex cannot
            serialise a function, so the query threw on every call and the
            entire Finance area rendered an error instead of the user's tax
            figures. Found by the new conformance harness, not by inspection.
            Fixed by projecting the country to its scalar fields and resolving
            the two computed values server-side. Recorded as **D14**.
Budget:     7 of 9 files, 0 of 0 deps, 1 of 1 abstraction.
            TABLES: 6 against a budget of 5. See the correction below.
Risks:      Renaming `userId` to `ownerUserId` is a breaking schema change.
            `schemaValidation: false` means the push does not rewrite existing
            rows, so a deployment that already has data would show an empty
            dashboard until the backfill runs. Mitigated by shipping
            `spaces:migrateOwnership`, which the user can run and which is
            idempotent, and by `spaces:auditOwnership`, which makes the state
            checkable rather than assumed. Verified against a live deployment
            with a deliberately pre-0B-shaped row.
Decision:    Correct an internal specification contradiction rather than
            silently expand a budget, and record the correction in full.
Related ADR: ADR-009, ADR-016, ADR-019, ADR-021
```

### Budget correction — 0B tables: 5 recorded, 6 specified

The repository contained a contradiction between two statements of the same
phase, both in `04_SYSTEM_FUNDAMENTALS.md` §11.2:

- the **IN SCOPE** line names six tables — `spaces`, `spaceMembers`, `grants`,
  `accessLog`, `links`, **`activity`**;
- the **budget** line in this file names five, and omits `activity`.

`activity` is also required by the 0B acceptance criterion "ActivityKind is a
closed union", which is meaningless without the table. Resolved in favour of the
more specific statement (IN SCOPE + acceptance criteria) rather than by dropping
work the phase explicitly asks for. **Corrected budget: 6 tables.** The Control
Centre's 0B entry carried the same stale `tables: 5` and has been corrected to
match. This is a documentation correction, not an increase in ambition, and it
changes no architecture, security invariant or product scope.

---

## CHANGE-0008

```
Date:       2026-10-01
Phase:      0C — Model versioning and data integrity
Type:       architecture
Severity:   ARCHITECTURE
Summary:    The learned model gained weight versioning, a hard clamp, a decaying
            learning rate, automatic restore points, byte-exact rollback, reset,
            pause and per-user feature flags. Every enum-ish field became a
            closed union, and `schemaValidation` is now ON.
Why:        A model that trains forever with no ceiling, no undo and no
            off-switch is a liability in a tool that tells people what to do.
            Separately, `schemaValidation: false` meant a typo in a status
            string or a priority of `7` could reach the database and break a
            query at read time (defect N7).
Previous:    `trainOne` grew weights without a bound and at a fixed rate.
            `AssistantDoc` carried `weightsVersion`/`modelVersion` fields that
            nothing ever wrote. `snapshotReason: "automatic"` was in the type
            union and unreachable. There was no way to pause, reset or roll
            back, and nine enum-ish fields were bare `v.string()`.
New:        WEIGHT_CLAMP 3.0 applied inside `trainOne`; `learningRateFor`;
            `alignWeights`; `modelSnapshots` and `featureFlags` tables;
            automatic restore points every 25 labelled events; a full model
            control surface; ten closed vocabularies in the schema.
Files:       src/lib/scorer.ts (modified), src/convex/schema.ts (modified),
             src/convex/assistant.ts (modified), src/convex/spaces.ts
             (modified), src/convex/life.ts (modified),
             src/convex/model.ts (new), src/lib/model.test.ts (new),
             src/lib/schema-vocab.test.ts (new), scripts/conformance-0c.ts
             (new) — 3 new files of the 5-file budget.
Schema:     +2 tables (modelSnapshots, featureFlags), as budgeted.
             Enum validators on tasks.priority, tasks.area, areas.slug,
             taxProfile.country, expenses.bucket, expenses.confidence,
             connections.provider, connections.status, accessLog.objectKind,
             activity.objectKind.
             schemaValidation: false -> true. Accepted debt A1 closed.
Code:        `recordOutcome` now honours `learningPaused` (a paused model moves
            no weight, no counter and no sample), applies the decaying rate,
            and takes an automatic restore point on the cadence — all inside
            the same transaction as the update, so a restore point can never
            disagree with the state it recorded.
Tests:       bun test -> 151 pass, 0 fail (31 new model-integrity fixtures,
             4 new vocabulary-drift fixtures).
             bun scripts/conformance-0c.ts <url> -> all invariants held.
             bun scripts/conformance-0b.ts <url> 40 -> still all held.
             bunx tsc -b --noEmit -> clean.
             bun convex dev --once -> Convex functions ready.
             bun scripts/spec-drift.ts -> 17 pass, 1 warn, 0 fail.
             bun run lint -> 3 errors / 19 warnings, down from 7/19 and from the
             original 12/19 baseline. Zero new problems; every remaining error
             is in stock shadcn (carousel, sidebar) or the template
             use-mobile hook.
Defect found and fixed by the phase's own test (recorded as D16):
            `learningRateFor` returned `NaN` for a `NaN` sample count, which
            would have poisoned every subsequent weight. It now sanitises.
Defect found and fixed by the live conformance run (recorded as D17):
            `snapshotReason: "automatic"` was unreachable — nothing took a
            restore point unless the user explicitly reset, so "undo the model"
            was unavailable exactly when someone notices it going wrong.
            Automatic restore points every 25 events now exist, with the
            cadence published through `getModelControls`.
Data migration, executed and verified against the live deployment:
            The dry-run audit (a temporary read-only aggregate fixture, since
            deleted) found 4 pre-0B rows violating the new validators. Repair
            was made general rather than special-cased: `migrateOwnership` now
            normalises ownership, space, area, priority and the required task
            scalars, and *recreates* any row still carrying the pre-0B `userId`
            column, which Convex rejects outright once validation is on. A
            second audit reported zero non-conforming rows, and the push with
            `schemaValidation: true` was accepted.
Risks:      Recreating a pre-0B row issues a new `_id`. Nothing references a
            task id yet — the `links` table was added in 0B and has no writers —
            so there are no dangling references today. Recorded rather than
            hidden: if a later phase adds an id-bearing reference, the
            recreate path must update it in the same transaction.
Decision:    Repair data before enabling validation, never by weakening the
            validator. The migration is idempotent and self-healing: every
            write path runs it once per user via a `migratedAt` sentinel.
Related ADR: ADR-010, ADR-016, ADR-019, ADR-021
```

---

## CHANGE-0009

```
Date:       2026-10-01
Phase:      1.0 — Attention Engine (hard rules)
Type:       feature
Severity:   ARCHITECTURE
Summary:    Panel now has an Attention screen. Eight fixed sections, each with
            its own cap and decay half-life, a whole-screen cap of 24, decay by
            age, grouping of three-or-more, fingerprint de-duplication, pinned
            items that never decay, escalation to level 2, and four feedback
            mutations that are enforced server-side. Nothing is stored except
            the feedback the user actually gave.
Why:        A dashboard that lists everything is a list. The product thesis is
            that a person should be told what needs attention now, ranked by
            what they have historically acted on, and never told to ignore a
            statutory date. Phase 1.0 delivers the un-negotiable half of that
            — the part that must never be personalised (ADR-006, ADR-015).
Previous:    `Dashboard` showed a board of tasks grouped by area and a second
            view listing every open task. There was no notion of urgency,
            no cap, no decay, no "waiting on", no "money", no "changes", and
            no hard-rule surface at all.
New:        `src/lib/attention/{pipeline,rules,sources}.ts`,
            `src/convex/attention.ts`, `src/components/AttentionFeed.tsx`,
            `src/pages/Attention.tsx`, an `attentionState` table, and a
            two-way View switch on the Dashboard.
Files:      src/lib/attention/pipeline.ts (new),
            src/lib/attention/sources.ts (new),
            src/lib/attention/rules.ts (new),
            src/lib/attention/attention.test.ts (new),
            src/convex/attention.ts (new),
            src/components/AttentionFeed.tsx (new),
            src/pages/Attention.tsx (new),
            src/convex/schema.ts (modified), src/pages/Dashboard.tsx
            (modified), src/main.tsx (modified),
            scripts/conformance-attention.ts (new)
            — 7 new files, 4 modified: 11 of the 11-file budget, exactly at
            budget, not over it.
Schema:     +1 table (attentionState), as budgeted. Owner-only; there is no
            sharing story for attention because there is nothing to share.
Deps:       0.
Abstraction: 1 (the attention pipeline — `buildAttention` is a pure function
            over plain inputs; the scorer is not imported anywhere in the
            hard-rule path, which is asserted structurally by a test rather
            than trusted).
Code:       `buildAttention` order is fixed and total: snooze/reject filter →
            grouping → de-duplication → rank → per-section cap → total cap. It
            returns `items`, `bySection`, `produced`, `hiddenByCap` and
            `hiddenByTotalCap`, so the UI can say "3 more" instead of silently
            dropping work. Ranking is deterministic: same input, same screen.
            `options.suppress` is accepted and **deliberately ignored**, which
            is what makes it structurally impossible for learning to hide a
            hard rule (ADR-006).
            Server-side enforcement mirrors the client affordances:
            `attentionDismissed` refuses an escalation-2 item, and
            `attentionSnoozed` refuses an escalation-2 item without a return
            date. The refusal is in the mutation, not only in the button.
Tests:      bun test -> 192 pass, 0 fail (41 attention fixtures).
            bun scripts/conformance-attention.ts <url> -> all invariants held
            against the live deployment, including tenant isolation.
            bunx tsc -b --noEmit -> clean.
            bunx convex dev --once -> Convex functions ready.
            bun run lint -> 3 errors / 19 warnings, unchanged. Zero new
            problems. Every remaining error is pre-existing stock shadcn
            (carousel, sidebar) or the template use-mobile hook.
Defects found and fixed by the phase's own work (D19–D21):
  D19  `connectionRules` gated `connection.unfinished` behind the 48-hour
       staleness window, so a connection the user had just created and never
       finished could never surface at all — the rule was unreachable in the
       case it existed for. Unfinished now fires immediately; quiet still
       requires 48h.
  D20  Acting on or dismissing an item was treated as if it removed the item.
       It does not. A task disappears because it was completed; a statutory
       deadline disappears because time passed. Acting on a deadline records
       the signal and leaves the deadline standing. This is now a named test
       and a named conformance section.
  D21  The live tenant-isolation check produced a false positive: statutory
       tax deadlines are global by construction, so their ids are identical
       across users. The check now distinguishes `isUserOwned` source ids from
       global ones instead of asserting that no id may repeat.
Acceptance criteria, §5.7, checked one by one:
  8 sections with the specified caps (3/5/5/3/3/3/4/3) — PASS
  total cap of 24, pinned items exempt from it — PASS
  decay `score *= 0.5^(ageHours/halfLife)`, pins exempt — PASS
  de-duplication on `kind:sourceId:dueBucket` — PASS
  grouping only in sections that allow it, only at 3 or more — PASS
  escalation to level 2 for <4h or severity >= 0.9; level 2 may only snooze
  with a return date and may never be dismissed — PASS, enforced in the
  mutation as well as in the UI
  feedback semantics: acted/completed = label 1, rejected = label 0, snooze and
  absence = no label — PASS
  hard rules bypass the scorer entirely — PASS, structural test + live check
  that a deadline survives repeated training on unrelated work
Risks:      `hardRules` returns rule output only; nothing it produces can be
            suppressed or demoted. Recorded rather than assumed: the separation
            is enforced by an import-graph test and a conformance run, not by
            types, so a future refactor that imports the scorer into `rules.ts`
            will fail CI rather than fail silently.
Decision:    The Attention feed renders inside the existing Dashboard shell via
            an explicit two-way switch rather than a plugin/registry
            mechanism. A registry for two views would be a block framework,
            which the 1.0 budget forbids. `now` is passed down from the server
            payload into `DueLabel` so the component tree stays free of impure
            render-time calls (this also kept the lint baseline flat).
Related ADR: ADR-003 (computed, not stored), ADR-004 (no learning from
            absence), ADR-005 (snooze is a timing signal), ADR-006 (hard rules
            bypass the ranker), ADR-015 (attention ships in two phases),
            ADR-016 (budget), ADR-019 (spec-driven), ADR-021 (the agent
            executes decisions; it does not own them)
```

---

## CHANGE-0010

```
Date:       2026-10-01
Phase:      1.1 — Learned attention ranking
Type:       feature
Severity:   ARCHITECTURE
Summary:    Attention now has two item classes. Hard rules produce the items
            that must never be personalised; a learned ranker produces the
            ordinary ones, bounded to a quarter of the severity scale so it can
            only break ties. Four appended features, five-signal feedback with
            the documented weights, an exploration slot per section, explicit
            category suppression that cannot reach a rule, and a real kill
            switch.
Why:        Phase 1.0 shipped a correct screen that was identical for everyone.
            The product thesis is that the ranking should reflect this
            person's actual behaviour — without ever letting a habit hide a
            statutory date.
Previous:    `taskRules` emitted every open task. The scorer was used only on
            the dashboard. Attention feedback was recorded and never trained
            on. `suppressedKinds`/`suppressedAreas` did not exist.
New:        `src/lib/attention/ranked.ts` (the second producer), feature indices
            8–11, `AttentionCandidate.class`, the exploration reserve, the
            category suppression set, and a second training path in
            `attention.ts` that most of its lines are refusals.
Files:      New (3 of the 8-file budget): src/lib/attention/ranked.ts,
             src/lib/attention/learned.test.ts, scripts/conformance-1.1.ts.
             Modified (7, no budget cost): src/lib/scorer.ts,
             src/lib/attention/{pipeline,rules,sources}.ts,
             src/convex/{schema,assistant,attention,model}.ts,
             src/components/AttentionFeed.tsx, scripts/conformance-attention.ts,
             and the three v1 regression suites whose goldens were v1-shaped.
Schema:     0 new tables, as budgeted (the budget's one table, modelSnapshots,
             was consumed by 0C). Four optional counters and two optional
             suppression arrays on `assistantState`. Every one is `v.optional`,
             so no data migration was required and no existing row is invalid.
Deps:       0.
Abstraction: 1 (the generalised `extractFeatures` — the same function, with four
             appended inputs and four appended outputs, rather than a second
             extractor that could drift from the first).
Code:       The hard/ranked boundary is `URGENT_WINDOW_HOURS = 4`, a single
            constant read by both producers. Inside it, a task is a rule item;
            outside it, it is ranked. The two lists are concatenated and never
            meet again.
            `HARD_KINDS` is the one list that decides what counts as hard, and
            the *server* reads it before it will train on feedback. The client
            sends `kind`; it does not get to decide what class it is.
            The learned term is `tanh(score) * 0.25`, added to a deterministic
            prior. Bounded, so a maximally trained model cannot invert a real
            urgency gap — the model is a tie-breaker, not a dictator.
            Escalation is computed from the prior *before* the learned term, and
            capped (see D22). The model cannot manufacture or downgrade urgency.
Tests:      bun test -> 213 pass, 0 fail (21 new 1.1 fixtures).
             bun scripts/conformance-1.1.ts <url> -> 25/25 held live.
             bun scripts/conformance-attention.ts <url> -> all 1.0 invariants
             still held, after updating its kind names and its two cap
             measurements (see below).
             bun scripts/conformance-0b.ts, conformance-0c.ts -> unchanged.
             bunx tsc -b --noEmit -> clean.
             bunx convex dev --once -> Convex functions ready.
             bun run lint -> 3 errors / 19 warnings, unchanged. Zero new.
             bun scripts/spec-drift.ts -> 17 pass, 1 warn, 0 fail.
Acceptance criteria, checked one by one:
  v1 features bit-identical on a 40-case fixture — PASS. The fixture is exactly
    40 cases, spans all three priorities, five deadline positions, four ages and
    two tag arrangements, runs against both a cold and a fully-trained behaviour
    profile, and asserts Object.is() equality on indices 0–7 against a call with
    every 1.1 input explicitly absent. That second call is the case that
    matters: it is what every vector stored before 1.1 looks like.
  below 12 samples ranking equals the prior — PASS, by construction. The learned
    term is multiplied by zero, so severity *is* the prior. Tested at 0, 1 and
    11 samples under a hostile weight vector, and the converse is also tested
    so the test cannot pass against a ranker that simply ignores the model.
  below 5 samples dismissal is recorded but not trained — PASS. The gate is
    `shouldTrainDismissal`; there is deliberately no partial update.
  snooze provably never produces label 0 — PASS. `attentionSnoozed` contains no
    call to the training path at all, and a test reads the source to prove it,
    because this is the invariant most likely to be broken by a well-meaning
    later change.
  no-feedback produces zero weight updates — PASS, verified live by reading the
    feed five times and comparing the stored weight vector and sample count.
  every section surfaces >=1 explore item — PASS for every section that has
    something to cut. A section with no overflow spends nothing, and a section
    containing only hard items has nothing to explore, because its ordering is
    already deterministic. Both cases are tested explicitly.
  rejecting a tax item 5x does not remove a hard-rule deadline — PASS, live:
    five acts on a statutory deadline move no weight, a rejection writes no
    suppression, and the deadline is still on the feed afterwards.
  activity powers the 7-day chart — PASS. `completeTask` now appends a
    `task.completed` activity row, and the chart reads `activity` over a
    `by_space_at` range instead of re-scanning every task's `completedAt`. The
    behavioural difference is real: a task completed and then cleared by
    "clear completed" used to vanish from the chart even though it happened.
Defects found and fixed by this phase (D22, D23, D24):
  D22  Escalation reused the *ranking* severity. Because that number reaches
       0.93 for anything due within about six hours, ordinary scheduled work
       silently became level 2 — undismissable. Found by the phase's own
       fixture. A ranked item is now capped at 0.85 for escalation purposes,
       which is the honest statement of the real boundary: the hard rules own
       the four-hour window, so a ranked item never earns level 2 by scoring
       highly.
  D23  `tanh(Number.NaN)` returned -1. A NaN score would have become "strongly
       dislike", which is worse than the NaN that caused it. It now returns 0,
       meaning "no opinion" — the same reasoning as defect D16.
  D24  The 1.0 conformance harness measured the Today cap with ranked work
       after a category rejection had muted that kind, so it was measuring
       suppression and reporting it as a cap failure. It now floods with
       *overdue* work, which cannot be suppressed at all, making it a pure cap
       test. A harness bug, not a product bug — but it was failing for the
       wrong reason, which is the kind of thing worth fixing rather than
       re-running until it went green.
Risks:      A client that lies about `kind` in its feedback can mis-train its
            own model. It cannot leak data, cannot suppress a hard rule, and
            cannot escalate anything: the class is decided server-side from
            `HARD_KINDS`, and escalation is recomputed from the clock. Recorded
            rather than defended against, because defending it would mean
            trusting the client less than the cost of storing every computed
            item (ADR-003).
            `getAttention` now reads three collections the pipeline needs
            (model state, flags, feedback) instead of two. Bounded and indexed;
            the per-section budgets from 1.0 still bound what comes out.
Decision:    The `generalisedRanking` feature flag — reserved by 0C with the
            comment "off until phase 1.1 ships them" — now defaults to on and
            is a real switch rather than a label. Turning it off does not hide
            ordinary work; it feeds the ranker zero evidence, so the feed falls
            back to the deterministic prior. A user who does not want a model
            steering their day still gets their day, just not personalised.
Related ADR: ADR-003, ADR-004, ADR-005, ADR-006, ADR-010, ADR-015, ADR-016,
            ADR-019, ADR-021
```

---

## CHANGE-0011

```
Date:       2026-10-01
Phase:      1.5 — Integration framework
Type:       feature
Severity:   MAJOR
Summary:    Panel now has one provider-agnostic path for connected tools: a
            registry that answers the nine lifecycle questions for every
            provider, an adapter contract, a single idempotent writer
            (`applyBatch`), and a credential store that cannot be read by any
            client function. No provider is wired up yet — that is phase 2 —
            so `connected` is still Unknown everywhere.
Why:        Phase 0B could only record that a user *wanted* a tool. Every
            provider would otherwise have needed its own mutation, its own
            idempotency logic and its own token handling, which is exactly the
            shape ADR-012 and ADR-014 exist to prevent.
Previous:    `connectTool` wrote a `pending-credentials` row and stopped. There
            was no token storage, no cursor, no sync writer, and no scope
            enforcement anywhere.
New:        `src/lib/integrations/*` (the provider-agnostic contract),
            `src/convex/credentials.ts` (the credential boundary),
            `src/convex/integrations.ts` (the one writer), three tables, and a
            scope allowlist that replaces the denylist approach.
Files:      New (7 of the 7-file budget, exactly): src/lib/integrations/types.ts,
             src/lib/integrations/batch.ts, src/lib/integrations/registry.ts,
             src/lib/integrations/integrations.test.ts,
             src/convex/credentials.ts, src/convex/integrations.ts,
             scripts/conformance-1.5.ts.
             Modified (2, no budget cost): src/convex/schema.ts (three tables,
             three `expenses` columns, one index), scripts/spec-drift.ts (the
             credential-containment check).
Schema:     3 new tables as budgeted: `connectionTokens` (one row per
             space+provider; the provider's blob never leaves the server),
             `syncCursors` (opaque continuation token plus `lastSyncedAt`,
             `runs` and a stable `lastErrorCode`), `oauthStates` (hashed state,
             hashed PKCE verifier, single-use, 10-minute TTL).
             `expenses` gained **optional** `externalId`, `provider` and
             `upstreamChangedAt` plus a `by_space_externalId` index. Optional,
             so every hand-entered expense stays valid and no migration was
             required — the same reasoning as the 1.1 counters.
Deps:       0. No HTTP client, no OAuth library: `fetch` is in Convex's
             runtime, and a dependency here would have been one more thing to
             audit for the privilege ADR-014 cares about.
Abstraction: 1 — `NormalizedBatch` + `applyBatch`, one diff-then-patch writer
             that every adapter must go through. `diffBatch` is pure and lives
             in `src/lib`, so the write logic is testable without a database.
Code:       `credentials.ts` exports no Convex endpoint at all. It is a module
            of plain async helpers taking a `ctx`, so there is no public
            function that could return a token even by accident. That is
            ADR-014's containment expressed as a module boundary rather than a
            comment, and `scripts/spec-drift.ts` now *checks* it: it greps
            every public function in `src/convex` for a reference to
            `connectionTokens` or `oauthStates` and fails if any file other
            than `credentials.ts` mentions them.
            `beginConnect` returns a `state` and a `codeChallenge`. The verifier
            is hashed with SHA-256 before it is stored and is never returned; a
            unit test greps the source of `beginConnect` and fails if a verifier
            can reach the response, because that is the one leak that would
            defeat PKCE entirely.
            `consumeState` refuses a state that is expired, already used, or
            bound to a different user. Authorisation codes are replayable by
            design, so single-use is enforced on our side.
            `applyBatch` diffs before it writes. A replayed sync creates
            nothing, patches nothing, deletes nothing and reports every object
            as `unchanged`. Deletion only happens when the adapter says the page
            was **complete** — an incomplete page deletes nothing, so a
            truncated response cannot empty a user's data.
            A normalised kind with no table behind it *refuses* rather than
            silently dropping rows: `insertObject` accepts `expense` today and
            throws a named error for anything else. Dropping would have made a
            half-wired adapter look like a working one.
Tests:      bun test -> 234 pass, 0 fail (21 new 1.5 fixtures).
             bun scripts/conformance-1.5.ts <url> -> 41/41 held live.
             bun scripts/conformance-0b.ts, conformance-0c.ts,
             conformance-attention.ts, conformance-1.1.ts -> all still pass
             live; the OCC suite (ADR-022) was re-run this phase because 1.1
             changed `recordOutcome`: 3 rounds x 8 concurrent mutations, 48
             total, zero duplicates, negative control able to see a duplicate.
             bunx convex dev --once -> Convex functions ready.
             bunx tsc -b --noEmit -> clean.
             bun run lint -> 3 errors / 19 warnings, unchanged. Zero new.
             bun scripts/spec-drift.ts -> 18 pass, 1 warn, 0 fail (a new
             credential-containment check; the other 17 are unchanged).
Acceptance criteria, checked one by one:
  every provider answers all nine lifecycle questions -> PASS. `IntegrationDef`
    makes the nine questions required fields, so a provider that skips one is a
    type error rather than an omission discovered in production. Google
    Calendar, Nylas and Plaid are registered and each is validated at module
    load.
  no credential can be returned to a client -> PASS, twice over. `credentials.ts`
    exports no endpoint, and the live harness asserts `hasCredentials` is a
    boolean that reports presence, never the value.
  state is single-use -> PASS live. A replayed callback reaches the same refusal
    as a forged one.
  replaying a batch writes nothing -> PASS live. Two syncs of the same page
    produce two rows and then zero writes on the second pass.
  a partial page cannot delete -> PASS live. An incomplete page deletes 0; a
    complete page deletes exactly what upstream no longer has.
  an unsupported kind refuses -> PASS, by unit fixture.
  tenant isolation -> PASS live. A second user sees an empty registry and no
    credentials for any provider.
Defects found and fixed by this phase (D26, D27, D28, D29):
  D26  `getUserIdentity().subject` is a composite `"<issuer>|<token>"` string,
       not a Convex id. Casting it produced a value that passed the type checker
       and then failed schema validation on `spaces.createdBy` — the sort of
       defect that only appears under `schemaValidation: true`. The correct
       call is `getAuthUserId` from `@convex-dev/auth/server`.
  D27  Scope enforcement was a denylist of mutating words (`write`, `modify`,
       `delete`, …). Google's `calendar.events` grants write access and contains
       none of them, so a genuinely mutating scope passed. An allowlist of
       known-read-only scopes and read-only suffixes (`readonly`, `read_only`,
       `read`, `read:only`, `.ro`) now fails closed: an unrecognised scope is
       refused, not assumed safe.
  D28  Provider-supplied expense categories were cast to the closed
       `expenseBucket` union. Any value from a non-Panel provider would have
       been a schema-validation failure at write time — a crash caused by
       someone else's data. `narrow()` maps to the closed vocabulary with an
       explicit `Uncategorised` bucket and `medium` confidence instead.
  D29  The ADR-022 OCC conformance suite's negative control seeded a state row
       into a user that had none, so it wrote the *first* row and then asserted
       two. It was reporting a failure against a detector that had nothing to
       detect. Fixed by creating a real state row before seeding the duplicate;
       the control now passes and means something. A test that cannot fail is
       not evidence, and neither is one that cannot pass.
Risks:      A provider adapter that lies about `scope` cannot be stopped at
            Panel's boundary; `assertScope` checks what the registry *declares*,
            not what the provider actually granted. The mitigation is
            structural: only read-only scopes are ever declared, and the token
            is never used to write.
            `syncCursors.lastErrorCode` stores a stable code from a closed
            vocabulary, never a provider response body, so a provider cannot get
            its own error text into our database or into a screenshot.
Deferred:   `Areas.tsx` still calls the 0A-era `connectTool`, which records
            intent as `pending-credentials` and stops. That is deliberate for
            1.5 — the real flow needs a redirect and credentials, which arrive in
            phase 2 — and it is replaced, not extended, there. Until then no UI
            can report a provider as connected, which is the honest answer.
Decision:    `hasCredentials` (does a token exist) is reported to the client and
            the token itself is not. A self-audit was written and then removed:
            it had begun mutating `connectionTokens` from a public query to
            keep the flag honest, which is precisely the capability the module
            boundary exists to prevent. The flag is derived from the row's
            existence at read time, and nothing about it is worth reopening the
            boundary for.
Related ADR: ADR-012, ADR-013, ADR-014, ADR-016, ADR-019, ADR-022
```

---

## CHANGE-0012

```
Date:       2026-10-01
Phase:      2 — Google Calendar
Type:       feature
Severity:   MAJOR
Summary:    Panel now has one real connected tool. The OAuth handshake is real
            (PKCE, single-use state, the verifier confined to the server), the
            sync is real (paged, idempotent, diff-then-patch), and the
            minimisation is real — a private event is stored as the literal
            "Busy" and its title is never read, let alone written. Meetings
            inside four hours are hard attention items that no amount of
            personalisation can hide.
Why:        Phase 1.5 built the framework and refused every connect attempt,
            which was correct but finished. The product thesis — one operating
            layer over the tools a person already uses — does not exist until
            one of those tools is actually connected.
Previous:    `connectTool` recorded intent as `pending-credentials` and stopped.
            There was no callback, no sync, no calendar, and no dashboard block.
New:        `src/lib/integrations/google-calendar.ts` (the adapter),
            `src/convex/calendar.ts` (the redirect, the sync, the read model),
            `src/components/CalendarStrip.tsx` (the dashboard block), the
            `calendarEvents` table, and §7.2's deletion semantics in the writer.
Files:      New (5 of the 5-file budget, exactly): src/lib/integrations/
             google-calendar.ts, src/lib/integrations/google-calendar.test.ts,
             src/convex/calendar.ts, scripts/conformance-2.ts,
             src/components/CalendarStrip.tsx.
             Modified (9, no budget cost): src/convex/{schema,credentials,
             integrations,http,attention}.ts, src/lib/integrations/types.ts,
             src/lib/attention/{rules,sources}.ts, src/pages/Dashboard.tsx,
             src/lib/{attention/learned.test,integrations/integrations.test}.ts,
             scripts/{spec-drift,conformance-1.5}.ts.
Schema:     1 new table as budgeted: `calendarEvents`. Its column list *is* the
             minimisation policy — there is nowhere to put an attendee list, a
             description, a location or a dial-in, because no such column exists.
             One schema change to an existing table: `oauthStates.verifierHash`
             is replaced by `oauthStates.verifier` (see D30), with the old
             column retained as optional so the deployment can be pushed without
             a data migration.
Deps:       0. `fetch` is in the runtime; a client library would have been one
             more thing to audit for the privilege ADR-014 cares about.
Abstraction: 0 new, with one judgement call recorded rather than hidden. The
             writer body was *extracted* from `applyBatch` into
             `writeNormalizedBatch` so a sync action and the public mutation
             share one implementation — the alternative was a second writer, and
             "the public path and the sync path disagree about idempotency" is
             exactly the failure ADR-012 exists to prevent. `Adapter` gained a
             method (`authorizationRequest`); `sources.ts` gained a predicate
             (`calendarSuppressed`). No new concept, no new layer, one write path.
Code:       The handshake is split across three function kinds, and that split is
            forced rather than stylistic: an httpAction receives the redirect,
            an action performs the token exchange (only an action may use the
            network), and an internal mutation consumes the state and stores the
            tokens (only a mutation can make single-use atomic). Phase 1.5 had
            this as one mutation, which could never have worked — see D30.
            The state is read before the exchange and redeemed after it, so the
            verifier survives the one window in which it is needed and the row
            holding it is *deleted* on redemption.
            Minimisation is an allowlist in the mapper, not a filter: the adapter
            never reads `description`, `attendees`, `location`,
            `conferenceData`, `organizer`, `reminders`, `recurrence` or
            `extendedProperties`, so there is no code path by which they could be
            stored. A unit fixture serialises a hostile payload and asserts none
            of those strings appears.
            A private event becomes `"Busy"` in the adapter — before the title
            ever exists as a string Panel could write. Not hidden in the UI, not
            encrypted at rest: absent.
            Recurring series are expanded by Google (`singleEvents=true`) and each
            instance carries its own stable id, so a weekly standup is one row per
            occurrence and Panel never sees the recurrence rule at all.
Tests:      bun test -> 250 pass, 0 fail (16 new phase-2 fixtures, plus one
             hardened containment fixture).
             bun scripts/conformance-2.ts <url> -> 33 invariants held live, with
             1 reported as not-applicable (see "Blocked" below).
             bun scripts/conformance-1.5.ts -> 35/35 (its OAuth section rewritten
             for phase 2; its "a kind with no table refuses" now uses `task`,
             since calendarEvent gained a table).
             conformance-0b, conformance-0c, conformance-attention,
             conformance-1.1 -> all still pass live.
             bunx convex dev --once -> Convex functions ready.
             bunx tsc -b --noEmit -> clean.
             bun run lint -> 3 errors / 19 warnings, unchanged. Zero new.
             bun scripts/spec-drift.ts -> 18 pass, 1 warn, 0 fail.
Acceptance criteria, checked one by one:
  calendar.readonly only; registry rejects a mutating scope -> PASS, live and in
    the registry. The registry asserts it at module load, so an entry that asked
    for `calendar.events` would fail the build rather than the user.
  a private event is stored as "Busy" and the title exists nowhere -> PASS, in
    three independent places: the adapter fixture (the title is never read), the
    schema (there is no column that could hold one), and the live read model
    (no field of the response contains it).
  recurring masters stored once; instances not duplicated -> PASS. Provider-side
    expansion, one row per instance, keyed by the instance id. Asserted by the
    replay check: the same instance applied twice writes nothing.
  upstream deletion marks cancelled / orphanedSource, never deletes a user task
    -> PASS, live. A sweep that removes every event reports `deletes: 1` for the
    one that had already happened and `cancelled: 3` for the three still ahead.
  stale >48h banners; >7d suppresses from Attention -> PASS. The banner is in the
    dashboard block; the suppression is server-side in `getAttention`, so a
    week-old calendar contributes no items at all.
  disconnect -> reconnect -> full resync produces no duplicates -> PASS in
    principle by construction (the cursor resets to null on both disconnect and
    connect, and the writer is idempotent); the live half is blocked, see below.
  manual end-to-end: connect, see a real meeting -> BLOCKED. See "Blocked".
Defects found and fixed by this phase (D30, D31, D32, D33):
  D30  `finishConnect` was a **mutation** that called `adapter.exchangeCode`.
       The exchange performs `fetch`, and a Convex mutation is required to be
       deterministic, so the documented OAuth completion path could never have
       run at all. It survived a full phase because nothing could call it: with
       no adapter registered it threw before reaching the network. Found by
       writing the real flow, which is the only way to find this class of defect.
       Replaced by the httpAction + internal mutation split above.
  D31  `markDerivedOrphaned` tested `task.orphanedSource === false`, which is
       almost never true — the column is optional and `addTask` never sets it to
       `false`. The flag §7.2 names was, in practice, never set on anything. Now
       `task.origin === "integration" && task.orphanedSource !== true`.
  D32  **This deployment serves no application HTTP routes.** Every path 404s,
       including Convex Auth's own OIDC discovery endpoint and
       `auth.addHttpRoutes`' own routes, which have been in the template since
       day one; `/` and `/version` answer because they are Convex's own built-ins.
       The push succeeds and Convex *validates* the router (a deliberately broken
       handler is rejected with "is not an HttpAction"), so the module is
       deployed — the backend simply does not serve it. Not caused by phase 2 and
       not fixable from here. Consequence: the OAuth redirect cannot be exercised
       live, so both conformance harnesses report that section as `[SKIP]` with
       the reason, rather than as a pass. The unit fixtures cover the handler's
       decision logic; the transport is the part that cannot be checked here.
  D33  `applyBatch` reported `deletes` as the *diff's* count of removals, which
       includes rows that were kept and flagged `cancelled`. A caller reading
       "3 deleted" when one row survived was being told a small lie that makes a
       sync log untrustworthy. The counts now separate `deletes` (rows actually
       removed) from `cancelled` (rows kept and flagged). Found by the phase-2
       harness, which was written expecting the honest number.
Risks:      `singleEvents=true` means an upstream edit to a series can change an
            instance's id. The old row then arrives as an *absence*, which §7.2
            handles: deleted if it has happened, cancelled if it has not. There is
            a brief window in which both the old and new instance exist, and the
            old one shows as cancelled rather than disappearing.
            A token whose provider-side expiry has passed will not be refreshed:
            the adapter reads the access token and does not yet implement a
            refresh-token exchange. A revoked or expired token surfaces as
            `auth_revoked` with `reconnectRequired`, which is honest but is a
            worse experience than refreshing silently. Scheduled: the first thing
            after the handshake can be exercised live.
Blocked:    Two things, and only two.
            (a) GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set, so the
                handshake cannot be completed. The user adds them in the Keys tab;
                the adapter refuses with `not_configured` until they exist, and the
                dashboard says why rather than offering a button that cannot work.
            (b) D32 — even with credentials, this deployment cannot receive the
                redirect. Both are environment, not code.
            Everything else in phase 2 is built and verified live.
Decision:    A meeting inside the four-hour window is added to `HARD_KINDS` as
            `calendar.imminent`. That is an extension of ADR-006's principle
            rather than a new decision: someone who can dismiss it, or train a
            model to bury it, will eventually do so, and "I am in a meeting in
            twenty minutes" is not a preference. Verified live — the harness acts
            on one and the weight vector does not move.
            A new user with no connection sees a disabled button and one sentence
            explaining that Google credentials are missing. Shipping a connect
            button that always fails would have been worse than shipping none.
Related ADR: ADR-006, ADR-012, ADR-013, ADR-014, ADR-016, ADR-019
```

---

## CHANGE-0013

```
Date:       2026-10-01
Phase:      3, feature 1 — People as first-class objects
Type:       feature
Severity:   MAJOR
Summary:    A person is a row, not a string in a task title. Merging two
            people rewrites nothing — it sets a tombstone pointer — which is
            what makes unmerge exact rather than approximate, and it means no
            move can half-run because no move exists. Identity is a set of
            normalised keys, and sharing one is evidence the user acts on rather
            than a merge Panel takes. Nothing merges automatically, ever.
            Building it also exposed D34: two features in the frozen scorer
            layout had never received a single piece of evidence, and no
            existing test could have noticed.
```

Phase:        3, feature 1 — People as first-class objects.
Status:       **VERIFIED.**
Date:         2026-10-01.
Scope block:  SYSTEM_FUNDAMENTALS §11.2 (People). APPROVED in PRODUCT_CONTEXT
              (`People as first-class objects | APPROVED | 3`), under the
              standing roadmap approval of 2026-10-01.

Problem:      `PeopleArea` stored the string `"catch up with mum every week"`
              in `tasks.title`. A person was therefore not an object: it could
              not be linked, shared, reasoned about, or kept, and two captures
              of the same person produced two unrelated strings. The panel was
              lying about its own data model.

Files:        4 new · 4 edited · 1 table · 0 deps · 1 abstraction.
              (`src/lib/people.ts`, `src/lib/people.test.ts`,
              `src/convex/people.ts`, `scripts/conformance-3.ts`; plus
              `src/convex/schema.ts`, `src/convex/assistant.ts`,
              `src/convex/model.ts`, `src/components/Areas.tsx`.)
              Budget was 6 files / 1 table / 0 deps / 1 abstraction
              (SYSTEM_FUNDAMENTALS §11.2). **4 of 6 files used.** The one
              abstraction is the identity-key matcher, as budgeted.

Decisions:    D34, D35, D36, plus ADR-023 and ADR-024.
Tests:        28 new unit fixtures (`src/lib/people.test.ts`), 50 live
              conformance invariants (`scripts/conformance-3.ts`, 0 skips).
Related ADR:  ADR-007, ADR-009, ADR-010, ADR-016, ADR-021, ADR-023, ADR-024

### What was built

A `people` table and the surface that uses it.

- **`src/lib/people.ts`** — the only new abstraction, and the only file in
  this feature that contains a decision. Identity keys are normalised
  strings that are individually meaningful evidence; nothing in it can merge
  anything and it calls no mutation.
- **`src/convex/people.ts`** — `listPeople`, `getPerson`, `createPerson`,
  `updatePerson`, `mergePeople`, `unmergePerson`. Every read and write is
  scoped by the caller's own `ownerUserId`, which is never an argument.
- **`src/components/Areas.tsx`** — `PeopleArea` was a fake: it called
  `addTask({ input: "catch up with X every week" })`. It is now a real panel
  (add, duplicate-refusal, linked work, merge, unmerge). `TasksArea` also
  gained an optional "about" picker, so a person can be linked from any
  area's composer rather than only from the People panel.

### The decision that shapes the feature (ADR-023)

**A merge rewrites nothing.** `mergePeople` sets `mergedIntoId` on the source
row and stops. It does not move tasks, does not copy identity keys, does not
rewrite links. Every read resolves through the tombstone instead.

That is what makes unmerge *exact*. There is no restoration step that could
half-run, because nothing was ever moved: unmerging clears two fields and
every task, link and counter is exactly where it was. A merge implemented as
"move the children" needs a journal in order to be reversible; this one does
not, and the conformance harness proves the property rather than asserting it
— it merges, unmerges, and compares the row count, the row identities, the
display name, the link count and the identity keys either side.

### The decision the feature refuses to make (RJD-004)

Nothing merges automatically, ever. `createPerson` *refuses* a probable
duplicate and names the row it had in mind, unless the user passes `force`.
Refusing is not merging: it declines to create a second row, it changes
nothing, and the user can always insist. In the UI this reads as "Same name —
check these are the same person" with two buttons, not a warning the user has
to dismiss.

`judgeMatch` is deliberately asymmetric: a shared **email** clears the bar on
its own, a shared **name** only ever produces a suggestion. An address is
something a person owns; a name is something they are called, and "Raj" is not
a person.

### Defects found and fixed by this phase

D34 — **Two frozen features could never receive evidence.**
`recordOutcome` declared its `task` parameter as
`{ ..., source?: string; person?: string }` and was called with the raw
database row, whose fields are `origin` and `personId`. Both properties are
optional, so nothing failed to compile and nothing threw: the roll-ups saw
`undefined` on every single call and returned the counter map unchanged.
`SOURCE_FIT` (index 9) and `PEOPLE_FIT` (index 10) were therefore
permanently 0 — not merely under-trained, but *identically* zero at training
time and at inference time, so their weights could never receive a gradient
and never moved from their initial values. Two slots in a frozen, versioned
feature layout were carrying no information at all, and nothing in any
harness would have reported it: every existing test asserted that the
*mechanism* worked, and the mechanism was working perfectly on an input that
was always empty.

Found by `scripts/conformance-3.ts` asserting acceptance criterion 5
("PEOPLE_FIT reads the person id") against a live deployment and finding an
empty counter map where evidence should have been.

Fixed by deriving the feature object once, in `featuresOf()`, and handing *the
same object* to both halves of the step. `recordOutcome` now takes
`TaskFeatures`, so a field rename is a compile error rather than a silent
zero. The feature layout is untouched: indices 0–7 are unchanged, 8–11 keep
their meanings, `FEATURE_COUNT` is still 12 and `WEIGHTS_VERSION` is still 1.
Nothing migrates. Users' stored weights for indices 9 and 10 are still their
initial values, which is exactly what the previous behaviour implied, so no
vector is re-based and no ranking shifts retroactively. Counters begin filling
from the next completion.

D35 — **`normaliseKey` was the wrong function for an email address.**
Applied to `raj@ex.co.uk` it produced `raj ex co uk`, because punctuation
becomes a space. That is wrong twice over: it reads as nonsense, and
`email:raj ex co uk` collides with the key a *name* of "raj ex co uk" would
produce under a different namespace. An address is a single token with
meaningful separators, not a phrase, so `normaliseEmailKey` now keeps
`@ . - _ +` and drops only what cannot appear in an address. Found by the unit
fixtures, written before the normaliser had been thought about properly.

Two related behaviours were corrected at the same time, both now pinned by
fixtures. Punctuation folding is *conservative*: "O'Brien" and "OBrien" stay
different keys, and "Jean Luc" stays different from "Jeanluc". The docstring
claimed the opposite, and the code was right. Under-matching costs a second
row a human can merge by hand; over-matching costs a merge that was never
right, and given RJD-004 the conservative direction is the correct one to fail
in.

D36 — **A recurring task lost its person on respawn.**
`spawnNextOccurrence` rebuilt the row field by field and did not copy
`personId`, so completing "call Raj every week" produced a follow-up
belonging to nobody — the exact failure REQ-017 exists to prevent, reproduced
for a new field. Copying an id forward is safe here in a way copying identity
keys would not be: a tombstone resolved on read still reaches the same person.

### Acceptance criteria (§11.2)

**(1) A capture naming a known person links to that row rather than creating
a second — PASS, live.** The harness creates a task with `personId` and reads
it back through `getPerson`, then confirms the linkage survives a merge and
returns on unmerge.

**(2) Two rows with the same normalised name stay separate until the user
merges them — PASS, live.** "Raj Patel" and "raj  patel" normalise
identically. The second is REFUSED, which is the first half of the guarantee:
the list still holds one row. It is created only on `force`. Three namesakes
then coexist, and the shared name appears as a `matchHint` on each rather than
as a mutation. No row was combined with any other at any point.

**(3) Merge is reversible: unmerge restores both rows and every link — PASS,
live.** Row count, row identities, display name, link count on the survivor,
and the identity keys are all compared either side and identical.

**(4) A merged row is a tombstone that no query returns — PASS, live.**
`listPeople` omits it and reports `mergedCount`; `getPerson` on the tombstone
returns the person who absorbed it, with the absorbed work reachable; the
survivor is told what was merged into it.

**(5) `PEOPLE_FIT` reads the person id, so two namesakes do not share
evidence — PASS, live.** This is the check that found D34. Three people share
the name "Raj Patel"; two linked completions against one of them produce
exactly one row of evidence, keyed by that person's id.

**(6) Live conformance: merge → unmerge leaves the row count and the link
count exactly as they were — PASS, live.**

### Additional verification

    28 unit fixtures (src/lib/people.test.ts) ... PASS, 278 total, 0 fail
      normaliseKey / normaliseEmailKey folding, and the spellings each keeps apart
      identityKeysFor namespacing, omission of a bogus email, boundedness
      judgeMatch: email clears the bar, name only advises (RJD-004)
      resolvedIdentityKeys: tombstone chains, multi-hop, cycles, dangling targets
      describeKey: machine strings never reach the screen raw

    50 live conformance invariants ............ PASS, 0 skipped
      cross-user isolation: a second account's list is empty, a foreign id reads
        as null, a foreign area is empty, and all four write paths refuse
      a person cannot be merged into themselves, or merged twice
      unmerging somebody who is not merged says so rather than pretending

    ADR-022 / N1 re-verified .................. PASS
      `recordOutcome` writes `assistantState`, so the OCC invariant was re-armed
      and re-run rather than assumed: 3 rounds x 8 concurrent mutations, 48
      mutations, one row per user in every round, negative control able to see a
      deliberate duplicate. Cumulative 1,840 mutations / 39 rounds / 0 duplicates.
      The fixture was removed again and the exports reverted.

    lint ........................ 3 errors / 19 warnings, all pre-existing
                                  (carousel, sidebar, use-mobile). No new problems.
    spec-drift ................... 18 passed, 0 failures, 1 warning (pre-existing:
                                  two planned paths that do not exist yet).

### A note on what was deliberately not built

- **No `deletePerson`.** A destructive path that did not exist before is not a
  safe improvement, and deletion is not in this feature's scope. The
  conformance fixture rows are inert and owner-scoped, and every run uses a
  fresh throwaway account.
- **No automatic merge, ever.** RJD-004, and the roadmap's own must-nots.
- **No contact import, no inbound email parsing, nothing that writes to a
  provider.** All named as out of scope in §11.2.
- **No person sharing.** A person is owner-scoped. Sharing a person is not a
  capability Panel has; adding one later means adding a grant check, rather
  than loosening what is here.

### A finding worth recording separately

The S3 check in the phase-3 harness was written to compare the refusal for
"this id is not yours" with the refusal for "this id does not exist". It could
not be run: **no client can construct a person id that is well-formed but
absent.** Convex ids carry an integrity check, so every variant of a real id a
client can produce is rejected by the argument validator before any handler
runs. Rather than skip the check, the harness now asserts that stronger
property — if a future platform version ever lets such an id through, the
check turns to FAIL and someone examines whether `owned()` still answers both
cases identically. As written, `owned()` throws one message for both.

---

## CHANGE-0014

```
Date:       2026-10-01
Phase:      3, feature 2 — Multi-object Capture
Type:       feature
Severity:   MINOR
Summary:    One capture can now produce several tasks. It splits on explicit
            structure only — a new line, a semicolon, or "and then" — and
            never on a bare conjunction, because "call the dentist and book
            the dentist" is one task and splitting it would destroy a correct
            object and invent a wrong one, silently. The composer shows every
            task before you commit to any of them, and the server re-plans the
            whole capture so the preview and the record cannot disagree.
```

Phase:        3, feature 2 — Multi-object Capture.
Status:       **VERIFIED.**
Scope block:  SYSTEM_FUNDAMENTALS §11.2 (Multi-object Capture).

Problem:      `parseTaskInput` returns exactly one `ParsedTask`. A user
              thinking in lists — "call the dentist, renew the passport, email
              Raj" — had to capture three times, and the first two landed in
              one title with the separators still in it. Capture is the
              product's front door and it was making the user do Panel's
              segmentation work.

Files:        2 new · 3 edited · **0 new tables** · 0 deps · 1 abstraction.
              (`src/lib/capture.ts`, `src/lib/capture.test.ts`,
              `scripts/conformance-4.ts`; plus `src/convex/assistant.ts`,
              `src/pages/Dashboard.tsx`, `src/convex/schema.ts` for the
              multi-line composer.)
              Budget was 4 files / 0 tables / 0 deps / 1 abstraction
              (SYSTEM_FUNDAMENTALS §11.2). **2 of 4 files used, 0 of 0 tables,
              1 of 1 abstraction.** Zero new tables was the load-bearing
              constraint: a capture feature that needed a table would be a
              different feature.

Decisions:    D38 (partially), plus the scope block's answers to three
              questions the roadmap had left open.
Tests:        43 new unit fixtures, 51 live conformance invariants, 0 skips.
Related ADR:  ADR-001, ADR-002, ADR-004, ADR-006, ADR-010, ADR-019,
              ADR-021, ADR-023, **ADR-024**

### The decision that shapes the feature

**Only explicit structure separates objects. A bare "and" never does.**

This is not timidity, and it was not decided by preference. The evidence is in
R-004: mature products reach the same place by a different route (Todoist
separates everything with explicit symbols — `%label`, `p1`, `!14:00`,
`#Project` — and gets multi-task capture from *text/image/document* input, not
prose splitting), multi-intent detection is an open research problem rather
than a solved parsing step, and the failure is asymmetric. Failing to split
costs a user three lines of typing. Splitting wrongly costs them data they did
not know they had lost.

The consequence is stated in the product as well as the code, because a user
who does not know the rule will hit it: the composer says *"A plain 'and' stays
part of the task."*

### Confidence is about segmentation, not comprehension

The parser's closed vocabulary already answers "what is a task". The genuinely
new question is only "one thing, or several". So confidence measures the
*split*:

- **high** — the user stated a separator. Create it.
- **medium** — no separator anywhere, so the whole capture is one task. Create
  it, and say so: *"No separator found, so this is one task."*
- **low** — refused. Nothing is created, and the reason travels back.

The low-confidence rule is the one that matters: nothing is ever created that
Panel is not sure about, and the refusal is explained rather than silent.

### What is deliberately not built

- **No commitments, documents, expenses or notes.** Each is a separate approved
  phase-3 feature with its own table and budget, or already has a dedicated
  tested create path. A `commitments` table does not exist, and creating it
  here would have spent Feature 3's budget without its spec.
- **No person is created from a capture, and none is ever merged.** A name
  Panel does not recognise stays as words in the title. ADR-024 and RJD-004
  are unchanged, and the harness checks that the people count does not move.
- **No prose-conjunction splitting, no fuzzy matching, no LLM** (ADR-001).
- **No new feature index.** `FEATURE_COUNT` is still 12, `WEIGHTS_VERSION` is
  still 1, indices 0–7 are untouched.

### Defects found and fixed

```
D38 (partially resolved)  `capture.committed` was declared in the closed
     activity taxonomy since phase 0B and written by nothing. A feature that
     creates several objects must be auditable, so the kind is now genuinely
     written — once per accepted capture, carrying the real segment count — and
     read back by `assistant:captureAudit` so the claim is checkable rather
     than asserted. The four other unwritten kinds are left alone deliberately
     and the reasoning is recorded in the defect register.

D39  `captureAudit` shipped a table-wide `.collect()` on its first draft: it
     read `activity` across every space in the deployment and filtered the
     caller's own in JavaScript. That is exactly the defect class phase 3
     feature 1 audited for and recorded as D37, reintroduced one feature later
     by the same agent. Caught in self-review by the performance pass, not by
     a test. Now one indexed range per space, bounded at 500 rows.
```

### Self-review — three bugs the tests caught before review did

Recorded because a feature that only finds its own bugs in review is not being
tested hard enough.

1. **`labelSegments` attributed the wrong separator, and missed one.** It
   split newline-first and then refused to re-split its own output, so
   `"call the dentist\nrenew the passport; email Raj"` kept the semicolon
   *inside* the second segment and silently produced two tasks where the user
   wrote three. Rewritten as a single pass over one combined pattern.
2. **Leading-person matching never fired.** The boundary check read
   `remainder[0]` *after* trimming, which had already deleted the very space it
   was testing for — so `"Raj Patel call the dentist"` matched nobody. It now
   reads the character before trimming, which is also what correctly rejects
   `"Raja"` against `"Raj"`.
3. **The cue-only drop rule was far too broad.** Keying on "the parsed title
   equals the segment text" also matched `"call the dentist"`, which has no cue
   to consume at all — the rule would have deleted real tasks. Narrowed to "the
   title is unchanged **and** a date or recurrence was produced", which
   distinguishes `"tomorrow"` from `"call the dentist"` without duplicating the
   parser's vocabulary.

Each is now pinned by a fixture that fails without the fix.

### Acceptance criteria (§11.2) — all PASS, live

```
AC-2-1  One capture with two separators produces three tasks, each parsed
         independently and correctly dated ............ PASS
AC-2-2  An input with no separator produces exactly one task, byte-identical
         to the single-task path ...................... PASS
         Checked against the *deployed* `addTask`, not against the parser. If
         the two paths ever diverged, every existing user's composer would
         have changed and nothing would have reported it.
AC-2-3  "call the dentist and book the dentist" produces ONE task .... PASS
         Plus "buy milk and eggs" and "pick up bread and jam from the shop",
         and the positive control that "and then" *does* split.
AC-2-4  An unusable segment is dropped AND reported, never silently ..... PASS
         Includes the whole-capture refusal, which creates nothing and
         returns a reason the UI can show.
AC-2-5  Every created task is owner-scoped, in the personal space, and
         invisible to a second account ................................. PASS
         A foreign `personId` is refused with the same message `addTask`
         uses, and a name the other account does not know links to nobody.
AC-2-6  `capture.committed` is written once per accepted capture, carrying
         the real segment count ............................. PASS
         Read back through a query, so a mutation that merely *returned* the
         count would not pass.
AC-2-7  The server is authoritative ...................................... PASS
         A client claiming two objects still gets one.
AC-2-8  Existing capture behaviour is unchanged; the learned model is
         untouched by authorship ............................. PASS
         `samples` 0 → 0 and the weight vector byte-identical across two
         multi-segment captures. See Q-006 for why that is the interim
         answer.
```

### Additional verification

```
43 unit fixtures (src/lib/capture.test.ts) ....... PASS, 321 total, 0 fail
51 live conformance invariants .................. PASS, 0 skipped

ADR-022 / N1 re-verified ......................... PASS (run G)
  `capture` writes no `assistantState` and calls no `recordOutcome`, and the
  feature-2 harness proves that live. But "the new code does not call it" is a
  claim about code, and ADR-022 requires the invariant to be *executed*. The
  suite was re-armed and re-run rather than inherited: 3 rounds x 8 concurrent
  mutations, 48 mutations, one row per user in every round, negative control
  able to see a deliberate duplicate. Cumulative 1,888 mutations / 42 rounds /
  0 duplicates. Fixture removed and exports reverted again.

The 21 pre-existing nlp.test.ts fixtures ....... PASS, unmodified
  Do-Not-Touch #7 — the token-consumption loop was not edited. The segmenter
  calls `parseTaskInput` and never touches its internals.

lint ........................ 3 errors / 19 warnings — the stock baseline
                                (carousel, sidebar, use-mobile). No new problems.
spec-drift ................... 18 passed, 0 failures, 1 warning.
```

### What the UI does now

The composer is a two-row textarea. Enter captures; Shift+Enter adds a line.
The preview lists **every** task the capture will produce, with each one's
priority, date, recurrence and tags — so the segmentation is visible before
anything is saved, and the user can fix a wrong split before it becomes data.
Dropped segments and overflow are surfaced as warnings, because a drop the user
cannot see is indistinguishable from a capture that worked.

## CHANGE-0015

```
Date:       2026-10-01
Phase:      3, feature 3 — Life Admin / expiry → renewal chain
Type:       feature
Severity:   ARCHITECTURE
Summary:    A document with an expiry date, and the renewal that keeps it
            valid. Panel stores metadata only — a label, an expiry, a lead
            time — and never the document. The deadline is the expiry minus a
            lead time, not the expiry: a passport valid for ten years has to be
            renewed roughly six months before it runs out, because carriers
            refuse entry on a short-validity passport (R-006, R-007). The
            lifecycle is derived, never stored as a status field (ADR-025), and
            the renewal is an ordinary task that points at the document
            (ADR-026), so it inherits the whole task lifecycle for free.
```

### Life Admin: a document that expires, and the renewal that keeps it valid

### What changed

Panel gained a **Life admin** area holding the things that expire — a passport,
a licence, an insurance policy, a vehicle registration — and the chain from
expiry to renewal to a new expiry.

The four things worth knowing before reading the code:

1. **A document is metadata, not a document.** A label, an expiry date and a
   lead time. No file, no image, no document number, no storage integration.
   R-007, ADR-025.
2. **The expiry date is not the deadline.** A US passport valid for ten years
   has a renewal deadline roughly six months earlier, because carriers refuse
   entry on a short-validity passport. The deadline Panel computes is
   `expiresAt − leadDays`. R-006.
3. **There is no status column.** Seven states, all derived from `expiresAt`,
   the linked renewal task and `now`. A stored status would be a *copy* of two
   other fields, and a copy is where they disagree without anything noticing.
   ADR-025.
4. **The renewal is an ordinary task.** `tasks.documentId` points at the
   document; the document holds no reference back. ADR-026, the same shape as
   `tasks.personId`.

### Why this and not a document manager

The roadmap line reads "Life Admin / documents". Read alone it looks like a
document manager, and that reading would have cost a storage model, an access
control list, a retention policy and an export path — none of which the problem
needs. Every failure mode here is *discovering too late that something
expired*. None of them is "I could not find the PDF".

### What the audit found before anything was designed

`taxDocuments` cannot absorb this feature, on four independent grounds: its
`requirementId` is a key into a closed static country catalogue and a passport
is in no such catalogue; `readinessScore` maps that id back to a catalogue
entry, so a non-catalogue row scores as nothing; `by_owner_requirement` permits
one row per requirement, so two passports could not coexist; and it would drag
a user domain object into Do-Not-Touch #1. It is untouched.

`toggleDocument` is a checklist toggle, not a document lifecycle operation, and
nothing depends on its shape beyond the Finance checklist. It is untouched.

`home` renders a generic task list and its own blurb is "Repairs, cleaning, and
the admin of running a place". A passport is not that, so widening `home` would
have misdescribed an area that is already correct. The feature adds one
`AreaSlug` to the **existing** tab list instead.

### Attention

One new hard kind, `document.expiring`, in the existing `deadlines` section.
Three anti-spam mechanisms, none of them new machinery: a document outside its
lead window emits nothing; a document with an open renewal emits nothing,
because the task already speaks — this is what stops one renewal producing two
items; and the existing budget of 4 caps the rest, with the overflow already
disclosed to the user by the pipeline.

It is a **hard** kind, so it is never scored, never personalised and never
suppressible. A model that learns to bury "your passport expires in eight days"
has learned the wrong thing.

### Learning

No new feature index and no new signal from authorship — creating a document is
authorship, the same reasoning that produced the Q-006 interim answer.
Completing a renewal is a genuine outcome and trains through the existing
`recordOutcome` path with no new plumbing, because the renewal is an ordinary
task. `FEATURE_COUNT` stays 12, `WEIGHTS_VERSION` stays 1, indices 0-7 untouched.

### Defects found and fixed

- **D40 — the `stale` rule was too narrow.** It fired only when the document
  had *already expired*, so the ordinary case went unreported: renewing early
  (which R-006 tells people to do), ticking the task off, and the expiry never
  moving, all read as ordinary progress. **Found by the live harness, not the
  unit suite** — every unit fixture for `stale` used an expired document, so
  the tests were satisfied by a rule that missed what users actually do. The rule
  is now stated as `expiry is not later than the completion`.
- **An N+1 in three places**, caught in self-review rather than under a test:
  `listDocuments`, `getExpiring` and the attention query each resolved renewal
  tasks once per document, worth up to 200 queries on a reactively-subscribed
  query — D37/D39 wearing a new hat. Fixed with one owner-scoped
  `by_owner_document` read grouped in JavaScript.
- **A schema-vocab false positive**, caught by the suite: a comment containing
  a quoted phrase was being parsed as a schema literal by the vocabulary test's
  regex. Reworded, with a note for the next editor.

### A boundary this feature does not cross

An **early** renewal whose expiry never moved is not reported as `stale`, and
cannot be: from `(expiresAt, completed task)` alone there is no way to
distinguish it from a real early renewal to a document valid for two years.
Detecting it would mean storing the previous expiry, which ADR-025 rules out
precisely so that no second copy of the date exists to disagree. The user
instead sees the completed renewal and the expiry side by side.

### Verification

37 unit fixtures and **93 live invariants**, 0 skips, against a real deployment.
All 11 acceptance criteria pass. `assistant.ts` changed — the completion
transition was extracted into `completeTask` so a renewal can train through the
same path as any checkbox — so ADR-022's OCC invariant was **re-armed and
re-run, not inherited**: run H, 48 concurrent mutations, 0 duplicates. The
temporary fixture module and the two `export` keywords were reverted afterwards.

Related ADR: ADR-006, ADR-009, ADR-010, ADR-015, ADR-016, ADR-019, ADR-021,
ADR-025, ADR-026
Related defects: D40
Budget: 4 of 4 new files · 1 of 1 new table · 0 deps · 1 abstraction

---

## CHANGE-0016

```
Date:       2026-10-01
Phase:      3, feature 4 — Commitments + Waiting On
Type:       feature
Severity:   ARCHITECTURE
Summary:    A promise the user made, and a wait the user is in — one object
            with a direction, not two systems. Panel records the user's
            assertion and never claims what another person did (ADR-027), the
            lifecycle is derived from (expectedAt, completed, now) rather than
            stored (ADR-025), and an inbound wait is deliberately *not* a task,
            because taskRules would report it overdue about something the user
            cannot do. This is also the feature that finally gives the
            `waitingOn` attention section a producer: it has been a declared
            section with no writer since phase 1.0.
```

### Commitments: the thing you promised, and the thing you are waiting for

### What changed

Panel gained one `commitments` table and a **Commitments** column inside the
existing People area. A commitment is a title, a person, a direction and an
optional expected date.

The five things worth knowing before reading the code:

1. **A promise and a wait are one object with a direction.** `owed` — the user
   told Raj they would. `owedTo` — the user is waiting on Raj. A closed union at
   the schema validator, not a boolean: `isInbound` reads worse than
   `direction ===` at every call site, and a boolean would let a later edit flip
   the meaning of an existing row with nothing to notice.
2. **There is no status column.** Four states — `open`, `due`, `overdue`,
   `kept` — all derived from `(expectedAt, completed, now)`. Same reasoning as
   ADR-025: a stored status is a copy of two other fields, and a copy is where
   they disagree.
3. **Panel never asserts what another person did.** Every inbound string is
   phrased as the user's claim. The settled line reads **"You marked this
   received on 4 March"**, not "Raj sent this". This is not a style preference:
   Panel has no evidence about a third party's conduct, and an assertion
   presented as an observation is a false record that outlives the feature. It is
   enforced by two copy functions rather than one template, so the `owedTo`
   branch *cannot* reach the `owed` wording even by accident.
4. **An inbound wait is not a task.** A wait rendered as a task would be
   reported overdue by `taskRules` about something the user has no power over.
   That is worse than silence, so waits are not tasks. Panel creates **no** task
   for a commitment; `followUp` creates one only when the user presses the
   button, and following up **does not settle the commitment** — the user may
   have chased and heard nothing, and a chase that silently marked the wait
   resolved would be a lie recorded in the user's favour.
5. **Attention is asymmetric on purpose.** An `owed` that is late is something
   the user can still fix today: severity 0.85, section `people`, action
   "Done it". An `owedTo` that is late is something they cannot fix at all:
   severity 0.6, section `waitingOn`, action "Follow up". R-009 is
   unambiguous that waiting lists are reviewed weekly, not continuously, and that
   the failure mode is rot rather than nagging — so the inbound side fires *only*
   after the date has passed, with no advance-warning window at all. `due` is
   outbound-only and is **never** attention: warning someone about their own
   expectation they just typed is noise.

### The section that had no producer

`waitingOn` has existed in the attention vocabulary since phase 1.0 — declared,
ordered, and rendered — with **nothing that could ever write to it**. A declared
section with no producer is a specification claim the code does not meet, and it
is the same shape as D34 and D38: a path that promises an effect that never
happens, visible only if somebody looks. It was recorded inside the D42 scope
block in §11.2 rather than quietly dropped from the vocabulary, because deleting
the section would have removed the evidence that the gap was ever noticed. This
feature is what makes it true, and it did so without adding a section, a tab or a
slug: the commitments column lives inside People, where the people being waited
on already are.

### Anti-spam

Three mechanisms, none of them new machinery: a commitment with no expected date
emits nothing; an `owedTo` emits nothing before its date and nothing at all
without one; and the existing section budget of 4 caps the rest, with the
overflow already disclosed to the pipeline.

### Learning

No new feature index, and **no new signal from authorship** — creating a
commitment is an assertion, not an outcome, and the Q-006 interim answer says
authorship never trains. More importantly Panel **never trains on a kept
commitment**, in either direction: for `owed` the completion is the user's own
report and for `owedTo` it is a claim about somebody else, and training on either
would let an unverified assertion reshape the ranker. `FEATURE_COUNT` stays 12,
`WEIGHTS_VERSION` stays 1, indices 0–7 untouched. The live harness proves this
observably rather than by inspection: four commitment mutations move no weight at
all, while the follow-up **task** the same feature created does train.

### Defects found and fixed

- **D42 — the hottest attention read scanned the owner's whole history.** The
  attention query collected every commitment the user had ever made and
  filtered to the open, past-dated ones in JavaScript — a collect-then-filter on
  the single most-read path in the product, and D37/D39's exact shape. Replaced
  with a `by_owner_open` index range on `(ownerUserId, completed, expectedAt)`.
  **Found by the feature's own acceptance criteria**, which demanded that the
  read be an index *range* rather than a bounded collect. The scope block in
  §11.2 asserted a shape the first implementation did not have.
- **`getPersonCommitmentCounts` was built and then removed.** A per-person
  counter query would have been a second read of a set the panel already loads.
  The UI counts from `listCommitments` instead, and the function was deleted
  rather than left as an unused public endpoint.
- **`peopleById` / `resolvePersonName` were made exports.** They already existed
  inside `people.ts`; `commitments.ts` and `attention.ts` needed the same
  tombstone-resolving read, and three private copies of one resolution rule is
  how two of them end up disagreeing.

### Boundaries this feature accepts

- An `owedTo` with no expected date is `open` forever. That is an honest answer,
  not a missing one — the user recorded that they are waiting, and never said
  for how long.
- A commitment whose person is later merged still resolves, through the same
  tombstone path as a task's `personId` (ADR-023). No people mutation removes a
  commitment; `deleteCommitment` **detaches** the follow-up tasks and reports how
  many, so deleting is never a silent cascade.
- The direction is immutable. `updateCommitment` cannot change it, because
  flipping `owed` to `owedTo` is not an edit, it is a different claim about
  someone else's conduct, and it should take a new assertion.

### Verification

30 unit fixtures, plus 7 commitment fixtures added to the ADR-006 hard-kind
coverage fixture and one commitment per direction added to the ADR-006
`learned.test.ts` fixture. **395 pass, 0 fail across 14 files.** **132 live
invariants, 0 skips**, against the real deployment, covering all 15 acceptance
criteria — including cross-user isolation and foreign-id refusal on all seven
write paths, the four `commitment.*` activity kinds read back rather than
assumed, and the budget audit.

`assistant.ts` did **not** change — no transition moved and no weight-mutation
point was touched (Do-Not-Touch #8). ADR-022's OCC invariant was nevertheless
**re-armed and re-run rather than inherited**, because a new mutation writing
user state is exactly the change that invariant exists to survive: run I, 3
rounds × 8 concurrent mutations, 48 mutations, exactly one state row per user in
every round, negative control able to see a deliberate duplicate. Cumulative
1,936 mutations / 45 rounds / 0 duplicates, with the 21 pre-existing
`nlp.test.ts` fixtures untouched — Do-Not-Touch #7, the token-consumption loop
was not edited. Fixture removed and exports reverted.

Related ADR: ADR-002, ADR-006, ADR-009, ADR-010, ADR-015, ADR-016, ADR-019,
ADR-021, ADR-023, ADR-025, ADR-027
Related defects: D42
Budget: 4 of 4 new files · 1 of 1 new table · 0 deps · 1 abstraction

---

## CHANGE-0017

```
Date:       2026-10-01
Phase:      3, feature 5 — Finance expansion / subscriptions + account labels
Type:       feature
Severity:   ARCHITECTURE
Summary:    The recurring money Panel knows about, and the accounts it comes
            out of. A subscription is a number until its renewal is an action,
            and Panel previously only held the number — a subscription existed
            solely as an expenses row under a "Software & subscriptions"
            bucket, undated and invisible. Accounts did not exist at all.
            Delivered as two label-shaped tables with **no new attention rule
            and no new query** (ADR-029): the renewal reaches Attention through
            the expiry chain feature 3 already shipped. Bundles two Finance
            defects found by the audit (D43, D44) and two found by the
            feature's own gates (D45, D46).
```

### Finance expansion: subscriptions and account labels

### What changed

The Finance area gained a **Subscriptions** block and an **Accounts** drawer.
Two tables, one pure module, and — deliberately — no new attention machinery.

The five things worth knowing before reading the code:

1. **A subscription is created together with its renewal document** (ADR-029).
   `createSubscription` inserts both in one mutation. A subscription without a
   document is not expressible, so there is no state in which the user believes
   Panel is watching something and it is not. That window is the D34 defect
   class: a promise the code compiles against and never keeps.
2. **Panel adds no attention kind, no section, no rule and no read.**
   `document.expiring` already exists, already fires, and `by_owner_expiry`
   already narrows the attention read to exactly the documents that have an
   expiry. The cost of a subscription in the feed is **zero new query work** —
   which is the direct answer to the D42 lesson, and it means "one renewal, one
   item" is still structurally true rather than re-argued.
3. **An account is a label, never a balance** (ADR-028). Label and a closed
   kind. No balance column exists, so there is no reconciliation problem
   because there is nothing to reconcile against. The safest account is one
   that cannot be drained, because no column exists to type a number into.
4. **Annual cost is derived, never stored**, and the summary totals the figures
   the user can actually see in the list — so the total adds up on paper.
5. **Money stays a float, and is guarded.** Amounts were *not* migrated to
   minor units: that would rewrite the input to a verified tax estimate, which
   is exactly the silent change to financial semantics that must not happen.
   The consequence is accepted and guarded instead — see D44.

### Why the roadmap line needed auditing first

The capability table read `RESEARCHED` / "Not specified", with only "Accounts,
subscriptions" as a named object and **no acceptance criteria, no ADR and no
budget anywhere in the repository**. Approving it was a product decision, and
§3.2 names Finance specifically as gated on user research that has not
happened. Both were answered by Hardik on 2026-10-01, and that is recorded as
the approval rather than by editing the status table to make the gap look like
it never existed.

The audit then found the trap: read alone, "Accounts, subscriptions" reads as
a bank. §2.3 names the ledger as the thing Panel must not become, and says why
— *these products stop where an action is needed, and Panel's value is the part
after that point*. So accounts arrived as labels and subscriptions arrived as
obligations, and the roadmap line is delivered without a ledger in it.

### Composition over duplication

The audit's question was whether this could be built from what exists. It
could, almost entirely. `documents` already models label → expiry → derived
lifecycle → renewal task; a subscription needs three of those fields and is
missing only **amount** and **interval**. Those cannot live on `documents` —
a passport has no price, and R-007 defines a document as a label, an expiry and
a lead time — so the two compose through a pointer, which is the ADR-026 shape
where the related row holds nothing and the relation resolves on read.

The next renewal-shaped feature — insurance, a loan, a licence — composes the
same way. That is what makes ADR-029 cheap rather than merely correct.

### Money: the decision and its consequences

`expenses.amount` and `taxProfile.grossIncome` stay `v.number()`. The
alternative is better arithmetic and is not being adopted, because migrating
them rewrites the input to a tax estimate that is verified and public-facing.

So the guards, and what each one is for:

- **`Number.isFinite` on every money write.** `NaN <= 0` is `false`, so the old
  guard waved NaN through. A NaN amount poisons every bucket sum and the whole
  `estimateTax` result — and NaN does not render as an error, it renders as a
  **number**. In the one domain where a plausible wrong figure is worse than a
  crash, that is the defect that matters. D44.
- **`MAX_AMOUNT` as a magnitude ceiling**, so an absurd value is refused at the
  door rather than displayed as a figure nobody can act on.
- **Sums rounded at emission, never at rest.** `0.1 + 0.2` is reachable in a
  bucket total; rounding on write would corrupt the stored value to hide a
  display artefact, which is how a money system becomes impossible to reason
  about afterwards.
- **The tax-year filter is a local-time range**, matching the `getFullYear()`
  test it replaces exactly. A UTC range would move the boundary day for every
  user not on UTC — trading an unbounded read for a silently wrong tax figure,
  which is the worse of the two.

### Defects found and fixed

- **D43 — `getFinance` read every expense the user had ever created.** A
  collect-then-filter on a reactively-subscribed query. Phase 0B closed N4 by
  recording the set as "bounded", which is false: owner-scoped is not bounded,
  and the table only grows. It is D42's shape arriving a feature early. Fixed
  with a `by_owner_spentAt` range, constructed on **local-time** bounds so the
  returned set is byte-identical to the filter it replaces.
- **D44 — `NaN` and `Infinity` were accepted as amounts**, on both
  `addExpense` and `saveTaxProfile` (`grossIncome < 0` is false for NaN too).
- **D45 — `daysUntilRenewal` returned `-0`.** `Math.round` of a small negative
  fraction is `-0`, which formats as "-0" and fails `Object.is(x, 0)`. A
  subscription one millisecond before its renewal would report a negative zero
  days. Found by a unit fixture, not by inspection.
- **D46 — a date-only edit wrote no audit row.** `updateSubscription` returned
  early when the subscription's own patch was empty, which is *always* the case
  for a renewal date, because the date lives on the document (ADR-029). So
  `subscription.updated` was declared and — for the most common edit there is —
  never written. This is D38 arriving one feature later, and it was found by
  the live harness, not by the unit suite.
- **`expense.added` written at last.** The final one of D38's four leftovers:
  declared since phase 0B, written by nothing, which made Finance the only
  product area mutating user data with no audit trail at all.
- **A UI that could cancel the wrong row.** The first pass of the panel keyed
  list rows on `label + detail`, so two identically-named subscriptions would
  collide. The compiler caught it, because the view carried no id; the id is
  now carried explicitly and every action uses it.

### Boundaries this feature accepts

- **There is no currency column.** There is no rate source and no approved
  integration, so an amount is in the user's profile currency and Panel does not
  convert. Storing a currency without a conversion story would be a number that
  is silently wrong rather than visibly absent.
- **A subscription with no renewal date is legal** and permanently silent. The
  user recorded a recurring cost and no date; that is an honest answer.
- **Deleting detaches, never cascades.** An account removal ungroups its
  subscriptions and reports the count; a subscription removal clears its
  document's date and detaches its follow-up tasks. A user cannot destroy an
  obligation by tidying a label.
- **Capture infers nothing financial** (Q-007 interim), asserted live.

### Verification

**27 unit fixtures** in `src/lib/subscriptions.test.ts` — 422 pass, 0 fail
across 15 files. **74 live invariants, 0 skips**, covering all thirteen
acceptance criteria, including isolation across all six write paths, the
byte-identical tax-year range, the non-finite refusals, and a proof that a
subscription moves no weight while the whole feature runs.

`assistant.ts` was **not touched** and no weight-mutation point moved
(Do-Not-Touch #8), so ADR-022's OCC invariant is not re-armed — the last live
run (I) stands, at 1,936 mutations / 45 rounds / 0 duplicates. That is a
deliberate decision to inherit evidence, taken because the precondition for
re-running is absent: the OCC harness guards `assistantState` initialisation,
and this feature writes no assistant state.

All eleven pre-existing conformance harnesses re-run and pass.

Related ADR: ADR-002, ADR-003, ADR-006, ADR-008, ADR-009, ADR-010, ADR-013,
ADR-016, ADR-019, ADR-025, ADR-026, ADR-028, ADR-029
Related defects: D43, D44, D45, D46
Budget: 4 of 6 new files · 2 of 2 new tables · 0 deps · 1 abstraction

## CHANGE-0018

```
Date:       2026-10-01
Phase:      3, feature 6 — deterministic agents (scheduled runner + first
            additive review agent)
Type:       feature
Severity:   ARCHITECTURE
Summary:    Panel had intelligence and no *when*. Everything it knows is
            computed at query time, so a user who does not open the app is
            never told anything — and the specification's answer, six named
            agents, would have produced five duplicate producers for events
            that already fire. Delivered instead as ADR-030: **one Convex
            cron function, one registered agent, and a tier that is a type
            rather than a convention.** The agent proposes; it cannot touch
            money, and that is enforced by the compiler rather than by care.
```

### What changed

A **Things to check** block inside the existing Finance area, a **Check now**
button, a **Daily review on/off** switch, and a line stating when Panel last
looked and what it found. Two tables, one pure module, one cron declaration.

The five things worth knowing before reading the code:

1. **Cron answers *when*, never *what*.** `convex.config.ts` declares exactly
   one scheduled function — `agents/daily`, `0 7 * * *` — calling
   `internalRunDueSpaces`. It carries no user and no capability, so it cannot
   widen what an agent may do.
2. **The tier is a type.** `AgentAction` is a closed union of
   `{kind:"flag"} | {kind:"log"}`. There is no variant that can insert an
   expense, patch a tax profile or reach a document, so an agent that tried
   would not compile. `financeReviewAgent` returns the narrow
   `{tier: "proposed"}`, so "could this agent escalate?" stopped being a
   decision a later edit could make by accident.
3. **One agent, not six.** Five of the six §6.1 names already had producers.
   Building them would have been a violation of feature 3's own *one renewal,
   one item* criterion, committed in the name of following the specification.
4. **Overflow is counted, observable and audited** — all three. Counted and
   audited were free; **observable** needed a query, because a cap that
   silently discards work is a cap nobody can debug.
5. **The swing is computed by calling `estimateTax` twice**, not by applying a
   rate of its own. The number goes on screen next to the estimate it
   qualifies, and a second tax arithmetic path is a second thing that can
   disagree with the first.

### The gap the agent list was hiding

Reading §6.1 alone, six agents is the work. The audit found the opposite: five
of the six would each have been a **second producer** for an event something
already reports, and feature 3's acceptance criteria forbid exactly that in one
sentence. The real gap was not six agents. It was that Panel had no *when* at
all — a scheduler was needed, and only then was a genuinely additive agent
worth writing.

So the feature is two things that happen to be one: **a scheduler**, which is
one cron expression and one bounded index range, and **one agent**, chosen as
the only thing in the product that looks at an existing row and says *this
number depends on something nobody checked*.

### The proposal never claims to know

It sums what rests on unconfirmed categories and states the swing if none of
them qualified — and it says, in as many words, that it is not saying they are
wrong. The wording is a constraint rather than a style choice, and it is
asserted in the live harness against the deployed string: strip the disclaimer
and no `wrong`, `incorrect`, `mistake` or `error` may survive. A scheduled
process guessing wrong about a tax return is worse than one that said nothing,
because nobody is watching when it guesses.

**I have looked changes no money.** Accepting records an acknowledgement and
stops. Confirming a category stays an act the user performs in the Expenses
list, where they can see what they are confirming. An accept button that
silently rewrote a tax return would be the exact failure this feature was
scoped to avoid — and it would be invisible, which is worse.

### Bounded underneath

A scheduled job is uniquely able to get away with *collect every space and
filter*, and uniquely wrong to. So: due spaces are an **index range** on
`by_nextAgentRunAt` with `.take(200)`; a space that has not opted in is not in
the range at all, and clearing `nextAgentRunAt` removes it from the index
because Convex drops a document from an index when a field is absent — one
patch, and no second source of truth to keep in step. Expenses come from the
`by_owner_spentAt` **range** feature 5 added. The daily tally is a bounded read
of one space's own runs.

### Verification

**26 unit fixtures** in `src/lib/agents.test.ts` — 448 pass, 0 fail across 16
files — pinning the caps at their exact boundaries (10 allowed / 11 overflows;
50 allowed / 51 overflows), trace purity, and the never-claims-wrong wording.

**52 live invariants, 0 skips, 5 notes, 61 mutations.** The headline check is
**A11**: the harness fills the space's own daily tally to exactly 50 and then
fires the runner again, proving the 51st execution is refused, counted as
overflow (`1`), reported `capped` rather than successful, and **readable by the
owner** — with expenses, buckets, estimate and profile byte-identical
afterwards. It was added because the cap was previously only asserted as a pure
function, and *bounded* is a claim about a database, not about a function.

**What is NOT claimed.** **Cron firing is unverified.** The deployment accepted
`convex.config.ts` and the runner it targets is exercised live through the same
`runSpace` that `runMyAgentsNow` calls — but a 07:00 delivery cannot be
observed inside a test run, and neither `convex function-spec` (which lists 114
functions and exposes no scheduled-function type) nor any other CLI surface can
read the schedule back. So the harness verifies *the runner* and *the front
door*, and says nothing it cannot see about the alarm. **A12's thrown-failure
path is likewise not exercised**: the only honest way to make a real space
throw is to break the code first, so that is recorded as a note and not as a
pass. What *is* verified is the property either side of it — a run that did
nothing is recorded `skipped`, never as a silent success.

`assistant.ts` was **not touched** and the feature writes no assistant state,
so ADR-022's OCC invariant is not re-armed; run I (1,936 mutations / 45 rounds
/ 0 duplicates) stands. All twelve pre-existing conformance harnesses re-run
and pass.

**One defect was found in self-review, after the gates were green (D48).**
`listProposals` read `by_owner` and filtered to the space in JavaScript — D42
and D43's exact shape, in the newest module, written with both defect write-ups
open. The harness passed either way, because a filter and a range return the
same row when there is one proposal. It is now a `by_space_at` read in
descending order, and the index it needed has been deleted rather than left
behind for someone to read the wrong way later.

Related ADR: ADR-002, ADR-003, ADR-006, ADR-009, ADR-011, ADR-012, ADR-013,
ADR-014, ADR-016, ADR-019, ADR-025, ADR-026, ADR-029, ADR-030
Related defects: D47 (partially resolved — one of three declared `agent.*`
kinds now written, the other two deliberately reserved); D48 (a
collect-then-filter in the new module, found in self-review and fixed by
dropping the filter and the index it needed)
Budget: 5 of 6 new files · 2 of 2 new tables · 0 deps · 1 abstraction

---

## CHANGE-0019

**Area-native surfaces: an area shows the state of a part of life, not its tasks**

Severity: PRODUCT
Status: **APPROVED 2026-10-02.** Spec and change entry were written first, as
instructed; implementation followed the approval.

**Trigger.** A product reality correction: the running application reads as "a
todo application with different tabs". An audit of the surface against the
backend found the backend is not the problem.

**The diagnosis, in five parts.**

1. `activeArea` defaults to `general` (`src/pages/Dashboard.tsx:77`), and
   General is the only cross-area surface — so the front door is a task board.
2. **Home has no domain body.** It falls through to `TasksArea`
   (`Dashboard.tsx:435`), which is `getAreaTasks(area)` plus add/complete/delete.
   Custom areas do the same. Two of the six areas *are* filtered task lists.
3. **Commitments and Waiting On are rendered only inside Relationships, and only
   when the user has at least one person** (`Areas.tsx:1052`,
   `{!loading && people.length > 0 && <Commitments … />}`). An "I owe Raj £40"
   or a "waiting on the landlord" is invisible in General and in Finance unless
   a person row exists. An approved phase-3 domain object has no reliable
   surface.
4. **Finance is already domain-specific but has no hierarchy.** It opens on a
   disclaimer and country buttons; the objects are interleaved with three inline
   `Add` forms; Accounts is collapsed inside a `<details>`; there is no
   Overview, no Finance-scoped attention, no Finance tasks, no Finance
   documents, no Finance commitments. Objects Panel already knows about are
   unreachable *from Finance*.
5. **Health is a mock** (D50) — recorded, not fixed, by owner decision.

**What changes.** Five workstreams, all on the existing tab system.

- **A. Finance becomes a workspace in the §16 order:** Overview → Objects
  (accounts, subscriptions, expenses) → Attention → Actions → Tasks and
  Documents. Overview is composed from figures `getFinance` and
  `listSubscriptions` already return; **no new query and no new field**. Accounts
  stop being a collapsed disclosure.
- **B. Contextual Add.** One add control per area whose entries are *descriptors
  bound to existing mutations*. Finance offers expense, income (the existing
  profile field), account, subscription, document, task, capture. Life admin
  offers document, renewal, task, capture. Relationships offers person,
  commitment, waiting-on, task, capture. No new mutation, no arbitrary action
  menu, no verb that has no domain capability behind it.
- **C. Commitments become objects in General**, reusing the existing
  `commitments.listCommitments` body and dropping the `people.length > 0` gate.
  They stay in Relationships too — a person and what they are owed are the same
  question from two sides.
- **D. Home is made honest.** Either it gets a domain body or its heading says
  what it is ("Tasks in Home"). The fallback stops being silent.
- **E. Capture is unchanged.** Universal capture stays; the parser is untouched;
  no LLM is introduced. Context changes which *verbs* are offered, never what
  the parser does.

**What this explicitly does not do.** No new table. No new backend query. No new
page, route or navigation tier — `activeArea` stays a client-side switch. No
second page system. No new attention kind (ADR-029 stands: exactly one producer
of "this is expiring"). No change to `estimateTax`, the scorer, `nlp.ts` or
`recordOutcome` (§13 Do-Not-Touch). No ledger, no transactions — those are Q-008
and phase 4B, a separate change that is blocked until the ledger question is
answered.

**Budget** (declared now, enforced on implementation, ADR-016): 3 new files
(`src/components/AreaAdd.tsx`, `src/lib/areaActions.ts`,
`src/lib/areaActions.test.ts`) · **0 tables** · **0 deps** · 1 abstraction (the
contextual-add descriptor as data rather than as per-area code). Harness
`scripts/conformance-4a.ts` is the verification artefact and is counted inside
the 3.

**Acceptance criteria** — the product owner's list, and how each is met:

| # | Criterion | How |
|---|---|---|
| 1 | General stays task-centric | unchanged; it gains commitments/waiting-on as objects |
| 2 | Finance visibly domain-specific | workstream A |
| 3 | Finance is not a task list | already true; made explicit rather than incidental |
| 4 | Existing Finance objects surfaced directly | accounts, subscriptions, expenses, tax documents, commitments, tasks |
| 5 | Tasks available but not the only object | Tasks becomes one section of Finance |
| 6 | Life admin stays domain-specific | unchanged; gains contextual add only |
| 7 | Relationships stays people-centric | unchanged; gains contextual add; keeps commitments |
| 8 | Tabs remain the navigation model | no route added |
| 9 | No second page system | `activeArea` remains a client-side switch |
| 10 | Existing backend reused | every section binds an existing query or mutation |
| 11 | No ledger without approval | transactions are Q-008 / 4B, unapproved |
| 12 | No external LLM | unchanged, ADR-001 |
| 13 | Existing functionality intact | full harness suite re-run; stock lint baseline is the gate |

**Verification plan.** A new harness drives the real surface: that Finance's
first section is an Overview; that every add verb maps to an existing mutation
and a foreign/absent capability is never offered; that commitments with no
person row are visible in General; that Finance tasks and documents render from
existing reads; and that a second account sees none of it. Plus the 13 existing
harnesses, `bun test`, `tsc`, the lint baseline and `spec-drift`.

**Implementation status 2026-10-02 — ALL FIVE WORKSTREAMS BUILT AND VERIFIED.**
- **A — Finance is a workspace.** An **Overview** opens the area (income,
  estimated tax, recurring-per-year, expenses logged, and a per-account
  **derived balance** grouped by currency), composed entirely from figures
  `getFinance`, `listSubscriptions` and the new `listBalances` already return,
  so the Overview adds **no database read**. Accounts stopped being a collapsed
  disclosure. A **Transactions** section records money facts through
  `transactions.createTransaction`; a **financial document** can be created from
  Finance through the existing `documents.createDocument` and is owned by Life
  Admin, because a document's lifecycle belongs to one domain and a second list
  would only be a second place for the two to disagree.
- **B — contextual Add.** `src/lib/areaActions.ts` declares the verbs as **data**,
  each bound to a `module:function` target; `src/components/AreaAdd.tsx` renders
  the menu and calls back into the area, which already owns the form. Finance
  leads with a transaction; no area leads with a task; capture is universal.
- **C — commitments in General**, gate removed, unresolvable-counterparty rows no
  longer dropped (see below).
- **D — Home is honest.** An area with no domain model now says so in its own
  heading rather than silently presenting a task list as a workspace.
  **No persistence was invented** — Health stays D50, and both areas are listed
  in `AREAS_WITHOUT_A_DOMAIN_MODEL` so a test can tell the moment one of them
  grows a real model.
- **E — capture unchanged.** The Finance capture box calls the same
  `assistant.capture` and the same pure parser; only the destination area
  differs (REQ-068).

**Verification.** `src/lib/areaActions.test.ts` — **13 fixtures**, including two
that caught real mistakes in the descriptor table while it was being written:
Health and Home had *identical* verb lists (the very sameness this change exists
to remove), and capture was simultaneously meant to lead in General and trail
everywhere else. `scripts/conformance-4a.ts` — **43 live invariants, 0 failed**:
every verb target is asserted to be **really exported** by reading the Convex
sources (the structural form of "no fake actions"), the verb lists are
domain-shaped, `getFinance` carries the ISO currency, capture is area-scoped and
owner-isolated, the document verb writes through the existing domain, and four
source anchors pin the rendered hierarchy. Full suite: `tsc` 0 errors, `bun test`
**483 pass / 0 fail** across 18 files, lint at the stock 3/19 baseline,
`spec-drift` 18 passed / 0 failures, and **all 15 harnesses green** including the
two new ones.

**Two defects this increment found in itself, both fixed.** `getAreaTasks`
collected an area's whole task list with no bound — an unbounded read behind a
correct index, which is the D48 lesson in a place the audit had not reached; it
now takes 200, stated as a list surface rather than an export. And `getFinance`
never sent the **ISO currency** to the client, so the transaction form would have
sent `UK` where a currency belongs; the country already declares its currency, so
the projection now carries it rather than the UI guessing a second copy of that
table.

**Workstream C detail.** `Commitments` is exported from `Areas.tsx` and mounted in
**General** as well as Relationships — one component, one query, one model, two
surfaces — and the `people.length > 0` gate that hid the whole object from anyone
with no people is gone. A second defect surfaced while doing it: `listCommitments`
**dropped any row whose counterparty could not be resolved**, so a commitment
about a merged or removed person vanished instead of showing up with nobody
named. `describeCommitment` now takes `string | null` and the copy degrades to
"You said you would" / "Waiting on this" rather than an empty gap in a sentence
about a third party.

**Also worth recording:** a capture aimed at an area the user has *not* enabled
falls back to General rather than creating a task in a tab that does not exist.
The 4A harness asserted the opposite on its first run and was wrong; both branches
are now asserted, because the fallback is the security property and the filing is
the feature.

Related: Q-008, Q-009, D50 (Health), ADR-025, ADR-027, ADR-028, ADR-029,
ADR-030, ADR-031
Budget: 3 of 3 new files (`src/lib/areaActions.ts`, `src/lib/areaActions.test.ts`,
`src/components/AreaAdd.tsx`) + `scripts/conformance-4a.ts` as verification ·
0 tables · 0 deps · 1 abstraction. `FinanceArea.tsx`, `Areas.tsx` and
`Dashboard.tsx` were edited in place rather than duplicated.

**Earlier partial status (superseded by the above).** Workstream **C is built and verified**:
`Commitments` is exported from `Areas.tsx` and mounted in **General** as well as
Relationships — one component, one query, one model, two surfaces — and the
`people.length > 0` gate that hid the whole object from anyone with no people is
gone. A second defect surfaced while doing it and was fixed in the same pass:
`listCommitments` **dropped any row whose counterparty could not be resolved**, so
a commitment about a merged or removed person vanished from the list instead of
showing up with nobody named. `describeCommitment` now takes `string | null` and
the copy degrades to "You said you would" / "Waiting on this" rather than an
empty gap in a sentence about a third party. Verified by `conformance-4f`
(132 invariants, unchanged). **Workstreams A, B, D and E were not built at this
point** — they landed in the following increment, recorded above.

Related: Q-008, Q-009, D50 (Health), ADR-025, ADR-027, ADR-028, ADR-029,
ADR-030

---

## CHANGE-0020

**Transactions: first-class money facts, with a derived balance**

Severity: PRODUCT
Status: **APPROVED 2026-10-02** (Q-008 answered; ADR-031 recorded; §2.3 amended).
This is the first increment of feature 4B — the durable backend, before any
import UI. Deliberately scoped to what needs **no new dependency**.

**What this adds.** Two tables, one pure money module, one Convex module, one
harness. The direction is accounts → transactions → **derived** balance.

- **`transactions`** — `spaceId`, `ownerUserId`, `accountId?`, `postedAt`,
  `amountMinor` (**integer**, ADR-031), `currency`, `direction`
  (`out | in`), `label`, `merchant?`, `bucket?` (reuses
  `expenseBucketValidator`), `deductible`, `confidence` (reuses the expense
  confidence vocabulary), `source` (`manual | import`), `externalId?`,
  `importId?`. Indexes, **all scope-first so the D48 invariant holds by
  construction**: `by_owner_postedAt`, `by_space_postedAt`,
  `by_account_postedAt`, `by_owner_externalId`, `by_owner_import`.
- **`imports`** — one durable record per imported file: `spaceId`,
  `ownerUserId`, `filename`, `byteSize`, `contentType`, `sha256`, `status`,
  detected `kind`, aggregate detection, `uncertainty[]`. Indexes
  `by_owner_createdAt`, `by_space_status`, `by_owner_sha256`. **The table
  exists now; the upload pipeline that fills it is 4B-2 and is not built here.**
- **`src/lib/money.ts`** (pure) — minor-unit parsing and formatting that
  **refuses** to go through a float, signed balance arithmetic, the
  `float → minor` conversion at the one boundary where `expenses.amount` meets a
  transaction, and deterministic idempotency keys.
- **Derived balance** — `getAccountBalance` sums signed `amountMinor` over
  `by_account_postedAt`. There is **no balance column anywhere**, so there is no
  number that can drift from the bank.

**Why the expense float is not migrated.** `expenses.amount` is a guarded float
and is protected (CHANGE-0017, Do-Not-Touch). Migrating it is a separate change
with its own arithmetic regression risk; **the two representations coexist and
exactly one pure function converts between them**, so the boundary is auditable
rather than scattered.

**What is deliberately NOT here.** No upload, no file parsing, no CSV/XLSX/PDF
library — **0 new dependencies**, so ADR-016 is not triggered by this change.
No reconciliation, no transfers, no double-entry, no portfolio, no investments,
no goals, no insurance model. No agent may write a transaction: `AgentAction`
remains `{kind:"flag"} | {kind:"log"}`.

**Budget:** 4 of 6 files (`src/lib/money.ts`, `src/lib/money.test.ts`,
`src/convex/transactions.ts`, `scripts/conformance-4b.ts`) · 2 of 2 tables ·
**0 deps** · 1 abstraction (`src/lib/money.ts`).

**Verification.** `money.test.ts` — **22 fixtures**, all passing, including the
two that pin the reason this module exists: `parseAmountToMinor("1.005")` is
`101` where `Math.round(1.005 * 100)` is `100`, and `floatToMinor(0.1 + 0.2)` is
`30` because the boundary reads the *displayed* number rather than its binary
neighbour. `scripts/conformance-4b.ts` — **34 live invariants, 0 failed, 10
mutations**: integer storage end to end, a derived balance equal to the sum on
paper, money in positive and money out negative in the same sum, **two currencies
in one account never blended into one number**, a float / zero / negative /
blank-label write refused, the bound belonging to the read, a foreign account
id refused on all three paths and a second account seeing nothing, idempotent
re-apply returning the original row, and the attention feed and the model weights
**byte-identical** across the run. Full gates: `tsc` 0 errors, `bun test` 470
pass / 0 fail across 17 files, lint at the stock 3/19 baseline, `spec-drift` 18
passed / 0 failures, and harnesses 2, 3, 3f, 4, 4f, 5f, 6f all still PASS.

**Research behind this change (question → evidence → decision).**
- *How should money be stored?* Consensus across every source consulted is
  integer minor units; float storage is called out as the default failure. →
  **ADOPT**, and it is why `amountMinor` is an integer.
- *Does storing transactions make Panel a ledger?* The sources that reconcile
  per-row against a **stored** balance are the ones that need an accounting
  model; none of them needs one merely to list what happened. → **ADAPT**: keep
  the balance derived, drop the accounting.
- *How should an import avoid duplicates?* The proven pattern is a per-row
  existence check on an exact deterministic key before writing, with a review
  screen in front of it. → **ADOPT** (`by_owner_externalId` point lookup).
- *Should duplicates be matched fuzzily?* Fuzzy matching presumes OCR-grade
  noise and merges records on resemblance — the failure ADR-024 already forbade
  for people. → **REJECT**, recorded in ADR-031.
- *Is there a service that extracts statements for us?* The catalogue returned
  **no match** for a privacy-first, no-LLM PDF/CSV extractor. → **INVESTIGATE**,
  and the practical consequence is that extraction must be deterministic and
  in-house, so "upload and the AI understands it" is unavailable by
  architecture rather than by policy.

### 4B-2 dependency decision package — required by ADR-016, awaiting approval

ADR-016 makes a new dependency a stop condition. This is the package that
condition asks for, researched 2026-10-02. **Nothing has been installed.**

**The recommendation is narrower than expected: the first useful import needs
zero dependencies.**

| Format | Package | Verdict |
|---|---|---|
| **CSV** | **none — hand-written RFC 4180 parser** | **RECOMMENDED.** ~80 lines, deterministic, no supply chain, and it is the format banks actually export. |
| XLSX | `exceljs` (MIT) | Candidate for a later increment. Vetted, actively maintained, pure JS. |
| XLSX | `xlsx` / SheetJS (Apache 2.0) | **REJECTED.** The npm build is stuck at 0.18.5, last published ~5 years ago, with published high-severity advisories (ReDoS, prototype pollution) and **no fixed version available on npm**. Taking an unmaintained parser with known advisories for financial data is indefensible. |
| PDF (text layer) | `unpdf` (MIT) or `pdfjs-dist` (Apache 2.0) | Candidate for a later increment. |
| PDF (scanned) | — | **OUT OF SCOPE.** OCR requires an inference service, which ADR-001 forbids. A scanned PDF is refused with a stated reason. |

**Per-package detail for the two candidates.**

- `exceljs` — MIT; actively maintained; formats: xlsx/xlsm read and write;
  no native dependencies; server-side pure JS. Cost: ~1 MB unpacked, pulled
  into a Convex **action** bundle only (never into a query or the client), so it
  does not touch the browser bundle. Limitations: no `.xls` (the old binary
  format), and a maliciously crafted workbook can consume memory — mitigated by a
  size cap and a parse timeout.
- `unpdf` — MIT; built on `pdfjs-dist`; extracts the **text layer** only, which
  is exactly the scope wanted; no native dependencies (the upstream pdf.js build
  optionally wants a canvas polyfill, which `unpdf` avoids server-side).
  Limitations: a scanned PDF yields no text and must be refused rather than
  guessed; column reconstruction from a statement layout is Panel's own bounded
  parser, not the library's job.

**Does a dependency-free alternative exist?** Yes, and it is the recommended
path. RFC 4180 is a small, fully specified format: quoted fields, escaped quotes,
delimited rows. The *interesting* part of statement ingestion is never the CSV
grammar — it is identifying which columns are the date, the description and the
amount, and checking that the rows sum to the printed total. Both of those are
Panel's own deterministic code either way, so a dependency would be paying a
supply-chain cost for the easy third of the problem.

**Security considerations.** No parser runs on anything but a file the user
uploaded, in a Convex action with no network access, behind a size cap and a type
allowlist, with file identification by magic bytes rather than by the declared
content type. Nothing extracted is persisted without user confirmation, and low
confidence is surfaced rather than written (ADR-031, REQ-070, REQ-072).

**What is being asked.** Approval to build 4B-2a — **CSV only, zero
dependencies** — with XLSX and PDF left unbuilt until each is separately asked
for. The alternative is to approve the two candidates now and take the bundle and
maintenance cost in exchange for formats most banks do not export.

---

**Implementation status 2026-10-02.** 4B-1 is **built and verified**:
`src/lib/money.ts`, `src/lib/money.test.ts`, `src/convex/transactions.ts` and
`scripts/conformance-4b.ts` exist and pass. `imports` exists as a schema with no
writer, which is stated plainly by harness check B8 — an empty list is the
honest answer while there is no upload surface. **4B-2 (the pipeline) is not
built** and needs its two parsing dependencies, which is an ADR-016 stop
condition and therefore its own approval.

Related: ADR-031, ADR-028, ADR-009, ADR-011, ADR-014, Q-008
Budget: 4 of 6 files · 2 of 2 tables · 0 deps · 1 abstraction

---

## Open Questions / Decisions Required

### Standing roadmap approval — 2026-10-01

The user (Hardik, the decision owner) issued a standing instruction: build Panel
from the current repository to a finished, working, tested, verified product,
working autonomously through the approved roadmap, without returning for
routine implementation approvals. Quoting the operative constraints:

> "You are now the primary implementation agent for Panel… BUILD PANEL FROM THE
> CURRENT REPOSITORY STATE TO A FINISHED, WORKING, TESTED, VERIFIED PRODUCT… Do
> not merely produce plans. Do not stop after one phase… Work autonomously
> through the approved roadmap… continue automatically to the next authorized
> phase."

**What this approval covers.** Phases 0B, 0C, 1.0, 1.1, 1.5, 2 and 3 may each
enter `IN PROGRESS` and be implemented without a separate per-phase approval,
provided the agent obeys the complexity budget, the Do Not Touch register, the
security invariants, ADR-019 and ADR-021, and records a CHANGE entry per phase.

**What this approval does NOT cover.** It does not authorise: choosing a
guest-account strategy (Q-001 remains open and blocking), changing an ADR
decision, changing a security or privacy invariant, changing data-ownership
semantics, introducing a dependency for convenience, exceeding a complexity
budget, removing working functionality, or marking any phase `SHIPPED`. Those
remain `user only` under MAIN_AGENT §9.2 and ADR-021.

**Recorded by:** the agent, on the user's explicit instruction. Under MAIN_AGENT
§12 this is the recorded approval that 0B–3 require before entering
`IN PROGRESS`; it was previously absent, which is why 0B–3 were `NOT STARTED`.

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
| **Status** | **RESOLVED — 2026-10-01** |
| **Blocks** | Nothing. TASK-0A-002 is closed by ADR-022. |
| **Created** | 2026-10-01 |
| **Resolved** | 2026-10-01 — the question was put and decided by Hardik: supersede ADR-017. Answered by **ADR-022**, which replaces the deterministic-id mechanism with Convex's transactional OCC. |
| **ADR created** | **ADR-022** — "Assistant state initialisation relies on transactional OCC". ADR-017 marked SUPERSEDED BY ADR-022, retained not deleted. |

---

### Q-006 — Should a multi-object capture be a learning signal?

**Status: OPEN. Non-blocking.** Recorded 2026-10-01 by CHANGE-0014.

**The question.** Today the model learns from *task completion*: a task the user
finishes teaches Panel they finish things like that. A multi-object capture is
a **single act of authorship producing N tasks**, and none of them is a signal
about any individual task.

**Why it is not trivial.** If Panel treats "created via multi-capture" as a
positive training signal, every one of those tasks inherits evidence it never
earned — the same defect shape as D34, where a signal that was never really
present still moved the weights. If it stays silent, a genuinely useful
behaviour never becomes learnable.

**Options.**
- **(a) No learning signal from capture at all.** Capture is authorship, not
  outcome, and only completion is an outcome.
- **(b) A new feature index** for "created in a multi-object capture",
  appended at 12, requiring the ADR-010 governance.
- **(c) Use the existing `origin` field** to mark the source and let
  completion-supplied evidence dominate.

**Recommendation (technical only — this is the agent's engineering judgement,
not a product decision):** **(a)**. Smallest option, cannot leak authorship into
outcome evidence, and consistent with ADR-004's refusal to learn from anything
other than an explicit outcome. Option (b) spends a frozen-layout slot on a
hypothesis, which is precisely what ADR-010 exists to prevent.

**Interim behaviour, shipped and verified:** (a). A captured task is an ordinary
`panel`-origin task and capture adds no training signal. The harness asserts
this live (`samples` 0 → 0, weight vector byte-identical), so if it ever changes
the change is visible. Option (b) remains available later as an additive change
to the feature layout, not a redesign.

**Blocked by:** a human decision.

### Q-007 — Should capture infer that something is a commitment, and in which direction?

- **Status:** OPEN. Not blocking Feature 4. Recorded 2026-10-01.
- **The question.** Feature 2 established that a capture may split on explicit
  structure only and never on prose (R-004), and it creates **tasks only**.
  Feature 4 adds commitments. Should a capture ever produce one?
- **Why it is not a small question.** The two directions are separated by a
  pronoun and nothing else. "I'll send Raj the file tomorrow" is an obligation;
  "Raj will send me the file tomorrow" is a wait; "I need to send Raj the file
  tomorrow" is a task; and "Raj and I talked about sending the file tomorrow" is
  none of the above. All four are ordinary sentences a person types, they share
  most of their tokens, and the difference is *who the sentence is about from the
  speaker's point of view*.
- **Why it was not decided here.** Extracting this needs new grammar in a closed
  parser under Do-Not-Touch #7, and R-004 already established the asymmetry
  that governs such decisions: a wrong commitment is a social claim the user did
  not make, attached to a real person, and the user cannot see the error from
  the capture that appeared to succeed. Direction-by-pronoun is the hardest
  version of the extraction problem, not the easiest.
- **Options.** (a) No capture for commitments; commitments are created by
  explicit action in the Relationships area. (b) Explicit structure only, as in
  Feature 2 — some user-typed marker that states both the fact and the
  direction. (c) Natural-language direction inference.
- **Recommendation (technical only, not a product decision):** **(a) now, (b)
  later if asked.** It is the smallest option, it cannot manufacture a social
  claim, and it is consistent with the rule Feature 2 already follows. Option
  (c) is the one R-004 warns about and should not be built without evidence
  nobody has yet produced.
- **Blocked by:** a human decision. The agent may recommend, not decide.
- **Interim behaviour:** Feature 4 ships with (a). Capture is unchanged and still
  creates tasks only; a commitment is created by pressing a button in the
  Relationships area, with a direction chosen there.

### Q-008 — May Panel hold a transaction model, and does §2.3 change? — **ANSWERED 2026-10-02**

- **Asked by:** the product owner, 2026-10-02 — *"I want Panel to eventually
  support manually created and imported transactions. Do not assume transactions
  are permanently forbidden. Produce the concrete transaction/ingestion
  architecture first, then surface the §2.3/ADR-028 amendment as a deliberate
  product decision."*
- **The constraint as it stands today.** §2.3: *"Panel must NOT copy: Building a
  double-entry ledger. Panel needs to know about money, not to re-account for
  it."* ADR-028: *"a transaction is a ledger row — an account with a balance is a
  ledger with extra steps, and §2.3 names the ledger as the thing Panel must not
  become."* REQ-054: *"An account is a label, and a balance is a ledger."*
- **What is being proposed.** Phase 4B — a `transactions` table holding facts
  the user typed or imported, and an `imports` table holding one durable record
  per uploaded file. The full architecture, including the extraction pipeline,
  the uncertainty rules, the security model and the budget, is written in
  `04_SYSTEM_FUNDAMENTALS.md` under *Phase 4, feature 2*. **It is architecture
  only. No code, no table, no dependency.**
- **What the amendment would have to say, and what it must keep saying.** (a)
  Panel stores transaction *facts*, not an accounting system; (b) no journal
  entries, no debit/credit, no double-entry invariants; (c) **a balance is
  derived at query time and never stored as a column** — which is what keeps
  ADR-028's actual hazard (a balance that can be wrong and that nothing can
  check) from returning; (d) Panel never presents itself as the system of record
  for a bank; (e) reconciliation, transfers-as-a-conjugate-pair, and categoris-
  ing across accounts are out of scope in the first version.
- **Cost of saying yes.** 2 tables, 1 abstraction, and — the part ADR-016 makes
  a stop condition — **2 new dependencies** (a deterministic CSV/XLSX parser and
  a PDF text extractor). A dependency-free Panel cannot parse a spreadsheet.
- **Cost of saying no.** Excel/PDF import stays out of reach, and the only
  finance input is manual. Panel keeps its sharpest differentiator: it is not a
  ledger and never drifts from the bank.
- **ANSWER — YES, and §2.3 is amended.** The product owner decided on 2026-10-02:
  *"I want Panel to eventually support manually created and imported
  transactions. Do not assume transactions are permanently forbidden."* Recorded
  as **ADR-031**; §2.3 in PRODUCT_CONTEXT carries the amendment; ADR-028 is
  superseded on the transactions-and-balance point and retained for its
  label-and-kind decision. The three conditions that make it a fact model rather
  than a ledger — integer minor units, a **derived** balance, no accounting — are
  part of the answer, not concessions in it.
- **Now unblocked:** 4B is `IN PROGRESS`. The change entry is CHANGE-0020.

### Q-009 — Where do commitments and waiting-on live as objects? — **ANSWERED 2026-10-02**

- **Asked by:** the product architecture audit, 2026-10-02.
- **The problem.** The commitments UI exists, is complete (create, update,
  complete, cancel, reopen, follow up, delete) and is rendered **only inside
  Relationships, only when the user has at least one person**
  (`src/components/Areas.tsx:1052`). A commitment is not always about a person:
  waiting on a landlord, a council or an insurer has no person row, and today it
  is invisible.
- **Options.** (a) Render commitments in **General** as objects, keeping the
  Relationships copy — recommended, and what CHANGE-0019 workstream C proposes.
  (b) Give commitments their own tab — rejected: a seventh tab for one object
  kind is a second navigation tier for a single primitive. (c) Move them out of
  Relationships — rejected: "what Raj owes me" is the question people open that
  area to ask.
- **ANSWER — both.** The product owner decided on 2026-10-02: *"Commitments should
  appear in General and Relationships. Keep the relationship context. Do not
  create a duplicate commitment model. Remove unnecessary UI gates that prevent
  meaningful cross-domain visibility."* One component, one query, two mounts — no
  second model, and the `people.length > 0` gate is removed so a wait with no
  person row is visible. Built in CHANGE-0019.
- **Interim behaviour:** unchanged until CHANGE-0019 is implemented.

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

> **SUPERSEDED BY ADR-022** (2026-10-01). Retained below as the historical
> record of the decision and the reasoning that led to it. Do not implement it.
> Its prescribed mechanism does not exist in Convex, and its central premise —
> that optimistic concurrency cannot detect the race — does not hold for Convex.

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

**Why it was superseded.** The rejection of OCC above reasons from a
point-read model of conflict detection. Convex tracks the *index range* scanned
in a transaction's read set, so a concurrent insert into that range **is**
detected. Both the premise and the mechanism were re-examined under Q-005 and
replaced by ADR-022.

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

### ADR-022 — Assistant state initialisation relies on transactional OCC

**Status:** Active. Supersedes ADR-017. Recorded 2026-10-01, resolving Q-005.

**Context.** Defect N1 claims that two concurrent completions can each observe
`assistantState` as absent and each insert a row, leaving two documents. The
second `.unique()` read in `getDashboard` and `getModel` would then throw,
permanently breaking the dashboard. ADR-017 was written to fix this with a
deterministic-id upsert.

Phase 0A could not build it, and on inspection the premise turned out to be
wrong for Convex specifically. That distinction matters, because a database
whose OCC only compared document versions would behave exactly as N1 and
ADR-017 describe. Convex is not such a database, and the difference is the whole
content of this decision.

**Previous ADR.** ADR-017, superseded. Its two load-bearing claims were (a) the
mechanism — `ctx.db.insert(table, id, value)` — and (b) the rejection of
optimistic concurrency on the grounds that the two inserts touch different new
documents and therefore conflict with nothing.

**Observed API constraints.** Claim (a) is simply unavailable, and this is
checkable rather than arguable. In the installed Convex 1.42.1,
`GenericDatabaseWriter.insert` has exactly two overloads — `insert(table, value)`
and, on the table-scoped writer, `insert(value)` — and neither accepts a
document id. `patch` and `replace` both throw when the document does not exist,
so neither can serve as an upsert. Document ids are generated by the system:
they encode a table number, randomness, a timestamp and a checksum, and are not
caller-settable. The changelog through 1.47.0-unreleased introduces no
explicit-id insert. A deterministic-id upsert is therefore not implementable on
this platform, at any effort level.

**Convex documented behavior.** *DOCUMENTED:* mutations execute as serializable
transactions. Each transaction carries a read set, and the committer refuses to
commit a transaction whose read set overlaps a write committed after the
transaction began, rolling it back and re-executing it. The read set is
composed of the **index ranges scanned**, not only point reads, so a write that
inserts a document into a range another transaction read is a conflict. Because
mutations are sandboxed and deterministic, re-execution is always safe.

**Panel-specific invariant.** *INFERRED:* `loadState` reads via
`ctx.db.query("assistantState").withIndex("by_user", q => q.eq("userId", userId)).unique()`.
That places the `by_user` range for that user into the read set. A concurrent
insertion of another `assistantState` row for the same user lands inside that
range. On the reasoning above, the second transaction should therefore conflict,
be rolled back, and on re-execution observe the row and patch it rather than
insert a second one. This is an inference about Panel's specific access pattern,
and inference is not evidence — hence the verification requirement below.

**Verification requirement.** *VERIFIED:* the invariant must be demonstrated by
executing real concurrent mutations against a live Convex deployment and counting
the rows that actually exist. Documentation is not a substitute. A mock, a stub,
or a simulated transaction layer does not satisfy this, and neither does a
reasoning argument.

The conformance test is `scripts/conformance-occ.ts`. It drives the real
`loadState` and `recordOutcome` from `src/convex/assistant.ts` via a temporary
fixture module, fires genuinely simultaneous mutations at a deployed backend, and
then counts rows with `.collect()` — never `.unique()`, so a duplicate would be
counted rather than thrown away.

It asserts, per round: the user starts cold; all concurrent mutations settle
with no OCC error reaching the caller; exactly one row exists afterwards; that
row holds a valid weight vector (`weights.length === 8`) and a valid counter set
(`byHour.length === 4`, `byWeekday.length === 7`); `samples` and `shortTotal`
equal the batch size, proving every attempt was recorded exactly once with
neither loss nor double-counting; and a second concurrent batch reuses the same
document id and accumulates onto it.

It also runs a **negative control** before anything else: it deliberately seeds
two rows for one user inside a single transaction, where no conflict can occur,
and asserts the inspector reports `count === 2`. Without this, a PASS would be
uninterpretable — a counter that cannot see a duplicate proves nothing.

**Result.** Executed 2026-10-01 against the development deployment
`little-pelican-326.convex.cloud`. Three runs, all passing:

| Run | Concurrency | Rounds | Concurrent mutations | Duplicates |
|---|---|---|---|---|
| A | 8 | 5 | 80 | 0 |
| B | 24 | 8 | 384 | 0 |
| C | 32 | 10 | 640 | 0 |
| D (final shipped script) | 32 | 10 | 640 | 0 |
| E (re-run after 1.1 changed `recordOutcome`) | 8 | 3 | 48 | 0 |
| F (re-run after phase 3 feature 1 changed `recordOutcome` again) | 8 | 3 | 48 | 0 |
| G (re-run after feature 2 edited `assistant.ts`) | 8 | 3 | 48 | 0 |
| **Total** | — | **42** | **1,888** | **0** |

Run D re-executed the suite after the driver was decoupled from Convex codegen,
so the artifact left in the repository is the one that was actually observed to
pass. Runs E and F exist because ADR-022's own failure path requires
re-verification whenever the code it reasons about changes: phase 1.1 altered
`recordOutcome` — the exact function under test — so the suite was re-armed and
re-run rather than assumed still valid. Doing so exposed a defect in the harness
itself (D29): the negative control seeded the *first* state row for a user and
then asserted two, so it was a control that could never pass for the right
reason. Fixed, and the control now genuinely proves the detector can see a
duplicate.

Run F is the same discipline applied a second time. Phase 3 changed
`recordOutcome` again — not its transaction shape, but its `task` parameter type
and the object it is handed (D34) — so the invariant was re-verified rather than
inherited. Two further harness defects surfaced while re-arming, both recorded
because a harness that lies about its own setup is worse than no harness: the
inspector conflated "this user has no state rows" with "this user does not
exist", and the cold-start path inserted a row whose `shortTotal` disagreed
with its own `samples`. Both fixed; the cold path now writes exactly the
counters `recordOutcome` would have written, so the two paths are
indistinguishable by construction.

Run G applied the same discipline to phase 3 feature 2. `capture` writes no
`assistantState` and calls no `recordOutcome`, and the feature-2 harness proves
that live — but "the new code does not call it" is a claim about code, not an
execution. The suite was re-armed and re-run anyway. This is the rule working
as intended: reasoning about which paths touch the guarded row is the cheap
check, and re-running is the expensive one, and ADR-022 asks for the expensive
one whenever `assistant.ts` changes.

The negative control reported `count === 2` on every run, establishing that the
detector is capable of observing a violation. `samples` equalled the batch size
exactly in all 33 rounds, so re-execution preserved every outcome rather than
silently dropping work. N1 is closed on evidence, not on argument.

**Alternatives considered.**
- *Implement ADR-017 as written.* Rejected: the API does not exist. Not a
  matter of effort or budget.
- *Status column plus a patch-only write path*, so a duplicate becomes
  impossible rather than unlikely. Rejected for now: it costs a schema change,
  which Phase 0A forbids and which this decision does not need. Retained as the
  escalation path below.
- *Catch the `.unique()` error and merge.* Rejected, as in ADR-017: it hides the
  duplicate rather than preventing it, and leaves learned weights ambiguous.

**Decision.** Single-row-per-user `assistantState` is created and updated by the
existing read-then-insert path in `recordOutcome`, relying on Convex's
transactional OCC to serialise concurrent initialisation. No deterministic-id
helper exists and none may be introduced. The invariant is enforced by the
platform's transaction model rather than by an application-level convention,
which is a stronger guarantee than a convention: it cannot be bypassed by any
caller, because every caller goes through the same transactional path.

**Consequences.**
- The one Phase 0A abstraction budgeted for a deterministic-id upsert
  (`1 abstraction`) is not spent. Budget otherwise unchanged.
- The invariant depends on Convex's OCC remaining serializable. It is a platform
  guarantee, so it is stronger than application code, but it is also a guarantee
  Panel does not own. That trade is accepted and documented rather than hidden.
- Correctness of `assistantState` is now contingent on `loadState` continuing to
  read through an index rather than, say, an unindexed scan. A future refactor
  that changes that access pattern invalidates this reasoning and must re-run the
  conformance test.
- `scripts/conformance-occ.ts` is retained so the claim can be re-verified, but
  its fixture module is not checked in: shipping an unauthenticated public
  mutation would violate MAIN_AGENT S1. The re-arming procedure is documented in
  the script header.

**Failure path.** If the conformance test ever fails — a duplicate row appears, a
mutation surfaces an unretried OCC error, or `samples` drifts from the batch
size — N1 is reopened immediately and this ADR is treated as void. The response
is to record a new blocking question and propose a superseding ADR; specifically,
the status-column plus patch-only-write-path design, which makes the duplicate
structurally impossible rather than relying on the transaction model. No
workaround may be applied to the schema, no new table may be introduced, and no
defect may be worked around in application code to make the test pass.

**Conditions for revisiting.** Revisit if any of the following becomes true:
Convex weakens or documents a change to its serializability guarantee; Convex
adds an explicit-id insert, which would make the ADR-017 mechanism possible
again and worth reconsidering on its own merits; `loadState` stops reading
`assistantState` through an index; or `assistantState` gains a write path outside
`recordOutcome` that does not go through a mutation.

---

### ADR-023 — A merge is a tombstone, not a rewrite

**Status:** Active. Recorded 2026-10-01, with phase 3 feature 1 (CHANGE-0013).

**Decision.** Merging two people sets `mergedIntoId` on the source row and
stops. It moves no tasks, copies no identity keys, and rewrites no links.
Every read resolves through the tombstone instead. Unmerging clears the two
fields the merge set, and that is the whole of it.

**Context.** Merging is the only genuinely destructive-sounding action in
People, and "you cannot undo a merge" is a sentence no personal data product
should be able to say. The usual implementation — move the children, delete
the source — is reversible only if every move is journalled, and a journal is
itself a thing that can be half-written, race, or be read by code that
disagrees with the data it describes. Reversibility bought that way is
reversibility in name.

It is also worth being precise about what "the same person" means. Two people
called Raj are, in the general case, two people. RJD-004 already settled that
Panel must never merge them on its own. So the merge is a statement the user
makes, and the cost of being wrong is the cost of any user decision: the
ability to take it back.

**Alternatives considered.**
- *Move tasks and links, then delete the source row.* Rejected: the source
  must be kept anyway, because deleting it breaks every task pointing at it.
  Keeping the row and moving the children is strictly worse — it does the
  risky work and still keeps the row.
- *Move the children and record an undo journal.* Rejected: more write paths,
  more failure modes, and the journal itself needs a conformance story. A
  design whose reversibility depends on a second store being perfectly
  consistent is weaker than one that never moves anything.
- *Hard-delete the source on unmerge-failure.* Rejected: there is no such
  state, which is the point.
- *A `mergedIntoId` that is resolved by a trigger or a view rather than in
  the read path.* Rejected: Convex has no triggers or views, and a second
  stored copy of "who is this really" is a second source of truth (ADR-003's
  principle applied to identity).

**Why chosen.** Unmerge becomes exact rather than approximate. There is no
restoration step that can half-run, because there is nothing to restore: the
conformance harness proves it by merging, unmerging, and comparing the row
count, the row identities, the display name, the link count and the identity
keys either side.

**Consequences.**
- A tombstone is a row that still costs storage. Bounded, and the alternative
  — a delete — is the thing that costs correctness.
- Every read path that touches a person must resolve through the tombstone. A
  read that forgets is a read that shows a merged-away person. The cost is
  paid at the read site, deliberately, because it is where the mistake is
  visible rather than hidden behind a denormalised column.
- Identity keys are *resolved* through the chain, never copied. Copying would
  make unmerge inexact for the key set, which is the one thing it cannot be.
- Chains are possible (`a → b → c`) and are resolved by a cycle-guarded walk
  capped at 8 hops, in both the pure module and the query helpers. A cycle
  must not hang a query; a hang is a worse failure than a short key list.
- `mergedCount` is surfaced in the UI. A merge the user cannot see is a merge
  they cannot undo.

**Conditions for revisiting.** Revisit if a merge ever needs to carry
*information* rather than only an identity — for example, if merging must
also drop one of the two email addresses, or renumber something. At that point
a rewrite becomes unavoidable and this ADR must be superseded with a journal
design, not quietly worked around.

---

### ADR-024 — Identity evidence is a set of keys, and a name is the weakest one

**Status:** Active. Recorded 2026-10-01, with phase 3 feature 1 (CHANGE-0013).
Extends ADR-021 (agent authority) and RJD-004.

**Decision.** A person carries a set of normalised **identity keys**, each
namespaced by kind (`name:`, `email:`). Sharing a key is *evidence* and never a
merge. Nothing in the system merges automatically. `judgeMatch` is asymmetric
by design: a shared email clears the suggestion bar on its own, a shared name
only ever produces something to check. `createPerson` refuses a probable
duplicate and names the row it had in mind, and the user may insist.

**Context.** "Raj" is a common name in more than one country. Two people
called Raj are not the same person, and a system that merges them has
destroyed information in a way the user cannot see, let alone undo. The
roadmap settled the principle in RJD-004 before any of this code existed; this
ADR is about the mechanism that makes the principle cheap enough that nobody
would be tempted to skip it.

The second reason is forward-looking. A provider adapter — contacts, email,
messaging — will eventually contribute identity evidence Panel did not ask
for. Keys give that contribution a shape: an adapter adds strings to a set and
nothing else. It cannot merge, cannot delete, and cannot reach a mutation. The
authority boundary is structural rather than a rule someone has to remember.

**Alternatives considered.**
- *Key on a normalised name alone.* Rejected: it is the exact case RJD-004
  exists to prevent.
- *Fuzzy matching (Levenshtein, Jaro-Winkler, embeddings).* Rejected: it
  produces confident wrong answers, and every one of them is a merge the user
  did not choose. Determinism and explainability are worth more here than
  coverage; "Raj" and "Raja" being near each other is not evidence of
  anything.
- *A confidence threshold that merges above 0.8 automatically.* Rejected
  outright. It is the automatic merging the roadmap forbids, and a threshold
  does not make an unmergeable merge safe — it only decides how often it
  happens.
- *Email only, no name key.* Rejected: most people a user cares about are
  entered by name, and an address-less person would be unreachable by evidence
  entirely. A weak key that only ever produces a suggestion is safe in a way
  no key at all is not.
- *An external identity provider or a contact-sync service to resolve people.*
  Rejected: out of scope, and it would make identity resolution depend on a
  third party's matching, which is not a guarantee Panel can reason about.

**Why chosen.** The failure mode of a wrong merge is silent and hard to
reverse. The failure mode of not merging is a second row the user can merge in
two clicks. Every part of this design is chosen to fail in the second
direction.

**Consequences.**
- The matcher is conservative on purpose: "O'Brien" and "OBrien" stay
  different keys, "Jean Luc" stays different from "Jeanluc". Under-matching
  costs a row; over-matching costs a wrong merge.
- A name-key collision between two real, different people is expected and
  normal, not a bug. The UI says so in as many words.
- Name keys are **recomputed** on edit, never accumulated. A person renamed
  from "Raj" to "Rakesh" stops matching `name:raj`, because an old name that
  kept matching forever is how one person ends up merged with three different
  people over the years.
- Keys are bounded (12 per person, 120 characters each) because a mutation
  writes them and an unbounded array in a row is a row with no ceiling.
- Identity keys are displayed as readable evidence (`name "raj patel"`), never
  as raw machine strings. `name:raj patel` on screen looks like a bug and
  teaches the user nothing about how Panel decides what is the same.

**Conditions for revisiting.** Revisit when a provider integration begins
contributing identity evidence automatically. That is the point at which this
becomes a security decision rather than an engineering one: an adapter that
can add keys can, over enough syncs, manufacture a duplicate on its own. The
answer will not be a better threshold.

### ADR-025 — A life-admin document is metadata, and its lifecycle is derived

**Status:** Active. Recorded 2026-10-01, with phase 3 feature 3 (CHANGE-0015).
Extends ADR-003, ADR-007, ADR-013, ADR-023; evidence in R-006 and R-007.

**Decision.** A document in Panel is **metadata about keeping a credential
valid** — a label, an expiry date, a lead time, an owner and an optional
person. There is no file, no image, no document number and no storage
integration. Its lifecycle is **not stored either**: the seven states
(`undated`, `valid`, `due`, `renewing`, `renewing-late`, `expired`, `stale`)
are a pure function of `(expiresAt, the linked renewal task)` and `now`.
There is no `status` column.

**Context.** The roadmap says "Expiry → renewal chain" in one line, and
"Life Admin / documents" in another. Read together the second line looks like a
document manager, and that reading would have cost this project a storage
model, an access-control list, a retention policy and an export path — none of
which the problem needs.

The problem is calendar-shaped. Every failure mode is *discovering too late
that something expired*; none of them is "I could not find the PDF" (R-007).
And the deadline is not the date people assume it is: a US passport valid for
ten years has a renewal deadline roughly six months before its validity
deadline, because carriers refuse entry on a short-validity passport and the
State Department needs 4–6 weeks plus mailing (R-006). Two states already
issued at 90 and 60 days respectively. Lead time is the load-bearing concept,
and it is not a constant — a UK licence from age 70 renews every 3 years, a
policy every 1.

The second half of the decision follows from the first. There is a strong,
cheap instinct to add `status: "expired"` to the row. That instinct produces
precisely the defect class this project has already paid for twice: **D34**, a
roll-up whose fields were never populated and which was therefore permanently
zero while compiling cleanly, and **D38**, an activity kind declared in a closed
taxonomy and never written. A status column is a *copy* of two other fields,
and a copy is a place for the three to disagree — with no query able to tell,
because the copy is what the query reads.

**Alternatives considered.**
- *Extend `taxDocuments`.* Rejected on four independent grounds, in §11.2: its
  `requirementId` is a key into a closed static country catalogue and a
  passport is in no such catalogue; `readinessScore` maps that id back to a
  catalogue entry, so a non-catalogue row scores as nothing; `by_owner_requirement`
  permits exactly one row per requirement, so two passports could not coexist;
  and it would couple a user domain object to Do-Not-Touch #1.
- *Store the document, with a file reference or an attachment.* Rejected: no
  part of the expiry chain needs it, and the Commons Library's own finding is
  that reusable digital IDs *enable* minimisation — the credential is presented
  on consent, not hoarded centrally (R-007). Panel already decided this once
  with ADR-013, which stores a private calendar event as the literal string
  `"Busy"`. The safest data is the data that was never stored.
- *Store a `status` column.* Rejected as described above: a second copy of
  `expiresAt` and the renewal task, with no mechanism that can detect drift.
- *Express renewal as `tasks.recurrence`.* Rejected: a fixed cadence is wrong
  for every document whose validity period is not that cadence, and it keeps
  firing from a date a renewal has already replaced.
- *Per-country, per-document-type lead times in a catalogue.* Rejected: that is
  `tax.ts` again — a table of figures this project cannot audit at source, and
  Do-Not-Touch #1 exists because unverifiable figures are a liability rather
  than a feature. The default is labelled as a default and is per-document
  overridable.
- *A `date-unknown` state distinct from `undated`.* Rejected: it changes no
  behaviour, and a state with no behaviour is a field that can go stale.

**Why chosen.** Every state is a function of two stored values, so it cannot
be wrong. The one genuine hazard — the user completing the renewal task through
the ordinary dashboard checkbox, which trains the model correctly and never
touches `expiresAt` — is *detected* by the same derivation, as `stale`, and
stated on the surface. The design turns the most likely silent failure into a
visible state instead of trying to prevent it with a special case in a general
mutation.

**Consequences.**
- Adding a state means adding a branch to one pure function and a fixture for
  it. It never means a migration, and it can never leave existing rows behind
  in a state the code no longer produces.
- `stale` is a state the product arguably did not need, and it exists purely
  because the honest alternative was to hide a data-integrity failure.
- `expiresAt` may be absent, and a document with no date is *valid, watched,
  and silent*. That is a real answer, not a missing one.
- A renewal completed late — producing an expiry already in the past — is
  allowed, and correctly reads as `expired`. A renewal that does not *advance*
  the date is refused outright.

**Conditions for revisiting.** Revisit if a user-visible need appears for
renewal history beyond the new expiry date (a `renewals` list is the additive
answer, not a status column), or if a storage integration is ever approved —
which would be a new ADR superseding this one on the first decision, not an
amendment.

### ADR-026 — The renewal is an ordinary task that points at the document

**Status:** Active. Recorded 2026-10-01, with phase 3 feature 3 (CHANGE-0015).
Extends ADR-008, ADR-009, ADR-023; mirrors the `tasks.personId` decision of
phase 3 feature 1.

**Decision.** `tasks` gains `documentId` and `by_owner_document`. The renewal
is a normal task row; **the document holds no reference to it**. Every read of
"does this document have a renewal, and is it open?" goes through
`by_owner_document`.

**Context.** The obvious alternative is the reverse: `documents.renewalTaskId`,
kept up to date by whatever creates and deletes the task. It fails in three
ways that only show up after the feature has been used for a while. The lookup
becomes a reverse scan rather than an index range. Tasks are created, completed,
respawned and deleted constantly, so the document has to be patched on every one
of those paths — including `setTaskCompleted`, which is not this feature's code.
And a document whose `renewalTaskId` points at a deleted task is a row that
cannot answer a question about itself.

This is the same shape as `tasks.personId`, and the same reasoning as ADR-023:
**nothing rewrites anything, and every read resolves through the relation.**
Keeping it identical means the second half of the feature needed no new
mechanism at all — it reused a decision that was already made and paid for.

**Alternatives considered.**
- *`documents.renewalTaskId`.* Rejected as above.
- *A `renewals` table — one row per renewal attempt, with its own status.* It
  is a second task lifecycle, a second set of states, and a second thing to keep
  consistent with the first. Everything it would hold, `tasks` already holds.
- *A `links` row with `occursBefore` or `partOf`.* Rejected: ADR-008 is explicit
  that `links` holds relationships only and that anything needing to be *queried
  by* must be a typed indexed column. "Which task is this document's renewal?" is
  exactly a query, and the vocabulary happens to contain a plausible-looking
  rel that would have been the wrong tool.
- *No link at all — renewal is a task the user titles by hand.* Rejected: then
  nothing can tell that "Renew passport" concerns the passport, the attention
  rule cannot avoid double-reporting, and completing it cannot move the expiry.

**Why chosen.** The renewal inherits the entire task lifecycle for free — hard
rules, the learned ranker, recurrence handling, completion training through
`recordOutcome`, the dashboard checkbox — and it costs one optional column and
one index. Feature 1 already established that this direction works, and reusing
it is the reason the feature fits its budget at all.

**Consequences.**
- `deleteDocument` clears `documentId` on the document's tasks instead of
  deleting them, and reports how many it detached. Do-Not-Touch #9: never
  delete user data as a side effect of another action.
- The renewal task is created in `area: "general"` on purpose, so it appears in
  the user's main task list whether or not they enabled the `life` area.
- `completeRenewal` calls `recordOutcome` — it is a second **caller** of the one
  weight-mutation point (Do-Not-Touch #8), never a second writer.
- Because the renewal is an ordinary task, a user *can* complete it the generic
  way. That is allowed on purpose, and `stale` exists to make the consequence
  visible.

**Conditions for revisiting.** None foreseeable. If renewals ever need to
outlive the task — an application number, a fee paid, a reference — that is
fields on the task, not a new table, until the fields stop being about an act
the user is doing.

### ADR-027 — A commitment is an expectation with a direction, and an inbound wait is not a task

**Status:** Active. Recorded 2026-10-01, with phase 3 feature 4 (CHANGE-0016).
Extends ADR-008, ADR-009, ADR-023, ADR-026; evidence in R-008 and R-009.

**Decision.** One `commitments` table with a closed `direction` of `owed` or
`owedTo`. A row is an expectation between the user and one person: a title, a
counterparty, an optional expected date, and the user's own assertion that it is
settled. **Panel never creates a task for a commitment**; a task appears only
when the user presses Follow up, and following up does not settle the
commitment. Four lifecycle states, all derived, no status column.

**Context.** The roadmap line reads "Commitments + Waiting On", which reads like
two features. The audit found that one of them *cannot* be a task and the other
only barely can.

The decisive fact is mechanical. `taskRules` emits `task.overdue` and
`task.imminent` for any open dated task. If "waiting for Raj to send the
contract" were stored as a task, Panel would say it is overdue — about something
the user is physically unable to do. That is worse than silence, because it
teaches the reader to ignore the feed. Every published definition of GTD's
Waiting For list puts it *outside* the action list for exactly this reason.

A commitment is a weaker case but still a real one. `tasks.personId` already
carries "an obligation to Raj", and honestly that is most of it. What a task
cannot say is that the user has **already spoken for it**. The obligation is a
fact about a relationship, not about a chore, and the difference is worth one
row — not worth a second task system.

The second half of the decision is a refusal. Panel **records the user's
assertion**; it does not know what Raj did. For `owed` the user did the thing
and Panel knows. For `owedTo` nobody in the system observed anything, so the
surface says *"you marked this received"* and never *"Raj sent this"*. A
product that says otherwise is making a claim about a third party it has no
evidence for, and that is the line this whole project has refused to cross since
ADR-013 stored a private calendar event as the literal string `"Busy"`.

**Alternatives considered.**
- *Two tables, `commitments` and `waits`.* Rejected: identical schema, identical
  lifecycle, identical surface, differing by one field. Two tables is the shape
  a feature takes before it has decided what it is.
- *Model waiting as a task with an assignee.* Rejected above, and it is the one
  option that produces actively wrong advice.
- *No table; store an inbound wait as an undated task.* Rejected: undated tasks
  are ranked by the scorer and never become attention, so a delegation would be
  invisible forever — a silent failure of exactly the D38 shape.
- *Use `links` with the existing `waitingOn` / `owedBy` relations.* Rejected:
  ADR-008 is explicit that `links` holds relationships only and that anything
  needing to be **queried by** must be a typed indexed column. "Which
  commitments do I owe?" is a query.
- *Derive `owed` entirely from tasks with a `personId`.* Rejected: it cannot
  distinguish "I told Raj I'd send it" from "I might send Raj something", and it
  leaves the promise with no place to record that the user spoke for it.
- *Train the model on kept commitments.* Rejected, and this one matters. For
  `owedTo`, "completed" is an **assertion**, not an observation. Training on it
  would teach the model that things work out — which is not a preference the
  model can act on, and would be a D34-shaped signal that is always subtly
  wrong rather than obviously empty.

**Why chosen.** One table serves both directions, the state machine is one pure
function, and the single discriminator is the thing that actually differs: who
holds the next move. That discriminator is also what selects the attention
section — `people` for what the user owes, `waitingOn` for what they wait on —
so both sections were designed for this and neither is new.

**Consequences.**
- The `waitingOn` attention section, built in phase 1.0 with a budget, a
  half-life and a counterparty grouping dimension, finally has a producer.
- A completion means two different things depending on direction, so **the
  wording carries the honesty**, not the code: "you marked this received" versus
  "you told Raj". A fixture asserts the exact strings.
- Deleting a person **detaches** their commitments rather than deleting them, and
  reports how many — Do-Not-Touch #9, and the same rule `deleteDocument` uses.
- A merge rewrites nothing, exactly as ADR-023 established for tasks, so unmerge
  is exact and a merged-away person still resolves.
- No feature index is spent. The follow-up task is an ordinary task and trains
  through the existing path; nothing new enters the frozen layout.

**Conditions for revisiting.** Revisit if Panel ever gains a source that can
*observe* a delivery — an inbox thread that actually arrived, a payment that
actually settled. At that point `owedTo` completion stops being an assertion and
becomes evidence, and the whole no-learning decision above would need reopening.
That is a security-shaped question, not an engineering one, and it is not close.

### ADR-031 — Transactions are facts, and a balance is a query

**Status:** Active. Recorded 2026-10-02 by explicit product decision (Q-008).
**Supersedes ADR-028** on the transactions-and-balance question only; ADR-028's
label-and-closed-kind decision is retained and extended. Amends §2.3.

**Decision.** Panel may hold **first-class transactions**: rows a user typed
(`source: "manual"`) or a deterministic import produced (`source: "import"`).
Three rules make a transaction a *fact* rather than a ledger row:

1. **Money is an integer.** `amountMinor` is an integer count of minor units
   (cents, pence). No transaction amount is ever a float. `expenses.amount`
   remains a float and is not migrated; **no arithmetic crosses between the two
   without an explicit conversion at the boundary**, and that conversion lives in
   one pure function.
2. **A balance is derived, never stored.** `balance = Σ signed amountMinor` over
   the `by_account_postedAt` range, computed at query time. There is no balance
   column, because a stored balance is the thing that drifts from the bank with
   nothing to check it.
3. **No accounting.** No journal entries, no debit/credit, no double-entry
   invariants, no reconciliation or matching engine in the first version, and no
   claim to be the system of record for a bank.

**Context.** ADR-028 said "a transaction is a ledger row — an account with a
balance is a ledger with extra steps". That reasoning was correct about a
*balance* and was over-generalised to a *transaction*. A fact the user typed on
2026-10-02 with a date, a label and an amount is not an accounting system; it is
a note about money that happens to be queryable. What made ADR-028 right was the
stored balance, and this ADR keeps that part untouched. Research supports the
distinction: integer minor units are the universal money-storage practice, and
import systems that reconcile per-row against a stored balance are solving a
problem Panel has declined.

**Alternatives considered.**

- *Keep §2.3 and reject transactions entirely* — rejected: manual entry and
  import are what the product owner asked for, and eight of the ten outcomes a
  user wants from "read my statement for me" (recurring-charge detection,
  totals, period, anomalies, tax figures) need no transaction row at all.
- *Allow transactions with a stored balance* — **rejected.** This is the one
  variant that would make Panel a ledger with extra steps, and it is exactly the
  failure ADR-028 was written to prevent. Derived-only is the price of the
  feature, and it is a cheap one.
- *Adopt fuzzy duplicate matching on import* — rejected. It presumes OCR-grade
  noise and it merges records on resemblance, which is the failure ADR-024
  already forbade for people. Imports deduplicate on an exact deterministic key.

**Consequences.** Panel can answer "what did I spend", "what is left in this
account" and "what recurs" from facts it owns. It still cannot reconcile, cannot
transfer, cannot value a portfolio and cannot file anything. Finance gains two
tables (`transactions`, `imports`) and its first two dependencies, which ADR-016
makes an explicit stop condition rather than a note. The agent framework is
unaffected: `AgentAction` remains `{kind:"flag"} | {kind:"log"}`, so no agent
can write a transaction.

### ADR-028 — An account is a label, never a balance

**Status:** SUPERSEDED BY ADR-031 (2026-10-02) on the transactions-and-balance
question only. Retained below as the historical record: the label-and-closed-kind
decision is **still active**, and the reasoning about a *stored* balance is
adopted verbatim by its successor. Originally recorded 2026-10-01 with phase 3
feature 5 (CHANGE-0017). Extends ADR-013, ADR-024, ADR-025; evidence in R-010
and §2.3.

**Decision.** An `accounts` row holds a user-chosen **label** and a closed **kind**
(`checking` | `savings` | `cash` | `credit` | `investment`). It holds **no
balance**, no account number, no sort code, no institution identifier and no
transactions. An account exists so that a recurring obligation can be grouped by
where the money leaves from, and for nothing else.

**Context.** The roadmap line for Finance expansion reads "Accounts,
subscriptions", which read alone is a request for a bank. The audit found the
opposite problem: Panel has no account object at all, but it also has no business
having one, because every field a real account needs is a field Panel cannot
verify and cannot keep current.

A balance is not a fact. It is a derived value over a set of transactions, and a
transaction is a ledger row. So an account with a balance is a ledger with extra
steps, and §2.3 names the ledger as the thing Panel must not become — the research
conclusion being that these products *stop where an action is needed*, and that
Panel's whole value is the part after that point. Building the number and
skipping the action would invert the thesis.

The minimisation argument is the same one ADR-013 used for a private calendar
event. A private meeting is stored as the literal `"Busy"`; the safest data is the
data that was never stored. The safest account is one that cannot be drained,
because **no column exists to type a number into**. A user who wants a balance has
YNAB; a user who wants to know what renews on the 14th does not, and Panel now
answers that question.

**Consequences.**
- The Finance area can group by account and total by account, and that is the
  ceiling of what an account is for.
- There is no reconciliation problem, because there is nothing to reconcile
  against. That is the point.
- **Deleting an account detaches** its subscriptions and reports the count, and
  deletes nothing else — the same rule `deleteDocument` and `deleteCommitment`
  use, so a user cannot lose an obligation by tidying a label.
- An account is **not** a place to put a credit card, a bank login or a merchant
  token. If a future feature needs a payment instrument, that is a new decision
  with a new threat model, not an extra column here.

**Conditions for revisiting.** Revisit when Panel has a source that can *observe*
a balance — a real bank connection. At that point the number is evidence rather
than an assertion, and the no-ledger decision would need a real argument rather
than a product one. That is blocked on credentials and on D32 regardless.

### ADR-029 — A subscription owns its renewal document; expiry logic is never duplicated

**Status:** Active. Recorded 2026-10-01, with phase 3 feature 5 (CHANGE-0017).
Extends ADR-025, ADR-026, ADR-027.

**Decision.** A `subscriptions` row carries a `documentId` pointing at a real
`documents` row, and `createSubscription` **creates that document in the same
mutation**. Every read resolves through the pointer. `src/lib/subscriptions.ts`
computes annual cost and time remaining; it contains **no** expiry or
attention logic of any kind.

**Context.** The obvious implementation of "a subscription renews" is a
`renewsAt` column on the subscription and a new attention rule that reads it. That
builds a second expiry model alongside the one feature 3 shipped, and the two
disagree the moment a lead time, a window or a boundary case is fixed in one and
not the other — which is exactly the failure ADR-025 was written to prevent, and
which F3's acceptance criteria specifically guarded against with "one renewal,
one item".

Composing instead is nearly free. `documents` already models label → expiry →
derived seven-state lifecycle → renewal task, `document.expiring` already fires,
and `by_owner_expiry` already narrows the attention read to exactly the documents
that have an expiry. A subscription needs three of those fields and is missing
only **amount** and **interval** — and a passport has neither, which is why the
money cannot go on `documents` and the composition has to point rather than merge.

**Consequences.**
- **Panel adds no attention kind, no section, no rule and no read** for this
  feature. `getAttention` is unchanged. The cost of a subscription in the feed is
  zero new query work, which is the direct answer to the D42 lesson.
- There is exactly one producer of "this is expiring", so the F3 anti-duplication
  guard is preserved rather than re-litigated on every future renewal-shaped
  feature.
- Cancelling a subscription **cancels its document**, and deleting it detaches
  the document rather than deleting it, so a renewal chain cannot be orphaned
  pointing at a row that no longer exists.
- A subscription cannot be created without a document, so a subscription with no
  expiry is expressible (the document simply has none) and a subscription with a
  document Panel forgot about is not.

**Conditions for revisiting.** Not close. The next renewal-shaped feature —
insurance, a loan, a licence — composes this way too, which is what makes the
decision cheap rather than merely correct.

### ADR-030 — Convex cron is the only scheduler, and an agent with a producer is not reimplemented

**Status:** Active. Recorded 2026-10-01, with phase 3 feature 6 (CHANGE-0018).
Implements ADR-011; extends ADR-009, ADR-012, ADR-016.

**Decision.** Two things, both of them refusals as much as constructions.

**1. The scheduling mechanism is Convex's own cron, declared in one place.**
`convex.config.ts` holds exactly one scheduled function — `agents/daily`,
`0 7 * * *`, calling `internal.agents.internalRunDueSpaces`. There is no
external scheduler, no queue, no Redis, no worker, no second backend and no
plugin registry. A space is enrolled by an explicit user action **and** gated on
the `debug_agents_v1` feature flag, which is re-checked on every run; a space is
found due through the `by_nextAgentRunAt` index range, so a space that has not
opted in is not merely skipped — it is not in the range at all. Clearing
`nextAgentRunAt` removes the document from the index, which is Convex's own
documented behaviour for an absent indexed field, so switching agents off is a
single patch with no second source of truth to keep in step.

**2. The registry holds one agent.** Five of the six §6.1 agents are **not**
implemented, because each already has a producer:

| §6.1 agent | Existing producer |
|---|---|
| `recurringRespawn` | `assistant.spawnNextOccurrence` (0A) |
| `documentExpiry` | the `document.expiring` hard rule (CHANGE-0015) |
| `commitmentOverdue` | `commitment.overdue` / `.waiting` (CHANGE-0016) |
| `applySync` | `integrations.internalApplyBatch` (ADR-012) |
| `recurringPayment` | needs accounts and transactions — unapproved Finance work, and §2.3 forbids the ledger |
| `relationshipReminder` | needs a relationship model Panel does not have |

The one implemented agent is **low-confidence finance review**, and it is a
proposal-only agent: it reads, it adds up, and it reports. It cannot mark
anything deductible, change a tax profile, create a transaction or take any
external action.

**Context.** The specification had a gap that was not visible from the agent
list. §6 described the agent model and §6.1 named six agents, so reading the
spec alone, six agents is the work. The audit found that five of the six would
have been **second producers** for events something already reports — and
feature 3's own acceptance criteria forbid exactly that outcome in one sentence:
*one renewal, one item*. Building them would have been a violation of a
criterion committed in the name of satisfying a specification.

The real gap was the absence of a **when**. Panel's intelligence is entirely
computed at query time (ADR-003): nothing ever looks at anything on the user's
behalf, so a user who does not open the app is never told anything. That is a
product gap, and no amount of agent code closes it without a scheduler.

**Consequences.**
- **Cron cannot widen authority.** A cron invocation carries no user and no
  capability. The tier is a return type in `src/lib/agents.ts`, and the
  `automatic` variant's action union is `{kind:"flag"} | {kind:"log"}` — there is
  no variant that can write a financial row, so an agent that tried would not
  compile. That is a stronger statement than any comment in the runner.
- **A scheduled process in this product cannot act on money at all.** Not
  *does not*, *cannot* — the type has no such operation. "I have looked" on a
  proposal records an acknowledgement and stops; confirming a category stays an
  act the user performs in the Expenses list.
- **Exactly one producer per event is preserved**, so the anti-duplication guards
  from features 3 and 4 are structural rather than re-argued per feature.
- **Overflow is observable, not merely stored.** The caps are §6.1's 10 per run
  and 50 per space per day, and excess is returned as a **count** by
  `applyCaps` rather than truncated. `getLastRun` surfaces that count to the
  owner, because a cap that silently discards work is a cap nobody can debug.
- **A failure is recorded and retried once, not in a storm.** One `catch` in the
  batch loop, a 200-character message with no stack and no arguments, the batch
  continues, and `nextAgentRunAt` advances after the attempt so the space is
  retried tomorrow exactly once. There is no backoff queue, because there is one
  attempt per space per day by construction.
- **The daily cadence is the smallest practical one.** Hourly polling for a
  review whose input changes when the user does something would buy nothing and
  cost a wake-up.
- **The five absent agents are documented, not forgotten.** They are listed in
  the module header beside their real producers, so the next person to read
  `REGISTERED_AGENTS` learns why it is short.

**Conditions for revisiting.** Revisit the *cadence* if a future agent needs to
be timely within the hour — the mechanism is a cron expression and nothing else
depends on it. Revisit the *scheduler itself* only if the work outgrows a single
bounded mutation, which would mean an agent doing something Panel has not
approved. Revisit an individual absent agent only when its event has **no**
producer, not when it has a weak one: the bar is one producer per event, not one
agent per name in a list.

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
| **N1** | Duplicate `assistantState` row breaks the dashboard permanently. Two concurrent completions both insert; `.unique()` then throws in `getDashboard` and `getModel`. | **RESOLVED and VERIFIED (CHANGE-0006, re-verified CHANGE-0011)** — does not occur. The concurrency test has now fired 1,792 simultaneous mutations across 36 rounds against a live deployment with zero duplicate rows; a negative control proved the detector reports a real duplicate. Decision recorded in **ADR-022**; ADR-017 superseded. | `src/convex/assistant.ts` (`recordOutcome`) | Closed |
| **N2** | Guest accounts have no claim path → silent data loss on account upgrade. | `src/pages/Auth.tsx:83-95` | Phase 0A (ADR-018) |
| **N5** | `rankTasks` returned `score: -Infinity` for completed tasks. | **RESOLVED (CHANGE-0005)** — `COMPLETED_TASK_SCORE = -1_000_000` is finite, so the value survives serialisation regardless of how Convex handles `-Infinity`. | `src/lib/scorer.ts` | Done |
| **N7** | No enum validators: `area`, `bucket`, `recurrence`, `provider`, `country`, `status`, `priority` are bare `v.string()` / `v.number()`, with `schemaValidation: false`. | **RESOLVED (CHANGE-0008)** — ten closed unions in the schema and `schemaValidation: true`. `recurrence` is the one deliberate exception: its grammar is parameterised (`every:3:week`) and cannot be a Convex literal union, so it is enforced at its single write path in `src/lib/nlp.ts` and the reason is recorded in the schema. | — | Done |
| **N4** | Query idiom is "collect everything, filter in JS": `getAreaTasks` (hot path), `toggleDocument`, `connectTool`, `disconnectTool`, `disableArea`, `getFinance` expense year filter. | **RESOLVED (CHANGE-0007)** — all six are index ranges now. `getAreaTasks`, `disableArea`'s task sweep, `toggleDocument`, `connectTool`, `disconnectTool` and `resolveArea` use compound `by_owner_*` indexes; `getFinance`'s year filter is over a bounded per-user expense set and is left as-is. | — | Done |
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
| D7 | `AssistantDoc` uses `any` for `_id` / `userId` — a documented workaround for a `DataModel["table"]` wrapper-type issue. | **RESOLVED (CHANGE-0007)** — both are now `Id<"assistantState">` and `Id<"users">`. |
| **D14** | `getFinance` returned the raw `COUNTRIES` entry, which contains two function properties. Convex cannot serialise a function, so the query threw on every call and the whole Finance area was dead. | **RESOLVED (CHANGE-0007)** — found by `scripts/conformance-0b.ts`, not by inspection. The country is now projected to its scalar fields and the two computed values are resolved server-side. | `src/convex/life.ts` | Done |
| D15 | `getDashboard` still loads every task a user has ever created, then ranks in memory. | Unbounded `.collect()` is fine at personal scale; scheduled with D2 before Phase 1.0, when Attention needs a bounded working set. |
| **D16** | `learningRateFor` returned `NaN` for a `NaN` sample count. | **RESOLVED (CHANGE-0008)** — the count is sanitised, because a `NaN` rate poisons every weight written after it. |
| **D17** | `snapshotReason: "automatic"` was unreachable: restore points only existed if the user explicitly reset the model. | **RESOLVED (CHANGE-0008)** — an automatic restore point is taken every 25 labelled events, inside the same transaction as the update it captures. |
| D18 | Mutation *arguments* for catalogue values (`enableArea({slug})`, `connectTool({provider})`, `saveTaxProfile({country})`, `addExpense({bucket})`, `addTask({area})`, `getAreaTasks({area})`) are `v.string()` and are narrowed inside the handler, rather than being Convex literal unions. | Deliberate. The client legitimately holds these as plain strings from the catalogues in `src/lib`, and a boundary rejection would surface to the user as an opaque argument error instead of "Unknown area". The *storage columns* are closed unions, so nothing invalid can be written, and each handler throws a plain-language error. Widening the arguments to unions is a natural follow-up once `src/lib/areas.ts` and `src/lib/tax.ts` export the literal types. |
| D8 | `requireUserId` duplicated in `assistant.ts` and `life.ts`. | **RESOLVED (CHANGE-0005)** — `life.ts` imports the exported helper. |
| D9 | Stray `}` after the `--sidebar-ring` block in `src/index.css`. Harmless; CSS compiles. | Cosmetic. |
| D10 | No test files exist. The three original harnesses (`parse-check`, `scorer-check`, `tax-check`) passed and were deleted, taking all regression protection with them. | **RESOLVED (CHANGE-0005)** — 102 fixtures. |
| D11 | `package.json` has no `test` script. | **RESOLVED (CHANGE-0005)** — `bun test` runs the suites directly; no script needed. |
| D12 | **`bun run lint` fails at baseline: 12 errors, 19 warnings.** All pre-existing, in `src/hooks/use-mobile.ts`, `src/lib/nlp.ts`, `src/main.tsx`, `src/pages/Dashboard.tsx`, `src/convex/assistant.ts`, `src/convex/life.ts`, `src/convex/_generated/*`, `vly-toolbar-readonly.tsx`, and stock shadcn components. **Zero in `spec/` or `scripts/`.** | Gate is "no NEW problems" until a cleanup phase. See CHANGE-0003. CHANGE-0005 reduced this to 10 errors / 19 warnings; CHANGE-0007 to 7/19; CHANGE-0008 to **3 errors / 19 warnings**. CHANGE-0009 held it at 3/19. |
| **D19** | `connectionRules` gated `connection.unfinished` behind the 48-hour staleness window, so a freshly-created, never-finished connection could never surface. The rule was unreachable in exactly the case it existed for. | **RESOLVED (CHANGE-0009)** — unfinished fires immediately at severity 0.5; quiet still requires 48h. Covered by a unit fixture and by the live conformance run. |
| **D20** | Acting on, or dismissing, an item was treated as if it removed the item. It does not: a task disappears because it is completed, a statutory deadline because time passed. | **RESOLVED (CHANGE-0009)** — acting on and dismissing now only record a signal. Named unit test and named conformance section. Reinforces ADR-006. |
| **D21** | The live tenant-isolation check in `scripts/conformance-attention.ts` raised a false positive: statutory tax deadlines are global by construction, so their ids are identical across users. | **RESOLVED (CHANGE-0009)** — the check now separates `isUserOwned` source ids from global ones instead of asserting that no id may repeat across accounts. |
| **D22** | Escalation reused the *ranking* severity, which reaches 0.93 for anything due within ~6h. Ordinary scheduled work silently became level 2, i.e. undismissable. | **RESOLVED (CHANGE-0010)** — a ranked item's escalation input is capped at 0.85. Level 2 is reserved for the hard rules, which own the four-hour window; a ranked item is never inside it. Found by the phase's own fixture. |
| **D23** | `tanh(NaN)` returned -1, turning a bad score into "strongly dislike" — worse than the NaN that caused it. | **RESOLVED (CHANGE-0010)** — returns 0, meaning "no opinion". Same reasoning as D16. |
| **D24** | The 1.0 conformance harness measured the Today cap using ranked work that a category rejection had just muted, so it was measuring suppression and reporting it as a cap failure. | **RESOLVED (CHANGE-0010)** — it now floods with overdue work, which cannot be suppressed, making it a pure cap test. A harness bug, fixed rather than re-run. |
| **D25** | `getAttention` re-read the whole task set to build ranked items, duplicating a scan `getDashboard` already performs. | **RESOLVED (CHANGE-0010)** — the same single read is reused to build both `hardRules` and `learnedCandidates`; no second query was added. |
| **D26** | `getUserIdentity().subject` is a composite `"<issuer>|<token>"` string, not a Convex id. Casting it type-checked and then failed schema validation on `spaces.createdBy`. | **RESOLVED (CHANGE-0011)** — `getAuthUserId` from `@convex-dev/auth/server` is the correct call. Only possible to find under `schemaValidation: true` (CHANGE-0008), which is the argument for turning validation on before it is comfortable. |
| **D27** | Scope enforcement was a denylist of mutating words. Google's `calendar.events` grants write access and matches none of them, so a genuinely mutating scope passed the check. | **RESOLVED (CHANGE-0011)** — an allowlist of known read-only scopes plus read-only suffixes, failing closed on anything unrecognised. Confirms ADR-013's "minimum scope" was a statement, not an enforcement, until now. |
| **D28** | Provider-supplied expense categories were cast to the closed `expenseBucket` union, so any non-Panel value would have been a schema-validation failure at write time — a crash caused by someone else's data. | **RESOLVED (CHANGE-0011)** — `narrow()` maps to the closed vocabulary with an explicit `Uncategorised` bucket and `medium` confidence. |
| **D29** | The ADR-022 OCC conformance suite's negative control seeded a state row into a user that had none, so it wrote the *first* row and asserted two — reporting failure against a detector with nothing to detect. | **RESOLVED (CHANGE-0011)** — a real state row is created before the duplicate is seeded. The control passes and the PASS is interpretable again. |
| **D30** | `finishConnect` was a mutation calling `adapter.exchangeCode`, which performs `fetch`. Convex mutations must be deterministic, so the documented OAuth completion path could never have run. | **RESOLVED (CHANGE-0012)** — the flow is now an httpAction (receives the redirect, performs the exchange) plus an internal mutation (consumes the state and stores the tokens atomically). Found by writing the real flow; no test could have found it, because nothing could reach the network. |
| **D31** | `markDerivedOrphaned` tested `task.orphanedSource === false`, which is almost never true — the column is optional and `addTask` never sets it to `false`. The §7.2 orphan flag was effectively never set. | **RESOLVED (CHANGE-0012)** — `task.origin === "integration" && task.orphanedSource !== true`. |
| **D32** | **This deployment serves no application HTTP routes.** Every path 404s, including Convex Auth's OIDC discovery endpoint and its own `addHttpRoutes`, which predate this work. `/` and `/version` answer because they are Convex's built-ins. The push succeeds and Convex validates the router, so the module is deployed — the backend does not serve it. | **OPEN — ENVIRONMENT, not code.** Consequence: the OAuth redirect cannot be exercised live. Both conformance harnesses report that section as `[SKIP]` with this reason rather than as a pass. The handler's decision logic is covered by unit fixtures; only the transport is unverified. Needs an answer from the platform owner: does this deployment type serve HTTP routes at all? |
| **D33** | `applyBatch` reported `deletes` as the diff's count of removals, including rows kept and flagged `cancelled`. | **RESOLVED (CHANGE-0012)** — the counts now separate `deletes` (rows actually removed) from `cancelled` (rows kept and flagged). Found by the phase-2 harness, which expected the honest number. |
| **D34** | **`SOURCE_FIT` (index 9) and `PEOPLE_FIT` (index 10) could never receive evidence.** `recordOutcome` typed its `task` parameter as `{ ..., source?, person? }` and was called with the raw row, whose fields are `origin` and `personId`. Both optional, so nothing failed to compile and nothing threw: the roll-ups saw `undefined` every time and returned the counter map unchanged. The two features were identically 0 at training and at inference, so their weights never took a gradient. Two slots in a frozen, versioned feature layout carried no information at all, and no existing test could see it — every one asserted that the *mechanism* worked, and the mechanism was working perfectly on an input that was always empty. | **RESOLVED (CHANGE-0013)** — the feature object is built once in `featuresOf()` and the *same* object goes to both `extractFeatures` and `recordOutcome`, which now takes `TaskFeatures`, so a field rename is a compile error rather than a silent zero. Layout untouched: `FEATURE_COUNT` 12, `WEIGHTS_VERSION` 1, indices 0–7 unchanged, nothing migrates, no stored vector is re-based. Found by the phase-3 harness asserting acceptance criterion 5 against a live deployment. |
| **D35** | `normaliseKey` was applied to email addresses, turning `raj@ex.co.uk` into `raj ex co uk` — nonsense on screen, and a key that collides with what a name of the same words would produce. A related docstring claimed "O'Brien" and "OBrien" normalised alike; they do not, and should not. | **RESOLVED (CHANGE-0013)** — `normaliseEmailKey` keeps the structure of an address. The name normaliser's conservatism is now the documented, fixture-pinned intent: under-matching costs a second row, over-matching costs a wrong merge, and RJD-004 makes the conservative direction the correct one. Found by the new unit fixtures. |
| **D36** | `spawnNextOccurrence` rebuilt the task row field by field and did not copy `personId`, so completing "call Raj every week" produced a follow-up belonging to nobody — the REQ-017 failure mode, reproduced for a new field. | **RESOLVED (CHANGE-0013)** — `personId` is copied forward. Safe in a way copying identity keys would not be: a tombstone resolved on read still reaches the same person. |
| D13 | `toMondayIndex()` in `src/lib/nlp.ts` is defined but never used. | **RESOLVED (CHANGE-0005)** — removed. |
| **D38** | **The activity taxonomy is a superset of what is actually written.** `task.created`, `task.deleted`, `note.created`, `expense.added`, `capture.committed` and `commitment.made` are declared in `activityKindValidator` and written by nothing: `addTask`, `removeTask`, `addNote` and `addExpense` insert their object rows and no activity row. Nothing is visibly broken — the 7-day chart reads only `task.completed`, which *is* written, and a closed union wider than the writes cannot itself be invalid data. But it is a specification claim the code does not meet, and it is the same shape as D34: a path that compiles and promises an effect that never happens. | **PARTIALLY RESOLVED (CHANGE-0014)** — `capture.committed` is now genuinely written, once per accepted capture with the real segment count, and read back by `assistant:captureAudit` so the claim is checkable. The remaining four are **deliberately left unwritten and deliberately left declared**: no query reads them, and an activity timeline that only records what a query already knows is not worth the write. Recorded rather than quietly fixed so the gap between the taxonomy and the code stays visible instead of becoming folklore. |
| **D39** | `assistant:captureAudit` read `activity` across **every space in the deployment** and filtered the caller's own in JavaScript — a table-wide `.collect()` on a read path, reintroduced by the same agent that had just audited for exactly that in phase 3 feature 1 (D37). | **RESOLVED (CHANGE-0014)**, same change. One indexed range per space via `by_space_at`, bounded at 500 rows. Found in self-review, not by a test — a test that only checked the audit row *exists* would have passed against the unbounded version. The lesson is recorded: a bounded read needs a fixture that would notice an unbounded one, and there is not yet one. |
| **D40** | The Life Admin `stale` rule fired **only when the document had already expired**. The ordinary case went unreported: renewing early — which is exactly what R-006 tells people to do — ticking the task off, and the expiry never moving all read as ordinary progress. | **RESOLVED (CHANGE-0015)** — the rule is now stated as *the expiry is not later than the moment the user said they renewed*, which covers both a late renewal and a forgotten date. Found by the **live conformance harness, not the unit suite**: every unit fixture for `stale` used an already-expired document, so 37 fixtures were satisfied by a rule that missed what users actually do. The lesson is recorded because it is the third time a fixture set that only exercised the extreme case has hidden a defect (D34, D38, and now this). **A boundary is accepted**: an *early* renewal whose date never moved is still not detectable without storing the previous expiry, which ADR-025 rules out; the surface shows the completed renewal and the expiry side by side instead. |
| **D41** | `documents:listDocuments`, `documents:getExpiring` and `attention:getAttention` each resolved renewal tasks **once per document** — an N+1 worth up to 200 queries on a reactively-subscribed query. The same defect class as D37 and D39, introduced by the feature that had just audited for it. | **RESOLVED (CHANGE-0015)** — one owner-scoped `tasks.by_owner_document` read per query, grouped by `documentId` in JavaScript. The database has already scoped the set, because Convex omits a row from an index when the indexed field is absent. Caught in self-review, not by a test, which is the third time that has been the only thing standing between this project and a regression it already knew about. |
| D37 | `listPeople` and `getPerson` read **every task the user has ever created** in order to count open items per person, on a reactively-subscribed query. | **RESOLVED (CHANGE-0013)** — a `tasks.by_owner_person` index. Convex omits a document from an index when the indexed field is absent, so that range holds exactly the tasks that name somebody, which is the entire input these two functions need. The read is now scoped by the index rather than by a filter over everything the user owns. The wider audit found every other `.collect()` in `src/convex` is already index-scoped to one owner or one space, which is the correct shape for a product where each user is their own tenant; a table-wide scan would be the defect, and there is none. |
| **D43** | **`getFinance` collected every expense the user had ever created** and filtered to the tax year in JavaScript, on a reactively-subscribed query. N4 closed this in phase 0B by recording the set as "over a bounded per-user expense set" — **that claim is false**. Owner-scoped is not bounded; an expense table only grows, and the Finance area is the one place a user adds a row casually and often. D42's exact shape, arriving a feature early. | **RESOLVED (CHANGE-0017)** — a `expenses.by_owner_spentAt` index on `(ownerUserId, spentAt)` read as a **range** over the tax year. The bounds are built with `new Date(year, 0, 1)`, i.e. **local time**, so the returned set is byte-identical to the `getFullYear()` filter it replaces on any UTC offset. A UTC range would have been tidier and would have moved the boundary day for every user outside UTC — trading an unbounded read for a silently wrong tax figure, which is the worse of the two. Found by the feature-5 audit, not by a test: no fixture could have caught it, because the function returned the *right rows*, just by the wrong mechanism. That is the sharpest version of the D42 lesson — **a collect-then-filter can be entirely correct in its output and still be the defect.** |
| **D44** | **`addExpense` accepted `NaN` and `Infinity`.** The guard was `if (args.amount <= 0)`, and `NaN <= 0` is `false`. `saveTaxProfile` had the mirror-image hole: `grossIncome < 0` is also false for NaN. A NaN amount poisons every bucket sum and then the whole `estimateTax` result — and NaN does not surface as an error, it surfaces as a **number**. A tax estimate rendered from a NaN input is plausible, confident and entirely invented, which is the single worst outcome in the most trusted calculation Panel makes. | **RESOLVED (CHANGE-0017)** — one guard, `Number.isFinite`, in `src/lib/subscriptions.ts`, used by all four money write paths, plus a `MAX_AMOUNT` magnitude ceiling. Two predicates rather than one because `grossIncome` is legitimately `0` and a subscription's amount is not. Found by the feature-5 audit, in the one place where it matters most, and **deliberately not "fixed" by migrating to integer minor units** — that would rewrite the input to a verified tax estimate, which is precisely the silent change to financial semantics that must not happen without asking. |
| **D45** | **`daysUntilRenewal` returned `-0`.** `Math.round` of a small negative fraction is `-0`, not `0`, and `-0` formats as "-0" and fails `Object.is(x, 0)`. A subscription one millisecond before its renewal date would have reported "negative zero days". | **RESOLVED (CHANGE-0017)** — normalised at the derivation. Found by a **unit fixture**, at the ±1 ms boundary, and by nothing else: no integration test would have surfaced a value that is arithmetically equal to the right answer. The boundary fixtures for `commitments` were written for exactly this reason and paid for themselves again. |
| **D46** | **`updateSubscription` wrote no activity row for a date-only edit.** The function returned early when the subscription's own patch was empty — which is *always* the case for a renewal date, because the date lives on the `documents` row the subscription points at (ADR-029). So `subscription.updated` was declared in the taxonomy and, for the single most common edit in the feature, never written. | **RESOLVED (CHANGE-0017)** — the early return now accounts for the document write. Found by the **live conformance harness, not the unit suite**, which is the second time in three features that the harness has caught something the fixtures could not: the unit tests exercise the pure machine, and this defect lives entirely in a mutation's control flow. It is D38's shape arriving one feature late — a declared kind that nothing writes — and the audit trail is only worth anything if the row is actually written. |
| **D47** | **Three `agent.*` activity kinds had been declared since phase 0B and written by nothing: `agent.proposed`, `agent.executed` and `agent.skipped`.** Feature 6 is the feature that finally had a producer, and it wrote **only one of the three.** | **PARTIALLY RESOLVED (CHANGE-0018) — and the remaining two are recorded as deliberate, not as an oversight.** `agent.proposed` is now written, once per new proposal, on the same path that inserts it. `agent.executed` and `agent.skipped` are **still unwritten by design**: the only registered agent is proposal-only and has no `automatic` actions to execute, and a run that skipped has no proposal to attach an activity row to — the `agentRuns` row already records `result: "skipped"` with the reason, which is the *right* place for the answer because a run is not an object and has no id. Writing `agent.skipped` against nothing, or inventing an object kind for a run, would be the D34 defect in a new costume. **Left in the taxonomy deliberately** rather than deleted: they are the vocabulary a future `automatic`-tier agent will need, the union is closed and validated, and an unused member of a closed vocabulary is not the same defect as an unused *claim* that something is being recorded when it is not. The honest statement is the split: one of three is now true, and the other two are reserved rather than pending. |
| **D48** | **`listProposals` collected every proposal the owner had and filtered to their space in JavaScript** — `by_owner` then `.filter(r => r.spaceId === spaceId)`. D42 and D43's exact shape, in the **newest module in the codebase**, written while both of those defect write-ups were open on the same screen. The filter added no safety: the space had already come from `by_createdBy` scoped to the caller, so it was not narrowing anything the index had not already narrowed. | **RESOLVED (CHANGE-0018)** — read through `by_space_at` in descending order, which is what the query wanted anyway, and the now-unused `by_owner` index **removed** rather than left behind (feature 3's rule: an index nothing reads is not a safety net, it is an invitation to read the wrong way next). Found in **self-review, not by a test** — the fifth time that has been the only thing standing between this project and a regression it already knew about. The harness passed either way, because with one proposal a filter and a range return the same row; the defect only appears at the scale the caps exist to prevent. **The pattern is now the general rule for this project: an index whose prefix already encodes the scope must not be followed by a filter on the same field.** |
| **D42** | **`getAttention` collected every commitment the user had ever made and filtered to the open, past-dated ones in JavaScript.** Not a table-wide scan — owner-scoped, so not the D37/D39 shape — but still a collect-then-filter, and on the *hottest* read in the product: the one that runs on every dashboard load and every attention feed tick. It also grows without limit as the user accumulates settled commitments, which is the one direction a personal history always grows. The §11.2 scope block had already asserted the shape the code should have (`by_owner_open` range, explicit `.take`), so the specification was right and the first implementation was not. | **RESOLVED (CHANGE-0016)** — a `commitments.by_owner_open` index on `(ownerUserId, completed, expectedAt)`, read as a range, so the database excludes settled and undated rows before anything is transferred. The lesson is now the general one rather than an instance of it: **for a derived-state query, assert the read is an index range in the acceptance criteria, not just a bounded collect** — a `.take(200)` cap hides an unbounded query from a reviewer exactly as effectively as no cap at all. The same fix removed the last `by_owner` collect from the attention path. Found by the feature's own criterion AC-3F-314, not by self-review — the first time in this project a criterion caught a performance defect rather than confirming one, which is the outcome the phase review asked for. |

| **D49** | **`writeNormalizedBatch` re-read the whole space for every changed object.** `loadStored` had already collected every synced `expenses` and `calendarEvents` row for the space; then `findByKey` collected **both ranges again** — once per patch and once per delete — to recover a single row and pick its `_id`. A batch of n changes cost n full space scans, and because each lookup returned one row the result looked bounded while the database access was not. Phase 2 code, written before D48 existed as a rule. | **RESOLVED** — the rows are already in hand, so they are indexed once by key (`rowsByKey`) and `findByKey` is **deleted**; `applyUpstreamDelete` now takes the row rather than a key. One full read per sync remains (see A6). No table, index, file, abstraction or dependency added: the fix is one function removed. Writes are byte-identical — phase-2 harness §7.2 still reports `cancelled 3 / deletes 1 / patches 0 / unchanged 0 / written 4` — because a mutation is serialisable, so the re-read could only ever return what `stored` already held, and `diffBatch` only emits `patch`/`delete` for keys that are in `stored`. **Found by the D48 audit finally reaching phase 2, not by a test — the sixth consecutive defect found by reading rather than by a failing assertion.** |

| **D50** | **The Health area displays data that does not exist.** `HealthArea` renders four habits from a module-level constant (`HABITS`, `src/components/Areas.tsx:1096`) against `useState` — there is no `habits` table (`grep -c habits src/convex/schema.ts` → 0), nothing is written, and every value is lost on reload. It is a mock presented as a feature, and it is the one area that most looks domain-specific while being the least real. | **RECORDED, NOT FIXED — product owner decision 2026-10-02: leave it alone for now.** Fixing it properly means a new table, a budget and an approval, and removing it means deleting a tab a user can see. Neither is a defect *repair*; both are phase work. It is logged so that the next reader knows the surface is a placeholder and does not mistake the polished card for a working feature, and so that Health is not counted as a delivered area in any completeness claim. **Not counted as verified capability anywhere.** |

### Intentionally accepted

| ID | Issue | Why accepted |
|---|---|---|
| A1 | ~~`schemaValidation: false` today.~~ | **CLOSED (CHANGE-0008)** — ten closed unions landed, a full-conformance dry-run audit against the live deployment reported zero non-conforming rows, and `schemaValidation: true` is deployed and accepted. |
| A2 | Template `users.role` (`admin`/`user`/`member`) exists and is unused. | Must be explicitly quarantined from the real grants model so it is never mistaken for one. |
| A3 | `vite.config.ts` contains `server.hmr: { overlay: false }`. | Pre-existing template config. The platform forbids modifying it. **Do not touch.** |
| A4 | Tax engine supports 5 countries; only US has full arithmetic. | All five are working. Depth is expressed with a visible badge, not by deleting capability. |
| A5 | `assistantState.weights` is a mild behavioural fingerprint. | It is never shared and never leaves the user's space. Documented in the export manifest as user data. |
| A6 | `loadStored` collects every synced row for a space on every batch, and `getDashboard` collects every task and note the user owns. | Both are bounded by **one space or one user** rather than by the table, and both are the minimum the design can work with: deletions can only be detected by diffing against everything stored, and ranking can only be correct if it sees every task (ADR-003 accepts that query cost grows with data). D49 removed the *redundant* reads around them; these two are the irreducible ones. Narrowing either means abandoning the diff engine or the ranker, which is a redesign and not a fix. |

---

## Phase complexity budgets

Mandatory per ADR-016. **Exceeding any figure is a stop condition requiring
approval**, not a note.

| Phase | New files | New tables | New deps | New abstractions | Must NOT introduce |
|---|---|---|---|---|---|
| **0A** | 4 | 0 | 1 (optional: test script only — `bun test` needs none) | 1 (deterministic-id upsert helper) | New object kinds · new public exports · behaviour changes beyond the listed defects · schema changes |
| **0B** | 9 | 6 (`spaces`, `spaceMembers`, `grants`, `accessLog`, `links`, `activity`) — corrected from 5, see CHANGE-0007 | 0 | 1 (`permissions.can` + `scopeForViewer`) | Object/EAV tables · per-entity sharing logic · a second access path |
| **0C** | 5 | 2 (`modelSnapshots`, `featureFlags`) | 0 | 1 (`takeSnapshot` — the restore-point helper; the deterministic-id upsert slot was never needed, ADR-022) | Renumbering feature indices 0–7 · a migration framework |
| **1.0** | 11 | 1 (`attentionState`) | 0 | 1 (attention pipeline) | The scorer in the hard-rule path · an impressions table · notification delivery · a block/plugin framework |
| **1.1** | 8 | 0 — the budget's 1 table (`modelSnapshots`) was consumed by 0C, so 1.1 needs none | 0 | 1 (generalised `extractFeatures`) | Negative category features · training from absence · changes to indices 0–7 |
| **1.5** | 7 — used 7 | 3 (`connectionTokens`, `syncCursors`, `oauthStates`) | 0 | 1 (`NormalizedBatch` + `applyBatch`) | Per-provider mutations · per-provider UI · broader than minimum scopes · mutating calendar scopes |
| **2** | 5 — used 5 | 1 (`calendarEvents`) | 0 | 0 (Google adapter only) — the writer body was extracted from `applyBatch` into `writeNormalizedBatch` so the sync action and the public mutation share one path; no new concept and still one writer | Writing to Google · storing private event titles · storing attendees/descriptions/locations · a second OAuth path |
| **3** | per-feature. **F1 (People): 4 of 6** · **F2 (Capture): 2 of 4** (`src/lib/capture.ts`, `src/lib/capture.test.ts`) · **F3 (Life Admin): 4 of 4** (`src/lib/documents.ts`, `src/lib/documents.test.ts`, `src/convex/documents.ts`, `src/components/LifeAdminArea.tsx`) · **F4 (Commitments): 4 of 4** (`src/lib/commitments.ts`, `src/lib/commitments.test.ts`, `src/convex/commitments.ts`, `scripts/conformance-4f.ts` — the UI went into the existing `Areas.tsx` and the harness is counted as verification, not product) · **F5 (Subscriptions): 4 of 6** (`src/lib/subscriptions.ts`, `src/lib/subscriptions.test.ts`, `src/convex/subscriptions.ts`, `scripts/conformance-5f.ts` — the UI went into the existing `FinanceArea.tsx`) · **F6 (Agents): 5 of 6** (`src/lib/agents.ts`, `src/lib/agents.test.ts`, `src/convex/agents.ts`, `convex.config.ts`, `scripts/conformance-6f.ts` — the UI went into the existing `FinanceArea.tsx` again) | per-feature. **F1: 1** (`people`) · **F2: 0** · **F3: 1** (`documents`) · **F4: 1** (`commitments`) · **F5: 2** (`accounts`, `subscriptions`) · **F6: 2** (`agentRuns`, `agentProposals`) | 0 | per-feature. **F1: 1** (identity-key matcher) · **F2: 1** (the segmenter, `src/lib/capture.ts`) · **F3: 1** (the derived expiry state machine, `src/lib/documents.ts`) · **F4: 1** (the derived commitment state machine, `src/lib/commitments.ts`) · **F5: 1** (the derived subscription state machine, `src/lib/subscriptions.ts`, which also holds the single money guard) · **F6: 1** (the agent framework and its one agent, `src/lib/agents.ts`; `convex.config.ts` is a one-line schedule declaration, not an abstraction) | Any of it without its own spec section, ADR, budget and approval. F1 additionally: automatic merge (RJD-004) · contact import · inbound email parsing · provider writes · person sharing. F2 additionally: prose-conjunction splitting · fuzzy matching · creating a person from a capture · commitments/documents/expenses/notes as capture outputs · a new feature index. F3 additionally: file storage, upload or scanning · automatic renewal, payments or any external action · a `status` column · a second attention section · a second prioritisation system · natural-language capture of documents · merging documents · a per-country lead-time catalogue. F4 additionally: a task per commitment · asserting what another person did · training on a kept commitment · a `status` column · a reminder that fires before the date for an inbound wait · a new attention section, tab or slug. F5 additionally: any balance, transaction or ledger (§2.3 forbids it) · account numbers, sort codes, IBANs, card or merchant credentials · exchange rates or multi-currency conversion · bank connectivity · CSV or OFX import · loans, assets, liabilities, investments, net worth, cash flow, financial goals · a finance-specific attention section or prioritiser · a second expiry or renewal model · a `status` column · capture inferring a subscription · **migrating the existing float money representation to minor units**. F6 additionally: the other five §6.1 agents, each of which has a producer already (ADR-030) · a second producer for any existing hard rule · a sixth Attention kind · any write to financial data · automatic confirmation or categorisation · any external action or provider write · an external scheduler, queue, Redis, worker, second backend or plugin registry · an LLM or any non-determinism · high-frequency polling · notifications · multi-agent orchestration, a workflow engine, a marketplace or a plugin framework |
| **4** | per-feature, and the first feature is a **correction**, not an addition. **4A: 3 of 3** — `src/components/AreaAdd.tsx`, `src/lib/areaActions.ts`, `src/lib/areaActions.test.ts` (the harness `scripts/conformance-4a.ts` is counted as verification, not product). **4B: 6**, `BLOCKED` on Q-008 | **4A: 0.** **4B: 2** (`transactions`, `imports`) | **4A: 0.** **4B: 2 — a deterministic CSV/XLSX parser and a PDF text extractor**, which ADR-016 makes a stop condition precisely because Panel has been dependency-free | **4A: 1** (the contextual-add descriptor as data rather than as per-area code). **4B: 1** (the import pipeline) | 4A: a new page or route · a second navigation tier · a new attention kind · a new query · a new table · a per-area bespoke component · any change to the capture parser · any change to `estimateTax`, `scorer.ts`, `nlp.ts` or `recordOutcome`. 4B: double-entry or journals · a stored balance column · a reconciliation engine · bank connectivity · OCR · an LLM · per-transaction inference |

**Standing exclusions, all phases:** no external AI/LLM API · no new dependency
without approval · no generic object/EAV table · no agent framework · no settings
screen · no push notifications · no sixth spec file · no modification of
`vite.config.ts` · no edits to `.env` · no hand-edits to `src/convex/_generated`.

---

## Current Development State

```
Current phase:        3 — feature work (each feature needs its own spec + ADR +
                      budget before it starts). Features 1 (People), 2
                      (Multi-object Capture), 3 (Life Admin), 4 (Commitments +
                      Waiting On), 5 (Subscriptions + Account Labels) and 6
                      (Deterministic Agents) are done.
Current objective:    Phases 0B, 0C, 1.0, 1.1, 1.5 and 2 are VERIFIED, and so
                      are phase 3 features 1 through 6. Phase 0A remains BLOCKED
                      on Q-001, which blocks only TASK-0A-003. Q-006 and Q-007
                      are open and non-blocking.
Last completed:       CHANGE-0018 — Deterministic agents. Panel had intelligence
                      and no *when*: everything it knows is computed at query
                      time, so a user who does not open the app is never told
                      anything. Delivered as ADR-030 — **one Convex cron
                      function and one registered agent**, because five of the
                      six §6.1 names already had producers and building them
                      would have violated feature 3's *one renewal, one item*
                      criterion in the name of following the spec. The tier is a
                      **type**, not a convention: `AgentAction` is a closed union
                      of `{flag}` and `{log}`, so an agent that tried to touch
                      money would not compile. The one agent sums what rests on
                      unconfirmed deduction categories and states the swing by
                      calling `estimateTax` twice, never with a rate of its own,
                      and never claims a category is wrong. Overflow is counted,
                      observable and audited; the live harness drives the daily
                      cap to its exact boundary and proves the 51st execution is
                      refused, counted and reported capped. **Cron firing itself
                      is recorded as unverified**, because a 07:00 delivery
                      cannot be observed from inside a test run.
Next phase:           3 — the phase is complete as specified. Nothing further in
                      phase 3 is approved. The remaining known gaps are all
                      product decisions or environment, not work in progress:
                      Q-001 (guest data), Q-006, Q-007, and the phase-2 live
                      handshake (credentials + D32).

Blockers:             Q-001 (guest account data) — BLOCKING for TASK-0A-003 only.
                      Q-005 RESOLVED 2026-10-01 by ADR-022; N1 verified nine
                      times, most recently as run I after feature 4. Feature 5
                      deliberately did NOT re-run OCC: `assistant.ts` was not
                      touched and the feature writes no assistant state, so the
                      precondition for re-arming is absent.
                      Non-blocking: Q-002, Q-003, Q-004, Q-006, Q-007.
                      Phase 2 live handshake — blocked on two environment items,
                      neither of them code: GOOGLE_CLIENT_ID /
                      GOOGLE_CLIENT_SECRET (D30 context: the Keys tab), and
                      D32, this deployment serving no application HTTP routes.
                      Feature 6 also deliberately did NOT re-run OCC:
                      `assistant.ts` untouched and the feature writes no
                      assistant state, so the precondition for re-arming is
                      absent.

Failing tests:        None. 448 fixtures pass across 16 files; 0B, 0C,
                      attention, 1.1, 1.5, 2, 3, 3f, 4, 4f, 5f and 6f
                      conformance all pass live. The phase-2 harness reports one
                      section as SKIP (D32) rather than as a pass. The phase-3
                      harnesses have no skips; the 6f harness carries five
                      explicit [NOTE]s for what it cannot observe — chiefly
                      that cron firing is unverified.

Known risks:
  R1  Concurrent user actions duplicate or corrupt state  → CLOSED by ADR-022
  R2  Model self-reinforcement                             → CLOSED by CHANGE-0010
  R3  Personalisation suppressing a legal deadline         → CLOSED by CHANGE-0009
  R4  Cross-tenant leak from mixed userId/spaceId scoping   → CLOSED by CHANGE-0007
  R13 Infrastructure growing faster than product value     → ADR-016, every phase
  R15 Convex serialisation of -Infinity                    → CLOSED by CHANGE-0005

Phase status (authoritative — see MAIN_AGENT §5):
  PHASE  STATUS        BLOCKED BY        NOTE
  0A     BLOCKED       Q-001             6 of 7 tasks resolved. TASK-0A-002 was
                                         closed by ADR-022 (N1 verified).
                                         Q-001 remains a product decision the
                                         agent may not make (ADR-021).
  0B     VERIFIED      —                 CHANGE-0007. All acceptance criteria met
                                         with evidence; live conformance passes.
  0C     VERIFIED      —                 CHANGE-0008. All acceptance criteria met
                                         with evidence; live conformance passes.
  1.0    VERIFIED      —                 CHANGE-0009. All acceptance criteria met
                                         with evidence; live conformance passes.
  1.1    VERIFIED      —                 CHANGE-0010. All acceptance criteria met
                                         with evidence; live conformance passes.
  1.5    VERIFIED      —                 CHANGE-0011. 7 files / 3 tables / 0 deps /
                                         1 abstraction, exactly at budget.
  2      VERIFIED      —                 CHANGE-0012. 5 files / 1 table / 0 deps /
                                         0 abstractions, exactly at budget. Every
                                         criterion passes except the live
                                         handshake, which is blocked on the
                                         environment (credentials + D32).
  3      IMPLEMENTED   —                 All six features implemented, gated and
                                         documented; cron delivery unobserved
                                         (environment only). Features 1 (People,
                                         CHANGE-0013), 2
                                         (Multi-object Capture, CHANGE-0014), 3
                                         (Life Admin, CHANGE-0015), 4
                                         (Commitments + Waiting On,
                                         CHANGE-0016), 5 (Subscriptions +
                                         Account Labels, CHANGE-0017) and 6
                                         (Deterministic Agents, CHANGE-0018)
                                         VERIFIED. Every feature the phase
                                         specified is now built. The phase is
                                         not marked VERIFIED because that is the
                                         user's call, and the remaining gaps are
                                         Q-001, Q-006, Q-007 and the phase-2
                                         handshake.
  4      NOT STARTED  —                 Specification only; nothing built.
                                         4A (Area-native surfaces) is written
                                         up as CHANGE-0019 and awaits
                                         approval: a correction to how
                                         existing capability is presented,
                                         3 files / 0 tables / 0 deps /
                                         1 abstraction. 4B (Transactions and
                                         document ingestion) is an
                                         architecture only and is BLOCKED on
                                         Q-008, which asks whether §2.3 and
                                         ADR-028 should be amended; 6 files /
                                         2 tables / 2 deps / 1 abstraction.
                                         D50: the Health area is a mock and is
                                         not counted as capability.
```

### Phase lifecycle status table

| Phase | Status | Approved by | Date | Blocked by | Notes |
|---|---|---|---|---|---|
| **0A** | **BLOCKED** | Hardik | 2026-10-01 | `Q-001` blocks TASK-0A-003 | Approved explicitly: "Implement Phase 0A exactly as specified." Five tasks implemented and verified (CHANGE-0005); TASK-0A-002 closed by ADR-022 after Q-005 was resolved (CHANGE-0006). Q-001 remains open, so the phase is `BLOCKED`, not `VERIFIED`. |
| **0B** | **VERIFIED** | Hardik (standing roadmap approval) | 2026-10-01 | — | CHANGE-0007. Ownership on every product table, six new tables, `src/lib/permissions.ts` as the single access path, six query-idiom fixes, backfill verified idempotent against a live deployment. No product strategy, security invariant, ADR or budget was changed. |
| **0C** | **VERIFIED** | Hardik (standing roadmap approval) | 2026-10-01 | — | CHANGE-0008. Clamp, decaying rate, versioning, automatic restore points, byte-exact rollback, reset, pause, feature flags, ten enum validators, `schemaValidation: true`. Verified by 35 new unit fixtures and a live conformance run. |
| **1.0** | **VERIFIED** | Hardik (standing roadmap approval) | 2026-10-01 | — | CHANGE-0009. Eight hard-rule sections with caps, decay, de-duplication, grouping, escalation and pins; four feedback mutations enforced server-side; nothing stored but the feedback actually given. 11 files / 1 table / 0 deps / 1 abstraction, exactly at budget. Verified by 41 unit fixtures and a live conformance run. |
| **1.1** | **VERIFIED** | Hardik (standing roadmap approval) | 2026-10-01 | — | CHANGE-0010. Hard/ranked class split on a single `HARD_KINDS` list the server reads before training; features 8–11 appended with 0–7 bit-identical on a 40-case fixture; five-signal feedback; exploration reserve; bounded category suppression; a real `generalisedRanking` kill switch. 3 new files of 8 / 0 tables / 0 deps / 1 abstraction. Verified by 21 unit fixtures and a 25-check live conformance run. |
| **1.5** | **VERIFIED** | Hardik (standing roadmap approval) | 2026-10-01 | — | CHANGE-0011. Registry making all nine lifecycle questions mandatory; adapter contract with scope allowlist enforcement; `NormalizedBatch` + `applyBatch` as the single idempotent writer; `connectionTokens`/`syncCursors`/`oauthStates`; PKCE with a hashed verifier that provably cannot be returned. 7 files / 3 tables / 0 deps / 1 abstraction, exactly at budget. Verified by 21 unit fixtures, a 41-check live conformance run, and a new credential-containment check in `spec-drift`. |
| **2** | **VERIFIED** | Hardik (standing roadmap approval) | 2026-10-01 | environment only: Google credentials, and D32 (no HTTP routes served) | CHANGE-0012. Google Calendar adapter behind the 1.5 `Adapter` contract; `calendarEvents`; httpAction redirect + internal mutation for the token write; paged, idempotent sync; §7.2 deletion semantics in the writer; `calendar.imminent` as a hard attention kind; a dashboard block with three honest states. 5 files / 1 table / 0 deps / 0 abstractions, exactly at budget. Verified by 16 unit fixtures and a 33-check live conformance run. The two blocked criteria (live handshake, manual end-to-end) are environment, recorded as such. |
| **3** | **IMPLEMENTED** | Hardik (standing roadmap approval); People and Capture additionally APPROVED in PRODUCT_CONTEXT | 2026-10-01 | environment only: the 07:00 cron delivery is declared and its runner exercised live, but the firing itself is not observable from here | **Feature 1 (People) VERIFIED** — CHANGE-0013. A `people` table; a person is a row rather than a task title; merge as a tombstone that rewrites nothing and is exactly reversible (ADR-023); identity keys as evidence with no automatic merge ever (ADR-024, RJD-004); `PEOPLE_FIT` keyed by person id; a real People panel replacing a fake one. 4 new files of 6 / 1 table / 0 deps / 1 abstraction. Verified by 28 unit fixtures, a 50-check live conformance run with 0 skips, and an OCC re-verification. The run also found **D34**: `SOURCE_FIT` and `PEOPLE_FIT` had never received evidence, because `recordOutcome` was handed the raw row instead of the feature object. **Feature 2 (Multi-object Capture) VERIFIED** — CHANGE-0014. One capture can produce several tasks, splitting on explicit structure only (newline, semicolon, "and then") and never on a bare conjunction, because splitting "call the dentist and book the dentist" would destroy a correct object and invent a wrong one silently. 2 new files of 4 / **0 tables** / 0 deps / 1 abstraction. Verified by 43 unit fixtures, a 51-check live conformance run with 0 skips, a byte-identical comparison against the deployed single-task path, and OCC run G. **Feature 3 (Life Admin / expiry → renewal) VERIFIED** — CHANGE-0015. A document is **metadata only** — label, expiry, lead time — and never the document itself (R-007, ADR-025). The deadline is `expiresAt − leadDays`, not the expiry, because a passport valid for ten years has to be renewed about six months early or a carrier refuses boarding (R-006). **No status column**: seven states, all derived from `(expiresAt, the linked renewal task, now)`, so no state can be wrong. The renewal is an **ordinary task** with `documentId`, the document holding no back-reference (ADR-026), which is why the feature inherited the whole task lifecycle for one optional column. One new hard attention kind in the existing `deadlines` section, silent outside the lead window and silent while a renewal is open. 4 new files of 4 / 1 table / 0 deps / 1 abstraction. Verified by 37 unit fixtures, a **93-check live conformance run with 0 skips**, and **OCC run H re-armed rather than inherited** because the completion transition moved. The run found **D40** (the `stale` rule only fired once a document had already expired, so the ordinary early-renewal case went unreported — and every unit fixture had used an expired document); self-review found **D41**, the same N+1 as D37/D39 reintroduced in three places. **Feature 4 (Commitments + Waiting On) VERIFIED** — CHANGE-0016. A promise the user made and a wait the user is in are **one object with a direction**, not two systems: `owed` / `owedTo` as a closed union at the schema validator, immutable after creation, because flipping the direction is not an edit but a different claim about somebody else's conduct. **No status column** — four states, all derived from `(expectedAt, completed, now)`. **Panel never asserts what another person did** (ADR-027): the settled inbound line reads "You marked this received on 4 March", enforced by two copy functions rather than one template, so the `owedTo` branch cannot reach the `owed` wording even by accident. **An inbound wait is not a task** — `taskRules` would report it overdue about something the user cannot do, which is worse than silence — so no task is created until the user presses *Follow up*, and following up deliberately **does not settle** the commitment, because a chase that silently resolved the wait would record a delivery nobody observed. Attention is **asymmetric on purpose**: outbound overdue at 0.85 in `people` with a "Done it" action, inbound overdue at 0.6 in `waitingOn` with "Follow up" and **no advance-warning window at all** (R-009: waiting lists are reviewed weekly, not continuously). This is the feature that finally gives `waitingOn` — declared since phase 1.0 with no producer — something that can write to it, and it did so without a new tab or slug: the column lives inside People. Panel **never trains on a kept commitment** in either direction, because for `owed` the completion is the user's own report and for `owedTo` it is a claim about a third party. 4 new files of 4 / 1 table / 0 deps / 1 abstraction. Verified by 30 unit fixtures (**395 pass, 0 fail across 14 files**), a **132-check live conformance run with 0 skips** covering all 15 criteria, and **OCC run I re-armed rather than inherited** — `assistant.ts` did not change, but a feature that adds user-state mutations is exactly what that invariant exists to survive. The run found **D42**: the attention query collected every commitment the user had ever made and filtered in JavaScript, a collect-then-filter on the hottest read in the product; fixed with a `by_owner_open` index range, and the lesson generalised — *for a derived-state query, assert an index range in the acceptance criteria, not merely a bounded collect, because a `.take()` cap hides an unbounded query from a reviewer as effectively as no cap at all*. This was the first time a criterion caught a defect rather than confirming one. **Feature 5 (Subscriptions + Account Labels) VERIFIED** — CHANGE-0017. A subscription is a number until its renewal is an action, so a subscription carries a `documentId` pointing at a real `documents` row **created in the same mutation** (ADR-029): the cost of a subscription in the feed is **zero new attention code**, and "one renewal, one item" stays structurally true rather than re-argued. An account is a label and a closed kind with **no balance column anywhere in the schema** (ADR-028) — an account with a balance is a ledger with extra steps, and §2.3 names the ledger as the thing Panel must not become. Annual cost is derived, never stored. Money stays `v.number()`; the floats were **not** migrated to minor units, because that would rewrite the input to a verified tax estimate, and the consequence is accepted and guarded instead (D44). 4 new files of 6 / 2 tables / 0 deps / 1 abstraction. Verified by 27 unit fixtures, a **74-check live conformance run with 0 skips**, and a proof that a subscription moves no weight while the whole feature runs. The harness found **D46** (`subscription.updated` was never written for a date-only edit, because the date lives on the document). **Feature 6 (Deterministic Agents) VERIFIED** — CHANGE-0018. Panel had intelligence and **no *when***: everything it knows is computed at query time, so a user who does not open the app is never told anything. Delivered as ADR-030 — **one Convex cron function** (`agents/daily`, `0 7 * * *`) and **one registered agent**, because five of the six §6.1 names already had producers and building them would have violated feature 3's *one renewal, one item* criterion in the name of following the specification. The scheduler answers *when* and never *what*: the tier is a **return type**, and the `automatic` variant's action union is `{flag} | {log}` — there is no variant that can write a financial row, so an agent that tried would not compile. The one agent (`finreview`) sums what rests on unconfirmed deduction categories and states the swing by calling `estimateTax` **twice** rather than applying a rate of its own, and its wording is constrained never to claim a category is wrong. **Overflow is counted, observable and audited** — all three, which needed a query (`getLastRun`) rather than a column, because a cap that silently discards work is a cap nobody can debug. 5 new files of 6 / 2 tables / 0 deps / 1 abstraction. Verified by 26 unit fixtures (**448 pass, 0 fail across 16 files**) and a **52-check live conformance run with 0 skips over 61 mutations**, whose headline check drives the per-space daily cap to its exact boundary and proves the 51st execution is refused, counted as overflow, reported `capped` rather than successful, and observable by the owner — with every financial figure byte-identical afterwards. **Cron firing itself is recorded as UNVERIFIED** rather than as a pass, because a 07:00 delivery cannot be observed inside a test run and the CLI cannot read the schedule back; likewise the thrown-failure path is a `[NOTE]`, not a pass. Remaining gaps in phase 3 are all product decisions or environment: Q-001, Q-006, Q-007 and the phase-2 handshake. |
| **4** | **IN PROGRESS** | approved 2026-10-02: CHANGE-0019 (4A) and CHANGE-0020 (4B-1), the latter by the explicit Q-008 answer | 2026-10-02 | 4B-2 needs its two parsing dependencies — an ADR-016 stop condition, so its own approval | **Built and verified:** 4B-1 (transactions: `transactions` + `imports`, `src/lib/money.ts`, a derived per-currency balance, 22 fixtures + 34 live invariants) and 4A workstream C (commitments and waiting-on in General as well as Relationships, gate removed, unresolvable-counterparty rows no longer dropped). **Not built:** the Finance workspace, contextual add, Home's honesty, and the import pipeline. D50 stands: the Health area is a mock and is not counted as capability. |

**Phases 0B, 0C, 1.0, 1.1 and 2 are VERIFIED, and so are phase 3 features 1
(People), 2 (Multi-object Capture), 3 (Life Admin), 4 (Commitments + Waiting
On), 5 (Subscriptions + Account Labels) and 6 (Deterministic Agents).
Everything here is done to the limit of what the agent may decide. Nothing is
SHIPPED — shipment is the user's decision alone (MAIN_AGENT §11.1).**

**Phase 4 is `NOT STARTED` and exists only as specification.** 4A (Area-native
surfaces) is written up and awaiting approval as CHANGE-0019 — it is a correction
to how existing backend capability is presented, not new capability. 4B
(Transactions and document ingestion) is written up as an **architecture only**
and is `BLOCKED` on Q-008, which is a live question about whether §2.3 and
ADR-028 should be amended. Nothing in phase 4 has been implemented, and no ADR
has been recorded for it.

> A written specification is never an approval (MAIN_AGENT §12). The existence of
> a detailed plan for a phase does not authorise beginning it. Phases 0B–3 are
> authorised by the standing roadmap approval recorded above, which is
> conditional on the budgets, the Do-Not-Touch register and the exclusion of
> every decision the agent may not take.

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
| D37 | `listPeople` and `getPerson` read **every task the user has ever created** in order to count open items per person, on a reactively-subscribed query. | **RESOLVED (CHANGE-0013)** — a `tasks.by_owner_person` index. Convex omits a document from an index when the indexed field is absent, so that range holds exactly the tasks that name somebody, which is the entire input these two functions need. The read is now scoped by the index rather than by a filter over everything the user owns. The wider audit found every other `.collect()` in `src/convex` is already index-scoped to one owner or one space, which is the correct shape for a product where each user is their own tenant; a table-wide scan would be the defect, and there is none. |

### Intentionally accepted

| ID | Issue | Why accepted |
|---|---|---|
| A1 | ~~`schemaValidation: false` today.~~ | **CLOSED (CHANGE-0008)** — ten closed unions landed, a full-conformance dry-run audit against the live deployment reported zero non-conforming rows, and `schemaValidation: true` is deployed and accepted. |
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
| **0B** | 9 | 6 (`spaces`, `spaceMembers`, `grants`, `accessLog`, `links`, `activity`) — corrected from 5, see CHANGE-0007 | 0 | 1 (`permissions.can` + `scopeForViewer`) | Object/EAV tables · per-entity sharing logic · a second access path |
| **0C** | 5 | 2 (`modelSnapshots`, `featureFlags`) | 0 | 1 (`takeSnapshot` — the restore-point helper; the deterministic-id upsert slot was never needed, ADR-022) | Renumbering feature indices 0–7 · a migration framework |
| **1.0** | 11 | 1 (`attentionState`) | 0 | 1 (attention pipeline) | The scorer in the hard-rule path · an impressions table · notification delivery · a block/plugin framework |
| **1.1** | 8 | 0 — the budget's 1 table (`modelSnapshots`) was consumed by 0C, so 1.1 needs none | 0 | 1 (generalised `extractFeatures`) | Negative category features · training from absence · changes to indices 0–7 |
| **1.5** | 7 — used 7 | 3 (`connectionTokens`, `syncCursors`, `oauthStates`) | 0 | 1 (`NormalizedBatch` + `applyBatch`) | Per-provider mutations · per-provider UI · broader than minimum scopes · mutating calendar scopes |
| **2** | 5 — used 5 | 1 (`calendarEvents`) | 0 | 0 (Google adapter only) — the writer body was extracted from `applyBatch` into `writeNormalizedBatch` so the sync action and the public mutation share one path; no new concept and still one writer | Writing to Google · storing private event titles · storing attendees/descriptions/locations · a second OAuth path |
| **3** | per-feature. **F1 (People): 4 of 6** · **F2 (Capture): 2 of 4** (`src/lib/capture.ts`, `src/lib/capture.test.ts`) | per-feature. **F1: 1** (`people`) · **F2: 0** | 0 | per-feature. **F1: 1** (identity-key matcher) · **F2: 1** (the segmenter, `src/lib/capture.ts`) | Any of it without its own spec section, ADR, budget and approval. F1 additionally: automatic merge (RJD-004) · contact import · inbound email parsing · provider writes · person sharing. F2 additionally: prose-conjunction splitting · fuzzy matching · creating a person from a capture · commitments/documents/expenses/notes as capture outputs · a new feature index |

**Standing exclusions, all phases:** no external AI/LLM API · no new dependency
without approval · no generic object/EAV table · no agent framework · no settings
screen · no push notifications · no sixth spec file · no modification of
`vite.config.ts` · no edits to `.env` · no hand-edits to `src/convex/_generated`.

---

## Current Development State

```
Current phase:        3 — feature work (each feature needs its own spec + ADR +
                      budget before it starts). Features 1 (People) and 2
                      (Multi-object Capture) are done.
Current objective:    Phases 0B, 0C, 1.0, 1.1, 1.5 and 2 are VERIFIED, and so
                      are phase 3 features 1 (People) and 2 (Multi-object
                      Capture). Phase 0A remains BLOCKED on Q-001, which blocks
                      only TASK-0A-003. Q-006 is open and non-blocking.
Last completed:       CHANGE-0014 — Multi-object Capture. One capture can
                      produce several tasks, splitting on explicit structure
                      only and never on a bare conjunction. The composer shows
                      every task before any is committed, and the server
                      re-plans so preview and record cannot disagree.
Next phase:           3 — the first feature, in the order the roadmap lists them.

Blockers:             Q-001 (guest account data) — BLOCKING for TASK-0A-003 only.
                      Q-005 RESOLVED 2026-10-01 by ADR-022; N1 verified seven
                      times, most recently as run G after feature 2.
                      Non-blocking: Q-002, Q-003, Q-004, Q-006.
                      Phase 2 live handshake — blocked on two environment items,
                      neither of them code: GOOGLE_CLIENT_ID /
                      GOOGLE_CLIENT_SECRET (D30 context: the Keys tab), and
                      D32, this deployment serving no application HTTP routes.

Failing tests:        None. 321 fixtures pass; 0B, 0C, attention, 1.1, 1.5, 2,
                      3 and 4 conformance all pass live, plus the ADR-022 OCC
                      suite re-verified (48 mutations, 0 duplicates, run G). The
                      phase-2 harness reports one section as SKIP (D32) rather
                      than as a pass. The phase-3 harnesses have no skips.

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
  3      IN PROGRESS   —                 Features 1 (People, CHANGE-0013) and 2
                                         (Multi-object Capture, CHANGE-0014)
                                         VERIFIED. Remaining features (Life
                                         Admin/documents, commitments, Finance
                                         expansion, agents) each need their own
                                         spec, ADR and budget (§11.3).
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
| **3** | **IN PROGRESS** | Hardik (standing roadmap approval); People and Capture additionally APPROVED in PRODUCT_CONTEXT | 2026-10-01 | — | **Feature 1 (People) VERIFIED** — CHANGE-0013. A `people` table; a person is a row rather than a task title; merge as a tombstone that rewrites nothing and is exactly reversible (ADR-023); identity keys as evidence with no automatic merge ever (ADR-024, RJD-004); `PEOPLE_FIT` keyed by person id; a real People panel replacing a fake one. 4 new files of 6 / 1 table / 0 deps / 1 abstraction. Verified by 28 unit fixtures, a 50-check live conformance run with 0 skips, and an OCC re-verification. The run also found **D34**: `SOURCE_FIT` and `PEOPLE_FIT` had never received evidence, because `recordOutcome` was handed the raw row instead of the feature object. **Feature 2 (Multi-object Capture) VERIFIED** — CHANGE-0014. One capture can produce several tasks, splitting on explicit structure only (newline, semicolon, "and then") and never on a bare conjunction, because splitting "call the dentist and book the dentist" would destroy a correct object and invent a wrong one silently. 2 new files of 4 / **0 tables** / 0 deps / 1 abstraction. Verified by 43 unit fixtures, a 51-check live conformance run with 0 skips, a byte-identical comparison against the deployed single-task path, and OCC run G. Remaining features — documents/Life Admin, commitments, Finance expansion, agents — each get their own spec section, ADR, budget and approval per §11.3. |

**Phases 0B, 0C, 1.0, 1.1 and 2 are VERIFIED, and so are phase 3 features 1
(People) and 2 (Multi-object Capture). Everything here is done to the limit of
what the agent may decide. Nothing is SHIPPED — shipment is the user's decision
alone (MAIN_AGENT §11.1).**

> A written specification is never an approval (MAIN_AGENT §12). The existence of
> a detailed plan for a phase does not authorise beginning it. Phases 0B–3 are
> authorised by the standing roadmap approval recorded above, which is
> conditional on the budgets, the Do-Not-Touch register and the exclusion of
> every decision the agent may not take.

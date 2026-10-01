# 04 — SYSTEM FUNDAMENTALS

**The engineering and architecture handbook.** How Panel is built, and the rules
that must not be broken to build it.

Status: `ACTIVE` · Last updated: 2026-10-01

> Every command in the runbook was verified against `package.json` and the
> repository. Commands that do not exist are marked **NOT AVAILABLE**, not
> invented.

---

## 1. Architecture

### 1.1 Current architecture (verified 2026-10-01)

```text
src/lib/            PURE INTELLIGENCE — deterministic, dependency-free
  nlp.ts    393     token-based task parser + recurrence + due formatting
  scorer.ts 240     online logistic regression, explainable ranking
  tax.ts    561     5-country tax rule engine (US has arithmetic; others deadlines)
  areas.ts  199     area catalogue + provider catalogue
      ↓
src/convex/         BACKEND — persistence, orchestration, learning
  assistant.ts 440  NL capture, learned ranking, training, notes, model
  life.ts     475   areas, finance/tax, connections, area-scoped tasks
  schema.ts   170   8 tables, schemaValidation: false
  auth.*             Convex Auth (email OTP + anonymous), MUST NOT be altered
      ↓
src/pages|components   UI — Convex reactive queries, no duplicated server state
  Dashboard.tsx 757 area tabs, brief, model inspector, capture, tasks, chart, notes
  Areas.tsx    601 TasksArea, PeopleArea, HealthArea, IntegrationsArea, AreaPicker
  FinanceArea   464 country switcher, deadlines, readiness, expenses, estimate
  Landing.tsx   416 marketing page
  Auth.tsx      269 email OTP + guest
```

**Current-state facts:**

- The only object type persisted is a **Task**. `PeopleArea` stores
  `"catch up with mum every week"` in `tasks.title`.
- `nextOccurrence` is exported and tested but **called by no mutation** — the UI
  promises recurrence that does not happen (D5).
- No `internalMutation`, `internalQuery`, `httpAction` or cron exists anywhere.
- All 9 integrations are `pending-credentials`; none can complete a handshake.
- Health counters are component-local `useState` and reset on reload (D4).
- **No test files exist.** `scripts/` is empty; the three harnesses that passed
  were deleted (D10).
- `previewCapture` is exported but referenced nowhere (N3).
- `schemaValidation: false`, and every enum-ish field is a bare `v.string()` (N7).

### 1.2 Target architecture

```text
External Tools
      ↓
Integrations  (registry + adapter, one normalised path, ADR-012)
      ↓
Normalised Data  (NormalizedBatch: objects + links + cursor)
      ↓
Panel Objects  (typed entity tables, one per kind, ADR-007)
      ↓
Relationships  (links — closed vocabulary, ADR-008)
      ↓
Activity  (append-only, controlled taxonomy)
      ↓
Attention  (COMPUTED, never stored — ADR-003)
   ├── Hard rules  (bypass the scorer entirely — ADR-006)
   └── Learned ranking (weights, explainable, versioned)
      ↓
Actions  (automatic / proposed / confirm — ADR-011)
```

The 0A–3 phases add the arrows, not the boxes. **No new object kinds are added
before Phase 3.**

### 1.3 Gap analysis

| System | CURRENT | TARGET | GAP | PHASE |
|---|---|---|---|---|
| **Testing** | None | Fixtures for nlp/scorer/tax + regression gates | Entire suite | 0A |
| **Task creation** | Two round-trips; area can orphan | One atomic call | Minor | 0A |
| **Recurrence** | Parsed, never respawns | `nextOccurrence` wired into completion | Minor | 0A |
| **Model state** | Read-then-insert; duplicates break the app (N1) | Deterministic-id upsert | Critical | 0A |
| **Accounts** | Guest has no claim path (N2) | Claim, or removed | Critical | 0A |
| **Ownership** | `userId` only | `ownerUserId` + `spaceId` + many-to-many `spaceMembers` | Foundational | 0B |
| **Relationships** | None | `links` with closed `LinkRel` | Foundational | 0B |
| **History** | Only `completedAt` | `activity` append-only with closed `ActivityKind` | Foundational | 0B |
| **Queries** | Collect-all + JS filter in 6 places | Indexed, bounded | Perf | 0B |
| **Validation** | `false` + bare strings | Enum validators, then `true` | Data integrity | 0C |
| **Model safety** | L2 only; no clamp, no version, no rollback | Clamp ±3, decaying lr, `weightsVersion`, `modelVersion`, snapshots, reset, pause | Safety | 0C |
| **Attention** | A 3-line brief | Sections, budget, decay, dedupe, grouping, hard rules | Core | 1.0 |
| **Attention learning** | Trains on task completion only | 5-signal feedback, exploration, no training from absence | Core | 1.1 |
| **Integrations** | Stubbed; records intent only | `applyBatch`, OAuth, cursors, lifecycle | Core | 1.5 |
| **Calendar** | Nothing | Inbound-only, minimised, `calendar.readonly` | Core | 2 |
| **People / capture / docs / commitments** | Faked as task titles | First-class objects, reversible merge | Expansion | 3 |
| **Sharing** | Nothing | Schema in 0B; UI deferred (needs users) | Deferred | P2 |

---

## 2. Repository structure

| Path | Responsibility | Notes |
|---|---|---|
| `src/lib/` | Pure intelligence and rules. No I/O, no React, no Convex imports. | Everything here is a pure function with an injectable clock. Must stay dependency-free. |
| `src/convex/` | Backend. Mutations, queries, internal functions, schema, auth. | `_generated/` is **gitignored** — never hand-edit. |
| `src/pages/` | Routed screens. | Lazy-loaded in `src/main.tsx`. |
| `src/components/` | UI components. `ui/` is the shadcn primitive set. | `Areas.tsx` and `FinanceArea.tsx` are area bodies. |
| `src/hooks/` | Client hooks. `use-auth.ts`, `use-mobile.ts`. | |
| `src/index.css` | The entire design system. | Neobrutalism minimalism tokens. **Do not remove Tailwind directives or theme variables.** |
| `index.html` | Entry HTML; loads Archivo Black + Space Mono. | |
| `convex.json` | Convex config. `"aiFiles": {"enabled": false}` — reinforces ADR-001. | Keep disabled. |
| `spec/` | **These five files.** Authoritative. | No sixth file without approval. |
| `scripts/` | One-off tooling. Currently only `spec-drift.ts`. | Not part of the app. |
| `vite.config.ts` | Build config. | **NEVER MODIFY.** Contains `server.hmr: { overlay: false }` — pre-existing template config, deliberately untouched (ADR-019 / A3). |

---

## 3. Data model

### 3.1 Current tables

`users` (template), `tasks`, `notes`, `assistantState`, `areas`, `taxProfile`,
`expenses`, `taxDocuments`, `connections`.

Every one is scoped by `userId` only. There is **no space concept**.

### 3.2 Target model

**New:** `spaces`, `spaceMembers`, `grants`, `accessLog`, `links`, `activity`,
`attentionState`, `modelSnapshots`, `people`, `commitments`, `documents`,
`calendarEvents`, `connectionTokens`, `syncCursors`, `metrics`, `featureFlags`.

**Modified:** every existing table gains `ownerUserId` + `spaceId`;
`assistantState` gains `weightsVersion` / `modelVersion` / `suppressedKinds` /
`suppressedAreas` / `learningPaused`; `tasks` gains `origin` / `sourceTaskId` /
`pinned` / `archivedAt`; `expenses` gains `currency` / `personId` / `provider` /
`externalId`; `notes` gains `area` / `tags`.

### 3.3 Entities

| Entity | Purpose | Notes |
|---|---|---|
| **Space** | A container an object lives in. Personal, family, work. | Many-to-many membership. **No owner column** (ADR-009). |
| **Object** | A typed entity in exactly one home space. | Ownership never changes on sharing. |
| **Link** | A directed edge between two objects. | Closed `LinkRel` vocabulary only. |
| **Activity** | Append-only record of what happened. | Closed `ActivityKind` taxonomy. |
| **Attention item** | **Not an entity.** Computed at query time. | Only feedback about items is stored. |
| **Agent run** | A trace of a deterministic agent execution. | Dev/debug gated. Counts and hashed ids only. |
| **Connection** | A linked external tool. | Metadata only. Credentials live separately. |

### 3.4 Activity taxonomy (closed)

| Actor | Kinds |
|---|---|
| **user** | `task.created` `task.completed` `task.deleted` `note.created` `expense.added` `capture.committed` `person.created` `commitment.made` `attention.acted` `attention.dismissed` `attention.snoozed` `attention.rejected` |
| **sync** | `sync.started` `sync.completed` `sync.failed` `sync.objects_upserted` `connection.connected` `connection.revoked` |
| **system** | `area.enabled` `area.disabled` `model.reset` `model.rolled_back` `model.paused` `account.deletion_requested` |
| **agent** | `agent.proposed` `agent.executed` `agent.skipped` |

`meta` is **scalar values only** (string / number / boolean) and is explicitly not
a schema. An unknown kind is a **type error**, not a runtime surprise.

### 3.5 Attention data

`attentionState` holds per-`fingerprint` feedback: `seenCount`, `dismissedAt`,
`snoozedUntil`, `actedAt`, `rejectedAt`. `fingerprint = hash(kind : sourceId : dueBucket)`.

**There is deliberately no `attentionImpressions` table** — absence of feedback is
never trained on (ADR-004).

---

## 4. Security model

### 4.1 Concepts

| Concept | Meaning |
|---|---|
| **Ownership** (`ownerUserId`) | Who the object belongs to. **Never** changed by sharing. |
| **Home space** (`spaceId`) | The one space an object lives in. |
| **Membership** (`spaceMembers.role`) | Which spaces a user sees, and their baseline role. Many-to-many. |
| **Visibility** (on the object) | `private` (owner only) or `space` (whole home space). |
| **Grant** (`grants`) | A narrow, optional, **expirable** exception outside the home space. |

### 4.2 Access resolution

```text
viewer ──► spaceMembers ──► spaces they belong to ──┐
      └──► grants (grantee = viewer, not revoked,     │
                  not expired, scope matches) ────────┤
                                                     ▼
                            membership path      grant path
                            spaceId == obj.spaceId   kinds / areas / objectIds
                                     │                    │
                            visibility                 (absent ⇒ DENY)
                            space  → allow                    │
                            private → deny                     │
                                                              ▼
                                        effective = max(membership, grant.level)
                                        effective < required ⇒ DENY
```

**Deny by default (MAIN_AGENT S1).** Grants **fail closed**: an absent `scope.kinds`
means those kinds are *excluded*, not all kinds included.

### 4.3 Privacy tiers

| Kind | Default visibility | Shareable via space grant? |
|---|---|---|
| `note` | private | **No** — requires an explicit `objectIds` grant |
| `assistantState`, `modelSnapshots`, `attentionState` | owner only | **Never** — excluded from all scope checks |
| `calendarEvent` with `isPrivate` | private | **No** — and the title is never stored at all |
| `expense`, `taxProfile`, `taxDocuments` | private | Only via explicit `objectIds` / `kinds` scope |
| `task`, `commitment`, `person`, `document` | space | Yes |

### 4.4 Grants and temporary access

```ts
grants = {
  spaceId, granteeUserId,
  level: "view" | "comment" | "edit" | "manage",
  scope: { kinds?: ObjectKind[], areas?: string[], objectIds?: Id[] },
  grantedBy, grantedAt, expiresAt?, revokedAt?
}
```

The worked example — *"give my accountant my tax information for 7 days"* —
resolves to exactly:

```ts
{ spaceId: personalSpace, granteeUserId: accountantId, level: "edit",
  scope: { kinds: ["expense", "document"], areas: ["finance"] },
  expiresAt: now + 7d }
```

The accountant sees Finance. They do **not** see notes, work areas, the model, or
the timeline. The user can always see who has access, why, until when, and what
they opened — from `accessLog`.

### 4.5 Token handling

| Rule | Mechanism |
|---|---|
| Storage | `connectionTokens` table, reachable **only** from `internalMutation` / `internalQuery` in a module that exports **no public query**. |
| Never exposed | Not in any UI query, not in client state, not in a log, not in an error message, not in an export. |
| Encryption | Tokens are server-side only. Field-level encryption is a *possible* later hardening, not assumed. |
| Refresh | Handled server-side inside `internalMutation`. Never surfaced to the client. |
| Revocation | Provider-side revoke **and** immediate local delete, in the same mutation that flips status. |
| Scopes | Minimum scope only; the registry **rejects** a mutating scope at load. |
| Errors | Provider responses map to a fixed set of codes (`AUTH_FAILED`, `SCOPE_DENIED`, `RATE_LIMITED`, `PROVIDER_DOWN`). **No provider body ever reaches a message or log.** |
| Enforced by | A grep gate: no exported query/mutation outside the credentials module mentions `connectionTokens`. |

---

## 5. Intelligence model

### 5.1 Components

| Component | What it is | Where |
|---|---|---|
| **NLP parser** | Deterministic tokeniser. Recognises temporal, priority, tag and recurrence cues; consumes matched tokens; keeps the rest as the title. | `src/lib/nlp.ts` |
| **Learned scorer** | Online logistic regression, 8 features, trained on the user's own completions. | `src/lib/scorer.ts` |
| **Attention (hard rules)** | Pure rule engine → items with deterministic severity. | Phase 1.0 |
| **Attention (learned)** | Generalised feature extraction + ranking + explanation. | Phase 1.1 |
| **Tax engine** | Rule engine with sourced figures and `asOf` dates. Not a model. | `src/lib/tax.ts` |

### 5.2 Feature layout — frozen

| Index | Feature | Status |
|---|---|---|
| 0 | `BIAS` | frozen |
| 1 | `PRIORITY` | frozen |
| 2 | `TIME_PRESSURE` | frozen |
| 3 | `AGE` | frozen |
| 4 | `HOUR_FIT` | frozen |
| 5 | `WEEKDAY_FIT` | frozen |
| 6 | `TAG_FIT` | frozen |
| 7 | `ESTIMATE_FIT` | frozen |
| 8–11 | `AREA_FIT`, `SOURCE_FIT`, `PEOPLE_FIT`, `DUE_BUCKET_FIT` | Phase 1.1 |

**Indices 0–7 are frozen.** A regression test asserts they are bit-identical to
`scorer.ts` today. Any change requires `weightsVersion++` and `alignWeights()`
review.

**There is deliberately no negative *category* feature.** Category suppression is
an explicit, user-authored set that hard rules ignore (RJD-006).

### 5.3 Feedback semantics

| Signal | Label | Weight | Rationale |
|---|---|---|---|
| `acted` | 1 | 1.0 | Strong positive |
| `completed` | 1 | 1.0 | Strong positive |
| `rejected` (explicit "not relevant") | 0 | 1.0 | Strong negative **+ writes `suppressedKinds`/`suppressedAreas`** |
| `dismissed` | 0 | **0.25** | Weak negative, damped 4× |
| `snoozed` | **none** | — | Timing only. Never negative. |
| *(no feedback)* | **none** | — | **Absence is never evidence.** |

### 5.4 Safeguards

| Control | Value |
|---|---|
| `MIN_SAMPLES_TO_RANK` | 12 — below this, fall back to the prior |
| `MIN_SAMPLES_TO_TRAIN_DISMISSAL` | 5 — below this, record but do not train |
| `WEIGHT_CLAMP` | ±3.0, applied after every step |
| Learning rate | `0.08 / (1 + samples / 50)` — decays as evidence accumulates |
| L2 | 0.0008 (existing) |
| `weightsVersion` | Bumped on any change to indices 0–7 |
| `modelVersion` | Increments on every snapshot; max 10 retained |
| `learningPaused` | User toggle; hard rules unaffected |
| `resetModel` | Clears weights, counters, suppression. **Keeps all user data.** |
| `restoreModel(v)` | Restores an exact weight vector |

### 5.5 Exploration / anti-feedback-loop

1. Absence never trains.
2. Dismissal weight is 0.25.
3. Snooze cannot produce a negative label.
4. **Every section reserves ≥1 slot for an `explore` item** drawn from the lower
   half of the ranking, neither snoozed nor rejected. Without this, one early
   mis-ranking is self-fulfilling forever.
5. `suppressedKinds` is written only by explicit rejection, and is **ignored by
   hard rules**.

### 5.6 Hard rules vs learned

Hard-rule items are produced separately, are **never passed to the scorer**, are
ordered by deterministic severity, and are immune to learned suppression. See
ADR-006 for the full reasoning.

### 5.7 Attention budget

| Section | Max | Half-life | Grouping |
|---|---|---|---|
| Now | 3 | 2h | — |
| Today | 5 | 8h | — |
| Upcoming | 5 | none | — |
| Waiting On | 3 | 24h | per counterparty |
| Money | 3 | 24h | per account |
| People | 3 | 72h | per person |
| Deadlines | 4 | none | — |
| Changes | 3 | 12h | per provider |

Total cap **24**. Decay `score *= 0.5 ^ (ageHours / halfLife)`. Dedup key
`kind : sourceId : dueBucket`. Escalation level 2 (< 4h or severity ≥ 0.9) may
only be snoozed **with a mandatory return date**. Pinned items always rank 1 and
never decay.

---

## 6. Agent model

```ts
type AgentResult =
  | { tier: "automatic"; attention: AttentionCandidate[] }
  | { tier: "proposed";  proposals: ProposedAction[] }
  | { tier: "confirm";   proposals: ConfirmAction[] };
```

| Tier | May execute without asking | Examples |
|---|---|---|
| **automatic** | Safe internal operations only | `recurringRespawn` (creates the next occurrence of a rule the user already wrote), activity logging, stale-sync flagging |
| **proposed** | Never executes. User accepts. | document expiry → propose renewal task; recurring payment → propose subscription; commitment overdue → propose reschedule |
| **confirm** | Blocking dialog. Never a toast. | Pay · Send to anyone · Create/revoke a grant · Delete account or shared object · Any tax/legal submission · Any write-back to an external provider |

### Idempotency

Every agent writes `activity` with a deterministic key:

| Agent | Key |
|---|---|
| `recurringRespawn` | `sha256("respawn" + sourceTaskId + occurrenceISO)` |
| `documentExpiry` | `sha256("docexp" + documentId + daysRemainingBucket)` |
| `commitmentOverdue` | `sha256("commit" + commitmentId + "overdue")` |
| `recurringPayment` | `sha256("pay" + amount + merchantFingerprint + monthBucket)` |
| `relationshipReminder` | `sha256("relrem" + personId + windowStart)` |
| `applySync` | `sha256("sync" + provider + externalId + upstreamChangedAt)` |

**Caps:** max 10 proposals per agent per run; max 50 per space per day. Excess is
dropped **with a count recorded** — never silently truncated.

### Observability

`traceAgent()` is a pure function returning `Input → Decision[] → Output → Action
→ Result`, testable with fixtures and no database. In dev (behind
`featureFlags.debug_agents_v1`) runs persist to `agentRuns` with **counts, hashed
ids and durations only** — never raw contents, never credentials. A run that
produced zero actions records why, so "why didn't it act?" is answerable.

---

## 7. Integration model

### 7.1 Pipeline

```text
Provider ──► Adapter ──► NormalizedBatch ──► Panel Objects + Links + Activity ──► Attention
 (source     (one per      (one shape,      (applyBatch: idempotent,            (hard rule or
  of truth)   provider)     one writer)       diff-then-patch)                    learned)
```

### 7.2 Lifecycle contract

Every connector must answer all nine questions:

| Question | Google Calendar (reference implementation) |
|---|---|
| **Source of truth** | Google, always. Panel holds a cache. |
| **Sync direction** | **Inbound only.** Panel never writes to Google. Any future write-back is outbound *only* for `origin: "panel"` objects. |
| **Conflict resolution** | N/A inbound. Future outbound: Panel wins for `origin: "panel"`, upstream wins otherwise, conflicts surface as a `Changes` item. |
| **Deletion semantics** | Upstream gone + `startsAt < now` → delete the row **and** mark any derived task `orphanedSource` (never delete the task). `startsAt ≥ now` → set `cancelled: true`, keep the row. |
| **Stale data** | `lastSyncedAt` > 48h → banner. > 7d → flag `stale` and **suppress from Attention** (a stale meeting is worse than no meeting). |
| **Duplicate handling** | `externalId` is the stable key. Recurring **masters** stored once; instances never duplicated. |
| **Reconnect** | Revoke at provider → delete tokens, status `revoked`, derived rows kept and marked `stale`. On reconnect: cursor reset, full resync, idempotent upsert, clear `stale`. |
| **Disconnect** | Revoke at provider, **delete tokens immediately**. Keep derived rows (the user's data; they may have made tasks from them), mark `sourceDisconnected`, stop contributing to Attention. |
| **Panel may modify the external system?** | **No**, in v1. Stated in the registry and shown in the UI. |

### 7.3 Data minimisation — Google Calendar

| Persist | Do **not** persist |
|---|---|
| `externalId`, `startsAt`, `endsAt`, `allDay` | attendees, guest lists, RSVP state |
| `title` — **unless `isPrivate`** | `description`, body text |
| `isPrivate`, `sourceUrl` | conference data, dial-in, location |
| | reminders, colour, organiser, recurrence rules, extended properties |

If Google reports `visibility: "private"`, Panel writes the literal `"Busy"` and
**drops the title**. The sensitive value never reaches the database — not
encrypted, not hidden, absent.

**Scope:** `calendar.readonly`. Nothing that can mutate. Enforced by the registry.

---

## 8. Development runbook

> Commands verified against `package.json` on 2026-10-01.

### 8.1 Commands that exist

| Purpose | Command | Notes |
|---|---|---|
| Install | `bun install` | |
| Typecheck | `bunx tsc -b --noEmit` | `bun tsc -b --noEmit` also works |
| Build | `bun run build` | = `tsc -b && vite build` |
| Lint | `bun run lint` | = `eslint .` — **FAILS AT BASELINE: 12 errors, 19 warnings, all pre-existing.** See §8.2. |
| Format | `bun run format` | = `prettier --write .` |
| Preview (built output) | `bun run preview` | |
| Dev server | `bun run dev` | = `vite`. **The agent must NOT run this** — the platform owns the dev server and Convex dev process. |
| Convex codegen + push | `bun convex dev --once` | **Always with `--once`.** Never bare `convex dev` — non-interactive terminal, will hang. |
| Spec drift check | `bun scripts/spec-drift.ts` | Dependency-free. Exits non-zero on drift. |

### 8.2 Known-failing / unavailable commands

| Purpose | Status |
|---|---|
| Tests | **NOT AVAILABLE.** No `test` script in `package.json`, and **no test files exist**. Bun ships a built-in test runner so `bun test` would need no new dependency — but Phase 0A must add the fixtures and decide whether to add the script. Until then, the runbook has **no test command**, and any claim that Panel is tested is false. |
| Lint | **FAILS AT BASELINE.** `bun run lint` reports **12 errors and 19 warnings** on untouched code, across `src/hooks/use-mobile.ts`, `src/lib/nlp.ts`, `src/main.tsx`, `src/pages/Dashboard.tsx`, `src/convex/assistant.ts`, `src/convex/life.ts`, `src/convex/_generated/*`, `vly-toolbar-readonly.tsx` and stock shadcn components. **Zero findings in `spec/` or `scripts/`.** |
| Reset local data | **NOT AVAILABLE.** Convex is deployed (`VITE_CONVEX_URL`), not a local backend. There is no documented reset command. Data reset requires a deliberate user action via the Convex dashboard. Do not improvise one. |

> **How to use the lint gate until it is fixed.** The meaningful check is
> *"are there any NEW problems?"* — not *"is the count zero?"* A gate that
> already fails on untouched code is noise that trains everyone to ignore it.
> Record the baseline (12 / 19) and compare against it. Clearing the baseline
> is legitimate cleanup work, not a blocker. Recorded as CHANGE-0003 / D12.

### 8.3 Platform constraints (binding)

- **Never** start, stop or restart the dev or preview server from the terminal.
- **Never** modify `vite.config.ts` or any Vite/HMR configuration.
- **Never** edit `.env` files. Secrets go through the Keys UI.
- **Never** hand-edit `src/convex/_generated/*`. It is gitignored and regenerated
  by `bun convex dev --once`.
- **Never** use `sed`, shell redirection or ad-hoc scripts to modify source files.
  Use the file tools.
- Terminal commands are for **inspection, installs and validation** only.
- File edits must use the platform file tools (`write_file`, `str_replace`,
  `apply_patch`).

### 8.4 Convex Auth warning — do not break sign-in

`src/convex/auth.config.ts` declares two providers. The standard entry
(`{ domain: process.env.CONVEX_SITE_URL, applicationID: "convex" }`) **must not**
be converted to `type: "customJwt"`. The deployment self-issues JWTs without a
`kid` header, and that path rejects such tokens — sign-in would silently never
confirm and `RequireAuth` would loop to `/auth` forever.

### 8.5 Debugging and inspection

| Goal | How |
|---|---|
| Convex function errors | Read the error surfaced by the mutation/query in the browser console. |
| Data inspection | Convex dashboard, manually. No local DB to inspect. |
| Model inspection | The dashboard's model inspector (`Brain` toggle) shows live weights and the sample count. |
| Parse inspection | The Dashboard capture box shows a live parse preview using the same parser the server runs. |
| Spec drift | `bun scripts/spec-drift.ts` |
| Type errors | `bunx tsc -b --noEmit` |
| Env vars | **The agent cannot read `.env` files.** Ask the user; refer to Keys UI. |

---

## 9. Extension guides

### 9.1 Add a new entity

1. Approve first (a new table requires explicit approval — MAIN_AGENT §9).
2. Add the typed table to `src/convex/schema.ts` with `ownerUserId` + `spaceId`
   and an index on `spaceId`.
3. Add it to `DELETABLE_TABLES` in the deletion manifest — **a test fails if you
   do not**.
4. Add it to the privacy-tier table in §4.3.
5. Add a pure source adapter in `src/lib/attention/sources.ts` if it should
   produce attention.
6. Add fixtures. Add it to `spec-drift.ts`'s documented-table check.
7. Update `03_PRODUCT_CONTEXT.md` only if product direction changed.

### 9.2 Add a relationship

1. If it is a new edge type, add it to the **closed `LinkRel` union** (approval
   not required — it is within an existing entity).
2. If the edge needs a **queryable attribute**, it does **not** belong in `links` —
   promote it to a typed, indexed column on one of the two entities (ADR-008).
3. Add a `by_from` / `by_to` index if the new direction needs one.

### 9.3 Add an agent

1. Write it as a **pure function** in `src/lib/agents/` — no DB, no Convex imports.
2. Give it a deterministic idempotency key.
3. Return a typed tier (`automatic` / `proposed` / `confirm`). Risky actions can
   only be `confirm`.
4. Add fixtures covering: the fire case, the non-fire case, and a double-run
   (idempotency).
5. Add `traceAgent()` expectations so the trace is asserted.
6. Register it in the runner `internalMutation`. Add to the run caps.

### 9.4 Add an integration

1. Add a `ConnectorDef` to `src/lib/integrations/registry.ts` — including the
   **nine lifecycle answers** (§7.2).
2. Write an adapter returning a `NormalizedBatch`. **Do not write a new
   mutation.**
3. If OAuth: use the existing start/callback flow, PKCE, single-use state, and
   store tokens only via the credentials `internalMutation`.
4. Declare the minimum scope. The registry rejects mutating scopes.
5. Add the data-minimisation whitelist for the provider.
6. Never render a provider response body to the user or a log.

### 9.5 Add an attention source

1. Add a pure adapter in `src/lib/attention/sources.ts` returning
   `AttentionCandidate[]`.
2. Give it a section, a budget slot, a half-life, and a dedupe fingerprint.
3. If it is a hard rule, put it in `rules.ts` and **do not** pass it to the
   scorer (ADR-006).
4. Add budget tests: a fixture exceeding the cap must be truncated correctly.

### 9.6 Add a feature to the learning model

1. **Append** at index ≥ 8. Never renumber 0–7.
2. Bump `weightsVersion`.
3. Verify `alignWeights()` pads correctly for existing users.
4. Add a regression test asserting indices 0–7 are bit-identical.
5. Confirm the new feature **cannot** express category suppression (ADR-006).

### 9.7 Change the schema

1. Additive by default. Removing or renaming a field requires approval.
2. Replace any new bare `v.string()` with a `v.union` of literals.
3. Run `bun convex dev --once` then `bunx tsc -b --noEmit`.
4. Update `DELETABLE_TABLES`.
5. If flipping `schemaValidation`, run a dry-run audit **first** — Phase 0C.
6. Record a `CHANGE-XXXX` with `Schema: yes`.

### 9.8 Add a new product area

1. Add to `AREAS` in `src/lib/areas.ts` (slug, label, blurb, kind, accent,
   optional starterTasks).
2. Add a `kind` case to `areaIcon()` in `src/components/Areas.tsx`.
3. Add a body component and route it from the area dispatch in
   `src/pages/Dashboard.tsx`.
4. `general` cannot be removed. Disabling an area re-homes its tasks to
   `general` — it **never** deletes user data.

---

## 10. Non-negotiable architectural rules

1. **Typed entity tables.** One table per kind. No generic object table. No EAV.
2. **`links` holds relationships only**, from a closed vocabulary. Domain
   attributes stay on entities.
3. **Ownership is separate from access.** Sharing never changes ownership.
   Membership is many-to-many. An object has one home space.
4. **Deny by default.** An unrecognised kind, area or scope is denied.
5. **Hard attention rules bypass learned ranking entirely.** The scorer never sees
   them, so personalisation cannot suppress a tax deadline or an expiring passport.
6. **No learning from absence.** Only explicit user action is evidence.
7. **Snooze is not negative feedback.** It is a timing signal, and cannot be
   encoded as a label.
8. **Category suppression is explicit, never learned.** There is no negative
   category feature.
9. **Agent idempotency is mandatory.** Deterministic keys; caps on proposals.
10. **Risky actions require confirmation.** Automatic agents may only perform safe
    internal operations.
11. **External credentials remain server-only**, in a module with no public
    queries.
12. **Minimum OAuth scope.** Mutating scopes are rejected at load.
13. **Private data is not stored, not hidden.** Data minimisation is a design
    constraint.
14. **No external LLM API.** Ever.
15. **No speculative frameworks.** No agent framework, no plugin registry, no
    EAV, no settings screen, no notification system.
16. **Attention is computed, never stored** — except explicit feedback about items.
17. **Model features are append-only.** Indices 0–7 are frozen; weights are
    versioned, clamped and rollback-able.
18. **Every phase declares a complexity budget** and stops if it exceeds it.
19. **Markdown is the specification.** The HTML control centre is a view. Code
    never silently overrides the spec.
20. **Testing is a gate.** A phase is not complete because a feature works
    manually.

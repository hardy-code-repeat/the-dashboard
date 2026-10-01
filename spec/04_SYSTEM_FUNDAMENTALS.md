# 04 — SYSTEM FUNDAMENTALS

**The engineering and architecture handbook.** How Panel is built, and the rules
that must not be broken to build it.

Status: `ACTIVE` · Last updated: 2026-10-01

> Every command in the runbook was verified against `package.json` and the
> repository. Commands that do not exist are marked **NOT AVAILABLE**, not
> invented.

---

## 1. Architecture

### 1.1 Current architecture (verified 2026-10-01, after CHANGE-0012)

```text
src/lib/            PURE INTELLIGENCE — deterministic, dependency-free
  nlp.ts             token-based task parser + recurrence + due formatting
  scorer.ts          online logistic regression, 12 frozen features, explainable
  tax.ts             5-country tax rule engine (US has arithmetic; others deadlines)
  areas.ts           area catalogue + provider catalogue
  attention/         pipeline (8 sections, caps, decay, dedupe) + hard rules +
                     learned ranker + source adapters + fixtures
  integrations/      types (the Adapter contract), batch (the diff engine),
                     registry (nine lifecycle questions per provider),
                     google-calendar (the first adapter)
      ↓
src/convex/         BACKEND — persistence, orchestration, learning
  assistant.ts       NL capture, learned ranking, training, notes, snapshots
  life.ts            areas, finance/tax, connections, area-scoped tasks
  attention.ts       getAttention + four feedback mutations, server-side refusals
  model.ts           snapshots, reset, pause, feature flags, realignment
  spaces.ts          ownership backfill, personal space, membership
  integrations.ts    the registry surface and the ONE batch writer
  credentials.ts     OAuth state, PKCE, token store — no public endpoint
  calendar.ts        the Google redirect, the sync action, the read model
  schema.ts          16 tables, schemaValidation: true
  auth.*             Convex Auth (email OTP + anonymous), MUST NOT be altered
      ↓
src/pages|components   UI — Convex reactive queries, no duplicated server state
  Dashboard.tsx      area tabs, attention feed, capture, tasks, chart, notes
  AttentionFeed      the eight sections, grouped, with explainable reasons
  CalendarStrip      the next fortnight, three honest states
  Areas.tsx          TasksArea, PeopleArea, HealthArea, IntegrationsArea
  FinanceArea        country switcher, deadlines, readiness, expenses, estimate
```

**Current-state facts:**

- Tasks, notes, areas, tax data, attention feedback, the learned model,
  connections, **and calendar events** are all first-class rows. A meeting is no
  longer a task with a title.
- `internalQuery` / `internalMutation` / `httpAction` **exist** (phase 1.5–2).
  A **cron** does not: sync is on demand, and scheduling it is the first thing
  after the handshake can be exercised live.
- One connected tool is implemented end to end (Google Calendar) and refuses
  honestly until the deployment has credentials.
- The **only** object type still faked as a task title is **People** (phase 3).
- Health counters are still component-local `useState` (D4, phase 3).
- 250 unit fixtures and 7 live conformance harnesses exist; see §8.1.

#### CURRENT REALITY snapshot — verified against the repository 2026-10-01

**This section describes the repository as it exists now. It contains no target
architecture.** Target state is §1.2. The difference is §1.3.

| Question | Answer |
|---|---|
| **What exists today?** | 16 Convex tables (`users`, `spaces`, `spaceMembers`, `grants`, `accessLog`, `links`, `activity`, `tasks`, `notes`, `assistantState`, `modelSnapshots`, `attentionState`, `featureFlags`, `areas`, `taxProfile`, `expenses`, `taxDocuments`, `connections`, `connectionTokens`, `syncCursors`, `oauthStates`, `calendarEvents`), every one with `ownerUserId` + `spaceId` except the auth tables and `links`. 3 routes. 11 pure `src/lib` modules across 4 directories. Convex Auth. Brutalist design system. |
| **What works?** | NL capture; recurrence that respawns exactly once; a tax engine for 5 countries; an attention feed with eight sections, caps, decay, grouping and pins; learned ranking that can only break ties and cannot touch a hard rule; a model with rollback; an integration framework with one real, minimised, idempotent connector. |
| **What is broken?** | **N2 / Q-001** — a guest who signs up by email silently loses their data. **D32** — this deployment serves no application HTTP routes, so the OAuth redirect cannot be exercised live. Both are open and both need a decision or an environment answer, not code. |
| **What is partially implemented?** | **Calendar sync** — built, verified live against the database, but the handshake itself is blocked on credentials and on D32. **Health** — still component-local state. **Sharing** — schema and access path exist (0B); there is no UI. |
| **What is specified but not implemented?** | Everything in phase 3: People as first-class objects with reversible merge, multi-object capture, documents, commitments, Life Admin, Finance expansion, agents, export, account deletion. All specified; **none started.** |
| **What is planned?** | Phase 3, one feature at a time, each with its own spec section, ADR and budget (§11.3). |
| **What is unknown?** | Whether this deployment type can serve HTTP routes at all (D32). Every product and business assumption — see PRODUCT_CONTEXT §3.3. |

> **Everything in §1.4 marked VERIFIED below is backed by a live conformance run
> against the deployed backend**, not by inspection. See MAIN_AGENT §11 for the
> evidence levels.

### 1.2 TARGET STATE — approved future architecture

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

### 1.4 Implementation status of major capabilities

**Status vocabulary — applied strictly:**

| Term | Meaning |
|---|---|
| **NOT BUILT** | No code exists. |
| **PARTIALLY BUILT** | Some code exists; a material part of the capability is missing. |
| **BUILT** | Code exists and is wired. **Says nothing about correctness.** |
| **VERIFIED** | Required tests exist **and** all acceptance criteria and gates pass. |
| **SHIPPED** | The user explicitly considers it complete. |

> **Code existing is not verification.** `VERIFIED` below means the acceptance
> criteria pass *and* a live conformance run against the deployed backend agrees.
> `BUILT` means wired and read, which is evidence level 1–2.

| Capability | Status | Evidence | Phase |
|---|---|---|---|
| Natural-language capture | **VERIFIED** | `src/lib/nlp.ts` + live 0A/0B conformance | 0A |
| Recurring tasks | **VERIFIED** | `nextOccurrence` is wired into `setTaskCompleted`; spawned exactly once, live | 0A |
| Attention engine | **VERIFIED** | Eight sections, caps, decay, dedupe, grouping, escalation, pins — `conformance-attention.ts` | 1.0 |
| Learning / ranking | **VERIFIED** | Clamp, decaying rate, versioning, snapshots, rollback, reset, pause, flags; hard/ranked split; 12 features with 0–7 bit-identical — `conformance-1.1.ts` (25 checks) | 0C / 1.1 |
| Spaces / ownership | **VERIFIED** | `ownerUserId` + `spaceId` on every product table; one personal space per user; backfill idempotent — `conformance-0b.ts` | 0B |
| Activity / timeline | **VERIFIED** | `activity` with a closed taxonomy and an idempotency key; the 7-day chart reads it | 0B |
| Integrations (framework) | **VERIFIED** | Registry, adapter contract, one idempotent writer, credential containment checked by a gate — `conformance-1.5.ts` (35 checks) | 1.5 |
| Calendar | **PARTIALLY BUILT** | Adapter, sync, minimisation, deletion semantics and the dashboard block are verified live (`conformance-2.ts`, 33 checks). The handshake itself cannot be exercised: no credentials, and D32 | 2 |
| People | **NOT BUILT** | Still faked as `tasks.title` strings in `PeopleArea` | 3 |
| Multi-object capture | **NOT BUILT** | Capture produces exactly one task | 3 |
| Finance | **PARTIALLY BUILT** | Expenses + tax engine verified. No accounts, transactions, assets, liabilities, investments, subscriptions or goals | 3 |
| Life Admin | **NOT BUILT** | `home` area renders a generic task list | 3 |
| Agents | **NOT BUILT** | No cron, no agent modules. `internal*` functions now exist, which was the prerequisite | 3 |
| Sharing / permissions | **PARTIALLY BUILT** | Schema, `permissions.can` and the audit log verified; no UI to use them | 0B / P2 |
| Export | **NOT BUILT** | No manifest, no action | P2 |
| Deletion | **NOT BUILT** | No account deletion | P2 |
| Auth | **PARTIALLY BUILT** | Sign-in works. The guest path is defective (N2 / Q-001) | 0A |
| Tax engine | **VERIFIED** | 5 countries, closed unions in the schema, `schemaValidation: true` | 0C |
| Schema validation | **VERIFIED** | Ten closed unions; a full-conformance audit reported zero non-conforming rows before the flag was flipped | 0C |
| Design system | **BUILT** | `src/index.css`, complete, untouched since the template | — |

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
| Lint | `bun run lint` | = `eslint .` — **FAILS AT BASELINE: 3 errors, 19 warnings, all pre-existing stock shadcn / template code.** See §8.2. |
| Format | `bun run format` | = `prettier --write .` |
| Preview (built output) | `bun run preview` | |
| Dev server | `bun run dev` | = `vite`. **The agent must NOT run this** — the platform owns the dev server and Convex dev process. |
| Tests | `bun test` | 250 fixtures across 10 files. No `test` script in `package.json` is needed — `bun test` runs them directly. |
| Convex codegen + push | `bunx convex dev --once` | **Always with `--once`.** Never bare `convex dev` — non-interactive terminal, will hang. Add `--typecheck=disable` only to bootstrap codegen for a new module that calls a function the generated types do not know yet. |
| Live conformance | `bun scripts/conformance-<phase>.ts <CONVEX_URL>` | One harness per phase: `0b`, `0c`, `attention`, `1.1`, `1.5`, `2`, `occ`. Each runs against the deployed backend and exits non-zero on failure. |
| Spec drift check | `bun scripts/spec-drift.ts` | Dependency-free. 18 checks. Exits non-zero on drift. |

### 8.2 Known-failing / unavailable commands

| Purpose | Status |
|---|---|
| Lint | **FAILS AT BASELINE.** `bun run lint` reports **3 errors and 19 warnings** on untouched stock code: `src/components/ui/carousel.tsx`, `src/components/ui/sidebar.tsx`, `src/hooks/use-mobile.ts`. **Zero findings in `spec/` or `scripts/`.** Down from 12/19 at the start; the gate is *no NEW problems*. |
| HTTP routes | **NOT SERVED by this deployment.** Every application HTTP path 404s, including Convex Auth's own OIDC discovery endpoint. `convex dev --once` succeeds and validates the router, so the module is deployed — the backend does not serve it. See defect **D32**. Consequence: the OAuth redirect cannot be exercised live. |
| Reset local data | **NOT AVAILABLE.** Convex is deployed (`VITE_CONVEX_URL`), not a local backend. There is no documented reset command. Data reset requires a deliberate user action via the Convex dashboard. Do not improvise one. |
| Account deletion | **NOT BUILT.** No export manifest and no delete-everything action. Both are specified for P2. |

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
21. **Phases have explicit lifecycle status.** A specification is not an approval.
22. **The agent executes decisions; it does not own them.** Product decisions,
    ADRs, security invariants and phase approval state change only by user action.

---

## 11. Phase lifecycle and scope

### 11.1 Status vocabulary

| Status | Meaning | Who sets it |
|---|---|---|
| `NOT STARTED` | Specified, not approved. **The agent must not implement.** | default |
| `APPROVED` | Explicitly approved. Implementation may begin. | **user only** |
| `IN PROGRESS` | Implementation underway. Requires prior recorded approval. | agent (given approval) |
| `IMPLEMENTED` | Code changes exist; **acceptance verification is incomplete**. | agent |
| `VERIFIED` | All required gates and acceptance criteria pass. | agent (given evidence) |
| `SHIPPED` | The user explicitly considers the phase complete. | **user only** |
| `BLOCKED` | Names the blocking decision, dependency or failure. | agent |

**Live status: see `02_CHANGELOG.md` → Phase lifecycle status table.** All eight
phases are `NOT STARTED`.

### 11.2 Scope definition — required for every phase

### Phase 0A — Foundation and defect fixes

- **Status:** `BLOCKED` (approved, 6 of 7 tasks resolved — see CHANGE-0005, CHANGE-0006) · **Budget:** 4 files · 0 tables · 0 required deps · 1 abstraction (the deterministic-id upsert abstraction was **not** spent — ADR-022 removed the need for it)
- **IN SCOPE:** regression fixtures (nlp/tax/scorer); N1 deterministic-id upsert; N2 guest claim path *or* removal; N5 `Infinity` verification; recurrence respawn; atomic `addTask`; resolve N3/N6/N8/D13.
- **OUT OF SCOPE:** attention engine; spaces/links/activity; schema changes; model version fields; new object kinds; index migrations; any UI redesign; fixing the lint baseline.
- **DO NOT TOUCH:** `src/lib/scorer.ts` maths · `src/lib/tax.ts` figures and sources · auth config · `vite.config.ts` · theme tokens (see §13)
- **DEPENDENCIES:** none
- **BLOCKERS:** `Q-001` blocks TASK-0A-003. `Q-005` was resolved 2026-10-01 by ADR-022.
- **APPROVAL REQUIRED:** phase approval (granted 2026-10-01); Q-001 resolution
- **ACCEPTANCE CRITERIA:**
  1. 20 NLP + 34 tax fixtures committed and passing
  2. No `Infinity`/`NaN` in any dashboard payload
  3. Two concurrent completions leave exactly one `assistantState` row — **VERIFIED** by `scripts/conformance-occ.ts` against a live deployment (1,744 concurrent mutations, 0 duplicates; see ADR-022)
  4. Guest can claim data, **or** anonymous sign-in is removed from the UI
  5. Completing a recurring task yields the next occurrence exactly once
  6. `addTask` is a single call; no orphaned `area`-less tasks
  7. Feature names derive from one definition; `FEATURE_NAMES.length === FEATURE_COUNT`
  8. `bun scripts/spec-drift.ts` exits 0; `bunx tsc -b --noEmit` clean; no new lint problems

### Phases 0B – 3 (summary; full acceptance criteria at the start of each)

| Phase | IN SCOPE | OUT OF SCOPE | DO NOT TOUCH | Blockers |
|---|---|---|---|---|
| **0B** | spaces, spaceMembers, grants, accessLog, links, activity; fix 6 collect-all query sites | attention UI; model changes; agents | auth tables; `users.role`; tax figures | none |
| **0C** | weightsVersion, modelVersion, clamp, decaying lr, snapshots, reset, pause; enum validators; then `schemaValidation: true` | new features; migration framework | indices 0–7 meanings | none |
| **1.0** | hard rules, sections, budget, decay, dedupe, grouping, `attentionState`, Dashboard split | the scorer in the hard-rule path; notifications; plugin framework | scorer maths; `index.css` | none |
| **1.1** | generalised features, learned ranking, 5-signal feedback, exploration | negative category features; changes to 0–7 | indices 0–7 | none |
| **1.5** | registry, adapter contract, `applyBatch`, OAuth, tokens, cursors, lifecycle | per-provider UI; mutating scopes; provider writes | `connectionTokens` containment | credentials |
| **2** | Google Calendar adapter, OAuth, sync, minimisation | writing to Google; private titles; attendees | ADR-013 | `GOOGLE_CLIENT_ID`/`SECRET` |
| **3** | People, capture, Life Admin, commitments, Finance expansion, agents | anything without its own spec + ADR + budget | identity resolution guarantees (ADR-021) | none |

#### Phase 3, feature 1 — People as first-class objects (PROPOSED, not approved)

Phase 3 is a phase *of* phases. §11.3 requires each feature to carry its own
scope, budget and approval, and the standing roadmap approval covers *starting*
phase 3 — not every decision inside it. What follows is drafted so the first
feature can begin without re-deriving anything. **It is a proposal. The agent has
not started it and may not mark it approved.**

| Field | Value |
|---|---|
| **Feature** | People — a person is a row, not a task title |
| **Problem it solves** | `PeopleArea` stores `"catch up with mum every week"` in `tasks.title`. A person therefore cannot be shared, synced, linked to, or reasoned about, and two captures of the same person create two unrelated strings. RJD-004 already settled the hard part: never auto-merge on a name match. |
| **IN SCOPE** | a `people` table (name, `identityKeys`, tombstone, `mergedIntoId`); capture that can produce a person *or* propose one; `people` as a real area surface; `PEOPLE_FIT` (feature 10) fed by a real person id rather than a free-text name; merge and unmerge as explicit, reversible user actions. |
| **OUT OF SCOPE** | automatic merge (RJD-004); importing contacts from Google or iCloud; any inbound email parsing; anything that writes to a provider. |
| **DO NOT TOUCH** | the identity-resolution guarantees in ADR-021; indices 0–7 of the feature layout; `permissions.can` as the single access path. |
| **Budget (ADR-016)** | 6 new files · 1 new table · 0 deps · 1 abstraction (the identity-key matcher). Every figure is a ceiling, and exceeding one is a stop condition. |
| **Acceptance criteria** | (1) A capture naming a known person links to that row rather than creating a second. (2) Two rows with the same normalised name stay separate until the user merges them. (3) Merge is reversible: unmerge restores both rows and every link. (4) A merged row is a tombstone that no query returns. (5) `PEOPLE_FIT` reads the person id, so two namesakes do not share evidence. (6) Live conformance: merge → unmerge leaves the row count and the link count exactly as they were. |
| **Why it is first** | It is the only phase-3 item where the roadmap already made the hard decision (RJD-004), it unlocks feature 10 which is already computed from nothing, and it removes a place where the product currently lies about its own data model. |
| **Risks** | R7 (identity resolution) and R19 (agents) are adjacent, not involved. The real risk is scope: "people" invites contacts, threads and social graph, none of which is in the budget. |

### 11.3 Scope rules

- Work outside `IN SCOPE` is **not done**, however trivial. It becomes an Open
  Question or an explicit follow-up task.
- `DO NOT TOUCH` is not negotiable within a phase.
- Exceeding the complexity budget triggers **MAIN_AGENT §7.1** — stop, explain,
  ask. Never silently widen a budget.
- Deleting or replacing working functionality is an **architectural change**,
  not cleanup. It requires an ADR and approval.

---

## 12. Traceability

The chain: `REQ → ADR → PHASE → TASK → ACCEPTANCE → TEST → CHANGE`.

The question this answers: **"Why does this code exist, which decision authorised
it, and how do we know it works?"**

### 12.1 Requirement register

| REQ | Requirement | ADR | Primary phase |
|---|---|---|---|
| REQ-001 | No external AI/LLM API | ADR-001 | — (standing) |
| REQ-002 | Attention computed, not stored | ADR-003 | 1.0 |
| REQ-003 | No learning from absence | ADR-004 | 1.1 |
| REQ-004 | Snooze is not negative feedback | ADR-005 | 1.1 |
| REQ-005 | Hard rules bypass learned ranking | ADR-006 | 1.0 |
| REQ-006 | Typed entity tables; no generic object table | ADR-007 | 0B |
| REQ-007 | `links` holds relationships only | ADR-008 | 0B |
| REQ-008 | Ownership separate from access; many-to-many spaces | ADR-009 | 0B |
| REQ-009 | Deny by default | ADR-009 | 0B |
| REQ-010 | Credentials server-only by construction | ADR-014 | 1.5 |
| REQ-011 | Minimum OAuth scope | ADR-013 | 1.5 |
| REQ-012 | Private data is not stored at all | ADR-013 | 2 |
| REQ-013 | Agent idempotency with deterministic keys | ADR-011 | 3 |
| REQ-014 | Risky actions require explicit confirmation | ADR-011 | 3 |
| REQ-015 | Feature indices 0–7 frozen; weights versioned | ADR-010 | 0C |
| REQ-016 | Attention budget enforced with hard caps | ADR-003 | 1.0 |
| REQ-017 | Recurring tasks actually respawn | — | 0A |
| REQ-018 | Task creation is atomic (one call) | — | 0A |
| REQ-019 | No silent data loss on account upgrade | ADR-018 | 0A |
| REQ-020 | No duplicate single-row state (deterministic ids) | ADR-017 | 0A |
| REQ-021 | Regression fixtures exist for all pure logic | ADR-019 | 0A |
| REQ-022 | Enum validation; `schemaValidation: true` | — | 0C |
| REQ-023 | Indexed queries; no collect-all-and-filter | — | 0B |
| REQ-024 | Complexity budget enforced; violation stops work | ADR-016 | all |
| REQ-025 | Markdown is authoritative; HTML is a view | ADR-019 | — (standing) |
| REQ-026 | Spec health reports UNKNOWN, never a false PASS | ADR-019 | — (standing) |
| REQ-027 | Explicit phase lifecycle status | ADR-020 | — (standing) |
| REQ-028 | Approval gates for product decisions | ADR-021 | — (standing) |
| REQ-029 | Export and deletion manifests are complete and enforced | ADR-009 | P2 |
| REQ-030 | Testing is a gate, not a formality | ADR-016 | 0A |
| REQ-031 | Preserve working functionality | ADR-021 | all |
| REQ-032 | No fabricated integrations or completion | — | all |

### 12.2 Full chains — Phase 0A (next)

| REQ | ADR | Phase | Task | Acceptance | Test | Change |
|---|---|---|---|---|---|---|
| REQ-021 | ADR-019 | 0A | TASK-0A-001 | AC-0A-001 | TEST-0A-001 | CHANGE-0005 |
| REQ-020 | ADR-022 | 0A | TASK-0A-002 | AC-0A-003 | TEST-0A-002 | CHANGE-0006 — superseded ADR-017; verified |
| REQ-019 | ADR-018 | 0A | TASK-0A-003 | AC-0A-004 | TEST-0A-003 | **NOT DONE — BLOCKED by Q-001** |
| REQ-030 | ADR-016 | 0A | TASK-0A-004 | AC-0A-002 | TEST-0A-004 | CHANGE-0005 |
| REQ-017 | — | 0A | TASK-0A-005 | AC-0A-005 | TEST-0A-005 | CHANGE-0005 |
| REQ-018 | — | 0A | TASK-0A-006 | AC-0A-006 | TEST-0A-006 | CHANGE-0005 |
| REQ-032 | ADR-019 | 0A | TASK-0A-007 | AC-0A-007 | TEST-0A-007 | CHANGE-0005 |

**Phase 0A task detail**

| Task | Defect | Description | Status |
|---|---|---|---|
| TASK-0A-001 | — | Commit regression fixtures: 20 NLP cases, 34 tax cases, scorer golden trajectory + fixed-ranking fixture. | Done — 102 fixtures |
| TASK-0A-002 | N1 | Replace read-then-insert with a deterministic-id upsert for `assistantState`. | **Closed by ADR-022** — the task as written is obsolete; that mechanism does not exist in Convex. The read-then-insert path is correct as-is, verified against a live deployment. |
| TASK-0A-003 | N2 | Guest claim path, **or** remove anonymous sign-in. | **BLOCKED by Q-001** |
| TASK-0A-004 | N5 | Verify whether Convex round-trips `-Infinity`; adopt a finite sentinel regardless. | Done — finite sentinel adopted |
| TASK-0A-005 | D5 | Wire `nextOccurrence` into completion; idempotent. | Done — guarded by a transition check |
| TASK-0A-006 | D6 | Single-call `addTask({ input, area })`. | Done |
| TASK-0A-007 | N3, N6, N8, D13 | Resolve dead `previewCapture`; unify feature-name and priority definitions; de-duplicate `filingYear` and `requireUserId`; remove dead `toMondayIndex`. | Done |

### 12.3 Target chains — later phases (not yet implemented)

`—` means the artifact does not exist yet. **A `—` is honest; a guessed id is not.**

| REQ | ADR | Phase | Acceptance | Test | Change |
|---|---|---|---|---|---|
| REQ-006/007/008/009/023 | ADR-007/008/009 | 0B | AC-0B-* | — | — |
| REQ-015/022 | ADR-010 | 0C | AC-0C-* | — | — |
| REQ-002/005/016 | ADR-003/006 | 1.0 | AC-10-* | — | — |
| REQ-003/004 | ADR-004/005 | 1.1 | AC-11-* | — | — |
| REQ-010/011 | ADR-014/013 | 1.5 | AC-15-* | — | — |
| REQ-012 | ADR-013 | 2 | AC-2-* | — | — |
| REQ-013/014 | ADR-011 | 3 | AC-3-* | — | — |
| REQ-029 | ADR-009 | P2 | — | — | — |

---

## 13. Do Not Touch register

**Binding.** Deleting or replacing anything here is a deliberate architectural
change requiring an ADR and approval — **never cleanup** (MAIN_AGENT E4, REQ-031).

### 13.1 Working functionality

| # | Protected | Why |
|---|---|---|
| 1 | `src/lib/tax.ts` figures, `asOf` dates and `source` strings | Verified against the issuing authority at source. The provenance string is the only reason a stale figure would be *detectable*. Rewriting it destroys auditability. |
| 2 | Finance disclaimer rendered as the **first** element of the area | MAIN_AGENT P10. Moving it to a footer would be a regression, not a cleanup. |
| 3 | Blended tax rate + explicit "SE tax not modelled" warning | Honesty about what the model can and cannot do. Removing the caveat makes a guess look like advice. |
| 4 | Expense categoriser's deliberate `low` confidence for Meals / home office / education | MAIN_AGENT P10. Raising confidence would hide genuine uncertainty. |
| 5 | `pending-credentials` status and disabled "not built yet" buttons | MAIN_AGENT E9. An integration that fakes success is worse than one that admits it is not wired. |
| 6 | `src/lib/scorer.ts` maths — `score`, `sigmoid`, `trainOne`, `explain` | Tested once and working. Any change needs regression fixtures **first** (TASK-0A-001). |
| 7 | `src/lib/nlp.ts` token-consumption loop (`used` flag) | The mechanism multi-object capture will reuse. Rewriting it would discard the bug fixes already made (`#42`, `every 3 days`, stray `at`). |
| 8 | `recordOutcome` as the single weight-mutation point | Deliberate architectural seam. Any second writer is a defect. |
| 9 | `disableArea` re-homing tasks to `general` rather than deleting | MAIN_AGENT E8. Never delete user data as a side effect of configuration. |

### 13.2 Configuration intentionally preserved

| # | Protected | Why |
|---|---|---|
| 10 | `src/convex/auth.config.ts` standard provider entry | The deployment self-issues JWTs **without a `kid` header**. Converting that entry to `type: "customJwt"` makes sign-in silently never confirm, and `RequireAuth` loops to `/auth` forever. |
| 11 | `...authTables` spread in `schema.ts` | Explicitly marked do-not-remove by the Convex Auth template. |
| 12 | `vite.config.ts` in full | Platform constraint. Also `server.hmr: { overlay: false }` is pre-existing template config — leave it. |
| 13 | `src/index.css` Tailwind directives, theme variables, `brutal*` classes | Removing any breaks all styling app-wide. |
| 14 | `index.html` Archivo Black + Space Mono links | The design system depends on these fonts loading. |
| 15 | `convex.json` `"aiFiles": {"enabled": false}` | Enforces ADR-001 at the platform level. Do not enable. |
| 16 | `src/main.tsx` providers, error boundaries and `import "./index.css"` | Removing the stylesheet import produces a blank, unstyled preview. |

### 13.3 Intentionally accepted technical debt

| # | Item | Why accepted |
|---|---|---|
| 17 | `schemaValidation: false` | Enabling before enum validators would surface junk we are about to create. Scheduled for 0C. |
| 18 | `users.role` (template `admin`/`user`/`member`) | **Quarantined** so it is never mistaken for the grants model (ADR-009). Not removed, because the auth template expects it. |
| 19 | Lint baseline of 12 errors / 19 warnings | Pre-existing. The gate is "no new problems" until cleaned. See CHANGE-0003. |
| 20 | `AssistantDoc` uses `any` for `_id`/`userId` | Documented workaround for a `DataModel["table"]` wrapper-type issue. Revisit when types change in 0B. |
| 21 | `getDashboard` loads all tasks unbounded | Fine at personal scale; fixed with the query-idiom work in 0B. |

### 13.4 Requires an ADR before modification

| # | Area |
|---|---|
| 22 | Anything in `src/lib/scorer.ts` maths or the feature layout |
| 23 | The Convex schema shape (any table or field) |
| 24 | The auth configuration |
| 25 | The security/privacy model (SYSTEM_FUNDAMENTALS §4) |
| 26 | Any change to ADR-001 through ADR-021 — supersede with a new ADR, never edit in place |

### 13.5 Product decisions intentionally not being revisited

All of **RJD-001 … RJD-011** (CHANGELOG → Rejected Decisions) plus `Q-002`,
`Q-003`, `Q-004` as recorded open questions. Reopening any of them requires new
evidence that invalidates the original reasoning — not a change of taste.

---

## 14. Completion contract

A phase is `VERIFIED` **only** when every condition below holds. If any fails,
the result is `NOT VERIFIED`.

| # | Condition |
|---|---|
| 1 | Required files exist |
| 2 | Required code exists |
| 3 | **Required tests exist** (Phase 0A creates the first) |
| 4 | Required gates pass (`bun scripts/spec-drift.ts`, typecheck, codegen if applicable) |
| 5 | No **new** lint problems vs. the 12/19 baseline |
| 6 | No type errors |
| 7 | No specification drift |
| 8 | Every acceptance criterion passes |
| 9 | Security requirements pass (SYSTEM_FUNDAMENTALS §4) |
| 10 | Complexity budget respected — no silent increase |
| 11 | CHANGELOG updated with a `CHANGE-XXXX` entry including severity |
| 12 | Relevant specifications updated |
| 13 | **No unauthorised scope changes** |

**Reporting rule.** If any condition fails, report `NOT VERIFIED` with the
failing condition named. Never report `VERIFIED` with a caveat. Never let
`IMPLEMENTED` be presented as `VERIFIED`.

**Only the user may set `SHIPPED`.**

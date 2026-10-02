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
| **What is specified but not implemented?** | The rest of phase 3: documents, commitments + Waiting On, Life Admin, Finance expansion, agents. Also export and account deletion (P2). Phase 3 features 1 (People) and 2 (Multi-object Capture) are **built and verified**. |
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
| People | **VERIFIED** | `src/convex/people.ts`; reversible tombstone merge, no auto-merge ever — `conformance-3.ts` (50 checks) | 3 |
| Multi-object capture | **VERIFIED** | One capture, many tasks; splits on explicit structure only; server-authoritative — `conformance-4.ts` (51 checks) | 3 |
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

1. Write it as a **pure function** in `src/lib/agents.ts` — no DB, no Convex imports. (CHANGE-0018: §9.3 originally said `src/lib/agents/`; it is a file while the registry holds one agent, and a directory becomes correct the day a second agent with no existing producer arrives.)
2. Give it a deterministic idempotency key.
3. Return a typed tier (`automatic` / `proposed` / `confirm`). Risky actions can
   only be `confirm`.
4. Add fixtures covering: the fire case, the non-fire case, and a double-run
   (idempotency).
5. Assert `traceAgent()` as a **purity fixture** — same input, same trace, no effect — rather than as a golden trace, which would only re-state the implementation. (CHANGE-0018 correction: a golden trace is not a property.)
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
| **3** | People, capture, Life Admin, commitments, Finance expansion, agents | anything without its own spec + ADR + budget | identity resolution guarantees (ADR-021) |
| **4** | **4A** area-native surfaces: Finance workspace, contextual add, commitments as objects, honest Home. **4B** transactions + document ingestion — **architecture only, BLOCKED on Q-008** | new pages, routes or a second navigation tier · a new attention kind · a new table in 4A · any change to the capture parser · double-entry, journals, a stored balance column, reconciliation, OCR, or an LLM in 4B | ADR-028 (until Q-008 is answered) · ADR-029 · `estimateTax` · the scorer · `nlp.ts` · `recordOutcome` | `Q-008` blocks all of 4B · 4A needs approval (CHANGE-0019) | guarantees (ADR-021) | none |

#### Phase 3, feature 1 — People as first-class objects (APPROVED · **VERIFIED**)

> **Status corrected 2026-10-01.** This block previously read "PROPOSED, not
> approved", which had drifted: PRODUCT_CONTEXT line 452 records
> `People as first-class objects | APPROVED | 3`, and the standing roadmap
> approval of 2026-10-01 covers starting phase 3. Code wins, and the
> specification was the stale side. Built and verified as CHANGE-0013; ADR-023
> (merge is a tombstone) and ADR-024 (identity keys, and a name is the weakest
> one) were recorded with it.

Phase 3 is a phase *of* phases. §11.3 requires each feature to carry its own
scope, budget and approval, and the standing roadmap approval covers *starting*
phase 3 — not every decision inside it. What follows is the approved scope for
the first feature.

| Field | Value |
|---|---|
| **Feature** | People — a person is a row, not a task title |
| **Problem it solves** | `PeopleArea` stores `"catch up with mum every week"` in `tasks.title`. A person therefore cannot be shared, synced, linked to, or reasoned about, and two captures of the same person create two unrelated strings. RJD-004 already settled the hard part: never auto-merge on a name match. |
| **IN SCOPE** | a `people` table (name, `identityKeys`, tombstone, `mergedIntoId`); capture that can produce a person *or* propose one; `people` as a real area surface; `PEOPLE_FIT` (feature 10) fed by a real person id rather than a free-text name; merge and unmerge as explicit, reversible user actions. |
| **OUT OF SCOPE** | automatic merge (RJD-004); importing contacts from Google or iCloud; any inbound email parsing; anything that writes to a provider. |
| **DO NOT TOUCH** | the identity-resolution guarantees in ADR-021; indices 0–7 of the feature layout; `permissions.can` as the single access path. |
| **Budget (ADR-016)** | 6 new files · 1 new table · 0 deps · 1 abstraction (the identity-key matcher). Every figure is a ceiling, and exceeding one is a stop condition. **Used: 4 files · 1 table · 0 deps · 1 abstraction.** |
| **Acceptance criteria** | (1) A capture naming a known person links to that row rather than creating a second. (2) Two rows with the same normalised name stay separate until the user merges them. (3) Merge is reversible: unmerge restores both rows and every link. (4) A merged row is a tombstone that no query returns. (5) `PEOPLE_FIT` reads the person id, so two namesakes do not share evidence. (6) Live conformance: merge → unmerge leaves the row count and the link count exactly as they were. |
| **Why it is first** | It is the only phase-3 item where the roadmap already made the hard decision (RJD-004), it unlocks feature 10 which is already computed from nothing, and it removes a place where the product currently lies about its own data model. |
| **Verified how** | 28 unit fixtures (`src/lib/people.test.ts`) and 50 live conformance invariants (`scripts/conformance-3.ts`, 0 skips). All six acceptance criteria pass against a real deployment. `recordOutcome` writes `assistantState`, so ADR-022's OCC invariant was re-verified rather than assumed: 3 rounds × 8 concurrent mutations, 48 mutations, 0 duplicates (run F; cumulative 1,840 / 39 rounds). |
| **What the run found** | **D34** — `SOURCE_FIT` (9) and `PEOPLE_FIT` (10) had never received evidence. `recordOutcome` was handed the raw database row, whose fields are `origin` and `personId`, while the feature object is keyed `source` and `person`. Both optional, so nothing threw; the roll-ups silently returned unchanged. The two features were identically 0 at training and at inference, so their weights never took a gradient. Acceptance criterion 5 is what found it. Fixed by deriving the feature object once and passing the *same* object to both halves, so a field rename is now a compile error. Layout untouched: `FEATURE_COUNT` 12, `WEIGHTS_VERSION` 1, indices 0–7 unchanged, nothing migrates. Also **D35** (the name normaliser was being applied to email addresses) and **D36** (a recurring task lost its person on respawn). |
| **Risks** | R7 (identity resolution) and R19 (agents) are adjacent, not involved. The real risk is scope: "people" invites contacts, threads and social graph, none of which is in the budget. |

#### Phase 3, feature 2 — Multi-object Capture (APPROVED · **VERIFIED**)

> **Status 2026-10-01.** APPROVED as a roadmap line (`Multi-object capture |
> APPROVED | 3 | Per-kind confidence thresholds` in PRODUCT_CONTEXT §5.2). The
> line is a *name*, not a specification: it does not say which object kinds
> are supported, what confidence means, or what happens on ambiguity. Those
> were product decisions, so this block was written from the established
> architecture and the evidence in R-004 rather than inferred silently.
> Built and verified as CHANGE-0013’s successor CHANGE-0014. The one genuinely
> unresolvable question is isolated as **Q-006** below, and it is
> non-blocking.

##### The specification gap this had to close

The only prior text was one roadmap line. Three questions were unanswerable
from it, and each changes what gets built:

1. **Which object kinds may a single capture produce?** Not established.
2. **What does "confidence" mean, and what follows from it?** Not established.
3. **What happens when a capture is ambiguous?** Not established.

Answering these from the *existing* architecture rather than from invention:

| Question | Answer, and why it follows |
|---|---|
| Which kinds? | **Task only.** Every other kind the roadmap lists for capture — commitment, document, expense, note — is either a *separate approved phase-3 feature* with its own table and budget (commitments, Life Admin/documents), or already has a dedicated, tested create path that NL capture would shadow (`addNote`, `addExpense`). A `commitments` table does not exist; creating it here would spend Feature 3's budget without its spec. **Feature 2 makes one capture produce more than one *task*.** Everything else waits for its own feature. |
| What is confidence? | **Confidence is about *segmentation*, not comprehension.** The parser already decides *what a task is* with a closed, tested vocabulary. The new uncertainty is only: *did the user mean one thing or several?* So confidence is measured on the split, and it is per-segment. |
| Ambiguity? | **Split only on explicit structure; never on prose conjunction.** This is the one decision that could damage data, and research settled it (R-004). |

##### 12.0 Scope block — Multi-object Capture

| Field | Value |
|---|---|
| **Feature** | Multi-object Capture — one capture can produce several tasks |
| **Problem it solves** | `parseTaskInput` returns exactly one `ParsedTask`. A user who thinks in lists — "call the dentist, renew the passport, email Raj" — must capture three times, and the first two land in one title with the separators left in it. Capture is the product's front door (principle P5) and it currently makes the user do Panel's segmentation work. |
| **User outcome** | The user types what is actually in their head, in one go, and gets the right number of correctly-segmented, correctly-dated tasks. Not more objects — **fewer keystrokes and fewer corrections**. |
| **Supported input** | A single string, up to 400 characters. Segments are separated by **newline**, **semicolon**, or the literal ` and then `. An input with no separator behaves **exactly as it does today** — one task, byte-identical output. |
| **Supported object types** | **Task only.** No other kind may be created by this feature. |
| **Extraction behavior** | Reuse `parseTaskInput` per segment, unmodified. The `used`-flag token loop is Do-Not-Touch #7 and is not edited. |
| **Confidence behavior** | Every segment carries a `confidence` and a `reason` string, both server-computed. Three values: `high` (explicit separator), `medium` (separator present but a segment is a fragment under 3 characters or a bare date cue), `low` (would require prose-conjunction splitting — which never happens, so `low` is reserved for refusal, below). The **server result is authoritative**; the client preview is advisory and may differ. |
| **Object creation rules** | `high` → create. `medium` → create, and the segment is flagged in the response so the UI can say so. `low` → **create nothing**; the whole capture is refused and the user is told why. |
| **Relationship rules** | A `personId` may be attached to a created task **only** when the caller passed one explicitly (already supported) or when a segment *begins* with a known person's name and the remainder is non-empty. Never inferred from co-occurrence. People are matched through `resolvedIdentityKeys`; **no merge, ever** (ADR-024, RJD-004). |
| **Duplicate behavior** | No new deduplication infrastructure. A repeated capture creates repeated tasks — the same as today. The only duplicate rule in scope is the existing person refusal (`createPerson` refuses a probable duplicate), and capture **does not call `createPerson` at all** in this feature. |
| **Ambiguity behavior** | `"call the dentist and book the dentist"` is **one task**, because `and` alone is not a separator. This is deliberate and is the single most important behaviour in the feature. |
| **Failure behavior** | Empty segment → dropped, and the drop is reported. All segments invalid → nothing created, one plain-language reason. Over the segment cap → the excess is **not silently dropped**; the count is returned. |
| **Authorization** | Server-side, from the session only. `personId`, if supplied, is ownership-checked exactly as `addTask` already does. No client-supplied `ownerUserId` or `spaceId` is ever read. |
| **Ownership / space** | `ensurePersonalSpace` once per capture; every created task carries the same `ownerUserId` + `spaceId`. One capture cannot span two spaces. |
| **Audit** | One `capture.committed` activity row per accepted capture, carrying the segment count. This kind is **already in the closed taxonomy and has never been written** — see D38. |
| **Learning implications** | Each created task flows through the **existing** `addTask` path, so `area`, `source` and `person` are set by the same code as today and `SOURCE_FIT`/`PEOPLE_FIT` receive evidence exactly as they do now. **No new feature index.** `FEATURE_COUNT` stays 12, `WEIGHTS_VERSION` stays 1, indices 0–7 untouched. Whether a *multi-object* capture is a good outcome is a learning question with no settled answer — recorded as Q-006, not guessed. |
| **Acceptance criteria** | (1) One capture with two explicit separators produces three tasks, each parsed independently and correctly dated. (2) An input with **no** separator produces exactly one task, byte-identical to today's output for the same string. (3) `"call the dentist and book the dentist"` produces **one** task, not two. (4) A segment the parser cannot understand is dropped **and reported**, never silently. (5) Every created task is owner-scoped, in the personal space, and invisible to a second account. (6) `capture.committed` is written exactly once per accepted capture, carrying the real segment count. (7) The server is authoritative: a client that lies about its own parse still gets the server's segmentation. (8) Existing capture behaviour is unchanged: the 21 existing `nlp.test.ts` fixtures and the live 0A/0B conformance all still pass, unmodified. |
| **Out of scope** | commitments · documents · expenses · notes · areas as new objects · any prose-conjunction splitting · fuzzy/embedding matching · creating a person from a capture · an LLM (ADR-001) · a generic object engine · changing the parser's vocabulary · touching `recordOutcome`'s single-writer guarantee (Do-Not-Touch #8) |
| **Protected areas** | Do-Not-Touch #7 (`nlp.ts` token loop), #6 (scorer maths), #8 (`recordOutcome` as the single weight writer), ADR-010 feature layout, ADR-023/024, ADR-021 identity guarantees, `permissions.can` as the sole access path. |
| **Dependencies** | Phase 3 feature 1 (VERIFIED) — capture links to real people. Nothing else. |
| **Blockers** | **Q-006** (below) is not blocking: it governs *feedback*, and the feature can ship with capture feedback deliberately deferred. |
| **Budget (ADR-016)** | **4 new files · 0 new tables · 0 deps · 1 abstraction** (the segmenter, in `src/lib/capture.ts`). **Used: 2 files · 0 tables · 0 deps · 1 abstraction.** Zero new tables was the load-bearing constraint: a capture feature that needed a new table would be a different feature. |
| **Verification** | Unit fixtures for the segmenter (pure, injected clock). A live conformance harness asserting all 8 criteria, including cross-user isolation and the byte-identical unchanged-behaviour check. If the capture path touches `recordOutcome`, ADR-022 OCC is re-armed and re-run — **not inherited**. |
| **Verified how** | **CHANGE-0014, VERIFIED.** 43 unit fixtures (`src/lib/capture.test.ts`) and 51 live invariants (`scripts/conformance-4.ts`, 0 skips). All 8 acceptance criteria pass against a real deployment. The 21 pre-existing `nlp.test.ts` fixtures pass unmodified — Do-Not-Touch #7 was honoured. OCC re-verified as run G (48 mutations, 0 duplicates) because `assistant.ts` changed, even though `capture` demonstrably writes no `assistantState`. |
| **What the build found** | Three bugs the fixtures caught before review did: the segmenter attributed the wrong separator and missed a mixed one; leading-person matching never fired because the boundary check ran after trimming; and the cue-only drop rule was broad enough to delete real tasks. Also **D39**: the first `captureAudit` draft read `activity` across every space in the deployment and filtered in JavaScript — a table-wide collect, reintroduced one feature after phase 3 feature 1 audited for exactly that (D37). Caught in self-review, not by a test. |
| **Open, non-blocking** | **Q-006** — whether a multi-object capture should itself be a learning signal. Interim answer shipped and verified live: no. Capture is authorship; only completion is an outcome. |

##### Q-006 — Should a capture that produced several objects be treated as a better or worse outcome?

- **Status:** OPEN. Not blocking Feature 2.
- **The question.** Today the model learns from *task completion*: a task the user completes teaches Panel they finish things like that. A multi-object capture is a **single act of authorship producing N tasks**, none of which is a signal about any individual task. If Panel treats "created via multi-capture" as a positive training signal, every one of those tasks inherits evidence it never earned. If it is silent, a genuinely useful behaviour stays unlearned.
- **Options.** (a) No learning signal from capture at all — capture is authorship, not outcome, and only completion is an outcome. (b) A new feature index for "created in a multi-object capture", appended at 12, requiring the ADR-010 governance. (c) Use the existing `origin` field to mark the source and let completion-supplied evidence dominate.
- **Recommendation (technical only, not a product decision):** **(a)**. It is the smallest option, it cannot leak authorship into outcome evidence, and it is consistent with ADR-004's refusal to learn from something other than an explicit outcome. Option (b) spends a frozen-layout slot on a hypothesis, which is exactly what ADR-010 exists to prevent.
- **Blocked by:** a human decision. The agent may recommend, not decide.
- **Interim behaviour:** Feature 2 ships with (a) — created tasks are ordinary `panel`-origin tasks and the capture path adds no training signal. If the user later prefers (b), it is an additive change to the feature layout, not a redesign.

#### Phase 3, feature 3 — Life Admin: the expiry → renewal chain (APPROVED · IN PROGRESS)

> **Status 2026-10-01.** APPROVED as a roadmap line (`Life Admin / documents |
> APPROVED | 3 | Expiry → renewal chain`, PRODUCT_CONTEXT §5.2). As with Feature
> 2, the line is a *name*, not a specification, and this block was written
> before any code from the evidence in R-006 and R-007 rather than by
> inventing a product.

##### The audit that had to happen first

The instruction was explicit: do not assume a new `documents` table is required,
and do not assume `taxDocuments` can be generalised. Both were checked against
the repository before anything was designed.

| Question | What the repository actually does |
|---|---|
| What is `taxDocuments`? | `{ ownerUserId, spaceId, requirementId, gatheredAt }` — one row per **requirement id from a closed static country catalogue** (`COUNTRIES[c].documents`), toggled on and off. `gatheredAt` is when the user ticked it, not an expiry. There is no label, no date, no lifecycle. |
| What does `toggleDocument` do? | A point lookup on `by_owner_requirement`, then either insert or delete. It is a **checklist toggle**, not a document lifecycle operation. Nothing depends on its shape beyond the Finance checklist UI, `life:getFinance` and the `document.incomplete` hard rule. |
| Can `taxDocuments` absorb this feature? | **No, and four independent reasons.** (1) `requirementId` is a catalogue id; a passport is in no tax catalogue. (2) `readinessScore(country.documents, gatheredIds)` maps `requirementId` back to a catalogue entry, so a non-catalogue row would score as nothing. (3) `by_owner_requirement` gives one row per requirement — two passports could not coexist. (4) It would couple a user domain object to Do-Not-Touch #1, the verified tax figures. It stays exactly as it is. |
| Can `tasks` express it instead? | It expresses the **renewal action** and nothing else. A task has no expiry and no identity; `recurrence` respawns on a fixed cadence, which R-006 shows is wrong for a document whose validity period is 10 years, 3 years or 1 year, and which would keep firing after a renewal replaced the date. |
| Does a `documents` table genuinely need to exist? | **Yes.** Proven by elimination above, not assumed. ADR-007 already requires one table per object kind, and §3.2 has listed `documents` as a target table since the beginning. |
| Where does it live in the UI? | The existing **Tab system**. `home` renders a generic task list today and its own blurb is "Repairs, cleaning, and the admin of running a place" — a passport is not that, and widening `home` would distort an area that is already correct. Feature 3 adds one `AreaSlug` (`life`) and one body in the Dashboard switch. **No second Page system.** |

##### The specification gap this had to close

Six questions were unanswerable from the roadmap line, and each changes what
gets built:

1. **What is a "document"?** Unanswered, and it decides whether this is a
   document manager.
2. **What is the deadline — the expiry, or something earlier?** Unanswered,
   and R-006 shows the obvious answer is wrong.
3. **What states does the chain have?** Unanswered, and the temptation is to
   invent a status enum.
4. **What happens on renewal completion, and who sets the new date?** This is
   the step that silently fails.
5. **Does expiry become Attention, and as what?** Notification-spam risk.
6. **Is expiry a learning signal?** Q-006's cousin.

| Question | Answer, and why it follows |
|---|---|
| What is a document? | **Metadata about keeping a credential valid.** Label, expiry date, how early to warn. No file, no number, no scan (R-007). |
| The deadline | **`expiresAt − leadDays`.** Not the expiry. The expiry is when the document stops working; the deadline is when the user has to start (R-006). |
| States | **Seven, all derived** from `(expiresAt, the linked renewal task)` and `now`. **No stored status field** (ADR-025). |
| On renewal completion | **One atomic mutation** sets the new expiry *and* completes the task. The generic task path stays reachable, so the model also detects the case where it was used and the date never moved. |
| Attention | **One new hard kind**, `document.expiring`, in the existing `deadlines` section, which already has a budget, a cap and a disclosed overflow count. |
| Learning | **No new index and no new signal from authorship.** A completed renewal is already a real outcome and trains through the existing path. |

##### 12.0 Scope block — Life Admin / documents

| Field | Value |
|---|---|
| **Feature** | Life Admin — a document with an expiry, and the renewal that keeps it valid |
| **Problem it solves** | Panel knows every tax deadline in five countries and can tell you a filing document is missing. It knows **nothing** about the passport, the licence, the insurance or the vehicle registration. The failure those share is discovered late and expensively — a passport with under six months left is refused by some carriers; a licence lapse is a missed shift; an insurance lapse is an unpaid claim. R-006: the deadline is not the expiry date, and nobody can be reminded at a date they were never told about. |
| **User outcome** | Keep one list of the things that expire, and be told at the point where starting is still possible. |
| **IN SCOPE** | A `documents` table holding **metadata only**; a derived expiry state machine in `src/lib/documents.ts`; the renewal expressed as an **ordinary `tasks` row** pointing at the document; an atomic renewal completion; one new hard Attention kind; one new `AreaSlug` (`life`) rendering a Life Admin surface in the **existing Tab system**; four `document.*` activity kinds that are actually written and readable back. |
| **OUT OF SCOPE** | File storage, upload, images, document numbers, references or scans (R-007) · automatic renewal, payments, bookings, government submissions or any external action · natural-language capture of documents · merging two documents · a per-country or per-document-type catalogue of lead times · a `status` column · a new Attention section · a second prioritisation system · email or push notifications · any change to `taxDocuments`, `toggleDocument` or the Finance checklist. |
| **DO NOT TOUCH** | `taxDocuments` and `toggleDocument` exactly as they are · Do-Not-Touch #1 (`tax.ts` figures) · #6 (scorer maths) · #7 (`nlp.ts` token loop) · #8 (`recordOutcome` as the single weight-mutation point — `completeRenewal` is a second **caller**, never a second writer) · #9 (`disableArea` re-homes rather than deletes) · ADR-010 feature layout (indices 0–7; `FEATURE_COUNT` stays 12, `WEIGHTS_VERSION` stays 1) · ADR-023/024 · the `deadlines` section budget of 4. |
| **Supported object types** | The document and its renewal task. **Nothing else.** A capture still creates tasks only (Feature 2, unchanged). |
| **Existing objects reused** | `tasks` (the renewal, with `documentId`) · `people` (a document may name whose it is) · `areas` (`life`, via `enableArea`/`disableArea`) · `activity` (the audit) · `attention` (the rule, the section, the budget, the feedback path) · `spaces` (`ensurePersonalSpace`) · `schema.objectKindValidator` (`document` is **already** a declared literal) · `schema.LINK_RELS` (`occursBefore` is available if ever needed — not used in this feature). |

##### The domain model, and why it is this small

**`documents`** — five columns, one of them required:

| Column | Type | Why it exists |
|---|---|---|
| `ownerUserId`, `spaceId` | ids | ADR-009. Every product object carries both. |
| `label` | `string` (1–80, trimmed) | What the user calls it. The only free text in the row. |
| `expiresAt` | `number?` | Epoch ms. **Optional**: absent means "no expiry recorded", and such a row never becomes Attention. |
| `leadDays` | `number?` | How many days before expiry the renewal must start. Optional, defaulting to `DEFAULT_LEAD_DAYS` — see the honesty note below. |
| `createdAt` | `number` | Ordering, and the sort key for the list. |

Indexes: `by_space`, `by_owner`, and `by_owner_expiry`
(`ownerUserId, expiresAt`). The third exists because Convex omits a document
from an index when the indexed field is absent, so that range holds **exactly
the documents that have an expiry** — which is precisely the set Attention
needs, and it is narrower than the list read. D37 and D39 were both unbounded
collects; this index is the reason the Attention read is bounded by what it
actually uses.

**`tasks.documentId`** plus `by_owner_document`, mirroring `tasks.personId`
exactly. The **task points at the document; the document never points at the
task.** Three reasons: the query "the renewal for this document" is an index
range rather than a reverse scan; task rows are created and deleted constantly
and a document holding a task id would need patching on every one of them; and
ADR-023's principle — *nothing rewrites anything, every read resolves through
the relation* — generalises for free.

**What is deliberately NOT stored:**

| Not stored | Why it is derived instead |
|---|---|
| `status` / `state` | A stored status can disagree with the two inputs it summarises. That is the D34 defect class exactly, and the D34 lesson is that a "nothing happened" roll-up compiled cleanly and was permanently zero. |
| `renewalStartedAt` | "Renewal underway" **is** "there is an open task with this `documentId`". Storing it would create a second copy that can drift. |
| `renewedAt` / renewal history | `activity` already records the event, and the *evidence* that a renewal happened is the new expiry date, which is on the row. |
| `validityDays` / a cadence | R-006: validity periods differ per document *and per person* (10y passport, 3y licence from 70, 1y insurance). A cadence would be confidently wrong. |

**What belongs where, answered:**

| Question | Answer |
|---|---|
| The document itself | label, expiry, lead time |
| The renewal process | a `tasks` row — `title` is where "what renewal involves" lives, which is why the table needs no notes field |
| A task | the action, its due date, its completion — unchanged |
| Attention | computed, never stored (ADR-003) |
| A person | `personId`, for "this is Raj's passport", reusing Feature 1 wholesale |
| A space | `ensurePersonalSpace`; `disableArea` re-homes tasks and never deletes documents |

##### The chain, precisely — expiry → renewal → new expiry

A pure function `describeDocument(doc, renewalTask, now)` returns one of seven
states. There is **no stored state machine**, so no state can be wrong (ADR-025).

| State | Condition | Attention? | What the surface offers |
|---|---|---|---|
| `undated` | no `expiresAt` | no | “Add the date so Panel can watch it” |
| `valid` | `expiresAt − now > lead` | no | the date, and how long until the window opens |
| `due` | `0 < expiresAt − now <= lead`, no open renewal | **yes** | **Start renewal** |
| `renewing` | an open renewal task exists, expiry not yet passed | no — the task speaks for itself | “Renewal in progress”, linking to the task |
| `renewing-late` | an open renewal task exists, expiry passed | no — the task is already `task.overdue` | as above, flagged late |
| `expired` | `expiresAt <= now`, no open renewal | **yes**, pinned | **Start renewal** |
| `stale` | `expiresAt <= now` and a renewal task completed at a time **after** `expiresAt`, with the expiry never advanced | **yes**, highest severity | **Record the new expiry** |

The explicit cases the chain has to handle, and how:

- **No expiry / renewal date unknown** → `undated`. The row exists, Panel is
  honest that it cannot watch it, and nothing nags. *Rejected alternative: a
  separate `date-unknown` state.* It would change no behaviour, so it is not
  created (step 11: do not create states the product does not need).
- **Expiry known, far off** → `valid`. Silent.
- **Renewal date unknown** — the same thing as “expiry unknown”, because the
  renewal date is *computed* from the expiry and the lead time. There is
  nothing else it could be known from. This is a consequence of R-006, not an
  omission.
- **Renewal required / underway / renewed** → `due` / `renewing` / the new
  `expiresAt`. “Renewed” is an **event in `activity`, not a state**: once the
  new date is set, the document is simply `valid` or `due` again, which is
  correct — a renewed passport *is* a passport with a later date.
- **Renewal failed or incomplete** → `stale`. This is the state the whole
  design is built to make visible. The renewal task is an ordinary task, so the
  user *can* complete it through the normal dashboard checkbox, which trains
  the model correctly and never touches `expiresAt`. Without `stale` that is a
  silent data-integrity failure: a completed task next to a document that still
  reads as expired. With it, the surface says exactly what happened.

**Lead time — an honesty decision.** R-006 found 90 days (Virginia DMV), 60
days (Utah DMV), 4–6 weeks plus mailing (State Department) and 6 months
(USAGov’s entry warning). These are not one number and they are not
country-independent. Panel therefore ships **one clearly-labelled default of 30
days**, overridable per document, and states in the UI that it is a default and
not a figure from any authority. A catalogue of per-country, per-document lead
times would be a `tax.ts`-shaped table of figures this project cannot audit —
and Do-Not-Touch #1 exists because unverifiable figures are exactly the
liability. If a user wants the DMV's 90 days, they type 90.

**The new expiry must move forward.** `completeRenewal` refuses a
`newExpiresAt` that is not later than the current expiry, with a plain message.
A chain that can run backwards is not a chain. A *renewal completed late*,
producing a date that is already in the past, is **allowed** — that is reality,
and the state machine will correctly report `expired`.

##### Lifecycle, authorization, attention, learning

| Field | Value |
|---|---|
| **Lifecycle** | `createDocument` → `startRenewal` (creates the linked task, due at `expiresAt − leadDays`) → `completeRenewal({ id, newExpiresAt })` (**one mutation**: sets the expiry, completes the task, trains through `recordOutcome`, writes activity) → the document returns to `valid`/`due` on the new date. `cancelRenewal` clears the task. `deleteDocument` removes the row and **clears `documentId` on its tasks rather than deleting them** (Do-Not-Touch #9: never delete user data as a side effect of another action) and reports how many tasks it detached. |
| **Authorization** | `requireUserId` on every write; `row.ownerUserId !== userId` → throw on every write; every read scoped by a `by_owner*` index. A `personId` supplied on a document is ownership-checked exactly as `addTask` does. **No mutation accepts `ownerUserId` or `spaceId`** — there is no “view as” path, matching Feature 1. |
| **Ownership / space** | `ensurePersonalSpace` once per create; every document and every renewal task carries the caller's own `ownerUserId` + that space. A renewal task is created in `area: "general"` **on purpose** — it must appear in the user's main task list, where they can see and complete it, and coupling its visibility to whether they enabled the `life` area would hide work they explicitly asked for. |
| **Duplicate behavior** | **No deduplication and no refusal.** Two rows with the same label stay separate until the user deletes one. A label is not identity — the same reasoning as ADR-024 — and refusing to create a second "Car insurance" would be wrong the moment someone holds two. Merging is not in scope and is not added. |
| **Attention behavior** | One new hard kind, **`document.expiring`**, in the existing **`deadlines`** section (fixed dates, rules only — and the existing `document.incomplete` tax rule is already there). Fires for `due`, `expired` and `stale` **only**. `severity` is deterministic, rising from 0.6 at the window edge to 0.95 at expiry; `expired` and `stale` are `pinned`. `dueAt` is `expiresAt − leadDays`. `class: "hard"`, so it is never scored, never suppressed and never personalised (ADR-006). Action: **Start renewal**, which on press calls `startRenewal` — the same rule as `task.imminent`, whose button completes the task. |
| **Anti-spam, explicitly** | Three mechanisms, no new machinery: (1) a document outside its lead window emits **nothing**; (2) a document with an open renewal emits **nothing**, because the task already speaks — this is what stops one renewal producing two items; (3) the existing `deadlines` budget of 4 caps the rest, and the pipeline **already** reports `hiddenByCap` to a UI that already says how many items the caps hid. Nothing is truncated silently. |
| **Area behaviour** | Attention from documents does **not** consult `enabledAreas`, consistently with `deadline.tax` and `document.incomplete`, which do not. A fixed date is a fact, not a preference; disabling an area is a statement about what to *work on*, not licence to stop being told a passport expired. `disableArea("life")` re-homes the renewal tasks to `general` and leaves every document alone. |
| **Learning implications** | **No new feature index, no new signal from authorship, nothing to add to the frozen layout.** Creating a document is authorship — the same reasoning that produced the Q-006 interim answer. Completing a renewal is a **real outcome** and trains through the existing `recordOutcome` path with no new plumbing, because the renewal is an ordinary task. `FEATURE_COUNT` stays 12, `WEIGHTS_VERSION` stays 1, indices 0–7 untouched, and nothing migrates. |
| **Capture behavior** | **None. Out of scope, deliberately.** Recognising “my passport expires in March” is a *parser* decision, and R-004 established that ambiguous extraction is where user data gets damaged. Adding it would mean new vocabulary in Do-Not-Touch #7. Documents are created by explicit action in the Life Admin surface. |
| **Privacy** | Metadata only: label, expiry, lead time, owner, optional person. **No file, no number, no scan, no reference, no storage integration** (R-007). Nothing to export, retain or delete beyond one row. `document.created` / `.deleted` carry the label in `meta` only if it is already visible to the owner — the activity table is owner-scoped by space. |

##### Audit, performance, budget, acceptance

| Field | Value |
|---|---|
| **Audit** | Four new kinds in the closed taxonomy — `document.created`, `document.deleted`, `document.renewal_started`, `document.renewed` — and **every one of them is written on its own path and read back** by `documents:documentAudit`. R-005 found a taxonomy full of kinds that were declared and never written, and D38 is that defect; the fix is to make the write checkable, not to declare less. `completeRenewal` additionally writes `task.completed`, which is already a genuinely-written kind, because the task really did complete. |
| **Performance** | List read: `by_owner` (bounded by how many documents a person has). Attention read: **`by_owner_expiry`** — an index range holding only dated documents. Renewal-task lookups: `by_owner_document`. `deleteDocument` reads its own tasks through that index and patches them in one transaction. **No `.collect()` anywhere without a `by_owner*` prefix**, and no JavaScript-side cross-user filtering. The audit read is `by_space_at` **with** a range and a `.take(AUDIT_SCAN_LIMIT)`, which is the D39 shape done correctly. |
| **Input bounds** | `label` trimmed, 1–80. `leadDays` an integer 0–365. `expiresAt` and `newExpiresAt` must be finite — `NaN`/`Infinity` refused at the boundary (the N5 lesson), not coerced. `completeRenewal` refuses a non-advancing expiry. `startRenewal` on a document that already has an **open** renewal returns the existing task rather than creating a second. |
| **Dependencies** | Phase 3 Features 1 and 2 (both VERIFIED) — `personId` reuse and the task model. Phases 0B/0C for `ownerUserId`/`spaceId` and validation. Nothing else. |
| **Blockers** | **None.** Q-001 and Q-006 are untouched by this feature and are not waited on. Google credentials and D32 are unrelated. |
| **Complexity budget (ADR-016)** | **4 new files · 1 new table · 0 deps · 1 abstraction** (the derived expiry state machine, `src/lib/documents.ts`). The one table is proven necessary above; a feature that needed two would be a different feature. |
| **Out of budget** | New activity kinds, the new `AreaSlug`, and `tasks.documentId` are *edits to existing files*, counted against no file budget — as they were in Features 1 and 2. |
| **ACCEPTANCE CRITERIA** | (1) A document with an expiry inside its lead window and no renewal produces exactly one `document.expiring` hard item, in `deadlines`, with `dueAt = expiresAt − leadDays`. (2) The same document with an **open** renewal task produces **no** document item, and the task produces its own — one renewal, one item. (3) `startRenewal` creates a task with `documentId` set and `dueAt` equal to the computed deadline, and `by_owner_document` returns it. (4) `completeRenewal` sets the new expiry, completes the task, and the document returns to `valid`; the **old expiry is gone**, not retained as history on the row. (5) Completing the renewal task through the **generic** `setTaskCompleted` leaves the document `stale`, and `stale` is visible and stated. (6) Every read and write is owner-scoped: a second account sees zero documents, and a foreign document id is refused on all five write paths. (7) `deleteDocument` detaches the document from its tasks without deleting them, and reports the count. (8) The audit read returns a real row for each of the four `document.*` kinds with the real counts — written, not assumed. (9) Nothing regresses: the 21 `nlp.test.ts` fixtures, the 34 `tax.test.ts` fixtures, the tax checklist (`toggleDocument` → `getFinance` → `document.incomplete`) and the existing capture behaviour are all byte-for-byte unchanged. (10) Budget: 4 files / 1 table / 0 deps / 1 abstraction. (11) `FEATURE_COUNT` is 12, `WEIGHTS_VERSION` is 1, and no table other than `documents` gained a column. |
| **Verification** | Unit fixtures for the state machine (pure, injected clock — every state reachable from a fixture, including the boundaries). A live harness deciding all eleven criteria, including cross-user isolation, the byte-identical tax regression, and the read-back audit. **If `assistant.ts` is touched at all, ADR-022 OCC is re-armed and re-run — not inherited.** |
| **Risk** | The real risk is drift toward a document manager. The defences are the file/table budget, the OUT OF SCOPE list, and the fact that the feature is honestly complete without storage: the expiry chain is finished when the new date is recorded, and there is nothing else to build. |
| **Verified how** | **CHANGE-0015, VERIFIED.** 37 unit fixtures (`src/lib/documents.test.ts`) and 93 live invariants (`scripts/conformance-3f.ts`, 0 skips). All 11 acceptance criteria pass against a real deployment. `assistant.ts` changed (the completion transition was extracted into `completeTask`), so ADR-022 OCC was **re-armed and re-run rather than inherited**: run H, 3 rounds x 8 concurrent mutations, 48 mutations, 0 duplicates. |
| **What the build found** | **D40** — the `stale` rule was too narrow. It fired only when the document had *already expired*, so the ordinary case went unreported: renewing early (exactly what R-006 tells people to do), ticking the task off, and the expiry never moving read as ordinary progress. Found by the **live harness**, not the unit suite — every unit fixture for `stale` used an expired document, so the tests were satisfied by a rule that missed what users actually do. A second defect surfaced in self-review rather than under any test: `listDocuments`, `getExpiring` and the attention query each resolved renewal tasks **once per document**, an N+1 worth up to 200 queries on a reactively-subscribed query — D37/D39 wearing a new hat. Fixed with one owner-scoped `by_owner_document` read grouped in JavaScript. |
| **A boundary this feature does not cross** | An **early** renewal whose expiry never moved is *not* reported as `stale`, and cannot be: from `(expiresAt, completed task)` alone there is no way to distinguish it from a real early renewal to a document valid for two years. Detecting it would mean storing the previous expiry, which ADR-025 rules out precisely so no second copy of the date exists to disagree. The user instead sees the completed renewal and the expiry side by side, so a forgotten date is visible to whoever can fix it. Recorded here rather than left as a surprise. |

#### Phase 3, feature 4 — Commitments + Waiting On (APPROVED · IN PROGRESS)

> **Status 2026-10-01.** APPROVED as a roadmap line (`Commitments + Waiting On
> | APPROVED | 3`, PRODUCT_CONTEXT §5.2). As with Features 2 and 3, the line is
> a *name*, not a specification. This block was written before any code, from
> R-008 and R-009 and against the repository as it stands.

##### The audit that had to happen first

| Question | What the repository actually does |
|---|---|
| Is there a commitments table? | **No.** `commitment` exists as an `objectKind` literal, a `LinkRel` family (`waitingOn`, `owedBy`) and an activity kind `commitment.made` — **none of which has ever been written or read.** |
| Does an attention section exist for it? | **Yes, and it has no producer.** `waitingOn` is a section with budget 3, a 24h half-life and a counterparty grouping dimension (§5.7), and **no rule in `rules.ts` has ever emitted into it** — the same shape as D38. |
| Can `tasks` hold it? | `tasks.personId` exists and resolves through person tombstones. It can express *an obligation to Raj*. It **cannot** express *waiting on Raj*: `taskRules` emits `task.overdue` for any open dated task, so a delegation stored as a task produces "this is overdue" about something the user physically cannot do (R-008). |
| Is there a second person representation? | **No**, and none may be created. `people` with `identityKeys` and merge-as-tombstone (ADR-023/024) is the only one, and a commitment references it by id. |
| Where does it live in the UI? | The **Relationships** area, which already exists, already renders People, and already has the person cards a commitment would sit under. **No new tab, no second page system, no new area slug.** |
| What else needs building? | `tasks.commitmentId` + `by_owner_commitment`, for the follow-up link (ADR-026's shape). Two attention kinds, both landing in **sections that already exist**. |

##### The specification gap, and how it was closed

| Question | Answer |
|---|---|
| Task vs commitment | A task is something to do. A commitment additionally has a **counterparty the user has already spoken to**. Not every task is a commitment, and nothing is inferred. |
| Commitment vs waiting-on | **One object, two directions.** `owed` is what the user promised; `owedTo` is what they are waiting for. Same shape, same lifecycle, one field apart — and that one field changes what "completed" means, which attention section it lands in, and every word of copy. |
| Ownership | The **user owns the row either way**. Raj never owns anything in Panel. For `owedTo`, Raj is the *holder of the next move*; for `owed`, the user is. Panel records **the user's assertion**, never a fact about another person (R-009). |
| State | **Derived, never stored** (ADR-025's lesson, applied). Four states from `(expectedAt, completed, now)`. No status column. |
| Attention | Two hard kinds into **two existing sections**: `commitment.overdue` into `people`, `commitment.waiting` into `waitingOn`. No new section, no new budget, no second prioritiser. |
| Capture | **Out of scope.** The parser is a closed vocabulary under Do-Not-Touch #7, and R-004 settled that ambiguous extraction is where user data gets damaged. Recorded as **Q-007**. |
| Learning | **No new feature index and no new signal.** Creating a commitment is authorship. Completing a *follow-up task* is an ordinary outcome and already trains. |

##### 12.0 Scope block — Commitments + Waiting On

| Field | Value |
|---|---|
| **Feature** | Commitments + Waiting On — what the user owes, and what they are waiting for |
| **Problem it solves** | Panel can hold a task and a person, but cannot hold **an obligation**. "I told Raj I'd send the contract Friday" is a task with a date and a name attached, which means it is indistinguishable from "buy milk", it carries no idea that someone is relying on it, and it never surfaces as the social thing it is. The mirror image is worse: **"waiting for Raj to send the contract" cannot be a task at all**, and if it were, `taskRules` would tell the user it is overdue — about something they cannot do. GTD keeps Waiting For out of the action list for exactly this reason (R-008). |
| **User outcome** | See, at a glance, the things other people are relying on and the things other people have not delivered. And be able to act on the first and chase the second. |
| **IN SCOPE** | A `commitments` table with a closed `direction` (`owed` \| `owedTo`); a derived four-state lifecycle in `src/lib/commitments.ts`; a `tasks.commitmentId` link used **only** for user-requested follow-ups; two hard attention kinds landing in the **existing** `people` and `waitingOn` sections; a Commitments block inside the existing Relationships area; `commitment.made` / `.fulfilled` / `.cancelled` / `.followed_up` activity kinds, all written and read back; per-person commitment counts on the existing People cards. |
| **OUT OF SCOPE** | Any new person representation · any second task list, queue or completion UI · a new area slug or a new Page · a second attention section or prioritiser · capture that infers a commitment or a direction (Q-007) · automatic messages, emails or nudges to anyone · **any claim about what another person has or has not done** · a `status` column · promises/debts between two *other* people · money owed (that is Finance) · merging two commitments · bulk import. |
| **DO NOT TOUCH** | `src/lib/nlp.ts` token loop (#7) · scorer maths (#6) · `recordOutcome` as the single weight-mutation point (#8) · ADR-010 feature layout (`FEATURE_COUNT` 12, `WEIGHTS_VERSION` 1) · ADR-023/024 people identity guarantees · `permissions.can` as the sole access path · the §5.7 section budgets (3 for `people`, 3 for `waitingOn`) · the `home` / `finance` / `health` areas · `taxDocuments` and `toggleDocument` · everything in feature 3 (ADR-025/026, R-006, R-007). |
| **Terminology** | **Task** — something the user needs to do. **Commitment (`owed`)** — something the user has promised to a named person. **Waiting (`owedTo`)** — something a named person is expected to do. **Counterparty** — the `people` row on the commitment. **Follow-up** — an ordinary task the user explicitly asks Panel to create for a waiting item. |

##### The model, and why it is this small

**`commitments`** — seven columns:

| Column | Type | Why it exists |
|---|---|---|
| `ownerUserId`, `spaceId` | ids | ADR-009 |
| `personId` | `v.id("people")` | **The counterparty. Required, not optional** — a commitment to nobody is a task. May point at a tombstone; reads resolve through `mergedIntoId` (ADR-023), and nothing is rewritten on merge. |
| `title` | `string` (1–160, trimmed) | What was promised, or what is expected. The only free text. |
| `direction` | `"owed" \| "owedTo"` | **The whole of the feature.** Who holds the next move. |
| `expectedAt` | `number?` | The date the user said. Optional — plenty of promises have no date, and inventing one would be a lie. For `owedTo` this is the date the user would tell the other person (R-009). |
| `completed`, `completedAt` | `boolean`, `number?` | The user's **assertion**. Never a fact about another person. |
| `createdAt` | `number` | Ordering. |

Indexes: `by_space`, `by_owner`, and **`by_owner_open`**
(`["ownerUserId", "completed", "expectedAt"]`).

> **Spec correction, CHANGE-0016.** This block originally said a
> `by_owner_person` index was "**not** added", because a person's commitments
> are read once for the whole list and grouped in JavaScript. That reasoning was
> right about `by_owner_person` and wrong about the read that actually matters.
> Attention can only ever want `{completed: false, expectedAt <= now}`, which is
> exactly an index range — so the hot query filters in the database instead of
> collecting every commitment the user has ever made and discarding the 99% that
> cannot be attention. Convex omits a document from an index when an indexed
> field is absent, so an **undated** commitment is not in the range either, and
> an undated one can never be overdue: the range *is* the candidate set, not a
> filter somebody has to re-check. `by_owner_person` still was not added, because
> nothing needs it. This is the `by_owner_expiry` argument from feature 3 applied
> a second time — see D42.

**`tasks.commitmentId`** + `by_owner_commitment`, mirroring ADR-026 exactly: the
task points at the commitment, the commitment holds no reference back. One
writer, one purpose — it exists so the Relationships surface can show *which*
follow-up belongs to which waiting item without matching on titles.

**What is deliberately NOT stored:** a `status` field, a `promisedAt` timestamp,
a `note`, a separate `overdue` flag, or a `lastActivityAt`. Each is either
derivable or unused. See ADR-025 for why a status column is the dangerous one.

> **Spec correction, CHANGE-0016 — AC-10.** The original criterion read "Deleting
> a person detaches their commitments without deleting them, and reports the
> count". **Panel has no delete-person path, and that is deliberate:** ADR-024
> makes a person either a tombstone (a merge, which rewrites nothing) or their
> own row, never a deletion, so there is nothing for the criterion to attach to.
> Writing a delete mutation to satisfy a criterion would have been adding an
> out-of-scope capability to satisfy a sentence. The criterion was corrected to
> the guarantee that actually holds and is actually load-bearing: **no people
> mutation ever removes a commitment**, and the one deletion this feature does
> have — `deleteCommitment` — detaches its follow-up tasks and reports the
> count. A wrong sentence in a spec is a defect; a missing criterion is worse.

##### Lifecycle, ownership, attention, learning

Four states, **all derived** from `(expectedAt, completed, now)` (ADR-025's
lesson, applied a second time):

| State | Condition | Attention | Copy discipline |
|---|---|---|---|
| `open` | not completed, and no date or the date is far off | no | — |
| `due` | not completed, `expectedAt` within `DEFAULT_DUE_WINDOW_DAYS` | `owed` only | “You said you would…” |
| `overdue` | not completed, `expectedAt` passed | **both** directions | `owed`: “You told Raj…”. `owedTo`: “You are waiting on Raj…” — **never** “Raj did not…” |
| `kept` | completed | no | For `owedTo` this reads **“You marked this received”**, never “Raj sent this”. Panel has observed nothing (R-008). |

| Field | Value |
|---|---|
| **Ownership** | The user owns every row. There is no path by which a commitment belongs to another person, and no `granteeUserId`. |
| **Who owes the action** | `owed` → the user. `owedTo` → the counterparty. Panel *records* this; it never infers or asserts it happened. |
| **Who is affected** | Always the counterparty, and only as a reference. Deleting a person **detaches** commitments rather than deleting them, exactly as `deleteDocument` detaches tasks (Do-Not-Touch #9). |
| **People integration** | `personId` references the existing `people` row. Reads resolve through tombstones via the same helper `people.ts` uses. A merge must not move, rewrite or break a commitment, and unmerge must restore it — **the ADR-023 guarantee extends unchanged**, which is only true because nothing is rewritten. No person data is duplicated onto the commitment. |
| **Task integration** | Panel **never** creates a task for a commitment. A task appears only when the user presses **Follow up** on a waiting item. Following up does **not** complete the commitment — chasing someone is not receiving from them, and conflating the two would be a lie about someone else's behaviour. |
| **Attention — outbound** | `commitment.overdue`, **hard**, section **`people`** (budget 3, 72h half-life, grouped by person — “things that are about someone rather than about a task”). Hard for ADR-006's reason: a model that learns to bury “you promised Raj and it is three days late” has learned the wrong thing. Fires on `overdue` only; `due` is deliberately **not** attention, because nagging a week early is how a feed gets muted. |
| **Attention — inbound** | `commitment.waiting`, **hard**, section **`waitingOn`** (budget 3, 24h half-life, grouped by counterparty) — the section that has existed since phase 1.0 with **no producer** (D42). Fires on `overdue` **only**: never as the date approaches (R-009). Severity is capped low on purpose, and its action is **Follow up**, never “Do it”. |
| **Anti-spam** | Two sections, two existing budgets of 3, and the pipeline already discloses what the caps hid. An item disappears from Attention the moment it is completed or the expected date is moved — and the **Relationships surface has a date field for exactly that**, because a date the user got wrong would otherwise keep shouting with no way out but deleting the row and losing its history and its chase task. Both states are escalation 2 (any past date reads as level 2, the same rule that makes an overdue task undeclineable), so a stale wait can be **snoozed with a return date** or resolved honestly by marking it "not coming" — never silently dismissed, and never with Panel claiming the other person did anything. |
| **Learning implications** | **No new feature index, no new signal, nothing added to the frozen layout.** Creating a commitment is authorship (the Q-006 rule, applied again). Completing a commitment is a real outcome but Panel **cannot** use it as evidence about a person, because for `owedTo` completion is an *assertion* by the user rather than an observation — training on it would teach the model that things “work out”, which is not a preference the model can act on. Completing a **follow-up task** is an ordinary task completion and already trains through `recordOutcome` with no new plumbing. |
| **Capture behavior** | **None. Out of scope.** Recognising “I'll send Raj the file” needs new grammar in a closed parser under Do-Not-Touch #7, and inferring *direction* from pronouns is precisely the ambiguous extraction R-004 warns about. Recorded as **Q-007**, open and non-blocking. |
| **Authorization** | `requireUserId` on every write; `ownerUserId !== userId` → throw on every write; every read owner-scoped by index. `personId` is ownership-checked exactly as `addTask` and `createDocument` do. **No mutation accepts `ownerUserId` or `spaceId`.** |
| **Privacy** | A promise is relationship data. Panel stores a title, a person id and a date — the minimum that makes the obligation real. No message content, no thread, no contact history, nothing imported. `commitment.*` activity rows name the counterparty id only, never their email. |

##### Audit, performance, budget, acceptance

| Field | Value |
|---|---|
| **Audit** | Four kinds — `commitment.made`, `commitment.fulfilled`, `commitment.cancelled`, `commitment.followed_up` — **all written on their own path** and read back by `commitments:commitmentAudit`. `commitment.made` is **already in the closed taxonomy and has never been written** (D38); this feature makes the declaration true rather than deleting it. |
| **Performance** | List read: `by_owner` with an explicit `.take(200)` — the bound is on the read, not on a slice afterwards, so a long history cannot grow the scan. Tombstones and names: **one** `by_owner` read on `people`, resolved in memory; no per-person query, which is D41 all over again. Follow-up lookup: `by_owner_commitment`. Attention: the `by_owner_open` range, which is narrow by construction, plus the same one people read. The audit read is `by_space_at` **with** a range and a `.take(LIMIT)` — the D39 shape done correctly. **No `.collect()` anywhere without an owner prefix**, and no `.collect()` anywhere that could be an index range. |
| **Input bounds** | `title` trimmed, 1–160. `expectedAt` must be finite (the N5 lesson). `personId` required and ownership-checked. `commitmentId` on a task ownership-checked. A completed commitment keeps its `completedAt`; re-completing is idempotent. |
| **Dependencies** | Phase 3 Features 1, 2 and 3 (all VERIFIED) — People, capture, Life Admin. Phases 0B/0C for ownership and validation. Nothing else. |
| **Blockers** | **None.** Q-001 and Q-006 are untouched and not waited on. Q-007 is recorded by this feature and is non-blocking. |
| **Complexity budget (ADR-016)** | **4 new files · 1 new table · 0 deps · 1 abstraction** (the derived commitment state machine, `src/lib/commitments.ts`). |
| **Why one table and not two** | The roadmap names two concepts; they share a shape, a lifecycle and a surface, and differ by a single field that changes who holds the next move. Two tables would duplicate the schema, the queries, the UI and the state machine for the sake of one discriminator. Two tables is the shape a feature takes when it has not decided what it is. |
| **Why not free text on tasks** | `tasks.personId` can say *an obligation to Raj*. It cannot say *the user has already spoken for it*, and — decisively — it cannot express waiting at all without Panel telling the user to do something they cannot do. |
| **ACCEPTANCE CRITERIA** | (1) A commitment with a person and a past date is `overdue` and produces exactly one `commitment.overdue` item in `people`. (2) A waiting item with a past date produces exactly one `commitment.waiting` item in `waitingOn` — the section that previously had no producer. (3) A commitment with no date, or with a distant date, produces **no** attention item at all; a `due` one does not either; and moving the expected date takes an existing item straight out of Attention. (4) Panel never creates a task without the user asking; `followUp` creates exactly one, carrying both `personId` and `commitmentId`, dated today. (5) Completing a follow-up does **not** complete the commitment. (6) A commitment is `kept` after completion and its attention item disappears. (7) Copy for `owedTo` never asserts what the other person did — verified against the exact strings. (8) Merging a person leaves every commitment pointing at the row it already pointed at; unmerging restores it; a merged-away person still resolves. (9) Every read and write is owner-scoped: a second account sees nothing and a foreign id is refused on **all seven** write paths. (10) **No people mutation removes a commitment**, and `deleteCommitment` detaches its follow-up tasks rather than deleting them, reporting the count. (11) All four `commitment.*` activity kinds are written and read back. (12) Nothing regresses: tax, capture, Life Admin, People merge/unmerge and the areas are unchanged — and capture still infers **no** commitment in either direction (Q-007). (13) `FEATURE_COUNT` 12, `weightsVersion` 1, no weight movement from a commitment, measured **in isolation** from the task completions that do train. (14) Budget: 4 files / 1 table / 0 deps / 1 abstraction. |
| **Verification** | Unit fixtures for the state machine (pure, injected clock) covering all four states, both directions and every boundary, plus seven rule-level fixtures. A live harness deciding all 14 criteria, including cross-user isolation, the person merge/unmerge case and the exact copy strings. `assistant.ts` is **not** touched by the feature — the follow-up task is inserted, not completed — so OCC was not required to be re-armed; it was re-armed and re-run anyway, so the claim is backed by a live run in this session rather than an inherited one (run I, 48 mutations, 0 duplicates), and the temporary fixture was reverted afterwards. |
| **Risk** | Product drift toward a CRM: contacts, threads, history, reminders. The defences are the one-table budget, the OUT OF SCOPE list, and the fact that a commitment here is a single obligation with a person and a date — which is what the roadmap line actually promised. |

#### Phase 4, feature 4A — Area-native surfaces (PROPOSED · **NOT APPROVED**)

> Written 2026-10-02 after a product reality correction. **No code exists.**
> This is the specification of a *correction*: phase 3 built the domain, and the
> surface never caught up. The change entry is CHANGE-0019; the budget row is in
> the changelog. Implementation starts only on approval.

**The defect being corrected, in the project's own terms.** Panel is a personal
operating system whose areas expose different parts of the user's life. Today
five of six areas do not:

1. The front door is `general`, the only cross-area surface, and it is a task
   board (`src/pages/Dashboard.tsx:77`).
2. **Home has no domain body** — it falls through to `TasksArea`
   (`Dashboard.tsx:435`), which is `getAreaTasks(area)` plus task mutations. A
   custom area does the same. Two of six areas are filtered task lists.
3. **Commitments and Waiting On render only inside Relationships, and only when
   `people.length > 0`** (`Areas.tsx:1052`). A wait on a landlord or an insurer
   has no person row, so it is invisible.
4. **Finance has the objects but no hierarchy.** It opens on a disclaimer and
   country buttons, interleaves objects with three inline `Add` forms, hides
   Accounts inside a collapsed `<details>`, and offers no Overview, no
   Finance-scoped attention, no Finance tasks, no Finance documents and no
   Finance commitments.
5. **Health is a mock** — `HABITS` is a module constant against `useState`, with
   no table and no persistence. Logged as **D50**, deliberately not fixed
   (product owner, 2026-10-02).

**The model this feature enforces.** Panel → Area → Object. An area answers
*what exists here*, then *what needs attention*, then *what can I do*. A task is
one object kind and must never become the universal representation — that is the
whole correction. General is explicitly *allowed* to remain task-centric; it is
the universal capture surface, and the bug is that every other area behaved the
same way.

**Finance section order (the reference implementation).**

| Order | Section | Bound to | New work |
|---|---|---|---|
| 1 | Overview | `life.getFinance`, `subscriptions.listSubscriptions` — figures already returned | composition only |
| 2 | Attention | existing attention kinds for the space, filtered for display | **no new kind** (ADR-029) |
| 3 | Objects | accounts, subscriptions, expenses + buckets, tax documents, commitments | existing queries |
| 4 | Actions | contextual add | new descriptor, new component |
| 5 | Tasks | `life.getAreaTasks("finance")` | existing query |

Accounts stop being a collapsed disclosure. Overview is composed from values the
two queries already return, so **4A adds no database read at all** — the direct
answer to the D42/D48 lesson, applied in advance rather than after a defect.

**Contextual add.** A descriptor list, data not code: `{label, verb, existing
mutation, requires?}`. Finance offers expense, income (the existing profile
field), account, subscription, document, task, capture. Life admin offers
document, renewal, task, capture. Relationships offers person, commitment,
waiting-on, task, capture. General offers capture, task, commitment,
waiting-on. **A verb is only ever listed when a mutation already exists** — the
descriptor is a UI affordance over the domain, never a second way to write.

**Must NOT.** A new page, route or navigation tier (`activeArea` stays a
client-side switch) · a new attention kind · a new table · a new query · a
per-area bespoke component · any change to the capture parser or to
`estimateTax`/the scorer/`nlp.ts`/`recordOutcome` · converting any domain object
into a task to make it visible.

#### Phase 4, feature 4B — Transactions and document ingestion (ARCHITECTURE ONLY · **BLOCKED on Q-008**)

> Written 2026-10-02 at the product owner's instruction: *"I want Panel to
> eventually support manually created and imported transactions. Do not assume
> transactions are permanently forbidden. Produce the concrete
> transaction/ingestion architecture first, then surface the §2.3/ADR-028
> amendment as a deliberate product decision."*
>
> **Nothing here is approved and nothing here is built.** §2.3 and ADR-028 stand
> unchanged. This section exists so the amendment can be decided against a real
> design rather than in the abstract.

**The constraint as written today.** §2.3: *"Panel must NOT copy: Building a
double-entry ledger. Panel needs to know about money, not to re-account for
it."* ADR-028: *"a transaction is a ledger row — an account with a balance is a
ledger with extra steps."* REQ-054: *"An account is a label, and a balance is a
ledger."*

**What the research found, and it is the reason this is a decision and not a
task.** Of the ten things a user might want from "read my statement for me",
**eight need no transaction row**: detect recurring charges → propose
subscriptions; statement totals → verify or seed expenses; statement period and
dates → a tracked document; an anomaly → an agent proposal; tax figures →
`taxProfile`. Only *every transaction, a balance, reconciliation, transfers as a
conjugate pair, and categorisation per transaction* require persisted
transactions. A search of the service catalogue for a privacy-first,
no-LLM PDF/CSV extractor returned **no match**, so extraction would have to be
deterministic and in-house — consistent with ADR-001, and the reason "upload and
the AI understands it" is not available even if someone wanted it.

**Proposed data model — two tables, and the balance is deliberately not one.**

`transactions`

| Field | Type | Why |
|---|---|---|
| `spaceId`, `ownerUserId` | ids | ADR-009; every read index-scoped (D48) |
| `accountId` | id, optional | a transaction may be unattributed |
| `postedAt` | number | epoch ms; the only time axis |
| `amountMinor` | number | **integer minor units** — money is never a float |
| `currency` | string | ISO 4217 shape-validated |
| `direction` | `"out" \| "in"` | closed union; explicit rather than inferred from a sign |
| `label` | string ≤120 | what the statement called it |
| `merchant` | string, optional | |
| `bucket` | existing `expenseBucketValidator`, optional | **no new vocabulary** |
| `deductible` | boolean | defaults from the bucket, user-overridable |
| `confidence` | `high \| medium \| low \| confirmed` | **reuses the existing expense confidence vocabulary** |
| `source` | `"manual" \| "import"` | closed union; no provider writes in v1 |
| `externalId` | string, optional | the §6 idempotency key for imports |
| `importId` | id, optional | which import produced the row |

Indexes — and every one of them is scope-first, because the D48 invariant is
now a standing rule: `by_owner_postedAt`, `by_space_postedAt`,
`by_account_postedAt`, `by_owner_externalId` (idempotency), `by_owner_import`.

`imports` — one durable record per uploaded file: `spaceId`, `ownerUserId`,
`filename`, `byteSize`, `contentType`, `storageId`, `sha256`, `status`
(`uploaded → extracted → confirmed → applied | failed | discarded`), detected
`kind` (`csv | xlsx | pdf`), the **aggregate** detection result (statement
period, printed totals, counts), a `uncertainty: string[]`, and candidate
proposals (recurring charges, documents). Indexes: `by_owner_createdAt`,
`by_space_status`, `by_owner_sha256` so re-uploading the same file is detected.

**The balance is a query, not a column.** `balance(account, from, to) = Σ
signed amountMinor` over `by_account_postedAt`, computed at read time. This is
the single decision that keeps ADR-028's actual hazard — a stored number that can
drift from reality with nothing to check it — from returning through the back
door. A derived balance cannot be stale.

**Pipeline — nine stages, no stage may be skipped, and none of them is a
model.**

1. **Upload** — Convex file storage, per-space ownership, hard size cap,
   type allowlist. No public URL is ever produced.
2. **Identify** — by magic bytes, never by the client-declared MIME type. A file
   that lies about itself is refused, not parsed.
3. **Extract** — CSV/XLSX parsed by a deterministic parser in a Convex Node
   action; PDF text layer extracted. A **scanned PDF is refused with a stated
   reason** — OCR would require an inference service, which ADR-001 forbids.
4. **Parse** — a bounded vocabulary of statement layouts (date, description,
   amount columns). An unrecognised layout yields `failed` with the reason; it
   never yields a partial write.
5. **Validate** — arithmetic: do the extracted rows sum to the printed total? A
   mismatch is **surfaced as uncertainty**, not accepted quietly. This single
   check is what makes the difference between a parser and a guess.
6. **Show what was found** — period, totals, N candidate transactions,
   M candidate recurring charges, K candidate documents, and every uncertain
   field marked as such.
7. **User confirms** — per row and per proposal. Bulk-accept is offered only
   where the arithmetic check passed.
8. **Persist what was approved** — `applyImport` writes with deterministic
   idempotency keys (`import:<importId>:<externalId>`), creating documents and
   subscriptions only from *confirmed* proposals. Applying the same import twice
   writes nothing twice (ADR-009, §6).
9. **Audit** — one `activity` row per import with counts; `imports.status` is
   the durable record; the stored file is deleted after apply unless retention is
   explicitly on.

**Uncertainty is a first-class output.** Every extracted field carries
provenance and confidence; low-confidence rows are never auto-persisted; the UI
shows what is uncertain rather than a confident wrong number.

**Security model (§15), decided now rather than later.** Ownership and space via
the existing `requireUserId` / `personalSpaceId()` pair, with membership
authorisation on read and write · storage ids are never returned across users or
spaces · an explicit delete endpoint, and deletion of the row set by default ·
export includes or excludes files by a stated flag · retention defaults to
delete-after-apply · size cap and type allowlist · file content is never
executed, and the parser runs with no network access · every apply is auditable.
There is no path by which one user's financial document is readable by another.

**Budget.** 6 files · 2 tables · **2 dependencies** (a deterministic CSV/XLSX
parser and a PDF text extractor) · 1 abstraction (the import pipeline). The
dependencies are the reason ADR-016 treats this as a stop condition: Panel has
been dependency-free on purpose, and a spreadsheet cannot be parsed without one.

**What the §2.3 / ADR-028 amendment would have to say — and is exactly the
question in Q-008.** (a) Panel stores transaction *facts* the user typed or
imported, not an accounting system. (b) No journal entries, no debit/credit, no
double-entry invariants. (c) **A balance is derived and never stored.** (d) Panel
never presents itself as the system of record for a bank. (e) Reconciliation,
transfer pairing and cross-account categorisation are out of scope in v1.
ADR-028 would be superseded, not edited.

**Must NOT introduce.** Double-entry or journals · a stored balance column · a
reconciliation or matching engine · bank connectivity · OCR · any LLM or
inference service · per-transaction inference · a change to `estimateTax` (the
estimate keeps calling the same pure function; transactions inform *inputs*, the
arithmetic stays in one place) · a second writer for a financial row outside the
idempotent `applyImport`.

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
| REQ-033 | A person merge rewrites nothing and is exactly reversible | ADR-023 | 3 |
| REQ-034 | No automatic person merging; identity evidence is advisory | ADR-024 | 3 |
| REQ-035 | Capture segments only on explicit structure, never prose conjunction | — | 3 |
| REQ-036 | Low-confidence capture creates nothing, and says why | — | 3 |
| REQ-037 | The server's segmentation is authoritative over the client's | — | 3 |
| REQ-038 | Capture writes no learning signal; authorship is not an outcome | ADR-004 | 3 |
| REQ-039 | A life-admin document is metadata only; no file content is ever stored | ADR-025 | 3 |
| REQ-040 | A document's lifecycle is derived, never stored as a status field | ADR-025 | 3 |
| REQ-041 | The renewal deadline is the expiry minus a lead time, not the expiry | ADR-025 | 3 |
| REQ-042 | The renewal is an ordinary task pointing at the document, not a sub-record | ADR-026 | 3 |
| REQ-043 | Document expiry is a hard attention rule, immune to the learned ranker | ADR-006 | 3 |
| REQ-044 | Creating a document is authorship and writes no learning signal | ADR-004 | 3 |
| REQ-045 | A completed renewal whose date never moved is detected and stated | ADR-025 | 3 |
| REQ-046 | Deleting a document never deletes the user's own tasks | ADR-009 | 3 |
| REQ-047 | A promise and a wait are one object with a direction, not two systems | ADR-027 | 3 |
| REQ-048 | A commitment's lifecycle is derived, never stored as a status field | ADR-025 | 3 |
| REQ-049 | Panel never asserts what another person did; the user records it | ADR-027 | 3 |
| REQ-050 | Panel creates no task for a commitment without the user asking | ADR-027 | 3 |
| REQ-051 | An overdue promise and an overdue wait are both hard attention, in existing sections | ADR-006 | 3 |
| REQ-052 | Capture infers neither a commitment nor a direction | — | 3 (Q-007) |
| REQ-053 | A subscription owns its renewal document; expiry logic is never duplicated | ADR-029 | 3 |
| REQ-054 | An account is a label, and a balance is a ledger | ADR-028 | 3 |
| REQ-055 | A stored status, annual cost or balance is never a second copy of another field | ADR-025, ADR-028 | 3 |
| REQ-056 | No money write accepts a non-finite amount or an unbounded magnitude | — | 3 |
| REQ-057 | A renewal-shaped object reaches Attention only through the existing chain | ADR-029 | 3 |
| REQ-058 | Deleting an account or subscription detaches, and reports the count | ADR-028 | 3 |
| REQ-059 | A scheduled run is an explicit opt-in behind a feature flag, and the flag is re-checked on every run | ADR-030 | 3 |
| REQ-060 | The scheduler answers only *when*; what an agent may do comes from the tier in its return type | ADR-030, ADR-011 | 3 |
| REQ-061 | A proposal is a claim about evidence: the agent never asserts a category is wrong and never changes a financial value | ADR-030, ADR-011 | 3 |
| REQ-062 | Agent executions are capped per run and per space per day, and overflow is counted, observable and audited | ADR-030 | 3 |
| REQ-063 | A run record states what happened, and a run that did nothing says why | ADR-030 | 3 |
| REQ-064 | An agent that already has a producer is not reimplemented | ADR-030 | 3 |
| REQ-065 | An area shows the state of its domain; a task is one object kind and never the universal representation | — (CHANGE-0019) | 4A |
| REQ-066 | Every verb an area offers is backed by a mutation that already exists | — (CHANGE-0019) | 4A |
| REQ-067 | A domain object is visible where it belongs, independent of whether some other object exists | — (CHANGE-0019) | 4A |
| REQ-068 | Context changes which verbs an area offers, never what the capture parser does | ADR-001, — (CHANGE-0019) | 4A |
| REQ-069 | **CONDITIONAL on Q-008** — a transaction, if it exists at all, is a fact the user supplied or imported, and a balance is derived at query time and never stored | pending (supersedes ADR-028) | 4B (blocked) |
| REQ-070 | An import shows what was found, and its uncertainty, before anything is persisted | — (CHANGE-0020, gated) | 4B (blocked) |
| REQ-071 | An uploaded file belongs to one space, is never readable by another, and is deletable and auditable | ADR-009, ADR-014 | 4B (blocked) |
| REQ-072 | File parsing is deterministic and in-house; no OCR and no inference service | ADR-001 | 4B (blocked) |

### 12.2 Full chains

**Phase 3, feature 1 (People) — VERIFIED**

| REQ | ADR | Phase | Task | Acceptance | Test | Change |
|---|---|---|---|---|---|---|
| REQ-034 | ADR-024 | 3F | TASK-3F-001 | AC-3F-001, AC-3F-002 | TEST-3F-001 (`src/lib/people.test.ts`, 28 fixtures); TEST-3F-002 (`scripts/conformance-3.ts`) | CHANGE-0013 |
| REQ-033 | ADR-023 | 3F | TASK-3F-002 | AC-3F-003, AC-3F-004, AC-3F-006 | TEST-3F-002 (`scripts/conformance-3.ts`) | CHANGE-0013 |
| REQ-015 | ADR-010 | 3F | TASK-3F-003 | AC-3F-005 | TEST-3F-002 (`scripts/conformance-3.ts`) — this check found D34 | CHANGE-0013 |
| REQ-009 | ADR-009 | 3F | TASK-3F-004 | AC-3F-001 | TEST-3F-002 (S1, S2, S3: cross-user isolation, foreign-id refusal on all four write paths) | CHANGE-0013 |
| REQ-016 | ADR-016 | 3F | TASK-3F-005 | AC-3F-006 | TEST-3F-002 | CHANGE-0013 — 4 of 6 files, 1 table, 0 deps, 1 abstraction |

**Phase 3 feature 1 acceptance criteria (§11.2) → test mapping**

| AC | Criterion | Where verified | Result |
|---|---|---|---|
| AC-3F-001 | A capture naming a known person links to that row rather than creating a second | `conformance-3.ts`, "A1" | PASS, live |
| AC-3F-002 | Two rows with the same normalised name stay separate until the user merges them | `conformance-3.ts`, "A2" (refusal, then `force`, then three coexisting namesakes) | PASS, live |
| AC-3F-003 | Merge is reversible: unmerge restores both rows and every link | `conformance-3.ts`, "A3" | PASS, live |
| AC-3F-004 | A merged row is a tombstone that no query returns | `conformance-3.ts`, "A4" | PASS, live |
| AC-3F-005 | `PEOPLE_FIT` reads the person id, so two namesakes do not share evidence | `conformance-3.ts`, "A5" | PASS, live — found D34 |
| AC-3F-006 | Merge → unmerge leaves the row count and the link count exactly as they were | `conformance-3.ts`, "A6" | PASS, live |

**Phase 3, feature 2 (Multi-object Capture) — VERIFIED**

| REQ | ADR | Phase | Task | Acceptance | Test | Change |
|---|---|---|---|---|---|---|
| REQ-035 | — | 3F | TASK-3F-006 | AC-3F-101, AC-3F-103 | TEST-3F-001 (`src/lib/capture.test.ts`, 43 fixtures); TEST-3F-003 (`scripts/conformance-4.ts`) | CHANGE-0014 |
| REQ-036 | — | 3F | TASK-3F-007 | AC-3F-104 | TEST-3F-003 | CHANGE-0014 |
| REQ-037 | — | 3F | TASK-3F-008 | AC-3F-107 | TEST-3F-003 | CHANGE-0014 |
| REQ-038 | ADR-004 | 3F | TASK-3F-009 | AC-3F-108 | TEST-3F-003 | CHANGE-0014 — interim per Q-006 |
| REQ-032 | ADR-019 | 3F | TASK-3F-010 | AC-3F-106 | TEST-3F-003 — `capture.committed` read back, not assumed | CHANGE-0014 |
| REQ-009 | ADR-009 | 3F | TASK-3F-011 | AC-3F-105 | TEST-3F-003 (cross-user isolation, foreign personId refused) | CHANGE-0014 |
| REQ-021 | ADR-019 | 3F | TASK-3F-012 | AC-3F-102 | TEST-3F-003 — compared against the deployed `addTask` | CHANGE-0014 |
| REQ-016 | ADR-016 | 3F | TASK-3F-013 | AC-3F-109 | TEST-3F-001 | CHANGE-0014 — 2 of 4 files, **0 of 0 tables**, 1 of 1 abstraction |

**Phase 3 feature 2 acceptance criteria → test mapping**

| AC | Criterion | Where verified | Result |
|---|---|---|---|
| AC-3F-101 | One capture with two separators produces three tasks, each parsed independently and correctly dated | `conformance-4.ts` "A1" | PASS, live |
| AC-3F-102 | Unseparated input is byte-identical to the single-task path | `conformance-4.ts` "A2" | PASS, live — compared against deployed `addTask` |
| AC-3F-103 | "call the dentist and book the dentist" produces one task | `conformance-4.ts` "A3" | PASS, live |
| AC-3F-104 | An unusable segment is dropped **and reported** | `conformance-4.ts` "A4" | PASS, live |
| AC-3F-105 | Every created task is owner-scoped, in the personal space, invisible to a second account | `conformance-4.ts` "A5" | PASS, live |
| AC-3F-106 | `capture.committed` written once per accepted capture with the real count | `conformance-4.ts` "A6" | PASS, live |
| AC-3F-107 | The server is authoritative | `conformance-4.ts` "A7" | PASS, live |
| AC-3F-108 | Existing capture unchanged; the model is untouched by authorship | `conformance-4.ts` "A8" | PASS, live |
| AC-3F-109 | Budget: 4 files / 0 tables / 0 deps / 1 abstraction | CHANGE-0014 | PASS — 2 / 0 / 0 / 1 |

**Phase 3, feature 3 (Life Admin / expiry → renewal) — VERIFIED**

| REQ | ADR | Phase | Task | Acceptance | Test | Change |
|---|---|---|---|---|---|---|
| REQ-041 | ADR-025 | 3F | TASK-3F-014 | AC-3F-201, AC-3F-203 | TEST-3F-004 (`src/lib/documents.test.ts`, 37 fixtures); TEST-3F-005 (`scripts/conformance-3f.ts`) | CHANGE-0015 |
| REQ-043 | ADR-006 | 3F | TASK-3F-015 | AC-3F-201, AC-3F-202 | TEST-3F-005 | CHANGE-0015 |
| REQ-042 | ADR-026 | 3F | TASK-3F-016 | AC-3F-203, AC-3F-204 | TEST-3F-005 — `by_owner_document` read, not the mutation return | CHANGE-0015 |
| REQ-045 | ADR-025 | 3F | TASK-3F-017 | AC-3F-204, AC-3F-205 | TEST-3F-005 — **this check found D40** | CHANGE-0015 |
| REQ-039 | ADR-025 | 3F | TASK-3F-018 | AC-3F-206 | TEST-3F-005 — no file field exists to leak | CHANGE-0015 |
| REQ-009 | ADR-009 | 3F | TASK-3F-019 | AC-3F-206 | TEST-3F-005 (cross-user isolation; foreign-id refusal on all five write paths) | CHANGE-0015 |
| REQ-046 | ADR-009 | 3F | TASK-3F-020 | AC-3F-207 | TEST-3F-005 | CHANGE-0015 |
| REQ-032 | ADR-019 | 3F | TASK-3F-021 | AC-3F-208 | TEST-3F-005 — the four `document.*` kinds read back | CHANGE-0015 |
| REQ-031 | ADR-021 | 3F | TASK-3F-022 | AC-3F-209 | TEST-3F-005 — tax checklist toggled and restored | CHANGE-0015 |
| REQ-015 | ADR-010 | 3F | TASK-3F-023 | AC-3F-211 | TEST-3F-005 — `FEATURE_COUNT` 12, `weightsVersion` 1 | CHANGE-0015 |
| REQ-023 | ADR-009 | 3F | TASK-3F-024 | AC-3F-210 | TEST-3F-005 — the N+1 fixed; every collect index-scoped | CHANGE-0015 |
| REQ-016 | ADR-016 | 3F | TASK-3F-025 | AC-3F-212 | TEST-3F-006 (budget audit of the feature's own file set) | CHANGE-0015 — 4 of 4 files, 1 of 1 table, 0 deps, 1 abstraction |

**Phase 3 feature 3 acceptance criteria → test mapping**

| AC | Criterion | Where verified | Result |
|---|---|---|---|
| AC-3F-201 | A document inside its lead window produces exactly one hard `document.expiring` item in `deadlines`, due at `expiresAt − leadDays` | `conformance-3f.ts` "A1" | PASS, live |
| AC-3F-202 | With an open renewal the document produces **no** item — the task speaks, so one renewal is never two items | `conformance-3f.ts` "A2" | PASS, live |
| AC-3F-203 | `startRenewal` creates a task with `documentId` set and `dueAt` equal to the computed deadline | `conformance-3f.ts` "A3" | PASS, live — read back via `by_owner_document`, and idempotent on a second press |
| AC-3F-204 | `completeRenewal` sets the new expiry, completes the task, and the document returns to `valid`; the old expiry is gone | `conformance-3f.ts` "A4" | PASS, live — a non-advancing date is refused and changes nothing |
| AC-3F-205 | Completing the renewal through the **generic** path leaves the document `stale`, and stale is visible | `conformance-3f.ts` "A5" | PASS, live — **this check found D40** |
| AC-3F-206 | Every read and write is owner-scoped; a second account sees nothing and a foreign id is refused | `conformance-3f.ts` "A6" | PASS, live — all five write paths, plus a foreign `personId` |
| AC-3F-207 | `deleteDocument` detaches the document from its tasks without deleting them, and reports the count | `conformance-3f.ts` "A7" | PASS, live |
| AC-3F-208 | The four `document.*` activity kinds are written and read back with real values | `conformance-3f.ts` "A8" | PASS, live |
| AC-3F-209 | Nothing regresses: the tax checklist, capture and the areas are unchanged | `conformance-3f.ts` "A9" | PASS, live — `toggleDocument` flipped and restored, tax deadlines still fire, capture still creates no document |
| AC-3F-210 | An undated document never reaches the expiring read | `conformance-3f.ts` "A10" | PASS, live |
| AC-3F-211 | `FEATURE_COUNT` is 12, `weightsVersion` is 1, and no table other than `documents` gained a column | `conformance-3f.ts` "A11" | PASS, live |
| AC-3F-212 | Budget: 4 files / 1 table / 0 deps / 1 abstraction | CHANGE-0015 | PASS — 4 / 1 / 0 / 1 |

**Phase 3, feature 4 (Commitments + Waiting On) — VERIFIED**

| REQ | ADR | Phase | Task | Acceptance | Test | Change |
|---|---|---|---|---|---|---|
| REQ-047 | ADR-027 | 3F | TASK-3F-026 | AC-3F-301, AC-3F-303 | TEST-3F-007 (`src/lib/commitments.test.ts`, 30 fixtures); TEST-3F-008 (`scripts/conformance-4f.ts`) | CHANGE-0016 |
| REQ-048 | ADR-025 | 3F | TASK-3F-027 | AC-3F-302 | TEST-3F-007 — the exhaustive 36-combination table | CHANGE-0016 |
| REQ-049 | ADR-027 | 3F | TASK-3F-028 | AC-3F-306 | TEST-3F-007 — asserted as a property over every inbound string, not a sample; TEST-3F-008 "A7" | CHANGE-0016 |
| REQ-050 | ADR-027 | 3F | TASK-3F-029 | AC-3F-304, AC-3F-305 | TEST-3F-008 "A4", "A5" | CHANGE-0016 |
| REQ-051 | ADR-006 | 3F | TASK-3F-030 | AC-3F-301, AC-3F-302, AC-3F-303 | TEST-3F-008 "A1", "A2", "A3"; seven rule fixtures in `attention.test.ts` | CHANGE-0016 — the ADR-006 hard-kind coverage fixture extended deliberately |
| REQ-033 | ADR-023 | 3F | TASK-3F-031 | AC-3F-308 | TEST-3F-008 "A8" — merge, list resolution, unmerge | CHANGE-0016 |
| REQ-009 | ADR-009 | 3F | TASK-3F-032 | AC-3F-309 | TEST-3F-008 (cross-user isolation; foreign-id refusal on all seven write paths; foreign `personId` refused) | CHANGE-0016 |
| REQ-046 | ADR-009 | 3F | TASK-3F-033 | AC-3F-310 | TEST-3F-008 "A10" | CHANGE-0016 |
| REQ-032 | ADR-019 | 3F | TASK-3F-034 | AC-3F-311 | TEST-3F-008 — the four `commitment.*` kinds read back, not assumed | CHANGE-0016 |
| REQ-052 | — | 3F | TASK-3F-035 | AC-3F-312 | TEST-3F-008 "A12" — capture creates zero commitments in either direction (Q-007 interim) | CHANGE-0016 |
| REQ-015 | ADR-010 | 3F | TASK-3F-036 | AC-3F-313 | TEST-3F-008 "A13" — measured **in isolation**, because earlier sections complete tasks on purpose | CHANGE-0016 |
| REQ-023 | ADR-009 | 3F | TASK-3F-037 | AC-3F-314 | TEST-3F-008 — the `by_owner_open` range and the explicit `.take` | CHANGE-0016 — **this check found D42** |
| REQ-016 | ADR-016 | 3F | TASK-3F-038 | AC-3F-315 | TEST-3F-009 (budget audit of the feature's own file set) | CHANGE-0016 — 4 of 4 files, 1 of 1 table, 0 deps, 1 abstraction |
| REQ-053 | ADR-029 | 3F | TASK-3F-039 | AC-3F-401, AC-3F-402 | TEST-3F-010 (`src/lib/subscriptions.test.ts`, 27 fixtures); TEST-3F-011 (`scripts/conformance-5f.ts`) | CHANGE-0017 |
| REQ-057 | ADR-029 | 3F | TASK-3F-040 | AC-3F-401, AC-3F-402 | TEST-3F-011 "A1", "A2" — **no new kind, section, rule or read** | CHANGE-0017 — the whole cost of the feature in the feed |
| REQ-055 | ADR-025 | 3F | TASK-3F-041 | AC-3F-403, AC-3F-404 | TEST-3F-010 — the exhaustive interval table; TEST-3F-011 "A3" | CHANGE-0017 |
| REQ-056 | — | 3F | TASK-3F-042 | AC-3F-405, AC-3F-406 | TEST-3F-010 (guards by exhaustion); TEST-3F-011 "A4" | CHANGE-0017 — **this check found D44** |
| REQ-056 | — | 3F | TASK-3F-043 | AC-3F-407 | TEST-3F-011 "A5", "A6" | CHANGE-0017 — **this check found D43** |
| REQ-054 | ADR-028 | 3F | TASK-3F-044 | AC-3F-408 | TEST-3F-011 "A7" | CHANGE-0017 |
| REQ-009 | ADR-009 | 3F | TASK-3F-045 | AC-3F-409 | TEST-3F-011 "A8" — a second account sees nothing; a foreign id refused on all six paths; a `documentId` cannot be smuggled in | CHANGE-0017 |
| REQ-058 | ADR-028 | 3F | TASK-3F-046 | AC-3F-410 | TEST-3F-011 "A9" | CHANGE-0017 |
| REQ-032 | ADR-019 | 3F | TASK-3F-047 | AC-3F-411 | TEST-3F-011 "A10" — six kinds read back, not assumed | CHANGE-0017 — **this check found D46** |
| REQ-015 | ADR-010 | 3F | TASK-3F-048 | AC-3F-412 | TEST-3F-011 "A11" — measured **in isolation** | CHANGE-0017 — no OCC re-run: `assistant.ts` untouched, no assistant state written |
| REQ-052 | — | 3F | TASK-3F-049 | AC-3F-413 | TEST-3F-011 "A12" — capture creates zero subscriptions and zero accounts (Q-007 interim) | CHANGE-0017 |
| REQ-031 | ADR-021 | 3F | TASK-3F-050 | AC-3F-414 | TEST-3F-011 "A13" — 34 `tax.test.ts` fixtures, the tax checklist, the six-area catalogue | CHANGE-0017 |
| REQ-016 | ADR-016 | 3F | TASK-3F-051 | AC-3F-415 | TEST-3F-012 (budget audit of the feature's own file set) | CHANGE-0017 — 4 of 6 files, 2 of 2 tables, 0 deps, 1 abstraction |
| REQ-059 | ADR-030 | 3F | TASK-3F-052 | AC-3F-501 | TEST-3F-014 (`scripts/conformance-6f.ts`) "A1" — enrolment and run both refused while the flag is off | CHANGE-0018 |
| REQ-064 | ADR-030 | 3F | TASK-3F-053 | AC-3F-502 | TEST-3F-013 (`src/lib/agents.test.ts`); TEST-3F-014 "A9" — the registry is exactly one entry | CHANGE-0018 |
| REQ-060 | ADR-011, ADR-030 | 3F | TASK-3F-054 | AC-3F-503, AC-3F-506 | TEST-3F-014 "A2", "A3" | CHANGE-0018 |
| REQ-013 | ADR-011 | 3F | TASK-3F-055 | AC-3F-504 | TEST-3F-013 (double-run fixtures); TEST-3F-014 "A4" | CHANGE-0018 |
| REQ-061 | ADR-030 | 3F | TASK-3F-056 | AC-3F-505 | TEST-3F-013 (wording and arithmetic fixtures); TEST-3F-014 "A3" — asserted against the deployed string | CHANGE-0018 |
| REQ-062 | ADR-030 | 3F | TASK-3F-057 | AC-3F-507 | TEST-3F-013 — the boundary in each direction: exactly 10 passes, 11 overflows; exactly 50 passes, 51 overflows | CHANGE-0018 |
| REQ-062 | ADR-030 | 3F | TASK-3F-058 | AC-3F-508 | TEST-3F-014 "A11" — **the cap driven to its boundary live**, 61 mutations | CHANGE-0018 |
| REQ-061 | ADR-030 | 3F | TASK-3F-059 | AC-3F-509 | TEST-3F-014 "A5", "A10" — expenses, buckets, estimate and profile byte-identical across a run and an acceptance | CHANGE-0018 |
| REQ-009 | ADR-009 | 3F | TASK-3F-060 | AC-3F-510 | TEST-3F-014 "A6", "A7" — foreign id refused on both write paths; a second account sees and gets nothing | CHANGE-0018 |
| REQ-063 | ADR-030 | 3F | TASK-3F-061 | AC-3F-511 | TEST-3F-014 "A12" — the no-profile run is `skipped`, not success; the thrown-failure path is a note, not a pass | CHANGE-0018 |
| REQ-057 | ADR-029 | 3F | TASK-3F-062 | AC-3F-512 | TEST-3F-014 "A9" — no new kind, section, rule or read; a proposal is not an attention item | CHANGE-0018 |
| REQ-013 | ADR-013, ADR-014 | 3F | TASK-3F-063 | AC-3F-513 | TEST-3F-013 (the module imports no client and holds no credential); TEST-3F-014 "A5" | CHANGE-0018 |
| REQ-015 | ADR-010 | 3F | TASK-3F-064 | AC-3F-514 | TEST-3F-014 "learning" — measured in isolation | CHANGE-0018 |
| REQ-016 | ADR-016 | 3F | TASK-3F-065 | AC-3F-515 | TEST-3F-015 (budget audit of the feature's own file set) | CHANGE-0018 — 5 of 6 files, 2 of 2 tables, 0 deps, 1 abstraction |
| REQ-032 | ADR-019 | 3F | TASK-3F-066 | AC-3F-516 | TEST-3F-014 — `convex.config.ts` accepted by the deployment; **firing recorded as unverified** | CHANGE-0018 |

**Phase 3 feature 4 acceptance criteria → test mapping**

| AC | Criterion | Where verified | Result |
|---|---|---|---|
| AC-3F-301 | A past-dated promise is `overdue` and produces exactly one hard `commitment.overdue` item in `people` | `conformance-4f.ts` "A1" | PASS, live — state, section, class, `dueAt` and the exact detail string |
| AC-3F-302 | A past-dated wait produces exactly one `commitment.waiting` item in `waitingOn`, quieter than a broken promise | `conformance-4f.ts` "A2" | PASS, live — 0.6 vs 0.85, action is `Follow up` |
| AC-3F-303 | No date, or a distant date, produces **no** item; `due` does not either; moving the date removes the item | `conformance-4f.ts` "A3" | PASS, live — plus direction is immutable at the validator |
| AC-3F-304 | Panel creates no task unasked; `followUp` creates exactly one with `personId`, `commitmentId` and today's date | `conformance-4f.ts` "A4" | PASS, live — idempotent on a second press |
| AC-3F-305 | Completing the follow-up does not complete the commitment | `conformance-4f.ts` "A5" | PASS, live |
| AC-3F-306 | A settled commitment is `kept` and leaves Attention; the copy attributes it to the user | `conformance-4f.ts` "A6", "A7" | PASS, live — re-settling is idempotent; reopen restores it |
| AC-3F-307 | No inbound string asserts anything about the other person | `commitments.test.ts`; `conformance-4f.ts` "A7" | PASS — asserted as a property over every inbound string, and over the whole live list |
| AC-3F-308 | Merge rewrites nothing, unmerge restores, a merged-away person still resolves | `conformance-4f.ts` "A8" | PASS, live — stored pointer unchanged, resolved name changes |
| AC-3F-309 | Every read and write is owner-scoped; a foreign id is refused | `conformance-4f.ts` "A9" | PASS, live — all seven write paths, plus a foreign `personId` |
| AC-3F-310 | No people mutation removes a commitment; `deleteCommitment` detaches and reports | `conformance-4f.ts` "A10" | PASS, live — chase task survived and is detached |
| AC-3F-311 | All four `commitment.*` activity kinds are written and read back with real values | `conformance-4f.ts` "A11" | PASS, live |
| AC-3F-312 | Nothing regresses, and capture infers no commitment in either direction | `conformance-4f.ts` "A12" | PASS, live — area catalogue is exactly the six areas from features 0–3 |
| AC-3F-313 | `FEATURE_COUNT` 12, `weightsVersion` 1, and a commitment moves no weight | `conformance-4f.ts` "A13" | PASS, live — four commitment mutations, zero samples, zero weight movement; and the follow-up task it created **did** train |
| AC-3F-314 | Every read is index-scoped, owner-prefixed and bounded | `conformance-4f.ts` "A14" + the D42 correction | PASS — `by_owner_open` range, explicit `.take(200)` |
| AC-3F-315 | Budget: 4 files / 1 table / 0 deps / 1 abstraction | CHANGE-0016 | PASS — 4 / 1 / 0 / 1 |

**Phase 3 feature 5 acceptance criteria → test mapping**

| AC | Criterion | Where verified | Result |
|---|---|---|---|
| AC-3F-401 | A subscription is created together with its renewal document, so one cannot exist unwatched | `conformance-5f.ts` "A1" | PASS, live — `documentId` returned by the create, and a smuggled `documentId` is refused |
| AC-3F-402 | A renewal inside the lead window produces **exactly one** `document.expiring` item, and Panel adds no kind, section, rule or read | `conformance-5f.ts` "A1", "A2" | PASS, live — 1 item, class `hard`, section `deadlines`, zero `subscription.*` kinds present |
| AC-3F-403 | Annual cost is derived, never stored, and correct for every closed interval | `subscriptions.test.ts`; `conformance-5f.ts` "A3" | PASS — all four intervals, plus the exact values where a double misbehaves (`0.07 × 12`) |
| AC-3F-404 | The stored amount is never rewritten by rounding | `conformance-5f.ts` "A3", "A5" | PASS, live — 0.1 and 0.2 still exactly 0.1 and 0.2 |
| AC-3F-405 | `NaN`, both infinities, zero, negatives and the magnitude ceiling are refused | `subscriptions.test.ts`; `conformance-5f.ts` "A4" | PASS, live — on `addExpense`, `createSubscription` and `saveTaxProfile` |
| AC-3F-406 | Zero income is allowed, because no declared income is a real answer | `conformance-5f.ts` "A4" | PASS, live |
| AC-3F-407 | An emitted bucket total is a clean 2dp number, and `getFinance` reads an index range over the tax year on local-time bounds | `conformance-5f.ts` "A5", "A6" | PASS, live — **this check found D43** |
| AC-3F-408 | An account holds a label and a kind, and no balance column exists | `conformance-5f.ts` "A7" | PASS, live — the payload is exactly `id, label, kind, createdAt`; an unknown kind is refused |
| AC-3F-409 | Every read and write is owner-scoped; a foreign id is refused on all six paths | `conformance-5f.ts` "A8" | PASS, live — including a foreign `accountId` and a smuggled `documentId` |
| AC-3F-410 | Deleting an account detaches its subscriptions, reports the count, and leaves another account alone | `conformance-5f.ts` "A9" | PASS, live — detached 3, 4 survived as ungrouped, the other account untouched |
| AC-3F-411 | `expense.added` and all five new kinds are written and read back | `conformance-5f.ts` "A10" | PASS, live — **this check found D46** |
| AC-3F-412 | `FEATURE_COUNT` 12, `weightsVersion` 1, and a subscription moves no weight | `conformance-5f.ts` "A11" | PASS, live — zero samples, zero weight movement |
| AC-3F-413 | Capture infers no subscription and creates no account | `conformance-5f.ts` "A12" | PASS, live (Q-007 interim) |
| AC-3F-414 | The tax checklist, the 34 tax fixtures and the six-area catalogue are unchanged | `bun test`; `conformance-5f.ts` "A13" | PASS, live |
| AC-3F-415 | Budget: 6 files / 2 tables / 0 deps / 1 abstraction | CHANGE-0017 | PASS — 4 / 2 / 0 / 1 |

##### 12.0 Scope block — Subscriptions + Account Labels (Finance expansion)

| Field | Value |
|---|---|
| **Feature** | Subscriptions + account labels — the recurring money Panel knows about, and the accounts it comes out of |
| **Approval** | **APPROVED by Hardik, 2026-10-01**, on the standing roadmap approval. The `03_PRODUCT_CONTEXT.md` capability row still reads `RESEARCHED` / "Not specified" and §3.2 named Finance as gated on user research that has not happened; both were answered by that approval and are **recorded rather than edited away**. |
| **Problem it solves** | A subscription is a **number** until its renewal is an **action**, and today Panel only holds the number. "£9.99/month" exists solely as an `expenses` row with a `Software & subscriptions` bucket: it is aggregated into a tax estimate, it is never dated, and the user cannot answer "what renews this month, and what does that cost me a year?" — which is the only reason a finance app is opened. Accounts are worse: Panel has **no account object at all**, so obligations cannot be grouped by where the money goes, and there is nowhere to put a balance — correctly, because a balance is a ledger (ADR-028). §2.3 states the thesis this feature implements: ledgers *stop where an action is needed*, and Panel's entire value is the part after that point. |
| **User outcome** | Every recurring obligation in one place, with its next renewal date and its **annual cost**, reaching Attention through the expiry→renewal chain Panel already has. The user learns, without opening anything, that three renewals fall in the next 30 days and cost £412 a year. |
| **IN SCOPE** | An `accounts` table holding a **label and a kind only** — no balance, no number, no institution id, no transactions (ADR-028). A `subscriptions` table: label, amount, a **closed** billing interval, the next renewal date, an optional `accountId`, and a `documentId` **pointing at a real `documents` row the subscription itself creates** (ADR-029). A derived annual cost and a four-state lifecycle in `src/lib/subscriptions.ts`. A Subscriptions block inside the **existing Finance area** — no new slug, no new tab, no new Page. Fixing **D43** (the unbounded expense read) and **D44** (`NaN` amounts), and writing the `expense.added` activity kind that D38 recorded as declared-but-never-written. |
| **OUT OF SCOPE** | Any balance, transaction, ledger, or double-entry anything — §2.3 forbids it outright · account numbers, sort codes, IBANs, card or merchant credentials · exchange rates or multi-currency conversion · bank connectivity (blocked on credentials and D32 regardless) · CSV or OFX import · loans, assets, liabilities, investments, net worth, cash flow, financial goals · a finance-specific attention section or prioritiser · a second expiry or renewal model · a `status` column · capture inferring a subscription (Q-007) · automatic cancellation, payment or any external action · **moving money off the float representation** (see MONEY, below) |
| **DO NOT TOUCH** | `src/lib/nlp.ts` token loop (#7) · scorer maths (#6) · `recordOutcome` (#8) · ADR-010 feature layout · `taxDocuments` and `toggleDocument` · the §5.7 section budgets · the Finance disclaimer position (MAIN_AGENT P10) · features 3 and 4 wholesale (ADR-025/026/027) · `estimateTax`, `readinessScore`, `mileageRateFor` and all 34 `tax.test.ts` fixtures |
| **Terminology** | **Account** — a user-named place money leaves from, known only by its name and kind. **Subscription** — a recurring charge with a known price and a known next renewal date. **Annual cost** — derived, never stored. |

**MONEY — the float decision, recorded with its consequences**

`expenses.amount` and `taxProfile.grossIncome` stay `v.number()`. They were not migrated to minor units, because a migration rewrites the input to a verified tax estimate and the instruction is not to change existing financial semantics silently. The consequence is accepted and guarded rather than fixed:

- **Every write path rejects a non-finite amount** (`Number.isFinite`) and a magnitude above `MAX_AMOUNT`. A NaN that reaches `estimateTax` does not produce an obvious failure — it produces a *plausible* number, which is the one outcome worse than a crash.
- **Sums are rounded at the presentation boundary, never at rest.** `0.1 + 0.2` is reachable in a bucket total; rounding on write would corrupt the stored value to hide a display artefact, so the accumulator stays exact and `round2` is applied when a total is emitted.
- **The tax-year filter is a local-time range**, matching the `getFullYear()` semantics it replaces exactly. A UTC range would silently move the boundary day for every user outside UTC, which is a worse defect than the one it fixes.

**Why a subscription owns a `documents` row rather than duplicating expiry logic**

`src/lib/subscriptions.ts` computes *annual cost* and *how much is left on the subscription*; it computes **nothing** about whether a document is expiring. That is `document.expiring`'s job, it already exists, and a second expiry model is the exact hazard F3 refused. So a subscription is **created together with** its document, and every subsequent read resolves `subscriptions.documentId → documents` — the ADR-026 shape, where the related row holds nothing and the relation resolves on read. Two consequences fall out for free:

- **Zero new attention code.** `getAttention` gains no new source, no new read and no new rule. The `by_owner_expiry` range already covers the set.
- **One renewal, one item — still true.** There is exactly one producer of "this is expiring", so the F3 anti-duplication guard is preserved rather than re-litigated.

**Why account labels and not accounts**

An account here is a *label the user chose*, so Panel can say "£412/yr across Joint current and Amex". It is deliberately incapable of holding a balance: a balance is a derived value over transactions, a transaction is a ledger row, and a ledger is what §2.3 names as the thing Panel must not become. A half-built account that stores a balance the user types in would be a number Panel cannot verify and cannot update — the worst of both.

**ACCEPTANCE CRITERIA**

1. A subscription with a renewal date inside its lead window produces **exactly one** `document.expiring` hard item, and Panel adds **no** new attention kind, section or rule.
2. A subscription with no renewal date produces no document item; setting a date produces one; moving the date out of the window removes it.
3. Annual cost is derived, never stored, and is correct for every closed interval; it is never a second copy of `amount`.
4. `NaN`, `Infinity` and `-Infinity` are refused on `addExpense`, `saveTaxProfile` and `createSubscription`; a negative or zero amount is refused; an amount above `MAX_AMOUNT` is refused.
5. A bucket total emitted to the client is rounded to 2dp; the stored expense amounts are unchanged by that rounding.
6. `getFinance` reads expenses through a `by_owner_spentAt` **range** over the tax year, not a collect-then-filter (D43), and the set it returns is identical to the pre-change set for a user on any UTC offset.
7. An account holds a label and a kind and **no** balance column exists anywhere in the schema.
8. Every read and write is owner-scoped; a foreign `accountId`, `documentId` or `subscriptionId` is refused on every path.
9. Deleting an account **detaches** its subscriptions and reports the count; it deletes nothing else.
10. `expense.added` and all four `subscription.*` kinds are written and read back with real values — D38's Finance leftover closed.
11. `FEATURE_COUNT` is 12, `WEIGHTS_VERSION` is 1, and no subscription or account mutation moves a weight.
12. Capture creates zero subscriptions and zero accounts (Q-007 interim).
13. All 34 `tax.test.ts` fixtures and the tax checklist are unchanged.

**BUDGET** — 6 new files · 2 new tables (`accounts`, `subscriptions`) · 0 deps · 1 abstraction (`src/lib/subscriptions.ts`)

| Budget item | Max | Used |
|---|---|---|
| New files | 6 | 5 — `src/lib/subscriptions.ts`, `src/lib/subscriptions.test.ts`, `src/convex/subscriptions.ts`, `scripts/conformance-5f.ts`, and the UI inside the **existing** `FinanceArea.tsx` (modified, not new) |
| New tables | 2 | 2 |
| New deps | 0 | 0 |
| New abstractions | 1 | 1 |

**Phase 3 feature 6 acceptance criteria → test mapping**

| AC | Criterion | Where verified | Result |
|---|---|---|---|
| AC-3F-501 | A space is not scheduled until a person opts in, and the flag is required at enrolment **and** re-checked on every run | `conformance-6f.ts` "A1" | PASS, live — both `enableAgents` and `runMyAgentsNow` refused while the flag is off; a space with no `nextAgentRunAt` is not in the due range at all |
| AC-3F-502 | The registry is exactly one agent, and no agent duplicates a producer that already exists | `agents.test.ts`; `conformance-6f.ts` "A9" | PASS, live — `["finreview"]`; the five absent §6.1 agents are named in the module header with their real producer |
| AC-3F-503 | A run executes the approved agent and produces a proposal with falsifiable evidence | `conformance-6f.ts` "A2", "A3" | PASS, live — 1 proposal, 4 evidence pairs, every number traceable to a row |
| AC-3F-504 | Re-running against unchanged input creates no second proposal, activity row or state change | `agents.test.ts` double-run fixtures; `conformance-6f.ts` "A4", and "A11" after 51 further runs | PASS, live — still exactly one proposal, never re-opened after acceptance |
| AC-3F-505 | The swing comes from `estimateTax` run twice, never a hand-rolled rate, and the wording never claims a category is wrong | `agents.test.ts`; `conformance-6f.ts` "A3" | PASS, live — the disclaimed phrase is present and no `wrong`/`incorrect`/`mistake`/`error` survives it |
| AC-3F-506 | The `automatic` tier's action union contains no operation that can write a financial row | `agents.test.ts`; `src/lib/agents.ts` | PASS — `AgentAction` is `{kind:"flag"} \| {kind:"log"}`, so the compiler is the guarantee |
| AC-3F-507 | Per-run cap is exactly 10 and per-space daily cap exactly 50, each pinned at its boundary | `agents.test.ts` | PASS — 10 allowed / 11 overflows by `per_run`; 50 allowed / 51 overflows by `per_day` |
| AC-3F-508 | The 51st execution in a day is refused, counted as overflow, observable, and reported `capped` | `conformance-6f.ts` "A11" | PASS, live — the tally filled to exactly 50, then `executions 0`, `overflow 1`, `result "capped"`, readable by the owner |
| AC-3F-509 | A run, a proposal and an acceptance change **no** financial data | `conformance-6f.ts` "A5", "A10", "A11" | PASS, live — expenses, buckets, estimate and profile byte-identical across 61 mutations |
| AC-3F-510 | Every read and write is owner-scoped; a foreign id is refused; a second account sees and gets nothing | `conformance-6f.ts` "A6", "A7" | PASS, live — a space-less account is answered with `[]`, not a stack trace |
| AC-3F-511 | A run that did nothing is recorded as `skipped`, never as a success; a thrown failure is recorded with a bounded message; a failing space neither aborts the batch nor storms | `conformance-6f.ts` "A12" | PASS, live for the skip property. **The thrown-failure path is NOT exercised** — recorded as a `[NOTE]`, because the only honest way to make a real space throw is to break the code first. Retry behaviour is verified by inspection of one loop, and stated as such |
| AC-3F-512 | Panel adds no new Attention kind, section, rule or query, and a proposal is not an attention item | `conformance-6f.ts` "A9" | PASS, live — kinds present are unchanged, and no item carries the proposal's id |
| AC-3F-513 | No external action occurs; the agent holds no credential and reaches no network | `agents.test.ts` (no client import); `conformance-6f.ts` "A5" | PASS — `src/lib/agents.ts` imports `estimateTax` and nothing else |
| AC-3F-514 | `FEATURE_COUNT` is 12, `weightsVersion` is 1, and a run records no training sample and moves no weight | `conformance-6f.ts` "learning" | PASS, live — zero samples |
| AC-3F-515 | Budget: 6 files / 2 tables / 0 deps / 1 abstraction | CHANGE-0018 | PASS — 5 / 2 / 0 / 1 |
| AC-3F-516 | A daily scheduled function is declared and accepted by the deployment, and **its firing is recorded as unverified rather than as a pass** | `convex.config.ts`; `conformance-6f.ts` "the scheduler" | **DECLARED, FIRING UNVERIFIED** — the deployment accepted the config and the runner it targets is exercised live through the same `runSpace`, but a 07:00 delivery cannot be observed inside a test run and the CLI exposes no way to read the schedule back |

##### 12.0 Scope block — Deterministic agents (the scheduled runner and one review agent)

| Field | Value |
|---|---|
| **Feature** | A bounded deterministic agent framework with scheduled execution, and the first genuinely additive review agent |
| **Approval** | **APPROVED by Hardik, 2026-10-01**, in a directive that named the architecture (option c, Convex cron), the caps, the idempotency rule, the run record's fields, the failure and performance constraints, and fifteen verification criteria — and named one of them **not** to be met by claiming a pass that did not happen |
| **Problem it solves** | Panel's intelligence is entirely query-time. Nothing ever looks at anything on the user's behalf, so a user who does not open the app learns nothing and is never told anything. §6 specified agents and §6.1 named six, but five of the six already had producers — so the specification's real gap was not six agents. It was that **there is no *when* at all** |
| **User outcome** | Open the app and find one honest, already-computed question — *3 categories holding 1630 of your deduction are unconfirmed; if none qualified, your estimate would fall by about 480* — with the evidence beside it and nothing changed until the user does it |
| **IN SCOPE** | `src/lib/agents.ts` — the pure framework and the one agent, no Convex import. `src/convex/agents.ts` — one `runSpace` behind two front doors, the cron internal mutation and a user-scoped `runMyAgentsNow`. `convex.config.ts` — one daily scheduled function, the only scheduling mechanism. Two tables, `agentRuns` and `agentProposals`. A *Things to check* block and a last-run line inside the **existing** Finance area. A manual *Check now* front door onto the same runner |
| **OUT OF SCOPE** | The other five §6.1 agents, each of which has a producer already (ADR-030) · a second producer for any existing hard rule · a sixth Attention kind — proposals use the existing mechanism · any write to financial data · automatic confirmation, categorisation or correction · any external action, provider write or network call · an external scheduler, queue, Redis, worker, second backend or plugin registry · an LLM, a model call, or any non-determinism · high-frequency polling · notifications · multi-agent orchestration or a workflow engine |
| **DO NOT TOUCH** | The scorer maths (#6) · `nlp.ts`'s token loop (#7) · `recordOutcome` as the single weight-mutation point (#8) · the deterministic-idempotency-key requirement (#9) · the confirmation requirement (#10) · ADR-011's tiers · `estimateTax` (Do-Not-Touch #1 — the agent **calls** it twice rather than reimplementing the arithmetic) · the §5.7 section budgets · features 3, 4 and 5 wholesale (ADR-025/026/027/028/029) |

**The scheduler answers *when*, never *what***

`convex.config.ts` declares exactly one function: `agents/daily`, `0 7 * * *`, calling `internal.agents.internalRunDueSpaces`. That is the whole of the scheduling architecture — no queue, no worker, no second backend, because the work is a bounded read and a handful of writes, and anything larger would be infrastructure Panel has not earned (R13).

The property the directive asked for is that **cron cannot widen agent authority**, and the strongest form of that guarantee is not in the runner at all. It is that `AgentAction` is a closed union of `{kind: "flag"} | {kind: "log"}`. There is no variant that can insert an expense, patch a tax profile or reach a document, so an agent that tried would not compile. The tier is a **return type**, not a convention (ADR-011), and `financeReviewAgent` declares the narrow `{tier: "proposed"}` — so *could this agent escalate?* stopped being a decision a later edit could make by accident. Two dead branches came out of the runner for the same reason: a branch that cannot be true is a branch nobody tests.

**Why one agent, and not the six §6.1 names**

| §6.1 agent | The producer that already exists |
|---|---|
| `recurringRespawn` | `assistant.spawnNextOccurrence` (0A) |
| `documentExpiry` | the `document.expiring` hard rule (CHANGE-0015) |
| `commitmentOverdue` | `commitment.overdue` / `.waiting` (CHANGE-0016) |
| `applySync` | `integrations.internalApplyBatch` (ADR-012) |
| `recurringPayment` | needs accounts and transactions — unapproved Finance work, and §2.3 forbids the ledger |
| `relationshipReminder` | needs a relationship model Panel does not have |

A second producer for *this is expiring* is precisely the violation feature 3's acceptance criteria named — **one renewal, one item** — and it would have been a violation committed in the name of following a specification. So the registry is one entry, and the five absences are written down beside their real producers rather than left as a silent gap.

**The one agent: low-confidence finance review**

It is additive because it is the only thing in the product that looks at an existing row and says *this number depends on something nobody checked*. It reads the tax profile and the year's deductible expenses, sums what rests on unconfirmed categories, and states the swing by running `estimateTax` **twice** — once as it stands, once with the unconfirmed rows removed — and subtracting. **Never** by applying a rate of its own: this figure goes on screen next to the estimate it qualifies, and a second tax arithmetic path is a second thing that can disagree with the first.

Its wording obeys one rule: **it never says a category is wrong.** It says what is unconfirmed and what the figure would be if the unconfirmed part turned out not to count, and then says so in as many words — *Panel is not saying they are wrong — only that nobody has checked.* A scheduled process guessing wrong about a tax return is worse than one that said nothing.

**I have looked changes no money, on purpose.** Accepting a proposal records an acknowledgement and stops. It does not mark an expense deductible, because the review is the agent noticing and **confirming each category stays an act the user performs in the Expenses list, where they can see what they are confirming.** An accept button that silently rewrote a tax return would be the exact failure this feature was scoped to avoid — and it would be invisible, which is worse.

**Bounded underneath — the D37/D39/D41/D42/D43 lesson applied to a scheduler**

A scheduled job is uniquely able to get away with *collect every space and filter*, and uniquely wrong to do it. So: due spaces are an **index range** on `by_nextAgentRunAt` (`lte`, `.take(200)`); a space is in that range **only if a person opted in**, and clearing the column drops it out immediately, because Convex omits a document from an index when a field is absent; expenses come from the `by_owner_spentAt` **range** feature 5 added, `.take(2000)`; the daily tally is a bounded read of one space's own runs.

**Overflow is counted, observable and audited — all three**

Counted and audited were free: `overflow` is a column on `agentRuns`. **Observable** was not, and without it a capped agent would hold work back in silence forever, which is the exact failure a cap exists to prevent. So `getLastRun` surfaces the last result, the counts, the overflow and the day's tally against both caps, and the Finance area says so in the open. The live harness drives the tally to exactly 50 and then proves the 51st run is refused, counted, observable and reported `capped`.

**Failure, without a retry storm**

There is one `catch` in the batch loop. A failure is recorded against that space with a 200-character message — no stack, no arguments, no path, because the arguments could contain a label or an amount — and the rest of the batch continues, since a run that aborts on the first error starves everyone behind it. `nextAgentRunAt` advances **after** the attempt, so a failing space stays due and is retried tomorrow exactly once. There is no backoff queue, no exponential loop and no second attempt within a run, which is the whole mechanism: **one attempt per space per day, always.**

**ACCEPTANCE CRITERIA**

1. A space is not scheduled until the user opts in, and `debug_agents_v1` is required at enrolment and re-checked on every run.
2. The registry is exactly one agent; no agent duplicates a producer that already exists.
3. A run executes the approved agent and produces a proposal whose every number is traceable to a row.
4. Re-running against unchanged input creates no second proposal, activity row or state change — including after the proposal has been answered.
5. The swing is computed by `estimateTax` twice, and the wording never claims a category is wrong.
6. The tier is a return type, and the action union cannot express a financial write.
7. Per-run cap is exactly 10 and per-space daily cap exactly 50, each pinned at its boundary.
8. The 51st execution in a day is refused, counted as overflow, **observable**, and reported as capped — never silently truncated.
9. A run, a proposal and an acceptance change no financial data at all.
10. Every read and write is owner-scoped; a foreign id is refused on both write paths; a second account sees and gets nothing.
11. A run with nothing to do is recorded `skipped`, never as a success; a thrown failure is recorded; one failing space neither aborts the batch nor causes a retry storm.
12. Panel adds no new Attention kind, section, rule or query, and a proposal is not an attention item.
13. No external action occurs; the pure module holds no credential and imports no client.
14. `FEATURE_COUNT` is 12, `weightsVersion` is 1, and a run records no training sample and moves no weight.
15. Budget: 6 files / 2 tables / 0 deps / 1 abstraction.
16. A daily scheduled function is declared and accepted by the deployment, and **its firing is recorded as unverified** rather than as a pass.

**BUDGET** — 6 new files · 2 new tables (`agentRuns`, `agentProposals`) · 0 deps · 1 abstraction (`src/lib/agents.ts`)

| Budget item | Max | Used |
|---|---|---|
| New files | 6 | 5 — `src/lib/agents.ts`, `src/lib/agents.test.ts`, `src/convex/agents.ts`, `convex.config.ts`, `scripts/conformance-6f.ts` (the UI went into the **existing** `FinanceArea.tsx`, modified not new) |
| New tables | 2 | 2 |
| New deps | 0 | 0 |
| New abstractions | 1 | 1 |

> **Spec correction, CHANGE-0018.** §9.3 step 1 says an agent is a pure function in
> `src/lib/agents/`. It is `src/lib/agents.ts` — a file, not a directory — because
> the registry holds exactly one agent, and a directory containing one file is an
> abstraction the budget does not have. §9.3 also asks for `traceAgent()`
> expectations; the trace is asserted as a **purity fixture** instead, since a
> golden trace would only re-state the implementation. The drift script does not
> enforce the path, so this is a note rather than a failure — but a spec sentence
> naming a path the code does not use is a defect in the spec.

**Phase 0A (next)**

| REQ | ADR | Phase | Task | Acceptance | Test | Change |

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

**Phase 4, feature 4A (Area-native surfaces) — PROPOSED, NOT APPROVED, NOT BUILT**

| REQ | ADR | Phase | Task | Acceptance | Test | Change |
|---|---|---|---|---|---|---|
| REQ-065 | — | 4A | TASK-4A-001 | AC-4A-501 | TEST-4A-601 `scripts/conformance-4a.ts` "A1" — Finance's first rendered section is the Overview, composed only from values `getFinance` and `listSubscriptions` already return | CHANGE-0019 |
| REQ-065 | — | 4A | TASK-4A-002 | AC-4A-502, AC-4A-503 | TEST-4A-601 "A2" — accounts, subscriptions, expenses, tax documents and commitments each render in Finance; Accounts is no longer a collapsed disclosure | CHANGE-0019 |
| REQ-066 | — | 4A | TASK-4A-003 | AC-4A-504 | TEST-4A-601 "A3" — every offered verb resolves to an existing Convex mutation, asserted by name; no verb exists without one | CHANGE-0019 |
| REQ-067 | — | 4A | TASK-4A-004 | AC-4A-505 | TEST-4A-601 "A4" — a commitment with **no person row** is visible in General; today it is invisible, which is the defect | CHANGE-0019 |
| REQ-068 | — | 4A | TASK-4A-005 | AC-4A-506 | TEST-4A-601 "A5" — capture in Finance still reaches `assistant.addTask` unchanged; the parser, `nlp.ts` and `estimateTax` are byte-identical | CHANGE-0019 |
| REQ-065 | — | 4A | TASK-4A-006 | AC-4A-507, AC-4A-508 | TEST-4A-601 "A6" — Home states what it is; a second account sees none of it; the 13 existing harnesses, `bun test`, `tsc`, the stock lint baseline and `spec-drift` all still pass | CHANGE-0019 |

**Phase 4, feature 4B (Transactions + ingestion) — ARCHITECTURE ONLY, BLOCKED on Q-008**

| REQ | ADR | Phase | Task | Acceptance | Test | Change |
|---|---|---|---|---|---|---|
| REQ-069 | pending | 4B | TASK-4B-001 | AC-4B-511 | TEST-4B-611 **reserved, not written — BLOCKED by Q-008**: no code may exist before that question is answered | CHANGE-0020 (not written) |
| REQ-070 | — | 4B | TASK-4B-002 | AC-4B-512 | TEST-4B-612 **reserved, not written — BLOCKED by Q-008**: the review screen must show uncertainty before anything is persisted | CHANGE-0020 (not written) |
| REQ-071 | — | 4B | TASK-4B-003 | AC-4B-513 | TEST-4B-613 **reserved, not written — BLOCKED by Q-008**: a second account and a second space both read nothing | CHANGE-0020 (not written) |
| REQ-072 | — | 4B | TASK-4B-004 | AC-4B-514 | TEST-4B-614 **reserved, not written — BLOCKED by Q-008**: a scanned PDF is refused with a stated reason, deterministically | CHANGE-0020 (not written) |

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

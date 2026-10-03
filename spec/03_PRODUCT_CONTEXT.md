# 03 — PRODUCT CONTEXT

**The bird's-eye view of Panel.** Why it exists, for whom, against what, and how
we will know whether it works.

Status: `ACTIVE` · Last updated: 2026-10-01

> **Evidence discipline.** Every claim below carries an evidence label.
> Nothing labelled `HYPOTHESIS` is a decision. Nothing labelled `FACT` has been
> re-verified more recently than the date shown.

---

## 1. Product

### 1.1 Vision

**A personal operating layer for someone's life.** Connect the tools a person
already uses; Panel brings the resulting information together, understands the
relationships between it, and tells the person what actually needs their
attention.

### 1.2 Problem

Personal life is fragmented across tools that do not talk to each other. The
consequences are structural, not cosmetic:

- **Manual reconstruction.** A person must mentally re-assemble "what is
  happening" from calendar, mail, banking, health apps and memory — every time.
- **Lateness.** Because the source systems are not cross-referenced, deadlines
  are discovered after they matter.
- **The maintenance trap.** Any solution that requires the user to keep a
  parallel system up to date fails: the system drifts from reality, trust
  collapses, the app is abandoned.

### 1.3 Product thesis

> **Most dashboards die because they are organisational tools pretending to be
> operational tools. Panel wins by never asking the user to maintain a second
> system — it derives its value from data the user's existing tools already
> generate, and spends that value on one thing only: telling the person what to
> do next.**

### 1.4 Target users

| Segment | Description | Why Panel fits | Priority |
|---|---|---|---|
| **The overloaded individual** | Employed or self-employed adult, 5–15 external tools, high variety of obligations (family, health, money, side projects). Feels the fragmentation daily. | Highest variety of sources = highest value from cross-referencing. | **Primary** |
| **Self-employed / freelancer** | Irregular income, multiple jurisdictions' worth of admin, deadline-driven. | The tax rule engine and deadline surface address a concrete, painful job. | **Primary** |
| **Family co-ordinator** | Holds the household's dates, documents, renewals and shared logistics. | The spaces + sharing + document-expiry model is designed for exactly this person. | **Secondary** |
| **Privacy-sensitive professional** | Wants the value of aggregation without handing a third party their whole life. | Data minimisation is a design constraint, not a policy page. | **Secondary** |

**Explicitly not targeted (v1):** teams, companies, any multi-tenant/enterprise
use. Panel is a personal system. Adding collaboration would be a different product.

### 1.5 Jobs to be done

**Functional**

1. When I start the day, tell me what actually needs me — not a list, a judgement.
2. When I say "call mum 6pm tomorrow", record it as the person, the task and the
   moment, in one line.
3. When a document, policy or registration expires, tell me early enough to act.
4. When money moves out that looks recurring, tell me what it is and when it
   returns.
5. When someone is waiting on me, or I am waiting on them, show it.

**Emotional**

1. *"I am not going to forget something important."*
2. *"I do not have to check six apps to know what is happening."*
3. *"This tool is not hoarding my life."*

### 1.6 Differentiation

| Dimension | Typical dashboard | Panel |
|---|---|---|
| Data entry | The user maintains it | Derived from connected tools |
| Intelligence | Rules, or a black-box model | Small deterministic models, **inspectable weights** |
| Personalisation | Manual sorting | Learns from the user's own completions, and says why |
| Object model | One object type (tasks) | Multiple kinds with first-class relationships |
| Privacy | Data hoarded in a cloud | Minimisation by design; private data never stored |
| Attention | Everything, unranked | A hard budget; silence is a feature |

### 1.7 Positioning

> **Panel is not a place to record your life. It is the layer that reads the
> places you already record it and tells you what matters.**

Competitors own a *category*. Panel owns the *cross-category attention problem*.

---

## 2. Competitive landscape

Purpose: **strategic decision-making**. Each entry states what Panel should learn
and what Panel must **not** copy. Not a feature comparison.

### Classification legend

Every claim in this section carries one of these. **Competitive research must not
quietly become product truth.**

| Label | Meaning |
|---|---|
| `OBSERVED` | A fact about what a competitor's product actually does. Verifiable by looking at it. |
| `USER REPORT` | Someone reported it. One report is one report. |
| `INFERENCE` | Our reasoning from observation. Provisional. |
| `HYPOTHESIS` | An unvalidated belief. See the register in §3.3. |
| `DECISION` | A Panel product decision, already taken. Not evidence. |

The `Panel must NOT copy` column is always a **`DECISION`**, never a finding.

#### Classification of the entries below

The prose that follows is unchanged from the original review. This table says
what kind of claim each part is, so competitive research cannot silently
harden into product truth.

| Category | `OBSERVED` (what they do) | `INFERENCE` (our reading) | `DECISION` (our choice) |
|---|---|---|---|
| Productivity | Capture quality refined over years; large surface | Task lists are separate from life | Do not become a planning workspace |
| Dashboards | Glance ships no task management | It is because tasks require entry | No configurable widget grid |
| Finance | Bank connectivity solved; they are ledgers | They stop where an action is needed | No double-entry ledger; no financial advice |
| Family | Shared chores/calendars/budgets | Narrow scope creates another tab to check | One object model, not a bolted-on family app |
| Personal CRM | Reminders + interaction history | Value caps out because entry is manual | Never Salesforce |
| Automation | Large trigger surface | You cannot automate what you have not noticed | No trigger builder, canvas or marketplace |
| Health | Passive sensing, excellent dashboards | The model to follow is passive-by-default | Consume health context; never build sensors |
| Knowledge | Extraordinary flexibility | Blank canvas transfers burden to the user | Build none of it |
| Calendar AI | Auto-schedules tasks into free time | Calendar-only world model | Never auto-write to the user's calendar |

**No entry in this section rests on `USER REPORT` or `HYPOTHESIS`.** Where user
anecdote exists it lives in §3.1 (E7, E8), labelled as such.

### 2.1 Productivity / task managers — Todoist, Things, TickTick, Asana

- **What they do:** Excellent capture and organisation of tasks and projects.
- **Who they serve:** Individuals through large teams.
- **Strengths:** Capture quality is the product. Years of refinement. Excellent
  natural-language input.
- **Weaknesses:** The user's task list is a **separate system from their life**.
  A task saying "send Sarah the contract" has no knowledge of the email, the
  contract, or the person's birthday. Value stops at the checklist.
- **Panel should learn:** Capture quality is the front door. Todoist's parsing is
  the benchmark our parser is measured against.
- **Panel must NOT copy:** An organisational workspace as the product. Panel does
  not want to become where you *plan*; it wants to know what *is*.

### 2.2 Personal dashboards — Glance, Heimdall, Homer

- **What they do:** Self-hosted configurable widget grids (RSS, weather,
  calendar, markets, server status).
- **Who they serve:** Technical users wanting a glanceable screen.
- **Strengths:** Genuinely useful, low-friction, self-hostable.
- **Weaknesses:** **Notably, Glance has no task management** — because tasks
  require entry, and entry breaks the zero-maintenance promise. This is the
  clearest market signal available to us.
- **Panel should learn:** If it needs the user to type it, the widget will go
  stale. Panel's integrations must **feed** tasks, not sit beside them.
- **Panel must NOT copy:** The configurable widget grid. A grid where the user
  arranges modules is the blank-canvas dashboard MAIN_AGENT forbids.

### 2.3 Finance — YNAB, Copilot Money, Monarch Money, Lunch Money

- **What they do:** Accounts, transactions, budgets, net worth, some tax prep.
- **Who they serve:** Households and individuals serious about money.
- **Strengths:** Bank connectivity is genuinely solved. Categorisation is good.
- **Weaknesses:** They are **ledgers**. The moment something needs an *action*
  rather than a *number*, they stop. None of them will tell you "your Q3
  estimate is due in 12 days and you have not set it aside".
- **Panel should learn:** Bank connection UX and transaction hygiene.
- **Panel must NOT copy:** Building a double-entry ledger. Panel needs to *know*
  about money, not to re-account for it. Also must not copy confident financial
  advice — see §4.4.

> **§2.3 amended 2026-10-02 (ADR-031, Q-008).** The prohibition above stands in
> full for **double-entry accounting, journals, debit/credit, reconciliation and
> any claim to be the system of record for a bank**. Panel now also holds
> **first-class transactions** — facts the user typed or a deterministic import
> produced — because *knowing* about money means knowing what actually happened,
> and a statement the user retypes by hand is not knowledge. The line is drawn
> at the three rules that make a transaction a fact rather than a ledger row:
> money is an **integer** in minor units; a **balance is derived at query time
> and never stored**; and there is **no accounting**. A stored balance is the
> thing that drifts from the bank with nothing to check it, so Panel still does
> not have one.

### 2.4 Family / household management — FamFam, HomeBudget, shared spreadsheets

- **What they do:** Shared chores, calendars, budgets, sometimes documents.
- **Who they serve:** Households.
- **Strengths:** Shared state genuinely reduces coordination cost.
- **Weaknesses:** Narrow scope. A chore app knows nothing about the rest of the
  family's obligations, so it is another tab to check.
- **Panel should learn:** Sharing must be simple and legible. Nobody wants to
  manage ACLs.
- **Panel must NOT copy:** A purpose-built family app bolted onto a personal one.
  Panel's sharing comes from the same objects and relationships, not a parallel
  subsystem.

### 2.5 Personal CRM / contacts — Clay, Dex, Monica, Airtable

- **What they do:** Contact context, reminders, follow-ups, interaction history.
- **Who they serve:** Relationship-heavy professionals and individuals.
- **Strengths:** Reminders and context are the entire product and they are good
  at them.
- **Weaknesses:** **Manual entry is the whole model.** The value is proportional
  to how much you type, which caps out quickly.
- **Panel should learn:** What a useful person profile actually contains —
  important dates, cadence, what is owed each way.
- **Panel must NOT copy:** Salesforce. Panel is not for tracking strangers.

### 2.6 Automation — Zapier, Make, IFTTT

- **What they do:** Connect tools, run triggers.
- **Who they serve:** Technically capable users and businesses.
- **Strengths:** Enormous surface area; solves real cross-tool problems.
- **Weaknesses:** The user must conceive the automation. **You cannot automate
  what you have not noticed.** Output is a side effect, not an understanding.
  Complexity is the product's main failure mode.
- **Panel should learn:** Reliable normalisation and idempotent re-runs (ADR-012
  is directly modelled on this).
- **Panel must NOT copy:** A trigger builder, a workflow canvas, or a plugin
  marketplace. MAIN_AGENT §11 forbids all three.

### 2.7 Health — Whoop, Oura, Fitbit, Apple Health

- **What they do:** Continuous passive sensing; excellent dashboards over data
  the user did not enter.
- **Who they serve:** People with wearables.
- **Strengths:** Zero entry. **This is the model.** Their weakness is the
  opposite of everyone else's: they know a great deal about sleep and nothing
  about the rest of your obligations.
- **Panel should learn:** Passive-by-default beats active-by-default, always.
- **Panel must NOT copy:** Building sensors or a health-tracking model. Panel
  should consume health context, not manufacture it.

### 2.8 Knowledge / workspace — Notion, Obsidian

- **What they do:** Flexible databases and documents; capture anything.
- **Who they serve:** Broadly, increasingly as a second brain.
- **Strengths:** Extraordinary flexibility.
- **Weaknesses:** **Flexibility is the product and the disease.** Blank canvas
  means the burden of structure transfers entirely to the user, which is exactly
  the maintenance trap Panel exists to avoid.
- **Panel should learn:** Nothing about structure. Learn what makes a database
  feel fast.
- **Panel must NOT copy:** Any of it. MAIN_AGENT §11 names Notion first.

### 2.9 The closest structural comparison — Reclaim, Clockwise, Todoist's Calendar view

- **What they do:** Optimise the calendar by auto-scheduling tasks into free time.
- **Who they serve:** Google/Outlook users.
- **Strengths:** Genuinely removes manual scheduling — the strongest existing
  example of principle P5 in action.
- **Weaknesses:** Narrow: **the calendar is the whole world model.** If your life
  is not schedulable, they do not see it.
- **Panel should learn:** Their "defend time for tasks" behaviour is a strong
  candidate attention rule.
- **Panel must NOT copy:** Auto-writing to the user's calendar. That is a
  confirmation-tier action in Panel (ADR-011), not an automatic one.

### 2.10 Strategic summary

The gap is consistent across every category: **tools own one domain well and are
blind to the relationships between domains.** Task managers do not know about
money. Finance apps do not know about deadlines. Health apps do not know about
obligations.

Panel's entire thesis is that **the value is in the relationships, and the
relationships only exist somewhere that holds several kinds at once.**

---

## 3. User research

**Labelling is mandatory.**

- `FACT` — verifiable from a named primary source.
- `USER REPORT` — a person said it. One report is one report.
- `INFERENCE` — our reasoning from facts. Plausible, not proven.
- `HYPOTHESIS` — unvalidated. A bet, not a finding.

### 3.1 Evidence

| # | Claim | Label | Source / basis | Freshness |
|---|---|---|---|---|
| E1 | A large share of the working day is spent on "work about work" rather than the work itself. | `FACT` (cited) | Asana Anatomy of Work | Not re-verified this session — **re-verify before citing externally** |
| E2 | Knowledge workers switch between applications over a thousand times per day. | `FACT` (cited) | Harvard Business Review, "How Many Apps Does It Take to Get Your Work Done?" | Not re-verified this session |
| E3 | Manually-managed task completion rates are very low relative to managed ones. | `FACT` (cited) | Asana Anatomy of Work | Not re-verified this session |
| E4 | Self-hosted dashboard projects deliberately omit task management because tasks require manual entry. | `INFERENCE` | Observed in the Glance feature set during competitive review | Reviewed 2026-10 |
| E5 | Manual personal-CRM products plateau in usefulness because value is proportional to typing. | `INFERENCE` | Category structure of Dex/Clay/Monica | Reviewed 2026-10 |
| E6 | People abandon apps that require maintaining a parallel copy of their life. | `INFERENCE` | The retention failure mode is well understood; no primary Panel-specific research exists | — |
| E7 | Privacy is a purchase criterion for a tool that aggregates a person's whole life. | `USER REPORT` (recurring theme across r/selfhosted and personal-finance communities) | Anecdotal, unquantified | Ongoing |
| E8 | Users want AI-free or local-first personal tooling. | `USER REPORT` (recurring theme in self-hosted communities) | Anecdotal, unquantified | Ongoing |
| E9 | A tool that explains *why* it ranked something is trusted more than one that does not. | `PANEL HYPOTHESIS` | Our reasoning from the explainability work; **not validated with users** | — |
| E10 | Users would share a household's dates and documents if the sharing were simple and legible. | `PANEL HYPOTHESIS` | Category-adjacent evidence only; **no Panel-specific validation** | — |

### 3.2 Research gaps — acknowledged, not papered over

There is **no primary research with Panel users**. No user interviews, no
usability testing, no cohort data, no conversion data. Every product belief above
is inherited from adjacent categories or is our own reasoning.

**Implication.** The roadmap is a set of informed bets. Phase 3 (People, Life
Admin, commitments, Finance expansion) should not begin before at least a small
amount of real user contact, because by then the cost of being wrong compounds.

**Minimum research to unblock further investment:**
1. 5–8 interviews with the "overloaded individual" and "self-employed" segments.
2. A clickable prototype of the Attention view (Phase 1.0) tested for
   comprehension — not preference.
3. A diary study of one person's week, to test whether the attention budget
   surfaces things they would genuinely have missed.

### 3.3 Product Hypothesis register

**Durable register of every product belief that is not established fact.**

> **Do not manufacture evidence.** If the evidence column says "none", the
> confidence is `Low` and the status stays `IDEA` or `RESEARCHED`. A hypothesis
> does not become a requirement because it is written down.

**Confidence:** `Low` · `Medium` · `High` — *High means well-evidenced, not
certain; no product hypothesis here is High.*

| ID | Hypothesis | Evidence | Evidence type | Confidence | What would validate it | Status |
|---|---|---|---|---|---|---|
| **PH-001** | People want one place that says "what needs attention", not another inbox | E6 category inference | INFERENCE | Medium | 5–8 interviews; prototype comprehension test | RESEARCHED |
| **PH-002** | Apps requiring a parallel copy of one's life are abandoned | E6 | INFERENCE | Medium | Cohort retention data for any comparable product | RESEARCHED |
| **PH-003** | Glance omits task management *because* tasks require manual entry | E4 (Glance feature set) | OBSERVED | Medium | Interview the Glance maintainer or read the project's stated rationale | RESEARCHED |
| **PH-004** | Personal-CRM tools plateau because value is proportional to typing | E5 (Dex/Clay/Monica) | INFERENCE | Low | Usage-curve data, or a passive-data counter-example | RESEARCHED |
| **PH-005** | Privacy is a purchase criterion for whole-life aggregation | E7 | USER REPORT | Medium | Pricing test that varies a privacy claim | RESEARCHED |
| **PH-006** | Users want AI-free / local-first personal tooling | E8 | USER REPORT | Medium | Same as PH-005 | RESEARCHED |
| **PH-007** | An explainable ranking is trusted more than an opaque one | none — our reasoning from the explainability work | HYPOTHESIS | Low | A/B test of explainable vs. plain ranking in the Attention view | RESEARCHED |
| **PH-008** | Users would share household dates/documents if sharing were simple and legible | E10 | HYPOTHESIS | Low | Usability test of the sharing flow with two real households | RESEARCHED |
| **PH-009** | Retention is driven by number of active connections | none | HYPOTHESIS | Low | Correlate connection count with 4-week retention across real cohorts | RESEARCHED |
| **PH-010** | The single strongest retention driver is believing you *would have missed something* | none | HYPOTHESIS | Low | Measure Weekly Useful Attention against churn | RESEARCHED |
| **PH-011** | The 1-free-connection paywall boundary is viable | none — no pricing research | HYPOTHESIS | Low | Pricing smoke test; cost modelling for heavy users | RESEARCHED (see Q-004) |
| **PH-012** | Self-hosted / privacy communities are the viable acquisition channel | E7, E8 | USER REPORT | Low | Post launch and measure signups by source | RESEARCHED |
| **PH-013** | Deep tax support is a differentiator for the self-employed segment | none | HYPOTHESIS | Low | Interview self-employed users about tax admin specifically | RESEARCHED |
| **PH-014** | Value lives in the *relationships between* life domains, not any single domain | E4, E5 | INFERENCE | Medium | Comparative analysis of tools that span vs. specialise | RESEARCHED |

**Total: 0 hypotheses validated. 0 primary user interviews. 1 FACT-cited study
cluster that has not been re-verified this session (E1–E3).**

This is the honest state of product knowledge. Phase 3 should not begin before
some of it is tested — see §3.2.

---

## 4. Business model

> **Everything in this section is `HYPOTHESIS` unless marked otherwise.** There
> is no revenue, no pricing research, and no willingness-to-pay data. No
> figure here should be treated as validated.

### 4.1 Target customer

Initially **individuals**, not households-as-a-unit and not businesses. The
personal dashboard is the wedge; sharing is the expansion.

### 4.2 Pricing hypotheses

| Tier | Hypothesis | Free/paid boundary |
|---|---|---|
| **Free** | Enough to be genuinely useful alone: capture, attention, limited connections. | Unlimited tasks and areas; **1 connected tool**. The connection limit is the natural paywall because connections are what cost us money to operate. |
| **Pro (individual)** | ~$4–6/month. | Unlimited connections, export, tax engine, advanced agents. |
| **Family** | ~$8–12/month. | Shared spaces, sharing, multiple members. |

### 4.3 Alternatives considered

| Model | Verdict |
|---|---|
| Fully paid from day one | `HYPOTHESIS` — rejected. Free tier is required for consumer trust and for a product whose value is only demonstrable after connection. |
| Freemium on *data volume* | `HYPOTHESIS` — rejected: punishes exactly the engaged user we want. |
| One-off purchase | `HYPOTHESIS` — weak; no ongoing cost, but ongoing maintenance burden. |
| Advertising | Rejected — antithetical to the privacy product promise. |
| Selling aggregated insight | Rejected — destroys the trust premise entirely. |

### 4.4 Monetisation risks

1. **Data-minimalism cuts both ways.** If we do not store data, we cannot sell
   insights. This is an intentional trade, and it constrains revenue options.
2. **Connection pass-through costs.** Calendar is cheap; banking and investment
   data may not be. The 1-connection free tier may not cover a heavy user's cost.
3. **The tax engine is a liability surface, not a revenue line.** High-liability
   functionality invites expectation of professional accuracy that Panel
   deliberately does not provide.
4. **No proven willingness to pay.** The entire model is unvalidated.

### 4.5 Professional access model (hypothesis)

A person grants an accountant scoped, **time-limited** access to a specific area.
Panel charges nothing for this. It is a trust feature, and monetising it would
contradict it.

### 4.6 Moat

Honest assessment: **the moat is weak and that is acceptable.**

| Candidate | Strength |
|---|---|
| The learned per-user model | Real, but it is small, deterministic and could be reproduced by a determined competitor. |
| Cross-domain relationship graph | The most defensible asset — it is expensive to build and compounds with connections. |
| Trust / privacy reputation | Slow to build, slow to lose, hard to copy. Probably the strongest. |
| Data volume | **Not a moat.** We deliberately do not accumulate it. |

### 4.7 Acquisition and retention hypotheses

**Acquisition**
- `HYPOTHESIS` — self-hosted / privacy communities respond to "runs locally, no
  AI API, holds no sensitive data" (E7, E8).
- `HYPOTHESIS` — freelancers respond to deadline + tax positioning.
- `HYPOTHESIS` — demonstration value: the Attention view is the screenshot.

**Retention**
- `HYPOTHESIS` — retention is driven by **connections**, because each connection
  makes the product less ignorable. A user with four connections has far more to
  lose than one with none.
- `HYPOTHESIS` — the single strongest retention driver is the user believing they
  would have missed something. If Panel never earns that, it is a nice app that
  gets closed.

---

## 5. Product roadmap

Status ladder:
`IDEA → RESEARCHED → SPECIFIED → APPROVED → IMPLEMENTING → IMPLEMENTED → VERIFIED → SHIPPED`

### 5.1 Implemented today

| Feature | Status | Evidence |
|---|---|---|
| Natural-language task capture | `IMPLEMENTED` | `src/lib/nlp.ts`, live in Dashboard. **Not verified** — harness deleted (D10). |
| Token-based NLP parser | `IMPLEMENTED` | Same. 20 cases passed once, then the harness was deleted. |
| Online logistic-regression ranker | `IMPLEMENTED` | `src/lib/scorer.ts`. Learned and inverted correctly once, unverified since. |
| Explainable ranking | `IMPLEMENTED` | `explain()`; reasons shown per task. |
| Recurrence parsing | `IMPLEMENTED` | **Parsing only.** Respawn is unimplemented — D5. |
| Tax rules engine, 5 countries | `IMPLEMENTED` | `src/lib/tax.ts`. 34 cases passed once, unverified since. |
| Finance area | `IMPLEMENTED` | `src/components/FinanceArea.tsx`. |
| Life areas | `IMPLEMENTED` | `src/lib/areas.ts`, `src/convex/life.ts`. |
| Integration catalogue | `IMPLEMENTED` | 9 providers, all non-functional (`pending-credentials`). |
| Notes | `IMPLEMENTED` | Unscoped — no area, no tags, no sharing. |
| Auth | `IMPLEMENTED` | Convex Auth, email OTP + guest. Guest path defective — N2. |
| Brutalist minimal design system | `IMPLEMENTED` | `src/index.css`. |

### 5.2 Specified, not started

| Feature | Status | Phase | Notes |
|---|---|---|---|
| Regression test suite | `APPROVED` | 0A | Highest priority. Nothing is currently protected. |
| Recurring task respawn | `APPROVED` | 0A | Broken promise in the UI. |
| Atomic area-scoped task creation | `APPROVED` | 0A | |
| Guest account claim path | `APPROVED` | 0A | Or remove guest sign-in. |
| Ownership / spaces / grants foundation | `APPROVED` | 0B | ADR-009. |
| `links` + `activity` + taxonomy | `APPROVED` | 0B | ADR-008. |
| Model versioning + clamps + rollback | `APPROVED` | 0C | ADR-010, ADR-017. |
| Attention Engine (hard rules) | `APPROVED` | 1.0 | ADR-006. **No learning in this phase.** |
| Learned attention ranking + feedback | `APPROVED` | 1.1 | ADR-004, ADR-005. |
| Integration framework | `APPROVED` | 1.5 | ADR-012, ADR-014. |
| Google Calendar OAuth | `APPROVED` | 2 | ADR-013. Needs credentials. |
| People as first-class objects | `APPROVED` | 3 | Identity resolution, merge-as-tombstone. |
| Multi-object capture | `APPROVED` | 3 | Per-kind confidence thresholds. |
| Life Admin / documents | `APPROVED` | 3 | Expiry → renewal chain. |
| Commitments + Waiting On | `APPROVED` | 3 | |
| Deterministic agents | `APPROVED` | 3 | ADR-011. |
| Finance expansion | `RESEARCHED` | 3 | Accounts, subscriptions. Not specified. |
| Sharing UI | `RESEARCHED` | P2 | Schema in 0B; UI deferred. Requires users. |
| Life Timeline | `RESEARCHED` | P2 | Emerges from `activity`. Not built as a product. |
| Context modes | `IDEA` | P2 | Seam exists; no requirement yet. |
| Custom Pages | `RESEARCHED` | P2 | A saved **view** over typed data, never a saved schema. ADR-033, R-010, SYSTEM_FUNDAMENTALS §3.6. Needs approval: 1 table + 1 surface, outside every phase budget. |

### 5.3 Explicitly out of scope

See `02_CHANGELOG.md` → Rejected Decisions (RJD-001 … RJD-011) and
`04_SYSTEM_FUNDAMENTALS.md` → Non-negotiable architectural rules.

---

## 6. Product metrics

**Optimise for signal, not vanity.** No DAU, no session length, no feature
count. Those metrics reward noise.

### 6.1 North star

> **Weekly Useful Attention** — the number of attention items per week that the
> user acts on (opens the linked object, completes the task, or explicitly
> acknowledges it).

If this does not grow, Panel is decoration.

### 6.2 Metric definitions

| Metric | Definition | Why it matters | Baseline |
|---|---|---|---|
| **Activation** | Connected ≥ 1 tool **and** captured ≥ 1 task **and** viewed Attention ≥ 3 days in the first 7. | The activation event is the whole thesis: connect, capture, and rely on Attention. | **Unknown — no analytics.** |
| **Retention** | % active in week 4 who still have ≥ 1 active connection. | The connection is the anchor. | Unknown |
| **Connected tools per user** | Median active connections. | Direct proxy for "Panel knows more about your life". | Unknown |
| **Weekly Useful Attention** | North star. | Value delivered. | Unknown |
| **Manual entry reduction** | Tasks/expenses created by capture vs by form. | Tests principle P5 directly. | Unknown — **the form path barely exists**, so this starts near 100% and must be watched as forms are added. |
| **False-positive attention rate** | Dismissed items ÷ items shown, per section. | The anti-noise guarantee. High means Panel is a nag. | Unknown |
| **Snooze-to-action rate** | Items later acted on ÷ items snoozed. | Validates ADR-005 empirically. If near zero, snoozing is avoidance, not timing. | Unknown |
| **Agent acceptance rate** | Accepted proposals ÷ proposals shown, per agent. | Kills bad agents before users notice them. | Unknown |
| **Trust / privacy incidents** | Count of: credential leaks, unauthorised access, silent data loss, misleading estimates. | **Any non-zero value is a stop-the-line event.** | 0 today, and it must stay 0. |
| **Data deletion completeness** | Tables covered by `DELETABLE_TABLES` ÷ tables in schema. | Must be 100%. Enforced by a failing test (ADR-019 / SYSTEM_FUNDAMENTALS). | N/A until the manifest exists |

### 6.3 Instrumentation reality

**There is no analytics, no telemetry and no event pipeline in Panel today.**

Several of these metrics are therefore **not currently measurable**. That is
recorded as a known gap rather than papered over. Adding analytics is itself a
phase requiring approval, because "do not fake completion" (MAIN_AGENT E10)
extends to metrics: an approximate metric must be labelled approximate.

The only activity record that exists is implicit — task completion timestamps
from which the 7-day chart is computed. The `activity` table (Phase 0B) is what
makes most of §6.2 measurable at all.

---

## 7. Research register

A durable record inside the specification system, per MAIN_AGENT §14. Each
entry: the question, the sources actually consulted, the evidence, the finding,
a confidence level, the Panel area it touches, the implication, and whether it
is now a decision, a proposal, or nothing.

Research is evidence, not authority (MAIN_AGENT §44). Nothing here changes the
product on its own; an entry becomes a change only through the changelog and,
where it is architectural, an ADR.

### R-001 — Can a "mechanism works" test detect a feature that is never exercised?

- **Date:** 2026-10-01 · **Source:** Panel's own code, `src/convex/assistant.ts`
  and `src/lib/scorer.ts` · **Confidence:** High (reproduced and fixed)
- **Question:** Phase 1.1 appended four scorer features (8–11) and wired a
  roll-up counter for each. Were those counters ever written?
- **Evidence:** `recordOutcome` declared its `task` parameter as
  `{ …, source?: string; person?: string }` and both call sites passed the raw
  database row, whose fields are `origin` and `personId`. Both properties are
  optional, so the code compiled, ran, and returned the counter map unchanged on
  every call. `SOURCE_FIT` and `PEOPLE_FIT` were identically 0 at training and
  at inference, so their weights never received a gradient.
- **Finding:** A test that asserts *the mechanism works* passes forever when
  the mechanism is handed an input that is always empty. Every one of the
  phase-1.1 tests was of that shape. The failure was invisible to unit tests,
  to lint, to types, and to every conformance harness that existed, because all
  of them tested the path rather than the effect.
- **Affected area:** Intelligence — the feature layout, the learning path.
- **Implication:** For any learned or derived value, the assertion has to be on
  the *observable result* — "completing this produces this counter", checked
  against a real deployment — not on the call succeeding. Acceptance criterion 5
  ("`PEOPLE_FIT` reads the person id") was written that way and found it in one
  run. Fixed as D34; `recordOutcome` now takes `TaskFeatures`, so the same class
  of mismatch is a compile error.
- **Status:** **Decision** (ADR-010 unaffected; D34 recorded in CHANGE-0013).

### R-002 — Can a well-formed but non-existent Convex id be produced by a client?

- **Date:** 2026-10-01 · **Source:** Convex 1.42.1 runtime, live deployment
  `little-pelican-326`, `scripts/conformance-3.ts` · **Confidence:** High
  (36 character variants tried, all rejected)
- **Question:** Panel's S3 check wanted to confirm that a refusal for "this id
  is not yours" is indistinguishable from a refusal for "this id does not
  exist". How can a client produce the second case?
- **Evidence:** Every single-character variant of a real, valid id was rejected
  by the argument validator with `ArgumentValidationError` before any handler
  ran. Convex ids carry an integrity check, so the id space is not
  client-constructible.
- **Finding:** The existence-oracle question does not arise at the API surface
  on this platform, because the second case has no inputs. That is strictly
  stronger than indistinguishability, and it means the check can assert a
  property instead of being skipped.
- **Affected area:** Security — authorisation and id handling.
- **Implication:** Had ids been plain strings, `owned()` would be the only
  thing preventing an oracle, and it is correct by construction today (one
  message for both cases). Worth re-asserting if the platform ever changes.
- **Status:** **Finding.** No product change. Harness now asserts the stronger
  property, and will turn to FAIL if a future platform version relaxes it.

### R-003 — Is `people` the right first-class boundary, or should it be contacts?

- **Date:** 2026-10-01 · **Sources:** the roadmap's own RJD-004, the phase-3
  scope block, and the shape of the code that existed · **Confidence:** Medium
- **Question:** Should the first phase-3 feature be a people table, a contacts
  mirror, or a relationships graph?
- **Evidence:** The panel already pretended to have people — `PeopleArea` wrote
  `"catch up with mum every week"` into `tasks.title`. Feature 10 (`PEOPLE_FIT`)
  was already computed from a free-text name. Both are worse than useless: a
  name is not an identifier, so the counters could not be keyed safely, and a
  person stored as a title cannot be linked, merged, or undone.
- **Finding:** The gap was not a missing feature but a **false model**: the
  product claimed a relationship it did not represent. That is a stronger reason
  to build it first than "people is a good starting point", and it is why
  feature 1 had to land before capture, commitments or agents could be trusted —
  each of those wants to point at a person.
- **Affected area:** Product model, data model, intelligence.
- **Implication:** A contacts mirror is a *later* feature and a different one: it
  needs a provider, a sync, and a trust conversation about reading someone's
  address book. Building it first would have meant a person model defined by
  whatever Google returned, which is the opposite of Panel owning context
  (MAIN_AGENT §21).
- **Status:** **Decision** — ADR-023, ADR-024, CHANGE-0013. Contact import is
  explicitly out of scope for feature 1 and recorded as such.

### R-004 — Can a single capture be split into several objects without damaging the user's data?

- **Date:** 2026-10-01 · **Sources:** Todoist's own Quick Add documentation
  (todoist.com/help, read 2026-10-01), Things 3 and Apple Reminders quick-entry
  behaviour, the multi-intent-detection literature (MixATIS / MixSNIPS
  benchmark work), and Panel's own parser · **Confidence:** High for the
  separator decision; Medium for the negative case (no product publishes its
  false-positive rate, which is itself evidence that this is hard)
- **Question:** Capture currently returns exactly one task. Should a single
  input be split on prose conjunctions ("call Raj and email Priya") so the user
  can capture a list in one go?
- **Evidence:**
  1. **Mature products do not do this.** Todoist's Quick Add separates date,
     deadline, label, priority, reminder, assignee and project with *explicit
     symbols* (`%label`, `p1`, `!14:00`, `+Name`, `#Project`). It has shipped
     ~115 features a year and multi-task-from-one-input is reached through
     *text/image/document* capture, not through prose splitting. Things 3 and
     Apple Reminders likewise use explicit structure, not conjunctions.
  2. **The academic framing agrees on the difficulty.** Multi-intent detection
     is a *research* problem in 2024–2025 (MixATIS, MixSNIPS, blended-pattern
     models). It is not a solved parsing step. Doing it deterministically with a
     word list is the least reliable version of it available.
  3. **The failure is asymmetric and the damage is real.** "Call the dentist
     and book the dentist" is one task. "Buy milk and eggs" is one task. "Pick up
     bread and jam from the shop" is one task. A false split silently destroys a
     correct task and invents a second one — the user is not told, because from
     their point of view the capture succeeded.
  4. **Panel already has the right precedent.** The parser consumes tokens with
     a `used` flag and leaves the rest as the title; it never guesses. The
     capture feature inherits that character or betrays it.
- **Finding:** **Explicit structure only.** Newline, semicolon, and the literal
  ` and then ` are separators. A bare `and` never is. The cost is that Panel
  will not auto-split a prose list, which is the right trade: a user who wants
  three tasks types three lines, and a user who typed "and" keeps one task that
  says what they meant.
- **Affected area:** Capture, NLP, data integrity.
- **Implication:** Confidence is measured on the **split**, not on comprehension
  — the parser's closed vocabulary already answers "what is a task", and the new
  uncertainty is only "one thing or several". This keeps the feature inside its
  budget (one abstraction, zero new tables) instead of becoming a
  general extraction engine.
- **Status:** **Decision**, scoped in SYSTEM_FUNDAMENTALS §11.2. The residual
  question — whether a multi-object capture should itself be a learning signal —
  is **Q-006**, open, and non-blocking.

### R-005 — Is the activity taxonomy honest about what is actually written?

- **Date:** 2026-10-01 · **Source:** `src/convex/schema.ts` against every
  `db.insert("activity", …)` site in `src/convex` · **Confidence:** High
  (mechanically verified)
- **Question:** `activityKindValidator` declares a closed taxonomy. Do the
  declared kinds correspond to writes?
- **Evidence:** Declared and never written anywhere: `task.created`,
  `task.deleted`, `note.created`, `expense.added`, `capture.committed`,
  `commitment.made`. `addTask`, `removeTask`, `addNote` and `addExpense` insert
  their object rows and write no activity row at all. The 7-day chart is
  unaffected — it reads only `task.completed`, which *is* written — so nothing
  is visibly broken.
- **Finding:** The taxonomy is a *design intent* that has drifted from the
  writes. It is not a security or integrity defect: no query reads the unwritten
  kinds, and a closed union that is a superset of what is written cannot be
  invalid data. But it is a claim in a specification that the code does not meet,
  and it is precisely the shape of the D34 class — a path that compiles and
  promises an effect that never happens.
- **Affected area:** Audit, activity, the 7-day chart.
- **Implication:** `capture.committed` is the one kind Feature 2 genuinely
  needs, and it must be **written**, not merely declared. The other unwritten
  kinds (`task.created`, `note.created`, `expense.added`) are a separate,
  low-priority honesty task; they are now recorded as D38 rather than left as an
  unexamined gap between spec and code.
- **Status:** **Finding.** `capture.committed` becomes an acceptance criterion
  of Feature 2. The rest is recorded as D38, to be fixed when an activity view
  actually needs them — not by deleting the taxonomy, which is the correct
  design and should stay.

### R-006 — Is an expiry date the deadline? Or is it the deadline minus the time renewal takes?

- **Date:** 2026-10-01 · **Sources:** USAGov "Renew an adult passport" (usa.gov,
  last updated 23 Mar 2026, read 2026-10-01); US Department of State
  "Get Your Processing Time" (travel.state.gov, read 2026-10-01); GOV.UK
  "Renew your driving licence" (gov.uk, read 2026-10-01); Virginia DMV
  licence renewal notice (dmv.virginia.gov, read 2026-10-01); Utah DMV
  registration renewal (dmv.utah.gov, read 2026-10-01) · **Confidence:** High
  (every figure below is from the issuing authority's own page)
- **Question:** The roadmap line is "expiry → renewal chain". The obvious
  implementation is "on the expiry date, tell the user to renew". If that is the
  design, the product is wrong in a way every one of its users will discover.
- **Evidence:**
  1. **The expiry date is not the deadline.** USAGov warns in its own words:
     *"Renew early. Passport processing times vary. And some countries and
     airlines deny entry if your passport expires in less than 6 months."* A
     passport valid for 10 years therefore has a **renewal** deadline roughly
     six months before its **validity** deadline.
  2. **Renewal takes weeks, not minutes.** State Department: routine passport
     processing is 4–6 weeks *plus mailing*, and online renewal is only
     available if the user is not travelling for at least 6 weeks. GOV.UK:
     a renewed driving licence takes up to 3 weeks by post, and longer if a
     medical or personal detail has to be checked.
  3. **Authorities already work in a lead window.** Virginia DMV mails renewal
     reminders **90 days** before a licence expires; Utah allows a vehicle
     registration renewal from **60 days** before expiry. Two different
     jurisdictions, two different numbers, both far from zero.
  4. **The validity period varies per document and per person.** A US passport
     is 10 years, a UK driving licence from age 70 is renewed every **3
     years**, insurance is 1 year. There is no single "renew every N" cadence
     that would be correct — which is why recurrence is the wrong mechanism.
- **Finding:** **Lead time is the load-bearing concept, and it is not a
  constant.** The chain is *expiry → renewal window opens → renew → new expiry*.
  The window cannot be inferred from the expiry date; it has to be something the
  user states per document. That is why `leadDays` is a field on the document
  rather than a global setting, and why Panel must not invent a default that
  claims to be true for every country and every document.
- **Affected area:** Life Admin, Attention, the task model.
- **Implication:** The renewal **task** is due at `expiresAt − leadDays`, and
  that date is computed by the server rather than typed by the user. It also
  kills a tempting shortcut: expressing renewal as a *recurring* task
  (`tasks.recurrence`) would respawn the reminder on a fixed cadence and would
  be wrong for every document whose validity period is not that cadence — and
  it would keep firing from a date that had already been replaced by a renewal.
- **Status:** **Decision**, scoped in SYSTEM_FUNDAMENTALS §11.2 and recorded as
  ADR-025. The residual question — what default lead time, if any, a brand-new
  user should be offered — is deliberately answered *against* a confident
  default; see the scope block.

### R-007 — Should Panel store the document, or only the fact that it exists and when it stops being valid?

- **Date:** 2026-10-01 · **Sources:** House of Commons Library, "Digital ID in
  the UK" (commonslibrary.parliament.uk, CBP-10369, read 2026-10-01); ICO
  "A guide to the data protection principles" — data minimisation and purpose
  limitation (ico.org.uk, read 2026-10-01); European Commission Digital
  Identity Wallet security guidance, which frames data minimisation as a
  *design constraint* (read 2026-10-01); Panel's own ADR-013 · **Confidence:**
  High for the principle; the specific architectures are out of scope and were
  not relied on
- **Question:** "Life Admin / documents" reads like a document manager. The
  roadmap says "expiry → renewal chain". Which of those is it?
- **Evidence:**
  1. **The problem being solved is calendar-shaped, not storage-shaped.** Every
     failure mode in R-006 is *discovering too late that something expired*.
     None of them is "I could not find the PDF".
  2. **Digital-identity programmes converge on the same rule, for the same
     reason.** The Commons Library brief records that reusable digital IDs
     *enable* data minimisation — the credential is presented and shared on
     explicit consent rather than hoarded centrally. The ICO's minimisation
     and purpose-limitation principles are the binding constraint for anything
     Panel does with identity data.
  3. **Panel has already made this call once, and it is the house style.**
     ADR-013 stores a private calendar event as the literal string `"Busy"`:
     *the safest data is the data that was never stored.* An expiry reminder
     needs three facts — what the thing is, when it expires, how early to warn —
     and nothing else. Every additional field (document number, image, scan,
     file reference) is data Panel cannot act on, cannot delete on the user's
     behalf, and would be responsible for.
- **Finding:** **A life-admin document in Panel is metadata about keeping a
  credential valid, not the credential.** No file content, no upload, no storage
  integration, no document numbers. The feature's entire value — noticing an
  expiry before it costs something — needs none of it.
- **Affected area:** Life Admin, privacy (§4), integrations.
- **Implication:** Two consequences worth stating because they are tempting and
  wrong. (a) **No file storage is introduced**, so there is no storage model,
  access-control list, retention policy or export path to get wrong; a missing
  one is safer than a badly-built one. (b) Because the document is metadata,
  its lifecycle must be **derived** rather than stored — a stored status that
  can disagree with the expiry date it summarises is exactly the D34 defect
  class, and this feature has a strong incentive to build one (a natural
  instinct is to add `status: "expired"`).
- **Status:** **Decision**, recorded as ADR-025 and scoped in
  SYSTEM_FUNDAMENTALS §11.2.

### R-008 — What is a commitment that a task is not, and what is waiting-on that a task cannot be?

- **Date:** 2026-10-01 · **Sources:** David Allen's GTD *Waiting For* definition
  as published by Todoist, ClickUp, Facilethings and Zen Habits; the GTD forum's
  practitioner threads on how the list is reviewed; Panel's own task model
  (`src/convex/schema.ts`, `src/lib/nlp.ts`, `src/lib/attention/rules.ts`) ·
  **Confidence:** High for the structural conclusion; Medium for the exact
  attention policy, which is a product judgement
- **Question:** The roadmap line is "Commitments + Waiting On". Panel already
  has tasks, people, a `personId` on every task, an open `waitingOn` attention
  section, and a `commitment` link relation that nothing uses. Does this feature
  need a new table, two, or none?
- **Evidence:**
  1. **GTD keeps "Waiting For" out of the action list, and that is the whole
     point.** Every published definition is the same: Waiting For holds *"items
     that have been delegated or are awaiting action by someone else"*. It is a
     **separate list from Next Actions** precisely because **the user cannot do
     the item**. Panel already has a mechanical consequence for this: `taskRules`
     emits `task.overdue` and `task.imminent` for any open dated task. Model a
     delegation as a task and Panel starts telling someone to do a task they are
     physically unable to do — which is worse than saying nothing, because it
     teaches them to ignore the feed.
  2. **A commitment and a task differ by their counterparty, and only there.**
     "Call Raj" and "I told Raj I'd send the document Friday" both become
     something to do on Friday. The second has a person the user is *obliged*
     to, which `tasks.personId` can already carry. What a task cannot carry is
     that the user has **already spoken for it** — and nothing in the current
     attention or scoring path behaves differently for a promise than for a
     chore.
  3. **"Marked done" has two meanings, and only one is a fact.** For `owed`, the
     user did the thing — Panel knows. For `owedTo`, nobody in the system has
     observed anything; the user is *asserting* that Raj delivered. Panel must
     not restate that as a fact about Raj, and the difference is one the model
     cannot enforce and the wording must.
  4. **The existing affordances are real and empty.** `waitingOn` is an attention
     section with a budget of 3, a 24h half-life and a counterparty grouping
     dimension, and **no rule has ever emitted into it** — the same shape as
     D38. `commitment` is an `objectKind`, a `LinkRel` family (`waitingOn`,
     `owedBy`) and an activity kind, none of which has a producer.
- **Finding:** **One object, two directions.** A commitment is *an expectation
  between the user and one person, with a direction and an optional expected
  date*. `owed` is what the user promised; `owedTo` is what they are waiting
  for. They share a shape, a lifecycle and a surface, and they differ only in
  who holds the next move — which is the single field that changes the meaning
  of "completed", the attention section, and the wording.
- **Affected area:** Relationships area, People, Attention, tasks.
- **Implication:** The decisive architectural argument is the one nobody can
  argue with: **an inbound wait is not a task, so it cannot be stored as one.**
  Everything else follows from that, including why the feature needs its own
  table rather than a `personId` on `tasks`.
- **Status:** **Decision**, ADR-027, scoped in SYSTEM_FUNDAMENTALS §11.2. The
  residual question — whether capture can infer direction from phrasing — is
  **Q-007**, open and non-blocking.

### R-009 — Should Panel nag about something the user cannot do?

- **Date:** 2026-10-01 · **Source:** GTD practitioner consensus on the Waiting
  For list (GTD forum, r/gdt, Zen Habits' GTD FAQ, Facilethings' weekly-review
  guide), read 2026-10-01; Panel's own §5.7 attention budget · **Confidence:**
  High
- **Question:** An inbound wait that has passed its expected date — what should
  Panel do?
- **Evidence:**
  1. **The canonical answer is a weekly review, not a daily reminder.** Across
     the sources the same sentence appears in different words: Waiting For *"is
     a category which gets reviewed at least every week, during the weekly
     review"*. Continuous notification is not the design.
  2. **The failure mode is rot, not nagging.** Every source that discusses
     maintaining the list names the same disease: lists that are not reviewed
     go stale, and a stale system is one the user stops trusting. The weekly
     review itself is described as *"the hardest habit to achieve and the main
     reason why people no longer stay organized"*.
  3. **The date on a waiting item is partly social.** One source puts it
     plainly: the date *"commands attention, and it's a way to get the other
     person moving on the Waiting For item without being pushy"*. So the date is
     the thing the user tells Raj, not a deadline Panel enforces on Raj's
     behalf.
  4. **Panel already has the budget for it.** `waitingOn` caps at 3 with a 24h
     half-life, and the pipeline discloses how many items the caps hid. Overflow
     is never silent.
- **Finding:** **Do not nag, and never demand.** An inbound wait fires
  attention **only after** its expected date has passed — never as it
  approaches — at a low severity, capped by the section's existing budget of 3,
  and its action is **"Follow up"**, which offers to create a task the user can
  actually perform. The feed must never imply the user can resolve the wait
  themselves; the only thing they can do is chase it or let it go.
- **Affected area:** Attention, task creation.
- **Implication:** Following up creates an ordinary `tasks` row carrying
  `personId` **and** `commitmentId`. The commitment is not completed by the
  follow-up — chasing someone is not receiving from them, and conflating the
  two would be a lie about someone else's behaviour.
- **Status:** **Decision**, scoped in SYSTEM_FUNDAMENTALS §11.2.

### R-010 — What should "custom pages" mean for Panel?

- **Question:** Panel has a life-area catalogue, a task area, and a
  placeholder vocabulary value `"custom"` that nothing produces. Should a user be
  able to build their own page — and if so, does it hold their own data?
- **Evidence, from the repository rather than from the market:**
  1. `AreaDef.kind` declares `"custom"` (`src/lib/areas.ts:45`) and **no area
     uses it**.
  2. `areaSlugValidator` is a closed six-value union, `enableArea` calls
     `requireAreaSlug`, and `schema-vocab.test.ts` asserts the union and
     `AREAS` are identical. A user-named area is **not reachable today**, and
     widening the union to `v.string()` would delete the guard that keeps the
     catalogue, the schema and the validators from drifting.
  3. `TasksArea` already tells users *"Home and a custom area both land here"* —
     copy for a surface that cannot exist (D66).
  4. §2.8 classifies Notion/Obsidian as adjacent products, and ADR-001–ADR-007
     are the reasons Panel is not one.
- **Finding:** **A custom page is a saved view, never a saved schema.** Every
  product that means "custom page" by headline means *the user defines the
  fields* — a generic object table, which is ADR-007 verbatim. Panel's version
  composes data it already stores through a closed, versioned block vocabulary:
  headline, task list, people, money, commitments, documents, expenses, note.
  No field can be invented, so there is no per-user schema to migrate or keep
  consistent, and a page cannot introduce a new attention kind (ADR-003,
  ADR-006) because it is a view and not a rule.
- **Affected area:** Areas (new orthogonal axis), Dashboard (new surface),
  schema (one table).
- **Implication:** A page carries `area ∈ AreaSlug` — the existing closed union,
  unchanged — so the vocabulary problem disappears without widening anything.
  The persistence shape (blocks embedded in the page row, versus one row per
  block) is an owner decision; the recommendation and the reasoning are in
  SYSTEM_FUNDAMENTALS §3.6.
- **Status:** **Decision recorded (ADR-033), implementation `NOT STARTED`** —
  one new table and one new surface is outside every declared phase budget and
  requires approval (ADR-016).

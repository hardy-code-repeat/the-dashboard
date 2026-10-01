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

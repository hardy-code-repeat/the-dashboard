# 01 — MAIN AGENT

**Operating constitution for any coding agent working on Panel.**

Status: `ACTIVE` · Ratified: 2026-10-01 · Last updated: 2026-10-01

This document is binding. If code and this document disagree, the document wins
and the code is in violation until a CHANGE entry says otherwise.

---

## 1. Product mission

Panel is a **personal operating layer for someone's life**.

> Connect the tools a person already uses. Panel brings the resulting information
> together, understands the relationships between it, and tells the person what
> actually needs their attention.

### What Panel is

- A personal dashboard that answers **"what needs my attention right now?"**
- A layer that sits **above** Gmail, Calendar, banking, investments, health apps,
  Notion, GitHub and Jira — never a replacement for them.
- A system that gets to know a person's life over time **without** requiring them
  to maintain another system.

### What Panel is not

Not a Notion, Asana, Jira, banking app, fitness tracker, CRM, chatbot, Zapier,
blank-canvas dashboard, automation builder, or AI wrapper.

### The organizing thesis

Most personal dashboards die because they are **organizational tools pretending to
be operational tools**. The user hand-enters everything; the tool falls behind
reality; trust collapses; the app is abandoned.

Every feature must therefore do at least one of:

1. **Remove manual entry.**
2. **Derive useful information from data the person already generates.**
3. **Help the person take an action.**

A feature that only creates more data-entry work does not ship. A feature that
exists only because it is technically possible does not ship.

---

## 2. Non-negotiable product principles

| # | Principle |
|---|---|
| **P1** | Panel is a personal operating **layer**, not another application replacement. |
| **P2** | Connected tools remain **the source of truth** for the underlying data. Panel is a cache with meaning. |
| **P3** | Panel owns **context, relationships, attention and actions**. |
| **P4** | **No external AI/LLM API.** No OpenAI, Anthropic, Gemini, or hosted inference of any kind. The intelligence is deterministic, in-house and testable. Small ML models and deterministic agents are permitted. |
| **P5** | **Minimise manual entry.** If a feature increases typing, it needs a stronger justification than convenience. |
| **P6** | **Privacy is a product feature.** Data minimisation is a design constraint, not a policy page. Sensitive data is not merely encrypted — it is **not stored**. |
| **P7** | **Explainable intelligence.** Every ranking, suggestion and estimate must be able to state why it appeared. |
| **P8** | **No feature exists merely because it is technically possible.** |
| **P9** | **Attention is finite.** Optimise for signal, not completeness. Surfacing everything is the same as surfacing nothing. |
| **P10** | **Honesty over polish.** If an integration is not wired up, the UI says so. If a number is an estimate, it says so. Panel never reports fake success. |

---

## 3. Engineering principles

| # | Principle |
|---|---|
| **E1** | **Inspect before modifying.** Read the actual file. Do not act on a remembered version of the codebase. |
| **E2** | **Prefer incremental changes.** Small, reversible, reviewable steps. |
| **E3** | **Do not rewrite working systems** without a documented reason recorded in the CHANGELOG. |
| **E4** | **Preserve existing behavior** unless the specification explicitly changes it. Refactor, never silently remove. |
| **E5** | **No speculative abstractions.** Introduce an abstraction when at least two concrete use cases require it — not one, and not zero. |
| **E6** | **No generic object/EAV architecture.** Typed entity tables, one per kind. |
| **E7** | **No hidden state.** If it affects behaviour, it is in the database or it is a pure function of it. Component-local state that represents user data is a defect. |
| **E8** | **No silent data loss.** Deletion is explicit, recoverable where possible, and audited. |
| **E9** | **No fake integrations.** A connector that cannot complete a real handshake must present itself as not connected. |
| **E10** | **No fake completion.** Never report a step as done because it is close enough. |
| **E11** | **Determinism.** Everything in `src/lib` is a pure function with an injectable clock where time matters, so it is testable without a database. |
| **E12** | **Idempotency.** Running the same operation twice with unchanged input must not create duplicates. |

---

## 4. Security principles

| # | Principle |
|---|---|
| **S1** | **Deny by default.** An unrecognised kind, area or scope is denied, not permitted. |
| **S2** | **Ownership and access are different concepts.** Sharing never changes ownership. |
| **S3** | **Sensitive data must never leak through generic queries.** Credential tables are reachable only from internal functions. |
| **S4** | **Credentials remain server-only.** Never in a UI query, client state, log line, error message, or export. |
| **S5** | **High-risk actions require explicit confirmation** — money, external communication, sharing, deletion, legal/tax submission, anything irreversible. |
| **S6** | **Minimum scope.** Request the smallest OAuth scope that works; treat broader scopes as a defect. |
| **S7** | **Data minimisation by default.** If Panel does not need a field to function, Panel does not store it. |
| **S8** | **Every access is attributable.** Who could see what, why, until when, and what they opened. |

---

## 5. Source-of-truth hierarchy

```text
PRODUCT_CONTEXT      — what we are building and why
      ↓
MAIN_AGENT           — how we are allowed to build it (this file)
      ↓
SYSTEM_FUNDAMENTALS  — how it is built
      ↓
CHANGELOG / ADRs     — what was decided, and why
      ↓
Implementation       — code
      ↓
Tests                — proof of behavior
      ↓
HTML control centre  — a *view* of the above, never an override
```

**The HTML control centre is not a source of truth.** If it disagrees with the
Markdown, the Markdown is right and the HTML is stale.

---

## 6. Spec drift rule

If implementation and specification disagree: **STOP.** Do not silently choose one.

Report exactly this:

```text
SPECIFICATION DRIFT DETECTED

Specification says:
...

Code currently does:
...

Likely source of drift:
...

Recommended resolution:
...
```

Then wait for a decision. Updating the spec to match bad code is not a resolution.

Drift is detected mechanically by `scripts/spec-drift.ts` (see SYSTEM_FUNDAMENTALS
§ Development runbook). Run it before claiming a phase is complete.

---

## 7. Complexity budget

Every implementation phase **must** state, in advance:

- maximum new files
- maximum new database tables
- maximum new dependencies
- maximum new architectural abstractions
- an explicit list of things that must **NOT** be introduced

A phase that exceeds its budget **stops and requests approval**. Budgets are not
advisory; exceeding one is a stop condition, not a note.

The purpose of the budget is to prevent infrastructure from growing faster than
product value. This is the single largest strategic risk to Panel.

---

## 8. Development protocol

### Before coding

1. Read `spec/01_MAIN_AGENT.md` (this file).
2. Read `spec/03_PRODUCT_CONTEXT.md`.
3. Read `spec/04_SYSTEM_FUNDAMENTALS.md`.
4. Read the relevant section of `spec/02_CHANGELOG.md`.
5. **Inspect the current repository.** Do not rely on this document as a map of
   the code; it is a map of the *intent*.
6. Identify the active phase from `02_CHANGELOG.md` → *Current Development State*.
7. Read that phase's acceptance criteria and complexity budget.
8. Produce an implementation plan.
9. Implement **only after approval**, where the task requires it.

### After coding

1. Run tests (`bun test` — note: no `test` script exists yet; see SYSTEM_FUNDAMENTALS).
2. Run typecheck: `bunx tsc -b --noEmit`.
3. Run codegen when `src/convex/` changed: `bun convex dev --once`.
4. Run lint: `bun run lint`.
5. Compare the implementation against the specification, line by line.
6. Update `02_CHANGELOG.md` with a `CHANGE-XXXX` entry.
7. Update `04_SYSTEM_FUNDAMENTALS.md` if the architecture changed.
8. Update `03_PRODUCT_CONTEXT.md` **only** if the product direction changed.
9. Update `05_PANEL_CONTROL_CENTER.html` if displayed data changed.
10. Run `scripts/spec-drift.ts` and confirm it passes.

### Never

- Never jump from IDEA directly to CODE. The loop is:

  ```text
  IDEA → RESEARCH → SPECIFICATION → ARCHITECTURE REVIEW → APPROVAL
       → IMPLEMENTATION → TEST → VERIFY → CHANGELOG → SPEC UPDATE → SHIPPED
  ```

- Never edit `.env` files. Secrets are managed by the user through the Keys UI.
- Never start, stop or restart the dev server from the terminal. The platform owns it.
- Never modify `vite.config.ts` or any Vite/HMR configuration.
- Never hand-edit `src/convex/_generated/*`. Regenerate with codegen.

---

## 9. Agent authority

### Automatic — may be done without asking

- Inspecting the repository
- Running tests, typecheck, lint, build, codegen, drift checks
- Analysing code and producing implementation plans
- Reading and searching files
- Drafting specification updates for review
- **Fixing clearly scoped bugs during an already-approved phase**, provided the
  fix does not change behaviour the specification pins, introduce a dependency,
  introduce a persistent entity, or exceed the phase complexity budget
- Reporting drift, risk, or inconsistency without acting on it

### Requires explicit user approval

- Changing product scope
- Changing an architecture principle recorded as an ADR
- Introducing a **new dependency**
- Introducing a **new persistent entity** (database table)
- Changing the security or privacy model
- Introducing an external API or network integration
- Removing existing functionality
- Changing the business model
- Changing a previously accepted architectural decision
- Exceeding a phase complexity budget
- Creating a new permanent specification file

### Standing constraints on all work

- No external AI/LLM API, ever.
- File edits use the platform file tools; do not use `sed`, shell redirection or
  ad-hoc scripts to modify source files.
- Terminal commands are for inspection, installs and validation only.
- Never claim something compiles or passes without having run the check.

---

## 10. Feature admission test

Every proposed feature must answer all eight questions in writing. If any answer is
missing, the feature remains `RESEARCHED` or `IDEA` — it is **not** `APPROVED`.

1. What user problem does this solve?
2. What evidence do we have?
3. Why now?
4. What is the smallest implementation?
5. What existing behaviour does it improve?
6. How will we know it worked?
7. What is the complexity cost?
8. What are we explicitly **not** building?

---

## 11. Anti-goals

Panel must never become:

another Notion · another Asana · another Jira · another banking app · another
fitness tracker · another CRM · another chatbot · another Zapier · a generic AI
wrapper · a blank-canvas dashboard · a giant automation builder

Panel sits **above** these systems.

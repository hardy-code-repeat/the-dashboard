/**
 * The Admin Control Centre (ADR-032, CHANGE-0027).
 *
 * An internal engineering console, deliberately **not** another user Area. The
 * differences are the point and they are visible on the page:
 *
 *  - It is dense. Status tables, not cards with generous padding. An operator
 *    scanning for what is broken should see everything at once.
 *  - It has **no action buttons**. Not "destructive ones are hidden" — there are
 *    none. Every control on this page is a disclosure (`<details>`) or a link to
 *    documentation. A control centre that could change something would be an
 *    admin tool, and this is a status report.
 *
 *    The distinction from ADR-032 §4 is precise and worth keeping: the module
 *    behind the five sections (`admin.ts`) still exports no mutation **and no
 *    action**. The Neon row added by CHANGE-0039 is the one exception on the
 *    page, and it is an observation rather than a control — `neonHealth` runs
 *    `SELECT 1` against an external database, writes nothing anywhere, and is
 *    invoked automatically rather than by a button. It is called out separately
 *    below because "no write endpoint exists" must never mean "no code runs".
 *  - It renders three visibly different kinds of statement, and never blends
 *    them. **Observed** is a measurement. **Declared** is configuration that
 *    exists in source and says nothing about execution. **Not observable** is
 *    the honest answer when the backend genuinely cannot know. The single
 *    worst failure mode for a page like this is a green tick that means
 *    "configured", and the page is built so that distinction is structural
 *    rather than a matter of care.
 *
 * ## Access
 *
 * Authorisation is entirely server-side. This page holds no `isAdmin` flag, and
 * `RequireAuth` here is a *convenience* — it keeps anonymous visitors from
 * landing on a refusal screen, not a control. The refusal below is rendered
 * from a thrown query error, which is what the backend returns to any caller
 * that is not an admin, including a signed-in one. Hiding the route would change
 * nothing about what a caller can read.
 *
 * Until an operator sets `users.role` (D64), this page is expected to render
 * the refusal panel for everyone. That is the correct behaviour, and it is
 * labelled as such rather than being an empty console.
 *
 * ## The Neon section is not counted in the refusal tally
 *
 * `neonHealth` is an action, not one of the five queries, so its failure is
 * rendered in its own section rather than folded into the "N of 5 sections
 * refused independently" count. Counting it would misreport what happened: the
 * five queries either authorised or did not, whereas the Neon action can fail
 * for an unrelated reason — an unreachable database, an unset credential — and
 * conflating the two would turn a database outage into a claim about access.
 */

import { useQuery_experimental, useAction, type UseQueryResult } from "convex/react";
import { useEffect, useState } from "react";

import type { BindingDisclosure } from "../lib/infrastructureBindings";

/** One query's state, whatever its payload type. */
type AnyQuery = UseQueryResult<unknown>;
import { Link } from "react-router";

import { api } from "../convex/_generated/api";
import { adminDenialMessage } from "../lib/adminFindings";
import { READ_LIMITS } from "../lib/readLimits";
import {
  composeOverview,
  type OverviewSection as OverviewSectionData,
  type Verdict,
} from "../lib/operatorOverview";

/* ------------------------------------------------------------------ atoms */

type Tone = "ok" | "warn" | "bad" | "unknown";

const TONE_CLASS: Record<Tone, string> = {
  ok: "bg-primary",
  warn: "bg-secondary text-secondary-foreground",
  bad: "bg-destructive text-white",
  unknown: "bg-muted text-foreground",
};

const TONE_WORD: Record<Tone, string> = {
  ok: "OK",
  warn: "ATTENTION",
  bad: "BLOCKED",
  unknown: "NOT OBSERVABLE",
};

/**
 * A status chip.
 *
 * `unknown` is a first-class tone rather than a dimmed `ok`, because the whole
 * page depends on "we cannot see this" reading as different from "this is
 * fine". The label is text, not only a colour, so it survives greyscale and a
 * screen reader.
 */
function Chip({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return (
    <span
      className={`inline-block border-2 border-foreground px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider ${TONE_CLASS[tone]}`}
    >
      {children ?? TONE_WORD[tone]}
    </span>
  );
}

function Section({
  id,
  title,
  source,
  children,
}: {
  id: string;
  title: string;
  source: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="border-2 border-foreground bg-card">
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b-2 border-foreground bg-foreground px-3 py-2 text-card">
        <h2 className="font-display text-sm uppercase tracking-wide">{title}</h2>
        <span className="font-mono text-[10px] text-muted opacity-80">{source}</span>
      </header>
      <div className="p-3">{children}</div>
    </section>
  );
}

/** A key/value row. Dense by design — this is a table, not a card. */
function Row({ k, v, tone }: { k: string; v: React.ReactNode; tone?: Tone }) {
  return (
    <tr className="border-b border-border/60 last:border-0">
      <th scope="row" className="w-56 py-1 pr-3 text-left align-top font-mono text-[11px] font-normal text-muted-foreground">
        {k}
      </th>
      <td className="py-1 align-top text-[13px]">{tone ? <Chip tone={tone}>{v}</Chip> : v}</td>
    </tr>
  );
}

function Table({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <table className="w-full border-collapse text-[12px]">
      <thead>
        <tr className="border-b-2 border-foreground">
          {head.map((h) => (
            <th key={h} scope="col" className="py-1 pr-3 text-left font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  );
}

/* ------------------------------------------------------------- data views */

/**
 * Infrastructure bindings (ADR-034, CHANGE-0040).
 *
 * Shows provider, purpose, state, last check and failure category — and
 * deliberately **not** the environment variable's name. The name is not in the
 * payload the server sends, so this component cannot display it even by
 * accident; that is the rule from ADR-034 made structural rather than a matter
 * of what this file chooses to render.
 *
 * `last check` is per binding and honest about its own absence. Only Neon has a
 * probe that exists today, and for every other provider the cell says so in
 * words rather than showing a dash that could be mistaken for a passing check.
 */
function InfrastructureBindingsSection({
  bindings,
  neon,
}: {
  bindings: readonly BindingDisclosure[];
  neon: NeonView;
}) {
  /** The last-check cell for one binding, given whatever the probe reported. */
  function lastCheck(binding: BindingDisclosure): string {
    if (binding.provider !== "neon") return "no health check exists";
    if (neon.status === "pending") return "probing…";
    if (neon.status === "success" && neon.data.state === "ok") {
      return neon.data.latencyMs === null ? "just now" : `just now (${neon.data.latencyMs}ms)`;
    }
    if (neon.status === "success") return "just now";
    // Refused or the action failed: the probe produced no measurement, and
    // saying "not observed" is more honest than carrying the configured state
    // forward as though the credential had just been checked.
    return "not observed";
  }

  /** The failure cell: a coarse category, or an explicit absence. */
  function failure(binding: BindingDisclosure): string {
    if (binding.provider !== "neon" || neon.status !== "success") return "—";
    if (neon.data.state === "ok" || neon.data.state === "unconfigured") return "—";
    return neon.data.classification;
  }

  return (
    <Section id="bindings" title="Infrastructure bindings" source="src/lib/infrastructureBindings.ts">
      <Table head={["Provider", "Purpose", "State", "Last check", "Failure"]}>
        {bindings.map((b) => (
          <tr key={`${b.provider}:${b.purpose}:${b.state}`} className="border-b border-border/60">
            <td className="py-1 pr-3 font-mono text-[11px]">{b.provider}</td>
            <td className="py-1 pr-3 text-[11px]">{b.purpose}</td>
            <td className="py-1 pr-3">
              <Chip tone={configTone(b.state)}>{b.state}</Chip>
            </td>
            <td className="py-1 pr-3 text-[11px] text-muted-foreground">{lastCheck(b)}</td>
            <td className="py-1 font-mono text-[11px] text-muted-foreground">{failure(b)}</td>
          </tr>
        ))}
      </Table>

      <p className="mt-2 text-[11px] text-muted-foreground">
        Configuration state is read from deployment environment variables, so it describes{" "}
        <strong>this deployment</strong> only — a variable set on one deployment has no effect on another. No secret
        value, length, prefix or variable name is returned to this page or displayed by it.
      </p>

      {neon.status === "success" && neon.data.state !== "unconfigured" ? (
        <details className="mt-2">
          <summary className="cursor-pointer font-mono text-[11px] uppercase tracking-wider">
            Neon check detail
          </summary>
          <p className="mt-1 text-[12px]">{neon.data.summary}</p>
          <Row k="Statement" v={<code className="font-mono">{neon.data.probeQuery}</code>} />
          <Row k="Project" v={neon.data.project ?? "unknown"} />
        </details>
      ) : null}

      {neon.status === "refused" || neon.status === "failed" ? (
        <p className="mt-2 font-mono text-[11px] text-muted-foreground">
          The Neon check did not run, so its row shows no observation. That is not counted in the refusal tally
          above: the five queries either authorised or did not.
        </p>
      ) : null}

      <p className="mt-2 font-mono text-[11px] text-muted-foreground">
        Phase 1 is read-only (ADR-034). There is no create, rotate or revoke control here, and Panel holds no
        credential that could modify its own secret configuration.
      </p>
    </Section>
  );
}

/**
 * The payload types, taken from the generated reference's own return type.
 *
 * `api.admin.systemStatus` is a `FunctionReference`, not a function, so
 * `ReturnType<typeof …>` does not apply to it — which is why an earlier draft of
 * this file inferred `any` everywhere and lost the ability to check the error
 * branch at all. `Fn["_returnType"]` is the property Convex actually hangs the
 * payload on, so the types below are the real ones.
 */
type SystemStatus = (typeof api.admin.systemStatus)["_returnType"];
type AgentHealth = (typeof api.admin.agentHealth)["_returnType"];
type IntegrationHealth = (typeof api.admin.integrationHealth)["_returnType"];
type DataModel = (typeof api.admin.dataModel)["_returnType"];
type SecurityPosture = (typeof api.admin.securityPosture)["_returnType"];
type NeonHealth = (typeof api.neon.neonHealth)["_returnType"];

/**
 * The Neon section's own local state.
 *
 * `useQuery_experimental` is deliberately **not** used here: an action has no
 * reactive query to subscribe to, and this probe is a one-shot observation, not
 * a live subscription. Modelling it as one would have meant a `useQuery` shape
 * with no query in it.
 */
type NeonView =
  | { status: "pending" }
  | { status: "success"; data: NeonHealth }
  | { status: "failed" }
  | { status: "refused" };

function ago(ts: number | null): string {
  if (ts === null) return "never";
  const mins = Math.round((Date.now() - ts) / 60000);
  if (mins < 60) return `${mins}m ago`;
  if (mins < 60 * 48) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
}

/** Configuration state → tone. `requires-rotation` is a distinct, louder state. */
function configTone(state: string): Tone {
  if (state === "configured") return "ok";
  if (state === "missing") return "warn";
  if (state === "requires-rotation") return "bad";
  return "unknown";
}

/**
 * The overview roll-up — the first thing on the page, and the answer to
 * "is Panel healthy?" in one screen.
 *
 * Composed client-side from the five server-side payloads by the pure module
 * in `src/lib/operatorOverview.ts`, so the honesty rules (a missing input is
 * never a pass; sampled data says so; the verdict is worst-of, never an
 * average) are unit-tested rather than a matter of JSX care. Nothing here is
 * computed from client state, and no verdict can exist without a payload a
 * server query produced for *this* authorised caller.
 */
function OverviewSectionView({
  overview,
}: {
  overview: { verdict: Verdict; sections: OverviewSectionData[] };
}) {
  const banner =
    overview.verdict === "ok"
      ? { tone: "ok" as Tone, text: "Panel looks healthy across every observable section." }
      : overview.verdict === "warn"
        ? { tone: "warn" as Tone, text: "Something needs attention — the sections below say what." }
        : overview.verdict === "bad"
          ? { tone: "bad" as Tone, text: "A section is in a bad state. Open it below." }
          : {
              tone: "unknown" as Tone,
              text: "Not enough was observed to call Panel healthy. Each section says what is missing.",
            };

  return (
    <Section
      id="overview"
      title="Overview"
      source="composed from the sections below — no client-side verdict"
    >
      <p className="mb-3 flex flex-wrap items-center gap-2 border-2 border-foreground bg-muted px-2 py-1.5 text-[12px]">
        <Chip tone={banner.tone}>{overview.verdict}</Chip>
        <span>{banner.text}</span>
      </p>
      <div className="grid gap-2 md:grid-cols-2">
        {overview.sections.map((s) => (
          <div key={s.id} className="border-2 border-border px-2 py-1.5">
            <div className="flex items-center gap-2">
              <Chip tone={s.verdict}>{s.verdict}</Chip>
              <span className="font-mono text-[11px] uppercase tracking-wider">{s.label}</span>
            </div>
            <p className="mt-1 text-[12px]">{s.summary}</p>
            {s.detail ? (
              <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">{s.detail}</p>
            ) : null}
          </div>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        Every figure was produced by a server-side query that authorised this caller. The verdict is
        worst-of, never an average: one bad section cannot be hidden by green ones, and a section
        that could not be observed says so rather than passing silently.
      </p>
    </Section>
  );
}

function SystemStatusSection({ data }: { data: SystemStatus }) {
  return (
    <Section id="system" title="System" source="compile-time constants + configuration state">
      <table className="w-full border-collapse text-[13px]">
        <tbody>
          <Row k="Schema validation" v="ON" tone="ok" />
          <Row k="Area catalogue" v={`${data.areaCatalogue} areas`} />
          <Row k="Provider catalogue" v={`${data.providerCatalogue} providers · ${data.adapters} adapters`} />
          <Row
            k="Agent policy"
            v={`${data.agentPolicy.maxExecutionsPerRun} executions per run · ${data.agentPolicy.maxExecutionsPerSpacePerDay} per space per day`}
          />
          <Row
            k="Cron schedule"
            v={
              <span className="flex flex-wrap items-center gap-2">
                <Chip tone="unknown">declared, not verified</Chip>
                <span className="font-mono text-[11px]">
                  {data.cron.path} · {data.cron.schedule} {data.cron.timezone}
                </span>
              </span>
            }
          />
        </tbody>
      </table>

      <h3 className="mt-4 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        Product, as built
      </h3>
      <p className="mb-2 mt-1 text-[11px] text-muted-foreground">{data.product.lifecycleNote}</p>
      <table className="w-full border-collapse text-[13px]">
        <tbody>
          <Row
            k="Registered agents"
            v={
              data.product.registeredAgents.length === 0
                ? "none"
                : data.product.registeredAgents.map((a) => a.name).join(", ")
            }
          />
          <Row k="Attention rule kinds" v={`${data.product.hardAttentionKinds} hard kinds (never personalised)`} />
          <Row k="Custom pages cap" v={`${data.product.customPagesCap} per user`} />
          <Row k="Feature flags" v={data.product.featureFlags.join(", ")} />
        </tbody>
      </table>
      <p className="mt-1 text-[11px] text-muted-foreground">{data.product.agentTierPolicy}</p>

      <h3 className="mt-4 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        Diagnostics
      </h3>
      <p className="mb-2 mt-1 text-[11px] text-muted-foreground">
        Structural metadata about this deployment's own read surface. No environment variables, no
        stack traces, no request data.
      </p>
      <table className="w-full border-collapse text-[13px]">
        <tbody>
          <Row
            k="Index allowlist"
            v={`${data.diagnostics.indexAllowlist.tables} tables · ${data.diagnostics.indexAllowlist.pairs} index pairs`}
          />
          <Row k="Read-limit registry" v={`${data.diagnostics.readLimitRegistry} caps in force`} />
          <Row k="Node runtime" v={data.diagnostics.nodeRuntime} />
        </tbody>
      </table>

      <h3 className="mt-4 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Configuration</h3>
      <p className="mb-2 mt-1 text-[11px] text-muted-foreground">
        State only. This surface can read whether a variable is present and
        nothing else — no value, length or prefix.
      </p>
      <Table head={["Variable", "State", "What it affects"]}>
        {data.configuration.map((c) => (
          <tr key={c.name} className="border-b border-border/60 last:border-0 align-top">
            <td className="py-1 pr-3 font-mono text-[11px]">{c.name}</td>
            <td className="py-1 pr-3">
              <Chip tone={configTone(c.state)}>{c.state}</Chip>
            </td>
            <td className="py-1 text-[12px] text-muted-foreground">{c.note}</td>
          </tr>
        ))}
      </Table>

      <h3 className="mt-4 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Not observable from here</h3>
      <ul className="mt-1 space-y-1">
        {data.notObservable.map((n) => (
          <li key={n} className="flex gap-2 text-[12px]">
            <Chip tone="unknown">n/a</Chip>
            <span className="text-muted-foreground">{n}</span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function AgentHealthSection({ data }: { data: AgentHealth }) {
  return (
    <Section id="agents" title="Agents &amp; cron" source="observed from agentRuns · bounded sample">
      <p className="mb-3 border-2 border-foreground bg-muted px-2 py-1.5 text-[11px]">
        <b>Read the two halves separately.</b> A run row proves the{" "}
        <i>runner</i> executed. It does not prove the <i>schedule</i> fired —
        <code className="mx-1 font-mono">runMyAgentsNow</code> writes the same rows.
      </p>
      <table className="w-full border-collapse text-[13px]">
        <tbody>
          <Row k="Cron firing" v={data.cronFiring} tone="unknown" />
          <Row k="Runs observed" v={`${data.runsObserved}${data.sampled ? "+" : ""}`} />
          <Row k="Oldest run in window" v={ago(data.oldestRunInWindow)} />
          <Row
            k="Outcomes"
            v={
              <span className="flex flex-wrap gap-2">
                <Chip tone={data.failuresObserved > 0 ? "bad" : "ok"}>{data.failuresObserved} failed</Chip>
                <Chip tone={data.cappedObserved > 0 ? "warn" : "ok"}>{data.cappedObserved} capped</Chip>
                <Chip tone={data.overflowObserved > 0 ? "warn" : "ok"}>{data.overflowObserved} overflow</Chip>
              </span>
            }
          />
          <Row k="Executions observed" v={String(data.executionsObserved)} />
          <Row
            k="Registered agents"
            v={
              data.registry.length === 0
                ? "none in source"
                : data.registry.map((a) => a.name).join(", ")
            }
          />
          <Row
            k="Enrollment"
            v={`${data.enrollment.optedIn}/${data.enrollment.of} spaces opted in${
              data.enrollment.sampled ? " (sampled)" : ""
            }`}
          />
          <Row
            k="Proposals in window"
            v={
              data.proposals.byStatus.length === 0 ? (
                <span className="text-muted-foreground">none observed</span>
              ) : (
                <span className="flex flex-wrap gap-2">
                  {data.proposals.byStatus.map((s) => (
                    <Chip key={s.status} tone="unknown">
                      {s.count} {s.status}
                    </Chip>
                  ))}
                </span>
              )
            }
          />
          <Row
            k="Coverage"
            v={
              data.sampled ? (
                <Chip tone="warn">sampled — {data.spacesSampled} spaces, index order</Chip>
              ) : (
                <span className="flex items-center gap-2">
                  <Chip tone="ok">complete</Chip>
                  <span className="text-[12px] text-muted-foreground">{data.spacesSampled} spaces, up to {data.perSpaceCap} runs each</span>
                </span>
              )
            }
          />
        </tbody>
      </table>
      <p className="mt-2 text-[11px] text-muted-foreground">{data.cronFiringReason}</p>
    </Section>
  );
}

function IntegrationHealthSection({ data }: { data: IntegrationHealth }) {
  return (
    <Section id="integrations" title="Integrations" source="observed from connections · bounded sample">
      {data.providers.length === 0 ? (
        <p className="text-[12px] text-muted-foreground">No providers in the catalogue.</p>
      ) : (
        <Table head={["Provider", "Connections", "Credential present", "Stale", "Failing", "Last sync"]}>
          {data.providers.map((p) => (
            <tr key={p.provider} className="border-b border-border/60 last:border-0">
              <td className="py-1 pr-3 font-mono text-[11px]">{p.provider}</td>
              <td className="py-1 pr-3">{p.connections}</td>
              <td className="py-1 pr-3">
                {p.connections === 0 ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  <Chip tone={p.withCredential === p.connections ? "ok" : "warn"}>
                    {p.withCredential}/{p.connections}
                  </Chip>
                )}
              </td>
              <td className="py-1 pr-3">
                {p.stale > 0 ? <Chip tone="warn">{p.stale}</Chip> : <span className="text-muted-foreground">0</span>}
              </td>
              <td className="py-1 pr-3">
                {p.failing > 0 ? <Chip tone="bad">{p.failing}</Chip> : <span className="text-muted-foreground">0</span>}
              </td>
              <td className="py-1 text-muted-foreground">{ago(p.lastSyncAt)}</td>
            </tr>
          ))}
        </Table>
      )}
      <p className="mt-3 border-2 border-foreground bg-muted px-2 py-1.5 text-[11px]">{data.disclosure}</p>
      <p className="mt-1 text-[11px] text-muted-foreground">
        Coverage: {data.sampled ? "sampled" : "complete"} — {data.spacesSampled} spaces. Stale means no
        successful sync for {Math.round(data.staleAfterMs / 3600000)}h.
      </p>
    </Section>
  );
}

function DataModelSection({ data }: { data: DataModel }) {
  const used = data.tables.filter((t) => t.rows > 0);
  const empty = data.tables.filter((t) => t.rows === 0);
  return (
    <Section id="data-model" title="Data model" source={`bounded sample of ${data.sample} rows per table`}>
      <p className="mb-3 border-2 border-foreground bg-muted px-2 py-1.5 text-[11px]">
        {data.disclosure} A <code className="font-mono">+</code> means the table holds more than the sample.
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <h3 className="mb-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            In use ({used.length})
          </h3>
          {used.length === 0 ? (
            <p className="text-[12px] text-muted-foreground">No rows in any surveyed table.</p>
          ) : (
            <Table head={["Table", "Rows"]}>
              {used.map((t) => (
                <tr key={t.table} className="border-b border-border/60 last:border-0">
                  <td className="py-1 pr-3 font-mono text-[11px]">{t.table}</td>
                  <td className="py-1">
                    {t.rows}
                    {t.saturated ? "+" : ""}
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </div>
        <div>
          <h3 className="mb-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Empty ({empty.length})
          </h3>
          <p className="mb-2 text-[11px] text-muted-foreground">
            A table with no rows is normal pre-launch. It is listed so a missing feature is visible rather than
            inferred from its absence.
          </p>
          <p className="font-mono text-[11px] leading-5 text-muted-foreground">
            {empty.length === 0 ? "none" : empty.map((t) => t.table).join(", ")}
          </p>

          <h3 className="mt-4 mb-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Not read
          </h3>
          {data.notRead.map((t) => (
            <p key={t.table} className="mb-1 text-[11px]">
              <span className="font-mono">{t.table}</span>{" "}
              <span className="text-muted-foreground">— {t.why}</span>
            </p>
          ))}
        </div>
      </div>
    </Section>
  );
}

function SecuritySection({ data }: { data: SecurityPosture }) {
  const toneFor = (s: string): Tone => (s === "open-human" ? "bad" : s === "verified" ? "ok" : "warn");
  return (
    <Section id="security" title="Security posture" source="recorded findings · spec/02_CHANGELOG.md is authoritative">
      <h3 className="mb-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Open findings</h3>
      <div className="space-y-2">
        {data.findings.map((f) => (
          <details key={f.id} className="border-2 border-foreground">
            <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-2 py-1.5">
              <span className="font-mono text-[11px] font-bold">{f.id}</span>
              <span className="flex-1 text-[12px]">{f.title}</span>
              <Chip tone={toneFor(f.state)}>{f.state}</Chip>
              <Chip tone={f.owner === "owner" ? "warn" : "unknown"}>owner: {f.owner}</Chip>
            </summary>
            <div className="border-t-2 border-foreground px-2 py-1.5">
              <p className="text-[12px]">{f.detail}</p>
              {f.evidence ? (
                <p className="mt-1 font-mono text-[10px] text-muted-foreground">evidence: {f.evidence}</p>
              ) : null}
            </div>
          </details>
        ))}
      </div>

      <h3 className="mt-4 mb-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        Verification gaps — not defects, and not passes
      </h3>
      <div className="space-y-2">
        {data.verificationGaps.map((g) => (
          <details key={g.id} className="border-2 border-border">
            <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-2 py-1.5">
              <span className="font-mono text-[11px]">{g.id}</span>
              <span className="flex-1 text-[12px]">{g.title}</span>
              <Chip tone="unknown">unverified</Chip>
            </summary>
            <div className="border-t border-border px-2 py-1.5">
              <p className="text-[12px] text-muted-foreground">{g.detail}</p>
              {g.evidence ? (
                <p className="mt-1 font-mono text-[10px] text-muted-foreground">evidence: {g.evidence}</p>
              ) : null}
            </div>
          </details>
        ))}
      </div>

      <h3 className="mt-4 mb-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        What this surface does not collect
      </h3>
      <ul className="space-y-1">
        {data.notCollected.map((n) => (
          <li key={n} className="flex gap-2 text-[12px] text-muted-foreground">
            <span aria-hidden className="text-foreground">
              ×
            </span>
            {n}
          </li>
        ))}
      </ul>
    </Section>
  );
}

/**
 * What this console is, and — more importantly — what it deliberately is not.
 *
 * Rendered on the page rather than left to the README, because the single most
 * dangerous drift for an internal console is an operator assuming a control
 * exists. Every row here is a capability someone reasonable has asked for, and
 * every "not built" is a decision with an address (ADR-032, ADR-034, D56, D64).
 */
function ScopeSection() {
  return (
    <Section id="scope" title="Scope & unavailable controls" source="ADR-032 · ADR-034 · D56 · D64">
      <p className="mb-3 border-2 border-foreground bg-muted px-2 py-1.5 text-[12px]">
        <b>This console is read-only, structurally.</b> The backend module exports no mutation and no
        action, and a drift gate fails the build if one appears. Nothing on this page changes
        anything — not even for the admin.
      </p>
      <Table head={["Capability", "State", "Why"]}>
        <tr className="border-b border-border/60 align-top">
          <td className="py-1 pr-3 text-[12px]">Observability (this page)</td>
          <td className="py-1 pr-3">
            <Chip tone="ok">implemented</Chip>
          </td>
          <td className="py-1 text-[11px] text-muted-foreground">
            Five independently authorised queries plus the one-shot Neon probe.
          </td>
        </tr>
        <tr className="border-b border-border/60 align-top">
          <td className="py-1 pr-3 text-[12px]">User directory (names, emails)</td>
          <td className="py-1 pr-3">
            <Chip tone="unknown">not collected</Chip>
          </td>
          <td className="py-1 text-[11px] text-muted-foreground">
            ADR-032: the users table is not read beyond the authorisation check. A console that
            enumerates accounts is the first step toward the user management this module must not
            become. Adding it requires an ADR amendment, not a query.
          </td>
        </tr>
        <tr className="border-b border-border/60 align-top">
          <td className="py-1 pr-3 text-[12px]">Role management (grant / revoke admin)</td>
          <td className="py-1 pr-3">
            <Chip tone="unknown">not built</Chip>
          </td>
          <td className="py-1 text-[11px] text-muted-foreground">
            No code path in Panel can write <code className="font-mono">users.role</code> (ADR-032
            §4, D64). The only bootstrap is the Convex dashboard, out of band.
          </td>
        </tr>
        <tr className="border-b border-border/60 align-top">
          <td className="py-1 pr-3 text-[12px]">Pause / resume an agent</td>
          <td className="py-1 pr-3">
            <Chip tone="unknown">requires future ADR</Chip>
          </td>
          <td className="py-1 text-[11px] text-muted-foreground">
            No agent pause state exists in the schema. Adding one means a new write path and a new
            architectural decision (ADR-016), not a button.
          </td>
        </tr>
        <tr className="border-b border-border/60 align-top">
          <td className="py-1 pr-3 text-[12px]">Acknowledge a finding</td>
          <td className="py-1 pr-3">
            <Chip tone="unknown">not built</Chip>
          </td>
          <td className="py-1 text-[11px] text-muted-foreground">
            Findings are a checked-in registry cross-checked against spec/02_CHANGELOG.md by
            spec-drift. A runtime acknowledgement would fork that record rather than update it.
          </td>
        </tr>
        <tr className="border-b border-border/60 align-top">
          <td className="py-1 pr-3 text-[12px]">Delete users or data · transfer ownership</td>
          <td className="py-1 pr-3">
            <Chip tone="unknown">out of scope</Chip>
          </td>
          <td className="py-1 text-[11px] text-muted-foreground">
            Tier 2 operations. Not implemented and not proposed without an explicit ADR — D56
            records that deletion semantics are an undecided product question.
          </td>
        </tr>
        <tr className="align-top">
          <td className="py-1 pr-3 text-[12px]">Credential or infrastructure changes</td>
          <td className="py-1 pr-3">
            <Chip tone="bad">rejected by ADR-034</Chip>
          </td>
          <td className="py-1 text-[11px] text-muted-foreground">
            Panel must never hold a credential that can modify its own secret configuration.
            Metadata and health checks only — there is no create, rotate or revoke path anywhere
            in the product.
          </td>
        </tr>
      </Table>
      <p className="mt-2 text-[11px] text-muted-foreground">
        The console stays inside the observability scope ADR-032 approved. Anything marked
        "requires future ADR" is a documented candidate, not a promise.
      </p>
    </Section>
  );
}

/* ------------------------------------------------------------------ shell */

function Refused({ reason }: { reason: string }) {
  return (
    <div className="border-2 border-foreground bg-card p-4">
      <h2 className="font-display text-lg uppercase tracking-wide">Access refused</h2>
      <p className="mt-2 text-[13px]">{reason}</p>
      <p className="mt-3 max-w-prose text-[12px] text-muted-foreground">
        This is enforced in the backend, on every query, before any data is read — not by this page and not by
        hiding a link. Signing in as a different account will not help, and neither will calling the queries
        directly.
      </p>
      <details className="mt-4 border-2 border-foreground">
        <summary className="cursor-pointer px-2 py-1.5 font-mono text-[11px] uppercase tracking-wider">
          If you are the operator
        </summary>
        <div className="border-t-2 border-foreground px-2 py-2 text-[12px]">
          <p>
            The role is <code className="font-mono">users.role = &quot;admin&quot;</code>, and no code path in
            Panel can write it. That is deliberate (ADR-032) — a client-reachable grant would be a
            privilege-escalation path.
          </p>
          <p className="mt-2">To grant it to yourself, out of band:</p>
          <ol className="mt-1 list-decimal space-y-1 pl-5">
            <li>Sign in, so your user document exists.</li>
            <li>
              In the Convex dashboard, open the <code className="font-mono">users</code> table, find your row,
              set <code className="font-mono">role</code> to <code className="font-mono">admin</code>.
            </li>
            <li>Reload this page. The schema rejects any other value at write time.</li>
          </ol>
          <p className="mt-2 text-muted-foreground">Recorded as D64.</p>
        </div>
      </details>
    </div>
  );
}

export default function AdminControlCenter() {
  // `useQuery_experimental` rather than `useQuery` because the refusal has to
  // be *rendered*, not thrown. `useQuery` returns data-or-undefined and surfaces
  // an error through the nearest error boundary, which would show the app's
  // generic "Preview runtime error" screen — technically a refusal, but it tells
  // the operator nothing and looks like a crash rather than a policy decision.
  // The discriminated union here is what makes `{ status: "error" }` a
  // first-class state this component can branch on.
  const status = useQuery_experimental({ query: api.admin.systemStatus, args: {} });
  const agents = useQuery_experimental({ query: api.admin.agentHealth, args: {} });
  const integrations = useQuery_experimental({ query: api.admin.integrationHealth, args: {} });
  const dataModel = useQuery_experimental({ query: api.admin.dataModel, args: {} });
  const security = useQuery_experimental({ query: api.admin.securityPosture, args: {} });

  // One probe, on mount, never on an interval: this is a status report, and a
  // control centre that re-polls an external database on a timer would be a
  // monitoring agent wearing a page's clothes. `cancelled` guards the setState
  // after unmount, which React 19 tolerates but which would still be a state
  // update to a component that no longer exists.
  const runNeonHealth = useAction(api.neon.neonHealth);
  const [neon, setNeon] = useState<NeonView>({ status: "pending" });
  useEffect(() => {
    let cancelled = false;
    runNeonHealth({})
      .then((data) => {
        if (!cancelled) setNeon({ status: "success", data });
      })
      .catch(() => {
        // The action throws for exactly one reason: the caller is not an admin.
        // Everything else is a reported state, so a throw is a refusal — and
        // the two are distinguished here only because both are equally safe to
        // show, not because the message could tell them apart.
        if (!cancelled) setNeon({ status: "refused" });
      });
    return () => {
      cancelled = true;
    };
  }, [runNeonHealth]);

  // The backend refuses by throwing. A thrown query error here means "not
  // authorised", and it is the *only* thing that produces the refusal panel —
  // there is no client-side branch that could decide it, which is the point.
  const results: ReadonlyArray<AnyQuery> = [status, agents, integrations, dataModel, security];
  const errors = results.filter((q) => q.status === "error");
  const refused = errors.length;
  const loading = !refused && results.some((q) => q.status === "pending");

  // The overview is composed only from payloads that actually succeeded. A
  // section whose query produced nothing hands `null` to the composer, which
  // renders it as unknown rather than as a pass.
  const overview =
    status.status === "success"
      ? composeOverview({
          system: status.data,
          agents: agents.status === "success" ? agents.data : null,
          integrations: integrations.status === "success" ? integrations.data : null,
          data: dataModel.status === "success" ? dataModel.data : null,
          security: security.status === "success" ? security.data : null,
          neon,
        })
      : null;

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6">
      <nav className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <Link to="/dashboard" className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground">
          ← Back to your dashboard
        </Link>
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          read-only · no write endpoint exists
        </span>
      </nav>
      <nav
        aria-label="Console sections"
        className="mb-4 flex flex-wrap gap-x-3 gap-y-1 border-b border-border pb-2 font-mono text-[11px]"
      >
        {(
          [
            ["overview", "Overview"],
            ["system", "System & product"],
            ["agents", "Agents"],
            ["integrations", "Integrations"],
            ["data-model", "Data"],
            ["security", "Security"],
            ["bindings", "Infrastructure"],
            ["limits", "Limits"],
            ["scope", "Scope"],
          ] as const
        ).map(([id, label]) => (
          <a
            key={id}
            href={`#${id}`}
            className="text-muted-foreground underline underline-offset-4 hover:text-foreground"
          >
            {label}
          </a>
        ))}
      </nav>

      <header className="mb-5 border-2 border-foreground bg-foreground px-4 py-3 text-card">
        <p className="font-mono text-[10px] uppercase tracking-widest opacity-70">Panel · internal</p>
        <h1 className="font-display text-2xl uppercase tracking-wide">Control Centre</h1>
        <p className="mt-1 text-[12px] opacity-80">
          Observed state of the deployment. This page is a view, not a source of truth:{" "}
          <code className="font-mono">spec/</code> is authoritative, and where they disagree they are right.
        </p>
      </header>

      {refused > 0 ? (
        <>
          <Refused reason={adminDenialMessage("not-an-admin-role")} />
          {refused > 1 ? (
            <p className="mt-3 font-mono text-[11px] text-muted-foreground">
              {refused} of 5 sections refused independently — each query authorises on its own.
            </p>
          ) : null}
        </>
      ) : loading ? (
        <p className="border-2 border-foreground bg-card px-3 py-2 font-mono text-[12px] animate-pulse">
          querying…
        </p>
      ) : (
        <div className="space-y-4">
          {overview && <OverviewSectionView overview={overview} />}
          {status.status === "success" && <SystemStatusSection data={status.data} />}
          {agents.status === "success" && <AgentHealthSection data={agents.data} />}
          {integrations.status === "success" && <IntegrationHealthSection data={integrations.data} />}
          {dataModel.status === "success" && <DataModelSection data={dataModel.data} />}
          {security.status === "success" && <SecuritySection data={security.data} />}
          {status.status === "success" && (
            <InfrastructureBindingsSection bindings={status.data.infrastructureBindings} neon={neon} />
          )}

          <Section id="limits" title="Read limits in force here" source="src/lib/readLimits.ts">
            <Table head={["Cap", "Value", "Bounds"]}>
              <tr className="border-b border-border/60">
                <td className="py-1 pr-3 font-mono text-[11px]">ADMIN_TABLE_SAMPLE</td>
                <td className="py-1 pr-3">{READ_LIMITS.ADMIN_TABLE_SAMPLE}</td>
                <td className="py-1 text-muted-foreground">rows per table in the data-model survey</td>
              </tr>
              <tr className="border-b border-border/60">
                <td className="py-1 pr-3 font-mono text-[11px]">ADMIN_SPACES</td>
                <td className="py-1 pr-3">{READ_LIMITS.ADMIN_SPACES}</td>
                <td className="py-1 text-muted-foreground">spaces enumerated for the deployment-wide aggregates</td>
              </tr>
              <tr>
                <td className="py-1 pr-3 font-mono text-[11px]">ADMIN_STALE_SYNC_MS</td>
                <td className="py-1 pr-3">{READ_LIMITS.ADMIN_STALE_SYNC_MS}</td>
                <td className="py-1 text-muted-foreground">before a connection is reported stale</td>
              </tr>
            </Table>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Every deployment-wide figure on this page is a bounded sample of index order, not a count. Where the
              sample was capped, the section says so.
            </p>
          </Section>

          <ScopeSection />

          <footer className="border-2 border-foreground bg-card px-3 py-2">
            <p className="text-[11px] text-muted-foreground">
              No control on this page changes anything — the five Convex queries behind it export no mutation,
              no action and no internal write. The Neon row is the one action on this page: it runs{" "}
              <code className="font-mono">SELECT 1</code> against an external database, writes nothing, and is
              invoked automatically rather than by a control. Verification lives in{" "}
              <code className="font-mono">bun test</code>,{" "}
              <code className="font-mono">bun scripts/spec-drift.ts</code>,{" "}
              <code className="font-mono">bun scripts/audit-bounded-reads.ts</code> and the{" "}
              <code className="font-mono">conformance-*.ts</code> harnesses.
            </p>
          </footer>
        </div>
      )}
    </main>
  );
}

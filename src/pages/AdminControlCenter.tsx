/**
 * The Admin Control Centre (ADR-032, CHANGE-0027).
 *
 * An internal engineering console, deliberately **not** another user Area. The
 * differences are the point and they are visible on the page:
 *
 *  - It is dense. Status tables, not cards with generous padding. An operator
 *    scanning for what is broken should see everything at once.
 *  - It has **no action buttons**. Not "destructive ones are hidden" — there are
 *    none, because the module behind it exports no mutation (ADR-032 §4). Every
 *    control on this page is a disclosure (`<details>`) or a link to
 *    documentation. A control centre that could change something would be an
 *    admin tool, and this is a status report.
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
 */

import { useQuery_experimental, type UseQueryResult } from "convex/react";

/** One query's state, whatever its payload type. */
type AnyQuery = UseQueryResult<unknown>;
import { Link } from "react-router";

import { api } from "../convex/_generated/api";
import { adminDenialMessage } from "../lib/adminFindings";
import { READ_LIMITS } from "../lib/readLimits";

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

  // The backend refuses by throwing. A thrown query error here means "not
  // authorised", and it is the *only* thing that produces the refusal panel —
  // there is no client-side branch that could decide it, which is the point.
  const results: ReadonlyArray<AnyQuery> = [status, agents, integrations, dataModel, security];
  const errors = results.filter((q) => q.status === "error");
  const refused = errors.length;
  const loading = !refused && results.some((q) => q.status === "pending");

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
          {status.status === "success" && <SystemStatusSection data={status.data} />}
          {agents.status === "success" && <AgentHealthSection data={agents.data} />}
          {integrations.status === "success" && <IntegrationHealthSection data={integrations.data} />}
          {dataModel.status === "success" && <DataModelSection data={dataModel.data} />}
          {security.status === "success" && <SecuritySection data={security.data} />}

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

          <footer className="border-2 border-foreground bg-card px-3 py-2">
            <p className="text-[11px] text-muted-foreground">
              No control on this page changes anything — the backend exports no mutation, action or internal write.
              Verification lives in <code className="font-mono">bun test</code>,{" "}
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

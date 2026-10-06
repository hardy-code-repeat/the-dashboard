/**
 * Operator overview composition (ADR-032 observability scope).
 *
 * The Control Centre answers five server-side queries. This module answers one
 * question the five answers jointly: **is Panel healthy?** — as a roll-up an
 * operator can read in seconds, without any of the honesty rules being a
 * matter of JSX care.
 *
 * Pure (ADR-002): no Convex import, no clock, no database. The page passes the
 * payloads the backend already produced; nothing here invents a measurement.
 *
 * Three rules are encoded here rather than promised:
 *
 *  1. **A missing input is `unknown`, never `ok`.** A section with no answer
 *     has not passed; it has not been asked.
 *  2. **Sampled data says so.** Any summary derived from a `sampled` payload
 *     carries the qualifier, so a lower bound can never render as a count.
 *  3. **The overall verdict is the worst section**, ranked
 *     `bad > warn > unknown > ok`. Unknown never degrades into a pass, and a
 *     single failure cannot be averaged away by nine green sections.
 */

/** The four states the overview may assign, matching the console's Chip tones. */
export type Verdict = "ok" | "warn" | "bad" | "unknown";

export interface OverviewSection {
  id: string;
  label: string;
  verdict: Verdict;
  /** One line an operator can act on. Never a raw payload dump. */
  summary: string;
  /** Optional second line: coverage, caps, or the reason something is unknown. */
  detail?: string;
}

/*
 * Structural inputs: only the fields the composer reads, so the real query
 * payloads (which carry more) satisfy these by construction.
 */
export interface OverviewConfigState {
  readonly state: string;
}
export interface OverviewSystem {
  readonly configuration: readonly OverviewConfigState[];
  readonly infrastructureBindings: readonly { readonly provider: string; readonly state: string }[];
  readonly product?: {
    readonly registeredAgents: readonly { readonly name: string }[];
    readonly hardAttentionKinds: number;
  };
}
export interface OverviewAgents {
  readonly runsObserved: number;
  readonly failuresObserved: number;
  readonly cappedObserved: number;
  readonly overflowObserved: number;
  readonly sampled: boolean;
  readonly spacesSampled: number;
  readonly enrollment?: { readonly optedIn: number; readonly of: number; readonly sampled: boolean };
  readonly proposals?: { readonly observed: number; readonly sampled: boolean };
}
export interface OverviewIntegrations {
  readonly providers: readonly {
    readonly provider: string;
    readonly connections: number;
    readonly withCredential: number;
    readonly stale: number;
    readonly failing: number;
  }[];
  readonly sampled: boolean;
}
export interface OverviewDataModel {
  readonly tables: readonly { readonly table: string; readonly rows: number; readonly saturated: boolean }[];
  readonly sample: number;
}
export interface OverviewSecurity {
  readonly findings: readonly { readonly id: string; readonly owner: string; readonly state: string }[];
}
export interface OverviewNeon {
  readonly status: "pending" | "success" | "failed" | "refused";
  /** Present on a successful probe: `ok` | `unconfigured` | a failure state. */
  readonly state?: string;
  readonly classification?: string;
}

export interface OverviewInput {
  readonly system: OverviewSystem | null;
  readonly agents: OverviewAgents | null;
  readonly integrations: OverviewIntegrations | null;
  readonly data: OverviewDataModel | null;
  readonly security: OverviewSecurity | null;
  readonly neon?: OverviewNeon | null;
}

const RANK: Record<Verdict, number> = { bad: 3, warn: 2, unknown: 1, ok: 0 };

/**
 * The worst verdict in a list.
 *
 * An empty list is `unknown` — nothing was assessed, so nothing passed. With
 * entries, this is a true worst-of: an all-ok set is `ok`, and a single
 * `unknown` (or worse) anywhere keeps the result there. Unknown never
 * *degrades* into a pass, and a pass is never averaged out of a failure.
 */
export function worstVerdict(verdicts: readonly Verdict[]): Verdict {
  if (verdicts.length === 0) return "unknown";
  let worst = verdicts[0];
  for (const v of verdicts) if (RANK[v] > RANK[worst]) worst = v;
  return worst;
}

const MISSING = (label: string): OverviewSection => ({
  id: label.toLowerCase().replace(/\s+/g, "-"),
  label,
  verdict: "unknown",
  summary: "not loaded",
});

/**
 * One verdict per concern, from whatever the five queries actually said.
 *
 * `null` for any input produces an `unknown` section for that concern — the
 * page renders the refusal panel long before this matters for a non-admin, but
 * the composer must be honest on its own rather than relying on that.
 */
export function composeOverview(input: OverviewInput): {
  verdict: Verdict;
  sections: OverviewSection[];
} {
  const sections: OverviewSection[] = [];

  // --- configuration & infrastructure ---------------------------------------
  if (input.system === null) {
    sections.push(MISSING("Configuration"));
  } else {
    const config = input.system.configuration;
    const missing = config.filter((c) => c.state === "missing").length;
    const rotation = config.filter((c) => c.state === "requires-rotation").length;
    const configured = config.filter((c) => c.state === "configured").length;
    const bindings = input.system.infrastructureBindings;
    const bindingsMissing = bindings.filter((b) => b.state === "missing").length;

    let verdict: Verdict = "ok";
    let summary = `${configured}/${config.length} platform variables configured · ${bindings.length - bindingsMissing}/${bindings.length} bindings configured`;
    if (rotation > 0) {
      verdict = "bad";
      summary = `${rotation} configuration value(s) flagged requires-rotation`;
    } else if (missing > 0 || bindingsMissing > 0) {
      verdict = "warn";
      summary += ` · ${missing + bindingsMissing} missing`;
    }
    sections.push({
      id: "configuration",
      label: "Configuration",
      verdict,
      summary,
      detail: "Presence states only — this surface cannot read a value.",
    });
  }

  // --- agents ----------------------------------------------------------------
  if (input.agents === null) {
    sections.push(MISSING("Agents"));
  } else {
    const a = input.agents;
    let verdict: Verdict = "ok";
    let summary = `${a.runsObserved} run(s) observed · ${a.failuresObserved} failed`;
    if (a.failuresObserved > 0) {
      verdict = "warn";
    } else if (a.runsObserved === 0) {
      // No evidence is not evidence of health. The cron question stays open.
      verdict = "unknown";
      summary = "no agent runs in the observed window";
    }
    if (a.cappedObserved > 0 || a.overflowObserved > 0) {
      // Caps and overflow are operational pressure, not an outage: warn at
      // most, whatever the run outcomes already said.
      if (verdict !== "unknown") verdict = "warn";
      summary += ` · ${a.cappedObserved} capped, ${a.overflowObserved} overflow`;
    }
    const detailParts = [
      "cron schedule declared, firing not observable from a request",
      a.sampled ? `sampled: ${a.spacesSampled} spaces, index order` : `complete: ${a.spacesSampled} spaces`,
    ];
    if (a.enrollment) {
      detailParts.push(`${a.enrollment.optedIn}/${a.enrollment.of} spaces enrolled`);
    }
    if (a.proposals) {
      detailParts.push(`${a.proposals.observed} proposal(s) in window`);
    }
    sections.push({ id: "agents", label: "Agents", verdict, summary, detail: detailParts.join(" · ") });
  }

  // --- integrations ------------------------------------------------------------
  if (input.integrations === null) {
    sections.push(MISSING("Integrations"));
  } else {
    const providers = input.integrations.providers;
    const connections = providers.reduce((n, p) => n + p.connections, 0);
    const failing = providers.reduce((n, p) => n + p.failing, 0);
    const stale = providers.reduce((n, p) => n + p.stale, 0);
    let verdict: Verdict = "ok";
    let summary = `${connections} connection(s) · ${failing} failing · ${stale} stale`;
    if (failing > 0) verdict = "warn";
    else if (stale > 0) verdict = "warn";
    else if (connections === 0) {
      verdict = "unknown";
      summary = "nothing connected";
    }
    sections.push({
      id: "integrations",
      label: "Integrations",
      verdict,
      summary,
      detail: input.integrations.sampled ? "sampled across spaces, index order" : "complete across sampled spaces",
    });
  }

  // --- data footprint -----------------------------------------------------------
  if (input.data === null) {
    sections.push(MISSING("Data"));
  } else {
    const inUse = input.data.tables.filter((t) => t.rows > 0).length;
    const saturated = input.data.tables.filter((t) => t.saturated).length;
    let verdict: Verdict = "ok";
    let summary = `${inUse}/${input.data.tables.length} surveyed tables hold rows`;
    if (inUse === 0) {
      // An empty deployment is normal pre-launch; it is not a health problem,
      // and it is not a pass either — the survey simply has nothing to report.
      verdict = "unknown";
      summary = "no rows in any surveyed table";
    } else if (saturated > 0) {
      verdict = "warn";
      summary += ` · ${saturated} table(s) beyond the ${input.data.sample}-row sample (lower bounds)`;
    }
    sections.push({
      id: "data",
      label: "Data footprint",
      verdict,
      summary,
      detail: `bounded sample of ${input.data.sample} rows per table — never a count`,
    });
  }

  // --- security ------------------------------------------------------------------
  if (input.security === null) {
    sections.push(MISSING("Security"));
  } else {
    const findings = input.security.findings;
    const ownerAction = findings.filter((f) => f.owner === "owner" && f.state === "open-human").length;
    const accepted = findings.filter((f) => f.state === "open-accepted").length;
    let verdict: Verdict = "ok";
    let summary = `${findings.length} recorded finding(s) · ${ownerAction} awaiting the owner`;
    if (ownerAction > 0) {
      verdict = "warn";
    } else if (accepted > 0) {
      verdict = "warn";
      summary += ` · ${accepted} accepted risk(s)`;
    }
    sections.push({
      id: "security",
      label: "Security",
      verdict,
      summary,
      detail: "recorded findings from the checked-in registry — cross-checked against the changelog by spec-drift",
    });
  }

  // --- infrastructure / Neon -------------------------------------------------------
  if (input.neon === null || input.neon === undefined) {
    sections.push({ ...MISSING("Neon"), id: "neon", label: "Neon probe" });
  } else if (input.neon.status === "pending") {
    sections.push({ id: "neon", label: "Neon probe", verdict: "unknown", summary: "probing…" });
  } else if (input.neon.status === "success") {
    const state = input.neon.state;
    if (state === "ok") {
      sections.push({ id: "neon", label: "Neon probe", verdict: "ok", summary: "SELECT 1 succeeded" });
    } else if (state === "unconfigured") {
      sections.push({
        id: "neon",
        label: "Neon probe",
        verdict: "unknown",
        summary: "not configured",
        detail: "no connection string in deployment configuration",
      });
    } else {
      sections.push({
        id: "neon",
        label: "Neon probe",
        verdict: "warn",
        summary: `probe failed: ${input.neon.classification ?? "unclassified"}`,
      });
    }
  } else {
    sections.push({
      id: "neon",
      label: "Neon probe",
      verdict: "unknown",
      summary: input.neon.status === "refused" ? "probe refused for this caller" : "probe did not run",
    });
  }

  return { verdict: worstVerdict(sections.map((s) => s.verdict)), sections };
}

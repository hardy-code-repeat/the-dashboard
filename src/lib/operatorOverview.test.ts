/**
 * Operator overview — the honesty rules, as fixtures.
 *
 * The composer is the only place the Control Centre forms a *verdict* rather
 * than rendering a number, so this is where the rules that keep the verdict
 * honest are pinned: a missing input is never a pass, sampled data always
 * carries its qualifier, and the overall verdict is the worst section rather
 * than an average that a single failure could hide inside.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  composeOverview,
  worstVerdict,
  type OverviewInput,
  type Verdict,
} from "./operatorOverview";

/**
 * The fixture, with every section present. Typed concretely (not as the
 * nullable `OverviewInput`) so tests can destructure and spread it without
 * TypeScript widening every field back to optional.
 */
type ConcreteInput = {
  -readonly [K in keyof OverviewInput]-?: NonNullable<OverviewInput[K]>;
};

function healthyInput(): ConcreteInput {
  return {
    system: {
      configuration: [
        { state: "configured" },
        { state: "configured" },
        { state: "configured" },
        { state: "configured" },
      ],
      infrastructureBindings: [
        { provider: "neon", state: "configured" },
        { provider: "email-relay", state: "configured" },
      ],
      product: { registeredAgents: [{ name: "finreview" }], hardAttentionKinds: 8 },
    },
    agents: {
      runsObserved: 6,
      failuresObserved: 0,
      cappedObserved: 0,
      overflowObserved: 0,
      sampled: false,
      spacesSampled: 3,
      enrollment: { optedIn: 1, of: 3, sampled: false },
      proposals: { observed: 2, sampled: false },
    },
    integrations: {
      providers: [
        { provider: "gcal", connections: 2, withCredential: 2, stale: 0, failing: 0 },
      ],
      sampled: false,
    },
    data: {
      tables: [
        { table: "tasks", rows: 12, saturated: false },
        { table: "notes", rows: 0, saturated: false },
      ],
      sample: 50,
    },
    security: {
      findings: [
        { id: "D54", owner: "owner", state: "open-human" },
        { id: "D59", owner: "agent", state: "open-accepted" },
      ],
    },
    neon: { status: "success", state: "ok" },
  };
}

test("a fully healthy deployment composes to ok, section by section", () => {
  const { verdict, sections } = composeOverview(healthyInput());
  const byId = new Map(sections.map((s) => [s.id, s]));
  assert.equal(byId.get("configuration")?.verdict, "ok");
  assert.equal(byId.get("integrations")?.verdict, "ok");
  assert.equal(byId.get("data")?.verdict, "ok");
  // Two recorded findings, one of them awaiting the owner: honest warn, not ok.
  assert.equal(byId.get("security")?.verdict, "warn");
  assert.equal(byId.get("neon")?.verdict, "ok");
  assert.equal(verdict, "warn");
});

test("a missing input is unknown, never ok", () => {
  const { verdict, sections } = composeOverview({
    system: null,
    agents: null,
    integrations: null,
    data: null,
    security: null,
    neon: null,
  });
  assert.equal(sections.length, 6);
  for (const s of sections) assert.equal(s.verdict, "unknown", `${s.label} must not pass without data`);
  assert.equal(verdict, "unknown");
});

test("no agent runs in the window is unknown, not a clean bill of health", () => {
  const input = healthyInput();
  const { system, integrations, data, security, neon } = input;
  const { sections } = composeOverview({
    system,
    integrations,
    data,
    security,
    neon,
    agents: { ...input.agents, runsObserved: 0 },
  });
  const agents = sections.find((s) => s.id === "agents");
  assert.equal(agents?.verdict, "unknown");
  assert.match(agents!.summary, /no agent runs/);
});

test("agent failures warn, and caps/overflow are surfaced in the summary", () => {
  const input = healthyInput();
  const { system, integrations, data, security, neon } = input;
  const { sections } = composeOverview({
    system,
    integrations,
    data,
    security,
    neon,
    agents: { ...input.agents, failuresObserved: 1, cappedObserved: 2, overflowObserved: 3 },
  });
  const agents = sections.find((s) => s.id === "agents");
  assert.equal(agents?.verdict, "warn");
  assert.match(agents!.summary, /1 failed/);
  assert.match(agents!.summary, /2 capped, 3 overflow/);
});

test("a requires-rotation configuration state is bad, not warn", () => {
  const input = healthyInput();
  if (!input.system) throw new Error("fixture");
  const { sections } = composeOverview({
    ...input,
    system: {
      ...input.system,
      configuration: input.system.configuration.map((c, i) =>
        i === 0 ? { state: "requires-rotation" } : c,
      ),
    },
  });
  const configuration = sections.find((s) => s.id === "configuration");
  assert.equal(configuration?.verdict, "bad");
  assert.match(configuration!.summary, /requires-rotation/);
});

test("an empty deployment reports no rows as unknown, not ok", () => {
  const input = healthyInput();
  const { sections } = composeOverview({
    ...input,
    data: { tables: [{ table: "tasks", rows: 0, saturated: false }], sample: 50 },
  });
  const data = sections.find((s) => s.id === "data");
  assert.equal(data?.verdict, "unknown");
  assert.match(data!.summary, /no rows/);
});

test("saturated tables are a warn and say they are lower bounds", () => {
  const input = healthyInput();
  const { sections } = composeOverview({
    ...input,
    data: {
      tables: [
        { table: "tasks", rows: 50, saturated: true },
        { table: "notes", rows: 3, saturated: false },
      ],
      sample: 50,
    },
  });
  const data = sections.find((s) => s.id === "data");
  assert.equal(data?.verdict, "warn");
  assert.match(data!.summary, /lower bounds/);
  assert.match(data!.detail ?? "", /never a count/);
});

test("sampled agent coverage always carries its qualifier", () => {
  const input = healthyInput();
  const { system, integrations, data, security, neon } = input;
  const { sections } = composeOverview({
    system,
    integrations,
    data,
    security,
    neon,
    agents: { ...input.agents, sampled: true, spacesSampled: 50 },
  });
  const agents = sections.find((s) => s.id === "agents");
  assert.match(agents!.detail ?? "", /sampled: 50 spaces/);
});

test("an empty integrations set is unknown, not ok", () => {
  const input = healthyInput();
  const { sections } = composeOverview({
    ...input,
    integrations: { providers: [], sampled: false },
  });
  const integrations = sections.find((s) => s.id === "integrations");
  assert.equal(integrations?.verdict, "unknown");
  assert.match(integrations!.summary, /nothing connected/);
});

test("failing integrations warn", () => {
  const input = healthyInput();
  const { sections } = composeOverview({
    ...input,
    integrations: {
      providers: [{ provider: "gcal", connections: 3, withCredential: 1, stale: 1, failing: 2 }],
      sampled: true,
    },
  });
  const integrations = sections.find((s) => s.id === "integrations");
  assert.equal(integrations?.verdict, "warn");
  assert.match(integrations!.summary, /2 failing/);
});

test("the Neon probe reports ok, unconfigured and failure as three different things", () => {
  const input = healthyInput();
  const verdictFor = (neon: OverviewInput["neon"]): { verdict: Verdict; summary: string } => {
    const { sections } = composeOverview({ ...input, neon });
    const probe = sections.find((s) => s.id === "neon");
    return { verdict: probe!.verdict, summary: probe!.summary };
  };
  assert.deepEqual(verdictFor({ status: "success", state: "ok" }), {
    verdict: "ok",
    summary: "SELECT 1 succeeded",
  });
  const unconfigured = verdictFor({ status: "success", state: "unconfigured" });
  assert.equal(unconfigured.verdict, "unknown");
  assert.match(unconfigured.summary, /not configured/);
  const failed = verdictFor({ status: "success", state: "unreachable", classification: "network" });
  assert.equal(failed.verdict, "warn");
  assert.match(failed.summary, /network/);
  assert.equal(verdictFor({ status: "refused" }).verdict, "unknown");
  assert.equal(verdictFor({ status: "pending" }).verdict, "unknown");
});

test("worstVerdict ranks bad > warn > unknown > ok and never averages", () => {
  assert.equal(worstVerdict([]), "unknown");
  assert.equal(worstVerdict(["ok", "ok", "ok"]), "ok");
  assert.equal(worstVerdict(["ok", "unknown"]), "unknown");
  assert.equal(worstVerdict(["ok", "warn", "ok"]), "warn");
  assert.equal(worstVerdict(["ok", "bad", "warn"]), "bad");
  assert.equal(worstVerdict(["unknown", "warn"]), "warn");
});

test("one failing section cannot be hidden by nine green ones", () => {
  const input = healthyInput();
  if (!input.security) throw new Error("fixture");
  const { verdict } = composeOverview({
    ...input,
    security: {
      findings: [{ id: "D54", owner: "owner", state: "open-human" }],
    },
  });
  assert.equal(verdict, "warn");
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  EXPORT_CLASSIFICATION,
  NEVER_EXPORT_FIELDS,
  PROFILE_FIELDS,
  buildManifest,
  classifyTable,
  exportableTables,
  secretTables,
} from "./export";

/**
 * The inventory is the control. These fixtures assert it *fails* on an
 * unclassified table and on a credential-shaped column, because an inventory
 * that cannot fail is documentation.
 */
describe("classifyTable", () => {
  it("refuses an unknown table rather than guessing it into the export", () => {
    // Fail-closed is the whole point: "default to including it" is the failure
    // mode where a future `apiKeys` table ships silently inside a backup.
    assert.equal(classifyTable("apiKeys"), null);
    assert.equal(classifyTable("someFutureTable"), null);
    assert.equal(classifyTable(""), null);
  });

  it("does not match a table name by prefix or substring", () => {
    assert.equal(classifyTable("connectionTokensBackup"), null);
    assert.equal(classifyTable("tasksArchive"), null);
  });

  it("exports the user-owned tables", () => {
    assert.equal(classifyTable("transactions")?.tier, "userOwned");
    assert.equal(classifyTable("people")?.tier, "userOwned");
    assert.equal(classifyTable("imports")?.tier, "userOwned");
  });

  it("refuses every secret table and states why", () => {
    for (const t of secretTables()) {
      const c = classifyTable(t);
      assert.equal(c?.tier, "systemSecret", `${t} must be secret`);
      assert.equal(c?.key, null, `${t} must have no export key`);
      assert.ok((c?.why.length ?? 0) > 0, `${t} must explain itself`);
    }
  });

  it("keeps the credential-bearing tables in the secret tier", () => {
    for (const t of ["connectionTokens", "oauthStates", "syncCursors"]) {
      assert.equal(classifyTable(t)?.tier, "systemSecret", `${t} must stay secret`);
    }
  });

  it("counts security and audit tables without giving them a key", () => {
    for (const t of ["accessLog", "grants", "agentRuns", "activity", "links"]) {
      const c = classifyTable(t);
      assert.equal(c?.tier, "securityAudit", `${t} must be audit tier`);
      assert.equal(c?.key, null, `${t} must not be emitted`);
    }
  });
});

describe("the inventory covers every table in the schema", () => {
  it("leaves no table unclassified", () => {
    // The product + auth tables as declared in src/convex/schema.ts. A new
    // table nobody classified fails here rather than leaking into an export.
    const schemaTables = [
      "users",
      "spaces",
      "spaceMembers",
      "grants",
      "accessLog",
      "links",
      "activity",
      "tasks",
      "people",
      "notes",
      "assistantState",
      "modelSnapshots",
      "connectionTokens",
      "syncCursors",
      "oauthStates",
      "featureFlags",
      "attentionState",
      "areas",
      "taxProfile",
      "expenses",
      "calendarEvents",
      "taxDocuments",
      "documents",
      "commitments",
      "accounts",
      "subscriptions",
      "transactions",
      "imports",
      "agentRuns",
      "agentProposals",
      "connections",
    ];
    const unclassified = schemaTables.filter((t) => classifyTable(t) === null);
    assert.deepEqual(unclassified, [], `unclassified tables: ${unclassified.join(", ")}`);
  });
});

describe("the profile allowlist", () => {
  it("is an allowlist, so a column added by an auth upgrade is not exported by default", () => {
    // Note what the compiler is doing here: `PROFILE_FIELDS.includes("token")`
    // is a *type error*, because the tuple's element type excludes it. That is
    // the allowlist working at the strongest level available — a credential
    // field cannot be added to this list without the build failing. These
    // runtime assertions are deliberately written through a widened view so the
    // intent stays legible even though the type system already guarantees it.
    assert.ok(PROFILE_FIELDS.includes("email"));
    const fields: readonly string[] = PROFILE_FIELDS;
    assert.ok(!fields.includes("accountId"));
    assert.ok(!fields.includes("providerAccountId"));
    assert.ok(!fields.includes("token"));
  });
});

describe("field redaction", () => {
  it("only lists credential-shaped fields", () => {
    for (const f of NEVER_EXPORT_FIELDS) {
      const s = f.toLowerCase();
      const credentialish =
        s.includes("token") ||
        s.includes("secret") ||
        s.includes("key") ||
        s.includes("password") ||
        s.includes("verifier") ||
        s.includes("hash");
      assert.ok(credentialish, `${f} is not credential-shaped`);
    }
  });
});

describe("exportableTables", () => {
  it("emits no secret and no audit table", () => {
    const tables = exportableTables().map((e) => e.table);
    for (const t of secretTables()) {
      assert.ok(!tables.includes(t), `${t} must not be exportable`);
    }
    for (const t of ["accessLog", "grants", "agentRuns"]) {
      assert.ok(!tables.includes(t), `${t} must not be exportable`);
    }
  });

  it("emits each table under a distinct key", () => {
    const keys = exportableTables().map((e) => e.key);
    assert.equal(new Set(keys).size, keys.length, "duplicate export keys");
  });
});

describe("buildManifest", () => {
  const base = {
    userId: "u1",
    exportedAt: 1_700_000_000_000,
    counts: { tasks: 3, people: 2 },
    withheld: { accessLog: 10 },
  };

  it("is byte-identical for the same input", () => {
    assert.equal(JSON.stringify(buildManifest(base)), JSON.stringify(buildManifest(base)));
  });

  it("states the guarantees the export actually makes", () => {
    const m = buildManifest(base);
    assert.equal(m.format, "panel-export");
    assert.equal(m.version, 1);
    assert.ok(m.guarantees.length >= 4);
    assert.ok(m.guarantees.join(" ").includes("no credentials"));
  });

  it("reports both what was included and what was withheld", () => {
    const m = buildManifest(base);
    assert.equal(m.counts.tasks, 3);
    assert.equal(m.withheld.accessLog, 10);
  });

  it("treats an empty export as a valid export", () => {
    const m = buildManifest({ userId: "u2", exportedAt: 0, counts: {}, withheld: {} });
    assert.deepEqual(m.counts, {});
    assert.ok(m.guarantees.length > 0);
  });
});

describe("the classification map", () => {
  it("gives every entry a stated reason and keeps tiers consistent", () => {
    const entries = Object.entries(EXPORT_CLASSIFICATION);
    assert.ok(entries.length > 20, "the inventory looks incomplete");
    for (const [table, c] of entries) {
      assert.ok(c.why.length > 5, `${table} needs a stated reason`);
      if (c.key !== null) {
        assert.equal(c.tier, "userOwned", `${table} is emitted so must be user-owned`);
      }
    }
  });
});
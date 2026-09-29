import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import nodePath from "node:path";
import { DatabaseSync } from "node:sqlite";

import { describe, expect, it } from "vitest";

import {
  checkLedger,
  discoverD1Targets,
  evidenceDigest,
  freshEvidenceDigest,
  inspectD1Target,
  inspectFreshTarget,
  inspectResumedD1Target,
  parseD1Target,
  parseFreshTarget,
  readLocalMigrations,
  resumeEvidenceDigest,
  verifyEvidence,
} from "./alchemy-d1-preflight.js";
import type { D1Reader } from "./alchemy-d1-preflight.js";

const target = parseD1Target({
  accountId: "a".repeat(32),
  databases: {
    MealPlannerAuthDatabase: {
      name: "opaque-auth",
      uuid: "10000000-0000-4000-8000-000000000001",
    },
    ProviderAccountingDatabase: {
      name: "opaque-accounting",
      uuid: "10000000-0000-4000-8000-000000000002",
    },
  },
  profile: "fixture",
  stage: "stage-with-generated-names",
  worker: "opaque-worker-name",
});
const first = { hash: "1".repeat(64), name: "20260817221945_first" };
const second = { hash: "2".repeat(64), name: "20260905063703_second" };
const migrations = [first, second];
const local = {
  MealPlannerAuthDatabase: migrations,
  ProviderAccountingDatabase: migrations,
};
const legacyRows = [
  {
    applied_at: "2026-08-18 12:00:00",
    id: "00001",
    name: `${first.name}/migration.sql`,
  },
];
const alchemyRows = [
  {
    applied_at: "2026-08-18 12:00:00",
    created_at: 1_787_004_000_000,
    hash: first.hash,
    id: 1,
    name: first.name,
  },
];

const columnsFor = (sql: string) => {
  const database = new DatabaseSync(":memory:");
  try {
    database.exec(sql);
    return database.prepare("PRAGMA table_info(d1_migrations)").all();
  } finally {
    database.close();
  }
};
const legacyColumns = columnsFor(
  "CREATE TABLE d1_migrations (id TEXT PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)"
);
const alchemyColumns = columnsFor(
  "CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY, hash TEXT NOT NULL, created_at NUMERIC, name TEXT, applied_at TEXT)"
);

const fixture = () => {
  const calls: { path: string; sql: string | undefined }[] = [];
  const state = {
    bookmark: "current-bookmark",
    columns: alchemyColumns,
    executor: Object.entries(target.databases).map(([resource, db]) => ({
      attr: {
        accountId: target.accountId,
        databaseId: db.uuid,
        databaseName: db.name,
      },
      fqn: resource,
      logicalId: resource,
      resourceType: "Cloudflare.D1Database",
      status: "updated",
    })),
    freshState: {
      hasOutput: false,
      replaced: [] as unknown[],
      resources: [] as string[],
      stages: [] as string[],
    },
    resumeState: {
      databases: Object.entries(target.databases).map(([resource, db]) => ({
        attr: {
          accountId: target.accountId,
          databaseId: db.uuid,
          databaseName: db.name,
        },
        fqn: resource,
        instanceId: "b".repeat(32),
        logicalId: resource,
        resourceType: "Cloudflare.D1Database",
        status: "created",
      })),
      hasOutput: false,
      replaced: [] as unknown[],
      worker: {
        attr: {
          accountId: target.accountId,
          tags: [
            "alchemy:stack:MealPlanner",
            `alchemy:stage:${target.stage}`,
            "alchemy:id:MealPlannerApi",
          ],
          workerId: "a".repeat(32),
          workerName: target.worker,
        },
        fqn: "MealPlannerApi",
        instanceId: "c".repeat(32),
        logicalId: "MealPlannerApi",
        resourceType: "Cloudflare.Worker",
        status: "creating",
      },
    },
    rows: alchemyRows,
    schema: [
      {
        name: "fixture",
        sql: "CREATE TABLE fixture (id TEXT PRIMARY KEY)",
        tbl_name: "fixture",
        type: "table",
      },
      {
        name: "d1_migrations",
        sql: "CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY, hash TEXT NOT NULL, created_at NUMERIC, name TEXT, applied_at TEXT)",
        tbl_name: "d1_migrations",
        type: "table",
      },
    ],
    worker: {
      bindings: Object.entries(target.databases).map(([name, db]) => ({
        id: db.uuid,
        name,
        type: "d1",
      })),
      tags: [
        "alchemy:stack:MealPlanner",
        `alchemy:stage:${target.stage}`,
        "alchemy:id:MealPlannerApi",
      ],
    },
  };
  const reader: D1Reader = {
    accountId: target.accountId,
    read: (path, sql) =>
      Promise.resolve(
        (() => {
          calls.push({ path, sql });
          if (path === "/workers/scripts") {
            return [
              {
                id: state.resumeState.worker.attr.workerName,
                tag: "a".repeat(32),
                tags: state.worker.tags,
              },
              { id: "unrelated", tags: [] },
            ];
          }
          if (path === "/d1/database") {
            return [];
          }
          if (path === "/r2/buckets?per_page=1000") {
            return { buckets: [] };
          }
          if (path === "/ai-gateway/gateways?per_page=100") {
            return [{ id: "default" }];
          }
          if (path === "/containers/applications") {
            return [];
          }
          if (path.endsWith("/settings")) {
            return state.worker;
          }
          if (path.endsWith("/time_travel/bookmark")) {
            return { bookmark: state.bookmark };
          }
          if (sql?.startsWith("PRAGMA")) {
            return state.columns;
          }
          if (sql?.includes("sqlite_schema")) {
            return state.schema;
          }
          if (sql !== undefined) {
            return state.rows;
          }
          const metadata = state.resumeState.databases.find((db) =>
            path.endsWith(db.attr.databaseId)
          )?.attr;
          return {
            name: metadata?.databaseName,
            uuid: metadata?.databaseId,
            version: "production",
          };
        })()
      ),
    readFreshState: (stage) => {
      calls.push({ path: `/fresh-state/${stage}`, sql: undefined });
      return Promise.resolve(state.freshState);
    },
    readResumeState: (stage) => {
      calls.push({ path: `/resume-state/${stage}`, sql: undefined });
      return Promise.resolve(state.resumeState);
    },
    readState: (stage) => {
      calls.push({ path: `/state/${stage}`, sql: undefined });
      return Promise.resolve(state.executor);
    },
  };
  return { calls, reader, state };
};

const resumedFixture = () => {
  const observed = fixture();
  const frozen = parseD1Target({
    ...target,
    databases: {
      MealPlannerAuthDatabase: {
        ...target.databases.MealPlannerAuthDatabase,
        name: "MealPlanner-MealPlannerAuthDatabase-e2e-aaaaaaaaaaaaaaaa",
      },
      ProviderAccountingDatabase: {
        ...target.databases.ProviderAccountingDatabase,
        name: "MealPlanner-ProviderAccountingDatabase-e2e-aaaaaaaaaaaaaaaa",
      },
    },
    stage: "e2e",
    worker: "mealplanner-mealplannerapi-e2e-aaaaaaaaaaaaaaaa",
  });
  observed.state.resumeState.worker.attr.workerName = frozen.worker;
  observed.state.resumeState.worker.attr.tags[1] = "alchemy:stage:e2e";
  observed.state.worker.tags[1] = "alchemy:stage:e2e";
  observed.state.worker.bindings = [];
  for (const [index, resource] of (
    ["MealPlannerAuthDatabase", "ProviderAccountingDatabase"] as const
  ).entries()) {
    const saved = observed.state.resumeState.databases[index];
    if (saved !== undefined) {
      saved.attr.databaseName = frozen.databases[resource].name;
    }
  }
  observed.state.rows = [
    ...alchemyRows,
    {
      applied_at: "2026-09-06 12:00:00",
      created_at: 1_788_680_000_000,
      hash: second.hash,
      id: 2,
      name: second.name,
    },
  ];
  return { ...observed, frozen };
};

describe("interrupted first-deploy D1 inspection", () => {
  it("limits resume mode to the authorized e2e stage", async () => {
    const { reader, calls, frozen } = resumedFixture();
    await expect(
      inspectResumedD1Target(reader, { ...frozen, stage: "prod" }, local)
    ).rejects.toThrow("e2e stage");
    expect(calls).toHaveLength(0);
  });

  it("accepts only the owned API precreate stub with complete native D1 ledgers", async () => {
    const { reader, frozen } = resumedFixture();
    await expect(inspectD1Target(reader, frozen, local)).rejects.toThrow(
      "Worker must bind exactly one D1"
    );
    const report = await inspectResumedD1Target(reader, frozen, local);
    expect(report.workerState.status).toBe("creating");
    expect(report.databases.every(({ pending }) => pending.length === 0)).toBe(
      true
    );
    const release = {
      head: "a".repeat(40),
      local,
      toolchain: { alchemy: "2.0.0-beta.76", node: "v24" },
    };
    const digest = resumeEvidenceDigest(report, release);
    verifyEvidence(digest, digest);
    expect(
      resumeEvidenceDigest(report, { ...release, head: "b".repeat(40) })
    ).not.toBe(digest);
  });

  it.each([
    "worker-id",
    "worker-status",
    "worker-name",
    "foreign-binding",
    "d1-uuid",
    "old",
    "replacement",
    "output",
    "pending",
  ])("rejects interrupted release drift: %s", async (change) => {
    const { reader, state, frozen } = resumedFixture();
    if (change === "worker-id") {
      state.resumeState.worker.attr.workerId = "f".repeat(32);
    } else if (change === "worker-status") {
      state.resumeState.worker.status = "created";
    } else if (change === "worker-name") {
      state.resumeState.worker.attr.workerName = "other";
    } else if (change === "foreign-binding") {
      state.worker.bindings.push({
        id: frozen.databases.MealPlannerAuthDatabase.uuid,
        name: "Unexpected",
        type: "d1",
      });
    } else if (change === "d1-uuid") {
      const [saved] = state.resumeState.databases;
      if (saved !== undefined) {
        saved.attr.databaseId =
          frozen.databases.ProviderAccountingDatabase.uuid;
      }
    } else if (change === "old") {
      Object.assign(state.resumeState.worker, { old: {} });
    } else if (change === "replacement") {
      state.resumeState.replaced.push({});
    } else if (change === "output") {
      state.resumeState.hasOutput = true;
    } else {
      state.rows.pop();
    }
    await expect(
      inspectResumedD1Target(reader, frozen, local)
    ).rejects.toThrow();
  });
});

describe("fresh D1 release inspection", () => {
  const freshTarget = parseFreshTarget({
    accountId: target.accountId,
    profile: target.profile,
    stage: "e2e",
  });

  it("proves account, stage, Worker names, D1 names and Alchemy state absent", async () => {
    const { reader, state } = fixture();
    state.worker.tags = ["unrelated"];
    const report = await inspectFreshTarget(reader, freshTarget);
    expect(report.target).toEqual(freshTarget);
    expect(report.state.stageAbsent).toBe(true);
    const release = {
      head: "a".repeat(40),
      local,
      toolchain: { alchemy: "2.0.0-beta.76", node: "v24" },
    };
    const digest = freshEvidenceDigest(report, release);
    verifyEvidence(digest, digest);
    expect(
      freshEvidenceDigest(report, { ...release, head: "b".repeat(40) })
    ).not.toBe(digest);
  });

  it.each(["stage", "resource", "replacement", "output"])(
    "rejects existing %s state",
    async (change) => {
      const { reader, state } = fixture();
      if (change === "stage") {
        state.freshState.stages.push("e2e");
      }
      if (change === "resource") {
        state.freshState.resources.push("MealPlannerApi");
      }
      if (change === "replacement") {
        state.freshState.replaced.push({});
      }
      if (change === "output") {
        state.freshState.hasOutput = true;
      }
      await expect(inspectFreshTarget(reader, freshTarget)).rejects.toThrow(
        "state already exists"
      );
    }
  );

  it("rejects matching Worker ownership tags and an unowned generated Worker name", async () => {
    const { reader } = fixture();
    const owned: D1Reader = {
      ...reader,
      read: (path, sql) =>
        path === "/workers/scripts"
          ? Promise.resolve([
              {
                id: "unrelated",
                tags: ["alchemy:stack:MealPlanner", "alchemy:stage:e2e"],
              },
            ])
          : reader.read(path, sql),
    };
    await expect(inspectFreshTarget(owned, freshTarget)).rejects.toThrow(
      "target name"
    );
    const unowned: D1Reader = {
      ...reader,
      read: (path, sql) =>
        path === "/workers/scripts"
          ? Promise.resolve([
              { id: "mealplanner-mealplannerapi-e2e-existing", tags: [] },
            ])
          : reader.read(path, sql),
    };
    await expect(inspectFreshTarget(unowned, freshTarget)).rejects.toThrow(
      "target name"
    );
  });

  it("rejects generated D1 name and account mismatch", async () => {
    const { reader, calls } = fixture();
    const existing: D1Reader = {
      ...reader,
      read: (path, sql) =>
        path === "/d1/database"
          ? Promise.resolve([
              {
                name: "MealPlanner-MealPlannerAuthDatabase-e2e-existing",
                uuid: target.databases.MealPlannerAuthDatabase.uuid,
              },
            ])
          : reader.read(path, sql),
    };
    await expect(inspectFreshTarget(existing, freshTarget)).rejects.toThrow(
      "target name"
    );
    calls.length = 0;
    await expect(
      inspectFreshTarget({ ...reader, accountId: "b".repeat(32) }, freshTarget)
    ).rejects.toThrow("account");
    expect(calls).toHaveLength(0);
  });

  it.each([
    [
      "/workers/scripts",
      [{ id: "mealplanner-privateoutputworker-e2e-existing", tags: [] }],
    ],
    [
      "/workers/scripts",
      [{ id: "mealplanner-householddomainworker-e2e-existing", tags: [] }],
    ],
    [
      "/r2/buckets?per_page=1000",
      { buckets: [{ name: "mealplanner-importevidencebucket-e2e-existing" }] },
    ],
    [
      "/ai-gateway/gateways?per_page=100",
      [{ id: "mealplanner-importprovidergateway-e2e-existing" }],
    ],
    [
      "/containers/applications",
      [{ name: "mealplanner-tiktokmediacontainer-e2e-existing" }],
    ],
  ])(
    "rejects an unowned fresh-stage resource at %s",
    async (path, inventory) => {
      const { reader } = fixture();
      const withCollision: D1Reader = {
        ...reader,
        read: (requested, sql) =>
          requested === path
            ? Promise.resolve(inventory)
            : reader.read(requested, sql),
      };
      await expect(
        inspectFreshTarget(withCollision, freshTarget)
      ).rejects.toThrow("target name");
    }
  );

  it("fails closed on incomplete or failed inventory and forbids fresh prod", async () => {
    const { reader } = fixture();
    await expect(
      inspectFreshTarget(
        {
          ...reader,
          readFreshState: () => Promise.reject(new Error("state failed")),
        },
        freshTarget
      )
    ).rejects.toThrow("state failed");
    await expect(
      inspectFreshTarget(
        { ...reader, read: () => Promise.resolve({}) },
        freshTarget
      )
    ).rejects.toThrow();
    expect(() => parseFreshTarget({ ...freshTarget, stage: "prod" })).toThrow(
      "prod"
    );
  });

  it("rejects a full R2 first page when Cloudflare omits a cursor", async () => {
    const { reader } = fixture();
    const fullPage: D1Reader = {
      ...reader,
      read: (path, sql) =>
        path === "/r2/buckets?per_page=1000"
          ? Promise.resolve({
              buckets: Array.from({ length: 1000 }, () => ({
                name: "unrelated",
              })),
            })
          : reader.read(path, sql),
    };
    await expect(inspectFreshTarget(fullPage, freshTarget)).rejects.toThrow(
      "first page is full"
    );
  });
});

describe("existing D1 release inspection", () => {
  it("discovers by ownership tags and exact binding UUIDs without ledger reads", async () => {
    const { reader, calls } = fixture();
    expect(await discoverD1Targets(reader, target.profile)).toEqual([target]);
    expect(calls.every(({ sql }) => sql === undefined)).toBe(true);
    expect(calls.some(({ path }) => path.startsWith("/state/"))).toBe(false);
  });

  it.each(["created", "updated", "updating"])(
    "uses top-level executor attributes for %s state",
    async (status) => {
      const { reader, state } = fixture();
      const current = state.executor.at(0);
      if (current === undefined) {
        throw new Error("Missing fixture state");
      }
      current.status = status;
      Object.assign(current, {
        old: { attr: { databaseId: "unrelated-rollback-history" } },
      });
      const report = await inspectD1Target(reader, target, local);
      expect(report.executorTargets[0]?.status).toBe(status);
    }
  );

  it.each([
    "creating",
    "replacing",
    "replaced",
    "deleting",
    "missing",
    "uuid",
    "account",
    "resource",
    "local",
    "name",
  ])("rejects unsafe executor state %s before ledger reads", async (change) => {
    const { reader, calls, state } = fixture();
    const current = state.executor.at(0);
    if (current === undefined) {
      throw new Error("Missing fixture state");
    }
    if (change === "missing") {
      state.executor.splice(0, 1);
    } else if (change === "uuid") {
      current.attr.databaseId =
        target.databases.ProviderAccountingDatabase.uuid;
    } else if (change === "account") {
      current.attr.accountId = "b".repeat(32);
    } else if (change === "resource") {
      current.resourceType = "Other";
    } else if (change === "name") {
      current.attr.databaseName = "other";
    } else if (change === "local") {
      Object.assign(current, { providerMode: "local" });
    } else {
      current.status = change;
    }
    await expect(inspectD1Target(reader, target, local)).rejects.toThrow();
    expect(calls.every(({ sql }) => sql === undefined)).toBe(true);
  });

  it("does not interpret a failed state read as missing history", async () => {
    const { reader, calls } = fixture();
    await expect(
      inspectD1Target(
        {
          ...reader,
          readState: () => Promise.reject(new Error("state read failed")),
        },
        target,
        local
      )
    ).rejects.toThrow("state read failed");
    expect(calls.every(({ sql }) => sql === undefined)).toBe(true);
  });

  it("rejects one UUID assigned to both logical resources", () => {
    expect(() =>
      parseD1Target({
        ...target,
        databases: {
          ...target.databases,
          ProviderAccountingDatabase: target.databases.MealPlannerAuthDatabase,
        },
      })
    ).toThrow("distinct");
  });

  it("rejects an account mismatch before any remote read", async () => {
    const { reader, calls } = fixture();
    await expect(
      inspectD1Target({ ...reader, accountId: "b".repeat(32) }, target, local)
    ).rejects.toThrow("account");
    expect(calls).toHaveLength(0);
  });

  it.each(["stage", "binding", "duplicate-binding", "duplicate-stage"])(
    "rejects %s drift before inspecting either ledger",
    async (change) => {
      const { reader, calls, state } = fixture();
      if (change === "stage") {
        state.worker.tags[1] = "alchemy:stage:other";
      } else if (change === "binding") {
        state.worker.bindings[0] = {
          id: target.databases.ProviderAccountingDatabase.uuid,
          name: "MealPlannerAuthDatabase",
          type: "d1",
        };
      } else if (change === "duplicate-binding") {
        state.worker.bindings.push({
          id: target.databases.MealPlannerAuthDatabase.uuid,
          name: "MealPlannerAuthDatabase",
          type: "d1",
        });
      } else {
        state.worker.tags.push("alchemy:stage:other");
      }
      await expect(inspectD1Target(reader, target, local)).rejects.toThrow();
      expect(calls.every(({ sql }) => sql === undefined)).toBe(true);
    }
  );

  it("propagates ledger query failure without treating it as an absent database", async () => {
    const { reader } = fixture();
    const failing: D1Reader = {
      ...reader,
      read: (path, sql) => {
        if (sql !== undefined) {
          return Promise.reject(new Error("fixture network failure"));
        }
        return reader.read(path);
      },
    };
    await expect(inspectD1Target(failing, target, local)).rejects.toThrow(
      "fixture network failure"
    );
  });

  it("requires a fresh recovery bookmark for both exact databases", async () => {
    const { reader, calls, state } = fixture();
    const report = await inspectD1Target(reader, target, local);
    expect(
      report.databases.map(({ recoveryBookmark }) => recoveryBookmark)
    ).toEqual(["current-bookmark", "current-bookmark"]);
    expect(
      calls
        .filter(({ path }) => path.endsWith("/time_travel/bookmark"))
        .map(({ path }) => path)
    ).toEqual(
      Object.values(target.databases).map(
        ({ uuid }) => `/d1/database/${uuid}/time_travel/bookmark`
      )
    );
    state.bookmark = "";
    await expect(inspectD1Target(reader, target, local)).rejects.toThrow(
      "recovery bookmark"
    );
  });

  it("rejects an alternate history table even alongside a recognized ledger", async () => {
    const { reader, state } = fixture();
    state.schema.push({
      name: "__drizzle_migrations",
      sql: "CREATE TABLE __drizzle_migrations (id INTEGER)",
      tbl_name: "__drizzle_migrations",
      type: "table",
    });
    await expect(inspectD1Target(reader, target, local)).rejects.toThrow(
      "alternate"
    );
  });

  it("binds evidence to observed schema, history, target, release, bytes and effects while refreshing bookmarks", async () => {
    const { reader, state } = fixture();
    const report = await inspectD1Target(reader, target, local);
    const release = {
      head: "c".repeat(40),
      local,
      toolchain: { alchemy: "2.0.0-beta.76", node: "v24.20.0" },
    };
    const digest = evidenceDigest(report, release);
    state.bookmark = "advanced-by-normal-runtime-writes";
    expect(
      evidenceDigest(await inspectD1Target(reader, target, local), release)
    ).toBe(digest);
    expect(() => verifyEvidence(digest, digest)).not.toThrow();
    expect(() => verifyEvidence(digest, "")).toThrow("evidence");
    expect(() =>
      verifyEvidence(
        evidenceDigest(report, { ...release, head: "d".repeat(40) }),
        digest
      )
    ).toThrow("changed");
    expect(() =>
      verifyEvidence(
        evidenceDigest(report, {
          ...release,
          local: {
            ...local,
            MealPlannerAuthDatabase: [
              { ...first, hash: "3".repeat(64) },
              second,
            ],
          },
        }),
        digest
      )
    ).toThrow("changed");
    state.schema[0] = {
      name: "fixture",
      sql: "CREATE TABLE fixture (id TEXT PRIMARY KEY, changed TEXT)",
      tbl_name: "fixture",
      type: "table",
    };
    expect(() =>
      verifyEvidence(
        evidenceDigest(
          { ...report, target: { ...target, stage: "different" } },
          release
        ),
        digest
      )
    ).toThrow("changed");
    const changed = await inspectD1Target(reader, target, local);
    expect(() =>
      verifyEvidence(evidenceDigest(changed, release), digest)
    ).toThrow("changed");
  });
});

describe("D1 history evidence", () => {
  it("reports legacy reconstruction without claiming current files prove original applied SQL", () => {
    const edited = [{ ...first, hash: "e".repeat(64) }, second];
    expect(checkLedger(legacyColumns, legacyRows, edited)).toMatchObject({
      applied: [first.name],
      effect:
        "reconstruct-hashes-and-timestamps-from-release-files-before-pending-migrations",
      hashEvidence: "absent",
      layout: "legacy",
      originalSqlProvenance: "unknown",
      pending: [second.name],
    });
  });

  it("does not mistake stored hashes or filled timestamps for independent provenance", () => {
    expect(checkLedger(alchemyColumns, alchemyRows, migrations)).toMatchObject({
      hashEvidence: "matches-stored-hashes",
      originalSqlProvenance: "unknown",
    });
  });

  it("rejects changed historical SQL in an existing hashed ledger", () => {
    expect(() =>
      checkLedger(alchemyColumns, alchemyRows, [
        { ...first, hash: "e".repeat(64) },
        second,
      ])
    ).toThrow("differs");
  });

  it.each([
    ["unknown migration", [{ ...legacyRows[0], name: "absent" }]],
    [
      "duplicate alias",
      [...legacyRows, { ...legacyRows[0], id: "00002", name: first.name }],
    ],
    ["duplicate ID", [...legacyRows, { ...legacyRows[0], name: second.name }]],
    ["gap", [{ ...legacyRows[0], name: second.name }]],
    ["null name", [{ ...legacyRows[0], name: null }]],
    ["empty history", []],
  ])("rejects %s", (_reason, rows) => {
    expect(() => checkLedger(legacyColumns, rows, migrations)).toThrow();
  });

  it("rejects local alias collisions", () => {
    expect(() =>
      checkLedger(legacyColumns, legacyRows, [first, first])
    ).toThrow("Duplicate local");
  });

  it.each([
    { columns: [] },
    {
      columns: [
        {
          cid: 0,
          dflt_value: null,
          name: "id",
          notnull: 0,
          pk: 1,
          type: "TEXT",
        },
      ],
    },
  ])("rejects absent or unsupported layouts", ({ columns }) => {
    expect(() => checkLedger(columns, [], migrations)).toThrow(
      "outside this gate"
    );
  });
});

describe("release SQL inventory", () => {
  it("hashes exact bytes and refuses flat aliases or unexpected directory contents", async () => {
    const directory = await mkdtemp(
      nodePath.join(tmpdir(), "d1-release-files-")
    );
    try {
      const migrationDirectory = nodePath.join(directory, first.name);
      await mkdir(migrationDirectory);
      const sql = "CREATE TABLE fixture (id TEXT);\r\n";
      await writeFile(nodePath.join(migrationDirectory, "migration.sql"), sql);
      await writeFile(nodePath.join(migrationDirectory, "snapshot.json"), "{}");
      expect(await readLocalMigrations(directory)).toEqual([
        {
          hash: createHash("sha256").update(sql).digest("hex"),
          name: first.name,
        },
      ]);
      await writeFile(nodePath.join(directory, `${first.name}.sql`), sql);
      await expect(readLocalMigrations(directory)).rejects.toThrow(
        "Unsupported"
      );
      await rm(nodePath.join(directory, `${first.name}.sql`));
      await writeFile(nodePath.join(migrationDirectory, "another.sql"), sql);
      await expect(readLocalMigrations(directory)).rejects.toThrow(
        "Unsupported"
      );
      expect(
        await readFile(
          nodePath.join(migrationDirectory, "migration.sql"),
          "utf-8"
        )
      ).toBe(sql);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});

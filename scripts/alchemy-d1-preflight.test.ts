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
  inspectD1Target,
  parseD1Target,
  readLocalMigrations,
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
              { id: target.worker, tags: state.worker.tags },
              { id: "unrelated", tags: [] },
            ];
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
          return {
            ...Object.values(target.databases).find((db) =>
              path.endsWith(db.uuid)
            ),
            version: "production",
          };
        })()
      ),
    readState: (stage) => {
      calls.push({ path: `/state/${stage}`, sql: undefined });
      return Promise.resolve(state.executor);
    },
  };
  return { calls, reader, state };
};

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

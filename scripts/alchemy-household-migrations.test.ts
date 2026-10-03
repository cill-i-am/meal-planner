import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  applyAlchemyFormat,
  inlineSqlParams,
  MigrationError,
  readMigrationRecords,
} from "alchemy/SQL/Migrations/index";
import type { SqlExecutor } from "alchemy/SQL/Migrations/index";
import { Effect } from "effect";
import { expect, it } from "vitest";

const executor = (database: DatabaseSync): SqlExecutor => ({
  batch: (statements) =>
    Effect.try({
      catch: (cause) =>
        new MigrationError({ cause, message: "Test migration failed" }),
      try: () => {
        database.exec("BEGIN");
        try {
          for (const statement of statements) {
            database.exec(statement);
          }
          database.exec("COMMIT");
        } catch (error) {
          database.exec("ROLLBACK");
          throw error;
        }
      },
    }),
  dialect: "sqlite",
  query: (sql, params = []) =>
    Effect.try({
      catch: (cause) =>
        new MigrationError({ cause, message: "Test query failed" }),
      try: () => database.prepare(inlineSqlParams(sql, params, "sqlite")).all(),
    }),
});

it("adopts the existing Drizzle household ledger without replaying SQL or losing facts", async () => {
  const records = await Effect.runPromise(
    readMigrationRecords(
      fileURLToPath(
        new URL("../apps/api/household-migrations", import.meta.url)
      )
    ).pipe(Effect.provide(NodeServices.layer))
  );
  const database = new DatabaseSync(":memory:");
  try {
    database.exec(
      "CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY, hash text NOT NULL, created_at numeric, name text, applied_at TEXT)"
    );
    for (const record of records) {
      for (const statement of record.statements) {
        database.exec(statement);
      }
      database
        .prepare(
          "INSERT INTO __drizzle_migrations(hash, created_at, name, applied_at) VALUES ('', ?, ?, '2026-10-01')"
        )
        .run(record.createdAtMillis ?? null, record.name);
    }
    database
      .prepare(
        "INSERT INTO household_meta(created_at_epoch_ms, organization_id, singleton_key) VALUES (1, 'existing-household', 'household')"
      )
      .run();
    const history = database
      .prepare("SELECT * FROM __drizzle_migrations ORDER BY id")
      .all();
    const migrate = applyAlchemyFormat({
      executor: executor(database),
      records,
      table: "__drizzle_migrations",
    });
    await Effect.runPromise(migrate);
    await Effect.runPromise(migrate);
    expect(
      database.prepare("SELECT * FROM __drizzle_migrations ORDER BY id").all()
    ).toEqual(history);
    expect(
      database.prepare("SELECT organization_id FROM household_meta").get()
    ).toEqual({ organization_id: "existing-household" });
  } finally {
    database.close();
  }
});

it("rolls back a failing snapshot file and its history row", async () => {
  const database = new DatabaseSync(":memory:");
  try {
    const migration = applyAlchemyFormat({
      executor: executor(database),
      records: [
        {
          createdAtMillis: 1,
          hash: "test",
          name: "broken",
          sql: "",
          statements: [
            "CREATE TABLE temporary_fact(id INTEGER)",
            "INSERT INTO missing_table VALUES (1)",
          ],
        },
      ],
      table: "__drizzle_migrations",
    });
    const exit = await Effect.runPromiseExit(migration);
    expect(exit._tag).toBe("Failure");
    expect(
      database
        .prepare("SELECT name FROM sqlite_master WHERE name = 'temporary_fact'")
        .all()
    ).toEqual([]);
    expect(
      database.prepare("SELECT * FROM __drizzle_migrations").all()
    ).toEqual([]);
  } finally {
    database.close();
  }
});

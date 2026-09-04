import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";

import type * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import type * as HttpBody from "effect/unstable/http/HttpBody";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";
import { describe, expect, it } from "vitest";

interface CloudflareCredentials {
  readonly apiBaseUrl: string;
  readonly type: "apiToken";
}

interface CloudflareCredentialsRequirement {
  readonly CloudflareCredentialsRequirement: unique symbol;
}

interface CredentialsModule {
  readonly Credentials: Context.Service<
    CloudflareCredentialsRequirement,
    Effect.Effect<CloudflareCredentials>
  >;
  readonly apiTokenCredentials: (options: {
    readonly apiBaseUrl: string;
    readonly apiToken: string;
  }) => CloudflareCredentials;
}

interface MigrationFile {
  readonly hash: string;
  readonly id: string;
  readonly sql: string;
}

const triggerMigrationFixture = [
  {
    hash: "fixture-initial",
    id: "0000_fixture_records.sql",
    sql: `CREATE TABLE fixture_records (
      id TEXT PRIMARY KEY,
      state TEXT NOT NULL
    );`,
  },
  {
    hash: "fixture-events",
    id: "0001_fixture_events.sql",
    sql: `CREATE TABLE fixture_events (
      dispatch_id TEXT NOT NULL,
      record_id TEXT PRIMARY KEY,
      FOREIGN KEY (record_id) REFERENCES fixture_records(id)
    );`,
  },
  {
    hash: "fixture-triggers",
    id: "0002_fixture_triggers.sql",
    sql: `CREATE TRIGGER fixture_events_advance_record
      AFTER INSERT ON fixture_events
      FOR EACH ROW
      BEGIN
        UPDATE fixture_records SET state = 'advanced' WHERE id = NEW.record_id;
      END;
    --> statement-breakpoint
    CREATE TRIGGER fixture_events_identity_immutable
      BEFORE UPDATE OF dispatch_id ON fixture_events
      FOR EACH ROW
      WHEN NEW.dispatch_id <> OLD.dispatch_id
      BEGIN
        SELECT RAISE(ABORT, 'fixture event identity is immutable');
      END;`,
  },
] as const satisfies readonly MigrationFile[];

interface SqlExecutor {
  readonly dialect: "sqlite";
  readonly query: (
    sql: string
  ) => Effect.Effect<Record<string, unknown>[], unknown>;
  readonly batch: (
    statements: readonly string[]
  ) => Effect.Effect<void, unknown>;
}
interface ApplyMigrationsModule {
  readonly makeCloudD1MigrationExecutor: (options: {
    readonly accountId: string;
    readonly databaseId: string;
  }) => Effect.Effect<
    SqlExecutor,
    unknown,
    CloudflareCredentialsRequirement | HttpClient.HttpClient
  >;
}
interface AlchemyFormatModule {
  readonly applyAlchemyFormat: (options: {
    readonly executor: SqlExecutor;
    readonly table: string;
    readonly records: readonly {
      readonly name: string;
      readonly hash: string;
      readonly createdAtMillis: undefined;
      readonly sql: string;
      readonly statements: readonly string[];
    }[];
  }) => Effect.Effect<void, unknown>;
}

interface D1QueryBody {
  readonly batch?: readonly { readonly sql: string }[];
  readonly sql?: string;
}

interface D1ImportBody {
  readonly action: "ingest" | "init" | "poll";
  readonly current_bookmark?: string;
  readonly etag?: string;
  readonly filename?: string;
}

interface RecordedD1Transport {
  readonly importFiles: string[];
  readonly queryBodies: D1QueryBody[];
}

interface LoadedAlchemyD1Modules {
  readonly applyMigrationsModule: ApplyMigrationsModule;
  readonly formatModule: AlchemyFormatModule;
  readonly credentialsModule: CredentialsModule;
}

const decodeRequestBody = (body: HttpBody.HttpBody): D1QueryBody => {
  if (body._tag !== "Uint8Array") {
    throw new TypeError(`Expected a JSON request body, received ${body._tag}`);
  }
  return JSON.parse(new TextDecoder().decode(body.body)) as D1QueryBody;
};

const decodeImportBody = (body: HttpBody.HttpBody): D1ImportBody =>
  decodeRequestBody(body) as unknown as D1ImportBody;

const loadAlchemyD1Modules = async (): Promise<LoadedAlchemyD1Modules> => {
  const cloudflareEntry = import.meta.resolve("alchemy/Cloudflare");
  const applyMigrationsUrl = new URL("D1/ApplyMigrations.js", cloudflareEntry);
  const requireFromAlchemy = createRequire(applyMigrationsUrl);
  const credentialsUrl = pathToFileURL(
    requireFromAlchemy.resolve("@distilled.cloud/cloudflare/Credentials")
  );

  const [applyMigrationsModule, credentialsModule, formatModule] =
    await Promise.all([
      import(applyMigrationsUrl.href) as Promise<ApplyMigrationsModule>,
      import(credentialsUrl.href) as Promise<CredentialsModule>,
      import(
        new URL("../SQL/Migrations/AlchemyFormat.js", cloudflareEntry).href
      ) as Promise<AlchemyFormatModule>,
    ]);

  return { applyMigrationsModule, credentialsModule, formatModule };
};

const loadCheckedInMigrations = async (
  directory: string
): Promise<readonly MigrationFile[]> => {
  const migrationsDirectory = new URL(
    `../apps/api/${directory}/`,
    import.meta.url
  );
  const directoryEntries = await readdir(migrationsDirectory, {
    recursive: true,
  });
  const names = directoryEntries
    .filter((name) => name.endsWith(".sql"))
    .toSorted();

  return Promise.all(
    names.map(async (id) => ({
      hash: "not-used-by-apply-migrations",
      id,
      sql: await readFile(new URL(id, migrationsDirectory), "utf-8"),
    }))
  );
};

const splitMigrationStatements = (sql: string): readonly string[] =>
  sql
    .split(/--> statement-breakpoint(?:\r?\n)?/u)
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);

const migrationLedgerStatement = (
  migration: MigrationFile,
  index: number
): string =>
  `INSERT INTO d1_migrations (id, name, applied_at) VALUES ('${(index + 1).toString().padStart(5, "0")}', '${migration.id}', datetime('now'));`;

const executeAtomically = (
  database: DatabaseSync,
  statements: readonly string[]
): void => {
  database.exec("BEGIN IMMEDIATE;");
  try {
    for (const statement of statements) {
      database.exec(statement);
    }
    database.exec("COMMIT;");
  } catch (error) {
    database.exec("ROLLBACK;");
    throw error;
  }
};

const splitD1SqlBatch = (sql: string): readonly string[] =>
  sql
    .split(";")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0)
    .map((statement) => `${statement};`);

const executeThroughD1Query = (
  database: DatabaseSync,
  statements: readonly string[]
): void =>
  executeAtomically(
    database,
    statements.flatMap((statement) => splitD1SqlBatch(statement))
  );

const seedMigrationHistory = (
  database: DatabaseSync,
  migrations: readonly MigrationFile[]
): void => {
  database.exec(`CREATE TABLE d1_migrations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL
  );`);
  for (const [index, migration] of migrations.entries()) {
    executeAtomically(database, [
      ...splitMigrationStatements(migration.sql),
      migrationLedgerStatement(migration, index),
    ]);
  }
  database.exec("PRAGMA foreign_keys=ON;");
};

const runApplyMigrations = async (
  modules: LoadedAlchemyD1Modules,
  migrationsFiles: readonly MigrationFile[],
  client: HttpClient.HttpClient
): Promise<void> => {
  const credentials = modules.credentialsModule.apiTokenCredentials({
    apiBaseUrl: "https://cloudflare.invalid/client/v4",
    apiToken: "local-test-placeholder",
  });

  await modules.applyMigrationsModule
    .makeCloudD1MigrationExecutor({
      accountId: "local-account",
      databaseId: "local-database",
    })
    .pipe(
      Effect.flatMap((executor) =>
        modules.formatModule.applyAlchemyFormat({
          executor,
          records: migrationsFiles.map((migration) => ({
            createdAtMillis: undefined,
            hash: createHash("sha256").update(migration.sql).digest("hex"),
            name: migration.id,
            sql: migration.sql,
            statements: splitMigrationStatements(migration.sql),
          })),
          table: "d1_migrations",
        })
      ),
      Effect.provideService(HttpClient.HttpClient, client),
      Effect.provideService(
        modules.credentialsModule.Credentials,
        Effect.succeed(credentials)
      ),
      Effect.runPromise
    );
};

const successfulD1Response = (
  request: Parameters<typeof HttpClientResponse.fromWeb>[0],
  results: readonly Record<string, unknown>[] = []
): HttpClientResponse.HttpClientResponse =>
  HttpClientResponse.fromWeb(
    request,
    Response.json({
      result: [{ meta: {}, results, success: true }],
    })
  );

const makeSemanticD1Client = (
  database: DatabaseSync,
  transport: RecordedD1Transport
): HttpClient.HttpClient =>
  HttpClient.make((request) =>
    Effect.sync(() => {
      const requestUrl = new URL(request.url);

      if (requestUrl.hostname === "d1-upload.invalid") {
        if (request.body._tag !== "Uint8Array") {
          throw new TypeError("Expected an uploaded SQL file");
        }
        const sql = new TextDecoder().decode(request.body.body);
        transport.importFiles.push(sql);
        return HttpClientResponse.fromWeb(
          request,
          new Response(null, {
            headers: {
              etag: `"${createHash("md5").update(sql).digest("hex")}"`,
            },
            status: 200,
          })
        );
      }

      if (requestUrl.pathname.endsWith("/import")) {
        const body = decodeImportBody(request.body);
        if (body.action === "init") {
          return HttpClientResponse.fromWeb(
            request,
            Response.json({
              result: {
                filename: `${body.etag}.sql`,
                status: "active",
                success: true,
                type: "import",
                upload_url: `https://d1-upload.invalid/${body.etag}.sql`,
              },
              success: true,
            })
          );
        }
        if (body.action === "ingest") {
          return HttpClientResponse.fromWeb(
            request,
            Response.json({
              result: {
                at_bookmark: "local-import-bookmark",
                status: "active",
                success: true,
                type: "import",
              },
              success: true,
            })
          );
        }
        if (body.action === "poll") {
          const sql = transport.importFiles.at(-1);
          if (sql === undefined) {
            throw new Error("Expected an uploaded SQL file before ingestion");
          }
          try {
            executeAtomically(database, [sql]);
            return HttpClientResponse.fromWeb(
              request,
              Response.json({
                result: {
                  result: { num_queries: splitMigrationStatements(sql).length },
                  status: "complete",
                  success: true,
                  type: "import",
                },
                success: true,
              })
            );
          } catch (error) {
            return HttpClientResponse.fromWeb(
              request,
              Response.json({
                result: {
                  error: error instanceof Error ? error.message : String(error),
                  status: "error",
                  success: false,
                  type: "import",
                },
                success: true,
              })
            );
          }
        }
        throw new Error(`Unexpected D1 import action: ${body.action}`);
      }

      const body = decodeRequestBody(request.body);
      transport.queryBodies.push(body);

      if (body.batch !== undefined) {
        try {
          executeThroughD1Query(
            database,
            body.batch.map(({ sql }) => sql)
          );
          return successfulD1Response(request);
        } catch (error) {
          return HttpClientResponse.fromWeb(
            request,
            Response.json(
              {
                errors: [
                  {
                    code: 7500,
                    message: `${error instanceof Error ? error.message : String(error)}: SQLITE_ERROR`,
                  },
                ],
                messages: [],
                success: false,
              },
              { status: 400 }
            )
          );
        }
      }
      if (body.sql === undefined) {
        throw new TypeError("Expected a D1 sql query");
      }

      const isRead =
        !body.sql.includes("INSERT INTO d1_migrations") &&
        /^\s*(?:PRAGMA|SELECT)\b/iu.test(body.sql);
      const results = isRead
        ? database.prepare(body.sql).all()
        : (executeThroughD1Query(database, [body.sql]), []);
      return successfulD1Response(request, results);
    })
  );

const isMigrationRequest = (body: D1QueryBody): boolean =>
  [body.sql, ...(body.batch?.map(({ sql }) => sql) ?? [])].some(
    (sql) => sql !== undefined && /INSERT INTO ["`]?d1_migrations\b/iu.test(sql)
  );

const migrationHistory = (database: DatabaseSync) =>
  database.prepare("SELECT name FROM d1_migrations ORDER BY id;").all();

describe("Alchemy D1 migration reconciliation", () => {
  it.each(["auth-migrations", "provider-accounting-migrations"])(
    "imports every checked-in %s migration as one marker-free SQL file",
    async (directory) => {
      const modules = await loadAlchemyD1Modules();
      const migrationsFiles = await loadCheckedInMigrations(directory);
      const database = new DatabaseSync(":memory:");
      try {
        const transport: RecordedD1Transport = {
          importFiles: [],
          queryBodies: [],
        };
        const client = makeSemanticD1Client(database, transport);

        await runApplyMigrations(modules, migrationsFiles, client);

        expect(transport.importFiles).toHaveLength(migrationsFiles.length + 1);
        expect(transport.queryBodies.filter(isMigrationRequest)).toHaveLength(
          0
        );

        for (const [index, migration] of migrationsFiles.entries()) {
          for (const statement of splitMigrationStatements(migration.sql)) {
            expect(transport.importFiles[index + 1]).toContain(statement);
          }
          expect(transport.importFiles[index + 1]).not.toContain(
            "--> statement-breakpoint"
          );
        }
      } finally {
        database.close();
      }
    }
  );

  it("imports trigger migrations atomically without skipping or duplicating the ledger", async () => {
    const modules = await loadAlchemyD1Modules();
    const migrationsFiles = triggerMigrationFixture;
    const [initialMigration, acquisitionMigration, speechMigration] =
      migrationsFiles;

    const database = new DatabaseSync(":memory:");
    try {
      seedMigrationHistory(database, [initialMigration, acquisitionMigration]);

      const speechStatements = [
        ...splitMigrationStatements(speechMigration.sql),
        migrationLedgerStatement(speechMigration, 2),
      ];
      expect(() => executeThroughD1Query(database, speechStatements)).toThrow(
        /incomplete input/u
      );
      expect(migrationHistory(database)).toEqual([
        { name: initialMigration.id },
        { name: acquisitionMigration.id },
      ]);
      expect(
        database
          .prepare(
            "SELECT count(*) AS count FROM sqlite_master WHERE name = 'fixture_events_advance_record';"
          )
          .get()
      ).toEqual({ count: 0 });

      const transport: RecordedD1Transport = {
        importFiles: [],
        queryBodies: [],
      };
      const client = makeSemanticD1Client(database, transport);

      await runApplyMigrations(modules, migrationsFiles, client);

      const expectedHistory = migrationsFiles.map((migration) => ({
        name: migration.id,
      }));
      const history = migrationHistory(database);
      expect(history).toEqual(expectedHistory);
      expect(new Set(history.map(({ name }) => name)).size).toBe(
        migrationsFiles.length
      );

      const recordId = "fixture-record-117";
      database
        .prepare("INSERT INTO fixture_records (id, state) VALUES (?, 'ready');")
        .run(recordId);
      database
        .prepare(
          "INSERT INTO fixture_events (record_id, dispatch_id) VALUES (?, ?);"
        )
        .run(recordId, "dispatch-117");
      expect(
        database
          .prepare("SELECT state FROM fixture_records WHERE id = ?;")
          .get(recordId)
      ).toEqual({ state: "advanced" });
      expect(() =>
        database
          .prepare(
            "UPDATE fixture_events SET dispatch_id = ? WHERE record_id = ?;"
          )
          .run("changed-dispatch", recordId)
      ).toThrow("fixture event identity is immutable");

      const firstRunImportCount = transport.importFiles.length;
      // Ledger conversion plus pending migration.
      expect(firstRunImportCount).toBe(2);
      expect(transport.queryBodies.filter(isMigrationRequest)).toHaveLength(0);

      await runApplyMigrations(modules, migrationsFiles, client);

      expect(transport.importFiles).toHaveLength(firstRunImportCount);
      expect(migrationHistory(database)).toEqual(expectedHistory);
    } finally {
      database.close();
    }
  });

  it("does not record a migration when an adversarial statement fails", async () => {
    const modules = await loadAlchemyD1Modules();
    const migrationsFiles = triggerMigrationFixture;
    const [initialMigration, acquisitionMigration, speechMigration] =
      migrationsFiles;

    const database = new DatabaseSync(":memory:");
    try {
      seedMigrationHistory(database, [initialMigration, acquisitionMigration]);
      const transport: RecordedD1Transport = {
        importFiles: [],
        queryBodies: [],
      };
      const client = makeSemanticD1Client(database, transport);
      const failingMigration = {
        ...speechMigration,
        sql: `${speechMigration.sql}\n--> statement-breakpoint\nTHIS IS NOT VALID SQL;`,
      };

      await expect(
        runApplyMigrations(
          modules,
          [initialMigration, acquisitionMigration, failingMigration],
          client
        )
      ).rejects.toThrow();

      expect(migrationHistory(database)).toEqual([
        { name: initialMigration.id },
        { name: acquisitionMigration.id },
      ]);
      expect(
        database
          .prepare(
            "SELECT count(*) AS count FROM sqlite_master WHERE name = 'fixture_events_advance_record';"
          )
          .get()
      ).toEqual({ count: 0 });

      await runApplyMigrations(modules, migrationsFiles, client);
      expect(migrationHistory(database)).toEqual(
        migrationsFiles.map((migration) => ({
          name: migration.id,
        }))
      );
    } finally {
      database.close();
    }
  });
});

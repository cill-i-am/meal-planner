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

interface ApplyMigrationsModule {
  readonly applyMigrations: (options: {
    readonly accountId: string;
    readonly databaseId: string;
    readonly migrationsFiles: readonly MigrationFile[];
    readonly migrationsTable: string;
  }) => Effect.Effect<
    void,
    unknown,
    CloudflareCredentialsRequirement | HttpClient.HttpClient
  >;
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

  const [applyMigrationsModule, credentialsModule] = await Promise.all([
    import(applyMigrationsUrl.href) as Promise<ApplyMigrationsModule>,
    import(credentialsUrl.href) as Promise<CredentialsModule>,
  ]);

  return { applyMigrationsModule, credentialsModule };
};

const loadCheckedInMigrations = async (): Promise<readonly MigrationFile[]> => {
  const migrationsDirectory = new URL(
    "../apps/api/migrations/",
    import.meta.url
  );
  const directoryEntries = await readdir(migrationsDirectory);
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
    .applyMigrations({
      accountId: "local-account",
      databaseId: "local-database",
      migrationsFiles,
      migrationsTable: "d1_migrations",
    })
    .pipe(
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
  body.sql?.includes("INSERT INTO d1_migrations") === true ||
  body.batch?.some(({ sql }) => sql.includes("INSERT INTO d1_migrations")) ===
    true;

const migrationHistory = (database: DatabaseSync) =>
  database.prepare("SELECT id, name FROM d1_migrations ORDER BY id;").all();

describe("Alchemy D1 migration reconciliation", () => {
  it("imports every checked-in migration as one marker-free SQL file", async () => {
    const modules = await loadAlchemyD1Modules();
    const migrationsFiles = await loadCheckedInMigrations();
    const database = new DatabaseSync(":memory:");
    try {
      const transport: RecordedD1Transport = {
        importFiles: [],
        queryBodies: [],
      };
      const client = makeSemanticD1Client(database, transport);

      await runApplyMigrations(modules, migrationsFiles, client);

      expect(transport.importFiles).toHaveLength(migrationsFiles.length);
      expect(transport.queryBodies.filter(isMigrationRequest)).toHaveLength(0);

      for (const [index, migration] of migrationsFiles.entries()) {
        const expectedFile = [
          ...splitMigrationStatements(migration.sql),
          migrationLedgerStatement(migration, index),
        ].join("\n");
        expect(transport.importFiles[index]).toBe(expectedFile);
        expect(transport.importFiles[index]).not.toContain(
          "--> statement-breakpoint"
        );
      }
    } finally {
      database.close();
    }
  });

  it("applies the trigger migration from 0000/0001 history without skipping or duplicating the ledger", async () => {
    const modules = await loadAlchemyD1Modules();
    const checkedInMigrations = await loadCheckedInMigrations();
    const migrationsFiles = checkedInMigrations.slice(0, 3);
    const [initialMigration, acquisitionMigration, speechMigration] =
      migrationsFiles;
    if (
      initialMigration === undefined ||
      acquisitionMigration === undefined ||
      speechMigration === undefined
    ) {
      throw new Error("Expected the 0000 through 0002 migrations");
    }

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
        { id: "00001", name: initialMigration.id },
        { id: "00002", name: acquisitionMigration.id },
      ]);
      expect(
        database
          .prepare(
            "SELECT count(*) AS count FROM sqlite_master WHERE name = 'import_transcriptions';"
          )
          .get()
      ).toEqual({ count: 0 });

      const transport: RecordedD1Transport = {
        importFiles: [],
        queryBodies: [],
      };
      const client = makeSemanticD1Client(database, transport);

      await runApplyMigrations(modules, migrationsFiles, client);

      const expectedHistory = migrationsFiles.map((migration, index) => ({
        id: (index + 1).toString().padStart(5, "0"),
        name: migration.id,
      }));
      const history = migrationHistory(database);
      expect(history).toEqual(expectedHistory);
      expect(new Set(history.map(({ name }) => name)).size).toBe(
        migrationsFiles.length
      );

      const importId = "018f47ad-91aa-7c35-b6fe-000000000117";
      const evidence = JSON.stringify([
        {
          kind: "original_media",
          referenceId: `imports/${importId}/acquisition/v1/generations/0/original.mp4`,
        },
        {
          kind: "acquisition_manifest",
          referenceId: `imports/${importId}/acquisition/v1/generations/0/manifest.json`,
        },
      ]);
      database
        .prepare(
          `INSERT INTO recipe_imports (
            acquisition_generation, canonical_source_id,
            compatibility_fingerprint, created_at, evidence_references_json,
            id, source_kind, status, updated_at
          ) VALUES (0, ?, ?, ?, ?, ?, 'tiktok', 'acquired', ?);`
        )
        .run(
          "7520000000000000117",
          "compatibility-fingerprint",
          "2026-07-22T10:00:00.000Z",
          evidence,
          importId,
          "2026-07-22T10:00:00.000Z"
        );
      database
        .prepare(
          `INSERT INTO import_transcriptions (
            import_id, acquisition_generation, dispatch_id,
            source_media_sha256, state, created_at, updated_at
          ) VALUES (?, 0, ?, ?, 'dispatching', ?, ?);`
        )
        .run(
          importId,
          "dispatch-117",
          "a".repeat(64),
          "2026-07-22T10:01:00.000Z",
          "2026-07-22T10:01:00.000Z"
        );
      expect(
        database
          .prepare("SELECT status FROM recipe_imports WHERE id = ?;")
          .get(importId)
      ).toEqual({ status: "transcribing" });
      expect(() =>
        database
          .prepare(
            "UPDATE import_transcriptions SET dispatch_id = ? WHERE import_id = ?;"
          )
          .run("changed-dispatch", importId)
      ).toThrow("import transcription identity is immutable");

      const firstRunImportCount = transport.importFiles.length;
      expect(firstRunImportCount).toBe(1);
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
    const checkedInMigrations = await loadCheckedInMigrations();
    const migrationsFiles = checkedInMigrations.slice(0, 3);
    const [initialMigration, acquisitionMigration, speechMigration] =
      migrationsFiles;
    if (
      initialMigration === undefined ||
      acquisitionMigration === undefined ||
      speechMigration === undefined
    ) {
      throw new Error("Expected the 0000 through 0002 migrations");
    }

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
        { id: "00001", name: initialMigration.id },
        { id: "00002", name: acquisitionMigration.id },
      ]);
      expect(
        database
          .prepare(
            "SELECT count(*) AS count FROM sqlite_master WHERE name = 'import_transcriptions';"
          )
          .get()
      ).toEqual({ count: 0 });

      await runApplyMigrations(modules, migrationsFiles, client);
      expect(migrationHistory(database)).toEqual(
        migrationsFiles.map((migration, index) => ({
          id: (index + 1).toString().padStart(5, "0"),
          name: migration.id,
        }))
      );
    } finally {
      database.close();
    }
  });
});

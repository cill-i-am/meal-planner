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
  requestBodies: D1QueryBody[]
): HttpClient.HttpClient =>
  HttpClient.make((request) =>
    Effect.sync(() => {
      const body = decodeRequestBody(request.body);
      requestBodies.push(body);

      if (body.batch !== undefined) {
        executeAtomically(
          database,
          body.batch.map(({ sql }) => sql)
        );
        return successfulD1Response(request);
      }
      if (body.sql === undefined) {
        throw new TypeError("Expected a D1 sql query");
      }

      const isRead =
        !body.sql.includes("INSERT INTO d1_migrations") &&
        /^\s*(?:PRAGMA|SELECT)\b/iu.test(body.sql);
      const results = isRead
        ? database.prepare(body.sql).all()
        : (executeAtomically(database, splitD1SqlBatch(body.sql)), []);
      return successfulD1Response(request, results);
    })
  );

const isMigrationRequest = (body: D1QueryBody): boolean =>
  body.sql?.includes("INSERT INTO d1_migrations") === true ||
  body.batch?.some(({ sql }) => sql.includes("INSERT INTO d1_migrations")) ===
    true;

const migrationHistory = (database: DatabaseSync) =>
  database
    .prepare("SELECT id, name FROM d1_migrations ORDER BY id;")
    .all();

describe("Alchemy D1 migration reconciliation", () => {
  it("submits every checked-in migration as one atomic D1 statement batch", async () => {
    const modules = await loadAlchemyD1Modules();
    const migrationsFiles = await loadCheckedInMigrations();
    const requestBodies: D1QueryBody[] = [];
    const client = HttpClient.make((request) => {
      requestBodies.push(decodeRequestBody(request.body));
      return Effect.succeed(successfulD1Response(request));
    });

    await runApplyMigrations(modules, migrationsFiles, client);

    const migrationRequests = requestBodies.filter(isMigrationRequest);
    expect(migrationRequests).toHaveLength(migrationsFiles.length);

    for (const [index, migration] of migrationsFiles.entries()) {
      const request = migrationRequests[index];
      const expectedBatch = [
        ...splitMigrationStatements(migration.sql),
        migrationLedgerStatement(migration, index),
      ].map((sql) => ({ sql }));

      expect(request?.sql).toBeUndefined();
      expect(request?.batch).toEqual(expectedBatch);
      expect(request?.batch).not.toContainEqual({
        sql: expect.stringContaining("--> statement-breakpoint"),
      });
    }
  });

  it("applies the trigger migration from 0000/0001 history without skipping or duplicating the ledger", async () => {
    const modules = await loadAlchemyD1Modules();
    const migrationsFiles = (await loadCheckedInMigrations()).slice(0, 3);
    const [initialMigration, acquisitionMigration] = migrationsFiles;
    if (initialMigration === undefined || acquisitionMigration === undefined) {
      throw new Error("Expected the 0000 and 0001 migrations");
    }

    const database = new DatabaseSync(":memory:");
    try {
      seedMigrationHistory(database, [initialMigration, acquisitionMigration]);

      const requestBodies: D1QueryBody[] = [];
      const client = makeSemanticD1Client(database, requestBodies);

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

      const firstRunMigrationRequestCount =
        requestBodies.filter(isMigrationRequest).length;
      expect(firstRunMigrationRequestCount).toBe(1);

      await runApplyMigrations(modules, migrationsFiles, client);

      const totalMigrationRequestCount =
        requestBodies.filter(isMigrationRequest).length;
      expect(totalMigrationRequestCount).toBe(firstRunMigrationRequestCount);
      expect(migrationHistory(database)).toEqual(expectedHistory);
    } finally {
      database.close();
    }
  });

  it("does not record a migration when an adversarial statement fails", async () => {
    const modules = await loadAlchemyD1Modules();
    const migrationsFiles = (await loadCheckedInMigrations()).slice(0, 3);
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
      const requestBodies: D1QueryBody[] = [];
      const client = makeSemanticD1Client(database, requestBodies);
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

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

describe("Alchemy D1 migration reconciliation", () => {
  it("submits every checked-in migration as one complete D1 query", async () => {
    const modules = await loadAlchemyD1Modules();
    const migrationsFiles = await loadCheckedInMigrations();
    const requestBodies: D1QueryBody[] = [];
    const client = HttpClient.make((request) => {
      requestBodies.push(decodeRequestBody(request.body));
      return Effect.succeed(successfulD1Response(request));
    });

    await runApplyMigrations(modules, migrationsFiles, client);

    const migrationRequests = requestBodies.filter((body) =>
      body.sql?.includes("INSERT INTO d1_migrations")
    );
    expect(migrationRequests).toHaveLength(migrationsFiles.length);

    for (const [index, migration] of migrationsFiles.entries()) {
      const request = migrationRequests[index];
      const expectedSql = [
        ...splitMigrationStatements(migration.sql),
        migrationLedgerStatement(migration, index),
      ].join("\n");

      expect(request?.batch).toBeUndefined();
      expect(request?.sql).toBe(expectedSql);
      expect(request?.sql).not.toContain("--> statement-breakpoint");
    }
  });

  it("resumes a partially applied migration series without skipped or duplicate history", async () => {
    const modules = await loadAlchemyD1Modules();
    const migrationsFiles = await loadCheckedInMigrations();
    const firstMigration = migrationsFiles[0];
    expect(firstMigration).toBeDefined();
    if (firstMigration === undefined) {
      return;
    }

    const database = new DatabaseSync(":memory:");
    try {
      database.exec(`CREATE TABLE d1_migrations (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );`);
      database.exec(splitMigrationStatements(firstMigration.sql).join("\n"));
      database
        .prepare(
          "INSERT INTO d1_migrations (id, name, applied_at) VALUES (?, ?, datetime('now'));"
        )
        .run("00001", firstMigration.id);

      const requestBodies: D1QueryBody[] = [];
      const client = HttpClient.make((request) => {
        const body = decodeRequestBody(request.body);
        requestBodies.push(body);

        if (body.batch !== undefined) {
          return Effect.succeed(
            HttpClientResponse.fromWeb(
              request,
              Response.json(
                {
                  errors: [
                    { code: 7500, message: "incomplete input: SQLITE_ERROR" },
                  ],
                  messages: [],
                  result: null,
                  success: false,
                },
                { status: 400 }
              )
            )
          );
        }

        if (body.sql === undefined) {
          throw new TypeError("Expected a D1 sql query");
        }

        const isRead =
          !body.sql.includes("INSERT INTO d1_migrations") &&
          /^\s*(?:PRAGMA|SELECT)\b/iu.test(body.sql);
        const results = isRead
          ? database.prepare(body.sql).all()
          : (database.exec(body.sql), []);
        return Effect.succeed(successfulD1Response(request, results));
      });

      await runApplyMigrations(modules, migrationsFiles, client);

      const expectedHistory = migrationsFiles.map((migration, index) => ({
        id: (index + 1).toString().padStart(5, "0"),
        name: migration.id,
      }));
      const history = database
        .prepare("SELECT id, name FROM d1_migrations ORDER BY id;")
        .all();
      expect(history).toEqual(expectedHistory);
      expect(new Set(history.map(({ name }) => name)).size).toBe(
        migrationsFiles.length
      );

      const firstRunMigrationRequestCount = requestBodies.filter((body) =>
        body.sql?.includes("INSERT INTO d1_migrations")
      ).length;
      expect(firstRunMigrationRequestCount).toBe(migrationsFiles.length - 1);

      await runApplyMigrations(modules, migrationsFiles, client);

      const totalMigrationRequestCount = requestBodies.filter((body) =>
        body.sql?.includes("INSERT INTO d1_migrations")
      ).length;
      expect(totalMigrationRequestCount).toBe(firstRunMigrationRequestCount);
      expect(
        database
          .prepare("SELECT id, name FROM d1_migrations ORDER BY id;")
          .all()
      ).toEqual(expectedHistory);
    } finally {
      database.close();
    }
  });
});

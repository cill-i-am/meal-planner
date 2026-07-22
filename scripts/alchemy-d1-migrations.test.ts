import { readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
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

const decodeRequestBody = (body: HttpBody.HttpBody): D1QueryBody => {
  if (body._tag !== "Uint8Array") {
    throw new TypeError(`Expected a JSON request body, received ${body._tag}`);
  }
  return JSON.parse(new TextDecoder().decode(body.body)) as D1QueryBody;
};

const loadAlchemyD1Modules = async () => {
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

  return { applyMigrationsModule, credentialsModule } as const;
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

describe("Alchemy D1 migration reconciliation", () => {
  it("submits every checked-in migration as a D1 statement batch", async () => {
    const { applyMigrationsModule, credentialsModule } =
      await loadAlchemyD1Modules();
    const migrationsFiles = await loadCheckedInMigrations();
    const requestBodies: D1QueryBody[] = [];
    const client = HttpClient.make((request) => {
      requestBodies.push(decodeRequestBody(request.body));
      return Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          Response.json({
            result: [{ meta: {}, results: [], success: true }],
          })
        )
      );
    });
    const credentials = credentialsModule.apiTokenCredentials({
      apiBaseUrl: "https://cloudflare.invalid/client/v4",
      apiToken: "local-test-placeholder",
    });

    await applyMigrationsModule
      .applyMigrations({
        accountId: "local-account",
        databaseId: "local-database",
        migrationsFiles,
        migrationsTable: "d1_migrations",
      })
      .pipe(
        Effect.provideService(HttpClient.HttpClient, client),
        Effect.provideService(
          credentialsModule.Credentials,
          Effect.succeed(credentials)
        ),
        Effect.runPromise
      );

    const migrationRequests = requestBodies.filter(
      (body) => body.batch !== undefined
    );
    expect(migrationRequests).toHaveLength(migrationsFiles.length);

    for (const [index, migration] of migrationsFiles.entries()) {
      const request = migrationRequests[index];
      const expectedStatements = migration.sql
        .split(/--> statement-breakpoint(?:\r?\n)?/u)
        .map((statement) => statement.trim())
        .filter((statement) => statement.length > 0);

      expect(request?.sql).toBeUndefined();
      expect(request?.batch?.slice(0, -1)).toEqual(
        expectedStatements.map((sql) => ({ sql }))
      );
      expect(request?.batch?.at(-1)?.sql).toContain(
        `VALUES ('${(index + 1).toString().padStart(5, "0")}', '${migration.id}'`
      );
    }
  });
});

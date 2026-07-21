import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { readD1Migrations } from "@cloudflare/vitest-pool-workers";
import type { AnyD1Database } from "drizzle-orm/d1";
import { Effect, Layer, Redacted, Schema } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { Miniflare } from "miniflare";
import { afterEach, describe, expect, it } from "vitest";

import { ImportAuthorizer, makeImportAuthorizer } from "./import.auth.js";
import {
  CreateImportResponse,
  GetImportResponse,
  ImportId,
  ImportTimestamp,
  SourceCanonicalId,
} from "./import.contracts.js";
import { makeD1ImportRepository } from "./import.repository.d1.js";
import { ImportRepository } from "./import.repository.js";
import type { ImportRepositoryShape } from "./import.repository.js";
import { ImportRoutes } from "./import.routes.js";
import { ImportService, makeImportService } from "./import.service.js";
import type { ImportWorkflowStarterShape } from "./import.workflow.js";
import type { SourceAvailabilityValidatorShape } from "./source-availability.js";
import type { CanonicalSourceIdentityResolverShape } from "./source-identity.js";
import { ValidatedVideoUrl } from "./source-identity.js";

const temporaryDirectories: string[] = [];
const apiToken = "restart-test-token";
const timestamp = Schema.decodeUnknownSync(ImportTimestamp)(
  "2026-07-20T10:00:00.000Z"
);
const decodeCreateResponse = Schema.decodeUnknownSync(CreateImportResponse);
const decodeGetResponse = Schema.decodeUnknownSync(GetImportResponse);
const decodeCanonicalId = Schema.decodeUnknownSync(SourceCanonicalId);
const decodeVideoUrl = Schema.decodeUnknownSync(ValidatedVideoUrl);

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true }))
  );
});

const makeRuntime = (persistenceDirectory: string) =>
  new Miniflare({
    compatibilityDate: "2026-07-14",
    d1Databases: { MealPlannerDatabase: "meal-planner-restart-test" },
    d1Persist: persistenceDirectory,
    modules: true,
    script:
      "export default { fetch() { return new Response('local D1 test'); } }",
  });

interface ApplicationCounters {
  acceptRequests: number;
  availabilityCalls: number;
  identityProviderCalls: number;
  newIds: number;
  readonly workflowStarts: string[];
}

const makeCounters = (): ApplicationCounters => ({
  acceptRequests: 0,
  availabilityCalls: 0,
  identityProviderCalls: 0,
  newIds: 0,
  workflowStarts: [],
});

const makeApplication = async (
  database: AnyD1Database,
  counters: ApplicationCounters
) => {
  const d1Repository = makeD1ImportRepository(database);
  const repository: ImportRepositoryShape = {
    ...d1Repository,
    acceptRequest: (command) =>
      Effect.sync(() => {
        counters.acceptRequests += 1;
      }).pipe(Effect.andThen(d1Repository.acceptRequest(command))),
  };
  const identityResolver: CanonicalSourceIdentityResolverShape = {
    resolve: (source) =>
      Effect.sync(() => {
        counters.identityProviderCalls += 1;
        const match = /\/video\/(?<canonicalId>\d+)/u.exec(source.url);
        const canonicalId = match?.groups?.["canonicalId"];
        if (canonicalId === undefined) {
          throw new Error("Invalid restart test source");
        }
        return {
          _tag: "VideoIdentity" as const,
          identity: {
            canonicalId: decodeCanonicalId(canonicalId),
            kind: "tiktok" as const,
          },
          videoUrl: decodeVideoUrl(source.url),
        };
      }),
  };
  const availabilityValidator: SourceAvailabilityValidatorShape = {
    validate: () =>
      Effect.sync(() => {
        counters.availabilityCalls += 1;
        return { _tag: "Available" as const };
      }),
  };
  const workflowStarter: ImportWorkflowStarterShape = {
    ensureStarted: (importId) =>
      Effect.sync(() => {
        counters.workflowStarts.push(importId);
        return "already_active" as const;
      }),
  };
  const service = makeImportService({
    availabilityValidator,
    identityResolver,
    newId: () => {
      counters.newIds += 1;
      return Schema.decodeUnknownSync(ImportId)(
        `018f47ad-91aa-7c35-b6fe-${String(counters.newIds).padStart(12, "0")}`
      );
    },
    now: () => timestamp,
    repository,
    workflowStarter,
  });
  const authorizer = await Effect.runPromise(
    makeImportAuthorizer(Redacted.make(apiToken))
  );

  return HttpRouter.toWebHandler(
    Layer.mergeAll(
      ImportRoutes,
      Layer.succeed(ImportAuthorizer, ImportAuthorizer.of(authorizer)),
      Layer.succeed(ImportRepository, ImportRepository.of(repository)),
      Layer.succeed(ImportService, ImportService.of(service))
    ),
    { disableLogger: true }
  );
};

const postImport = async (
  handler: (request: Request) => Promise<Response>,
  key: string,
  url: string
) => {
  const response = await handler(
    new Request("https://meal-planner.test/imports", {
      body: JSON.stringify({ source: { kind: "tiktok", url } }),
      headers: {
        authorization: `Bearer ${apiToken}`,
        "content-type": "application/json",
        "idempotency-key": key,
      },
      method: "POST",
    })
  );
  return {
    body: decodeCreateResponse(await response.json()),
    status: response.status,
  };
};

const getImport = async (
  handler: (request: Request) => Promise<Response>,
  importId: string
) => {
  const response = await handler(
    new Request(`https://meal-planner.test/imports/${importId}`, {
      headers: { authorization: `Bearer ${apiToken}` },
    })
  );
  return {
    body: decodeGetResponse(await response.json()),
    status: response.status,
  };
};

describe("D1 restart persistence", () => {
  it("upgrades populated GAIA-108 rows without losing request ownership", async () => {
    const persistenceDirectory = await mkdtemp(
      `${tmpdir()}/meal-planner-gaia-109-upgrade-`
    );
    temporaryDirectories.push(persistenceDirectory);
    const migrations = await readD1Migrations(
      fileURLToPath(new URL("../../../migrations", import.meta.url))
    );
    const [initialMigration, acquisitionMigration] = migrations;
    if (initialMigration === undefined || acquisitionMigration === undefined) {
      throw new Error("Expected both import migrations");
    }
    const runtime = makeRuntime(persistenceDirectory);
    const database = await runtime.getD1Database("MealPlannerDatabase");
    try {
      await database.batch(
        initialMigration.queries.map((query) => database.prepare(query))
      );
      await database
        .prepare(
          `INSERT INTO recipe_imports (
            id, source_kind, canonical_source_id, compatibility_fingerprint,
            status, status_code, recovery_action, evidence_references_json,
            created_at, updated_at
          ) VALUES (?, 'tiktok', ?, ?, 'queued', NULL, NULL, ?, ?, ?)`
        )
        .bind(
          "018f47ad-91aa-7c35-b6fe-000000000901",
          "7520000000000000901",
          "legacy-compatibility",
          '[{"kind":"source_metadata","referenceId":"legacy-ref"}]',
          "2026-07-19T10:00:00.000Z",
          "2026-07-19T10:00:00.000Z"
        )
        .run();
      await database
        .prepare(
          `INSERT INTO import_requests (
            created_at, idempotency_key_hash, import_id,
            request_fingerprint, source_locator_hash
          ) VALUES (?, ?, ?, ?, ?)`
        )
        .bind(
          "2026-07-19T10:00:00.000Z",
          "legacy-key",
          "018f47ad-91aa-7c35-b6fe-000000000901",
          "legacy-request",
          "legacy-locator"
        )
        .run();

      await database.batch(
        acquisitionMigration.queries.map((query) => database.prepare(query))
      );
      const upgraded = await database
        .prepare(
          `SELECT recipe_imports.evidence_references_json,
                  recipe_imports.acquisition_generation,
                  import_requests.import_id
             FROM recipe_imports
             JOIN import_requests ON import_requests.import_id = recipe_imports.id
            WHERE recipe_imports.id = ?`
        )
        .bind("018f47ad-91aa-7c35-b6fe-000000000901")
        .first<{
          acquisition_generation: number;
          evidence_references_json: string;
          import_id: string;
        }>();

      expect(upgraded).toEqual({
        acquisition_generation: 0,
        evidence_references_json: "[]",
        import_id: "018f47ad-91aa-7c35-b6fe-000000000901",
      });
      const foreignKeyViolations = await database
        .prepare("PRAGMA foreign_key_check")
        .all();
      const foreignKeys = await database
        .prepare("PRAGMA foreign_key_list('import_requests')")
        .all<{
          from: string;
          on_delete: string;
          on_update: string;
          table: string;
          to: string;
        }>();
      const indexes = await database
        .prepare("PRAGMA index_list('import_requests')")
        .all<{ name: string }>();

      expect(foreignKeyViolations.results).toEqual([]);
      expect(foreignKeys.results).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            from: "import_id",
            on_delete: "RESTRICT",
            on_update: "RESTRICT",
            table: "recipe_imports",
            to: "id",
          }),
        ])
      );
      expect(
        (indexes.results as { readonly name: string }[]).map(({ name }) => name)
      ).toContain("import_requests_import_id_index");
    } finally {
      await runtime.dispose();
    }
  });

  it("persists the generation fence across a runtime restart and allocates strictly newer", async () => {
    const persistenceDirectory = await mkdtemp(
      `${tmpdir()}/meal-planner-gaia-109-generation-`
    );
    temporaryDirectories.push(persistenceDirectory);
    const migrations = await readD1Migrations(
      fileURLToPath(new URL("../../../migrations", import.meta.url))
    );
    const importId = Schema.decodeUnknownSync(ImportId)(
      "018f47ad-91aa-7c35-b6fe-000000000902"
    );
    const runtimeA = makeRuntime(persistenceDirectory);
    const databaseA = await runtimeA.getD1Database("MealPlannerDatabase");
    try {
      await databaseA.batch(
        migrations.flatMap((migration) =>
          migration.queries.map((query) => databaseA.prepare(query))
        )
      );
      await databaseA
        .prepare(
          `INSERT INTO recipe_imports (
            id, source_kind, canonical_source_id, compatibility_fingerprint,
            status, status_code, recovery_action, evidence_references_json,
            created_at, updated_at
          ) VALUES (?, 'tiktok', ?, ?, 'queued', NULL, NULL, '[]', ?, ?)`
        )
        .bind(
          importId,
          "7520000000000000902",
          "a".repeat(64),
          "2026-07-20T10:00:00.000Z",
          "2026-07-20T10:00:00.000Z"
        )
        .run();
      const repositoryA = makeD1ImportRepository(databaseA);
      await Effect.runPromise(repositoryA.claimAcquisition(importId));
      await expect(
        Effect.runPromise(repositoryA.beginAcquisitionAttempt(importId))
      ).resolves.toMatchObject({ generation: 1 });
      await expect(
        Effect.runPromise(repositoryA.beginAcquisitionAttempt(importId))
      ).resolves.toMatchObject({ generation: 2 });
    } finally {
      await runtimeA.dispose();
    }

    const runtimeB = makeRuntime(persistenceDirectory);
    const databaseB = await runtimeB.getD1Database("MealPlannerDatabase");
    try {
      const repositoryB = makeD1ImportRepository(databaseB);
      const stored = await Effect.runPromise(repositoryB.findById(importId));
      expect(stored).toMatchObject({
        value: { acquisitionGeneration: 2 },
      });
      await expect(
        Effect.runPromise(repositoryB.beginAcquisitionAttempt(importId))
      ).resolves.toMatchObject({ generation: 3 });
    } finally {
      await runtimeB.dispose();
    }
  });

  it("reconciles persisted queued K1 and canonical K2 through fresh runtime layers", async () => {
    const persistenceDirectory = await mkdtemp(
      `${tmpdir()}/meal-planner-gaia-108-`
    );
    temporaryDirectories.push(persistenceDirectory);
    const migrations = await readD1Migrations(
      fileURLToPath(new URL("../../../migrations", import.meta.url))
    );
    const locatorA = "https://www.tiktok.com/@cook/video/7520000000000000000";
    const locatorB =
      "https://www.tiktok.com/@another/video/7520000000000000000";

    const runtimeA = makeRuntime(persistenceDirectory);
    const databaseA = await runtimeA.getD1Database("MealPlannerDatabase");
    await databaseA.batch(
      migrations.flatMap((migration) =>
        migration.queries.map((query) => databaseA.prepare(query))
      )
    );
    const countersA = makeCounters();
    const applicationA = await makeApplication(databaseA, countersA);
    let created: Awaited<ReturnType<typeof postImport>>;
    let duplicate: Awaited<ReturnType<typeof postImport>>;
    try {
      created = await postImport(applicationA.handler, "K1", locatorA);
      duplicate = await postImport(applicationA.handler, "K2", locatorB);
      const ledger = await databaseA
        .prepare("SELECT import_id FROM import_requests ORDER BY created_at")
        .all<{ import_id: string }>();

      expect(created.status).toBe(202);
      expect(created.body.disposition).toBe("created");
      expect(duplicate.status).toBe(202);
      expect(duplicate.body.disposition).toBe("canonical_duplicate");
      expect(duplicate.body.import.id).toBe(created.body.import.id);
      expect(ledger.results).toEqual([
        { import_id: created.body.import.id },
        { import_id: created.body.import.id },
      ]);
      expect(countersA.workflowStarts).toEqual([
        created.body.import.id,
        created.body.import.id,
      ]);
    } finally {
      await applicationA.dispose();
      await runtimeA.dispose();
    }

    const runtimeB = makeRuntime(persistenceDirectory);
    const databaseB = await runtimeB.getD1Database("MealPlannerDatabase");
    const countersB = makeCounters();
    const applicationB = await makeApplication(databaseB, countersB);
    try {
      const polled = await getImport(
        applicationB.handler,
        created.body.import.id
      );
      const replayK1 = await postImport(applicationB.handler, "K1", locatorA);
      const replayK2 = await postImport(applicationB.handler, "K2", locatorB);

      expect(polled.status).toBe(200);
      expect(polled.body.import).toEqual(created.body.import);
      expect(replayK1.body.disposition).toBe("idempotency_replay");
      expect(replayK2.body.disposition).toBe("idempotency_replay");
      expect(replayK1.body.import.id).toBe(created.body.import.id);
      expect(replayK2.body.import.id).toBe(created.body.import.id);
      expect(countersB.identityProviderCalls).toBe(0);
      expect(countersB.availabilityCalls).toBe(0);
      expect(countersB.acceptRequests).toBe(0);
      expect(countersB.workflowStarts).toEqual([
        created.body.import.id,
        created.body.import.id,
      ]);
      expect(countersB.newIds).toBe(0);
    } finally {
      await applicationB.dispose();
      await runtimeB.dispose();
    }
  });
});

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { Effect, Option, Schema } from "effect";
import { Miniflare } from "miniflare";
import { afterEach, describe, expect, it } from "vitest";

import {
  ImportId,
  ImportTimestamp,
  SourceCanonicalId,
} from "./import.contracts.js";
import { makeD1ImportRepository } from "./import.repository.d1.js";
import type { AcceptImportCommand } from "./import.repository.js";
import {
  CompatibilityFingerprint,
  IdempotencyKeyHash,
  RequestFingerprint,
  SourceLocatorHash,
} from "./import.repository.js";

const temporaryDirectories: string[] = [];
const hash = "a".repeat(64);

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

const command = (): AcceptImportCommand => {
  const timestamp = Schema.decodeUnknownSync(ImportTimestamp)(
    "2026-07-20T10:00:00.000Z"
  );
  const canonicalId = Schema.decodeUnknownSync(SourceCanonicalId)(
    "7520000000000000000"
  );
  return {
    candidate: {
      canonicalSourceId: canonicalId,
      compatibilityFingerprint: Schema.decodeUnknownSync(
        CompatibilityFingerprint
      )(hash),
      sourceKind: "tiktok",
      view: {
        createdAt: timestamp,
        evidence: [],
        id: Schema.decodeUnknownSync(ImportId)(
          "018f47ad-91aa-7c35-b6fe-000000000001"
        ),
        source: { canonicalId, kind: "tiktok" },
        status: { kind: "queued" },
        updatedAt: timestamp,
      },
    },
    idempotencyKeyHash: Schema.decodeUnknownSync(IdempotencyKeyHash)(hash),
    requestFingerprint: Schema.decodeUnknownSync(RequestFingerprint)(hash),
    sourceLocatorHash: Schema.decodeUnknownSync(SourceLocatorHash)(hash),
  };
};

describe("D1 restart persistence", () => {
  it("polls an import through a fresh runtime using the same on-disk D1", async () => {
    const persistenceDirectory = await mkdtemp(
      `${tmpdir()}/meal-planner-gaia-108-`
    );
    temporaryDirectories.push(persistenceDirectory);
    const migrations = await readD1Migrations(
      fileURLToPath(new URL("../../../migrations", import.meta.url))
    );

    const runtimeA = makeRuntime(persistenceDirectory);
    const databaseA = await runtimeA.getD1Database("MealPlannerDatabase");
    await databaseA.batch(
      migrations.flatMap((migration) =>
        migration.queries.map((query) => databaseA.prepare(query))
      )
    );
    const repositoryA = makeD1ImportRepository(databaseA);
    const accepted = await Effect.runPromise(
      repositoryA.acceptRequest(command())
    );
    await runtimeA.dispose();

    const runtimeB = makeRuntime(persistenceDirectory);
    const databaseB = await runtimeB.getD1Database("MealPlannerDatabase");
    const repositoryB = makeD1ImportRepository(databaseB);
    const persisted = await Effect.runPromise(
      repositoryB.findById(accepted.import.view.id)
    );
    await runtimeB.dispose();

    expect(Option.isSome(persisted)).toBe(true);
    if (Option.isNone(persisted)) {
      throw new Error("Expected persisted import");
    }
    expect(persisted.value.view).toEqual(accepted.import.view);
  });
});

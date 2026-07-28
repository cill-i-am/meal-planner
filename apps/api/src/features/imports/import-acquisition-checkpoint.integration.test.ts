import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { readD1Migrations } from "@cloudflare/vitest-pool-workers";
import * as Bundle from "alchemy/Bundle";
import { Effect } from "effect";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const compatibilityDate = "2026-07-14";
const compatibilityFlags = ["nodejs_compat"];
const fixturePath = fileURLToPath(
  new URL("import-acquisition-checkpoint.test-fixture.ts", import.meta.url)
);
const temporaryDirectories: string[] = [];
let runtime: Miniflare;

const buildFixture = async (outputDirectory: string) => {
  type BundlePlugin = NonNullable<
    Parameters<typeof Bundle.build>[0]["plugins"]
  >;
  const alchemyEntry = import.meta.resolve("alchemy");
  const pluginModule = new URL(
    "../../@distilled.cloud/cloudflare-rolldown-plugin/dist/plugin.js",
    alchemyEntry
  );
  const { default: cloudflareRolldown } = (await import(pluginModule.href)) as {
    readonly default: (options: {
      readonly compatibilityDate: string;
      readonly compatibilityFlags: string[];
    }) => BundlePlugin;
  };
  const output = await Effect.runPromise(
    Bundle.build(
      {
        checks: {
          ineffectiveDynamicImport: false,
          unresolvedImport: false,
        },
        external: ["cloudflare:workers"],
        input: fixturePath,
        plugins: [
          cloudflareRolldown({
            compatibilityDate,
            compatibilityFlags,
          }),
        ],
      },
      {
        codeSplitting: false,
        dir: outputDirectory,
        format: "esm",
        minify: true,
        sourcemap: false,
      }
    )
  );
  const {
    files: [{ content }],
  } = output;
  return typeof content === "string"
    ? content
    : new TextDecoder().decode(content);
};

const applyMigrations = async () => {
  const database = await runtime.getD1Database("MealPlannerDatabase");
  const migrations = await readD1Migrations(
    fileURLToPath(new URL("../../../migrations", import.meta.url))
  );
  await database
    .prepare(
      `CREATE TABLE d1_migrations (
         id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
         name TEXT NOT NULL UNIQUE,
         applied_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
       )`
    )
    .run();
  for (const migration of migrations) {
    // eslint-disable-next-line no-await-in-loop -- D1 migrations must be applied in declared order.
    await database.batch([
      ...migration.queries.map((query) => database.prepare(query)),
      database
        .prepare("INSERT INTO d1_migrations (name) VALUES (?)")
        .bind(migration.name),
    ]);
  }
};

beforeAll(async () => {
  const temporaryDirectory = await mkdtemp(
    `${tmpdir()}/meal-planner-gaia-190-replay-`
  );
  temporaryDirectories.push(temporaryDirectory);
  const fixtureScript = await buildFixture(temporaryDirectory);
  runtime = new Miniflare({
    compatibilityDate,
    compatibilityFlags,
    d1Databases: { MealPlannerDatabase: "gaia-190-test" },
    kvNamespaces: ["ACQUISITION_REPLAY_STATE"],
    modules: [
      {
        contents: fixtureScript,
        path: "acquisition-replay-fixture.js",
        type: "ESModule",
      },
    ],
    workflows: {
      AcquisitionReplayWorkflow: {
        className: "AcquisitionReplayWorkflow",
        name: "acquisition-replay-workflow",
      },
    },
  });
  await applyMigrations();
}, 30_000);

afterAll(async () => {
  await runtime.dispose();
  await Promise.all(
    temporaryDirectories.map((directory) =>
      rm(directory, { force: true, recursive: true })
    )
  );
});

const commandWorkflow = async (
  command:
    | {
        readonly action: "read";
        readonly id: string;
      }
    | {
        readonly action: "restart-speech";
        readonly id: string;
      }
    | {
        readonly action: "run";
        readonly checkpoint: "canonical" | "invalid";
        readonly id: string;
        readonly importId: string;
      }
) => {
  const response = await runtime.dispatchFetch("http://localhost/", {
    body: JSON.stringify(command),
    method: "POST",
  });
  const responseBody = await response.text();
  expect(response.status, responseBody).toBe(200);
  return JSON.parse(responseBody) as unknown;
};

describe("native Workflow historical acquisition checkpoint replay", () => {
  it("reuses cached acquisition, verifies D1 ownership, and reaches speech on targeted restart", async () => {
    const id = "gaia-190-canonical-acquisition-replay";
    const importId = "00000000-0000-4000-8000-000000000189";
    const generation = 1;
    const database = await runtime.getD1Database("MealPlannerDatabase");
    const evidence = JSON.stringify([
      {
        kind: "original_media",
        referenceId: `imports/${importId}/acquisition/v1/generations/${generation}/original.mp4`,
      },
      {
        kind: "acquisition_manifest",
        referenceId: `imports/${importId}/acquisition/v1/generations/${generation}/manifest.json`,
      },
    ]);
    await database
      .prepare(
        `INSERT INTO recipe_imports (
           acquisition_generation, canonical_source_id,
           compatibility_fingerprint, created_at,
           evidence_references_json, id, recovery_action, source_kind,
           status, status_code, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        generation,
        "synthetic-canonical-id",
        "b".repeat(64),
        "2026-07-28T09:59:00.000Z",
        evidence,
        importId,
        "retry_later",
        "tiktok",
        "failed",
        "transcription_failed",
        "2026-07-28T10:01:00.000Z"
      )
      .run();

    const firstRun = await commandWorkflow({
      action: "run",
      checkpoint: "canonical",
      id,
      importId,
    });
    const firstCounters = await commandWorkflow({ action: "read", id });
    expect({ firstCounters, firstRun }).toMatchObject({
      firstCounters: {
        acquisitionCalls: 1,
        budgetReservationCalls: 1,
        decodeAccepted: 1,
        ownershipAccepted: 1,
        providerDispatchCalls: 1,
        recordCalls: 1,
        speechCalls: 1,
      },
      firstRun: {
        output: { _tag: "SpeechReached" },
        status: "complete",
      },
    });
    await expect(
      commandWorkflow({ action: "restart-speech", id })
    ).resolves.toMatchObject({
      output: { _tag: "SpeechReached" },
      status: "complete",
    });
    await expect(commandWorkflow({ action: "read", id })).resolves.toEqual({
      acquisitionCalls: 1,
      budgetReservationCalls: 1,
      decodeAccepted: 2,
      ownershipAccepted: 2,
      providerDispatchCalls: 2,
      recordCalls: 1,
      speechCalls: 2,
    });
  });

  it("rejects a malformed historical checkpoint before recording, budget, or provider dispatch", async () => {
    const id = "gaia-190-invalid-acquisition-replay";
    const importId = "00000000-0000-4000-8000-000000000190";

    await expect(
      commandWorkflow({
        action: "run",
        checkpoint: "invalid",
        id,
        importId,
      })
    ).resolves.toMatchObject({
      output: {
        _tag: "AcquisitionCheckpointRejected",
        code: "historical_acquisition_checkpoint_invalid",
      },
      status: "complete",
    });
    await expect(commandWorkflow({ action: "read", id })).resolves.toEqual({
      acquisitionCalls: 1,
      budgetReservationCalls: 0,
      decodeAccepted: 0,
      ownershipAccepted: 0,
      providerDispatchCalls: 0,
      recordCalls: 0,
      speechCalls: 0,
    });
  });
});

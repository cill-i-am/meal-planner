import { applyD1Migrations, env } from "cloudflare:test";
import type { AnyD1Database } from "drizzle-orm/d1";
import { Effect, Layer, Redacted, Schema } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  PilotBudgetDispatchId,
  PilotBudgetProviderStageId,
  PilotBudgetRunId,
  PilotBudgetTimestamp,
} from "../pilots/pilot-provider-budget.js";
import { makeD1PilotProviderBudgetRepository } from "../pilots/pilot-provider-budget.repository.d1.js";
import { AcquisitionGeneration } from "./import-media.model.js";
import {
  ProviderTerminalSettlementService,
  makeD1ProviderTerminalSettlementService,
} from "./import-provider-terminal-settlement.js";
import { ProviderTerminalSettlementRoutes } from "./import-provider-terminal-settlement.routes.js";
import { makeD1ProviderTerminalCheckpointRepository } from "./import-provider-terminal.js";
import {
  makeD1RecipeRecoveryRepository,
  recipeRecoveryExtractionFingerprint,
} from "./import-recipe-recovery.js";
import type { RecipeRecovery } from "./import-recipe-recovery.js";
import { ImportAuthorizer, makeImportAuthorizer } from "./import.auth.js";
import { ImportId, ImportTimestamp } from "./import.contracts.js";

const testEnv = env as unknown as {
  readonly MealPlannerDatabase: AnyD1Database;
  readonly TEST_MIGRATIONS: {
    readonly name: string;
    readonly queries: string[];
  }[];
};

const decodeImportId = Schema.decodeUnknownSync(ImportId);
const decodeGeneration = Schema.decodeUnknownSync(AcquisitionGeneration);
const decodeImportTimestamp = Schema.decodeUnknownSync(ImportTimestamp);
const decodeBudgetTimestamp = Schema.decodeUnknownSync(PilotBudgetTimestamp);
const decodeRunId = Schema.decodeUnknownSync(PilotBudgetRunId);
const decodeStageId = Schema.decodeUnknownSync(PilotBudgetProviderStageId);
const decodeDispatchId = Schema.decodeUnknownSync(PilotBudgetDispatchId);

beforeAll(async () => {
  await applyD1Migrations(
    testEnv.MealPlannerDatabase,
    [...testEnv.TEST_MIGRATIONS],
    "d1_migrations"
  );
});

beforeEach(async () => {
  await testEnv.MealPlannerDatabase.prepare(
    `UPDATE pilot_provider_stage_budget
        SET settled_micro_usd = 0,
            reserved_micro_usd = 0,
            state = 'open',
            invoking_dispatch_id = NULL,
            poison_dispatch_id = NULL,
            updated_at = '2026-07-30T00:00:00.000Z'
      WHERE runtime_stage = 'pilot-gaia-118'`
  ).run();
});

const seedEligibleTerminalRecipe = async (suffix: string) => {
  const importId = decodeImportId(`00000000-0000-4000-8000-${suffix}`);
  const generation = decodeGeneration(1);
  const now = "2026-07-30T00:00:00.000Z";
  const sourceSha256 = "a".repeat(64);
  const transcriptSha256 = `${"b".repeat(52)}${suffix}`;
  const visualManifestSha256 = `${"c".repeat(52)}${suffix}`;
  const evidenceFingerprint = `${"d".repeat(52)}${suffix}`;
  const extractionFingerprint = `${"e".repeat(52)}${suffix}`;
  const dispatchId = decodeDispatchId(
    `recipe:${importId}:${generation}:${evidenceFingerprint}`
  );
  const evidenceReferencesJson = JSON.stringify([
    {
      kind: "original_media",
      referenceId: `imports/${importId}/acquisition/v1/generations/${generation}/original.mp4`,
    },
    {
      kind: "acquisition_manifest",
      referenceId: `imports/${importId}/acquisition/v1/generations/${generation}/manifest.json`,
    },
    {
      kind: "speech_transcript",
      referenceId: `imports/${importId}/transcription/v1/generations/${generation}/transcript.json`,
    },
  ]);
  await testEnv.MealPlannerDatabase.batch([
    testEnv.MealPlannerDatabase.prepare(
      `INSERT INTO recipe_imports (
         acquisition_generation, canonical_source_id, compatibility_fingerprint,
         created_at, evidence_references_json, id, recovery_action, source_kind,
         status, status_code, updated_at
       ) VALUES (
         ?, ?, ?, ?, ?, ?, NULL, 'tiktok_video', 'transcribed', NULL, ?
       )`
    ).bind(
      generation,
      `recovery-canonical-${suffix}`,
      "f".repeat(64),
      now,
      evidenceReferencesJson,
      importId,
      now
    ),
    testEnv.MealPlannerDatabase.prepare(
      `INSERT INTO import_transcriptions (
         import_id, acquisition_generation, dispatch_id, source_media_sha256,
         state, transcript_key, transcript_sha256, provider, model,
         detected_language, usage_audio_milliseconds, usage_input_bytes,
         estimated_cost_micro_usd, cost_currency, cost_certainty,
         segments_count, failure_code, created_at, updated_at, completed_at
       ) VALUES (
         ?, ?, ?, ?, 'transcribed', ?, ?, 'cloudflare-workers-ai',
         'speech-model', 'en', 1000, 100, 1, 'USD', 'known', 1, NULL,
         ?, ?, ?
       )`
    ).bind(
      importId,
      generation,
      `speech:${importId}:${generation}`,
      sourceSha256,
      `imports/${importId}/transcription/v1/generations/${generation}/transcript.json`,
      transcriptSha256,
      now,
      now,
      now
    ),
    testEnv.MealPlannerDatabase.prepare(
      `INSERT INTO import_visual_evidence (
         import_id, acquisition_generation, dispatch_id, source_media_sha256,
         state, outcome, manifest_key, manifest_sha256, provider, model,
         input_frames, input_bytes, model_calls, estimated_cost_micro_usd,
         cost_currency, cost_certainty, observations_count, failure_code,
         created_at, updated_at, completed_at
       ) VALUES (
         ?, ?, ?, ?, 'completed', 'found', ?, ?,
         'cloudflare-workers-ai', 'visual-model', 1, 100, 1, 1, 'USD',
         'known', 1, NULL, ?, ?, ?
       )`
    ).bind(
      importId,
      generation,
      `visual:${importId}:${generation}:evidence`,
      sourceSha256,
      `imports/${importId}/visual/v1/generations/${generation}/manifest.json`,
      visualManifestSha256,
      now,
      now,
      now
    ),
    testEnv.MealPlannerDatabase.prepare(
      `INSERT INTO import_recipe_extractions (
         extraction_fingerprint, import_id, acquisition_generation,
         evidence_fingerprint, extractor_provider, extractor_model,
         extractor_version, state, created_at, updated_at
       ) VALUES (
         ?, ?, ?, ?, 'cloudflare-workers-ai', 'recipe-model',
         'installed-v1', 'dispatching', ?, ?
       )`
    ).bind(
      extractionFingerprint,
      importId,
      generation,
      evidenceFingerprint,
      now,
      now
    ),
  ]);

  const budget = makeD1PilotProviderBudgetRepository(
    testEnv.MealPlannerDatabase,
    "pilot-gaia-118"
  );
  const runId = decodeRunId(`gaia-118:${importId}`);
  const settleSibling = async (
    siblingDispatchId: PilotBudgetDispatchId,
    providerStageId: PilotBudgetProviderStageId
  ) => {
    const reservation = {
      dispatchId: siblingDispatchId,
      maximumCostMicroUsd: 1,
      providerStageId,
      runId,
      timestamp: decodeBudgetTimestamp(now),
    };
    await Effect.runPromise(budget.reserve(reservation));
    await Effect.runPromise(budget.beginInvocation(reservation));
    await Effect.runPromise(
      budget.settleKnown({ ...reservation, actualCostMicroUsd: 0 })
    );
  };
  await settleSibling(
    decodeDispatchId(`speech:${importId}:${generation}`),
    decodeStageId("speech-transcription")
  );
  await settleSibling(
    decodeDispatchId(`visual:${importId}:${generation}:evidence`),
    decodeStageId("visual-evidence")
  );
  const recipeReservation = {
    dispatchId,
    maximumCostMicroUsd: 100_000,
    providerStageId: decodeStageId("recipe-extraction"),
    runId,
    timestamp: decodeBudgetTimestamp(now),
  };
  await Effect.runPromise(budget.reserve(recipeReservation));
  await Effect.runPromise(budget.beginInvocation(recipeReservation));
  await Effect.runPromise(budget.settleUnknown(recipeReservation));
  await Effect.runPromise(
    makeD1ProviderTerminalCheckpointRepository(
      testEnv.MealPlannerDatabase
    ).persist({
      acquisitionGeneration: generation,
      completedAt: decodeImportTimestamp(now),
      failureCode: "outcome_unknown",
      importId,
      providerStage: "recipe",
    })
  );
  await Effect.runPromise(
    makeD1ProviderTerminalSettlementService({
      database: testEnv.MealPlannerDatabase,
      now: () => decodeImportTimestamp("2026-07-30T00:01:00.000Z"),
      runtimeStage: "pilot-gaia-118",
    }).settle({
      acquisitionGeneration: generation,
      dispatchId,
      importId,
      operation: "settle_recipe_unknown",
    })
  );

  return {
    dispatchId,
    evidenceFingerprint,
    evidenceReferencesJson,
    extractionFingerprint,
    generation,
    importId,
    transcriptSha256,
    visualManifestSha256,
  };
};

const makeApp = async (started: RecipeRecovery[]) => {
  const authorizer = await Effect.runPromise(
    makeImportAuthorizer(Redacted.make("test-import-token"))
  );
  const service = makeD1ProviderTerminalSettlementService({
    database: testEnv.MealPlannerDatabase,
    now: () => decodeImportTimestamp("2026-07-30T00:02:00.000Z"),
    recipeRecoveryStarter: {
      start: (recovery) =>
        Effect.sync(() => {
          started.push(recovery);
        }),
    },
    runtimeStage: "pilot-gaia-118",
  });
  return HttpRouter.toWebHandler(
    Layer.mergeAll(
      ProviderTerminalSettlementRoutes,
      Layer.succeed(ImportAuthorizer, ImportAuthorizer.of(authorizer)),
      Layer.succeed(
        ProviderTerminalSettlementService,
        ProviderTerminalSettlementService.of(service)
      )
    ),
    { disableLogger: true }
  );
};

const postRecovery = (
  app: Awaited<ReturnType<typeof makeApp>>,
  seeded: Awaited<ReturnType<typeof seedEligibleTerminalRecipe>>,
  token = "test-import-token"
) =>
  app.handler(
    new Request(
      "https://meal-planner.test/imports/operator-provider-terminal-settlement",
      {
        body: JSON.stringify({
          acquisitionGeneration: seeded.generation,
          dispatchId: seeded.dispatchId,
          importId: seeded.importId,
          operation: "prepare_recipe_recovery",
        }),
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        method: "POST",
      }
    )
  );

describe("stage-scoped terminal recipe recovery", () => {
  it("authenticates one immutable recovery admission and preserves terminal evidence under duplicates", async () => {
    const seeded = await seedEligibleTerminalRecipe("000000000207");
    const before = await Promise.all([
      testEnv.MealPlannerDatabase.prepare(
        "SELECT * FROM recipe_imports WHERE id = ?"
      )
        .bind(seeded.importId)
        .first(),
      testEnv.MealPlannerDatabase.prepare(
        "SELECT * FROM import_recipe_extractions WHERE extraction_fingerprint = ?"
      )
        .bind(seeded.extractionFingerprint)
        .first(),
      testEnv.MealPlannerDatabase.prepare(
        `SELECT * FROM import_recipe_terminal_projections
          WHERE import_id = ? AND acquisition_generation = ?`
      )
        .bind(seeded.importId, seeded.generation)
        .first(),
    ]);
    const started: RecipeRecovery[] = [];
    const app = await makeApp(started);

    const unauthenticated = await postRecovery(app, seeded, "wrong-token");
    expect(unauthenticated.status).toBe(401);
    const [first, duplicate] = await Promise.all([
      postRecovery(app, seeded),
      postRecovery(app, seeded),
    ]);

    expect(first.status).toBe(200);
    expect(duplicate.status).toBe(200);
    const firstBody = await first.json();
    await expect(duplicate.json()).resolves.toEqual(firstBody);
    expect(firstBody).toMatchObject({
      acquisitionGeneration: seeded.generation,
      dispatchId: seeded.dispatchId,
      importId: seeded.importId,
      outcome: "recipe_recovery_prepared",
      recoveryDispatchId: `${seeded.dispatchId}:recovery:1`,
      runtimeStage: "pilot-gaia-118",
    });
    expect(started).toHaveLength(2);
    expect(started[0]).toEqual(started[1]);
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT COUNT(*) AS count
           FROM pilot_provider_recipe_recoveries
          WHERE runtime_stage = 'pilot-gaia-118' AND import_id = ?`
      )
        .bind(seeded.importId)
        .first()
    ).resolves.toEqual({ count: 1 });
    await expect(
      Promise.all([
        testEnv.MealPlannerDatabase.prepare(
          "SELECT * FROM recipe_imports WHERE id = ?"
        )
          .bind(seeded.importId)
          .first(),
        testEnv.MealPlannerDatabase.prepare(
          "SELECT * FROM import_recipe_extractions WHERE extraction_fingerprint = ?"
        )
          .bind(seeded.extractionFingerprint)
          .first(),
        testEnv.MealPlannerDatabase.prepare(
          `SELECT * FROM import_recipe_terminal_projections
            WHERE import_id = ? AND acquisition_generation = ?`
        )
          .bind(seeded.importId, seeded.generation)
          .first(),
      ])
    ).resolves.toEqual(before);
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `UPDATE pilot_provider_recipe_recoveries
            SET transcript_sha256 = ?
          WHERE runtime_stage = 'pilot-gaia-118' AND import_id = ?`
      )
        .bind("f".repeat(64), seeded.importId)
        .run()
    ).rejects.toThrow(/immutable/iu);
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `DELETE FROM pilot_provider_recipe_recoveries
          WHERE runtime_stage = 'pilot-gaia-118' AND import_id = ?`
      )
        .bind(seeded.importId)
        .run()
    ).rejects.toThrow(/immutable/iu);
  });

  it("rejects reserved, poisoned and stale-evidence admission without consuming recovery authority", async () => {
    const seeded = await seedEligibleTerminalRecipe("000000000209");
    const repository = makeD1RecipeRecoveryRepository(
      testEnv.MealPlannerDatabase,
      "pilot-gaia-118"
    );
    const command = {
      acquisitionGeneration: seeded.generation,
      createdAt: decodeImportTimestamp("2026-07-30T00:02:00.000Z"),
      importId: seeded.importId,
      originalDispatchId: seeded.dispatchId,
    };
    await testEnv.MealPlannerDatabase.prepare(
      `UPDATE pilot_provider_stage_budget
          SET reserved_micro_usd = 1
        WHERE runtime_stage = 'pilot-gaia-118'`
    ).run();
    const reservedAdmission = await Effect.runPromiseExit(
      repository.prepare(command)
    );
    expect(reservedAdmission._tag).toBe("Failure");
    await testEnv.MealPlannerDatabase.prepare(
      `UPDATE pilot_provider_stage_budget
          SET reserved_micro_usd = 0,
              state = 'poisoned',
              poison_dispatch_id = ?
        WHERE runtime_stage = 'pilot-gaia-118'`
    )
      .bind(seeded.dispatchId)
      .run();
    const poisonedAdmission = await Effect.runPromiseExit(
      repository.prepare(command)
    );
    expect(poisonedAdmission._tag).toBe("Failure");
    await testEnv.MealPlannerDatabase.prepare(
      `UPDATE pilot_provider_stage_budget
          SET state = 'open',
              poison_dispatch_id = NULL
        WHERE runtime_stage = 'pilot-gaia-118'`
    ).run();

    const recoveryExtractionFingerprint = await Effect.runPromise(
      recipeRecoveryExtractionFingerprint(seeded.extractionFingerprint)
    );
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `INSERT INTO pilot_provider_recipe_recoveries (
           runtime_stage, import_id, acquisition_generation,
           recovery_ordinal, recovery_identity, original_dispatch_id,
           recovery_dispatch_id, evidence_fingerprint,
           original_extraction_fingerprint, recovery_extraction_fingerprint,
           transcript_sha256, visual_manifest_sha256,
           evidence_references_json, created_at
         ) VALUES (
           'pilot-gaia-118', ?, ?, 1, 'recovery:1', ?, ?, ?, ?, ?, ?, ?, ?, ?
         )`
      )
        .bind(
          seeded.importId,
          seeded.generation,
          seeded.dispatchId,
          `${seeded.dispatchId}:recovery:1`,
          seeded.evidenceFingerprint,
          seeded.extractionFingerprint,
          recoveryExtractionFingerprint,
          "f".repeat(64),
          seeded.visualManifestSha256,
          seeded.evidenceReferencesJson,
          "2026-07-30T00:02:00.000Z"
        )
        .run()
    ).rejects.toThrow(/preconditions rejected/iu);
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT COUNT(*) AS count
           FROM pilot_provider_recipe_recoveries
          WHERE runtime_stage = 'pilot-gaia-118' AND import_id = ?`
      )
        .bind(seeded.importId)
        .first()
    ).resolves.toEqual({ count: 0 });

    const recoveryDispatchId = decodeDispatchId(
      `${seeded.dispatchId}:recovery:1`
    );
    const recoveryReservation = {
      dispatchId: recoveryDispatchId,
      maximumCostMicroUsd: 100_000,
      providerStageId: decodeStageId("recipe-extraction"),
      runId: decodeRunId(`gaia-118:recipe-recovery:${seeded.importId}`),
      timestamp: decodeBudgetTimestamp("2026-07-30T00:03:00.000Z"),
    };
    const budget = makeD1PilotProviderBudgetRepository(
      testEnv.MealPlannerDatabase,
      "pilot-gaia-118"
    );
    const unauthorizedReservation = await Effect.runPromiseExit(
      budget.reserve(recoveryReservation)
    );
    expect(unauthorizedReservation._tag).toBe("Failure");

    await expect(
      Effect.runPromise(repository.prepare(command))
    ).resolves.toMatchObject({
      originalDispatchId: seeded.dispatchId,
      recoveryDispatchId,
      recoveryIdentity: "recovery:1",
      recoveryOrdinal: 1,
    });
    await expect(
      Effect.runPromise(budget.reserve(recoveryReservation))
    ).resolves.toMatchObject({
      dispatchId: recoveryDispatchId,
      state: "reserved",
    });
    await expect(
      Effect.runPromise(budget.releaseBeforeInvocation(recoveryReservation))
    ).resolves.toMatchObject({
      dispatchId: recoveryDispatchId,
      state: "released",
    });
  });
});

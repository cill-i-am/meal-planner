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
import { makeD1RecipeDraftRepository } from "./import-recipe-draft.repository.d1.js";
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

const makeApp = async (
  started: RecipeRecovery[],
  resumed: RecipeRecovery[] = [],
  runtimeStage = "pilot-gaia-118"
) => {
  const authorizer = await Effect.runPromise(
    makeImportAuthorizer(Redacted.make("test-import-token"))
  );
  const service = makeD1ProviderTerminalSettlementService({
    database: testEnv.MealPlannerDatabase,
    now: () => decodeImportTimestamp("2026-07-30T00:02:00.000Z"),
    recipeRecoveryStarter: {
      resume: (recovery) =>
        Effect.sync(() => {
          resumed.push(recovery);
        }),
      start: (recovery) =>
        Effect.sync(() => {
          started.push(recovery);
        }),
    },
    runtimeStage,
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

const postOperation = (
  app: Awaited<ReturnType<typeof makeApp>>,
  input: {
    readonly acquisitionGeneration: AcquisitionGeneration;
    readonly dispatchId: PilotBudgetDispatchId;
    readonly importId: ImportId;
    readonly operation:
      | "prepare_recipe_fourth_recovery"
      | "prepare_recipe_fifth_recovery"
      | "prepare_recipe_sixth_recovery"
      | "prepare_recipe_seventh_recovery"
      | "prepare_recipe_eighth_recovery"
      | "prepare_recipe_second_recovery"
      | "prepare_recipe_third_recovery"
      | "settle_recipe_recovery_unknown";
  },
  token = "test-import-token"
) =>
  app.handler(
    new Request(
      "https://meal-planner.test/imports/operator-provider-terminal-settlement",
      {
        body: JSON.stringify(input),
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        method: "POST",
      }
    )
  );

const seedUnknownFirstRecovery = async (suffix: string) => {
  const seeded = await seedEligibleTerminalRecipe(suffix);
  const recovery = await Effect.runPromise(
    makeD1RecipeRecoveryRepository(
      testEnv.MealPlannerDatabase,
      "pilot-gaia-118"
    ).prepare({
      acquisitionGeneration: seeded.generation,
      createdAt: decodeImportTimestamp("2026-07-30T00:02:00.000Z"),
      importId: seeded.importId,
      originalDispatchId: seeded.dispatchId,
    })
  );
  await testEnv.MealPlannerDatabase.prepare(
    `INSERT INTO import_recipe_extractions (
       extraction_fingerprint, import_id, acquisition_generation,
       evidence_fingerprint, extractor_provider, extractor_model,
       extractor_version, state, created_at, updated_at
     ) VALUES (
       ?, ?, ?, ?, 'cloudflare-workers-ai', 'recipe-model',
       'installed-alchemy-forced-tool-v2', 'dispatching', ?, ?
     )`
  )
    .bind(
      recovery.recoveryExtractionFingerprint,
      seeded.importId,
      seeded.generation,
      seeded.evidenceFingerprint,
      "2026-07-30T00:03:00.000Z",
      "2026-07-30T00:03:00.000Z"
    )
    .run();
  const recoveryReservation = {
    dispatchId: recovery.recoveryDispatchId,
    maximumCostMicroUsd: 100_000,
    providerStageId: decodeStageId("recipe-extraction"),
    runId: decodeRunId(`gaia-118:recipe-recovery:${seeded.importId}`),
    timestamp: decodeBudgetTimestamp("2026-07-30T00:03:00.000Z"),
  };
  const budget = makeD1PilotProviderBudgetRepository(
    testEnv.MealPlannerDatabase,
    "pilot-gaia-118"
  );
  await Effect.runPromise(budget.reserve(recoveryReservation));
  await Effect.runPromise(budget.beginInvocation(recoveryReservation));
  await Effect.runPromise(budget.settleUnknown(recoveryReservation));
  await Effect.runPromise(
    makeD1RecipeDraftRepository(testEnv.MealPlannerDatabase).fail({
      completedAt: decodeImportTimestamp("2026-07-30T00:03:01.000Z"),
      extractionFingerprint: recovery.recoveryExtractionFingerprint,
      failureCode: "provider_error",
    })
  );
  return { ...seeded, recovery };
};

const seedUnknownSecondRecovery = async (suffix: string) => {
  const seeded = await seedUnknownFirstRecovery(suffix);
  const service = makeD1ProviderTerminalSettlementService({
    database: testEnv.MealPlannerDatabase,
    now: () => decodeImportTimestamp("2026-07-30T00:04:00.000Z"),
    runtimeStage: "pilot-gaia-118",
  });
  await Effect.runPromise(
    service.settle({
      acquisitionGeneration: seeded.generation,
      dispatchId: seeded.recovery.recoveryDispatchId,
      importId: seeded.importId,
      operation: "settle_recipe_recovery_unknown",
    })
  );
  const recovery = await Effect.runPromise(
    makeD1RecipeRecoveryRepository(
      testEnv.MealPlannerDatabase,
      "pilot-gaia-118"
    ).prepareSecond({
      acquisitionGeneration: seeded.generation,
      createdAt: decodeImportTimestamp("2026-07-30T00:05:00.000Z"),
      firstRecoveryDispatchId: seeded.recovery.recoveryDispatchId,
      importId: seeded.importId,
    })
  );
  await testEnv.MealPlannerDatabase.prepare(
    `INSERT INTO import_recipe_extractions (
       extraction_fingerprint, import_id, acquisition_generation,
       evidence_fingerprint, extractor_provider, extractor_model,
       extractor_version, state, created_at, updated_at
     ) VALUES (
       ?, ?, ?, ?, 'cloudflare-workers-ai', 'recipe-model',
       'installed-alchemy-forced-tool-v2', 'dispatching', ?, ?
     )`
  )
    .bind(
      recovery.recoveryExtractionFingerprint,
      seeded.importId,
      seeded.generation,
      seeded.evidenceFingerprint,
      "2026-07-30T00:06:00.000Z",
      "2026-07-30T00:06:00.000Z"
    )
    .run();
  const reservation = {
    dispatchId: recovery.recoveryDispatchId,
    maximumCostMicroUsd: 100_000,
    providerStageId: decodeStageId("recipe-extraction"),
    runId: decodeRunId(`gaia-118:recipe-recovery:${seeded.importId}`),
    timestamp: decodeBudgetTimestamp("2026-07-30T00:06:00.000Z"),
  };
  const budget = makeD1PilotProviderBudgetRepository(
    testEnv.MealPlannerDatabase,
    "pilot-gaia-118"
  );
  await Effect.runPromise(budget.reserve(reservation));
  await Effect.runPromise(budget.beginInvocation(reservation));
  await Effect.runPromise(budget.settleUnknown(reservation));
  await Effect.runPromise(
    makeD1RecipeDraftRepository(testEnv.MealPlannerDatabase).fail({
      completedAt: decodeImportTimestamp("2026-07-30T00:06:01.000Z"),
      extractionFingerprint: recovery.recoveryExtractionFingerprint,
      failureCode: "provider_error",
    })
  );
  return { ...seeded, recovery };
};

const seedUnknownThirdRecovery = async (suffix: string) => {
  const seeded = await seedUnknownSecondRecovery(suffix);
  const service = makeD1ProviderTerminalSettlementService({
    database: testEnv.MealPlannerDatabase,
    now: () => decodeImportTimestamp("2026-07-30T00:07:00.000Z"),
    runtimeStage: "pilot-gaia-118",
  });
  await Effect.runPromise(
    service.settle({
      acquisitionGeneration: seeded.generation,
      dispatchId: seeded.recovery.recoveryDispatchId,
      importId: seeded.importId,
      operation: "settle_recipe_recovery_unknown",
    })
  );
  const recovery = await Effect.runPromise(
    makeD1RecipeRecoveryRepository(
      testEnv.MealPlannerDatabase,
      "pilot-gaia-118"
    ).prepareThird({
      acquisitionGeneration: seeded.generation,
      createdAt: decodeImportTimestamp("2026-07-30T00:08:00.000Z"),
      importId: seeded.importId,
      secondRecoveryDispatchId: seeded.recovery.recoveryDispatchId,
    })
  );
  await testEnv.MealPlannerDatabase.prepare(
    `INSERT INTO import_recipe_extractions (
       extraction_fingerprint, import_id, acquisition_generation,
       evidence_fingerprint, extractor_provider, extractor_model,
       extractor_version, state, created_at, updated_at
     ) VALUES (
       ?, ?, ?, ?, 'cloudflare-workers-ai', 'recipe-model',
       'installed-alchemy-forced-tool-v2', 'dispatching', ?, ?
     )`
  )
    .bind(
      recovery.recoveryExtractionFingerprint,
      seeded.importId,
      seeded.generation,
      seeded.evidenceFingerprint,
      "2026-07-30T00:09:00.000Z",
      "2026-07-30T00:09:00.000Z"
    )
    .run();
  const reservation = {
    dispatchId: recovery.recoveryDispatchId,
    maximumCostMicroUsd: 100_000,
    providerStageId: decodeStageId("recipe-extraction"),
    runId: decodeRunId(`gaia-118:recipe-recovery:${seeded.importId}`),
    timestamp: decodeBudgetTimestamp("2026-07-30T00:09:00.000Z"),
  };
  const budget = makeD1PilotProviderBudgetRepository(
    testEnv.MealPlannerDatabase,
    "pilot-gaia-118"
  );
  await Effect.runPromise(budget.reserve(reservation));
  await Effect.runPromise(budget.beginInvocation(reservation));
  await Effect.runPromise(budget.settleUnknown(reservation));
  await Effect.runPromise(
    makeD1RecipeDraftRepository(testEnv.MealPlannerDatabase).fail({
      completedAt: decodeImportTimestamp("2026-07-30T00:09:01.000Z"),
      extractionFingerprint: recovery.recoveryExtractionFingerprint,
      failureCode: "provider_error",
    })
  );
  return { ...seeded, recovery };
};

const seedUnknownFourthRecovery = async (suffix: string) => {
  const seeded = await seedUnknownThirdRecovery(suffix);
  const service = makeD1ProviderTerminalSettlementService({
    database: testEnv.MealPlannerDatabase,
    now: () => decodeImportTimestamp("2026-07-30T00:10:00.000Z"),
    runtimeStage: "pilot-gaia-118",
  });
  await Effect.runPromise(
    service.settle({
      acquisitionGeneration: seeded.generation,
      dispatchId: seeded.recovery.recoveryDispatchId,
      importId: seeded.importId,
      operation: "settle_recipe_recovery_unknown",
    })
  );
  const recovery = await Effect.runPromise(
    makeD1RecipeRecoveryRepository(
      testEnv.MealPlannerDatabase,
      "pilot-gaia-118"
    ).prepareFourth({
      acquisitionGeneration: seeded.generation,
      createdAt: decodeImportTimestamp("2026-07-30T00:11:00.000Z"),
      importId: seeded.importId,
      thirdRecoveryDispatchId: seeded.recovery.recoveryDispatchId,
    })
  );
  await testEnv.MealPlannerDatabase.prepare(
    `INSERT INTO import_recipe_extractions (
       extraction_fingerprint, import_id, acquisition_generation,
       evidence_fingerprint, extractor_provider, extractor_model,
       extractor_version, state, created_at, updated_at
     ) VALUES (
       ?, ?, ?, ?, 'cloudflare-workers-ai', 'recipe-model',
       'installed-alchemy-forced-tool-v2', 'dispatching', ?, ?
     )`
  )
    .bind(
      recovery.recoveryExtractionFingerprint,
      seeded.importId,
      seeded.generation,
      seeded.evidenceFingerprint,
      "2026-07-30T00:12:00.000Z",
      "2026-07-30T00:12:00.000Z"
    )
    .run();
  const reservation = {
    dispatchId: recovery.recoveryDispatchId,
    maximumCostMicroUsd: 100_000,
    providerStageId: decodeStageId("recipe-extraction"),
    runId: decodeRunId(`gaia-118:recipe-recovery:${seeded.importId}`),
    timestamp: decodeBudgetTimestamp("2026-07-30T00:12:00.000Z"),
  };
  const budget = makeD1PilotProviderBudgetRepository(
    testEnv.MealPlannerDatabase,
    "pilot-gaia-118"
  );
  await Effect.runPromise(budget.reserve(reservation));
  await Effect.runPromise(budget.beginInvocation(reservation));
  await Effect.runPromise(budget.settleUnknown(reservation));
  await Effect.runPromise(
    makeD1RecipeDraftRepository(testEnv.MealPlannerDatabase).fail({
      completedAt: decodeImportTimestamp("2026-07-30T00:12:01.000Z"),
      extractionFingerprint: recovery.recoveryExtractionFingerprint,
      failureCode: "provider_error",
    })
  );
  return { ...seeded, recovery };
};

const seedUnknownFifthRecovery = async (suffix: string) => {
  const seeded = await seedUnknownFourthRecovery(suffix);
  const service = makeD1ProviderTerminalSettlementService({
    database: testEnv.MealPlannerDatabase,
    now: () => decodeImportTimestamp("2026-07-30T00:13:00.000Z"),
    runtimeStage: "pilot-gaia-118",
  });
  await Effect.runPromise(
    service.settle({
      acquisitionGeneration: seeded.generation,
      dispatchId: seeded.recovery.recoveryDispatchId,
      importId: seeded.importId,
      operation: "settle_recipe_recovery_unknown",
    })
  );
  const recovery = await Effect.runPromise(
    makeD1RecipeRecoveryRepository(
      testEnv.MealPlannerDatabase,
      "pilot-gaia-118"
    ).prepareFifth({
      acquisitionGeneration: seeded.generation,
      createdAt: decodeImportTimestamp("2026-07-30T00:14:00.000Z"),
      fourthRecoveryDispatchId: seeded.recovery.recoveryDispatchId,
      importId: seeded.importId,
    })
  );
  await testEnv.MealPlannerDatabase.prepare(
    `INSERT INTO import_recipe_extractions (
       extraction_fingerprint, import_id, acquisition_generation,
       evidence_fingerprint, extractor_provider, extractor_model,
       extractor_version, state, created_at, updated_at
     ) VALUES (
       ?, ?, ?, ?, 'cloudflare-workers-ai', 'recipe-model',
       'installed-alchemy-forced-tool-v2', 'dispatching', ?, ?
     )`
  )
    .bind(
      recovery.recoveryExtractionFingerprint,
      seeded.importId,
      seeded.generation,
      seeded.evidenceFingerprint,
      "2026-07-30T00:15:00.000Z",
      "2026-07-30T00:15:00.000Z"
    )
    .run();
  const reservation = {
    dispatchId: recovery.recoveryDispatchId,
    maximumCostMicroUsd: 100_000,
    providerStageId: decodeStageId("recipe-extraction"),
    runId: decodeRunId(`gaia-118:recipe-recovery:${seeded.importId}`),
    timestamp: decodeBudgetTimestamp("2026-07-30T00:15:00.000Z"),
  };
  const budget = makeD1PilotProviderBudgetRepository(
    testEnv.MealPlannerDatabase,
    "pilot-gaia-118"
  );
  await Effect.runPromise(budget.reserve(reservation));
  await Effect.runPromise(budget.beginInvocation(reservation));
  await Effect.runPromise(budget.settleUnknown(reservation));
  await Effect.runPromise(
    makeD1RecipeDraftRepository(testEnv.MealPlannerDatabase).fail({
      completedAt: decodeImportTimestamp("2026-07-30T00:15:01.000Z"),
      extractionFingerprint: recovery.recoveryExtractionFingerprint,
      failureCode: "provider_error",
    })
  );
  return { ...seeded, recovery };
};

const seedUnknownSixthRecovery = async (suffix: string) => {
  const seeded = await seedUnknownFifthRecovery(suffix);
  const service = makeD1ProviderTerminalSettlementService({
    database: testEnv.MealPlannerDatabase,
    now: () => decodeImportTimestamp("2026-07-30T00:16:00.000Z"),
    runtimeStage: "pilot-gaia-118",
  });
  await Effect.runPromise(
    service.settle({
      acquisitionGeneration: seeded.generation,
      dispatchId: seeded.recovery.recoveryDispatchId,
      importId: seeded.importId,
      operation: "settle_recipe_recovery_unknown",
    })
  );
  const recovery = await Effect.runPromise(
    makeD1RecipeRecoveryRepository(
      testEnv.MealPlannerDatabase,
      "pilot-gaia-118"
    ).prepareSixth({
      acquisitionGeneration: seeded.generation,
      createdAt: decodeImportTimestamp("2026-07-30T00:17:00.000Z"),
      fifthRecoveryDispatchId: seeded.recovery.recoveryDispatchId,
      importId: seeded.importId,
    })
  );
  await testEnv.MealPlannerDatabase.prepare(
    `INSERT INTO import_recipe_extractions (
       extraction_fingerprint, import_id, acquisition_generation,
       evidence_fingerprint, extractor_provider, extractor_model,
       extractor_version, state, created_at, updated_at
     ) VALUES (
       ?, ?, ?, ?, 'cloudflare-workers-ai', 'recipe-model',
       'installed-alchemy-forced-tool-v2', 'dispatching', ?, ?
     )`
  )
    .bind(
      recovery.recoveryExtractionFingerprint,
      seeded.importId,
      seeded.generation,
      seeded.evidenceFingerprint,
      "2026-07-30T00:18:00.000Z",
      "2026-07-30T00:18:00.000Z"
    )
    .run();
  const reservation = {
    dispatchId: recovery.recoveryDispatchId,
    maximumCostMicroUsd: 100_000,
    providerStageId: decodeStageId("recipe-extraction"),
    runId: decodeRunId(`gaia-118:recipe-recovery:${seeded.importId}`),
    timestamp: decodeBudgetTimestamp("2026-07-30T00:18:00.000Z"),
  };
  const budget = makeD1PilotProviderBudgetRepository(
    testEnv.MealPlannerDatabase,
    "pilot-gaia-118"
  );
  await Effect.runPromise(budget.reserve(reservation));
  await Effect.runPromise(budget.beginInvocation(reservation));
  await Effect.runPromise(budget.settleUnknown(reservation));
  await Effect.runPromise(
    makeD1RecipeDraftRepository(testEnv.MealPlannerDatabase).fail({
      completedAt: decodeImportTimestamp("2026-07-30T00:18:01.000Z"),
      extractionFingerprint: recovery.recoveryExtractionFingerprint,
      failureCode: "provider_error",
    })
  );
  return { ...seeded, recovery };
};

const seedUnknownSeventhRecovery = async (suffix: string) => {
  const seeded = await seedUnknownSixthRecovery(suffix);
  const service = makeD1ProviderTerminalSettlementService({
    database: testEnv.MealPlannerDatabase,
    now: () => decodeImportTimestamp("2026-07-30T00:19:00.000Z"),
    runtimeStage: "pilot-gaia-118",
  });
  await Effect.runPromise(
    service.settle({
      acquisitionGeneration: seeded.generation,
      dispatchId: seeded.recovery.recoveryDispatchId,
      importId: seeded.importId,
      operation: "settle_recipe_recovery_unknown",
    })
  );
  const recovery = await Effect.runPromise(
    makeD1RecipeRecoveryRepository(
      testEnv.MealPlannerDatabase,
      "pilot-gaia-118"
    ).prepareSeventh({
      acquisitionGeneration: seeded.generation,
      createdAt: decodeImportTimestamp("2026-07-30T00:20:00.000Z"),
      importId: seeded.importId,
      sixthRecoveryDispatchId: seeded.recovery.recoveryDispatchId,
    })
  );
  await testEnv.MealPlannerDatabase.prepare(
    `INSERT INTO import_recipe_extractions (
       extraction_fingerprint, import_id, acquisition_generation,
       evidence_fingerprint, extractor_provider, extractor_model,
       extractor_version, state, created_at, updated_at
     ) VALUES (
       ?, ?, ?, ?, 'cloudflare-workers-ai', 'recipe-model',
       'installed-alchemy-forced-tool-v2', 'dispatching', ?, ?
     )`
  )
    .bind(
      recovery.recoveryExtractionFingerprint,
      seeded.importId,
      seeded.generation,
      seeded.evidenceFingerprint,
      "2026-07-30T00:21:00.000Z",
      "2026-07-30T00:21:00.000Z"
    )
    .run();
  const reservation = {
    dispatchId: recovery.recoveryDispatchId,
    maximumCostMicroUsd: 100_000,
    providerStageId: decodeStageId("recipe-extraction"),
    runId: decodeRunId(`gaia-118:recipe-recovery:${seeded.importId}`),
    timestamp: decodeBudgetTimestamp("2026-07-30T00:21:00.000Z"),
  };
  const budget = makeD1PilotProviderBudgetRepository(
    testEnv.MealPlannerDatabase,
    "pilot-gaia-118"
  );
  await Effect.runPromise(budget.reserve(reservation));
  await Effect.runPromise(budget.beginInvocation(reservation));
  await Effect.runPromise(budget.settleUnknown(reservation));
  await Effect.runPromise(
    makeD1RecipeDraftRepository(testEnv.MealPlannerDatabase).fail({
      completedAt: decodeImportTimestamp("2026-07-30T00:21:01.000Z"),
      extractionFingerprint: recovery.recoveryExtractionFingerprint,
      failureCode: "provider_error",
    })
  );
  return { ...seeded, recovery };
};

const seedUnknownEighthRecovery = async (suffix: string) => {
  const seeded = await seedUnknownSeventhRecovery(suffix);
  const service = makeD1ProviderTerminalSettlementService({
    database: testEnv.MealPlannerDatabase,
    now: () => decodeImportTimestamp("2026-07-30T00:22:00.000Z"),
    runtimeStage: "pilot-gaia-118",
  });
  await Effect.runPromise(
    service.settle({
      acquisitionGeneration: seeded.generation,
      dispatchId: seeded.recovery.recoveryDispatchId,
      importId: seeded.importId,
      operation: "settle_recipe_recovery_unknown",
    })
  );
  const recovery = await Effect.runPromise(
    makeD1RecipeRecoveryRepository(
      testEnv.MealPlannerDatabase,
      "pilot-gaia-118"
    ).prepareEighth({
      acquisitionGeneration: seeded.generation,
      createdAt: decodeImportTimestamp("2026-07-30T00:23:00.000Z"),
      importId: seeded.importId,
      seventhRecoveryDispatchId: seeded.recovery.recoveryDispatchId,
    })
  );
  await testEnv.MealPlannerDatabase.prepare(
    `INSERT INTO import_recipe_extractions (
       extraction_fingerprint, import_id, acquisition_generation,
       evidence_fingerprint, extractor_provider, extractor_model,
       extractor_version, state, created_at, updated_at
     ) VALUES (
       ?, ?, ?, ?, 'cloudflare-workers-ai', 'recipe-model',
       'installed-alchemy-forced-tool-v2', 'dispatching', ?, ?
     )`
  )
    .bind(
      recovery.recoveryExtractionFingerprint,
      seeded.importId,
      seeded.generation,
      seeded.evidenceFingerprint,
      "2026-07-30T00:24:00.000Z",
      "2026-07-30T00:24:00.000Z"
    )
    .run();
  const reservation = {
    dispatchId: recovery.recoveryDispatchId,
    maximumCostMicroUsd: 100_000,
    providerStageId: decodeStageId("recipe-extraction"),
    runId: decodeRunId(`gaia-118:recipe-recovery:${seeded.importId}`),
    timestamp: decodeBudgetTimestamp("2026-07-30T00:24:00.000Z"),
  };
  const budget = makeD1PilotProviderBudgetRepository(
    testEnv.MealPlannerDatabase,
    "pilot-gaia-118"
  );
  await Effect.runPromise(budget.reserve(reservation));
  await Effect.runPromise(budget.beginInvocation(reservation));
  await Effect.runPromise(budget.settleUnknown(reservation));
  await Effect.runPromise(
    makeD1RecipeDraftRepository(testEnv.MealPlannerDatabase).fail({
      completedAt: decodeImportTimestamp("2026-07-30T00:24:01.000Z"),
      extractionFingerprint: recovery.recoveryExtractionFingerprint,
      failureCode: "provider_error",
    })
  );
  return { ...seeded, recovery };
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

const postResume = (
  app: Awaited<ReturnType<typeof makeApp>>,
  seeded: Awaited<ReturnType<typeof seedEligibleTerminalRecipe>>,
  token = "test-import-token",
  dispatchId = seeded.dispatchId
) =>
  app.handler(
    new Request(
      "https://meal-planner.test/imports/operator-provider-terminal-settlement",
      {
        body: JSON.stringify({
          acquisitionGeneration: seeded.generation,
          dispatchId,
          importId: seeded.importId,
          operation: "resume_recipe_recovery",
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
    const resumed: RecipeRecovery[] = [];
    const app = await makeApp(started, resumed);

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
    const wrongDispatchId = decodeDispatchId(
      `recipe:${seeded.importId}:${seeded.generation}:${"0".repeat(64)}`
    );
    const wrongDispatch = await postResume(
      app,
      seeded,
      "test-import-token",
      wrongDispatchId
    );
    expect(wrongDispatch.status).toBe(409);
    expect(resumed).toEqual([]);
    const [resumedFirst, resumedDuplicate] = await Promise.all([
      postResume(app, seeded),
      postResume(app, seeded),
    ]);
    expect(resumedFirst.status).toBe(200);
    expect(resumedDuplicate.status).toBe(200);
    const resumedBody = await resumedFirst.json();
    await expect(resumedDuplicate.json()).resolves.toEqual(resumedBody);
    expect(resumedBody).toMatchObject({
      acquisitionGeneration: seeded.generation,
      dispatchId: seeded.dispatchId,
      importId: seeded.importId,
      outcome: "recipe_recovery_resumed",
      recoveryDispatchId: `${seeded.dispatchId}:recovery:1`,
      runtimeStage: "pilot-gaia-118",
    });
    expect(resumed).toHaveLength(2);
    expect(resumed[0]).toEqual(resumed[1]);
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

  it("admits resume only before recovery extraction and budget dispatch begin", async () => {
    const extractionSeed = await seedEligibleTerminalRecipe("000000000210");
    const extractionRepository = makeD1RecipeRecoveryRepository(
      testEnv.MealPlannerDatabase,
      "pilot-gaia-118"
    );
    const extractionRecovery = await Effect.runPromise(
      extractionRepository.prepare({
        acquisitionGeneration: extractionSeed.generation,
        createdAt: decodeImportTimestamp("2026-07-30T00:02:00.000Z"),
        importId: extractionSeed.importId,
        originalDispatchId: extractionSeed.dispatchId,
      })
    );

    await expect(
      Effect.runPromise(
        extractionRepository.readResume({
          acquisitionGeneration: extractionSeed.generation,
          importId: extractionSeed.importId,
        })
      )
    ).resolves.toEqual(extractionRecovery);
    await testEnv.MealPlannerDatabase.prepare(
      `INSERT INTO import_recipe_extractions (
         extraction_fingerprint, import_id, acquisition_generation,
         evidence_fingerprint, extractor_provider, extractor_model,
         extractor_version, state, created_at, updated_at
       ) VALUES (?, ?, ?, ?, 'cloudflare-workers-ai', 'recipe-model',
         'installed-v1', 'dispatching', ?, ?)`
    )
      .bind(
        extractionRecovery.recoveryExtractionFingerprint,
        extractionSeed.importId,
        extractionSeed.generation,
        extractionSeed.evidenceFingerprint,
        "2026-07-30T00:03:00.000Z",
        "2026-07-30T00:03:00.000Z"
      )
      .run();
    const extractionStarted = await Effect.runPromiseExit(
      extractionRepository.readResume({
        acquisitionGeneration: extractionSeed.generation,
        importId: extractionSeed.importId,
      })
    );
    expect(extractionStarted._tag).toBe("Failure");

    const dispatchSeed = await seedEligibleTerminalRecipe("000000000211");
    const dispatchRepository = makeD1RecipeRecoveryRepository(
      testEnv.MealPlannerDatabase,
      "pilot-gaia-118"
    );
    const dispatchRecovery = await Effect.runPromise(
      dispatchRepository.prepare({
        acquisitionGeneration: dispatchSeed.generation,
        createdAt: decodeImportTimestamp("2026-07-30T00:02:00.000Z"),
        importId: dispatchSeed.importId,
        originalDispatchId: dispatchSeed.dispatchId,
      })
    );
    const budget = makeD1PilotProviderBudgetRepository(
      testEnv.MealPlannerDatabase,
      "pilot-gaia-118"
    );
    await Effect.runPromise(
      budget.reserve({
        dispatchId: dispatchRecovery.recoveryDispatchId,
        maximumCostMicroUsd: 100_000,
        providerStageId: decodeStageId("recipe-extraction"),
        runId: decodeRunId(`gaia-118:recipe-recovery:${dispatchSeed.importId}`),
        timestamp: decodeBudgetTimestamp("2026-07-30T00:03:00.000Z"),
      })
    );

    const budgetDispatched = await Effect.runPromiseExit(
      dispatchRepository.readResume({
        acquisitionGeneration: dispatchSeed.generation,
        importId: dispatchSeed.importId,
      })
    );
    expect(budgetDispatched._tag).toBe("Failure");
  });

  it("settles the exact poisoned recovery identity once and idempotently reopens the stage", async () => {
    const seeded = await seedUnknownFirstRecovery("000000000212");
    const app = await makeApp([]);
    const request = {
      acquisitionGeneration: seeded.generation,
      dispatchId: seeded.recovery.recoveryDispatchId,
      importId: seeded.importId,
      operation: "settle_recipe_recovery_unknown" as const,
    };

    const unauthenticated = await postOperation(app, request, "wrong-token");
    expect(unauthenticated.status).toBe(401);
    const wrongGeneration = await postOperation(app, {
      ...request,
      acquisitionGeneration: decodeGeneration(2),
    });
    expect(wrongGeneration.status).toBe(409);
    const wrongDispatch = await postOperation(app, {
      ...request,
      dispatchId: seeded.dispatchId,
    });
    expect(wrongDispatch.status).toBe(409);

    const [first, concurrent] = await Promise.all([
      postOperation(app, request),
      postOperation(app, request),
    ]);
    expect(first.status).toBe(200);
    expect(concurrent.status).toBe(200);
    const firstBody = await first.json();
    await expect(concurrent.json()).resolves.toEqual(firstBody);
    expect(firstBody).toEqual({
      acquisitionGeneration: seeded.generation,
      conservativeChargeMicroUsd: 100_000,
      dispatchId: seeded.recovery.recoveryDispatchId,
      importId: seeded.importId,
      outcome: "recipe_recovery_unknown_cost_settled",
      runtimeStage: "pilot-gaia-118",
    });

    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT state, settled_micro_usd, reserved_micro_usd,
                invoking_dispatch_id, poison_dispatch_id
           FROM pilot_provider_stage_budget
          WHERE runtime_stage = 'pilot-gaia-118'`
      ).first()
    ).resolves.toEqual({
      invoking_dispatch_id: null,
      poison_dispatch_id: null,
      reserved_micro_usd: 0,
      settled_micro_usd: 200_000,
      state: "open",
    });
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT COUNT(*) AS count
           FROM pilot_provider_budget_reconciliations
          WHERE runtime_stage = 'pilot-gaia-118'
            AND dispatch_id = ?`
      )
        .bind(seeded.recovery.recoveryDispatchId)
        .first()
    ).resolves.toEqual({ count: 1 });
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT COUNT(*) AS count
           FROM pilot_provider_recipe_replay_values
          WHERE runtime_stage = 'pilot-gaia-118'
            AND dispatch_id = ?`
      )
        .bind(seeded.recovery.recoveryDispatchId)
        .first()
    ).resolves.toEqual({ count: 0 });
  });

  it("admits at most one concurrency-safe second recovery after exact settlement without dispatching a provider", async () => {
    const seeded = await seedUnknownFirstRecovery("000000000213");
    const started: RecipeRecovery[] = [];
    const app = await makeApp(started);
    const settleRequest = {
      acquisitionGeneration: seeded.generation,
      dispatchId: seeded.recovery.recoveryDispatchId,
      importId: seeded.importId,
      operation: "settle_recipe_recovery_unknown" as const,
    };
    const settlement = await postOperation(app, settleRequest);
    expect(settlement.status).toBe(200);
    const prepareRequest = {
      acquisitionGeneration: seeded.generation,
      dispatchId: seeded.recovery.recoveryDispatchId,
      importId: seeded.importId,
      operation: "prepare_recipe_second_recovery" as const,
    };

    const [first, concurrent] = await Promise.all([
      postOperation(app, prepareRequest),
      postOperation(app, prepareRequest),
    ]);
    expect(first.status).toBe(200);
    expect(concurrent.status).toBe(200);
    const firstBody = await first.json();
    await expect(concurrent.json()).resolves.toEqual(firstBody);
    expect(firstBody).toMatchObject({
      acquisitionGeneration: seeded.generation,
      dispatchId: seeded.recovery.recoveryDispatchId,
      importId: seeded.importId,
      outcome: "recipe_second_recovery_prepared",
      recoveryDispatchId: `${seeded.dispatchId}:recovery:2`,
      runtimeStage: "pilot-gaia-118",
    });
    expect(started).toHaveLength(2);
    expect(started[0]).toEqual(started[1]);
    expect(started[0]).toMatchObject({
      originalDispatchId: seeded.recovery.recoveryDispatchId,
      recoveryDispatchId: `${seeded.dispatchId}:recovery:2`,
      recoveryIdentity: "recovery:2",
      recoveryOrdinal: 2,
    });
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT COUNT(*) AS count
           FROM pilot_provider_recipe_second_recoveries
          WHERE runtime_stage = 'pilot-gaia-118' AND import_id = ?`
      )
        .bind(seeded.importId)
        .first()
    ).resolves.toEqual({ count: 1 });
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT COUNT(*) AS count
           FROM pilot_provider_budget_dispatches
          WHERE runtime_stage = 'pilot-gaia-118'
            AND run_id = ?
            AND provider_stage_id = 'recipe-extraction'`
      )
        .bind(`gaia-118:recipe-recovery:${seeded.importId}`)
        .first()
    ).resolves.toEqual({ count: 1 });
  });

  it("rejects a second recovery until exact settlement and unchanged evidence are proven", async () => {
    const unsettled = await seedUnknownFirstRecovery("000000000214");
    const app = await makeApp([]);
    const beforeSettlement = await postOperation(app, {
      acquisitionGeneration: unsettled.generation,
      dispatchId: unsettled.recovery.recoveryDispatchId,
      importId: unsettled.importId,
      operation: "prepare_recipe_second_recovery",
    });
    expect(beforeSettlement.status).toBe(409);

    const settleRequest = {
      acquisitionGeneration: unsettled.generation,
      dispatchId: unsettled.recovery.recoveryDispatchId,
      importId: unsettled.importId,
      operation: "settle_recipe_recovery_unknown" as const,
    };
    const settlement = await postOperation(app, settleRequest);
    expect(settlement.status).toBe(200);
    await testEnv.MealPlannerDatabase.prepare(
      `UPDATE recipe_imports
          SET status = 'queued',
              status_code = NULL,
              recovery_action = NULL,
              evidence_references_json = '[]'
        WHERE id = ? AND acquisition_generation = ?`
    )
      .bind(unsettled.importId, unsettled.generation)
      .run();
    const staleEvidence = await postOperation(app, {
      acquisitionGeneration: unsettled.generation,
      dispatchId: unsettled.recovery.recoveryDispatchId,
      importId: unsettled.importId,
      operation: "prepare_recipe_second_recovery",
    });
    expect(staleEvidence.status).toBe(409);
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT COUNT(*) AS count
           FROM pilot_provider_recipe_second_recoveries
          WHERE runtime_stage = 'pilot-gaia-118' AND import_id = ?`
      )
        .bind(unsettled.importId)
        .first()
    ).resolves.toEqual({ count: 0 });
  });

  it("settles the exact poisoned second recovery and admits one immutable third identity", async () => {
    const seeded = await seedUnknownSecondRecovery("000000000215");
    const started: RecipeRecovery[] = [];
    const app = await makeApp(started);
    const settleRequest = {
      acquisitionGeneration: seeded.generation,
      dispatchId: seeded.recovery.recoveryDispatchId,
      importId: seeded.importId,
      operation: "settle_recipe_recovery_unknown" as const,
    };

    const beforeSettlement = await postOperation(app, {
      acquisitionGeneration: seeded.generation,
      dispatchId: seeded.recovery.recoveryDispatchId,
      importId: seeded.importId,
      operation: "prepare_recipe_third_recovery",
    });
    expect(beforeSettlement.status).toBe(409);
    const unauthenticated = await postOperation(
      app,
      settleRequest,
      "wrong-token"
    );
    expect(unauthenticated.status).toBe(401);
    const wrongGeneration = await postOperation(app, {
      ...settleRequest,
      acquisitionGeneration: decodeGeneration(2),
    });
    expect(wrongGeneration.status).toBe(409);
    const wrongDispatch = await postOperation(app, {
      ...settleRequest,
      dispatchId: seeded.dispatchId,
    });
    expect(wrongDispatch.status).toBe(409);
    const [firstSettlement, duplicateSettlement] = await Promise.all([
      postOperation(app, settleRequest),
      postOperation(app, settleRequest),
    ]);
    expect(firstSettlement.status).toBe(200);
    expect(duplicateSettlement.status).toBe(200);
    await expect(duplicateSettlement.json()).resolves.toEqual(
      await firstSettlement.json()
    );

    const prepareRequest = {
      acquisitionGeneration: seeded.generation,
      dispatchId: seeded.recovery.recoveryDispatchId,
      importId: seeded.importId,
      operation: "prepare_recipe_third_recovery" as const,
    };
    const [first, duplicate] = await Promise.all([
      postOperation(app, prepareRequest),
      postOperation(app, prepareRequest),
    ]);
    expect(first.status).toBe(200);
    expect(duplicate.status).toBe(200);
    const firstBody = await first.json();
    await expect(duplicate.json()).resolves.toEqual(firstBody);
    expect(firstBody).toMatchObject({
      acquisitionGeneration: seeded.generation,
      dispatchId: seeded.recovery.recoveryDispatchId,
      importId: seeded.importId,
      outcome: "recipe_third_recovery_prepared",
      recoveryDispatchId: `${seeded.dispatchId}:recovery:3`,
      runtimeStage: "pilot-gaia-118",
    });
    expect(started).toHaveLength(2);
    const [startedRecovery] = started;
    if (startedRecovery === undefined) {
      throw new Error("expected third recovery workflow start");
    }
    expect(startedRecovery).toEqual(started[1]);
    expect(startedRecovery).toMatchObject({
      originalDispatchId: seeded.recovery.recoveryDispatchId,
      recoveryDispatchId: `${seeded.dispatchId}:recovery:3`,
      recoveryIdentity: "recovery:3",
      recoveryOrdinal: 3,
    });
    const thirdReservation = {
      dispatchId: startedRecovery.recoveryDispatchId,
      maximumCostMicroUsd: 100_000,
      providerStageId: decodeStageId("recipe-extraction"),
      runId: decodeRunId(`gaia-118:recipe-recovery:${seeded.importId}`),
      timestamp: decodeBudgetTimestamp("2026-07-30T00:08:00.000Z"),
    };
    const budget = makeD1PilotProviderBudgetRepository(
      testEnv.MealPlannerDatabase,
      "pilot-gaia-118"
    );
    await expect(
      Effect.runPromise(budget.reserve(thirdReservation))
    ).resolves.toMatchObject({
      dispatchId: startedRecovery.recoveryDispatchId,
      state: "reserved",
    });
    await expect(
      Effect.runPromise(budget.releaseBeforeInvocation(thirdReservation))
    ).resolves.toMatchObject({
      dispatchId: startedRecovery.recoveryDispatchId,
      state: "released",
    });
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT state, settled_micro_usd, reserved_micro_usd,
                invoking_dispatch_id, poison_dispatch_id
           FROM pilot_provider_stage_budget
          WHERE runtime_stage = 'pilot-gaia-118'`
      ).first()
    ).resolves.toEqual({
      invoking_dispatch_id: null,
      poison_dispatch_id: null,
      reserved_micro_usd: 0,
      settled_micro_usd: 300_000,
      state: "open",
    });
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT COUNT(*) AS count
           FROM pilot_provider_recipe_third_recoveries
          WHERE runtime_stage = 'pilot-gaia-118' AND import_id = ?`
      )
        .bind(seeded.importId)
        .first()
    ).resolves.toEqual({ count: 1 });
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `UPDATE pilot_provider_recipe_third_recoveries
            SET created_at = '2026-07-30T00:09:00.000Z'
          WHERE runtime_stage = 'pilot-gaia-118' AND import_id = ?`
      )
        .bind(seeded.importId)
        .run()
    ).rejects.toThrow("third recipe recovery is immutable");
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `DELETE FROM pilot_provider_recipe_third_recoveries
          WHERE runtime_stage = 'pilot-gaia-118' AND import_id = ?`
      )
        .bind(seeded.importId)
        .run()
    ).rejects.toThrow("third recipe recovery is immutable");
  });

  it("rejects a third recovery when settled evidence no longer matches", async () => {
    const seeded = await seedUnknownSecondRecovery("000000000216");
    const app = await makeApp([]);
    const settlement = await postOperation(app, {
      acquisitionGeneration: seeded.generation,
      dispatchId: seeded.recovery.recoveryDispatchId,
      importId: seeded.importId,
      operation: "settle_recipe_recovery_unknown",
    });
    expect(settlement.status).toBe(200);
    await testEnv.MealPlannerDatabase.prepare(
      `UPDATE import_visual_evidence
          SET manifest_sha256 = ?
        WHERE import_id = ? AND acquisition_generation = ?`
    )
      .bind("f".repeat(64), seeded.importId, seeded.generation)
      .run();

    const staleEvidenceResponse = await postOperation(app, {
      acquisitionGeneration: seeded.generation,
      dispatchId: seeded.recovery.recoveryDispatchId,
      importId: seeded.importId,
      operation: "prepare_recipe_third_recovery",
    });
    expect(staleEvidenceResponse.status).toBe(409);
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT COUNT(*) AS count
           FROM pilot_provider_recipe_third_recoveries
          WHERE runtime_stage = 'pilot-gaia-118' AND import_id = ?`
      )
        .bind(seeded.importId)
        .first()
    ).resolves.toEqual({ count: 0 });
  });

  it("settles the exact poisoned third recovery and admits one immutable fourth identity", async () => {
    const seeded = await seedUnknownThirdRecovery("000000000217");
    const started: RecipeRecovery[] = [];
    const app = await makeApp(started);
    const settleRequest = {
      acquisitionGeneration: seeded.generation,
      dispatchId: seeded.recovery.recoveryDispatchId,
      importId: seeded.importId,
      operation: "settle_recipe_recovery_unknown" as const,
    };

    const beforeSettlement = await postOperation(app, {
      acquisitionGeneration: seeded.generation,
      dispatchId: seeded.recovery.recoveryDispatchId,
      importId: seeded.importId,
      operation: "prepare_recipe_fourth_recovery",
    });
    expect(beforeSettlement.status).toBe(409);
    const [firstSettlement, duplicateSettlement] = await Promise.all([
      postOperation(app, settleRequest),
      postOperation(app, settleRequest),
    ]);
    expect(firstSettlement.status).toBe(200);
    expect(duplicateSettlement.status).toBe(200);
    await expect(duplicateSettlement.json()).resolves.toEqual(
      await firstSettlement.json()
    );

    const prepareRequest = {
      acquisitionGeneration: seeded.generation,
      dispatchId: seeded.recovery.recoveryDispatchId,
      importId: seeded.importId,
      operation: "prepare_recipe_fourth_recovery" as const,
    };
    const [first, duplicate] = await Promise.all([
      postOperation(app, prepareRequest),
      postOperation(app, prepareRequest),
    ]);
    expect(first.status).toBe(200);
    expect(duplicate.status).toBe(200);
    const firstBody = await first.json();
    await expect(duplicate.json()).resolves.toEqual(firstBody);
    expect(firstBody).toMatchObject({
      acquisitionGeneration: seeded.generation,
      dispatchId: seeded.recovery.recoveryDispatchId,
      importId: seeded.importId,
      outcome: "recipe_fourth_recovery_prepared",
      recoveryDispatchId: `${seeded.dispatchId}:recovery:4`,
      runtimeStage: "pilot-gaia-118",
    });
    expect(started).toHaveLength(2);
    expect(started[0]).toEqual(started[1]);
    expect(started[0]).toMatchObject({
      originalDispatchId: seeded.recovery.recoveryDispatchId,
      recoveryDispatchId: `${seeded.dispatchId}:recovery:4`,
      recoveryIdentity: "recovery:4",
      recoveryOrdinal: 4,
    });
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT state, settled_micro_usd, reserved_micro_usd,
                invoking_dispatch_id, poison_dispatch_id
           FROM pilot_provider_stage_budget
          WHERE runtime_stage = 'pilot-gaia-118'`
      ).first()
    ).resolves.toEqual({
      invoking_dispatch_id: null,
      poison_dispatch_id: null,
      reserved_micro_usd: 0,
      settled_micro_usd: 400_000,
      state: "open",
    });
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT COUNT(*) AS count
           FROM pilot_provider_recipe_fourth_recoveries
          WHERE runtime_stage = 'pilot-gaia-118' AND import_id = ?`
      )
        .bind(seeded.importId)
        .first()
    ).resolves.toEqual({ count: 1 });
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `UPDATE pilot_provider_recipe_fourth_recoveries
            SET created_at = '2026-07-30T00:10:00.000Z'
          WHERE runtime_stage = 'pilot-gaia-118' AND import_id = ?`
      )
        .bind(seeded.importId)
        .run()
    ).rejects.toThrow("fourth recipe recovery is immutable");
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `DELETE FROM pilot_provider_recipe_fourth_recoveries
          WHERE runtime_stage = 'pilot-gaia-118' AND import_id = ?`
      )
        .bind(seeded.importId)
        .run()
    ).rejects.toThrow("fourth recipe recovery is immutable");
  });

  it("settles the exact poisoned fourth recovery and admits one immutable fifth identity", async () => {
    const seeded = await seedUnknownFourthRecovery("000000000218");
    const started: RecipeRecovery[] = [];
    const app = await makeApp(started);
    const settleRequest = {
      acquisitionGeneration: seeded.generation,
      dispatchId: seeded.recovery.recoveryDispatchId,
      importId: seeded.importId,
      operation: "settle_recipe_recovery_unknown" as const,
    };

    const beforeSettlement = await postOperation(app, {
      acquisitionGeneration: seeded.generation,
      dispatchId: seeded.recovery.recoveryDispatchId,
      importId: seeded.importId,
      operation: "prepare_recipe_fifth_recovery",
    });
    expect(beforeSettlement.status).toBe(409);
    const [firstSettlement, duplicateSettlement] = await Promise.all([
      postOperation(app, settleRequest),
      postOperation(app, settleRequest),
    ]);
    expect(firstSettlement.status).toBe(200);
    expect(duplicateSettlement.status).toBe(200);
    await expect(duplicateSettlement.json()).resolves.toEqual(
      await firstSettlement.json()
    );

    const prepareRequest = {
      acquisitionGeneration: seeded.generation,
      dispatchId: seeded.recovery.recoveryDispatchId,
      importId: seeded.importId,
      operation: "prepare_recipe_fifth_recovery" as const,
    };
    const [first, duplicate] = await Promise.all([
      postOperation(app, prepareRequest),
      postOperation(app, prepareRequest),
    ]);
    expect(first.status).toBe(200);
    expect(duplicate.status).toBe(200);
    const firstBody = await first.json();
    await expect(duplicate.json()).resolves.toEqual(firstBody);
    expect(firstBody).toMatchObject({
      acquisitionGeneration: seeded.generation,
      dispatchId: seeded.recovery.recoveryDispatchId,
      importId: seeded.importId,
      outcome: "recipe_fifth_recovery_prepared",
      recoveryDispatchId: `${seeded.dispatchId}:recovery:5`,
      runtimeStage: "pilot-gaia-118",
    });
    expect(started).toHaveLength(2);
    expect(started[0]).toEqual(started[1]);
    expect(started[0]).toMatchObject({
      originalDispatchId: seeded.recovery.recoveryDispatchId,
      recoveryDispatchId: `${seeded.dispatchId}:recovery:5`,
      recoveryIdentity: "recovery:5",
      recoveryOrdinal: 5,
    });
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT state, settled_micro_usd, reserved_micro_usd,
                invoking_dispatch_id, poison_dispatch_id
           FROM pilot_provider_stage_budget
          WHERE runtime_stage = 'pilot-gaia-118'`
      ).first()
    ).resolves.toEqual({
      invoking_dispatch_id: null,
      poison_dispatch_id: null,
      reserved_micro_usd: 0,
      settled_micro_usd: 500_000,
      state: "open",
    });
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT COUNT(*) AS count
           FROM pilot_provider_recipe_fifth_recoveries
          WHERE runtime_stage = 'pilot-gaia-118' AND import_id = ?`
      )
        .bind(seeded.importId)
        .first()
    ).resolves.toEqual({ count: 1 });
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `UPDATE pilot_provider_recipe_fifth_recoveries
            SET created_at = '2026-07-30T00:13:00.000Z'
          WHERE runtime_stage = 'pilot-gaia-118' AND import_id = ?`
      )
        .bind(seeded.importId)
        .run()
    ).rejects.toThrow("fifth recipe recovery is immutable");
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `DELETE FROM pilot_provider_recipe_fifth_recoveries
          WHERE runtime_stage = 'pilot-gaia-118' AND import_id = ?`
      )
        .bind(seeded.importId)
        .run()
    ).rejects.toThrow("fifth recipe recovery is immutable");
  });

  it("settles the exact poisoned fifth recovery and admits one immutable sixth identity", async () => {
    const seeded = await seedUnknownFifthRecovery("000000000219");
    const started: RecipeRecovery[] = [];
    const resumed: RecipeRecovery[] = [];
    const app = await makeApp(started, resumed);
    const settleRequest = {
      acquisitionGeneration: seeded.generation,
      dispatchId: seeded.recovery.recoveryDispatchId,
      importId: seeded.importId,
      operation: "settle_recipe_recovery_unknown" as const,
    };

    const beforeSettlement = await postOperation(app, {
      acquisitionGeneration: seeded.generation,
      dispatchId: seeded.recovery.recoveryDispatchId,
      importId: seeded.importId,
      operation: "prepare_recipe_sixth_recovery",
    });
    expect(beforeSettlement.status).toBe(409);
    const [firstSettlement, duplicateSettlement] = await Promise.all([
      postOperation(app, settleRequest),
      postOperation(app, settleRequest),
    ]);
    expect(firstSettlement.status).toBe(200);
    expect(duplicateSettlement.status).toBe(200);
    await expect(duplicateSettlement.json()).resolves.toEqual(
      await firstSettlement.json()
    );

    const prepareRequest = {
      acquisitionGeneration: seeded.generation,
      dispatchId: seeded.recovery.recoveryDispatchId,
      importId: seeded.importId,
      operation: "prepare_recipe_sixth_recovery" as const,
    };
    const [first, duplicate] = await Promise.all([
      postOperation(app, prepareRequest),
      postOperation(app, prepareRequest),
    ]);
    expect(first.status).toBe(200);
    expect(duplicate.status).toBe(200);
    const firstBody = await first.json();
    await expect(duplicate.json()).resolves.toEqual(firstBody);
    expect(firstBody).toMatchObject({
      acquisitionGeneration: seeded.generation,
      dispatchId: seeded.recovery.recoveryDispatchId,
      importId: seeded.importId,
      outcome: "recipe_sixth_recovery_prepared",
      recoveryDispatchId: `${seeded.dispatchId}:recovery:6`,
      runtimeStage: "pilot-gaia-118",
    });
    expect(started).toHaveLength(2);
    expect(started[0]).toEqual(started[1]);
    expect(started[0]).toMatchObject({
      originalDispatchId: seeded.recovery.recoveryDispatchId,
      recoveryDispatchId: `${seeded.dispatchId}:recovery:6`,
      recoveryIdentity: "recovery:6",
      recoveryOrdinal: 6,
    });
    const [resumedFirst, resumedDuplicate] = await Promise.all([
      postResume(
        app,
        seeded,
        "test-import-token",
        seeded.recovery.recoveryDispatchId
      ),
      postResume(
        app,
        seeded,
        "test-import-token",
        seeded.recovery.recoveryDispatchId
      ),
    ]);
    expect(resumedFirst.status).toBe(200);
    expect(resumedDuplicate.status).toBe(200);
    const resumedBody = await resumedFirst.json();
    await expect(resumedDuplicate.json()).resolves.toEqual(resumedBody);
    expect(resumedBody).toMatchObject({
      acquisitionGeneration: seeded.generation,
      dispatchId: seeded.recovery.recoveryDispatchId,
      importId: seeded.importId,
      outcome: "recipe_recovery_resumed",
      recoveryDispatchId: `${seeded.dispatchId}:recovery:6`,
      runtimeStage: "pilot-gaia-118",
    });
    expect(resumed).toHaveLength(2);
    expect(resumed[0]).toEqual(resumed[1]);
    expect(resumed[0]).toMatchObject({
      originalDispatchId: seeded.recovery.recoveryDispatchId,
      recoveryDispatchId: `${seeded.dispatchId}:recovery:6`,
      recoveryIdentity: "recovery:6",
      recoveryOrdinal: 6,
    });
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT state, settled_micro_usd, reserved_micro_usd,
                invoking_dispatch_id, poison_dispatch_id
           FROM pilot_provider_stage_budget
          WHERE runtime_stage = 'pilot-gaia-118'`
      ).first()
    ).resolves.toEqual({
      invoking_dispatch_id: null,
      poison_dispatch_id: null,
      reserved_micro_usd: 0,
      settled_micro_usd: 600_000,
      state: "open",
    });
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT COUNT(*) AS count
           FROM pilot_provider_recipe_sixth_recoveries
          WHERE runtime_stage = 'pilot-gaia-118' AND import_id = ?`
      )
        .bind(seeded.importId)
        .first()
    ).resolves.toEqual({ count: 1 });
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `UPDATE pilot_provider_recipe_sixth_recoveries
            SET created_at = '2026-07-30T00:16:00.000Z'
          WHERE runtime_stage = 'pilot-gaia-118' AND import_id = ?`
      )
        .bind(seeded.importId)
        .run()
    ).rejects.toThrow("sixth recipe recovery is immutable");
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `DELETE FROM pilot_provider_recipe_sixth_recoveries
          WHERE runtime_stage = 'pilot-gaia-118' AND import_id = ?`
      )
        .bind(seeded.importId)
        .run()
    ).rejects.toThrow("sixth recipe recovery is immutable");
  });

  it("settles the exact poisoned sixth recovery and admits one immutable seventh identity", async () => {
    const seeded = await seedUnknownSixthRecovery("000000000231");
    const started: RecipeRecovery[] = [];
    const resumed: RecipeRecovery[] = [];
    const app = await makeApp(started, resumed);

    const beforeSettlement = await postOperation(app, {
      acquisitionGeneration: seeded.generation,
      dispatchId: seeded.recovery.recoveryDispatchId,
      importId: seeded.importId,
      operation: "prepare_recipe_seventh_recovery",
    });
    expect(beforeSettlement.status).toBe(409);

    const settleRequest = {
      acquisitionGeneration: seeded.generation,
      dispatchId: seeded.recovery.recoveryDispatchId,
      importId: seeded.importId,
      operation: "settle_recipe_recovery_unknown" as const,
    };
    const [firstSettlement, duplicateSettlement] = await Promise.all([
      postOperation(app, settleRequest),
      postOperation(app, settleRequest),
    ]);
    expect(firstSettlement.status).toBe(200);
    expect(duplicateSettlement.status).toBe(200);
    await expect(duplicateSettlement.json()).resolves.toEqual(
      await firstSettlement.json()
    );

    const prepareRequest = {
      acquisitionGeneration: seeded.generation,
      dispatchId: seeded.recovery.recoveryDispatchId,
      importId: seeded.importId,
      operation: "prepare_recipe_seventh_recovery" as const,
    };
    const [first, duplicate] = await Promise.all([
      postOperation(app, prepareRequest),
      postOperation(app, prepareRequest),
    ]);
    expect(first.status).toBe(200);
    expect(duplicate.status).toBe(200);
    const firstBody = await first.json();
    await expect(duplicate.json()).resolves.toEqual(firstBody);
    expect(firstBody).toMatchObject({
      acquisitionGeneration: seeded.generation,
      dispatchId: seeded.recovery.recoveryDispatchId,
      importId: seeded.importId,
      outcome: "recipe_seventh_recovery_prepared",
      recoveryDispatchId: `${seeded.dispatchId}:recovery:7`,
      runtimeStage: "pilot-gaia-118",
    });
    expect(started).toHaveLength(2);
    expect(started[0]).toEqual(started[1]);
    expect(started[0]).toMatchObject({
      originalDispatchId: seeded.recovery.recoveryDispatchId,
      recoveryDispatchId: `${seeded.dispatchId}:recovery:7`,
      recoveryIdentity: "recovery:7",
      recoveryOrdinal: 7,
    });

    const [resumedFirst, resumedDuplicate] = await Promise.all([
      postResume(
        app,
        seeded,
        "test-import-token",
        seeded.recovery.recoveryDispatchId
      ),
      postResume(
        app,
        seeded,
        "test-import-token",
        seeded.recovery.recoveryDispatchId
      ),
    ]);
    expect(resumedFirst.status).toBe(200);
    expect(resumedDuplicate.status).toBe(200);
    const resumedBody = await resumedFirst.json();
    await expect(resumedDuplicate.json()).resolves.toEqual(resumedBody);
    expect(resumedBody).toMatchObject({
      outcome: "recipe_recovery_resumed",
      recoveryDispatchId: `${seeded.dispatchId}:recovery:7`,
      runtimeStage: "pilot-gaia-118",
    });
    expect(resumed).toHaveLength(2);
    expect(resumed[0]).toEqual(resumed[1]);
    expect(resumed[0]).toMatchObject({
      recoveryIdentity: "recovery:7",
      recoveryOrdinal: 7,
    });

    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT state, settled_micro_usd, reserved_micro_usd,
                invoking_dispatch_id, poison_dispatch_id
           FROM pilot_provider_stage_budget
          WHERE runtime_stage = 'pilot-gaia-118'`
      ).first()
    ).resolves.toEqual({
      invoking_dispatch_id: null,
      poison_dispatch_id: null,
      reserved_micro_usd: 0,
      settled_micro_usd: 700_000,
      state: "open",
    });
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT COUNT(*) AS count
           FROM pilot_provider_recipe_seventh_recoveries
          WHERE runtime_stage = 'pilot-gaia-118' AND import_id = ?`
      )
        .bind(seeded.importId)
        .first()
    ).resolves.toEqual({ count: 1 });
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `UPDATE pilot_provider_recipe_seventh_recoveries
            SET created_at = '2026-07-30T00:22:00.000Z'
          WHERE runtime_stage = 'pilot-gaia-118' AND import_id = ?`
      )
        .bind(seeded.importId)
        .run()
    ).rejects.toThrow("seventh recipe recovery is immutable");
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `DELETE FROM pilot_provider_recipe_seventh_recoveries
          WHERE runtime_stage = 'pilot-gaia-118' AND import_id = ?`
      )
        .bind(seeded.importId)
        .run()
    ).rejects.toThrow("seventh recipe recovery is immutable");
  });

  it("settles the exact poisoned seventh recovery and admits one immutable eighth identity", async () => {
    const seeded = await seedUnknownSeventhRecovery("000000000239");
    const started: RecipeRecovery[] = [];
    const resumed: RecipeRecovery[] = [];
    const app = await makeApp(started, resumed);

    const beforeSettlement = await postOperation(app, {
      acquisitionGeneration: seeded.generation,
      dispatchId: seeded.recovery.recoveryDispatchId,
      importId: seeded.importId,
      operation: "prepare_recipe_eighth_recovery",
    });
    expect(beforeSettlement.status).toBe(409);

    const settleRequest = {
      acquisitionGeneration: seeded.generation,
      dispatchId: seeded.recovery.recoveryDispatchId,
      importId: seeded.importId,
      operation: "settle_recipe_recovery_unknown" as const,
    };
    const [firstSettlement, duplicateSettlement] = await Promise.all([
      postOperation(app, settleRequest),
      postOperation(app, settleRequest),
    ]);
    expect(firstSettlement.status).toBe(200);
    expect(duplicateSettlement.status).toBe(200);
    await expect(duplicateSettlement.json()).resolves.toEqual(
      await firstSettlement.json()
    );

    const prepareRequest = {
      acquisitionGeneration: seeded.generation,
      dispatchId: seeded.recovery.recoveryDispatchId,
      importId: seeded.importId,
      operation: "prepare_recipe_eighth_recovery" as const,
    };
    const [first, duplicate] = await Promise.all([
      postOperation(app, prepareRequest),
      postOperation(app, prepareRequest),
    ]);
    expect(first.status).toBe(200);
    expect(duplicate.status).toBe(200);
    const firstBody = await first.json();
    await expect(duplicate.json()).resolves.toEqual(firstBody);
    expect(firstBody).toMatchObject({
      acquisitionGeneration: seeded.generation,
      dispatchId: seeded.recovery.recoveryDispatchId,
      importId: seeded.importId,
      outcome: "recipe_eighth_recovery_prepared",
      recoveryDispatchId: `${seeded.dispatchId}:recovery:8`,
      runtimeStage: "pilot-gaia-118",
    });
    expect(started).toHaveLength(2);
    expect(started[0]).toEqual(started[1]);
    expect(started[0]).toMatchObject({
      originalDispatchId: seeded.recovery.recoveryDispatchId,
      recoveryDispatchId: `${seeded.dispatchId}:recovery:8`,
      recoveryIdentity: "recovery:8",
      recoveryOrdinal: 8,
    });

    const [resumedFirst, resumedDuplicate] = await Promise.all([
      postResume(
        app,
        seeded,
        "test-import-token",
        seeded.recovery.recoveryDispatchId
      ),
      postResume(
        app,
        seeded,
        "test-import-token",
        seeded.recovery.recoveryDispatchId
      ),
    ]);
    expect(resumedFirst.status).toBe(200);
    expect(resumedDuplicate.status).toBe(200);
    const resumedBody = await resumedFirst.json();
    await expect(resumedDuplicate.json()).resolves.toEqual(resumedBody);
    expect(resumedBody).toMatchObject({
      outcome: "recipe_recovery_resumed",
      recoveryDispatchId: `${seeded.dispatchId}:recovery:8`,
      runtimeStage: "pilot-gaia-118",
    });
    expect(resumed).toHaveLength(2);
    expect(resumed[0]).toEqual(resumed[1]);
    expect(resumed[0]).toMatchObject({
      recoveryIdentity: "recovery:8",
      recoveryOrdinal: 8,
    });

    const [recovery] = resumed;
    if (recovery === undefined) {
      throw new Error("expected the immutable eighth recovery");
    }
    const budget = makeD1PilotProviderBudgetRepository(
      testEnv.MealPlannerDatabase,
      "pilot-gaia-118"
    );
    const reservation = {
      dispatchId: recovery.recoveryDispatchId,
      maximumCostMicroUsd: 100_000,
      providerStageId: decodeStageId("recipe-extraction"),
      runId: decodeRunId(`gaia-118:recipe-recovery:${seeded.importId}`),
      timestamp: decodeBudgetTimestamp("2026-07-30T00:24:00.000Z"),
    };
    const conservativeSettlement = {
      ...reservation,
      conservativeChargeMicroUsd: 100_000,
      replay: {
        evidenceFingerprint: recovery.evidenceFingerprint,
        generation: recovery.acquisitionGeneration,
        importId: recovery.importId,
        valueJson: JSON.stringify("schema-valid-decoded-recipe"),
        valueSha256: "f".repeat(64),
      },
    };
    await Effect.runPromise(budget.reserve(reservation));
    await Effect.runPromise(budget.beginInvocation(reservation));
    await expect(
      Effect.runPromise(budget.settleConservative(conservativeSettlement))
    ).resolves.toMatchObject({ state: "settled_conservative" });
    await expect(
      Effect.runPromise(budget.settleConservative(conservativeSettlement))
    ).resolves.toMatchObject({ state: "settled_conservative" });

    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT state, settled_micro_usd, reserved_micro_usd,
                invoking_dispatch_id, poison_dispatch_id
           FROM pilot_provider_stage_budget
          WHERE runtime_stage = 'pilot-gaia-118'`
      ).first()
    ).resolves.toEqual({
      invoking_dispatch_id: null,
      poison_dispatch_id: null,
      reserved_micro_usd: 0,
      settled_micro_usd: 900_000,
      state: "open",
    });
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT COUNT(*) AS count
           FROM pilot_provider_recipe_replay_values
          WHERE runtime_stage = 'pilot-gaia-118'
            AND dispatch_id = ?`
      )
        .bind(recovery.recoveryDispatchId)
        .first()
    ).resolves.toEqual({ count: 1 });
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT COUNT(*) AS count
           FROM pilot_provider_recipe_eighth_recoveries
          WHERE runtime_stage = 'pilot-gaia-118' AND import_id = ?`
      )
        .bind(seeded.importId)
        .first()
    ).resolves.toEqual({ count: 1 });
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `UPDATE pilot_provider_recipe_eighth_recoveries
            SET created_at = '2026-07-30T00:25:00.000Z'
          WHERE runtime_stage = 'pilot-gaia-118' AND import_id = ?`
      )
        .bind(seeded.importId)
        .run()
    ).rejects.toThrow("eighth recipe recovery is immutable");
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `DELETE FROM pilot_provider_recipe_eighth_recoveries
          WHERE runtime_stage = 'pilot-gaia-118' AND import_id = ?`
      )
        .bind(seeded.importId)
        .run()
    ).rejects.toThrow("eighth recipe recovery is immutable");
  });

  it("settles the exact poisoned seventh recovery once under concurrent replay", async () => {
    const seeded = await seedUnknownSeventhRecovery("000000000232");
    const app = await makeApp([]);
    const request = {
      acquisitionGeneration: seeded.generation,
      dispatchId: seeded.recovery.recoveryDispatchId,
      importId: seeded.importId,
      operation: "settle_recipe_recovery_unknown" as const,
    };

    const responses = await Promise.all([
      postOperation(app, request),
      postOperation(app, request),
      postOperation(app, request),
    ]);

    expect(responses.map(({ status }) => status)).toEqual([200, 200, 200]);
    const expected = {
      acquisitionGeneration: seeded.generation,
      conservativeChargeMicroUsd: 100_000,
      dispatchId: seeded.recovery.recoveryDispatchId,
      importId: seeded.importId,
      outcome: "recipe_recovery_unknown_cost_settled",
      runtimeStage: "pilot-gaia-118",
    };
    await expect(
      Promise.all(responses.map((response) => response.json()))
    ).resolves.toEqual([expected, expected, expected]);
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT state, settled_micro_usd, reserved_micro_usd,
                invoking_dispatch_id, poison_dispatch_id
           FROM pilot_provider_stage_budget
          WHERE runtime_stage = 'pilot-gaia-118'`
      ).first()
    ).resolves.toEqual({
      invoking_dispatch_id: null,
      poison_dispatch_id: null,
      reserved_micro_usd: 0,
      settled_micro_usd: 800_000,
      state: "open",
    });
  });

  it("settles the exact poisoned eighth recovery once under concurrent replay", async () => {
    const seeded = await seedUnknownEighthRecovery("000000000240");
    const app = await makeApp([]);
    const request = {
      acquisitionGeneration: seeded.generation,
      dispatchId: seeded.recovery.recoveryDispatchId,
      importId: seeded.importId,
      operation: "settle_recipe_recovery_unknown" as const,
    };

    const responses = await Promise.all([
      postOperation(app, request),
      postOperation(app, request),
      postOperation(app, request),
    ]);

    expect(responses.map(({ status }) => status)).toEqual([200, 200, 200]);
    const expected = {
      acquisitionGeneration: seeded.generation,
      conservativeChargeMicroUsd: 100_000,
      dispatchId: seeded.recovery.recoveryDispatchId,
      importId: seeded.importId,
      outcome: "recipe_recovery_unknown_cost_settled",
      runtimeStage: "pilot-gaia-118",
    };
    await expect(
      Promise.all(responses.map((response) => response.json()))
    ).resolves.toEqual([expected, expected, expected]);
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT state, settled_micro_usd, reserved_micro_usd,
                invoking_dispatch_id, poison_dispatch_id
           FROM pilot_provider_stage_budget
          WHERE runtime_stage = 'pilot-gaia-118'`
      ).first()
    ).resolves.toEqual({
      invoking_dispatch_id: null,
      poison_dispatch_id: null,
      reserved_micro_usd: 0,
      settled_micro_usd: 900_000,
      state: "open",
    });
  });

  it("settles the exact poisoned sixth recovery once under concurrent replay", async () => {
    const seeded = await seedUnknownSixthRecovery("000000000221");
    const app = await makeApp([]);
    const request = {
      acquisitionGeneration: seeded.generation,
      dispatchId: seeded.recovery.recoveryDispatchId,
      importId: seeded.importId,
      operation: "settle_recipe_recovery_unknown" as const,
    };

    const responses = await Promise.all([
      postOperation(app, request),
      postOperation(app, request),
      postOperation(app, request),
    ]);

    expect(responses.map(({ status }) => status)).toEqual([200, 200, 200]);
    const expected = {
      acquisitionGeneration: seeded.generation,
      conservativeChargeMicroUsd: 100_000,
      dispatchId: seeded.recovery.recoveryDispatchId,
      importId: seeded.importId,
      outcome: "recipe_recovery_unknown_cost_settled",
      runtimeStage: "pilot-gaia-118",
    };
    await expect(
      Promise.all(responses.map((response) => response.json()))
    ).resolves.toEqual([expected, expected, expected]);
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT state, settled_micro_usd, reserved_micro_usd,
                invoking_dispatch_id, poison_dispatch_id
           FROM pilot_provider_stage_budget
          WHERE runtime_stage = 'pilot-gaia-118'`
      ).first()
    ).resolves.toEqual({
      invoking_dispatch_id: null,
      poison_dispatch_id: null,
      reserved_micro_usd: 0,
      settled_micro_usd: 700_000,
      state: "open",
    });
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT COUNT(*) AS count
           FROM pilot_provider_budget_reconciliations
          WHERE runtime_stage = 'pilot-gaia-118' AND dispatch_id = ?`
      )
        .bind(seeded.recovery.recoveryDispatchId)
        .first()
    ).resolves.toEqual({ count: 1 });
  });

  it("rejects sixth settlement without exact authority, ancestry and stage ownership", async () => {
    const seeded = await seedUnknownSixthRecovery("000000000222");
    const app = await makeApp([]);
    const request = {
      acquisitionGeneration: seeded.generation,
      dispatchId: seeded.recovery.recoveryDispatchId,
      importId: seeded.importId,
      operation: "settle_recipe_recovery_unknown" as const,
    };
    const ledgerBefore = await testEnv.MealPlannerDatabase.prepare(
      `SELECT state, settled_micro_usd, reserved_micro_usd,
              invoking_dispatch_id, poison_dispatch_id
         FROM pilot_provider_stage_budget
        WHERE runtime_stage = 'pilot-gaia-118'`
    ).first();

    const [unauthenticated, wrongImport, wrongGeneration, wrongDispatch] =
      await Promise.all([
        postOperation(app, request, "wrong-token"),
        postOperation(app, {
          ...request,
          importId: decodeImportId("00000000-0000-4000-8000-000000000223"),
        }),
        postOperation(app, {
          ...request,
          acquisitionGeneration: decodeGeneration(2),
        }),
        postOperation(app, {
          ...request,
          dispatchId: seeded.dispatchId,
        }),
      ]);
    const wrongStage = await postOperation(
      await makeApp([], [], "production"),
      request
    );

    expect([
      unauthenticated.status,
      wrongImport.status,
      wrongGeneration.status,
      wrongDispatch.status,
      wrongStage.status,
    ]).toEqual([401, 409, 409, 409, 409]);
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT state, settled_micro_usd, reserved_micro_usd,
                invoking_dispatch_id, poison_dispatch_id
           FROM pilot_provider_stage_budget
          WHERE runtime_stage = 'pilot-gaia-118'`
      ).first()
    ).resolves.toEqual(ledgerBefore);
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT COUNT(*) AS count
           FROM pilot_provider_budget_reconciliations
          WHERE runtime_stage = 'pilot-gaia-118' AND dispatch_id = ?`
      )
        .bind(seeded.recovery.recoveryDispatchId)
        .first()
    ).resolves.toEqual({ count: 0 });
  });

  it("preserves sixth poison when settlement guards reject retained state", async () => {
    const resetStage = () =>
      testEnv.MealPlannerDatabase.prepare(
        `UPDATE pilot_provider_stage_budget
            SET settled_micro_usd = 0,
                reserved_micro_usd = 0,
                state = 'open',
                invoking_dispatch_id = NULL,
                poison_dispatch_id = NULL,
                updated_at = '2026-07-30T00:00:00.000Z'
          WHERE runtime_stage = 'pilot-gaia-118'`
      ).run();
    const expectRejected = async (
      suffix: string,
      mutate: (
        seeded: Awaited<ReturnType<typeof seedUnknownSixthRecovery>>
      ) => Promise<unknown>
    ) => {
      const seeded = await seedUnknownSixthRecovery(suffix);
      await mutate(seeded);
      const ledgerBefore = await testEnv.MealPlannerDatabase.prepare(
        `SELECT state, settled_micro_usd, reserved_micro_usd,
                invoking_dispatch_id, poison_dispatch_id
           FROM pilot_provider_stage_budget
          WHERE runtime_stage = 'pilot-gaia-118'`
      ).first();
      const auditsBefore = await testEnv.MealPlannerDatabase.prepare(
        `SELECT COUNT(*) AS count
           FROM pilot_provider_budget_reconciliations
          WHERE runtime_stage = 'pilot-gaia-118' AND dispatch_id = ?`
      )
        .bind(seeded.recovery.recoveryDispatchId)
        .first();

      const response = await postOperation(await makeApp([]), {
        acquisitionGeneration: seeded.generation,
        dispatchId: seeded.recovery.recoveryDispatchId,
        importId: seeded.importId,
        operation: "settle_recipe_recovery_unknown",
      });

      expect(response.status).toBe(409);
      await expect(
        testEnv.MealPlannerDatabase.prepare(
          `SELECT state, settled_micro_usd, reserved_micro_usd,
                  invoking_dispatch_id, poison_dispatch_id
             FROM pilot_provider_stage_budget
            WHERE runtime_stage = 'pilot-gaia-118'`
        ).first()
      ).resolves.toEqual(ledgerBefore);
      await expect(
        testEnv.MealPlannerDatabase.prepare(
          `SELECT COUNT(*) AS count
             FROM pilot_provider_budget_reconciliations
            WHERE runtime_stage = 'pilot-gaia-118' AND dispatch_id = ?`
        )
          .bind(seeded.recovery.recoveryDispatchId)
          .first()
      ).resolves.toEqual(auditsBefore);
      await resetStage();
    };

    await expectRejected("000000000224", ({ recovery }) =>
      testEnv.MealPlannerDatabase.prepare(
        `UPDATE pilot_provider_stage_budget
            SET state = 'open', reserved_micro_usd = 0,
                poison_dispatch_id = NULL
          WHERE runtime_stage = 'pilot-gaia-118'
            AND poison_dispatch_id = ?`
      )
        .bind(recovery.recoveryDispatchId)
        .run()
    );
    await expectRejected("000000000225", ({ recovery }) =>
      testEnv.MealPlannerDatabase.prepare(
        `UPDATE pilot_provider_stage_budget
            SET state = 'invoking',
                invoking_dispatch_id = poison_dispatch_id,
                poison_dispatch_id = NULL
          WHERE runtime_stage = 'pilot-gaia-118'
            AND poison_dispatch_id = ?`
      )
        .bind(recovery.recoveryDispatchId)
        .run()
    );
    await expectRejected("000000000226", ({ recovery }) =>
      testEnv.MealPlannerDatabase.prepare(
        `INSERT INTO pilot_provider_budget_reconciliations (
           runtime_stage, dispatch_id, conservative_charge_micro_usd,
           actual_cost_was_unknown, authority, created_at
         ) VALUES (
           'pilot-gaia-118', ?, 100000, 1, 'authenticated_operator',
           '2026-07-30T00:18:30.000Z'
         )`
      )
        .bind(recovery.recoveryDispatchId)
        .run()
    );
    await expectRejected("000000000227", async (seeded) => {
      await testEnv.MealPlannerDatabase.prepare(
        `UPDATE pilot_provider_stage_budget
            SET state = 'open', poison_dispatch_id = NULL
          WHERE runtime_stage = 'pilot-gaia-118'`
      ).run();
      const reservation = {
        dispatchId: decodeDispatchId(`sibling:${seeded.importId}`),
        maximumCostMicroUsd: 100_000,
        providerStageId: decodeStageId("recipe-extraction"),
        runId: decodeRunId(`gaia-118:recipe-recovery:${seeded.importId}`),
        timestamp: decodeBudgetTimestamp("2026-07-30T00:18:30.000Z"),
      };
      const budget = makeD1PilotProviderBudgetRepository(
        testEnv.MealPlannerDatabase,
        "pilot-gaia-118"
      );
      await Effect.runPromise(budget.reserve(reservation));
      await Effect.runPromise(budget.beginInvocation(reservation));
      await Effect.runPromise(budget.settleUnknown(reservation));
      await testEnv.MealPlannerDatabase.prepare(
        `UPDATE pilot_provider_stage_budget
            SET state = 'poisoned', reserved_micro_usd = 100000,
                invoking_dispatch_id = NULL, poison_dispatch_id = ?
          WHERE runtime_stage = 'pilot-gaia-118'`
      )
        .bind(seeded.recovery.recoveryDispatchId)
        .run();
    });
    await expectRejected("000000000228", ({ recovery, ...seeded }) =>
      testEnv.MealPlannerDatabase.batch([
        testEnv.MealPlannerDatabase.prepare(
          `INSERT INTO pilot_provider_budget_conservative_settlements (
             actual_cost_was_unknown, authority,
             conservative_charge_micro_usd, created_at, dispatch_id,
             runtime_stage
           ) VALUES (
             1, 'schema_valid_provider_response', 100000,
             '2026-07-30T00:18:30.000Z', ?, 'pilot-gaia-118'
           )`
        ).bind(recovery.recoveryDispatchId),
        testEnv.MealPlannerDatabase.prepare(
          `INSERT INTO pilot_provider_recipe_replay_values (
             created_at, dispatch_id, evidence_fingerprint, expires_at,
             generation, import_id, runtime_stage, value_json, value_sha256
           ) VALUES (
             '2026-07-30T00:18:30.000Z', ?, ?,
             '2026-08-06T00:18:30.000Z', ?, ?, 'pilot-gaia-118',
             '{"opaque":"replay"}', ?
           )`
        ).bind(
          recovery.recoveryDispatchId,
          seeded.evidenceFingerprint,
          seeded.generation,
          seeded.importId,
          "f".repeat(64)
        ),
      ])
    );
  });

  it("rejects sixth recovery when stage, ancestry, evidence, replay or budget authority drifts", async () => {
    const seeded = await seedUnknownFifthRecovery("000000000220");
    const service = makeD1ProviderTerminalSettlementService({
      database: testEnv.MealPlannerDatabase,
      now: () => decodeImportTimestamp("2026-07-30T00:16:00.000Z"),
      runtimeStage: "pilot-gaia-118",
    });
    await Effect.runPromise(
      service.settle({
        acquisitionGeneration: seeded.generation,
        dispatchId: seeded.recovery.recoveryDispatchId,
        importId: seeded.importId,
        operation: "settle_recipe_recovery_unknown",
      })
    );
    const repository = makeD1RecipeRecoveryRepository(
      testEnv.MealPlannerDatabase,
      "pilot-gaia-118"
    );
    const command = {
      acquisitionGeneration: seeded.generation,
      createdAt: decodeImportTimestamp("2026-07-30T00:17:00.000Z"),
      fifthRecoveryDispatchId: seeded.recovery.recoveryDispatchId,
      importId: seeded.importId,
    };
    const expectRejected = async (
      effect: ReturnType<typeof repository.prepareSixth>
    ) => {
      const exit = await Effect.runPromiseExit(effect);
      expect(exit._tag).toBe("Failure");
      await expect(
        testEnv.MealPlannerDatabase.prepare(
          `SELECT COUNT(*) AS count
             FROM pilot_provider_recipe_sixth_recoveries
            WHERE runtime_stage = 'pilot-gaia-118' AND import_id = ?`
        )
          .bind(seeded.importId)
          .first()
      ).resolves.toEqual({ count: 0 });
    };

    await expectRejected(
      makeD1RecipeRecoveryRepository(
        testEnv.MealPlannerDatabase,
        "wrong-stage"
      ).prepareSixth(command)
    );
    await expectRejected(
      repository.prepareSixth({
        ...command,
        fifthRecoveryDispatchId: seeded.recovery.originalDispatchId,
      })
    );

    await testEnv.MealPlannerDatabase.prepare(
      `UPDATE import_visual_evidence
          SET manifest_sha256 = ?
        WHERE import_id = ? AND acquisition_generation = ?`
    )
      .bind("f".repeat(64), seeded.importId, seeded.generation)
      .run();
    await expectRejected(repository.prepareSixth(command));
    await testEnv.MealPlannerDatabase.prepare(
      `UPDATE import_visual_evidence
          SET manifest_sha256 = ?
        WHERE import_id = ? AND acquisition_generation = ?`
    )
      .bind(seeded.visualManifestSha256, seeded.importId, seeded.generation)
      .run();

    await testEnv.MealPlannerDatabase.prepare(
      `INSERT INTO pilot_provider_budget_conservative_settlements (
         actual_cost_was_unknown, authority, conservative_charge_micro_usd,
         created_at, dispatch_id, runtime_stage
       ) VALUES (
         1, 'schema_valid_provider_response', 100000,
         '2026-07-30T00:16:00.000Z', ?, 'pilot-gaia-118'
       )`
    )
      .bind(seeded.recovery.recoveryDispatchId)
      .run();
    await testEnv.MealPlannerDatabase.prepare(
      `INSERT INTO pilot_provider_recipe_replay_values (
         created_at, dispatch_id, evidence_fingerprint, expires_at, generation,
         import_id, runtime_stage, value_json, value_sha256
       ) VALUES (
         '2026-07-30T00:16:00.000Z', ?, ?, '2026-08-06T00:16:00.000Z',
         ?, ?, 'pilot-gaia-118', '{"title":"replay"}', ?
       )`
    )
      .bind(
        seeded.recovery.recoveryDispatchId,
        seeded.evidenceFingerprint,
        seeded.generation,
        seeded.importId,
        "a".repeat(64)
      )
      .run();
    await expectRejected(repository.prepareSixth(command));
    await testEnv.MealPlannerDatabase.prepare(
      `DELETE FROM pilot_provider_recipe_replay_values
        WHERE runtime_stage = 'pilot-gaia-118' AND dispatch_id = ?`
    )
      .bind(seeded.recovery.recoveryDispatchId)
      .run();

    await testEnv.MealPlannerDatabase.prepare(
      `UPDATE pilot_provider_stage_budget
          SET reserved_micro_usd = 1
        WHERE runtime_stage = 'pilot-gaia-118'`
    ).run();
    await expectRejected(repository.prepareSixth(command));
    await testEnv.MealPlannerDatabase.prepare(
      `UPDATE pilot_provider_stage_budget
          SET reserved_micro_usd = 0,
              state = 'poisoned',
              poison_dispatch_id = ?
        WHERE runtime_stage = 'pilot-gaia-118'`
    )
      .bind(seeded.recovery.recoveryDispatchId)
      .run();
    await expectRejected(repository.prepareSixth(command));
    await testEnv.MealPlannerDatabase.prepare(
      `UPDATE pilot_provider_stage_budget
          SET state = 'invoking',
              invoking_dispatch_id = ?,
              poison_dispatch_id = NULL
        WHERE runtime_stage = 'pilot-gaia-118'`
    )
      .bind(seeded.recovery.recoveryDispatchId)
      .run();
    await expectRejected(repository.prepareSixth(command));
  });
});

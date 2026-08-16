import { applyD1Migrations, env } from "cloudflare:test";
import type { AnyD1Database } from "drizzle-orm/d1";
import { Effect, Layer, Option, Redacted, Schema } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  PilotBudgetDispatchId,
  PilotBudgetProviderStageId,
  PilotBudgetRunId,
  PilotBudgetTimestamp,
} from "../pilots/pilot-provider-budget.js";
import { makeD1PilotProviderBudgetRepository } from "../pilots/pilot-provider-budget.repository.d1.js";
import { AcquisitionGeneration, Sha256Hex } from "./import-media.model.js";
import { ImportTraceContext } from "./import-observability.js";
import type { ImportTraceContext as ImportTraceContextType } from "./import-observability.js";
import {
  ProviderTerminalSettlementService,
  makeD1ProviderTerminalSettlementService,
} from "./import-provider-terminal-settlement.js";
import { ProviderTerminalSettlementRoutes } from "./import-provider-terminal-settlement.routes.js";
import { makeD1ProviderTerminalCheckpointRepository } from "./import-provider-terminal.js";
import { makeD1RecipeDraftRepository } from "./import-recipe-draft.repository.d1.js";
import {
  makeD1RecipeRecoveryRepository,
  makeRecipeRecoveryWorkflowStarter,
  recipeRecoveryExtractionFingerprint,
} from "./import-recipe-recovery.js";
import type {
  RecipeRecoveryAttempt,
  RecipeRecoveryFailure,
} from "./import-recipe-recovery.js";
import { deriveLegacyImportCorrelationId } from "./import-workflow-input.js";
import { ImportAuthorizer, makeImportAuthorizer } from "./import.auth.js";
import { ImportId, ImportTimestamp } from "./import.contracts.js";

const runtimeStage = "pilot-gaia-118";

const testEnv = env as unknown as {
  readonly MealPlannerDatabase: AnyD1Database;
  readonly TEST_MIGRATIONS: {
    readonly name: string;
    readonly queries: string[];
  }[];
};

const decodeImportId = Schema.decodeUnknownSync(ImportId);
const decodeGeneration = Schema.decodeUnknownSync(AcquisitionGeneration);
const decodeSha256 = Schema.decodeUnknownSync(Sha256Hex);
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
            updated_at = '2026-08-09T00:00:00.000Z'
      WHERE runtime_stage = ?`
  )
    .bind(runtimeStage)
    .run();
});

interface RootSeed {
  readonly dispatchId: typeof PilotBudgetDispatchId.Type;
  readonly evidenceFingerprint: string;
  readonly evidenceReferencesJson: string;
  readonly extractionFingerprint: string;
  readonly generation: typeof AcquisitionGeneration.Type;
  readonly importId: typeof ImportId.Type;
  readonly trace: ImportTraceContextType;
}

const seedRoot = async (
  suffix: string,
  options: {
    readonly reconcile?: boolean;
    readonly terminalCheckpoint?: boolean;
  } = {}
): Promise<RootSeed> => {
  const database = testEnv.MealPlannerDatabase;
  const importId = decodeImportId(`00000000-0000-4000-8000-${suffix}`);
  const trace = Schema.decodeUnknownSync(ImportTraceContext)({
    correlationId: `50000000-0000-4000-8000-${suffix}`,
  });
  const generation = decodeGeneration(1);
  const now = "2026-08-09T00:00:00.000Z";
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

  await database.batch([
    database
      .prepare(
        `INSERT INTO recipe_imports (
           acquisition_generation, canonical_source_id,
           compatibility_fingerprint, correlation_id, created_at, evidence_references_json,
           id, recovery_action, source_kind, status, status_code, updated_at
         ) VALUES (
           ?, ?, ?, ?, ?, ?, ?, NULL, 'tiktok', 'transcribed', NULL, ?
         )`
      )
      .bind(
        generation,
        `s09-recovery-${suffix}`,
        "f".repeat(64),
        trace.correlationId,
        now,
        evidenceReferencesJson,
        importId,
        now
      ),
    database
      .prepare(
        `INSERT INTO import_transcriptions (
           import_id, acquisition_generation, dispatch_id,
           source_media_sha256, state, transcript_key, transcript_sha256,
           provider, model, detected_language, usage_audio_milliseconds,
           usage_input_bytes, estimated_cost_micro_usd, cost_currency,
           cost_certainty, segments_count, failure_code, created_at,
           updated_at, completed_at
         ) VALUES (
           ?, ?, ?, ?, 'transcribed', ?, ?, 'cloudflare-workers-ai',
           'speech-model', 'en', 1000, 100, 1, 'USD', 'known', 1, NULL,
           ?, ?, ?
         )`
      )
      .bind(
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
    database
      .prepare(
        `INSERT INTO import_visual_evidence (
           import_id, acquisition_generation, dispatch_id,
           source_media_sha256, state, outcome, manifest_key, manifest_sha256,
           provider, model, input_frames, input_bytes, model_calls,
           estimated_cost_micro_usd, cost_currency, cost_certainty,
           observations_count, failure_code, created_at, updated_at,
           completed_at
         ) VALUES (
           ?, ?, ?, ?, 'completed', 'found', ?, ?,
           'cloudflare-workers-ai', 'visual-model', 1, 100, 1, 1, 'USD',
           'known', 1, NULL, ?, ?, ?
         )`
      )
      .bind(
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
    database
      .prepare(
        `INSERT INTO import_recipe_extractions (
           extraction_fingerprint, import_id, acquisition_generation,
           evidence_fingerprint, extractor_provider, extractor_model,
           extractor_version, state, created_at, updated_at
         ) VALUES (
           ?, ?, ?, ?, 'cloudflare-workers-ai', 'recipe-model',
           'installed-v1', 'dispatching', ?, ?
         )`
      )
      .bind(
        extractionFingerprint,
        importId,
        generation,
        evidenceFingerprint,
        now,
        now
      ),
  ]);

  const budget = makeD1PilotProviderBudgetRepository(database, runtimeStage);
  const rootRunId = decodeRunId(`gaia-118:${importId}`);
  const settleSibling = async (
    siblingDispatchId: typeof PilotBudgetDispatchId.Type,
    providerStageId: typeof PilotBudgetProviderStageId.Type
  ) => {
    const reservation = {
      dispatchId: siblingDispatchId,
      maximumCostMicroUsd: 1,
      providerStageId,
      runId: rootRunId,
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

  const reservation = {
    dispatchId,
    maximumCostMicroUsd: 100_000,
    providerStageId: decodeStageId("recipe-extraction"),
    runId: rootRunId,
    timestamp: decodeBudgetTimestamp(now),
  };
  await Effect.runPromise(budget.reserve(reservation));
  await Effect.runPromise(budget.beginInvocation(reservation));
  await Effect.runPromise(budget.settleUnknown(reservation));

  if (options.terminalCheckpoint !== false) {
    await Effect.runPromise(
      makeD1ProviderTerminalCheckpointRepository(database).persist({
        acquisitionGeneration: generation,
        completedAt: decodeImportTimestamp(now),
        failureCode: "outcome_unknown",
        importId,
        providerStage: "recipe",
      })
    );
  }
  if (options.reconcile !== false && options.terminalCheckpoint !== false) {
    await Effect.runPromise(
      makeD1ProviderTerminalSettlementService({
        database,
        now: () => decodeImportTimestamp("2026-08-09T00:01:00.000Z"),
        runtimeStage,
      }).settle({
        acquisitionGeneration: generation,
        dispatchId,
        importId,
        operation: "settle_recipe_unknown",
      })
    );
  }

  return {
    dispatchId,
    evidenceFingerprint,
    evidenceReferencesJson,
    extractionFingerprint,
    generation,
    importId,
    trace,
  };
};

const prepareAttempt = (
  seeded: RootSeed,
  predecessorDispatchId: typeof PilotBudgetDispatchId.Type,
  minute: number
) =>
  Effect.runPromise(
    makeD1RecipeRecoveryRepository(
      testEnv.MealPlannerDatabase,
      runtimeStage
    ).prepareNextAttempt({
      acquisitionGeneration: seeded.generation,
      createdAt: decodeImportTimestamp(
        `2026-08-09T00:${String(minute).padStart(2, "0")}:00.000Z`
      ),
      importId: seeded.importId,
      predecessorDispatchId,
    })
  );

const makeAttemptOutcomeUnknown = async (
  seeded: RootSeed,
  attempt: RecipeRecoveryAttempt,
  minute: number
) => {
  const timestamp = `2026-08-09T00:${String(minute).padStart(2, "0")}:00.000Z`;
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
      attempt.currentExtractionFingerprint,
      seeded.importId,
      seeded.generation,
      seeded.evidenceFingerprint,
      timestamp,
      timestamp
    )
    .run();

  const reservation = {
    dispatchId: attempt.currentDispatchId,
    maximumCostMicroUsd: 100_000,
    providerStageId: decodeStageId("recipe-extraction"),
    runId: decodeRunId(`gaia-118:recipe-recovery:${seeded.importId}`),
    timestamp: decodeBudgetTimestamp(timestamp),
  };
  const budget = makeD1PilotProviderBudgetRepository(
    testEnv.MealPlannerDatabase,
    runtimeStage
  );
  await Effect.runPromise(budget.reserve(reservation));
  await Effect.runPromise(budget.beginInvocation(reservation));
  await Effect.runPromise(budget.settleUnknown(reservation));
  await Effect.runPromise(
    makeD1RecipeDraftRepository(testEnv.MealPlannerDatabase).fail({
      completedAt: decodeImportTimestamp(timestamp),
      extractionFingerprint: attempt.currentExtractionFingerprint,
      failureCode: "provider_error",
    })
  );
};

const reconcileAttempt = (
  seeded: RootSeed,
  attempt: RecipeRecoveryAttempt,
  minute: number
) =>
  Effect.runPromise(
    makeD1ProviderTerminalSettlementService({
      database: testEnv.MealPlannerDatabase,
      now: () =>
        decodeImportTimestamp(
          `2026-08-09T00:${String(minute).padStart(2, "0")}:30.000Z`
        ),
      runtimeStage,
    }).settle({
      acquisitionGeneration: seeded.generation,
      dispatchId: attempt.currentDispatchId,
      importId: seeded.importId,
      operation: "settle_recipe_recovery_unknown",
    })
  );

const readFailure = <A>(effect: Effect.Effect<A, RecipeRecoveryFailure>) =>
  Effect.runPromise(Effect.flip(effect));

const corruptSourceIdentity = async (
  importId: typeof ImportId.Type,
  sourceMediaSha256: typeof Sha256Hex.Type
) => {
  await testEnv.MealPlannerDatabase.prepare(
    "DROP TRIGGER IF EXISTS import_transcriptions_identity_immutable"
  ).run();
  await testEnv.MealPlannerDatabase.prepare(
    "DROP TRIGGER IF EXISTS import_visual_evidence_identity_immutable"
  ).run();
  try {
    await testEnv.MealPlannerDatabase.prepare(
      `UPDATE import_transcriptions
          SET source_media_sha256 = ?
        WHERE import_id = ?`
    )
      .bind(sourceMediaSha256, importId)
      .run();
    await testEnv.MealPlannerDatabase.prepare(
      `UPDATE import_visual_evidence
          SET source_media_sha256 = ?
        WHERE import_id = ?`
    )
      .bind(sourceMediaSha256, importId)
      .run();
  } finally {
    await testEnv.MealPlannerDatabase.prepare(
      `CREATE TRIGGER IF NOT EXISTS import_transcriptions_identity_immutable
       BEFORE UPDATE ON import_transcriptions
       WHEN NEW.import_id <> OLD.import_id
         OR NEW.acquisition_generation <> OLD.acquisition_generation
         OR NEW.dispatch_id <> OLD.dispatch_id
         OR NEW.source_media_sha256 <> OLD.source_media_sha256
       BEGIN
         SELECT RAISE(ABORT, 'import transcription identity is immutable');
       END`
    ).run();
    await testEnv.MealPlannerDatabase.prepare(
      `CREATE TRIGGER IF NOT EXISTS import_visual_evidence_identity_immutable
       BEFORE UPDATE ON import_visual_evidence
       WHEN NEW.import_id <> OLD.import_id
         OR NEW.acquisition_generation <> OLD.acquisition_generation
         OR NEW.dispatch_id <> OLD.dispatch_id
         OR NEW.source_media_sha256 <> OLD.source_media_sha256
       BEGIN
         SELECT RAISE(ABORT, 'visual evidence identity is immutable');
       END`
    ).run();
  }
};

const makeApp = async (started: unknown[]) => {
  const authorizer = await Effect.runPromise(
    makeImportAuthorizer(Redacted.make("test-import-token"))
  );
  const service = makeD1ProviderTerminalSettlementService({
    database: testEnv.MealPlannerDatabase,
    now: () => decodeImportTimestamp("2026-08-09T00:02:00.000Z"),
    recipeRecoveryStarter: makeRecipeRecoveryWorkflowStarter({
      createBatch: (batch) =>
        Effect.sync(() => {
          started.push(batch[0]?.params);
          return [
            {
              restart: () => Effect.void,
              sendEvent: () => Effect.void,
              status: () => Effect.succeed({ status: "running" }),
            },
          ];
        }),
      get: () => Effect.die("new recovery must not reconcile"),
    }),
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
  seeded: RootSeed,
  operation: string,
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
          operation,
        }),
        headers: {
          authorization: "Bearer test-import-token",
          "content-type": "application/json",
        },
        method: "POST",
      }
    )
  );

describe("recipe recovery attempt ledger", () => {
  it("admits one row under concurrency and replays the same command", async () => {
    const seeded = await seedRoot("000000000301");
    const repository = makeD1RecipeRecoveryRepository(
      testEnv.MealPlannerDatabase,
      runtimeStage
    );
    const command = {
      acquisitionGeneration: seeded.generation,
      createdAt: decodeImportTimestamp("2026-08-09T00:02:00.000Z"),
      importId: seeded.importId,
      predecessorDispatchId: seeded.dispatchId,
    };

    const attempts = await Promise.all([
      Effect.runPromise(repository.prepareNextAttempt(command)),
      Effect.runPromise(repository.prepareNextAttempt(command)),
    ]);
    expect(attempts[0]).toEqual(attempts[1]);
    expect(attempts[0]).toMatchObject({
      currentDispatchId: `${seeded.dispatchId}:recovery:1`,
      ordinal: 1,
      predecessorDispatchId: seeded.dispatchId,
      rootDispatchId: seeded.dispatchId,
    });
    await expect(
      Effect.runPromise(repository.prepareNextAttempt(command))
    ).resolves.toEqual(attempts[0]);
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT count(*) AS attempt_count
           FROM pilot_provider_recipe_recovery_attempts
          WHERE import_id = ?`
      )
        .bind(seeded.importId)
        .first()
    ).resolves.toEqual({ attempt_count: 1 });
  });

  it("derives an ordered chain, reconstructs its cursor, and rejects attempt nine", async () => {
    const seeded = await seedRoot("000000000302");
    const attempts: RecipeRecoveryAttempt[] = [];
    let predecessor = seeded.dispatchId;

    for (let ordinal = 1; ordinal <= 8; ordinal += 1) {
      // eslint-disable-next-line no-await-in-loop -- Attempt N is admitted only after the immutable terminal truth for N-1 exists.
      const attempt = await prepareAttempt(seeded, predecessor, ordinal + 1);
      expect(attempt.ordinal).toBe(ordinal);
      expect(attempt.rootDispatchId).toBe(seeded.dispatchId);
      expect(attempt.predecessorDispatchId).toBe(predecessor);
      attempts.push(attempt);
      if (ordinal < 8) {
        // eslint-disable-next-line no-await-in-loop -- The next ordinal must observe this predecessor's settled-unknown state.
        await makeAttemptOutcomeUnknown(seeded, attempt, ordinal + 10);
        // eslint-disable-next-line no-await-in-loop -- Explicit reconciliation is the admission gate for the next ordinal.
        await reconcileAttempt(seeded, attempt, ordinal + 20);
        predecessor = attempt.currentDispatchId;
      }
    }

    const reconstructedRepository = makeD1RecipeRecoveryRepository(
      testEnv.MealPlannerDatabase,
      runtimeStage
    );
    const reconstructed = await Effect.runPromise(
      reconstructedRepository.readCurrent({
        acquisitionGeneration: seeded.generation,
        importId: seeded.importId,
      })
    );
    expect(Option.getOrThrow(reconstructed)).toEqual(attempts[7]);
    const historicalAttempts = await Promise.all(
      attempts.map((attempt) =>
        Effect.runPromise(
          reconstructedRepository.readAttempt({
            acquisitionGeneration: seeded.generation,
            importId: seeded.importId,
            ordinal: attempt.ordinal,
          })
        )
      )
    );
    for (const [index, historical] of historicalAttempts.entries()) {
      expect(Option.getOrThrow(historical)).toEqual(attempts[index]);
    }
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT recovery_ordinal, predecessor_dispatch_id,
                current_dispatch_id
           FROM pilot_provider_recipe_recovery_attempts
          WHERE import_id = ?
          ORDER BY recovery_ordinal`
      )
        .bind(seeded.importId)
        .all()
    ).resolves.toMatchObject({
      results: attempts.map((attempt) => ({
        current_dispatch_id: attempt.currentDispatchId,
        predecessor_dispatch_id: attempt.predecessorDispatchId,
        recovery_ordinal: attempt.ordinal,
      })),
    });

    const failure = await readFailure(
      makeD1RecipeRecoveryRepository(
        testEnv.MealPlannerDatabase,
        runtimeStage
      ).prepareNextAttempt({
        acquisitionGeneration: seeded.generation,
        createdAt: decodeImportTimestamp("2026-08-09T00:40:00.000Z"),
        importId: seeded.importId,
        predecessorDispatchId: attempts[7]?.currentDispatchId ?? predecessor,
      })
    );
    expect(failure._tag).toBe("RecipeRecovery.AttemptLimitReached");

    await expect(
      Effect.runPromise(
        makeD1PilotProviderBudgetRepository(
          testEnv.MealPlannerDatabase,
          runtimeStage
        ).reserve({
          dispatchId: decodeDispatchId(`${seeded.dispatchId}:recovery:9`),
          maximumCostMicroUsd: 100_000,
          providerStageId: decodeStageId("recipe-extraction"),
          runId: decodeRunId(`gaia-118:recipe-recovery:${seeded.importId}`),
          timestamp: decodeBudgetTimestamp("2026-08-09T00:40:00.000Z"),
        })
      )
    ).rejects.toBeDefined();
  });

  it("rejects a direct ledger gap without a partial row", async () => {
    const seeded = await seedRoot("000000000303");
    const fakePredecessorExtraction = "1".repeat(64);
    await testEnv.MealPlannerDatabase.prepare(
      `INSERT INTO import_recipe_extractions (
         extraction_fingerprint, import_id, acquisition_generation,
         evidence_fingerprint, extractor_provider, extractor_model,
         extractor_version, state, failure_code, completed_at, created_at,
         updated_at
       ) VALUES (
         ?, ?, ?, ?, 'cloudflare-workers-ai', 'recipe-model', 'installed-v1',
         'failed', 'provider_error', ?, ?, ?
       )`
    )
      .bind(
        fakePredecessorExtraction,
        seeded.importId,
        seeded.generation,
        seeded.evidenceFingerprint,
        "2026-08-09T00:02:00.000Z",
        "2026-08-09T00:02:00.000Z",
        "2026-08-09T00:02:00.000Z"
      )
      .run();

    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `INSERT INTO pilot_provider_recipe_recovery_attempts (
           runtime_stage, import_id, acquisition_generation,
           recovery_ordinal, root_dispatch_id, predecessor_dispatch_id,
           current_dispatch_id, root_extraction_fingerprint,
           predecessor_extraction_fingerprint,
           current_extraction_fingerprint, predecessor_outcome,
           terminal_checkpoint_completed_at,
           predecessor_reconciliation_created_at, evidence_fingerprint,
           source_media_sha256, transcript_sha256, visual_manifest_sha256,
           evidence_references_json, created_at
         )
         SELECT ?, parent.id, parent.acquisition_generation, 2, ?, ?, ?, ?, ?,
                ?, 'outcome_unknown', checkpoint.completed_at, audit.created_at,
                ?, transcript.source_media_sha256, transcript.transcript_sha256,
                visual.manifest_sha256,
                parent.evidence_references_json, ?
           FROM recipe_imports AS parent
           JOIN import_transcriptions AS transcript
             ON transcript.import_id = parent.id
           JOIN import_visual_evidence AS visual
             ON visual.import_id = parent.id
           JOIN import_provider_terminal_checkpoints AS checkpoint
             ON checkpoint.import_id = parent.id
            AND checkpoint.provider_stage = 'recipe'
           JOIN pilot_provider_budget_reconciliations AS audit
             ON audit.dispatch_id = ?
          WHERE parent.id = ?`
      )
        .bind(
          runtimeStage,
          seeded.dispatchId,
          `${seeded.dispatchId}:recovery:1`,
          `${seeded.dispatchId}:recovery:2`,
          seeded.extractionFingerprint,
          fakePredecessorExtraction,
          "2".repeat(64),
          seeded.evidenceFingerprint,
          "2026-08-09T00:03:00.000Z",
          seeded.dispatchId,
          seeded.importId
        )
        .run()
    ).rejects.toThrow(/attempt (?:ancestry|admission) rejected/iu);
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT count(*) AS attempt_count
           FROM pilot_provider_recipe_recovery_attempts
          WHERE import_id = ?`
      )
        .bind(seeded.importId)
        .first()
    ).resolves.toEqual({ attempt_count: 0 });
  });

  it("rejects missing roots, stale generations, unresolved outcomes, and non-retryable terminals", async () => {
    const missingImportId = decodeImportId(
      "00000000-0000-4000-8000-000000000304"
    );
    const repository = makeD1RecipeRecoveryRepository(
      testEnv.MealPlannerDatabase,
      runtimeStage
    );
    const missing = await readFailure(
      repository.prepareNextAttempt({
        acquisitionGeneration: decodeGeneration(1),
        createdAt: decodeImportTimestamp("2026-08-09T00:02:00.000Z"),
        importId: missingImportId,
        predecessorDispatchId: decodeDispatchId(
          `recipe:${missingImportId}:1:${"a".repeat(64)}`
        ),
      })
    );
    expect(missing._tag).toBe("RecipeRecovery.MissingPredecessor");

    const staleSeed = await seedRoot("000000000305");
    const stale = await readFailure(
      repository.prepareNextAttempt({
        acquisitionGeneration: decodeGeneration(2),
        createdAt: decodeImportTimestamp("2026-08-09T00:03:00.000Z"),
        importId: staleSeed.importId,
        predecessorDispatchId: staleSeed.dispatchId,
      })
    );
    expect(stale._tag).toBe("RecipeRecovery.StaleGeneration");

    await testEnv.MealPlannerDatabase.prepare(
      `UPDATE import_recipe_extractions
          SET failure_code = 'invalid_schema'
        WHERE extraction_fingerprint = ?`
    )
      .bind(staleSeed.extractionFingerprint)
      .run();
    const terminal = await readFailure(
      repository.prepareNextAttempt({
        acquisitionGeneration: staleSeed.generation,
        createdAt: decodeImportTimestamp("2026-08-09T00:04:00.000Z"),
        importId: staleSeed.importId,
        predecessorDispatchId: staleSeed.dispatchId,
      })
    );
    expect(terminal).toMatchObject({
      _tag: "RecipeRecovery.Terminal",
      reason: "non_retryable",
    });

    const unresolvedSeed = await seedRoot("000000000306", {
      terminalCheckpoint: false,
    });
    const unresolved = await readFailure(
      repository.prepareNextAttempt({
        acquisitionGeneration: unresolvedSeed.generation,
        createdAt: decodeImportTimestamp("2026-08-09T00:04:00.000Z"),
        importId: unresolvedSeed.importId,
        predecessorDispatchId: unresolvedSeed.dispatchId,
      })
    );
    expect(unresolved._tag).toBe("RecipeRecovery.OutcomeUnknown");
  });

  it("requires explicit reconciliation before authorizing recovery", async () => {
    const seeded = await seedRoot("000000000307", { reconcile: false });
    const failure = await readFailure(
      makeD1RecipeRecoveryRepository(
        testEnv.MealPlannerDatabase,
        runtimeStage
      ).prepareNextAttempt({
        acquisitionGeneration: seeded.generation,
        createdAt: decodeImportTimestamp("2026-08-09T00:02:00.000Z"),
        importId: seeded.importId,
        predecessorDispatchId: seeded.dispatchId,
      })
    );
    expect(failure._tag).toBe("RecipeRecovery.ReconciliationRequired");
  });

  it("rejects changed evidence, wrong roots, and exhausted or poisoned budget", async () => {
    const evidenceSeed = await seedRoot("000000000308");
    const first = await prepareAttempt(
      evidenceSeed,
      evidenceSeed.dispatchId,
      2
    );
    await makeAttemptOutcomeUnknown(evidenceSeed, first, 3);
    await reconcileAttempt(evidenceSeed, first, 4);
    await testEnv.MealPlannerDatabase.prepare(
      `UPDATE import_transcriptions
          SET transcript_sha256 = ?
        WHERE import_id = ?`
    )
      .bind("0".repeat(64), evidenceSeed.importId)
      .run();
    const evidenceFailure = await readFailure(
      makeD1RecipeRecoveryRepository(
        testEnv.MealPlannerDatabase,
        runtimeStage
      ).prepareNextAttempt({
        acquisitionGeneration: evidenceSeed.generation,
        createdAt: decodeImportTimestamp("2026-08-09T00:05:00.000Z"),
        importId: evidenceSeed.importId,
        predecessorDispatchId: first.currentDispatchId,
      })
    );
    expect(evidenceFailure._tag).toBe("RecipeRecovery.EvidenceMismatch");

    const sourceSeed = await seedRoot("000000000314");
    const sourceFirst = await prepareAttempt(
      sourceSeed,
      sourceSeed.dispatchId,
      5
    );
    await makeAttemptOutcomeUnknown(sourceSeed, sourceFirst, 6);
    await reconcileAttempt(sourceSeed, sourceFirst, 7);
    await corruptSourceIdentity(
      sourceSeed.importId,
      decodeSha256("f".repeat(64))
    );
    const sourceFailure = await readFailure(
      makeD1RecipeRecoveryRepository(
        testEnv.MealPlannerDatabase,
        runtimeStage
      ).prepareNextAttempt({
        acquisitionGeneration: sourceSeed.generation,
        createdAt: decodeImportTimestamp("2026-08-09T00:08:00.000Z"),
        importId: sourceSeed.importId,
        predecessorDispatchId: sourceFirst.currentDispatchId,
      })
    );
    expect(sourceFailure._tag).toBe("RecipeRecovery.EvidenceMismatch");

    const rootSeed = await seedRoot("000000000309");
    const wrongRoot = decodeDispatchId(
      `recipe:${rootSeed.importId}:1:${"9".repeat(64)}`
    );
    const rootFailure = await readFailure(
      makeD1RecipeRecoveryRepository(
        testEnv.MealPlannerDatabase,
        runtimeStage
      ).prepareNextAttempt({
        acquisitionGeneration: rootSeed.generation,
        createdAt: decodeImportTimestamp("2026-08-09T00:06:00.000Z"),
        importId: rootSeed.importId,
        predecessorDispatchId: wrongRoot,
      })
    );
    expect(rootFailure._tag).toBe("RecipeRecovery.DispatchConflict");

    await testEnv.MealPlannerDatabase.prepare(
      `UPDATE pilot_provider_stage_budget
          SET settled_micro_usd = 9950000
        WHERE runtime_stage = ?`
    )
      .bind(runtimeStage)
      .run();
    const budgetFailure = await readFailure(
      makeD1RecipeRecoveryRepository(
        testEnv.MealPlannerDatabase,
        runtimeStage
      ).prepareNextAttempt({
        acquisitionGeneration: rootSeed.generation,
        createdAt: decodeImportTimestamp("2026-08-09T00:07:00.000Z"),
        importId: rootSeed.importId,
        predecessorDispatchId: rootSeed.dispatchId,
      })
    );
    expect(budgetFailure._tag).toBe("RecipeRecovery.BudgetExhausted");

    await testEnv.MealPlannerDatabase.prepare(
      `UPDATE pilot_provider_stage_budget
          SET state = 'poisoned', poison_dispatch_id = ?
        WHERE runtime_stage = ?`
    )
      .bind(rootSeed.dispatchId, runtimeStage)
      .run();
    const poisonedFailure = await readFailure(
      makeD1RecipeRecoveryRepository(
        testEnv.MealPlannerDatabase,
        runtimeStage
      ).prepareNextAttempt({
        acquisitionGeneration: rootSeed.generation,
        createdAt: decodeImportTimestamp("2026-08-09T00:08:00.000Z"),
        importId: rootSeed.importId,
        predecessorDispatchId: rootSeed.dispatchId,
      })
    );
    expect(poisonedFailure._tag).toBe("RecipeRecovery.BudgetExhausted");
  });

  it("preserves the poison when source identity drifts before reconciliation", async () => {
    const seeded = await seedRoot("000000000315");
    const attempt = await prepareAttempt(seeded, seeded.dispatchId, 2);
    await makeAttemptOutcomeUnknown(seeded, attempt, 3);
    await corruptSourceIdentity(seeded.importId, decodeSha256("e".repeat(64)));

    await expect(reconcileAttempt(seeded, attempt, 4)).rejects.toMatchObject({
      _tag: "ProviderTerminalSettlementError",
      code: "not_allowed",
    });
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT state, poison_dispatch_id, reserved_micro_usd
           FROM pilot_provider_stage_budget
          WHERE runtime_stage = ?`
      )
        .bind(runtimeStage)
        .first()
    ).resolves.toEqual({
      poison_dispatch_id: attempt.currentDispatchId,
      reserved_micro_usd: 100_000,
      state: "poisoned",
    });
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT count(*) AS reconciliation_count
           FROM pilot_provider_budget_reconciliations
          WHERE runtime_stage = ? AND dispatch_id = ?`
      )
        .bind(runtimeStage, attempt.currentDispatchId)
        .first()
    ).resolves.toEqual({ reconciliation_count: 0 });
  });

  it("rejects reused dispatch and extraction identities", async () => {
    const dispatchSeed = await seedRoot("000000000310");
    const reusedDispatchId = decodeDispatchId(
      `${dispatchSeed.dispatchId}:recovery:1`
    );
    const dispatchReservation = {
      dispatchId: reusedDispatchId,
      maximumCostMicroUsd: 1,
      providerStageId: decodeStageId("speech-transcription"),
      runId: decodeRunId(`gaia-118:${dispatchSeed.importId}`),
      timestamp: decodeBudgetTimestamp("2026-08-09T00:02:00.000Z"),
    };
    const budget = makeD1PilotProviderBudgetRepository(
      testEnv.MealPlannerDatabase,
      runtimeStage
    );
    await Effect.runPromise(budget.reserve(dispatchReservation));
    await Effect.runPromise(budget.beginInvocation(dispatchReservation));
    await Effect.runPromise(
      budget.settleKnown({
        ...dispatchReservation,
        actualCostMicroUsd: 0,
      })
    );
    const dispatchFailure = await readFailure(
      makeD1RecipeRecoveryRepository(
        testEnv.MealPlannerDatabase,
        runtimeStage
      ).prepareNextAttempt({
        acquisitionGeneration: dispatchSeed.generation,
        createdAt: decodeImportTimestamp("2026-08-09T00:03:00.000Z"),
        importId: dispatchSeed.importId,
        predecessorDispatchId: dispatchSeed.dispatchId,
      })
    );
    expect(dispatchFailure._tag).toBe("RecipeRecovery.DispatchConflict");

    const extractionSeed = await seedRoot("000000000311");
    const reusedExtraction = await Effect.runPromise(
      recipeRecoveryExtractionFingerprint(
        decodeSha256(extractionSeed.extractionFingerprint),
        1
      )
    );
    await testEnv.MealPlannerDatabase.prepare(
      `INSERT INTO import_recipe_extractions (
         extraction_fingerprint, import_id, acquisition_generation,
         evidence_fingerprint, extractor_provider, extractor_model,
         extractor_version, state, created_at, updated_at
       ) VALUES (
         ?, ?, ?, ?, 'cloudflare-workers-ai', 'recipe-model', 'installed-v1',
         'dispatching', ?, ?
       )`
    )
      .bind(
        reusedExtraction,
        extractionSeed.importId,
        extractionSeed.generation,
        extractionSeed.evidenceFingerprint,
        "2026-08-09T00:04:00.000Z",
        "2026-08-09T00:04:00.000Z"
      )
      .run();
    const extractionFailure = await readFailure(
      makeD1RecipeRecoveryRepository(
        testEnv.MealPlannerDatabase,
        runtimeStage
      ).prepareNextAttempt({
        acquisitionGeneration: extractionSeed.generation,
        createdAt: decodeImportTimestamp("2026-08-09T00:05:00.000Z"),
        importId: extractionSeed.importId,
        predecessorDispatchId: extractionSeed.dispatchId,
      })
    );
    expect(extractionFailure._tag).toBe("RecipeRecovery.ExtractionConflict");
  });

  it("keeps D1 unavailable distinct from absence", async () => {
    const seeded = await seedRoot("000000000312");
    const failure = await readFailure(
      makeD1RecipeRecoveryRepository(
        testEnv.MealPlannerDatabase,
        "unexpected-stage"
      ).prepareNextAttempt({
        acquisitionGeneration: seeded.generation,
        createdAt: decodeImportTimestamp("2026-08-09T00:02:00.000Z"),
        importId: seeded.importId,
        predecessorDispatchId: seeded.dispatchId,
      })
    );
    expect(failure._tag).toBe("RecipeRecovery.D1Unavailable");
  });

  it("exposes one generic prepare and resume route", async () => {
    const seeded = await seedRoot("000000000313");
    const operatorTrace = Schema.decodeUnknownSync(ImportTraceContext)({
      correlationId: "60000000-0000-4000-8000-000000000313",
    });
    const started: unknown[] = [];
    const app = await makeApp(started);

    const prepared = await postOperation(
      app,
      seeded,
      "prepare_recipe_recovery"
    );
    expect(prepared.status).toBe(200);
    await expect(prepared.json()).resolves.toMatchObject({
      dispatchId: seeded.dispatchId,
      outcome: "recipe_recovery_prepared",
      recoveryDispatchId: `${seeded.dispatchId}:recovery:1`,
      recoveryOrdinal: 1,
    });
    expect(started).toHaveLength(1);

    const resumedStarted: unknown[] = [];
    const reconstructedApp = await makeApp(resumedStarted);
    const resumed = await postOperation(
      reconstructedApp,
      seeded,
      "resume_recipe_recovery"
    );
    expect(resumed.status).toBe(200);
    await expect(resumed.json()).resolves.toMatchObject({
      outcome: "recipe_recovery_resumed",
      recoveryOrdinal: 1,
    });
    expect(started).toHaveLength(1);
    expect(resumedStarted).toEqual(started);

    expect(started).toHaveLength(1);
    expect(resumedStarted).toHaveLength(1);
    expect(started[0]).toMatchObject({ trace: seeded.trace });
    expect(resumedStarted[0]).toMatchObject({ trace: seeded.trace });
    expect(started[0]).not.toMatchObject({ trace: operatorTrace });
  });

  it("uses the deterministic legacy trace for recovery from a NULL import row", async () => {
    const seeded = await seedRoot("000000000316");
    await testEnv.MealPlannerDatabase.prepare(
      "UPDATE recipe_imports SET correlation_id = NULL WHERE id = ?"
    )
      .bind(seeded.importId)
      .run();
    const started: unknown[] = [];
    const app = await makeApp(started);

    const prepared = await postOperation(
      app,
      seeded,
      "prepare_recipe_recovery"
    );

    expect(prepared.status).toBe(200);
    expect(started).toEqual([
      expect.objectContaining({
        trace: {
          correlationId: deriveLegacyImportCorrelationId(seeded.importId),
        },
      }),
    ]);
  });
});

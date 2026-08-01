import { applyD1Migrations, env } from "cloudflare:test";
import type { AnyD1Database } from "drizzle-orm/d1";
import { Effect, Option, Schema } from "effect";
import { beforeAll, describe, expect, it } from "vitest";

import {
  PilotBudgetDispatchId,
  PilotBudgetProviderStageId,
  PilotBudgetRunId,
  PilotBudgetTimestamp,
} from "../pilots/pilot-provider-budget.js";
import { makeD1PilotProviderBudgetRepository } from "../pilots/pilot-provider-budget.repository.d1.js";
import { AcquisitionGeneration } from "./import-media.model.js";
import { makeD1ProviderTerminalSettlementService } from "./import-provider-terminal-settlement.js";
import {
  makeD1ProviderTerminalCheckpointRepository,
  makeD1ProviderTerminalRecoveryRepository,
} from "./import-provider-terminal.js";
import { ImportId, ImportTimestamp } from "./import.contracts.js";
import { makeD1ImportRepository } from "./import.repository.d1.js";

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

const seedPoisonedSpeechImport = async (
  suffix: string,
  providerStageId = "speech-transcription"
) => {
  const importId = decodeImportId(`00000000-0000-4000-8000-${suffix}`);
  const generation = decodeGeneration(1);
  const dispatchId = decodeDispatchId(`speech:${importId}:${generation}`);
  const now = "2026-07-27T09:00:00.000Z";
  const stageBefore = await testEnv.MealPlannerDatabase.prepare(
    `SELECT settled_micro_usd
       FROM pilot_provider_stage_budget
      WHERE runtime_stage = 'pilot-gaia-118'`
  ).first<{ readonly settled_micro_usd: number }>();
  if (stageBefore === null) {
    throw new Error("Pilot provider budget stage is missing");
  }
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
  await testEnv.MealPlannerDatabase.prepare(
    `INSERT INTO recipe_imports (
       acquisition_generation, canonical_source_id, compatibility_fingerprint,
       created_at, evidence_references_json, id, recovery_action, source_kind,
       status, status_code, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, NULL, 'tiktok_video', 'acquired', NULL, ?)`
  )
    .bind(
      generation,
      `canonical-${suffix}`,
      "f".repeat(64),
      now,
      evidence,
      importId,
      now
    )
    .run();
  await testEnv.MealPlannerDatabase.prepare(
    `INSERT INTO import_transcriptions (
       import_id, acquisition_generation, dispatch_id, source_media_sha256,
       state, created_at, updated_at
     ) VALUES (?, ?, ?, ?, 'dispatching', ?, ?)`
  )
    .bind(importId, generation, dispatchId, "a".repeat(64), now, now)
    .run();

  const budget = makeD1PilotProviderBudgetRepository(
    testEnv.MealPlannerDatabase,
    "pilot-gaia-118"
  );
  const reservation = {
    dispatchId,
    maximumCostMicroUsd: 50_000,
    providerStageId: decodeStageId(providerStageId),
    runId: decodeRunId(`run-${suffix}`),
    timestamp: decodeBudgetTimestamp(now),
  };
  await Effect.runPromise(budget.reserve(reservation));
  await Effect.runPromise(budget.beginInvocation(reservation));
  await Effect.runPromise(budget.settleUnknown(reservation));
  return {
    dispatchId,
    generation,
    importId,
    now,
    settledBefore: stageBefore.settled_micro_usd,
  };
};

const seedDispatchingRecipeImport = async (suffix: string) => {
  const importId = decodeImportId(`00000000-0000-4000-8000-${suffix}`);
  const generation = decodeGeneration(1);
  const extractionFingerprint = "c".repeat(64);
  const now = "2026-07-27T09:10:00.000Z";
  await testEnv.MealPlannerDatabase.prepare(
    `INSERT INTO recipe_imports (
       acquisition_generation, canonical_source_id, compatibility_fingerprint,
       created_at, evidence_references_json, id, recovery_action, source_kind,
       status, status_code, updated_at
     ) VALUES (?, ?, ?, ?, '[]', ?, NULL, 'tiktok', 'queued', NULL, ?)`
  )
    .bind(
      generation,
      `recipe-canonical-${suffix}`,
      "f".repeat(64),
      now,
      importId,
      now
    )
    .run();
  await testEnv.MealPlannerDatabase.prepare(
    `INSERT INTO import_recipe_extractions (
       extraction_fingerprint, import_id, acquisition_generation,
       evidence_fingerprint, extractor_provider, extractor_model,
       extractor_version, state, created_at, updated_at
     ) VALUES (?, ?, ?, ?, 'cloudflare-workers-ai', 'recipe-model',
               'installed-v1', 'dispatching', ?, ?)`
  )
    .bind(extractionFingerprint, importId, generation, "d".repeat(64), now, now)
    .run();
  return { extractionFingerprint, generation, importId, now };
};

const seedFailedRecipeImport = async (suffix: string) => {
  const importId = decodeImportId(`00000000-0000-4000-8000-${suffix}`);
  const generation = decodeGeneration(1);
  const extractionFingerprint = "9".repeat(64);
  const createdAt = "2026-08-01T10:00:00.000Z";
  const completedAt = "2026-08-01T10:00:30.000Z";
  await testEnv.MealPlannerDatabase.prepare(
    `INSERT INTO recipe_imports (
       acquisition_generation, canonical_source_id, compatibility_fingerprint,
       created_at, evidence_references_json, id, recovery_action, source_kind,
       status, status_code, updated_at
     ) VALUES (?, ?, ?, ?, '[]', ?, NULL, 'tiktok_video', 'queued', NULL, ?)`
  )
    .bind(
      generation,
      `failed-recipe-${suffix}`,
      "8".repeat(64),
      createdAt,
      importId,
      createdAt
    )
    .run();
  await testEnv.MealPlannerDatabase.prepare(
    `INSERT INTO import_recipe_extractions (
       extraction_fingerprint, import_id, acquisition_generation,
       evidence_fingerprint, extractor_provider, extractor_model,
       extractor_version, state, failure_code, completed_at, created_at,
       updated_at
     ) VALUES (?, ?, ?, ?, 'cloudflare-workers-ai', 'recipe-model',
               'installed-v1', 'failed', 'invalid_schema', ?, ?, ?)`
  )
    .bind(
      extractionFingerprint,
      importId,
      generation,
      "7".repeat(64),
      completedAt,
      createdAt,
      completedAt
    )
    .run();
  return { completedAt, extractionFingerprint, generation, importId };
};

const seedFailedVisualImport = async (suffix: string) => {
  const importId = decodeImportId(`00000000-0000-4000-8000-${suffix}`);
  const generation = decodeGeneration(1);
  const dispatchId = decodeDispatchId(`visual:${importId}:${generation}`);
  const createdAt = "2026-08-01T17:00:00.000Z";
  const completedAt = "2026-08-01T17:00:30.000Z";
  const evidence = JSON.stringify([
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
       ) VALUES (?, ?, ?, ?, ?, ?, NULL, 'tiktok_video', 'transcribed', NULL, ?)`
    ).bind(
      generation,
      `failed-visual-${suffix}`,
      "6".repeat(64),
      createdAt,
      evidence,
      importId,
      completedAt
    ),
    testEnv.MealPlannerDatabase.prepare(
      `INSERT INTO import_transcriptions (
         import_id, acquisition_generation, dispatch_id, source_media_sha256,
         state, transcript_key, transcript_sha256, provider, model,
         detected_language, usage_audio_milliseconds, usage_input_bytes,
         estimated_cost_micro_usd, cost_currency, cost_certainty,
         segments_count, failure_code, created_at, updated_at, completed_at
       ) VALUES (?, ?, ?, ?, 'transcribed', ?, ?, 'fixture-provider',
                 'fixture-speech', 'en', 1000, 3, 10, 'USD', 'known', 1,
                 NULL, ?, ?, ?)`
    ).bind(
      importId,
      generation,
      `speech:${importId}:${generation}`,
      "a".repeat(64),
      `imports/${importId}/transcription/v1/generations/${generation}/transcript.json`,
      "b".repeat(64),
      createdAt,
      completedAt,
      completedAt
    ),
    testEnv.MealPlannerDatabase.prepare(
      `INSERT INTO import_visual_evidence (
         import_id, acquisition_generation, dispatch_id, source_media_sha256,
         state, failure_code, created_at, updated_at, completed_at
       ) VALUES (?, ?, ?, ?, 'failed', 'visual_extraction_failed', ?, ?, ?)`
    ).bind(
      importId,
      generation,
      dispatchId,
      "a".repeat(64),
      createdAt,
      completedAt,
      completedAt
    ),
  ]);
  return { completedAt, dispatchId, generation, importId };
};

describe("provider terminal recovery", () => {
  it("adopts immutable terminal facts from an already-failed visual dispatch", async () => {
    const seeded = await seedFailedVisualImport("000000000245");
    const repository = makeD1ProviderTerminalCheckpointRepository(
      testEnv.MealPlannerDatabase
    );
    const first = await Effect.runPromise(
      repository.persist({
        acquisitionGeneration: seeded.generation,
        completedAt: decodeImportTimestamp("2026-08-01T17:01:00.000Z"),
        failureCode: "visual_extraction_failed",
        importId: seeded.importId,
        providerStage: "visual",
      })
    );

    expect(first).toEqual({
      acquisitionGeneration: seeded.generation,
      completedAt: seeded.completedAt,
      failureCode: "visual_extraction_failed",
      importId: seeded.importId,
      ownershipId: seeded.dispatchId,
      providerStage: "visual",
    });
    await expect(
      Effect.runPromise(
        repository.persist({
          acquisitionGeneration: seeded.generation,
          completedAt: decodeImportTimestamp("2026-08-01T17:02:00.000Z"),
          failureCode: "visual_extraction_failed",
          importId: seeded.importId,
          providerStage: "visual",
        })
      )
    ).resolves.toEqual(first);
    await expect(
      Effect.runPromise(
        repository.persist({
          acquisitionGeneration: seeded.generation,
          completedAt: decodeImportTimestamp("2026-08-01T17:03:00.000Z"),
          failureCode: "outcome_unknown",
          importId: seeded.importId,
          providerStage: "visual",
        })
      )
    ).rejects.toMatchObject({ code: "persistence_corrupt" });
  });

  it("projects a recipe terminal checkpoint to the public import exactly once", async () => {
    const seeded = await seedDispatchingRecipeImport("000000000215");
    const repository = makeD1ProviderTerminalCheckpointRepository(
      testEnv.MealPlannerDatabase
    );
    const checkpoint = {
      acquisitionGeneration: seeded.generation,
      completedAt: decodeImportTimestamp(seeded.now),
      failureCode: "retry_exhausted",
      importId: seeded.importId,
      providerStage: "recipe" as const,
    };

    await expect(
      Effect.runPromise(repository.persist(checkpoint))
    ).resolves.toEqual(
      expect.objectContaining({
        ownershipId: seeded.extractionFingerprint,
        providerStage: "recipe",
      })
    );
    await expect(
      Effect.runPromise(repository.persist(checkpoint))
    ).resolves.toEqual(
      expect.objectContaining({ ownershipId: seeded.extractionFingerprint })
    );

    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT state, failure_code
           FROM import_recipe_extractions
          WHERE extraction_fingerprint = ?`
      )
        .bind(seeded.extractionFingerprint)
        .first()
    ).resolves.toEqual({
      failure_code: "provider_error",
      state: "failed",
    });
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT status, status_code, recovery_action, ownership_id
           FROM import_recipe_terminal_projections
          WHERE import_id = ?`
      )
        .bind(seeded.importId)
        .first()
    ).resolves.toEqual({
      ownership_id: seeded.extractionFingerprint,
      recovery_action: "operator_reconcile",
      status: "failed",
      status_code: "recipe_extraction_failed",
    });
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        "SELECT status, status_code, recovery_action FROM recipe_imports WHERE id = ?"
      )
        .bind(seeded.importId)
        .first()
    ).resolves.toEqual({
      recovery_action: null,
      status: "queued",
      status_code: null,
    });

    const importRepository = makeD1ImportRepository(
      testEnv.MealPlannerDatabase
    );
    const projected = Option.getOrThrow(
      await Effect.runPromise(importRepository.findById(seeded.importId))
    );
    expect(projected.view.status).toEqual({
      code: "recipe_extraction_failed",
      kind: "failed",
      recovery: "operator_reconcile",
    });

    await expect(
      Effect.runPromise(importRepository.claimAcquisition(seeded.importId))
    ).resolves.toMatchObject({
      _tag: "Finished",
      import: {
        view: {
          status: {
            code: "recipe_extraction_failed",
            kind: "failed",
            recovery: "operator_reconcile",
          },
        },
      },
    });
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        "SELECT status, acquisition_generation FROM recipe_imports WHERE id = ?"
      )
        .bind(seeded.importId)
        .first()
    ).resolves.toEqual({
      acquisition_generation: seeded.generation,
      status: "queued",
    });
  });

  it("uses an already-failed recipe row's exact terminal facts", async () => {
    const seeded = await seedFailedRecipeImport("000000000241");
    const repository = makeD1ProviderTerminalCheckpointRepository(
      testEnv.MealPlannerDatabase
    );
    const checkpoint = await Effect.runPromise(
      repository.persist({
        acquisitionGeneration: seeded.generation,
        completedAt: decodeImportTimestamp("2026-08-01T10:01:00.000Z"),
        failureCode: "invalid_schema",
        importId: seeded.importId,
        providerStage: "recipe",
      })
    );

    expect(checkpoint).toEqual({
      acquisitionGeneration: seeded.generation,
      completedAt: seeded.completedAt,
      failureCode: "invalid_schema",
      importId: seeded.importId,
      ownershipId: seeded.extractionFingerprint,
      providerStage: "recipe",
    });
    await expect(
      Effect.runPromise(
        repository.persist({
          acquisitionGeneration: seeded.generation,
          completedAt: decodeImportTimestamp("2026-08-01T10:02:00.000Z"),
          failureCode: "invalid_schema",
          importId: seeded.importId,
          providerStage: "recipe",
        })
      )
    ).resolves.toEqual(checkpoint);
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT ownership_id, projected_at, status, status_code
           FROM import_recipe_terminal_projections
          WHERE import_id = ? AND acquisition_generation = ?`
      )
        .bind(seeded.importId, seeded.generation)
        .first()
    ).resolves.toEqual({
      ownership_id: seeded.extractionFingerprint,
      projected_at: seeded.completedAt,
      status: "failed",
      status_code: "recipe_extraction_failed",
    });
  });

  it("ignores an immutable projection after the parent advances generation", async () => {
    const importId = decodeImportId("00000000-0000-4000-8000-000000000216");
    const now = "2026-07-27T09:20:00.000Z";
    await testEnv.MealPlannerDatabase.prepare(
      `INSERT INTO recipe_imports (
         acquisition_generation, canonical_source_id, compatibility_fingerprint,
         created_at, evidence_references_json, id, recovery_action, source_kind,
         status, status_code, updated_at
       ) VALUES (1, 'recipe-generation-restart', ?, ?, '[]', ?, NULL,
                 'tiktok', 'acquiring', NULL, ?)`
    )
      .bind("f".repeat(64), now, importId, now)
      .run();
    await testEnv.MealPlannerDatabase.prepare(
      `INSERT INTO import_recipe_terminal_projections (
         acquisition_generation, evidence_references_json, import_id,
         ownership_id, projected_at, recovery_action, status, status_code
       ) VALUES (1, '[]', ?, ?, ?, 'operator_reconcile', 'failed',
                 'recipe_extraction_failed')`
    )
      .bind(importId, "e".repeat(64), now)
      .run();

    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `UPDATE recipe_imports
            SET acquisition_generation = 2
          WHERE id = ?`
      )
        .bind(importId)
        .run()
    ).resolves.toMatchObject({ success: true });

    const restarted = Option.getOrThrow(
      await Effect.runPromise(
        makeD1ImportRepository(testEnv.MealPlannerDatabase).findById(importId)
      )
    );
    expect(restarted.acquisitionGeneration).toBe(2);
    expect(restarted.view.status).toEqual({ kind: "acquiring" });
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT acquisition_generation
           FROM import_recipe_terminal_projections
          WHERE import_id = ?`
      )
        .bind(importId)
        .first()
    ).resolves.toEqual({ acquisition_generation: 1 });
  });

  it("persists a typed terminal checkpoint against exact stage ownership", async () => {
    const seeded = await seedPoisonedSpeechImport("000000000178");
    const repository = makeD1ProviderTerminalCheckpointRepository(
      testEnv.MealPlannerDatabase
    );
    const input = {
      acquisitionGeneration: seeded.generation,
      completedAt: decodeImportTimestamp(seeded.now),
      failureCode: "outcome_unknown",
      importId: seeded.importId,
      providerStage: "speech" as const,
    };

    await expect(Effect.runPromise(repository.persist(input))).resolves.toEqual(
      {
        acquisitionGeneration: seeded.generation,
        completedAt: seeded.now,
        failureCode: "outcome_unknown",
        importId: seeded.importId,
        ownershipId: seeded.dispatchId,
        providerStage: "speech",
      }
    );
    await expect(Effect.runPromise(repository.persist(input))).resolves.toEqual(
      expect.objectContaining({ ownershipId: seeded.dispatchId })
    );

    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT state, failure_code
           FROM import_transcriptions
          WHERE import_id = ? AND acquisition_generation = ?`
      )
        .bind(seeded.importId, seeded.generation)
        .first()
    ).resolves.toEqual({
      failure_code: "outcome_unknown",
      state: "failed",
    });
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        "SELECT status, status_code, recovery_action FROM recipe_imports WHERE id = ?"
      )
        .bind(seeded.importId)
        .first()
    ).resolves.toEqual({
      recovery_action: "retry_later",
      status: "failed",
      status_code: "transcription_failed",
    });

    await Effect.runPromise(
      makeD1ProviderTerminalRecoveryRepository(
        testEnv.MealPlannerDatabase,
        "pilot-gaia-118"
      ).prepareSpeechUnknownRecovery({
        acquisitionGeneration: seeded.generation,
        createdAt: decodeImportTimestamp("2026-07-27T09:00:30.000Z"),
        importId: seeded.importId,
      })
    );
  });

  it("charges the full unknown reservation, preserves evidence, and prepares one idempotent recovery dispatch", async () => {
    const seeded = await seedPoisonedSpeechImport("000000000179");
    const terminal = makeD1ProviderTerminalCheckpointRepository(
      testEnv.MealPlannerDatabase
    );
    await Effect.runPromise(
      terminal.persist({
        acquisitionGeneration: seeded.generation,
        completedAt: decodeImportTimestamp(seeded.now),
        failureCode: "outcome_unknown",
        importId: seeded.importId,
        providerStage: "speech",
      })
    );
    const recovery = makeD1ProviderTerminalRecoveryRepository(
      testEnv.MealPlannerDatabase,
      "pilot-gaia-118"
    );
    const command = {
      acquisitionGeneration: seeded.generation,
      createdAt: decodeImportTimestamp("2026-07-27T09:01:00.000Z"),
      importId: seeded.importId,
    };

    const [first, replay] = await Promise.all([
      Effect.runPromise(recovery.prepareSpeechUnknownRecovery(command)),
      Effect.runPromise(recovery.prepareSpeechUnknownRecovery(command)),
    ]);
    expect(first).toEqual(replay);
    expect(first).toEqual({
      acquisitionGeneration: seeded.generation,
      importId: seeded.importId,
      originalDispatchId: seeded.dispatchId,
      recoveryDispatchId: `${seeded.dispatchId}:recovery:1`,
    });
    await expect(
      Effect.runPromise(
        recovery.speechDispatchId({
          acquisitionGeneration: seeded.generation,
          importId: seeded.importId,
        })
      )
    ).resolves.toBe(`${seeded.dispatchId}:recovery:1`);
    const wrongStageRecovery = makeD1ProviderTerminalRecoveryRepository(
      testEnv.MealPlannerDatabase,
      "production"
    );
    await expect(
      Effect.runPromise(
        wrongStageRecovery.speechDispatchId({
          acquisitionGeneration: seeded.generation,
          importId: seeded.importId,
        })
      )
    ).rejects.toMatchObject({ code: "stage_not_allowed" });
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT COUNT(*) AS count
           FROM pilot_provider_budget_dispatches
          WHERE runtime_stage = 'pilot-gaia-118' AND dispatch_id = ?`
      )
        .bind(`${seeded.dispatchId}:recovery:1`)
        .first()
    ).resolves.toEqual({ count: 0 });

    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT state, settled_micro_usd, reserved_micro_usd,
                poison_dispatch_id, invoking_dispatch_id
           FROM pilot_provider_stage_budget
          WHERE runtime_stage = 'pilot-gaia-118'`
      ).first()
    ).resolves.toEqual({
      invoking_dispatch_id: null,
      poison_dispatch_id: null,
      reserved_micro_usd: 0,
      settled_micro_usd: seeded.settledBefore + 50_000,
      state: "open",
    });
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT state, actual_cost_micro_usd, maximum_cost_micro_usd
           FROM pilot_provider_budget_dispatches
          WHERE runtime_stage = 'pilot-gaia-118' AND dispatch_id = ?`
      )
        .bind(seeded.dispatchId)
        .first()
    ).resolves.toEqual({
      actual_cost_micro_usd: null,
      maximum_cost_micro_usd: 50_000,
      state: "settled_unknown",
    });
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT conservative_charge_micro_usd, actual_cost_was_unknown,
                authority
           FROM pilot_provider_budget_reconciliations
          WHERE runtime_stage = 'pilot-gaia-118' AND dispatch_id = ?`
      )
        .bind(seeded.dispatchId)
        .first()
    ).resolves.toEqual({
      actual_cost_was_unknown: 1,
      authority: "authenticated_operator",
      conservative_charge_micro_usd: 50_000,
    });
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT failure_code
           FROM import_provider_terminal_checkpoints
          WHERE import_id = ? AND acquisition_generation = ?
            AND provider_stage = 'speech' AND ownership_id = ?`
      )
        .bind(seeded.importId, seeded.generation, seeded.dispatchId)
        .first()
    ).resolves.toEqual({ failure_code: "outcome_unknown" });
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT COUNT(*) AS count
           FROM import_transcriptions
          WHERE import_id = ? AND acquisition_generation = ?`
      )
        .bind(seeded.importId, seeded.generation)
        .first()
    ).resolves.toEqual({ count: 0 });
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        "SELECT status, status_code, recovery_action FROM recipe_imports WHERE id = ?"
      )
        .bind(seeded.importId)
        .first()
    ).resolves.toEqual({
      recovery_action: null,
      status: "acquired",
      status_code: null,
    });
  });

  it("prepares one recovery after authenticated conservative settlement reopened the stage", async () => {
    const seeded = await seedPoisonedSpeechImport("000000000182");
    const terminal = makeD1ProviderTerminalCheckpointRepository(
      testEnv.MealPlannerDatabase
    );
    await Effect.runPromise(
      terminal.persist({
        acquisitionGeneration: seeded.generation,
        completedAt: decodeImportTimestamp(seeded.now),
        failureCode: "outcome_unknown",
        importId: seeded.importId,
        providerStage: "speech",
      })
    );
    const settlement = makeD1ProviderTerminalSettlementService({
      database: testEnv.MealPlannerDatabase,
      now: () => decodeImportTimestamp("2026-07-27T09:01:30.000Z"),
      runtimeStage: "pilot-gaia-118",
    });
    await expect(
      Effect.runPromise(
        settlement.settle({
          acquisitionGeneration: seeded.generation,
          dispatchId: seeded.dispatchId,
          importId: seeded.importId,
        })
      )
    ).resolves.toMatchObject({
      conservativeChargeMicroUsd: 50_000,
      dispatchId: seeded.dispatchId,
      outcome: "terminal_unknown_cost_settled",
    });

    const recovery = makeD1ProviderTerminalRecoveryRepository(
      testEnv.MealPlannerDatabase,
      "pilot-gaia-118"
    );
    const command = {
      acquisitionGeneration: seeded.generation,
      createdAt: decodeImportTimestamp("2026-07-27T09:02:00.000Z"),
      importId: seeded.importId,
    };
    await expect(
      Effect.runPromise(
        makeD1ProviderTerminalRecoveryRepository(
          testEnv.MealPlannerDatabase,
          "production"
        ).prepareSpeechUnknownRecovery(command)
      )
    ).rejects.toMatchObject({ code: "stage_not_allowed" });
    await expect(
      Effect.runPromise(
        recovery.prepareSpeechUnknownRecovery({
          ...command,
          importId: decodeImportId("00000000-0000-4000-8000-000000000999"),
        })
      )
    ).rejects.toMatchObject({ code: "recovery_not_allowed" });

    await testEnv.MealPlannerDatabase.prepare(
      `UPDATE pilot_provider_stage_budget
          SET reserved_micro_usd = 1
        WHERE runtime_stage = 'pilot-gaia-118'`
    ).run();
    await expect(
      Effect.runPromise(recovery.prepareSpeechUnknownRecovery(command))
    ).rejects.toMatchObject({ code: "recovery_not_allowed" });
    await testEnv.MealPlannerDatabase.prepare(
      `UPDATE pilot_provider_stage_budget
          SET reserved_micro_usd = 0,
              settled_micro_usd = budget_cap_micro_usd
        WHERE runtime_stage = 'pilot-gaia-118'`
    ).run();
    await expect(
      Effect.runPromise(recovery.prepareSpeechUnknownRecovery(command))
    ).rejects.toMatchObject({ code: "recovery_not_allowed" });
    await testEnv.MealPlannerDatabase.prepare(
      `UPDATE pilot_provider_stage_budget
          SET settled_micro_usd = ?
        WHERE runtime_stage = 'pilot-gaia-118'`
    )
      .bind(seeded.settledBefore + 50_000)
      .run();

    const [first, concurrent, replay] = await Promise.all([
      Effect.runPromise(recovery.prepareSpeechUnknownRecovery(command)),
      Effect.runPromise(recovery.prepareSpeechUnknownRecovery(command)),
      Effect.runPromise(recovery.prepareSpeechUnknownRecovery(command)),
    ]);
    expect(first).toEqual(concurrent);
    expect(first).toEqual(replay);
    expect(first).toEqual({
      acquisitionGeneration: seeded.generation,
      importId: seeded.importId,
      originalDispatchId: seeded.dispatchId,
      recoveryDispatchId: `${seeded.dispatchId}:recovery:1`,
    });
    await expect(
      Effect.runPromise(
        recovery.speechDispatchId({
          acquisitionGeneration: seeded.generation,
          importId: seeded.importId,
        })
      )
    ).resolves.toBe(`${seeded.dispatchId}:recovery:1`);

    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT state, settled_micro_usd, reserved_micro_usd,
                poison_dispatch_id, invoking_dispatch_id
           FROM pilot_provider_stage_budget
          WHERE runtime_stage = 'pilot-gaia-118'`
      ).first()
    ).resolves.toEqual({
      invoking_dispatch_id: null,
      poison_dispatch_id: null,
      reserved_micro_usd: 0,
      settled_micro_usd: seeded.settledBefore + 50_000,
      state: "open",
    });
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT COUNT(*) AS count
           FROM pilot_provider_speech_recoveries
          WHERE runtime_stage = 'pilot-gaia-118'
            AND original_dispatch_id = ?`
      )
        .bind(seeded.dispatchId)
        .first()
    ).resolves.toEqual({ count: 0 });
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT COUNT(*) AS count
           FROM pilot_provider_budget_reconciliations
          WHERE runtime_stage = 'pilot-gaia-118' AND dispatch_id = ?
            AND authority = 'authenticated_operator'
            AND actual_cost_was_unknown = 1`
      )
        .bind(seeded.dispatchId)
        .first()
    ).resolves.toEqual({ count: 1 });
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT failure_code, completed_at
           FROM import_provider_terminal_checkpoints
          WHERE import_id = ? AND acquisition_generation = ?
            AND provider_stage = 'speech' AND ownership_id = ?`
      )
        .bind(seeded.importId, seeded.generation, seeded.dispatchId)
        .first()
    ).resolves.toEqual({
      completed_at: seeded.now,
      failure_code: "outcome_unknown",
    });
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT dispatch_id, state
           FROM import_transcriptions
          WHERE import_id = ? AND acquisition_generation = ?`
      )
        .bind(seeded.importId, seeded.generation)
        .first()
    ).resolves.toEqual({
      dispatch_id: `${seeded.dispatchId}:recovery:1`,
      state: "dispatching",
    });
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT status, status_code, recovery_action,
                evidence_references_json
           FROM recipe_imports
          WHERE id = ?`
      )
        .bind(seeded.importId)
        .first()
    ).resolves.toEqual({
      evidence_references_json: JSON.stringify([
        {
          kind: "original_media",
          referenceId: `imports/${seeded.importId}/acquisition/v1/generations/${seeded.generation}/original.mp4`,
        },
        {
          kind: "acquisition_manifest",
          referenceId: `imports/${seeded.importId}/acquisition/v1/generations/${seeded.generation}/manifest.json`,
        },
      ]),
      recovery_action: null,
      status: "transcribing",
      status_code: null,
    });
  });

  it("keeps the persisted recovery identity while unrelated stage activity occupies the ledger", async () => {
    const seeded = await seedPoisonedSpeechImport("000000000184");
    await Effect.runPromise(
      makeD1ProviderTerminalCheckpointRepository(
        testEnv.MealPlannerDatabase
      ).persist({
        acquisitionGeneration: seeded.generation,
        completedAt: decodeImportTimestamp(seeded.now),
        failureCode: "outcome_unknown",
        importId: seeded.importId,
        providerStage: "speech",
      })
    );
    await Effect.runPromise(
      makeD1ProviderTerminalSettlementService({
        database: testEnv.MealPlannerDatabase,
        now: () => decodeImportTimestamp("2026-07-27T09:02:30.000Z"),
        runtimeStage: "pilot-gaia-118",
      }).settle({
        acquisitionGeneration: seeded.generation,
        dispatchId: seeded.dispatchId,
        importId: seeded.importId,
      })
    );
    const recovery = makeD1ProviderTerminalRecoveryRepository(
      testEnv.MealPlannerDatabase,
      "pilot-gaia-118"
    );
    const prepared = await Effect.runPromise(
      recovery.prepareSpeechUnknownRecovery({
        acquisitionGeneration: seeded.generation,
        createdAt: decodeImportTimestamp("2026-07-27T09:03:00.000Z"),
        importId: seeded.importId,
      })
    );
    const budget = makeD1PilotProviderBudgetRepository(
      testEnv.MealPlannerDatabase,
      "pilot-gaia-118"
    );
    const unrelated = {
      dispatchId: decodeDispatchId("unrelated-gaia-187"),
      maximumCostMicroUsd: 1,
      providerStageId: decodeStageId("visual-extraction"),
      runId: decodeRunId("run-gaia-187-unrelated"),
      timestamp: decodeBudgetTimestamp("2026-07-27T09:03:30.000Z"),
    };
    await Effect.runPromise(budget.reserve(unrelated));
    await Effect.runPromise(budget.beginInvocation(unrelated));

    await expect(
      Effect.runPromise(
        recovery.speechDispatchId({
          acquisitionGeneration: seeded.generation,
          importId: seeded.importId,
        })
      )
    ).resolves.toBe(prepared.recoveryDispatchId);

    await Effect.runPromise(
      budget.settleKnown({ ...unrelated, actualCostMicroUsd: 0 })
    );
    await expect(
      Effect.runPromise(
        recovery.prepareSpeechUnknownRecovery({
          acquisitionGeneration: seeded.generation,
          createdAt: decodeImportTimestamp("2026-07-27T09:04:00.000Z"),
          importId: seeded.importId,
        })
      )
    ).resolves.toEqual(prepared);
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT dispatch_id, state
           FROM import_transcriptions
          WHERE import_id = ? AND acquisition_generation = ?`
      )
        .bind(seeded.importId, seeded.generation)
        .first()
    ).resolves.toEqual({
      dispatch_id: prepared.recoveryDispatchId,
      state: "dispatching",
    });
  });

  it("rejects an open ledger without authenticated reconciliation evidence", async () => {
    const seeded = await seedPoisonedSpeechImport("000000000183");
    await Effect.runPromise(
      makeD1ProviderTerminalCheckpointRepository(
        testEnv.MealPlannerDatabase
      ).persist({
        acquisitionGeneration: seeded.generation,
        completedAt: decodeImportTimestamp(seeded.now),
        failureCode: "outcome_unknown",
        importId: seeded.importId,
        providerStage: "speech",
      })
    );
    await testEnv.MealPlannerDatabase.prepare(
      `UPDATE pilot_provider_stage_budget
          SET settled_micro_usd = settled_micro_usd + reserved_micro_usd,
              reserved_micro_usd = 0,
              state = 'open',
              invoking_dispatch_id = NULL,
              poison_dispatch_id = NULL
        WHERE runtime_stage = 'pilot-gaia-118'
          AND state = 'poisoned'
          AND poison_dispatch_id = ?`
    )
      .bind(seeded.dispatchId)
      .run();

    await expect(
      Effect.runPromise(
        makeD1ProviderTerminalRecoveryRepository(
          testEnv.MealPlannerDatabase,
          "pilot-gaia-118"
        ).prepareSpeechUnknownRecovery({
          acquisitionGeneration: seeded.generation,
          createdAt: decodeImportTimestamp("2026-07-27T09:02:30.000Z"),
          importId: seeded.importId,
        })
      )
    ).rejects.toMatchObject({ code: "recovery_not_allowed" });
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT state, failure_code
           FROM import_transcriptions
          WHERE import_id = ? AND acquisition_generation = ?`
      )
        .bind(seeded.importId, seeded.generation)
        .first()
    ).resolves.toEqual({
      failure_code: "outcome_unknown",
      state: "failed",
    });
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT status, status_code, recovery_action
           FROM recipe_imports
          WHERE id = ?`
      )
        .bind(seeded.importId)
        .first()
    ).resolves.toEqual({
      recovery_action: "retry_later",
      status: "failed",
      status_code: "transcription_failed",
    });
  });

  it("keeps the stage poisoned when conservative settlement reaches the exact cap", async () => {
    await testEnv.MealPlannerDatabase.prepare(
      `UPDATE pilot_provider_stage_budget
          SET settled_micro_usd = 9950000,
              updated_at = '2026-07-27T09:02:00.000Z'
        WHERE runtime_stage = 'pilot-gaia-118'
          AND state = 'open'
          AND reserved_micro_usd = 0
          AND invoking_dispatch_id IS NULL
          AND poison_dispatch_id IS NULL`
    ).run();
    const seeded = await seedPoisonedSpeechImport("000000000180");
    const terminal = makeD1ProviderTerminalCheckpointRepository(
      testEnv.MealPlannerDatabase
    );
    await Effect.runPromise(
      terminal.persist({
        acquisitionGeneration: seeded.generation,
        completedAt: decodeImportTimestamp(seeded.now),
        failureCode: "outcome_unknown",
        importId: seeded.importId,
        providerStage: "speech",
      })
    );
    const recovery = makeD1ProviderTerminalRecoveryRepository(
      testEnv.MealPlannerDatabase,
      "pilot-gaia-118"
    );

    await expect(
      Effect.runPromise(
        recovery.prepareSpeechUnknownRecovery({
          acquisitionGeneration: seeded.generation,
          createdAt: decodeImportTimestamp("2026-07-27T09:02:00.000Z"),
          importId: seeded.importId,
        })
      )
    ).rejects.toMatchObject({ code: "persistence_unavailable" });
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT state, settled_micro_usd, reserved_micro_usd,
                poison_dispatch_id, invoking_dispatch_id
           FROM pilot_provider_stage_budget
          WHERE runtime_stage = 'pilot-gaia-118'`
      ).first()
    ).resolves.toEqual({
      invoking_dispatch_id: null,
      poison_dispatch_id: seeded.dispatchId,
      reserved_micro_usd: 50_000,
      settled_micro_usd: 9_950_000,
      state: "poisoned",
    });
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT state, failure_code
           FROM import_transcriptions
          WHERE import_id = ? AND acquisition_generation = ?`
      )
        .bind(seeded.importId, seeded.generation)
        .first()
    ).resolves.toEqual({
      failure_code: "outcome_unknown",
      state: "failed",
    });
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT status, status_code, recovery_action
           FROM recipe_imports
          WHERE id = ?`
      )
        .bind(seeded.importId)
        .first()
    ).resolves.toEqual({
      recovery_action: "retry_later",
      status: "failed",
      status_code: "transcription_failed",
    });
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT COUNT(*) AS count
           FROM pilot_provider_speech_recoveries
          WHERE runtime_stage = 'pilot-gaia-118'
            AND original_dispatch_id = ?`
      )
        .bind(seeded.dispatchId)
        .first()
    ).resolves.toEqual({ count: 0 });
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT COUNT(*) AS count
           FROM pilot_provider_budget_reconciliations
          WHERE runtime_stage = 'pilot-gaia-118' AND dispatch_id = ?`
      )
        .bind(seeded.dispatchId)
        .first()
    ).resolves.toEqual({ count: 0 });
  });

  it("fails closed on a poisoned first recovery without minting a nested identity", async () => {
    await testEnv.MealPlannerDatabase.prepare(
      `UPDATE pilot_provider_stage_budget
          SET settled_micro_usd = 0,
              reserved_micro_usd = 0,
              state = 'open',
              invoking_dispatch_id = NULL,
              poison_dispatch_id = NULL,
              updated_at = '2026-07-27T09:04:30.000Z'
        WHERE runtime_stage = 'pilot-gaia-118'`
    ).run();
    const seeded = await seedPoisonedSpeechImport("000000000185");
    const terminal = makeD1ProviderTerminalCheckpointRepository(
      testEnv.MealPlannerDatabase
    );
    await Effect.runPromise(
      terminal.persist({
        acquisitionGeneration: seeded.generation,
        completedAt: decodeImportTimestamp(seeded.now),
        failureCode: "outcome_unknown",
        importId: seeded.importId,
        providerStage: "speech",
      })
    );
    await Effect.runPromise(
      makeD1ProviderTerminalSettlementService({
        database: testEnv.MealPlannerDatabase,
        now: () => decodeImportTimestamp("2026-07-27T09:05:00.000Z"),
        runtimeStage: "pilot-gaia-118",
      }).settle({
        acquisitionGeneration: seeded.generation,
        dispatchId: seeded.dispatchId,
        importId: seeded.importId,
      })
    );

    const recovery = makeD1ProviderTerminalRecoveryRepository(
      testEnv.MealPlannerDatabase,
      "pilot-gaia-118"
    );
    const prepared = await Effect.runPromise(
      recovery.prepareSpeechUnknownRecovery({
        acquisitionGeneration: seeded.generation,
        createdAt: decodeImportTimestamp("2026-07-27T09:05:30.000Z"),
        importId: seeded.importId,
      })
    );
    const budget = makeD1PilotProviderBudgetRepository(
      testEnv.MealPlannerDatabase,
      "pilot-gaia-118"
    );
    const recoveryReservation = {
      dispatchId: decodeDispatchId(prepared.recoveryDispatchId),
      maximumCostMicroUsd: 50_000,
      providerStageId: decodeStageId("speech-transcription"),
      runId: decodeRunId("run-gaia-187-poisoned-recovery"),
      timestamp: decodeBudgetTimestamp("2026-07-27T09:06:00.000Z"),
    };
    await Effect.runPromise(budget.reserve(recoveryReservation));
    await Effect.runPromise(budget.beginInvocation(recoveryReservation));
    await Effect.runPromise(budget.settleUnknown(recoveryReservation));
    await Effect.runPromise(
      terminal.persist({
        acquisitionGeneration: seeded.generation,
        completedAt: decodeImportTimestamp("2026-07-27T09:06:30.000Z"),
        failureCode: "outcome_unknown",
        importId: seeded.importId,
        providerStage: "speech",
      })
    );

    await expect(
      Effect.runPromise(
        recovery.prepareSpeechUnknownRecovery({
          acquisitionGeneration: seeded.generation,
          createdAt: decodeImportTimestamp("2026-07-27T09:07:00.000Z"),
          importId: seeded.importId,
        })
      )
    ).resolves.toEqual(prepared);
    await expect(
      Effect.runPromise(
        recovery.speechDispatchId({
          acquisitionGeneration: seeded.generation,
          importId: seeded.importId,
        })
      )
    ).resolves.toBe(prepared.recoveryDispatchId);
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT state, poison_dispatch_id
           FROM pilot_provider_stage_budget
          WHERE runtime_stage = 'pilot-gaia-118'`
      ).first()
    ).resolves.toEqual({
      poison_dispatch_id: prepared.recoveryDispatchId,
      state: "poisoned",
    });
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT dispatch_id, failure_code, state
           FROM import_transcriptions
          WHERE import_id = ? AND acquisition_generation = ?`
      )
        .bind(seeded.importId, seeded.generation)
        .first()
    ).resolves.toEqual({
      dispatch_id: prepared.recoveryDispatchId,
      failure_code: "outcome_unknown",
      state: "failed",
    });
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT COUNT(*) AS count
           FROM import_provider_terminal_checkpoints
          WHERE import_id = ? AND acquisition_generation = ?
            AND provider_stage = 'speech'`
      )
        .bind(seeded.importId, seeded.generation)
        .first()
    ).resolves.toEqual({ count: 2 });
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT COUNT(*) AS count
           FROM pilot_provider_budget_dispatches
          WHERE runtime_stage = 'pilot-gaia-118'
            AND dispatch_id LIKE '%:recovery:1:recovery:1'`
      ).first()
    ).resolves.toEqual({ count: 0 });
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT COUNT(*) AS count
           FROM pilot_provider_speech_recoveries
          WHERE runtime_stage = 'pilot-gaia-118'
            AND original_dispatch_id = ?`
      )
        .bind(prepared.recoveryDispatchId)
        .first()
    ).resolves.toEqual({ count: 0 });
  });

  it("keeps the stage poisoned when the dispatch uses the legacy provider-stage key", async () => {
    await testEnv.MealPlannerDatabase.prepare(
      `UPDATE pilot_provider_stage_budget
          SET settled_micro_usd = 0,
              reserved_micro_usd = 0,
              state = 'open',
              invoking_dispatch_id = NULL,
              poison_dispatch_id = NULL,
              updated_at = '2026-07-27T09:03:00.000Z'
        WHERE runtime_stage = 'pilot-gaia-118'`
    ).run();
    const seeded = await seedPoisonedSpeechImport(
      "000000000181",
      "speech_transcription"
    );
    const terminal = makeD1ProviderTerminalCheckpointRepository(
      testEnv.MealPlannerDatabase
    );
    await Effect.runPromise(
      terminal.persist({
        acquisitionGeneration: seeded.generation,
        completedAt: decodeImportTimestamp(seeded.now),
        failureCode: "outcome_unknown",
        importId: seeded.importId,
        providerStage: "speech",
      })
    );
    const recovery = makeD1ProviderTerminalRecoveryRepository(
      testEnv.MealPlannerDatabase,
      "pilot-gaia-118"
    );

    await expect(
      Effect.runPromise(
        recovery.prepareSpeechUnknownRecovery({
          acquisitionGeneration: seeded.generation,
          createdAt: decodeImportTimestamp("2026-07-27T09:03:00.000Z"),
          importId: seeded.importId,
        })
      )
    ).rejects.toMatchObject({ code: "persistence_unavailable" });
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT state, poison_dispatch_id, reserved_micro_usd
           FROM pilot_provider_stage_budget
          WHERE runtime_stage = 'pilot-gaia-118'`
      ).first()
    ).resolves.toEqual({
      poison_dispatch_id: seeded.dispatchId,
      reserved_micro_usd: 50_000,
      state: "poisoned",
    });
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT COUNT(*) AS count
           FROM pilot_provider_speech_recoveries
          WHERE runtime_stage = 'pilot-gaia-118'
            AND original_dispatch_id = ?`
      )
        .bind(seeded.dispatchId)
        .first()
    ).resolves.toEqual({ count: 0 });
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT COUNT(*) AS count
           FROM pilot_provider_budget_reconciliations
          WHERE runtime_stage = 'pilot-gaia-118' AND dispatch_id = ?`
      )
        .bind(seeded.dispatchId)
        .first()
    ).resolves.toEqual({ count: 0 });
  });

  it("promotes an uncertain visual projection after native retries exhaust", async () => {
    const importId = decodeImportId("00000000-0000-4000-8000-000000000205");
    const generation = decodeGeneration(1);
    const dispatchId = decodeDispatchId(`visual:${importId}:${generation}`);
    const acquiredAt = "2026-07-29T06:08:00.000Z";
    const uncertainAt = "2026-07-29T06:09:00.000Z";
    const exhaustedAt = decodeImportTimestamp("2026-07-29T06:09:42.000Z");
    const evidence = JSON.stringify([
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
           acquisition_generation, canonical_source_id,
           compatibility_fingerprint, created_at, evidence_references_json,
           id, recovery_action, source_kind, status, status_code, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, NULL, 'tiktok_video',
                   'transcribed', NULL, ?)`
      ).bind(
        generation,
        "canonical-gaia-205-visual-retry-exhausted",
        "f".repeat(64),
        acquiredAt,
        evidence,
        importId,
        uncertainAt
      ),
      testEnv.MealPlannerDatabase.prepare(
        `INSERT INTO import_transcriptions (
           import_id, acquisition_generation, dispatch_id,
           source_media_sha256, state, transcript_key, transcript_sha256,
           provider, model, detected_language, usage_audio_milliseconds,
           usage_input_bytes, estimated_cost_micro_usd, cost_currency,
           cost_certainty, segments_count, failure_code, created_at,
           updated_at, completed_at
         ) VALUES (?, ?, ?, ?, 'transcribed', ?, ?, 'fixture-provider',
                   'fixture-speech', 'en', 1000, 3, 10, 'USD', 'known', 1,
                   NULL, ?, ?, ?)`
      ).bind(
        importId,
        generation,
        `speech:${importId}:${generation}`,
        "a".repeat(64),
        `imports/${importId}/transcription/v1/generations/${generation}/transcript.json`,
        "b".repeat(64),
        acquiredAt,
        uncertainAt,
        uncertainAt
      ),
      testEnv.MealPlannerDatabase.prepare(
        `INSERT INTO import_visual_evidence (
           import_id, acquisition_generation, dispatch_id,
           source_media_sha256, state, failure_code, created_at,
           updated_at, completed_at
         ) VALUES (?, ?, ?, ?, 'failed', 'outcome_unknown', ?, ?, ?)`
      ).bind(
        importId,
        generation,
        dispatchId,
        "a".repeat(64),
        acquiredAt,
        uncertainAt,
        uncertainAt
      ),
    ]);

    await expect(
      Effect.runPromise(
        makeD1ProviderTerminalCheckpointRepository(
          testEnv.MealPlannerDatabase
        ).persist({
          acquisitionGeneration: generation,
          completedAt: exhaustedAt,
          failureCode: "visual_extraction_failed",
          importId,
          providerStage: "visual",
        })
      )
    ).resolves.toMatchObject({
      failureCode: "visual_extraction_failed",
      ownershipId: dispatchId,
    });
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT state, failure_code, completed_at
           FROM import_visual_evidence
          WHERE import_id = ? AND acquisition_generation = ?`
      )
        .bind(importId, generation)
        .first()
    ).resolves.toEqual({
      completed_at: "2026-07-29T06:09:42.000Z",
      failure_code: "visual_extraction_failed",
      state: "failed",
    });
  });

  it("prepares one bounded second visual recovery from an honest unknown outcome while preserving both failed dispatch audits", async () => {
    const importId = decodeImportId("00000000-0000-4000-8000-000000000206");
    const generation = decodeGeneration(1);
    const originalDispatchId = decodeDispatchId(
      `visual:${importId}:${generation}`
    );
    const firstRecoveryDispatchId = decodeDispatchId(
      `${originalDispatchId}:recovery:1`
    );
    const secondRecoveryDispatchId = decodeDispatchId(
      `${originalDispatchId}:recovery:2`
    );
    const now = "2026-07-29T10:00:00.000Z";
    const evidence = JSON.stringify([
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
        `UPDATE pilot_provider_stage_budget
            SET settled_micro_usd = 0,
                reserved_micro_usd = 0,
                state = 'open',
                invoking_dispatch_id = NULL,
                poison_dispatch_id = NULL
          WHERE runtime_stage = 'pilot-gaia-118'`
      ),
      testEnv.MealPlannerDatabase.prepare(
        `INSERT INTO recipe_imports (
           acquisition_generation, canonical_source_id,
           compatibility_fingerprint, created_at,
           evidence_references_json, id, recovery_action, source_kind,
           status, status_code, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, NULL, 'tiktok_video',
                   'transcribed', NULL, ?)`
      ).bind(
        generation,
        "canonical-gaia-206-second-visual-recovery",
        "f".repeat(64),
        now,
        evidence,
        importId,
        now
      ),
      testEnv.MealPlannerDatabase.prepare(
        `INSERT INTO import_transcriptions (
           import_id, acquisition_generation, dispatch_id,
           source_media_sha256, state, transcript_key, transcript_sha256,
           provider, model, detected_language, usage_audio_milliseconds,
           usage_input_bytes, estimated_cost_micro_usd, cost_currency,
           cost_certainty, segments_count, failure_code, created_at,
           updated_at, completed_at
         ) VALUES (?, ?, ?, ?, 'transcribed', ?, ?, 'fixture-provider',
                   'fixture-speech', 'en', 1000, 3, 10, 'USD', 'known', 1,
                   NULL, ?, ?, ?)`
      ).bind(
        importId,
        generation,
        `speech:${importId}:${generation}`,
        "a".repeat(64),
        `imports/${importId}/transcription/v1/generations/${generation}/transcript.json`,
        "b".repeat(64),
        now,
        now,
        now
      ),
      testEnv.MealPlannerDatabase.prepare(
        `INSERT INTO import_visual_evidence (
           import_id, acquisition_generation, dispatch_id,
           source_media_sha256, state, failure_code, created_at,
           updated_at, completed_at
         ) VALUES (?, ?, ?, ?, 'failed', 'visual_extraction_failed', ?, ?, ?)`
      ).bind(
        importId,
        generation,
        originalDispatchId,
        "a".repeat(64),
        now,
        now,
        now
      ),
      testEnv.MealPlannerDatabase.prepare(
        `INSERT INTO import_provider_terminal_checkpoints (
           import_id, acquisition_generation, provider_stage,
           ownership_id, failure_code, completed_at, created_at
         ) VALUES (?, ?, 'visual', ?, 'visual_extraction_failed', ?, ?)`
      ).bind(importId, generation, originalDispatchId, now, now),
      testEnv.MealPlannerDatabase.prepare(
        `INSERT INTO pilot_provider_budget_dispatches (
           runtime_stage, dispatch_id, run_id, provider_stage_id,
           maximum_cost_micro_usd, actual_cost_micro_usd, state,
           created_at, updated_at, invocation_started_at, completed_at
         ) VALUES (
           'pilot-gaia-118', ?, 'gaia-206:second-visual-recovery:1',
           'visual-evidence', 100000, NULL, 'settled_unknown', ?, ?, ?, ?
         )`
      ).bind(originalDispatchId, now, now, now, now),
      testEnv.MealPlannerDatabase.prepare(
        `INSERT INTO pilot_provider_budget_reconciliations (
           runtime_stage, dispatch_id, conservative_charge_micro_usd,
           actual_cost_was_unknown, authority, created_at
         ) VALUES (
           'pilot-gaia-118', ?, 100000, 1, 'authenticated_operator', ?
         )`
      ).bind(originalDispatchId, now),
    ]);
    await testEnv.MealPlannerDatabase.prepare(
      `UPDATE pilot_provider_stage_budget
          SET reserved_micro_usd = 0,
              settled_micro_usd = 100000
        WHERE runtime_stage = 'pilot-gaia-118'`
    ).run();
    await testEnv.MealPlannerDatabase.prepare(
      `INSERT INTO pilot_provider_visual_recoveries (
         runtime_stage, import_id, acquisition_generation,
         original_dispatch_id, recovery_dispatch_id, created_at
       ) VALUES ('pilot-gaia-118', ?, ?, ?, ?, ?)`
    )
      .bind(
        importId,
        generation,
        originalDispatchId,
        firstRecoveryDispatchId,
        now
      )
      .run();
    await testEnv.MealPlannerDatabase.batch([
      testEnv.MealPlannerDatabase.prepare(
        `INSERT INTO import_visual_evidence (
           import_id, acquisition_generation, dispatch_id,
           source_media_sha256, state, failure_code, created_at,
           updated_at, completed_at
         ) VALUES (?, ?, ?, ?, 'failed', 'outcome_unknown', ?, ?, ?)`
      ).bind(
        importId,
        generation,
        firstRecoveryDispatchId,
        "a".repeat(64),
        now,
        now,
        now
      ),
      testEnv.MealPlannerDatabase.prepare(
        `INSERT INTO import_provider_terminal_checkpoints (
           import_id, acquisition_generation, provider_stage,
           ownership_id, failure_code, completed_at, created_at
         ) VALUES (?, ?, 'visual', ?, 'outcome_unknown', ?, ?)`
      ).bind(importId, generation, firstRecoveryDispatchId, now, now),
      testEnv.MealPlannerDatabase.prepare(
        `INSERT INTO pilot_provider_budget_dispatches (
           runtime_stage, dispatch_id, run_id, provider_stage_id,
           maximum_cost_micro_usd, actual_cost_micro_usd, state,
           created_at, updated_at, invocation_started_at, completed_at
         ) VALUES (
           'pilot-gaia-118', ?, 'gaia-206:second-visual-recovery:2',
           'visual-evidence', 100000, NULL, 'settled_unknown', ?, ?, ?, ?
         )`
      ).bind(firstRecoveryDispatchId, now, now, now, now),
      testEnv.MealPlannerDatabase.prepare(
        `INSERT INTO pilot_provider_budget_reconciliations (
           runtime_stage, dispatch_id, conservative_charge_micro_usd,
           actual_cost_was_unknown, authority, created_at
         ) VALUES (
           'pilot-gaia-118', ?, 100000, 1, 'authenticated_operator', ?
         )`
      ).bind(firstRecoveryDispatchId, now),
    ]);
    await testEnv.MealPlannerDatabase.prepare(
      `UPDATE pilot_provider_stage_budget
          SET reserved_micro_usd = 0,
              settled_micro_usd = 200000
        WHERE runtime_stage = 'pilot-gaia-118'`
    ).run();

    const recovery = makeD1ProviderTerminalRecoveryRepository(
      testEnv.MealPlannerDatabase,
      "pilot-gaia-118"
    );
    const command = {
      acquisitionGeneration: generation,
      createdAt: decodeImportTimestamp("2026-07-29T10:01:00.000Z"),
      importId,
      originalDispatchId: firstRecoveryDispatchId,
    };
    await testEnv.MealPlannerDatabase.prepare(
      `UPDATE import_visual_evidence
          SET failure_code = 'visual_extraction_failed'
        WHERE import_id = ?
          AND acquisition_generation = ?
          AND dispatch_id = ?`
    )
      .bind(importId, generation, firstRecoveryDispatchId)
      .run();
    await expect(
      Effect.runPromise(recovery.prepareVisualUnknownRecovery(command))
    ).rejects.toMatchObject({ code: "recovery_not_allowed" });
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT COUNT(*) AS count
           FROM pilot_provider_visual_second_recoveries
          WHERE runtime_stage = 'pilot-gaia-118'
            AND original_dispatch_id = ?`
      )
        .bind(originalDispatchId)
        .first()
    ).resolves.toEqual({ count: 0 });
    await testEnv.MealPlannerDatabase.prepare(
      `UPDATE import_visual_evidence
          SET failure_code = 'outcome_unknown'
        WHERE import_id = ?
          AND acquisition_generation = ?
          AND dispatch_id = ?`
    )
      .bind(importId, generation, firstRecoveryDispatchId)
      .run();
    const [first, concurrent, replay] = await Promise.all([
      Effect.runPromise(recovery.prepareVisualUnknownRecovery(command)),
      Effect.runPromise(recovery.prepareVisualUnknownRecovery(command)),
      Effect.runPromise(recovery.prepareVisualUnknownRecovery(command)),
    ]);
    expect(first).toEqual(concurrent);
    expect(first).toEqual(replay);
    expect(first).toEqual({
      acquisitionGeneration: generation,
      importId,
      originalDispatchId: firstRecoveryDispatchId,
      recoveryDispatchId: secondRecoveryDispatchId,
    });
    await expect(
      Effect.runPromise(
        recovery.visualDispatchId({
          acquisitionGeneration: generation,
          importId,
        })
      )
    ).resolves.toBe(secondRecoveryDispatchId);
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT original_dispatch_id, first_recovery_dispatch_id,
                recovery_dispatch_id
           FROM pilot_provider_visual_second_recoveries
          WHERE runtime_stage = 'pilot-gaia-118'
            AND import_id = ? AND acquisition_generation = ?`
      )
        .bind(importId, generation)
        .first()
    ).resolves.toEqual({
      first_recovery_dispatch_id: firstRecoveryDispatchId,
      original_dispatch_id: originalDispatchId,
      recovery_dispatch_id: secondRecoveryDispatchId,
    });
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT COUNT(*) AS count
           FROM pilot_provider_visual_recoveries
          WHERE runtime_stage = 'pilot-gaia-118'
            AND original_dispatch_id = ?`
      )
        .bind(originalDispatchId)
        .first()
    ).resolves.toEqual({ count: 1 });
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT COUNT(*) AS count
           FROM pilot_provider_budget_reconciliations
          WHERE runtime_stage = 'pilot-gaia-118'
            AND dispatch_id IN (?, ?)`
      )
        .bind(originalDispatchId, firstRecoveryDispatchId)
        .first()
    ).resolves.toEqual({ count: 2 });
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT COUNT(*) AS count
           FROM import_provider_terminal_checkpoints
          WHERE import_id = ? AND acquisition_generation = ?
            AND provider_stage = 'visual'
            AND ownership_id IN (?, ?)`
      )
        .bind(importId, generation, originalDispatchId, firstRecoveryDispatchId)
        .first()
    ).resolves.toEqual({ count: 2 });
    await expect(
      Effect.runPromise(
        recovery.prepareVisualUnknownRecovery({
          ...command,
          originalDispatchId: secondRecoveryDispatchId,
        })
      )
    ).rejects.toMatchObject({ code: "recovery_not_allowed" });
  });
});

import { applyD1Migrations, env } from "cloudflare:test";
import type { AnyD1Database } from "drizzle-orm/d1";
import { Effect, Schema } from "effect";
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

describe("provider terminal recovery", () => {
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
        `SELECT COUNT(*) AS count
           FROM import_transcriptions
          WHERE import_id = ? AND acquisition_generation = ?`
      )
        .bind(seeded.importId, seeded.generation)
        .first()
    ).resolves.toEqual({ count: 0 });
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
      status: "acquired",
      status_code: null,
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
});

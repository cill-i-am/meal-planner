import { applyD1Migrations, env } from "cloudflare:test";
import type { AnyD1Database } from "drizzle-orm/d1";
import { Effect, Layer, Schema } from "effect";
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
import { makeD1SpeechTranscriptionRepository } from "./import-speech-transcription.repository.d1.js";
import type { VisualEvidenceFailureCode } from "./import-visual-evidence.repository.d1.js";
import { ImportAuthorizer } from "./import.auth.js";
import {
  ImportId,
  ImportTimestamp,
  SourceCanonicalId,
} from "./import.contracts.js";
import { workflowStartUnavailable } from "./import.errors.js";
import {
  makeTestImportAuthorizer,
  seedResolvedTestImportExecution,
} from "./import.test-fixtures.js";
import type { ImportWorkflowStarterShape } from "./import.workflow.js";

const testEnv = env as unknown as {
  readonly MealPlannerDatabase: AnyD1Database;
  readonly TEST_MIGRATIONS: {
    readonly name: string;
    readonly queries: string[];
  }[];
};

const decodeImportId = Schema.decodeUnknownSync(ImportId);
const decodeCanonicalId = Schema.decodeUnknownSync(SourceCanonicalId);
const decodeGeneration = Schema.decodeUnknownSync(AcquisitionGeneration);
const decodeImportTimestamp = Schema.decodeUnknownSync(ImportTimestamp);
const decodeBudgetTimestamp = Schema.decodeUnknownSync(PilotBudgetTimestamp);
const decodeRunId = Schema.decodeUnknownSync(PilotBudgetRunId);
const decodeStageId = Schema.decodeUnknownSync(PilotBudgetProviderStageId);
const decodeDispatchId = Schema.decodeUnknownSync(PilotBudgetDispatchId);
const readD1Results = (result: { readonly results: readonly unknown[] }) =>
  result.results;

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
            updated_at = '2026-07-27T10:00:00.000Z'
      WHERE runtime_stage = 'pilot-gaia-118'`
  ).run();
});

const seedPoisonedTerminalSpeechImport = async (
  suffix: string,
  options: {
    readonly persistCheckpoint?: boolean;
    readonly providerStageId?: string;
    readonly reservationMicroUsd?: number;
  } = {}
) => {
  const importId = decodeImportId(`00000000-0000-4000-8000-${suffix}`);
  const acquisitionGeneration = decodeGeneration(1);
  const dispatchId = decodeDispatchId(
    `speech:${importId}:${acquisitionGeneration}`
  );
  const now = "2026-07-27T10:00:00.000Z";
  const evidence = [
    {
      kind: "original_media",
      referenceId: `imports/${importId}/acquisition/v1/generations/${acquisitionGeneration}/original.mp4`,
    },
    {
      kind: "acquisition_manifest",
      referenceId: `imports/${importId}/acquisition/v1/generations/${acquisitionGeneration}/manifest.json`,
    },
  ] as const;
  await seedResolvedTestImportExecution({
    acquisitionGeneration,
    canonicalId: decodeCanonicalId(`canonical-${suffix}`),
    database: testEnv.MealPlannerDatabase,
    evidence,
    importId,
    status: { kind: "acquired" },
    updatedAt: decodeImportTimestamp(now),
  });
  await testEnv.MealPlannerDatabase.prepare(
    `INSERT INTO import_transcriptions (
       import_id, acquisition_generation, dispatch_id, source_media_sha256,
       state, created_at, updated_at
     ) VALUES (?, ?, ?, ?, 'dispatching', ?, ?)`
  )
    .bind(importId, acquisitionGeneration, dispatchId, "a".repeat(64), now, now)
    .run();

  const reservation = {
    dispatchId,
    maximumCostMicroUsd: options.reservationMicroUsd ?? 50_000,
    providerStageId: decodeStageId(
      options.providerStageId ?? "speech-transcription"
    ),
    runId: decodeRunId(`run-${suffix}`),
    timestamp: decodeBudgetTimestamp(now),
  };
  const budget = makeD1PilotProviderBudgetRepository(
    testEnv.MealPlannerDatabase,
    "pilot-gaia-118"
  );
  await Effect.runPromise(budget.reserve(reservation));
  await Effect.runPromise(budget.beginInvocation(reservation));
  await Effect.runPromise(budget.settleUnknown(reservation));

  if (options.persistCheckpoint !== false) {
    await Effect.runPromise(
      makeD1ProviderTerminalCheckpointRepository(
        testEnv.MealPlannerDatabase
      ).persist({
        acquisitionGeneration,
        completedAt: decodeImportTimestamp(now),
        failureCode: "outcome_unknown",
        importId,
        providerStage: "speech",
      })
    );
  }

  return { acquisitionGeneration, dispatchId, importId, now, reservation };
};

const seedPoisonedTerminalVisualImport = async (
  suffix: string,
  options: {
    readonly additionalVisualDispatch?: boolean;
    readonly matchingSourceHash?: boolean;
    readonly maximumCostMicroUsd?: number;
    readonly persistCheckpoint?: boolean;
    readonly providerStageId?: string;
    readonly runId?: string;
    readonly terminalFailureCode?: VisualEvidenceFailureCode;
  } = {}
) => {
  const importId = decodeImportId(`00000000-0000-4000-8000-${suffix}`);
  const acquisitionGeneration = decodeGeneration(1);
  const dispatchId = decodeDispatchId(
    `visual:${importId}:${acquisitionGeneration}`
  );
  const speechDispatchId = decodeDispatchId(
    `speech:${importId}:${acquisitionGeneration}`
  );
  const now = "2026-07-30T10:00:00.000Z";
  const sourceMediaSha256 = "a".repeat(64);
  const evidence = [
    {
      kind: "original_media",
      referenceId: `imports/${importId}/acquisition/v1/generations/${acquisitionGeneration}/original.mp4`,
    },
    {
      kind: "acquisition_manifest",
      referenceId: `imports/${importId}/acquisition/v1/generations/${acquisitionGeneration}/manifest.json`,
    },
    {
      kind: "speech_transcript",
      referenceId: `imports/${importId}/transcription/v1/generations/${acquisitionGeneration}/transcript.json`,
    },
  ] as const;

  await seedResolvedTestImportExecution({
    acquisitionGeneration,
    canonicalId: decodeCanonicalId(`visual-canonical-${suffix}`),
    database: testEnv.MealPlannerDatabase,
    evidence,
    importId,
    status: { kind: "transcribed" },
    updatedAt: decodeImportTimestamp(now),
  });

  await testEnv.MealPlannerDatabase.batch([
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
      acquisitionGeneration,
      speechDispatchId,
      options.matchingSourceHash === false ? "c".repeat(64) : sourceMediaSha256,
      `imports/${importId}/transcription/v1/generations/${acquisitionGeneration}/transcript.json`,
      "b".repeat(64),
      now,
      now,
      now
    ),
    testEnv.MealPlannerDatabase.prepare(
      `INSERT INTO import_visual_evidence (
         import_id, acquisition_generation, dispatch_id, source_media_sha256,
         state, created_at, updated_at
       ) VALUES (?, ?, ?, ?, 'dispatching', ?, ?)`
    ).bind(
      importId,
      acquisitionGeneration,
      dispatchId,
      sourceMediaSha256,
      now,
      now
    ),
  ]);

  const runId = decodeRunId(options.runId ?? `gaia-118:${importId}`);
  const budget = makeD1PilotProviderBudgetRepository(
    testEnv.MealPlannerDatabase,
    "pilot-gaia-118"
  );
  if (options.additionalVisualDispatch === true) {
    const sibling = {
      dispatchId: decodeDispatchId(
        `visual:${importId}:${acquisitionGeneration}:ambiguous`
      ),
      maximumCostMicroUsd: 1,
      providerStageId: decodeStageId("visual-evidence"),
      runId,
      timestamp: decodeBudgetTimestamp(now),
    };
    await Effect.runPromise(budget.reserve(sibling));
    await Effect.runPromise(budget.beginInvocation(sibling));
    await Effect.runPromise(
      budget.settleKnown({ ...sibling, actualCostMicroUsd: 0 })
    );
  }

  const reservation = {
    dispatchId,
    maximumCostMicroUsd: options.maximumCostMicroUsd ?? 100_000,
    providerStageId: decodeStageId(
      options.providerStageId ?? "visual-evidence"
    ),
    runId,
    timestamp: decodeBudgetTimestamp(now),
  };
  await Effect.runPromise(budget.reserve(reservation));
  await Effect.runPromise(budget.beginInvocation(reservation));
  await Effect.runPromise(budget.settleUnknown(reservation));

  if (options.persistCheckpoint !== false) {
    await Effect.runPromise(
      makeD1ProviderTerminalCheckpointRepository(
        testEnv.MealPlannerDatabase
      ).persist({
        acquisitionGeneration,
        completedAt: decodeImportTimestamp(now),
        failureCode: options.terminalFailureCode ?? "visual_extraction_failed",
        importId,
        providerStage: "visual",
      })
    );
  }

  return {
    acquisitionGeneration,
    dispatchId,
    importId,
    now,
    reservation,
    speechDispatchId,
  };
};

const seedMissingVisualTerminalCheckpoint = async (
  suffix: string,
  options: Parameters<typeof seedPoisonedTerminalVisualImport>[1] = {}
) => {
  const seeded = await seedPoisonedTerminalVisualImport(suffix, {
    ...options,
    persistCheckpoint: false,
  });
  await testEnv.MealPlannerDatabase.prepare(
    `UPDATE import_visual_evidence
        SET state = 'failed',
            failure_code = 'visual_extraction_failed',
            completed_at = ?,
            updated_at = ?
      WHERE import_id = ?
        AND acquisition_generation = ?
        AND dispatch_id = ?
        AND state = 'dispatching'`
  )
    .bind(
      seeded.now,
      seeded.now,
      seeded.importId,
      seeded.acquisitionGeneration,
      seeded.dispatchId
    )
    .run();
  return seeded;
};

const seedVisualRecoveryDescendant = async (
  seeded: Awaited<ReturnType<typeof seedMissingVisualTerminalCheckpoint>>
) => {
  const trigger = await testEnv.MealPlannerDatabase.prepare(
    `SELECT sql
       FROM sqlite_master
      WHERE type = 'trigger'
        AND name = 'pilot_provider_visual_recoveries_prepare'`
  ).first<{ readonly sql: string }>();
  if (trigger === null) {
    throw new Error("Missing visual recovery preparation trigger");
  }
  await testEnv.MealPlannerDatabase.prepare(
    "DROP TRIGGER pilot_provider_visual_recoveries_prepare"
  ).run();
  try {
    await testEnv.MealPlannerDatabase.prepare(
      `INSERT INTO pilot_provider_visual_recoveries (
         runtime_stage, import_id, acquisition_generation,
         original_dispatch_id, recovery_dispatch_id, created_at
       ) VALUES (
         'pilot-gaia-118', ?, ?, ?, ?, ?
       )`
    )
      .bind(
        seeded.importId,
        seeded.acquisitionGeneration,
        seeded.dispatchId,
        `${seeded.dispatchId}:recovery:1`,
        seeded.now
      )
      .run();
  } finally {
    await testEnv.MealPlannerDatabase.prepare(trigger.sql).run();
  }
};

const seedPoisonedTerminalRecipeImport = async (
  suffix: string,
  options: {
    readonly additionalRecipeDispatch?: boolean;
    readonly maximumCostMicroUsd?: number;
    readonly persistCheckpoint?: boolean;
    readonly providerStageId?: string;
    readonly runId?: string;
  } = {}
) => {
  const importId = decodeImportId(`00000000-0000-4000-8000-${suffix}`);
  const acquisitionGeneration = decodeGeneration(1);
  const evidenceFingerprint = `${"d".repeat(52)}${suffix}`;
  const extractionFingerprint = `${"c".repeat(52)}${suffix}`;
  const dispatchId = decodeDispatchId(
    `recipe:${importId}:${acquisitionGeneration}:${evidenceFingerprint}`
  );
  const now = "2026-07-29T18:00:00.000Z";
  await seedResolvedTestImportExecution({
    acquisitionGeneration,
    canonicalId: decodeCanonicalId(`recipe-canonical-${suffix}`),
    database: testEnv.MealPlannerDatabase,
    evidence: [],
    importId,
    status: { kind: "queued" },
    updatedAt: decodeImportTimestamp(now),
  });
  await testEnv.MealPlannerDatabase.prepare(
    `INSERT INTO import_recipe_extractions (
       extraction_fingerprint, import_id, acquisition_generation,
       evidence_fingerprint, extractor_provider, extractor_model,
       extractor_version, state, created_at, updated_at
     ) VALUES (?, ?, ?, ?, 'cloudflare-workers-ai', 'recipe-model',
               'installed-v1', 'dispatching', ?, ?)`
  )
    .bind(
      extractionFingerprint,
      importId,
      acquisitionGeneration,
      evidenceFingerprint,
      now,
      now
    )
    .run();

  const runId = decodeRunId(options.runId ?? `gaia-118:${importId}`);
  const budget = makeD1PilotProviderBudgetRepository(
    testEnv.MealPlannerDatabase,
    "pilot-gaia-118"
  );
  const settleKnownSibling = async (sibling: {
    readonly dispatchId: ReturnType<typeof decodeDispatchId>;
    readonly providerStageId: ReturnType<typeof decodeStageId>;
  }) => {
    const reservation = {
      ...sibling,
      maximumCostMicroUsd: 1,
      runId,
      timestamp: decodeBudgetTimestamp(now),
    };
    await Effect.runPromise(budget.reserve(reservation));
    await Effect.runPromise(budget.beginInvocation(reservation));
    await Effect.runPromise(
      budget.settleKnown({ ...reservation, actualCostMicroUsd: 0 })
    );
  };
  await settleKnownSibling({
    dispatchId: decodeDispatchId(`speech:${importId}:${acquisitionGeneration}`),
    providerStageId: decodeStageId("speech-transcription"),
  });
  await settleKnownSibling({
    dispatchId: decodeDispatchId(
      `visual:${importId}:${acquisitionGeneration}:evidence`
    ),
    providerStageId: decodeStageId("visual-evidence"),
  });
  if (options.additionalRecipeDispatch === true) {
    await settleKnownSibling({
      dispatchId: decodeDispatchId(
        `recipe:${importId}:${acquisitionGeneration}:ambiguous`
      ),
      providerStageId: decodeStageId("recipe-extraction"),
    });
  }

  const reservation = {
    dispatchId,
    maximumCostMicroUsd: options.maximumCostMicroUsd ?? 100_000,
    providerStageId: decodeStageId(
      options.providerStageId ?? "recipe-extraction"
    ),
    runId,
    timestamp: decodeBudgetTimestamp(now),
  };
  await Effect.runPromise(budget.reserve(reservation));
  await Effect.runPromise(budget.beginInvocation(reservation));
  await Effect.runPromise(budget.settleUnknown(reservation));

  if (options.persistCheckpoint !== false) {
    await Effect.runPromise(
      makeD1ProviderTerminalCheckpointRepository(
        testEnv.MealPlannerDatabase
      ).persist({
        acquisitionGeneration,
        completedAt: decodeImportTimestamp(now),
        failureCode: "outcome_unknown",
        importId,
        providerStage: "recipe",
      })
    );
  }

  return {
    acquisitionGeneration,
    dispatchId,
    extractionFingerprint,
    importId,
    now,
    reservation,
  };
};

const seedMissingRecipeTerminalCheckpoint = async (
  suffix: string,
  options: Parameters<typeof seedPoisonedTerminalRecipeImport>[1] = {}
) => {
  const seeded = await seedPoisonedTerminalRecipeImport(suffix, {
    ...options,
    persistCheckpoint: false,
  });
  const speechDispatchId = decodeDispatchId(
    `speech:${seeded.importId}:${seeded.acquisitionGeneration}`
  );
  const transcriptKey = `imports/${seeded.importId}/transcription/v1/generations/${seeded.acquisitionGeneration}/transcript.json`;
  const evidence = JSON.stringify([
    {
      kind: "original_media",
      referenceId: `imports/${seeded.importId}/acquisition/v1/generations/${seeded.acquisitionGeneration}/original.mp4`,
    },
    {
      kind: "acquisition_manifest",
      referenceId: `imports/${seeded.importId}/acquisition/v1/generations/${seeded.acquisitionGeneration}/manifest.json`,
    },
    {
      kind: "speech_transcript",
      referenceId: transcriptKey,
    },
  ]);
  await testEnv.MealPlannerDatabase.batch([
    testEnv.MealPlannerDatabase.prepare(
      `UPDATE recipe_imports
          SET status = 'transcribed',
              status_code = NULL,
              recovery_action = NULL,
              evidence_references_json = ?,
              updated_at = ?
        WHERE id = ? AND acquisition_generation = ?`
    ).bind(evidence, seeded.now, seeded.importId, seeded.acquisitionGeneration),
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
      seeded.importId,
      seeded.acquisitionGeneration,
      speechDispatchId,
      "a".repeat(64),
      transcriptKey,
      "b".repeat(64),
      seeded.now,
      seeded.now,
      seeded.now
    ),
    testEnv.MealPlannerDatabase.prepare(
      `UPDATE import_recipe_extractions
          SET state = 'failed',
              failure_code = 'provider_error',
              completed_at = ?,
              updated_at = ?
        WHERE import_id = ?
          AND acquisition_generation = ?
          AND extraction_fingerprint = ?
          AND state = 'dispatching'`
    ).bind(
      seeded.now,
      seeded.now,
      seeded.importId,
      seeded.acquisitionGeneration,
      seeded.extractionFingerprint
    ),
  ]);
  return { ...seeded, speechDispatchId, transcriptKey };
};

const makeApp = async (
  runtimeStage: unknown,
  workflowStarter?: Pick<ImportWorkflowStarterShape, "restartFromSpeech">
) => {
  const authorizer = await Effect.runPromise(
    makeTestImportAuthorizer("test-import-token")
  );
  const service = makeD1ProviderTerminalSettlementService({
    database: testEnv.MealPlannerDatabase,
    now: () => decodeImportTimestamp("2026-07-27T10:01:00.000Z"),
    runtimeStage,
    ...(workflowStarter === undefined ? {} : { workflowStarter }),
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

const commandFor = (
  seeded: Awaited<ReturnType<typeof seedPoisonedTerminalSpeechImport>>
) => ({
  acquisitionGeneration: seeded.acquisitionGeneration,
  dispatchId: seeded.dispatchId,
  importId: seeded.importId,
});

const speechRecoveryCommandFor = (
  seeded: Awaited<ReturnType<typeof seedPoisonedTerminalSpeechImport>>
) => ({
  ...commandFor(seeded),
  operation: "prepare_speech_recovery" as const,
});

const recipeCommandFor = (
  seeded: Awaited<ReturnType<typeof seedPoisonedTerminalRecipeImport>>
) => ({
  acquisitionGeneration: seeded.acquisitionGeneration,
  dispatchId: seeded.dispatchId,
  importId: seeded.importId,
  operation: "settle_recipe_unknown" as const,
});

const recipeCheckpointRepairCommandFor = (
  seeded: Awaited<ReturnType<typeof seedMissingRecipeTerminalCheckpoint>>
) => ({
  acquisitionGeneration: seeded.acquisitionGeneration,
  dispatchId: seeded.dispatchId,
  importId: seeded.importId,
  operation: "repair_recipe_terminal_checkpoint" as const,
});

const visualCommandFor = (
  seeded: Awaited<ReturnType<typeof seedPoisonedTerminalVisualImport>>
) => ({
  acquisitionGeneration: seeded.acquisitionGeneration,
  dispatchId: seeded.dispatchId,
  importId: seeded.importId,
  operation: "settle_visual_unknown" as const,
});

const visualCheckpointRepairCommandFor = (
  seeded: Awaited<ReturnType<typeof seedPoisonedTerminalVisualImport>>
) => ({
  acquisitionGeneration: seeded.acquisitionGeneration,
  dispatchId: seeded.dispatchId,
  importId: seeded.importId,
  operation: "repair_visual_terminal_checkpoint" as const,
});

const postSettlement = (
  app: Awaited<ReturnType<typeof makeApp>>,
  body: unknown,
  token = "test-import-token"
) =>
  app.handler(
    new Request(
      "https://meal-planner.test/imports/operator-provider-terminal-settlement",
      {
        body: JSON.stringify(body),
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        method: "POST",
      }
    )
  );

const seedRecipeReplayForSweep = async (suffix: string) => {
  const importId = `sweep-${suffix}`;
  const evidenceFingerprint = `${"b".repeat(60)}${suffix}`;
  const dispatchId = `recipe:${importId}:1:${evidenceFingerprint}`;
  const now = "2026-07-29T18:00:00.000Z";
  await testEnv.MealPlannerDatabase.batch([
    testEnv.MealPlannerDatabase.prepare(
      `INSERT INTO pilot_provider_budget_dispatches (
         runtime_stage, dispatch_id, run_id, provider_stage_id,
         maximum_cost_micro_usd, actual_cost_micro_usd, state, created_at,
         updated_at, invocation_started_at, completed_at
       ) VALUES (
         'pilot-gaia-118', ?, ?, 'recipe-extraction', 100000, NULL,
         'settled_unknown', ?, ?, ?, ?
       )`
    ).bind(dispatchId, `sweep-run-${suffix}`, now, now, now, now),
    testEnv.MealPlannerDatabase.prepare(
      `INSERT INTO pilot_provider_budget_conservative_settlements (
         actual_cost_was_unknown, authority, conservative_charge_micro_usd,
         created_at, dispatch_id, runtime_stage
       ) VALUES (
         1, 'schema_valid_provider_response', 100000, ?, ?,
         'pilot-gaia-118'
       )`
    ).bind(now, dispatchId),
    testEnv.MealPlannerDatabase.prepare(
      `INSERT INTO pilot_provider_recipe_replay_values (
         created_at, dispatch_id, evidence_fingerprint, expires_at,
         generation, import_id, runtime_stage, value_json, value_sha256
       ) VALUES (
         strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), ?, ?,
         strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+7 days'), 1, ?,
         'pilot-gaia-118', '{"opaque":"recipe-replay"}', ?
       )`
    ).bind(dispatchId, evidenceFingerprint, importId, "a".repeat(64)),
  ]);
  return { dispatchId, importId };
};

const setRecipeReplayExpiry = async (
  dispatchId: string,
  age: "at_boundary" | "expired"
) => {
  await testEnv.MealPlannerDatabase.prepare(
    "DROP TRIGGER pilot_provider_recipe_replay_values_immutable_update"
  ).run();
  try {
    const modifier = age === "expired" ? "-8 days" : "-7 days";
    const expiryModifier = age === "expired" ? "-1 day" : undefined;
    await testEnv.MealPlannerDatabase.prepare(
      `UPDATE pilot_provider_recipe_replay_values
          SET created_at =
                strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?),
              expires_at =
                strftime(
                  '%Y-%m-%dT%H:%M:%fZ',
                  'now'${expiryModifier === undefined ? "" : ", ?"}
                )
        WHERE runtime_stage = 'pilot-gaia-118'
          AND dispatch_id = ?`
    )
      .bind(
        ...([
          modifier,
          ...(expiryModifier === undefined ? [] : [expiryModifier]),
          dispatchId,
        ] as const)
      )
      .run();
  } finally {
    await testEnv.MealPlannerDatabase.prepare(
      `CREATE TRIGGER pilot_provider_recipe_replay_values_immutable_update
       BEFORE UPDATE ON pilot_provider_recipe_replay_values
       BEGIN
         SELECT RAISE(
           ABORT,
           'provider recipe replay value is immutable'
         );
       END`
    ).run();
  }
};

const readPreservedImport = async (input: {
  readonly acquisitionGeneration: number;
  readonly dispatchId: string;
  readonly importId: string;
}) => ({
  checkpoint: await testEnv.MealPlannerDatabase.prepare(
    `SELECT failure_code, completed_at
       FROM import_provider_terminal_checkpoints
      WHERE import_id = ? AND acquisition_generation = ?
        AND provider_stage = 'speech' AND ownership_id = ?`
  )
    .bind(input.importId, input.acquisitionGeneration, input.dispatchId)
    .first(),
  import: await testEnv.MealPlannerDatabase.prepare(
    `SELECT status, status_code, recovery_action, evidence_references_json,
            updated_at
       FROM recipe_imports
      WHERE id = ? AND acquisition_generation = ?`
  )
    .bind(input.importId, input.acquisitionGeneration)
    .first(),
  transcription: await testEnv.MealPlannerDatabase.prepare(
    `SELECT state, failure_code, completed_at, updated_at
       FROM import_transcriptions
      WHERE import_id = ? AND acquisition_generation = ?
        AND dispatch_id = ?`
  )
    .bind(input.importId, input.acquisitionGeneration, input.dispatchId)
    .first(),
});

const readPreservedVisualImport = async (input: {
  readonly acquisitionGeneration: number;
  readonly dispatchId: string;
  readonly importId: string;
}) => ({
  checkpoint: await testEnv.MealPlannerDatabase.prepare(
    `SELECT provider_stage, ownership_id, failure_code, completed_at,
            created_at
       FROM import_provider_terminal_checkpoints
      WHERE import_id = ? AND acquisition_generation = ?
        AND provider_stage = 'visual' AND ownership_id = ?`
  )
    .bind(input.importId, input.acquisitionGeneration, input.dispatchId)
    .first(),
  import: await testEnv.MealPlannerDatabase.prepare(
    `SELECT status, status_code, recovery_action, evidence_references_json,
            updated_at
       FROM recipe_imports
      WHERE id = ? AND acquisition_generation = ?`
  )
    .bind(input.importId, input.acquisitionGeneration)
    .first(),
  transcription: await testEnv.MealPlannerDatabase.prepare(
    `SELECT dispatch_id, source_media_sha256, state, transcript_key,
            transcript_sha256, completed_at, updated_at
       FROM import_transcriptions
      WHERE import_id = ? AND acquisition_generation = ?`
  )
    .bind(input.importId, input.acquisitionGeneration)
    .first(),
  visual: await testEnv.MealPlannerDatabase.prepare(
    `SELECT dispatch_id, source_media_sha256, state, failure_code,
            completed_at, updated_at
       FROM import_visual_evidence
      WHERE import_id = ? AND acquisition_generation = ?`
  )
    .bind(input.importId, input.acquisitionGeneration)
    .first(),
});

const readVisualCheckpointRepairState = async (input: {
  readonly dispatchId: string;
  readonly importId: string;
}) => ({
  audit: await testEnv.MealPlannerDatabase.prepare(
    `SELECT runtime_stage, dispatch_id, conservative_charge_micro_usd,
            actual_cost_was_unknown, authority, created_at
       FROM pilot_provider_budget_reconciliations
      WHERE runtime_stage = 'pilot-gaia-118'
        AND dispatch_id = ?`
  )
    .bind(input.dispatchId)
    .first(),
  auditCount: await testEnv.MealPlannerDatabase.prepare(
    `SELECT COUNT(*) AS count
       FROM pilot_provider_budget_reconciliations
      WHERE runtime_stage = 'pilot-gaia-118'
        AND dispatch_id = ?`
  )
    .bind(input.dispatchId)
    .first(),
  dispatch: await testEnv.MealPlannerDatabase.prepare(
    `SELECT state, actual_cost_micro_usd, maximum_cost_micro_usd,
            provider_stage_id, run_id, created_at, updated_at,
            invocation_started_at, completed_at
       FROM pilot_provider_budget_dispatches
      WHERE runtime_stage = 'pilot-gaia-118'
        AND dispatch_id = ?`
  )
    .bind(input.dispatchId)
    .first(),
  ledger: await testEnv.MealPlannerDatabase.prepare(
    `SELECT state, budget_cap_micro_usd, settled_micro_usd,
            reserved_micro_usd, invoking_dispatch_id, poison_dispatch_id,
            updated_at
       FROM pilot_provider_stage_budget
      WHERE runtime_stage = 'pilot-gaia-118'`
  ).first(),
  recipeCount: await testEnv.MealPlannerDatabase.prepare(
    `SELECT COUNT(*) AS count
       FROM import_recipe_extractions
      WHERE import_id = ?`
  )
    .bind(input.importId)
    .first(),
  recovery: await testEnv.MealPlannerDatabase.prepare(
    `SELECT runtime_stage, import_id, acquisition_generation,
            original_dispatch_id, recovery_dispatch_id, created_at
       FROM pilot_provider_visual_recoveries
      WHERE runtime_stage = 'pilot-gaia-118'
        AND original_dispatch_id = ?`
  )
    .bind(input.dispatchId)
    .first(),
  recoveryCount: await testEnv.MealPlannerDatabase.prepare(
    `SELECT COUNT(*) AS count
       FROM pilot_provider_visual_recoveries
      WHERE runtime_stage = 'pilot-gaia-118'
        AND original_dispatch_id = ?`
  )
    .bind(input.dispatchId)
    .first(),
});

const readVisualCheckpointRepairProtectedRows = (input: {
  readonly acquisitionGeneration: number;
  readonly dispatchId: string;
  readonly importId: string;
}) =>
  Promise.all([
    testEnv.MealPlannerDatabase.prepare(
      `SELECT *
         FROM import_provider_terminal_checkpoints
        WHERE import_id = ?
          AND acquisition_generation = ?
          AND provider_stage = 'visual'
          AND ownership_id = ?`
    )
      .bind(input.importId, input.acquisitionGeneration, input.dispatchId)
      .first(),
    testEnv.MealPlannerDatabase.prepare(
      `SELECT *
         FROM recipe_imports
        WHERE id = ?
          AND acquisition_generation = ?`
    )
      .bind(input.importId, input.acquisitionGeneration)
      .first(),
    testEnv.MealPlannerDatabase.prepare(
      `SELECT *
         FROM import_transcriptions
        WHERE import_id = ?
          AND acquisition_generation = ?`
    )
      .bind(input.importId, input.acquisitionGeneration)
      .first(),
    testEnv.MealPlannerDatabase.prepare(
      `SELECT *
         FROM import_visual_evidence
        WHERE import_id = ?
          AND acquisition_generation = ?`
    )
      .bind(input.importId, input.acquisitionGeneration)
      .first(),
    testEnv.MealPlannerDatabase.prepare(
      `SELECT *
         FROM pilot_provider_stage_budget
        WHERE runtime_stage = 'pilot-gaia-118'`
    ).first(),
    testEnv.MealPlannerDatabase.prepare(
      `SELECT *
         FROM pilot_provider_budget_dispatches
        WHERE runtime_stage = 'pilot-gaia-118'
          AND dispatch_id = ?`
    )
      .bind(input.dispatchId)
      .first(),
    testEnv.MealPlannerDatabase.prepare(
      `SELECT *
         FROM pilot_provider_budget_reconciliations
        WHERE runtime_stage = 'pilot-gaia-118'
          AND dispatch_id = ?`
    )
      .bind(input.dispatchId)
      .first(),
    testEnv.MealPlannerDatabase.prepare(
      `SELECT *
         FROM import_recipe_extractions
        WHERE import_id = ?
          AND acquisition_generation = ?`
    )
      .bind(input.importId, input.acquisitionGeneration)
      .first(),
    testEnv.MealPlannerDatabase.prepare(
      `SELECT *
         FROM pilot_provider_visual_recoveries
        WHERE runtime_stage = 'pilot-gaia-118'
          AND original_dispatch_id = ?`
    )
      .bind(input.dispatchId)
      .first(),
    testEnv.MealPlannerDatabase.prepare(
      `SELECT *
         FROM pilot_provider_visual_second_recoveries
        WHERE runtime_stage = 'pilot-gaia-118'
          AND original_dispatch_id = ?`
    )
      .bind(input.dispatchId)
      .first(),
  ]);

const expectVisualCheckpointRepairRejected = async (
  seeded: Awaited<ReturnType<typeof seedMissingVisualTerminalCheckpoint>>,
  options: {
    readonly runtimeStage?: string;
    readonly status?: number;
    readonly token?: string;
  } = {}
) => {
  const evidenceBefore = await readPreservedVisualImport(seeded);
  const protectedRowsBefore =
    await readVisualCheckpointRepairProtectedRows(seeded);
  const stateBefore = await readVisualCheckpointRepairState(seeded);
  const app = await makeApp(options.runtimeStage ?? "pilot-gaia-118");

  const response = await postSettlement(
    app,
    visualCheckpointRepairCommandFor(seeded),
    options.token
  );

  expect(response.status).toBe(options.status ?? 409);
  await expect(readPreservedVisualImport(seeded)).resolves.toEqual(
    evidenceBefore
  );
  await expect(readVisualCheckpointRepairState(seeded)).resolves.toEqual(
    stateBefore
  );
  await expect(
    readVisualCheckpointRepairProtectedRows(seeded)
  ).resolves.toEqual(protectedRowsBefore);
};

const readRecipeCheckpointRepairProtectedRows = (input: {
  readonly acquisitionGeneration: number;
  readonly dispatchId: string;
  readonly importId: string;
}) =>
  Promise.all([
    testEnv.MealPlannerDatabase.prepare(
      `SELECT *
         FROM import_provider_terminal_checkpoints
        WHERE import_id = ?
          AND acquisition_generation = ?
          AND provider_stage = 'recipe'`
    )
      .bind(input.importId, input.acquisitionGeneration)
      .all()
      .then(readD1Results),
    testEnv.MealPlannerDatabase.prepare(
      `SELECT *
         FROM import_recipe_executor_terminal_checkpoints
        WHERE import_id = ? AND acquisition_generation = ?`
    )
      .bind(input.importId, input.acquisitionGeneration)
      .all()
      .then(readD1Results),
    testEnv.MealPlannerDatabase.prepare(
      `SELECT *
         FROM recipe_imports
        WHERE id = ? AND acquisition_generation = ?`
    )
      .bind(input.importId, input.acquisitionGeneration)
      .first(),
    testEnv.MealPlannerDatabase.prepare(
      `SELECT *
         FROM import_transcriptions
        WHERE import_id = ? AND acquisition_generation = ?`
    )
      .bind(input.importId, input.acquisitionGeneration)
      .all()
      .then(readD1Results),
    testEnv.MealPlannerDatabase.prepare(
      `SELECT *
         FROM import_recipe_extractions
        WHERE import_id = ? AND acquisition_generation = ?`
    )
      .bind(input.importId, input.acquisitionGeneration)
      .all()
      .then(readD1Results),
    testEnv.MealPlannerDatabase.prepare(
      `SELECT *
         FROM pilot_provider_stage_budget
        WHERE runtime_stage = 'pilot-gaia-118'`
    ).first(),
    testEnv.MealPlannerDatabase.prepare(
      `SELECT *
         FROM pilot_provider_budget_dispatches
        WHERE runtime_stage = 'pilot-gaia-118'
          AND dispatch_id = ?`
    )
      .bind(input.dispatchId)
      .first(),
    testEnv.MealPlannerDatabase.prepare(
      `SELECT *
         FROM pilot_provider_budget_reconciliations
        WHERE runtime_stage = 'pilot-gaia-118'
          AND dispatch_id = ?`
    )
      .bind(input.dispatchId)
      .first(),
    testEnv.MealPlannerDatabase.prepare(
      `SELECT *
         FROM pilot_provider_recipe_recovery_attempts
        WHERE runtime_stage = 'pilot-gaia-118'
          AND root_dispatch_id = ?`
    )
      .bind(input.dispatchId)
      .all()
      .then(readD1Results),
  ]);

const expectRecipeCheckpointRepairRejected = async (
  seeded: Awaited<ReturnType<typeof seedMissingRecipeTerminalCheckpoint>>,
  options: {
    readonly runtimeStage?: string;
    readonly status?: number;
    readonly token?: string;
  } = {}
) => {
  const before = await readRecipeCheckpointRepairProtectedRows(seeded);
  const app = await makeApp(options.runtimeStage ?? "pilot-gaia-118");

  const response = await postSettlement(
    app,
    recipeCheckpointRepairCommandFor(seeded),
    options.token
  );

  expect(response.status).toBe(options.status ?? 409);
  await expect(
    readRecipeCheckpointRepairProtectedRows(seeded)
  ).resolves.toEqual(before);
};

describe("authenticated terminal unknown-cost provider settlement", () => {
  it("charges the conservative maximum once and reopens only the stage ledger", async () => {
    const seeded = await seedPoisonedTerminalSpeechImport("000000000181");
    const before = await readPreservedImport(seeded);
    const app = await makeApp("pilot-gaia-118");

    const [first, replay] = await Promise.all([
      postSettlement(app, commandFor(seeded)),
      postSettlement(app, commandFor(seeded)),
    ]);

    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);
    const expected = {
      acquisitionGeneration: seeded.acquisitionGeneration,
      conservativeChargeMicroUsd: seeded.reservation.maximumCostMicroUsd,
      dispatchId: seeded.dispatchId,
      importId: seeded.importId,
      outcome: "terminal_unknown_cost_settled",
      runtimeStage: "pilot-gaia-118",
    };
    await expect(first.json()).resolves.toEqual(expected);
    await expect(replay.json()).resolves.toEqual(expected);

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
      settled_micro_usd: seeded.reservation.maximumCostMicroUsd,
      state: "open",
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
      conservative_charge_micro_usd: seeded.reservation.maximumCostMicroUsd,
    });
    await expect(readPreservedImport(seeded)).resolves.toEqual(before);
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
           FROM pilot_provider_budget_dispatches
          WHERE runtime_stage = 'pilot-gaia-118' AND run_id = ?`
      )
        .bind(seeded.reservation.runId)
        .first()
    ).resolves.toEqual({ count: 1 });
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT state, actual_cost_micro_usd
           FROM pilot_provider_budget_dispatches
          WHERE runtime_stage = 'pilot-gaia-118' AND dispatch_id = ?`
      )
        .bind(seeded.dispatchId)
        .first()
    ).resolves.toEqual({
      actual_cost_micro_usd: null,
      state: "settled_unknown",
    });
  });

  it("prepares and activates one exact speech recovery across concurrent authenticated replays", async () => {
    const seeded = await seedPoisonedTerminalSpeechImport("000000000180");
    let active = false;
    let restartCalls = 0;
    const app = await makeApp("pilot-gaia-118", {
      restartFromSpeech: () =>
        Effect.sync(() => {
          if (!active) {
            active = true;
            restartCalls += 1;
          }
        }),
    });
    const settled = await postSettlement(app, commandFor(seeded));
    expect(settled.status).toBe(200);

    const [first, replay] = await Promise.all([
      postSettlement(app, speechRecoveryCommandFor(seeded)),
      postSettlement(app, speechRecoveryCommandFor(seeded)),
    ]);

    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);
    const expected = {
      acquisitionGeneration: seeded.acquisitionGeneration,
      dispatchId: seeded.dispatchId,
      importId: seeded.importId,
      outcome: "speech_recovery_activated",
      recoveryDispatchId: `${seeded.dispatchId}:recovery:1`,
      runtimeStage: "pilot-gaia-118",
    };
    await expect(first.json()).resolves.toEqual(expected);
    await expect(replay.json()).resolves.toEqual(expected);
    expect(restartCalls).toBe(1);
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT dispatch_id, state
           FROM import_transcriptions
          WHERE import_id = ? AND acquisition_generation = ?`
      )
        .bind(seeded.importId, seeded.acquisitionGeneration)
        .first()
    ).resolves.toEqual({
      dispatch_id: `${seeded.dispatchId}:recovery:1`,
      state: "dispatching",
    });
  });

  it("reconciles a completed speech recovery after an ambiguous restart response", async () => {
    const seeded = await seedPoisonedTerminalSpeechImport("000000000176");
    const recoveryDispatchId = `${seeded.dispatchId}:recovery:1`;
    let restartCalls = 0;
    const app = await makeApp("pilot-gaia-118", {
      restartFromSpeech: () =>
        Effect.gen(function* completeBeforeLosingRestartResponse() {
          restartCalls += 1;
          const reservation = {
            dispatchId: decodeDispatchId(recoveryDispatchId),
            maximumCostMicroUsd: 50_000,
            providerStageId: decodeStageId("speech-transcription"),
            runId: decodeRunId(`recovery-run-${seeded.importId}`),
            timestamp: decodeBudgetTimestamp("2026-07-27T10:02:00.000Z"),
          };
          const budget = makeD1PilotProviderBudgetRepository(
            testEnv.MealPlannerDatabase,
            "pilot-gaia-118"
          );
          yield* budget.reserve(reservation).pipe(Effect.orDie);
          yield* budget.beginInvocation(reservation).pipe(Effect.orDie);
          yield* budget
            .settleKnown({ ...reservation, actualCostMicroUsd: 10 })
            .pipe(Effect.orDie);
          yield* makeD1SpeechTranscriptionRepository(
            testEnv.MealPlannerDatabase
          )
            .complete({
              completedAt: decodeImportTimestamp("2026-07-27T10:02:00.000Z"),
              cost: {
                certainty: "known",
                currency: "USD",
                estimatedMicroUsd: 10,
              },
              detectedLanguage: "en",
              dispatchId: recoveryDispatchId,
              generation: seeded.acquisitionGeneration,
              importId: seeded.importId,
              model: "installed-test-model",
              provider: "installed-test-provider",
              segmentsCount: 1,
              sourceMediaSha256: "a".repeat(64),
              transcriptKey: `imports/${seeded.importId}/transcription/v1/generations/${seeded.acquisitionGeneration}/transcript.json`,
              transcriptSha256: "b".repeat(64),
              usage: {
                audioDurationMilliseconds: 1,
                inputBytes: 1,
              },
            })
            .pipe(Effect.orDie);
          return yield* Effect.fail(workflowStartUnavailable());
        }),
    });
    const settlement = await postSettlement(app, commandFor(seeded));
    expect(settlement.status).toBe(200);

    const activation = await postSettlement(
      app,
      speechRecoveryCommandFor(seeded)
    );
    expect(activation.status).toBe(200);
    const expected = {
      acquisitionGeneration: seeded.acquisitionGeneration,
      dispatchId: seeded.dispatchId,
      importId: seeded.importId,
      outcome: "speech_recovery_activated",
      recoveryDispatchId,
      runtimeStage: "pilot-gaia-118",
    };
    await expect(activation.json()).resolves.toEqual(expected);
    expect(restartCalls).toBe(1);

    const appWithoutStarter = await makeApp("pilot-gaia-118");
    const replayWithoutStarter = await postSettlement(
      appWithoutStarter,
      speechRecoveryCommandFor(seeded)
    );
    expect(replayWithoutStarter.status).toBe(200);
    await expect(replayWithoutStarter.json()).resolves.toEqual(expected);
    expect(restartCalls).toBe(1);
  });

  it("does not invoke the retained workflow for unauthenticated or mismatched speech recovery authority", async () => {
    const seeded = await seedPoisonedTerminalSpeechImport("000000000179");
    let restartCalls = 0;
    const app = await makeApp("pilot-gaia-118", {
      restartFromSpeech: () =>
        Effect.sync(() => {
          restartCalls += 1;
        }),
    });
    const settlement = await postSettlement(app, commandFor(seeded));
    expect(settlement.status).toBe(200);

    const unauthenticated = await postSettlement(
      app,
      speechRecoveryCommandFor(seeded),
      "wrong"
    );
    const wrongDispatch = await postSettlement(app, {
      ...speechRecoveryCommandFor(seeded),
      dispatchId: decodeDispatchId(`${seeded.dispatchId}:wrong`),
    });
    const wrongGeneration = await postSettlement(app, {
      ...speechRecoveryCommandFor(seeded),
      acquisitionGeneration: decodeGeneration(2),
    });

    expect(unauthenticated.status).toBe(401);
    expect(wrongDispatch.status).toBe(409);
    expect(wrongGeneration.status).toBe(409);
    expect(restartCalls).toBe(0);
  });

  it("fails closed without another restart after the speech recovery itself is terminal", async () => {
    const seeded = await seedPoisonedTerminalSpeechImport("000000000178");
    let restartCalls = 0;
    const app = await makeApp("pilot-gaia-118", {
      restartFromSpeech: () =>
        Effect.sync(() => {
          restartCalls += 1;
        }),
    });
    const settlement = await postSettlement(app, commandFor(seeded));
    expect(settlement.status).toBe(200);
    const activation = await postSettlement(
      app,
      speechRecoveryCommandFor(seeded)
    );
    expect(activation.status).toBe(200);
    await testEnv.MealPlannerDatabase.batch([
      testEnv.MealPlannerDatabase.prepare(
        `UPDATE import_transcriptions
            SET state = 'failed',
                failure_code = 'transcription_failed',
                completed_at = '2026-07-27T10:02:00.000Z',
                updated_at = '2026-07-27T10:02:00.000Z'
          WHERE import_id = ?
            AND acquisition_generation = ?
            AND dispatch_id = ?`
      ).bind(
        seeded.importId,
        seeded.acquisitionGeneration,
        `${seeded.dispatchId}:recovery:1`
      ),
      testEnv.MealPlannerDatabase.prepare(
        `UPDATE recipe_imports
            SET status = 'failed',
                status_code = 'transcription_failed',
                recovery_action = 'retry_later',
                updated_at = '2026-07-27T10:02:00.000Z'
          WHERE id = ? AND acquisition_generation = ?`
      ).bind(seeded.importId, seeded.acquisitionGeneration),
    ]);

    const terminalReplay = await postSettlement(
      app,
      speechRecoveryCommandFor(seeded)
    );

    expect(terminalReplay.status).toBe(409);
    expect(restartCalls).toBe(1);
  });

  it("fails closed before service execution for unauthenticated callers", async () => {
    const seeded = await seedPoisonedTerminalSpeechImport("000000000182");
    const before = await readPreservedImport(seeded);
    const app = await makeApp("pilot-gaia-118");

    const response = await postSettlement(app, commandFor(seeded), "wrong");

    expect(response.status).toBe(401);
    await expect(readPreservedImport(seeded)).resolves.toEqual(before);
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT state, poison_dispatch_id
           FROM pilot_provider_stage_budget
          WHERE runtime_stage = 'pilot-gaia-118'`
      ).first()
    ).resolves.toEqual({
      poison_dispatch_id: seeded.dispatchId,
      state: "poisoned",
    });
  });

  it.each([
    [
      "wrong runtime stage",
      "000000000183",
      "production",
      true,
      "speech-transcription",
    ],
    [
      "missing terminal checkpoint",
      "000000000184",
      "pilot-gaia-118",
      false,
      "speech-transcription",
    ],
    [
      "wrong provider-stage ownership",
      "000000000185",
      "pilot-gaia-118",
      true,
      "visual-evidence",
    ],
  ] as const)(
    "preserves the poison and terminal import for %s",
    async (_name, suffix, runtimeStage, persistCheckpoint, providerStageId) => {
      const seeded = await seedPoisonedTerminalSpeechImport(suffix, {
        persistCheckpoint,
        providerStageId,
      });
      const before = await readPreservedImport(seeded);
      const app = await makeApp(runtimeStage);

      const response = await postSettlement(app, commandFor(seeded));

      expect(response.status).toBe(409);
      await expect(readPreservedImport(seeded)).resolves.toEqual(before);
      await expect(
        testEnv.MealPlannerDatabase.prepare(
          `SELECT state, poison_dispatch_id, reserved_micro_usd
             FROM pilot_provider_stage_budget
            WHERE runtime_stage = 'pilot-gaia-118'`
        ).first()
      ).resolves.toEqual({
        poison_dispatch_id: seeded.dispatchId,
        reserved_micro_usd: seeded.reservation.maximumCostMicroUsd,
        state: "poisoned",
      });
      await expect(
        testEnv.MealPlannerDatabase.prepare(
          `SELECT COUNT(*) AS count
             FROM pilot_provider_budget_reconciliations
            WHERE runtime_stage = 'pilot-gaia-118' AND dispatch_id = ?`
        )
          .bind(seeded.dispatchId)
          .first()
      ).resolves.toEqual({ count: 0 });
    }
  );

  it("rejects mismatched import ownership and an invoking stage", async () => {
    const seeded = await seedPoisonedTerminalSpeechImport("000000000186");
    const otherImportId = decodeImportId(
      "00000000-0000-4000-8000-000000000187"
    );
    const app = await makeApp("pilot-gaia-118");

    const mismatch = await postSettlement(app, {
      ...commandFor(seeded),
      importId: otherImportId,
    });
    expect(mismatch.status).toBe(409);

    await testEnv.MealPlannerDatabase.prepare(
      `UPDATE pilot_provider_stage_budget
          SET state = 'invoking',
              invoking_dispatch_id = poison_dispatch_id,
              poison_dispatch_id = NULL
        WHERE runtime_stage = 'pilot-gaia-118'
          AND state = 'poisoned'`
    ).run();
    const invoking = await postSettlement(app, commandFor(seeded));
    expect(invoking.status).toBe(409);
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT state, invoking_dispatch_id, poison_dispatch_id
           FROM pilot_provider_stage_budget
          WHERE runtime_stage = 'pilot-gaia-118'`
      ).first()
    ).resolves.toEqual({
      invoking_dispatch_id: seeded.dispatchId,
      poison_dispatch_id: null,
      state: "invoking",
    });
  });

  it("reopens a fully charged ledger at the exact cap without retrying", async () => {
    await testEnv.MealPlannerDatabase.prepare(
      `UPDATE pilot_provider_stage_budget
          SET settled_micro_usd = 9950000
        WHERE runtime_stage = 'pilot-gaia-118'`
    ).run();
    const seeded = await seedPoisonedTerminalSpeechImport("000000000188");
    const before = await readPreservedImport(seeded);
    const app = await makeApp("pilot-gaia-118");

    const response = await postSettlement(app, commandFor(seeded));

    expect(response.status).toBe(200);
    await expect(readPreservedImport(seeded)).resolves.toEqual(before);
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
      settled_micro_usd: 10_000_000,
      state: "open",
    });
  });
});

describe("authenticated visual terminal checkpoint compatibility repair", () => {
  it("atomically inserts one immutable matching checkpoint without changing terminal evidence or budget state", async () => {
    const seeded = await seedMissingVisualTerminalCheckpoint("000000000313");
    const evidenceBefore = await readPreservedVisualImport(seeded);
    const stateBefore = await readVisualCheckpointRepairState(seeded);
    const app = await makeApp("pilot-gaia-118");

    const responses = await Promise.all([
      postSettlement(app, visualCheckpointRepairCommandFor(seeded)),
      postSettlement(app, visualCheckpointRepairCommandFor(seeded)),
      postSettlement(app, visualCheckpointRepairCommandFor(seeded)),
    ]);

    expect(responses.map(({ status }) => status)).toEqual([200, 200, 200]);
    const expected = {
      acquisitionGeneration: seeded.acquisitionGeneration,
      dispatchId: seeded.dispatchId,
      importId: seeded.importId,
      outcome: "visual_terminal_checkpoint_repaired",
      runtimeStage: "pilot-gaia-118",
    };
    await expect(
      Promise.all(responses.map((response) => response.json()))
    ).resolves.toEqual([expected, expected, expected]);
    await expect(readPreservedVisualImport(seeded)).resolves.toEqual({
      ...evidenceBefore,
      checkpoint: {
        completed_at: seeded.now,
        created_at: seeded.now,
        failure_code: "visual_extraction_failed",
        ownership_id: seeded.dispatchId,
        provider_stage: "visual",
      },
    });
    await expect(readVisualCheckpointRepairState(seeded)).resolves.toEqual(
      stateBefore
    );
    await expect(
      postSettlement(app, visualCheckpointRepairCommandFor(seeded))
    ).resolves.toHaveProperty("status", 200);
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT COUNT(*) AS count
           FROM import_provider_terminal_checkpoints
          WHERE import_id = ?
            AND acquisition_generation = ?
            AND provider_stage = 'visual'
            AND ownership_id = ?`
      )
        .bind(seeded.importId, seeded.acquisitionGeneration, seeded.dispatchId)
        .first()
    ).resolves.toEqual({ count: 1 });
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `UPDATE import_provider_terminal_checkpoints
            SET failure_code = 'outcome_unknown'
          WHERE import_id = ?
            AND acquisition_generation = ?
            AND provider_stage = 'visual'
            AND ownership_id = ?`
      )
        .bind(seeded.importId, seeded.acquisitionGeneration, seeded.dispatchId)
        .run()
    ).rejects.toThrow(/provider terminal checkpoint is immutable/u);
  });

  it.each([
    [
      "a noncanonical maximum",
      "000000000314",
      { maximumCostMicroUsd: 100_001 },
    ],
    [
      "a nonvisual provider stage",
      "000000000315",
      { providerStageId: "recipe-extraction" },
    ],
    ["a foreign run", "000000000316", { runId: "gaia-118:foreign-import" }],
    [
      "an ambiguous visual sibling",
      "000000000317",
      { additionalVisualDispatch: true },
    ],
    [
      "mismatched speech and visual source identity",
      "000000000318",
      { matchingSourceHash: false },
    ],
  ] as const)(
    "fails closed without a checkpoint or mutation for %s",
    async (_name, suffix, options) => {
      const seeded = await seedMissingVisualTerminalCheckpoint(suffix, options);

      await expectVisualCheckpointRepairRejected(seeded);
    }
  );

  it("rejects the wrong runtime stage, authentication, and exact ownership tuple", async () => {
    const seeded = await seedMissingVisualTerminalCheckpoint("000000000319");
    const evidenceBefore = await readPreservedVisualImport(seeded);
    const stateBefore = await readVisualCheckpointRepairState(seeded);
    const app = await makeApp("pilot-gaia-118");

    const [unauthenticated, wrongImport, wrongGeneration, wrongDispatch] =
      await Promise.all([
        postSettlement(app, visualCheckpointRepairCommandFor(seeded), "wrong"),
        postSettlement(app, {
          ...visualCheckpointRepairCommandFor(seeded),
          importId: decodeImportId("00000000-0000-4000-8000-000000000320"),
        }),
        postSettlement(app, {
          ...visualCheckpointRepairCommandFor(seeded),
          acquisitionGeneration: decodeGeneration(2),
        }),
        postSettlement(app, {
          ...visualCheckpointRepairCommandFor(seeded),
          dispatchId: decodeDispatchId(`${seeded.dispatchId}:foreign`),
        }),
      ]);

    expect([
      unauthenticated.status,
      wrongImport.status,
      wrongGeneration.status,
      wrongDispatch.status,
    ]).toEqual([401, 409, 409, 409]);
    await expect(readPreservedVisualImport(seeded)).resolves.toEqual(
      evidenceBefore
    );
    await expect(readVisualCheckpointRepairState(seeded)).resolves.toEqual(
      stateBefore
    );

    await expectVisualCheckpointRepairRejected(seeded, {
      runtimeStage: "production",
    });
  });

  it.each([
    [
      "reserved amount drift",
      "000000000321",
      `UPDATE pilot_provider_stage_budget
          SET reserved_micro_usd = 100001
        WHERE runtime_stage = 'pilot-gaia-118'`,
    ],
    [
      "invoking state",
      "000000000322",
      `UPDATE pilot_provider_stage_budget
          SET state = 'invoking',
              invoking_dispatch_id = poison_dispatch_id,
              poison_dispatch_id = NULL
        WHERE runtime_stage = 'pilot-gaia-118'`,
    ],
    [
      "wrong poison ownership",
      "000000000323",
      `UPDATE pilot_provider_stage_budget
          SET state = 'open',
              reserved_micro_usd = 0,
              poison_dispatch_id = NULL
        WHERE runtime_stage = 'pilot-gaia-118'`,
    ],
  ] as const)(
    "rejects %s without changing any retained state",
    async (_name, suffix, mutation) => {
      const seeded = await seedMissingVisualTerminalCheckpoint(suffix);
      await testEnv.MealPlannerDatabase.prepare(mutation).run();

      await expectVisualCheckpointRepairRejected(seeded);
    }
  );

  it.each([
    [
      "nonterminal visual evidence",
      "000000000324",
      `UPDATE import_visual_evidence
          SET state = 'dispatching',
              failure_code = NULL,
              completed_at = NULL
        WHERE import_id = ? AND acquisition_generation = ?`,
    ],
    [
      "a noncanonical visual failure",
      "000000000325",
      `UPDATE import_visual_evidence
          SET failure_code = 'outcome_unknown'
        WHERE import_id = ? AND acquisition_generation = ?`,
    ],
    [
      "transcript evidence lineage drift",
      "000000000326",
      `UPDATE import_transcriptions
          SET transcript_key = transcript_key || '.foreign'
        WHERE import_id = ? AND acquisition_generation = ?`,
    ],
  ] as const)(
    "rejects %s without creating a checkpoint",
    async (_name, suffix, mutation) => {
      const seeded = await seedMissingVisualTerminalCheckpoint(suffix);
      await testEnv.MealPlannerDatabase.prepare(mutation)
        .bind(seeded.importId, seeded.acquisitionGeneration)
        .run();

      await expectVisualCheckpointRepairRejected(seeded);
    }
  );

  it("rejects any existing recipe descendant", async () => {
    const seeded = await seedMissingVisualTerminalCheckpoint("000000000327");
    await testEnv.MealPlannerDatabase.prepare(
      `INSERT INTO import_recipe_extractions (
         extraction_fingerprint, import_id, acquisition_generation,
         evidence_fingerprint, extractor_provider, extractor_model,
         extractor_version, state, created_at, updated_at
       ) VALUES (
         ?, ?, ?, ?, 'fixture-provider', 'fixture-model', 'fixture-v1',
         'dispatching', ?, ?
       )`
    )
      .bind(
        "d".repeat(64),
        seeded.importId,
        seeded.acquisitionGeneration,
        "e".repeat(64),
        seeded.now,
        seeded.now
      )
      .run();

    await expectVisualCheckpointRepairRejected(seeded);
  });

  it("rejects an existing visual recovery descendant without changing any protected row", async () => {
    const seeded = await seedMissingVisualTerminalCheckpoint("000000000329");
    await seedVisualRecoveryDescendant(seeded);

    await expectVisualCheckpointRepairRejected(seeded);
  });

  it("rejects existing reconciliation history without changing any protected row", async () => {
    const seeded = await seedMissingVisualTerminalCheckpoint("000000000330");
    await testEnv.MealPlannerDatabase.prepare(
      `INSERT INTO pilot_provider_budget_reconciliations (
         runtime_stage, dispatch_id, conservative_charge_micro_usd,
         actual_cost_was_unknown, authority, created_at
       ) VALUES (
         'pilot-gaia-118', ?, 100000, 1, 'authenticated_operator', ?
       )`
    )
      .bind(seeded.dispatchId, seeded.now)
      .run();

    await expectVisualCheckpointRepairRejected(seeded);
  });

  it("rejects a conflicting immutable checkpoint", async () => {
    const seeded = await seedMissingVisualTerminalCheckpoint("000000000328");
    await testEnv.MealPlannerDatabase.prepare(
      `UPDATE import_visual_evidence
          SET state = 'dispatching',
              failure_code = NULL,
              completed_at = NULL
        WHERE import_id = ? AND acquisition_generation = ?`
    )
      .bind(seeded.importId, seeded.acquisitionGeneration)
      .run();
    await testEnv.MealPlannerDatabase.prepare(
      `INSERT INTO import_provider_terminal_checkpoints (
         import_id, acquisition_generation, provider_stage, ownership_id,
         failure_code, completed_at, created_at
       ) VALUES (?, ?, 'visual', ?, 'outcome_unknown', ?, ?)`
    )
      .bind(
        seeded.importId,
        seeded.acquisitionGeneration,
        seeded.dispatchId,
        seeded.now,
        seeded.now
      )
      .run();
    await testEnv.MealPlannerDatabase.prepare(
      `UPDATE import_visual_evidence
          SET failure_code = 'visual_extraction_failed'
        WHERE import_id = ? AND acquisition_generation = ?`
    )
      .bind(seeded.importId, seeded.acquisitionGeneration)
      .run();

    await expectVisualCheckpointRepairRejected(seeded);
  });
});

describe("authenticated terminal visual unknown-cost reconciliation", () => {
  it("settles the canonical provider-unknown visual-failure pair without replaying", async () => {
    const seeded = await seedPoisonedTerminalVisualImport("000000000331", {
      terminalFailureCode: "outcome_unknown",
    });
    await testEnv.MealPlannerDatabase.prepare(
      `UPDATE import_visual_evidence
          SET failure_code = 'outcome_unknown'
        WHERE import_id = ? AND acquisition_generation = ?`
    )
      .bind(seeded.importId, seeded.acquisitionGeneration)
      .run();
    const before = await readPreservedVisualImport(seeded);
    const app = await makeApp("pilot-gaia-118");

    const response = await postSettlement(app, visualCommandFor(seeded));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      acquisitionGeneration: seeded.acquisitionGeneration,
      conservativeChargeMicroUsd: seeded.reservation.maximumCostMicroUsd,
      dispatchId: seeded.dispatchId,
      importId: seeded.importId,
      outcome: "visual_terminal_unknown_cost_settled",
      runtimeStage: "pilot-gaia-118",
    });
    await expect(readPreservedVisualImport(seeded)).resolves.toEqual(before);
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
      settled_micro_usd: seeded.reservation.maximumCostMicroUsd,
      state: "open",
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
      conservative_charge_micro_usd: seeded.reservation.maximumCostMicroUsd,
    });
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT state, actual_cost_micro_usd
           FROM pilot_provider_budget_dispatches
          WHERE runtime_stage = 'pilot-gaia-118' AND dispatch_id = ?`
      )
        .bind(seeded.dispatchId)
        .first()
    ).resolves.toEqual({
      actual_cost_micro_usd: null,
      state: "settled_unknown",
    });
  });

  it("preserves the accepted legacy provider-unknown visual-failure pair", async () => {
    const seeded = await seedPoisonedTerminalVisualImport("000000000332", {
      terminalFailureCode: "outcome_unknown",
    });
    await testEnv.MealPlannerDatabase.prepare(
      `UPDATE import_visual_evidence
          SET failure_code = 'visual_evidence_failed'
        WHERE import_id = ? AND acquisition_generation = ?`
    )
      .bind(seeded.importId, seeded.acquisitionGeneration)
      .run();
    const before = await readPreservedVisualImport(seeded);
    const app = await makeApp("pilot-gaia-118");

    const response = await postSettlement(app, visualCommandFor(seeded));

    expect(response.status).toBe(200);
    await expect(readPreservedVisualImport(seeded)).resolves.toEqual(before);
  });

  const visualFailureCodes = [
    "frame_evidence_failed",
    "frame_sampling_failed",
    "outcome_unknown",
    "source_evidence_invalid",
    "visual_evidence_failed",
    "visual_extraction_failed",
  ] as const satisfies readonly VisualEvidenceFailureCode[];
  const acceptedVisualSettlementPairs =
    new Set<`${VisualEvidenceFailureCode}:${VisualEvidenceFailureCode}`>([
      "outcome_unknown:outcome_unknown",
      "outcome_unknown:visual_evidence_failed",
      "visual_extraction_failed:visual_extraction_failed",
    ]);
  const rejectedVisualSettlementPairs = visualFailureCodes.flatMap(
    (checkpointFailureCode, checkpointIndex) =>
      visualFailureCodes.flatMap((projectionFailureCode, projectionIndex) => {
        const pair =
          `${checkpointFailureCode}:${projectionFailureCode}` as const;
        if (acceptedVisualSettlementPairs.has(pair)) {
          return [];
        }
        const suffix = String(
          333 + checkpointIndex * visualFailureCodes.length + projectionIndex
        ).padStart(12, "0");
        return [
          [checkpointFailureCode, projectionFailureCode, suffix] as const,
        ];
      })
  );

  it.each(rejectedVisualSettlementPairs)(
    "rejects the unsupported %s checkpoint and %s projection pair without mutation",
    async (checkpointFailureCode, projectionFailureCode, suffix) => {
      const seeded = await seedPoisonedTerminalVisualImport(suffix, {
        terminalFailureCode: checkpointFailureCode,
      });
      await testEnv.MealPlannerDatabase.prepare(
        `UPDATE import_visual_evidence
            SET failure_code = ?
          WHERE import_id = ? AND acquisition_generation = ?`
      )
        .bind(
          projectionFailureCode,
          seeded.importId,
          seeded.acquisitionGeneration
        )
        .run();
      const protectedRowsBefore =
        await readVisualCheckpointRepairProtectedRows(seeded);
      const app = await makeApp("pilot-gaia-118");

      const response = await postSettlement(app, visualCommandFor(seeded));

      expect(response.status).toBe(409);
      await expect(
        readVisualCheckpointRepairProtectedRows(seeded)
      ).resolves.toEqual(protectedRowsBefore);
    }
  );

  it("charges the exact visual maximum once, reopens the ledger, and preserves all terminal evidence", async () => {
    const seeded = await seedPoisonedTerminalVisualImport("000000000300");
    const before = await readPreservedVisualImport(seeded);
    const app = await makeApp("pilot-gaia-118");

    const [first, concurrent, replay] = await Promise.all([
      postSettlement(app, visualCommandFor(seeded)),
      postSettlement(app, visualCommandFor(seeded)),
      postSettlement(app, visualCommandFor(seeded)),
    ]);

    const expected = {
      acquisitionGeneration: seeded.acquisitionGeneration,
      conservativeChargeMicroUsd: seeded.reservation.maximumCostMicroUsd,
      dispatchId: seeded.dispatchId,
      importId: seeded.importId,
      outcome: "visual_terminal_unknown_cost_settled",
      runtimeStage: "pilot-gaia-118",
    };
    expect([first.status, concurrent.status, replay.status]).toEqual([
      200, 200, 200,
    ]);
    await expect(
      Promise.all([first.json(), concurrent.json(), replay.json()])
    ).resolves.toEqual([expected, expected, expected]);
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
      settled_micro_usd: seeded.reservation.maximumCostMicroUsd,
      state: "open",
    });
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT conservative_charge_micro_usd, actual_cost_was_unknown,
                authority, COUNT(*) AS count
           FROM pilot_provider_budget_reconciliations
          WHERE runtime_stage = 'pilot-gaia-118' AND dispatch_id = ?`
      )
        .bind(seeded.dispatchId)
        .first()
    ).resolves.toEqual({
      actual_cost_was_unknown: 1,
      authority: "authenticated_operator",
      conservative_charge_micro_usd: seeded.reservation.maximumCostMicroUsd,
      count: 1,
    });
    await expect(readPreservedVisualImport(seeded)).resolves.toEqual(before);
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT state, actual_cost_micro_usd, maximum_cost_micro_usd,
                provider_stage_id, run_id
           FROM pilot_provider_budget_dispatches
          WHERE runtime_stage = 'pilot-gaia-118' AND dispatch_id = ?`
      )
        .bind(seeded.dispatchId)
        .first()
    ).resolves.toEqual({
      actual_cost_micro_usd: null,
      maximum_cost_micro_usd: seeded.reservation.maximumCostMicroUsd,
      provider_stage_id: "visual-evidence",
      run_id: `gaia-118:${seeded.importId}`,
      state: "settled_unknown",
    });
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT COUNT(*) AS count
           FROM pilot_provider_budget_dispatches
          WHERE runtime_stage = 'pilot-gaia-118' AND run_id = ?`
      )
        .bind(`gaia-118:${seeded.importId}`)
        .first()
    ).resolves.toEqual({ count: 1 });
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT COUNT(*) AS count
           FROM pilot_provider_visual_recoveries
          WHERE runtime_stage = 'pilot-gaia-118'
            AND original_dispatch_id = ?`
      )
        .bind(seeded.dispatchId)
        .first()
    ).resolves.toEqual({ count: 0 });
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT COUNT(*) AS count
           FROM import_recipe_extractions
          WHERE import_id = ? AND acquisition_generation = ?`
      )
        .bind(seeded.importId, seeded.acquisitionGeneration)
        .first()
    ).resolves.toEqual({ count: 0 });
  });

  it.each([
    ["wrong runtime stage", "000000000301", "production", {}],
    [
      "missing terminal checkpoint",
      "000000000302",
      "pilot-gaia-118",
      { persistCheckpoint: false },
    ],
    [
      "wrong provider stage",
      "000000000303",
      "pilot-gaia-118",
      { providerStageId: "recipe-extraction" },
    ],
    [
      "wrong pilot run ownership",
      "000000000304",
      "pilot-gaia-118",
      { runId: "gaia-118:wrong-import" },
    ],
    [
      "ambiguous visual dispatch ownership",
      "000000000305",
      "pilot-gaia-118",
      { additionalVisualDispatch: true },
    ],
    [
      "mismatched speech and visual source identity",
      "000000000306",
      "pilot-gaia-118",
      { matchingSourceHash: false },
    ],
  ] as const)(
    "preserves the poison and writes no audit for %s",
    async (_name, suffix, runtimeStage, options) => {
      const seeded = await seedPoisonedTerminalVisualImport(suffix, options);
      const before = await readPreservedVisualImport(seeded);
      const app = await makeApp(runtimeStage);

      const response = await postSettlement(app, visualCommandFor(seeded));

      expect(response.status).toBe(409);
      await expect(readPreservedVisualImport(seeded)).resolves.toEqual(before);
      await expect(
        testEnv.MealPlannerDatabase.prepare(
          `SELECT state, poison_dispatch_id, invoking_dispatch_id,
                  reserved_micro_usd, settled_micro_usd
             FROM pilot_provider_stage_budget
            WHERE runtime_stage = 'pilot-gaia-118'`
        ).first()
      ).resolves.toEqual({
        invoking_dispatch_id: null,
        poison_dispatch_id: seeded.dispatchId,
        reserved_micro_usd: seeded.reservation.maximumCostMicroUsd,
        settled_micro_usd: 0,
        state: "poisoned",
      });
      await expect(
        testEnv.MealPlannerDatabase.prepare(
          `SELECT COUNT(*) AS count
             FROM pilot_provider_budget_reconciliations
            WHERE runtime_stage = 'pilot-gaia-118' AND dispatch_id = ?`
        )
          .bind(seeded.dispatchId)
          .first()
      ).resolves.toEqual({ count: 0 });
    }
  );

  it("rejects unauthenticated and mismatched visual authority before mutation", async () => {
    const seeded = await seedPoisonedTerminalVisualImport("000000000307");
    const before = await readPreservedVisualImport(seeded);
    const app = await makeApp("pilot-gaia-118");

    const unauthenticated = await postSettlement(
      app,
      visualCommandFor(seeded),
      "wrong"
    );
    const wrongImport = await postSettlement(app, {
      ...visualCommandFor(seeded),
      importId: decodeImportId("00000000-0000-4000-8000-000000000308"),
    });
    const wrongGeneration = await postSettlement(app, {
      ...visualCommandFor(seeded),
      acquisitionGeneration: decodeGeneration(2),
    });
    const wrongDispatch = await postSettlement(app, {
      ...visualCommandFor(seeded),
      dispatchId: decodeDispatchId(`${seeded.dispatchId}:wrong`),
    });

    expect(unauthenticated.status).toBe(401);
    expect(wrongImport.status).toBe(409);
    expect(wrongGeneration.status).toBe(409);
    expect(wrongDispatch.status).toBe(409);
    await expect(readPreservedVisualImport(seeded)).resolves.toEqual(before);
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT state, poison_dispatch_id, reserved_micro_usd
           FROM pilot_provider_stage_budget
          WHERE runtime_stage = 'pilot-gaia-118'`
      ).first()
    ).resolves.toEqual({
      poison_dispatch_id: seeded.dispatchId,
      reserved_micro_usd: seeded.reservation.maximumCostMicroUsd,
      state: "poisoned",
    });
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

  it("rejects mutable projection drift and an invoking stage without an audit", async () => {
    const projectionDrift =
      await seedPoisonedTerminalVisualImport("000000000309");
    await testEnv.MealPlannerDatabase.prepare(
      `UPDATE import_visual_evidence
          SET failure_code = 'outcome_unknown'
        WHERE import_id = ? AND acquisition_generation = ?`
    )
      .bind(projectionDrift.importId, projectionDrift.acquisitionGeneration)
      .run();
    const projectionBefore = await readPreservedVisualImport(projectionDrift);
    const app = await makeApp("pilot-gaia-118");

    const projectionResponse = await postSettlement(
      app,
      visualCommandFor(projectionDrift)
    );

    expect(projectionResponse.status).toBe(409);
    await expect(readPreservedVisualImport(projectionDrift)).resolves.toEqual(
      projectionBefore
    );
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT COUNT(*) AS count
           FROM pilot_provider_budget_reconciliations
          WHERE runtime_stage = 'pilot-gaia-118' AND dispatch_id = ?`
      )
        .bind(projectionDrift.dispatchId)
        .first()
    ).resolves.toEqual({ count: 0 });

    await testEnv.MealPlannerDatabase.prepare(
      `UPDATE pilot_provider_stage_budget
          SET state = 'invoking',
              invoking_dispatch_id = poison_dispatch_id,
              poison_dispatch_id = NULL
        WHERE runtime_stage = 'pilot-gaia-118'`
    ).run();
    const invokingResponse = await postSettlement(
      app,
      visualCommandFor(projectionDrift)
    );

    expect(invokingResponse.status).toBe(409);
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT state, invoking_dispatch_id, poison_dispatch_id,
                reserved_micro_usd
           FROM pilot_provider_stage_budget
          WHERE runtime_stage = 'pilot-gaia-118'`
      ).first()
    ).resolves.toEqual({
      invoking_dispatch_id: projectionDrift.dispatchId,
      poison_dispatch_id: null,
      reserved_micro_usd: projectionDrift.reservation.maximumCostMicroUsd,
      state: "invoking",
    });
  });

  it("preserves poison and evidence when the reservation has drifted", async () => {
    const seeded = await seedPoisonedTerminalVisualImport("000000000310");
    const before = await readPreservedVisualImport(seeded);
    await testEnv.MealPlannerDatabase.prepare(
      `UPDATE pilot_provider_stage_budget
          SET reserved_micro_usd = 100001
        WHERE runtime_stage = 'pilot-gaia-118'`
    ).run();
    const ledgerBefore = await testEnv.MealPlannerDatabase.prepare(
      `SELECT state, poison_dispatch_id, invoking_dispatch_id,
              reserved_micro_usd, settled_micro_usd
         FROM pilot_provider_stage_budget
        WHERE runtime_stage = 'pilot-gaia-118'`
    ).first();
    const app = await makeApp("pilot-gaia-118");

    const response = await postSettlement(app, visualCommandFor(seeded));

    expect(response.status).toBe(409);
    await expect(readPreservedVisualImport(seeded)).resolves.toEqual(before);
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT state, poison_dispatch_id, invoking_dispatch_id,
                reserved_micro_usd, settled_micro_usd
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
        .bind(seeded.dispatchId)
        .first()
    ).resolves.toEqual({ count: 0 });
  });

  it("charges at the exact stage cap without crossing it", async () => {
    const seeded = await seedPoisonedTerminalVisualImport("000000000311");
    const before = await readPreservedVisualImport(seeded);
    await testEnv.MealPlannerDatabase.prepare(
      `UPDATE pilot_provider_stage_budget
          SET settled_micro_usd = 9900000
        WHERE runtime_stage = 'pilot-gaia-118'`
    ).run();
    const app = await makeApp("pilot-gaia-118");

    const response = await postSettlement(app, visualCommandFor(seeded));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      acquisitionGeneration: seeded.acquisitionGeneration,
      conservativeChargeMicroUsd: seeded.reservation.maximumCostMicroUsd,
      dispatchId: seeded.dispatchId,
      importId: seeded.importId,
      outcome: "visual_terminal_unknown_cost_settled",
      runtimeStage: "pilot-gaia-118",
    });
    await expect(readPreservedVisualImport(seeded)).resolves.toEqual(before);
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT state, settled_micro_usd, reserved_micro_usd,
                poison_dispatch_id, invoking_dispatch_id,
                budget_cap_micro_usd
           FROM pilot_provider_stage_budget
          WHERE runtime_stage = 'pilot-gaia-118'`
      ).first()
    ).resolves.toEqual({
      budget_cap_micro_usd: 10_000_000,
      invoking_dispatch_id: null,
      poison_dispatch_id: null,
      reserved_micro_usd: 0,
      settled_micro_usd: 10_000_000,
      state: "open",
    });
  });

  it("does not consume a poison that already has reconciliation history", async () => {
    const seeded = await seedPoisonedTerminalVisualImport("000000000312");
    const before = await readPreservedVisualImport(seeded);
    await testEnv.MealPlannerDatabase.prepare(
      `INSERT INTO pilot_provider_budget_reconciliations (
         runtime_stage, dispatch_id, conservative_charge_micro_usd,
         actual_cost_was_unknown, authority, created_at
       ) VALUES (
         'pilot-gaia-118', ?, ?, 1, 'authenticated_operator',
         '2026-07-30T09:59:00.000Z'
       )`
    )
      .bind(seeded.dispatchId, seeded.reservation.maximumCostMicroUsd)
      .run();
    const app = await makeApp("pilot-gaia-118");

    const response = await postSettlement(app, visualCommandFor(seeded));

    expect(response.status).toBe(409);
    await expect(readPreservedVisualImport(seeded)).resolves.toEqual(before);
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT state, poison_dispatch_id, invoking_dispatch_id,
                reserved_micro_usd, settled_micro_usd
           FROM pilot_provider_stage_budget
          WHERE runtime_stage = 'pilot-gaia-118'`
      ).first()
    ).resolves.toEqual({
      invoking_dispatch_id: null,
      poison_dispatch_id: seeded.dispatchId,
      reserved_micro_usd: seeded.reservation.maximumCostMicroUsd,
      settled_micro_usd: 0,
      state: "poisoned",
    });
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT COUNT(*) AS count
           FROM pilot_provider_budget_reconciliations
          WHERE runtime_stage = 'pilot-gaia-118' AND dispatch_id = ?`
      )
        .bind(seeded.dispatchId)
        .first()
    ).resolves.toEqual({ count: 1 });
  });
});

describe("authenticated recipe executor terminal checkpoint repair", () => {
  it("atomically reconstructs one immutable executor checkpoint without clearing the poisoned budget", async () => {
    const seeded = await seedMissingRecipeTerminalCheckpoint("000000000401");
    const before = await readRecipeCheckpointRepairProtectedRows(seeded);
    const app = await makeApp("pilot-gaia-118");

    const responses = await Promise.all([
      postSettlement(app, recipeCheckpointRepairCommandFor(seeded)),
      postSettlement(app, recipeCheckpointRepairCommandFor(seeded)),
      postSettlement(app, recipeCheckpointRepairCommandFor(seeded)),
    ]);

    expect(responses.map(({ status }) => status)).toEqual([200, 200, 200]);
    const expected = {
      acquisitionGeneration: seeded.acquisitionGeneration,
      dispatchId: seeded.dispatchId,
      importId: seeded.importId,
      outcome: "recipe_terminal_checkpoint_repaired",
      runtimeStage: "pilot-gaia-118",
    };
    await expect(
      Promise.all(responses.map((response) => response.json()))
    ).resolves.toEqual([expected, expected, expected]);
    const after = await readRecipeCheckpointRepairProtectedRows(seeded);
    expect(after.slice(2)).toEqual(before.slice(2));
    expect(after[0]).toEqual([
      expect.objectContaining({
        acquisition_generation: seeded.acquisitionGeneration,
        completed_at: seeded.now,
        created_at: seeded.now,
        failure_code: "outcome_unknown",
        import_id: seeded.importId,
        ownership_id: seeded.extractionFingerprint,
        provider_stage: "recipe",
      }),
    ]);
    expect(after[1]).toEqual([
      expect.objectContaining({
        acquisition_generation: seeded.acquisitionGeneration,
        checkpointed_at: seeded.now,
        import_id: seeded.importId,
        ownership_id: seeded.extractionFingerprint,
      }),
    ]);
    await expect(
      postSettlement(app, recipeCheckpointRepairCommandFor(seeded))
    ).resolves.toHaveProperty("status", 200);
  });

  it.each([
    [
      "a noncanonical maximum",
      "000000000402",
      { maximumCostMicroUsd: 100_001 },
    ],
    [
      "a nonrecipe provider stage",
      "000000000403",
      { providerStageId: "visual-evidence" },
    ],
    ["a foreign run", "000000000404", { runId: "gaia-118:foreign-import" }],
    [
      "an ambiguous recipe dispatch",
      "000000000405",
      { additionalRecipeDispatch: true },
    ],
  ] as const)(
    "fails closed without provider or executor checkpoint evidence for %s",
    async (_name, suffix, options) => {
      const seeded = await seedMissingRecipeTerminalCheckpoint(suffix, options);

      await expectRecipeCheckpointRepairRejected(seeded);
    }
  );

  it("rejects wrong authentication, runtime stage, and exact ownership tuple", async () => {
    const seeded = await seedMissingRecipeTerminalCheckpoint("000000000406");
    await expectRecipeCheckpointRepairRejected(seeded, {
      status: 401,
      token: "wrong",
    });
    await expectRecipeCheckpointRepairRejected(seeded, {
      runtimeStage: "production",
    });
    const before = await readRecipeCheckpointRepairProtectedRows(seeded);
    const app = await makeApp("pilot-gaia-118");
    const response = await postSettlement(app, {
      ...recipeCheckpointRepairCommandFor(seeded),
      dispatchId: decodeDispatchId(`${seeded.dispatchId}:foreign`),
    });
    expect(response.status).toBe(409);
    await expect(
      readRecipeCheckpointRepairProtectedRows(seeded)
    ).resolves.toEqual(before);
  });

  it.each([
    [
      "parent status drift",
      "000000000407",
      `UPDATE recipe_imports
          SET status = 'queued',
              evidence_references_json = '[]'
        WHERE id = ? AND acquisition_generation = ?`,
    ],
    [
      "nonterminal extraction state",
      "000000000408",
      `UPDATE import_recipe_extractions
          SET state = 'dispatching',
              failure_code = NULL,
              completed_at = NULL
        WHERE import_id = ? AND acquisition_generation = ?`,
    ],
    [
      "already-reconciled dispatch",
      "000000000409",
      `INSERT INTO pilot_provider_budget_reconciliations (
         runtime_stage, dispatch_id, conservative_charge_micro_usd,
         actual_cost_was_unknown, authority, created_at
       ) SELECT 'pilot-gaia-118', ?, 100000, 1,
                'authenticated_operator', ?
          FROM recipe_imports
         WHERE id = ? AND acquisition_generation = ?`,
    ],
  ] as const)(
    "rejects %s without partial repair",
    async (_name, suffix, mutation) => {
      const seeded = await seedMissingRecipeTerminalCheckpoint(suffix);
      const values = mutation.startsWith("INSERT")
        ? [
            seeded.dispatchId,
            seeded.now,
            seeded.importId,
            seeded.acquisitionGeneration,
          ]
        : [seeded.importId, seeded.acquisitionGeneration];
      await testEnv.MealPlannerDatabase.prepare(mutation)
        .bind(...values)
        .run();

      await expectRecipeCheckpointRepairRejected(seeded);
    }
  );

  it("rejects multiple recipe extractions without partial repair", async () => {
    const seeded = await seedMissingRecipeTerminalCheckpoint("000000000410");
    await testEnv.MealPlannerDatabase.prepare(
      `INSERT INTO import_recipe_extractions (
         extraction_fingerprint, import_id, acquisition_generation,
         evidence_fingerprint, extractor_provider, extractor_model,
         extractor_version, state, failure_code, created_at, updated_at,
         completed_at
       ) VALUES (?, ?, ?, ?, 'fixture-provider', 'fixture-model',
                 'fixture-v1', 'failed', 'provider_error', ?, ?, ?)`
    )
      .bind(
        "e".repeat(64),
        seeded.importId,
        seeded.acquisitionGeneration,
        "f".repeat(64),
        seeded.now,
        seeded.now,
        seeded.now
      )
      .run();

    await expectRecipeCheckpointRepairRejected(seeded);
  });
});

describe("authenticated terminal recipe unknown-cost reconciliation", () => {
  it("charges the exact recipe maximum once, reopens the ledger, and preserves the terminal import", async () => {
    const seeded = await seedPoisonedTerminalRecipeImport("000000000216");
    const app = await makeApp("pilot-gaia-118");
    const before = {
      checkpoint: await testEnv.MealPlannerDatabase.prepare(
        `SELECT provider_stage, ownership_id, failure_code, completed_at
           FROM import_provider_terminal_checkpoints
          WHERE import_id = ? AND acquisition_generation = ?`
      )
        .bind(seeded.importId, seeded.acquisitionGeneration)
        .first(),
      extraction: await testEnv.MealPlannerDatabase.prepare(
        `SELECT state, failure_code, completed_at, updated_at
           FROM import_recipe_extractions
          WHERE extraction_fingerprint = ?`
      )
        .bind(seeded.extractionFingerprint)
        .first(),
      import: await testEnv.MealPlannerDatabase.prepare(
        `SELECT status, status_code, recovery_action,
                evidence_references_json, updated_at
           FROM recipe_imports
          WHERE id = ?`
      )
        .bind(seeded.importId)
        .first(),
    };

    const [first, replay] = await Promise.all([
      postSettlement(app, recipeCommandFor(seeded)),
      postSettlement(app, recipeCommandFor(seeded)),
    ]);

    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);
    const expected = {
      acquisitionGeneration: seeded.acquisitionGeneration,
      conservativeChargeMicroUsd: 100_000,
      dispatchId: seeded.dispatchId,
      importId: seeded.importId,
      outcome: "recipe_terminal_unknown_cost_settled",
      runtimeStage: "pilot-gaia-118",
    };
    await expect(first.json()).resolves.toEqual(expected);
    await expect(replay.json()).resolves.toEqual(expected);
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
      settled_micro_usd: 100_000,
      state: "open",
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
      conservative_charge_micro_usd: 100_000,
    });
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT state, actual_cost_micro_usd, maximum_cost_micro_usd,
                provider_stage_id
           FROM pilot_provider_budget_dispatches
          WHERE runtime_stage = 'pilot-gaia-118' AND dispatch_id = ?`
      )
        .bind(seeded.dispatchId)
        .first()
    ).resolves.toEqual({
      actual_cost_micro_usd: null,
      maximum_cost_micro_usd: 100_000,
      provider_stage_id: "recipe-extraction",
      state: "settled_unknown",
    });
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT COUNT(*) AS count
           FROM pilot_provider_budget_dispatches
          WHERE runtime_stage = 'pilot-gaia-118' AND run_id = ?`
      )
        .bind(seeded.reservation.runId)
        .first()
    ).resolves.toEqual({ count: 3 });
    await expect(
      Promise.all([
        testEnv.MealPlannerDatabase.prepare(
          `SELECT provider_stage, ownership_id, failure_code, completed_at
             FROM import_provider_terminal_checkpoints
            WHERE import_id = ? AND acquisition_generation = ?`
        )
          .bind(seeded.importId, seeded.acquisitionGeneration)
          .first(),
        testEnv.MealPlannerDatabase.prepare(
          `SELECT state, failure_code, completed_at, updated_at
             FROM import_recipe_extractions
            WHERE extraction_fingerprint = ?`
        )
          .bind(seeded.extractionFingerprint)
          .first(),
        testEnv.MealPlannerDatabase.prepare(
          `SELECT status, status_code, recovery_action,
                  evidence_references_json, updated_at
             FROM recipe_imports
            WHERE id = ?`
        )
          .bind(seeded.importId)
          .first(),
      ])
    ).resolves.toEqual([before.checkpoint, before.extraction, before.import]);
  });

  it("rejects an ambiguous second recipe dispatch while preserving the poison", async () => {
    const seeded = await seedPoisonedTerminalRecipeImport("000000000224", {
      additionalRecipeDispatch: true,
    });
    const app = await makeApp("pilot-gaia-118");

    const response = await postSettlement(app, recipeCommandFor(seeded));

    expect(response.status).toBe(409);
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT state, poison_dispatch_id, reserved_micro_usd
           FROM pilot_provider_stage_budget
          WHERE runtime_stage = 'pilot-gaia-118'`
      ).first()
    ).resolves.toEqual({
      poison_dispatch_id: seeded.dispatchId,
      reserved_micro_usd: 100_000,
      state: "poisoned",
    });
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT COUNT(*) AS count
           FROM pilot_provider_budget_dispatches
          WHERE runtime_stage = 'pilot-gaia-118'
            AND run_id = ?
            AND provider_stage_id = 'recipe-extraction'`
      )
        .bind(seeded.reservation.runId)
        .first()
    ).resolves.toEqual({ count: 2 });
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT COUNT(*) AS count
           FROM pilot_provider_budget_reconciliations
          WHERE runtime_stage = 'pilot-gaia-118'
            AND dispatch_id = ?`
      )
        .bind(seeded.dispatchId)
        .first()
    ).resolves.toEqual({ count: 0 });
  });

  it.each([
    [
      "wrong runtime stage",
      "000000000217",
      "production",
      true,
      100_000,
      "recipe-extraction",
      undefined,
    ],
    [
      "missing terminal checkpoint",
      "000000000218",
      "pilot-gaia-118",
      false,
      100_000,
      "recipe-extraction",
      undefined,
    ],
    [
      "non-exact recipe maximum",
      "000000000219",
      "pilot-gaia-118",
      true,
      99_999,
      "recipe-extraction",
      undefined,
    ],
    [
      "wrong recipe provider stage",
      "000000000222",
      "pilot-gaia-118",
      true,
      100_000,
      "visual-evidence",
      undefined,
    ],
    [
      "wrong pilot run authority",
      "000000000223",
      "pilot-gaia-118",
      true,
      100_000,
      "recipe-extraction",
      "gaia-118:wrong-import",
    ],
  ] as const)(
    "preserves the poison and writes no audit for %s",
    async (
      _name,
      suffix,
      runtimeStage,
      persistCheckpoint,
      maximumCostMicroUsd,
      providerStageId,
      runId
    ) => {
      const seeded = await seedPoisonedTerminalRecipeImport(suffix, {
        maximumCostMicroUsd,
        persistCheckpoint,
        providerStageId,
        ...(runId === undefined ? {} : { runId }),
      });
      const app = await makeApp(runtimeStage);

      const response = await postSettlement(app, recipeCommandFor(seeded));

      expect(response.status).toBe(409);
      await expect(
        testEnv.MealPlannerDatabase.prepare(
          `SELECT state, poison_dispatch_id, reserved_micro_usd
             FROM pilot_provider_stage_budget
            WHERE runtime_stage = 'pilot-gaia-118'`
        ).first()
      ).resolves.toEqual({
        poison_dispatch_id: seeded.dispatchId,
        reserved_micro_usd: maximumCostMicroUsd,
        state: "poisoned",
      });
      await expect(
        testEnv.MealPlannerDatabase.prepare(
          `SELECT COUNT(*) AS count
             FROM pilot_provider_budget_reconciliations
            WHERE runtime_stage = 'pilot-gaia-118' AND dispatch_id = ?`
        )
          .bind(seeded.dispatchId)
          .first()
      ).resolves.toEqual({ count: 0 });
    }
  );

  it("rejects mismatched import ownership, unauthenticated access, and an invoking stage", async () => {
    const seeded = await seedPoisonedTerminalRecipeImport("000000000220");
    const app = await makeApp("pilot-gaia-118");

    const unauthenticated = await postSettlement(
      app,
      recipeCommandFor(seeded),
      "wrong"
    );
    expect(unauthenticated.status).toBe(401);
    const mismatched = await postSettlement(app, {
      ...recipeCommandFor(seeded),
      importId: decodeImportId("00000000-0000-4000-8000-000000000221"),
    });
    expect(mismatched.status).toBe(409);

    await testEnv.MealPlannerDatabase.prepare(
      `UPDATE pilot_provider_stage_budget
          SET state = 'invoking',
              invoking_dispatch_id = poison_dispatch_id,
              poison_dispatch_id = NULL
        WHERE runtime_stage = 'pilot-gaia-118'`
    ).run();
    const invoking = await postSettlement(app, recipeCommandFor(seeded));
    expect(invoking.status).toBe(409);
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT state, invoking_dispatch_id, poison_dispatch_id,
                reserved_micro_usd
           FROM pilot_provider_stage_budget
          WHERE runtime_stage = 'pilot-gaia-118'`
      ).first()
    ).resolves.toEqual({
      invoking_dispatch_id: seeded.dispatchId,
      poison_dispatch_id: null,
      reserved_micro_usd: 100_000,
      state: "invoking",
    });
  });
});

describe("authenticated expired recipe replay sweep", () => {
  it("rejects wrong authority and stage, then deletes only SQLite-expired rows", async () => {
    const expired = await seedRecipeReplayForSweep("0001");
    const atBoundary = await seedRecipeReplayForSweep("0002");
    const current = await seedRecipeReplayForSweep("0003");
    await setRecipeReplayExpiry(expired.dispatchId, "expired");
    await setRecipeReplayExpiry(atBoundary.dispatchId, "at_boundary");
    const command = { operation: "sweep_expired_recipe_replays" as const };

    const wrongAuth = await postSettlement(
      await makeApp("pilot-gaia-118"),
      command,
      "wrong"
    );
    expect(wrongAuth.status).toBe(401);
    const wrongStage = await postSettlement(
      await makeApp("production"),
      command
    );
    expect(wrongStage.status).toBe(409);
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT COUNT(*) AS count
           FROM pilot_provider_recipe_replay_values
          WHERE dispatch_id IN (?, ?, ?)`
      )
        .bind(expired.dispatchId, atBoundary.dispatchId, current.dispatchId)
        .first()
    ).resolves.toEqual({ count: 3 });

    const response = await postSettlement(
      await makeApp("pilot-gaia-118"),
      command
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      deletedCount: 2,
      outcome: "expired_recipe_replays_swept",
      runtimeStage: "pilot-gaia-118",
    });
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT dispatch_id, import_id, value_json
           FROM pilot_provider_recipe_replay_values
          WHERE dispatch_id IN (?, ?, ?)`
      )
        .bind(expired.dispatchId, atBoundary.dispatchId, current.dispatchId)
        .all()
    ).resolves.toMatchObject({
      results: [
        {
          dispatch_id: current.dispatchId,
          import_id: current.importId,
          value_json: '{"opaque":"recipe-replay"}',
        },
      ],
    });

    const replay = await postSettlement(
      await makeApp("pilot-gaia-118"),
      command
    );
    expect(replay.status).toBe(200);
    await expect(replay.json()).resolves.toMatchObject({ deletedCount: 0 });
  });
});

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
  const evidence = JSON.stringify([
    {
      kind: "original_media",
      referenceId: `imports/${importId}/acquisition/v1/generations/${acquisitionGeneration}/original.mp4`,
    },
    {
      kind: "acquisition_manifest",
      referenceId: `imports/${importId}/acquisition/v1/generations/${acquisitionGeneration}/manifest.json`,
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
      acquisitionGeneration,
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
  await testEnv.MealPlannerDatabase.prepare(
    `INSERT INTO recipe_imports (
       acquisition_generation, canonical_source_id, compatibility_fingerprint,
       created_at, evidence_references_json, id, recovery_action, source_kind,
       status, status_code, updated_at
     ) VALUES (?, ?, ?, ?, '[]', ?, NULL, 'tiktok_video', 'queued', NULL, ?)`
  )
    .bind(
      acquisitionGeneration,
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

const makeApp = async (runtimeStage: unknown) => {
  const authorizer = await Effect.runPromise(
    makeImportAuthorizer(Redacted.make("test-import-token"))
  );
  const service = makeD1ProviderTerminalSettlementService({
    database: testEnv.MealPlannerDatabase,
    now: () => decodeImportTimestamp("2026-07-27T10:01:00.000Z"),
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

const commandFor = (
  seeded: Awaited<ReturnType<typeof seedPoisonedTerminalSpeechImport>>
) => ({
  acquisitionGeneration: seeded.acquisitionGeneration,
  dispatchId: seeded.dispatchId,
  importId: seeded.importId,
});

const recipeCommandFor = (
  seeded: Awaited<ReturnType<typeof seedPoisonedTerminalRecipeImport>>
) => ({
  acquisitionGeneration: seeded.acquisitionGeneration,
  dispatchId: seeded.dispatchId,
  importId: seeded.importId,
  operation: "settle_recipe_unknown" as const,
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
         ?, ?, ?, '2026-08-05T18:00:00.000Z', 1, ?,
         'pilot-gaia-118', '{"opaque":"recipe-replay"}', ?
       )`
    ).bind(now, dispatchId, evidenceFingerprint, importId, "a".repeat(64)),
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

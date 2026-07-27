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

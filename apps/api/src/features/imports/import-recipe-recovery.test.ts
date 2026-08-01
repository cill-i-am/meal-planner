import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  PilotBudgetDispatchId,
  PilotProviderBudgetStage,
} from "../pilots/pilot-provider-budget.js";
import { AcquisitionGeneration } from "./import-media.model.js";
import { ImportCorrelationId } from "./import-observability.js";
import {
  makeRecipeRecoveryWorkflowStarter,
  recipeRecoveryExtractionFingerprint,
  recipeRecoveryResumeWorkflowInstanceId,
  recipeRecoveryWorkflowInstanceId,
} from "./import-recipe-recovery.js";
import type { RecipeRecovery } from "./import-recipe-recovery.js";
import { ImportId } from "./import.contracts.js";

const importId = Schema.decodeUnknownSync(ImportId)(
  "00000000-0000-4000-8000-000000000207"
);
const acquisitionGeneration = Schema.decodeUnknownSync(AcquisitionGeneration)(
  1
);
const originalDispatchId = Schema.decodeUnknownSync(PilotBudgetDispatchId)(
  `recipe:${importId}:${acquisitionGeneration}:${"a".repeat(64)}`
);
const recoveryDispatchId = Schema.decodeUnknownSync(PilotBudgetDispatchId)(
  `${originalDispatchId}:recovery:1`
);
const correlationId = Schema.decodeUnknownSync(ImportCorrelationId)(
  "00000000-0000-4000-8000-000000000208"
);

const recovery: RecipeRecovery = {
  acquisitionGeneration,
  evidenceFingerprint: "a".repeat(64),
  evidenceReferencesJson: "[]",
  importId,
  originalDispatchId,
  originalExtractionFingerprint: "b".repeat(64),
  recoveryDispatchId,
  recoveryExtractionFingerprint: "c".repeat(64),
  recoveryIdentity: "recovery:1",
  recoveryOrdinal: 1,
  runtimeStage: PilotProviderBudgetStage,
  transcriptSha256: "d".repeat(64),
  visualManifestSha256: "e".repeat(64),
};

const eighthRecovery: RecipeRecovery = {
  ...recovery,
  originalDispatchId: Schema.decodeUnknownSync(PilotBudgetDispatchId)(
    `${originalDispatchId}:recovery:7`
  ),
  recoveryDispatchId: Schema.decodeUnknownSync(PilotBudgetDispatchId)(
    `${originalDispatchId}:recovery:8`
  ),
  recoveryIdentity: "recovery:8",
  recoveryOrdinal: 8,
};

describe("recipe recovery authority", () => {
  it("derives a deterministic fingerprint distinct from the terminal attempt", async () => {
    const first = await Effect.runPromise(
      recipeRecoveryExtractionFingerprint(
        recovery.originalExtractionFingerprint
      )
    );
    const replay = await Effect.runPromise(
      recipeRecoveryExtractionFingerprint(
        recovery.originalExtractionFingerprint
      )
    );

    expect(first).toBe(replay);
    expect(first).toMatch(/^[a-f\d]{64}$/u);
    expect(first).not.toBe(recovery.originalExtractionFingerprint);
  });

  it("starts one opaque deterministic workflow and reconciles duplicate admission", async () => {
    const instanceId = recipeRecoveryWorkflowInstanceId(
      importId,
      acquisitionGeneration
    );
    let createCalls = 0;
    const batches: unknown[] = [];
    const instance = {
      status: () => Effect.succeed({ status: "running" }),
    };
    const starter = makeRecipeRecoveryWorkflowStarter(
      {
        createBatch: (batch) => {
          createCalls += 1;
          batches.push(batch);
          return Effect.succeed(createCalls === 1 ? [instance] : []);
        },
        get: (id) =>
          id === instanceId
            ? Effect.succeed(instance)
            : Effect.die("unexpected workflow identity"),
      },
      () => correlationId
    );

    await Promise.all([
      Effect.runPromise(starter.start(recovery)),
      Effect.runPromise(starter.start(recovery)),
    ]);

    expect(batches).toEqual([
      [
        {
          id: instanceId,
          params: {
            acquisitionGeneration,
            correlationId,
            importId,
            recoveryOrdinal: 1,
          },
        },
      ],
      [
        {
          id: instanceId,
          params: {
            acquisitionGeneration,
            correlationId,
            importId,
            recoveryOrdinal: 1,
          },
        },
      ],
    ]);
    expect(JSON.stringify(batches)).not.toMatch(
      /https?:|tiktok|transcript|prompt|cookie|credential/iu
    );
  });

  it("never restarts an errored recovery instance", async () => {
    const instance = {
      status: () => Effect.succeed({ status: "errored" }),
    };
    const starter = makeRecipeRecoveryWorkflowStarter(
      {
        createBatch: () => Effect.succeed([]),
        get: () => Effect.succeed(instance),
      },
      () => correlationId
    );

    const exit = await Effect.runPromiseExit(starter.start(recovery));

    expect(exit._tag).toBe("Failure");
  });

  it("resumes through one distinct deterministic workflow identity", async () => {
    const instanceId = recipeRecoveryResumeWorkflowInstanceId(
      importId,
      acquisitionGeneration,
      8
    );
    const batches: unknown[] = [];
    const instance = {
      status: () => Effect.succeed({ status: "running" }),
    };
    const starter = makeRecipeRecoveryWorkflowStarter(
      {
        createBatch: (batch) => {
          batches.push(batch);
          return Effect.succeed([instance]);
        },
        get: () => Effect.die("unexpected workflow reconciliation"),
      },
      () => correlationId
    );

    await Effect.runPromise(starter.resume(eighthRecovery));

    expect(batches).toEqual([
      [
        {
          id: instanceId,
          params: {
            acquisitionGeneration,
            correlationId,
            importId,
            recoveryOrdinal: 8,
            resumeOrdinal: 1,
          },
        },
      ],
    ]);
    expect(JSON.stringify(batches)).not.toMatch(
      /https?:|tiktok|transcript|prompt|cookie|credential/iu
    );
  });
});

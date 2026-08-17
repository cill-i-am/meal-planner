import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  PilotBudgetDispatchId,
  PilotProviderBudgetStage,
} from "../pilots/pilot-provider-budget.js";
import { AcquisitionGeneration, Sha256Hex } from "./import-media.model.js";
import { ImportCorrelationId } from "./import-observability.js";
import {
  makeRecipeRecoveryWorkflowStarter,
  recipeRecoveryAuthorizationEventType,
  recipeRecoveryExtractionFingerprint,
  recipeRecoveryWorkflowInstanceId,
  resolveRecipeRecoveryWorkflowInput,
} from "./import-recipe-recovery.js";
import type {
  RecipeRecoveryAttempt,
  RecipeRecoveryOrdinal,
} from "./import-recipe-recovery.js";
import { ImportId, ImportTimestamp } from "./import.contracts.js";

const importId = Schema.decodeUnknownSync(ImportId)(
  "00000000-0000-4000-8000-000000000207"
);
const acquisitionGeneration = Schema.decodeUnknownSync(AcquisitionGeneration)(
  1
);
const rootDispatchId = Schema.decodeUnknownSync(PilotBudgetDispatchId)(
  `recipe:${importId}:${acquisitionGeneration}:${"a".repeat(64)}`
);
const correlationId = Schema.decodeUnknownSync(ImportCorrelationId)(
  "00000000-0000-4000-8000-000000000208"
);
const timestamp = Schema.decodeUnknownSync(ImportTimestamp)(
  "2026-08-16T00:00:00.000Z"
);
const sha = (value: string) => Schema.decodeUnknownSync(Sha256Hex)(value);

const attempt = (ordinal: RecipeRecoveryOrdinal): RecipeRecoveryAttempt => {
  const predecessorOrdinal = Math.max(ordinal - 1, 0);
  const predecessorDispatchId = Schema.decodeUnknownSync(PilotBudgetDispatchId)(
    predecessorOrdinal === 0
      ? rootDispatchId
      : `${rootDispatchId}:recovery:${predecessorOrdinal}`
  );
  return {
    acquisitionGeneration,
    createdAt: timestamp,
    currentDispatchId: Schema.decodeUnknownSync(PilotBudgetDispatchId)(
      `${rootDispatchId}:recovery:${ordinal}`
    ),
    currentExtractionFingerprint: sha(String(ordinal).repeat(64)),
    evidenceFingerprint: sha("a".repeat(64)),
    evidenceReferencesJson: JSON.stringify(["source", "transcript", "visual"]),
    importId,
    ordinal,
    predecessorDispatchId,
    predecessorExtractionFingerprint: sha("b".repeat(64)),
    predecessorOutcome: "outcome_unknown",
    predecessorReconciliationCreatedAt: timestamp,
    rootDispatchId,
    rootExtractionFingerprint: sha("b".repeat(64)),
    runtimeStage: PilotProviderBudgetStage,
    sourceMediaSha256: sha("e".repeat(64)),
    terminalCheckpointCompletedAt: timestamp,
    transcriptSha256: sha("c".repeat(64)),
    visualManifestSha256: sha("d".repeat(64)),
  };
};

const instance = (status: string, calls: string[]) => ({
  restart: () => Effect.sync(() => calls.push("restart")).pipe(Effect.asVoid),
  sendEvent: (event: { readonly type: string }) =>
    Effect.sync(() => calls.push(event.type)).pipe(Effect.asVoid),
  status: () => Effect.succeed({ status }),
});

describe("recipe recovery workflow authority", () => {
  it("derives stable ordinal-specific extraction identities", async () => {
    const predecessor = sha("b".repeat(64));
    const first = await Effect.runPromise(
      recipeRecoveryExtractionFingerprint(predecessor, 1)
    );
    const replay = await Effect.runPromise(
      recipeRecoveryExtractionFingerprint(predecessor, 1)
    );
    const second = await Effect.runPromise(
      recipeRecoveryExtractionFingerprint(predecessor, 2)
    );

    expect(first).toBe(replay);
    expect(first).toBe(
      "195e758f714a2418952cdc6d846ba70f63137be6c0629f615b47eb2278ab8f6b"
    );
    expect(second).not.toBe(first);
  });

  it("creates one workflow identity for the D1 cursor", async () => {
    const batches: unknown[] = [];
    const starter = makeRecipeRecoveryWorkflowStarter({
      createBatch: (batch) => {
        batches.push(batch);
        return Effect.succeed([instance("running", [])]);
      },
      get: () => Effect.die("unexpected reconciliation"),
    });

    await Effect.runPromise(starter.start(attempt(1), { correlationId }));

    expect(batches).toEqual([
      [
        {
          id: recipeRecoveryWorkflowInstanceId(importId, acquisitionGeneration),
          params: {
            acquisitionGeneration,
            attemptOrdinal: 1,
            importId,
            trace: { correlationId },
          },
        },
      ],
    ]);
  });

  it("preserves the exact current durable recovery input", async () => {
    const input = {
      acquisitionGeneration,
      attemptOrdinal: 1 as const,
      importId,
      trace: { correlationId },
    };
    await expect(
      Effect.runPromise(resolveRecipeRecoveryWorkflowInput(input))
    ).resolves.toEqual(input);
  });

  it("rejects malformed recovery context before downstream acquisition and redacts it", async () => {
    const exit = await Effect.runPromiseExit(
      resolveRecipeRecoveryWorkflowInput({
        acquisitionGeneration,
        attemptOrdinal: 1,
        importId,
        trace: {
          correlationId,
          sourceUrl: "https://private.example/tiktok",
        },
      })
    );

    expect(exit._tag).toBe("Failure");
    expect(JSON.stringify(exit)).not.toContain("private.example");
    expect(JSON.stringify(exit)).not.toContain("tiktok");
  });

  it("signals an existing workflow with the authorized ledger ordinal", async () => {
    const calls: string[] = [];
    const starter = makeRecipeRecoveryWorkflowStarter({
      createBatch: () => Effect.succeed([]),
      get: () => Effect.succeed(instance("waiting", calls)),
    });

    await Effect.runPromise(starter.start(attempt(2), { correlationId }));

    expect(calls).toEqual([recipeRecoveryAuthorizationEventType(2)]);
  });

  it("restarts an errored instance so native checkpoints are replayed", async () => {
    const calls: string[] = [];
    const starter = makeRecipeRecoveryWorkflowStarter({
      createBatch: () => Effect.succeed([]),
      get: () => Effect.succeed(instance("errored", calls)),
    });

    await Effect.runPromise(starter.start(attempt(4), { correlationId }));

    expect(calls).toEqual(["restart", recipeRecoveryAuthorizationEventType(4)]);
  });
});

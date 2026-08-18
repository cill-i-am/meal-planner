import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  PilotBudgetDispatchId,
  PilotProviderBudgetStage,
} from "../pilots/pilot-provider-budget.js";
import { AcquisitionGeneration, Sha256Hex } from "./import-media.model.js";
import { ImportCorrelationId } from "./import-observability.js";
import type {
  RecipeRecoveryAttempt,
  RecipeRecoveryOrdinal,
} from "./import-recipe-recovery.js";
import { runRecipeRecoveryLoop } from "./import-runtime-composition.js";
import { ImportId, ImportTimestamp } from "./import.contracts.js";

const importId = Schema.decodeUnknownSync(ImportId)(
  "00000000-0000-4000-8000-000000000217"
);
const generation = Schema.decodeUnknownSync(AcquisitionGeneration)(1);
const correlationId = Schema.decodeUnknownSync(ImportCorrelationId)(
  "00000000-0000-4000-8000-000000000218"
);
const timestamp = Schema.decodeUnknownSync(ImportTimestamp)(
  "2026-08-16T00:00:00.000Z"
);
const sha = (value: string) => Schema.decodeUnknownSync(Sha256Hex)(value);
const rootDispatchId = Schema.decodeUnknownSync(PilotBudgetDispatchId)(
  `recipe:${importId}:${generation}:${"a".repeat(64)}`
);

const attempt = (ordinal: RecipeRecoveryOrdinal): RecipeRecoveryAttempt => ({
  acquisitionGeneration: generation,
  createdAt: timestamp,
  currentDispatchId: Schema.decodeUnknownSync(PilotBudgetDispatchId)(
    `${rootDispatchId}:recovery:${ordinal}`
  ),
  currentExtractionFingerprint: sha(String(ordinal).repeat(64)),
  evidenceFingerprint: sha("a".repeat(64)),
  evidenceReferencesJson: JSON.stringify(["source", "transcript", "visual"]),
  importId,
  ordinal,
  predecessorDispatchId: Schema.decodeUnknownSync(PilotBudgetDispatchId)(
    ordinal === 1 ? rootDispatchId : `${rootDispatchId}:recovery:${ordinal - 1}`
  ),
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
});

const input = (attemptOrdinal: RecipeRecoveryOrdinal) => ({
  acquisitionGeneration: generation,
  attemptOrdinal,
  importId,
  trace: { correlationId },
});
const authorization = (attemptOrdinal: RecipeRecoveryOrdinal) => ({
  acquisitionGeneration: generation,
  attemptOrdinal,
  importId,
});

describe("bounded recipe recovery workflow", () => {
  it("preserves the versioned durable checkpoint names for every ordinal", async () => {
    const durableTaskNames: string[] = [];
    const result = await Effect.runPromise(
      runRecipeRecoveryLoop(input(1), {
        persistUnknown: (_value, durableTaskName) =>
          Effect.sync(() => durableTaskNames.push(durableTaskName)).pipe(
            Effect.asVoid
          ),
        readAttempt: (ordinal) => Effect.succeed(attempt(ordinal)),
        runAttempt: (value, durableTaskName) =>
          Effect.sync(() => {
            durableTaskNames.push(durableTaskName);
            return value.ordinal === 8
              ? { _tag: "Succeeded" as const, stage: "recipe" as const }
              : {
                  _tag: "Failed" as const,
                  code: "outcome_unknown",
                  stage: "recipe" as const,
                };
          }),
        waitForAuthorization: (ordinal) =>
          Effect.succeed(authorization(ordinal)),
      })
    );

    expect(result._tag).toBe("Succeeded");
    expect(durableTaskNames).toEqual(
      Array.from({ length: 8 }, (_, index) => index + 1).flatMap((ordinal) =>
        ordinal === 8
          ? [`extract-recipe-recovery-v${ordinal}`]
          : [
              `extract-recipe-recovery-v${ordinal}`,
              `persist-recipe-recovery-terminal-v${ordinal}`,
            ]
      )
    );
  });

  it("stops immediately on success and non-retryable failure", async () => {
    const assertImmediateStop = async (
      checkpoint:
        | { readonly _tag: "Succeeded"; readonly stage: "recipe" }
        | {
            readonly _tag: "Failed";
            readonly code: "invalid_schema";
            readonly stage: "recipe";
          }
    ) => {
      let providerCalls = 0;
      let waits = 0;
      const result = await Effect.runPromise(
        runRecipeRecoveryLoop(input(1), {
          persistUnknown: () => Effect.void,
          readAttempt: () => Effect.succeed(attempt(1)),
          runAttempt: () =>
            Effect.sync(() => {
              providerCalls += 1;
              return checkpoint;
            }),
          waitForAuthorization: () =>
            Effect.sync(() => {
              waits += 1;
              return authorization(1);
            }),
        })
      );

      expect(result).toEqual(checkpoint);
      expect(providerCalls).toBe(1);
      expect(waits).toBe(0);
    };

    await assertImmediateStop({ _tag: "Succeeded", stage: "recipe" });
    await assertImmediateStop({
      _tag: "Failed",
      code: "invalid_schema",
      stage: "recipe",
    });
  });

  it("advances only after explicit authorization backed by the next D1 row", async () => {
    const reads: number[] = [];
    const providers: number[] = [];
    const persisted: number[] = [];
    const result = await Effect.runPromise(
      runRecipeRecoveryLoop(input(1), {
        persistUnknown: (value) =>
          Effect.sync(() => persisted.push(value.ordinal)).pipe(Effect.asVoid),
        readAttempt: (ordinal) =>
          Effect.sync(() => {
            reads.push(ordinal);
            return attempt(ordinal);
          }),
        runAttempt: (value) =>
          Effect.sync(() => {
            providers.push(value.ordinal);
            return value.ordinal === 1
              ? {
                  _tag: "Failed" as const,
                  code: "outcome_unknown",
                  stage: "recipe" as const,
                }
              : { _tag: "Succeeded" as const, stage: "recipe" as const };
          }),
        waitForAuthorization: (ordinal) =>
          Effect.succeed(authorization(ordinal)),
      })
    );

    expect(result._tag).toBe("Succeeded");
    expect(reads).toEqual([1, 2]);
    expect(providers).toEqual([1, 2]);
    expect(persisted).toEqual([1]);
  });

  it("stops at attempt eight and supports reconstruction from a D1 cursor", async () => {
    const providers: number[] = [];
    const result = await Effect.runPromise(
      runRecipeRecoveryLoop(input(4), {
        persistUnknown: () => Effect.void,
        readAttempt: (ordinal) => Effect.succeed(attempt(ordinal)),
        runAttempt: (value) =>
          Effect.sync(() => {
            providers.push(value.ordinal);
            return {
              _tag: "Failed" as const,
              code: "outcome_unknown",
              stage: "recipe" as const,
            };
          }),
        waitForAuthorization: (ordinal) =>
          Effect.succeed(authorization(ordinal)),
      })
    );

    expect(result).toMatchObject({
      _tag: "Failed",
      code: "outcome_unknown",
    });
    expect(providers).toEqual([4, 5, 6, 7, 8]);
  });

  it("rejects an event that is not the exact authorized next ordinal", async () => {
    let providerCalls = 0;
    const result = await Effect.runPromise(
      runRecipeRecoveryLoop(input(1), {
        persistUnknown: () => Effect.void,
        readAttempt: () => Effect.succeed(attempt(1)),
        runAttempt: () =>
          Effect.sync(() => {
            providerCalls += 1;
            return {
              _tag: "Failed" as const,
              code: "outcome_unknown",
              stage: "recipe" as const,
            };
          }),
        waitForAuthorization: () => Effect.succeed(authorization(3)),
      })
    );

    expect(result).toMatchObject({
      _tag: "Failed",
      code: "recovery_authorization_invalid",
    });
    expect(providerCalls).toBe(1);
  });
});

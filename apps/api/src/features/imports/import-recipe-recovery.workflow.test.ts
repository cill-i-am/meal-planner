import {
  RecipeImportActionId,
  RecipeImportIntentId,
} from "@meal-planner/recipe-import-api";
import type {
  WorkflowInstanceEvent,
  WorkflowInstanceRestartOptions,
} from "alchemy/Cloudflare/Workflows";
import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { HouseholdDispatchId } from "../households/foundation/import-workflow-admission.contract.js";
import type { HouseholdDomainWorkerMethods } from "../households/household-domain-worker.js";
import { HouseholdOrganizationId } from "../households/household.contract.js";
import { HouseholdImportMutationId } from "../households/recipe-import/household-recipe-import.contract.js";
import { ImportIntentExecutionGeneration } from "./import-intent-transition.js";
import { AcquisitionGeneration, Sha256Hex } from "./import-media.model.js";
import { ImportCorrelationId } from "./import-observability.js";
import { RecipeDraft } from "./import-recipe-draft.repository.js";
import { makeHouseholdRecipeDraftLifecycle } from "./import-recipe-lifecycle.household.js";
import { makeRecipeRecoveryWorkflowStarter } from "./import-recipe-recovery.js";
import type {
  RecipeRecoveryAuthorization,
  RecipeRecoveryAttempt,
  RecipeRecoveryOrdinal,
} from "./import-recipe-recovery.js";
import { runRecipeRecoveryLoop } from "./import-runtime-composition.js";
import { ImportId, ImportTimestamp } from "./import.contracts.js";

const importId = Schema.decodeUnknownSync(ImportId)(
  "00000000-0000-4000-8000-000000000217"
);
const generation = Schema.decodeUnknownSync(AcquisitionGeneration)(1);
const executionGeneration = Schema.decodeUnknownSync(
  ImportIntentExecutionGeneration
)(1);
const correlationId = Schema.decodeUnknownSync(ImportCorrelationId)(
  "00000000-0000-4000-8000-000000000218"
);
const timestamp = Schema.decodeUnknownSync(ImportTimestamp)(
  "2026-08-16T00:00:00.000Z"
);
const sha = (value: string) => Schema.decodeUnknownSync(Sha256Hex)(value);
const rootDispatchId = Schema.decodeUnknownSync(HouseholdDispatchId)(
  `recipe:${importId}:${generation}:${"a".repeat(64)}`
);
const organizationId = Schema.decodeUnknownSync(HouseholdOrganizationId)(
  "organization-recipe-recovery-workflow"
);

const attempt = (ordinal: RecipeRecoveryOrdinal): RecipeRecoveryAttempt => ({
  acquisitionGeneration: generation,
  createdAt: timestamp,
  currentDispatchId: Schema.decodeUnknownSync(HouseholdDispatchId)(
    `${rootDispatchId}:recovery:${ordinal}`
  ),
  currentExtractionFingerprint: sha(String(ordinal).repeat(64)),
  evidenceFingerprint: sha("a".repeat(64)),
  executionGeneration,
  importId,
  ordinal,
  predecessorDispatchId: Schema.decodeUnknownSync(HouseholdDispatchId)(
    ordinal === 1 ? rootDispatchId : `${rootDispatchId}:recovery:${ordinal - 1}`
  ),
  predecessorExtractionFingerprint: sha("b".repeat(64)),
  rootDispatchId,
  rootExtractionFingerprint: sha("b".repeat(64)),
  sourceMediaSha256: sha("e".repeat(64)),
  terminalCheckpointCompletedAt: timestamp,
  transcriptSha256: sha("c".repeat(64)),
  visualManifestSha256: sha("d".repeat(64)),
});

const input = (attemptOrdinal: RecipeRecoveryOrdinal) => ({
  acquisitionGeneration: generation,
  attemptOrdinal,
  executionGeneration,
  importId,
  organizationId,
  trace: { correlationId },
});
const authorization = (attemptOrdinal: RecipeRecoveryOrdinal) => ({
  acquisitionGeneration: generation,
  attemptOrdinal,
  executionGeneration,
  importId,
});
type CommitRecipeImportDraftCommand = Parameters<
  HouseholdDomainWorkerMethods["commitRecipeImportDraft"]
>[0];
type TransitionRecipeImportLifecycleCommand = Parameters<
  HouseholdDomainWorkerMethods["transitionRecipeImportLifecycle"]
>[0];

describe("bounded recipe recovery workflow", () => {
  it("restarts and authorizes a completed workflow for a newly prepared higher ordinal", async () => {
    const restarts: unknown[] = [];
    const events: unknown[] = [];
    let restarted = false;
    let statusCalls = 0;
    const instance = {
      restart: (options?: WorkflowInstanceRestartOptions) =>
        Effect.sync(() => {
          restarts.push(options);
          restarted = true;
        }),
      sendEvent: (event: WorkflowInstanceEvent<RecipeRecoveryAuthorization>) =>
        Effect.sync(() => {
          events.push(event);
        }),
      status: () =>
        Effect.sync(() => {
          statusCalls += 1;
          return {
            status:
              restarted && statusCalls > 2
                ? ("running" as const)
                : ("complete" as const),
          };
        }),
    };
    const starter = makeRecipeRecoveryWorkflowStarter({
      createBatch: () => Effect.succeed([instance]),
      get: () => Effect.die("existing instance must be reconciled directly"),
    });

    await Effect.runPromise(
      starter.start(attempt(2), { correlationId }, organizationId, "Prepared")
    );

    expect(restarts).toEqual([
      {
        from: { name: "extract-recipe-recovery-v1", type: "do" },
      },
    ]);
    expect(events).toEqual([
      {
        payload: authorization(2),
        type: "recipe-recovery-authorized-2",
      },
    ]);
  });

  it("keeps an exact replay of a completed higher ordinal idempotent", async () => {
    let restartCalls = 0;
    let eventCalls = 0;
    const starter = makeRecipeRecoveryWorkflowStarter({
      createBatch: () => Effect.succeed([]),
      get: () =>
        Effect.succeed({
          restart: () =>
            Effect.sync(() => {
              restartCalls += 1;
            }),
          sendEvent: () =>
            Effect.sync(() => {
              eventCalls += 1;
            }),
          status: () => Effect.succeed({ status: "complete" }),
        }),
    });

    await Effect.runPromise(
      starter.start(attempt(2), { correlationId }, organizationId, "Replay")
    );

    expect(restartCalls).toBe(0);
    expect(eventCalls).toBe(0);
  });

  it("uses the production Household lifecycle to commit a recovered review action", async () => {
    const transitions: unknown[] = [];
    const commits: unknown[] = [];
    const householdDomain = {
      commitRecipeImportDraft: (command: CommitRecipeImportDraftCommand) =>
        Effect.sync(() => {
          commits.push(command);
          return {};
        }),
      transitionRecipeImportLifecycle: (
        command: TransitionRecipeImportLifecycleCommand
      ) =>
        Effect.sync(() => {
          transitions.push(command);
          return {};
        }),
    } as unknown as Pick<
      HouseholdDomainWorkerMethods,
      "commitRecipeImportDraft" | "transitionRecipeImportLifecycle"
    >;
    const intentId = Schema.decodeUnknownSync(RecipeImportIntentId)(importId);
    const lifecycle = makeHouseholdRecipeDraftLifecycle({
      executionGeneration,
      householdDomain,
      intentId,
      mutationId: () =>
        Effect.succeed(
          Schema.decodeUnknownSync(HouseholdImportMutationId)("9".repeat(64))
        ),
      organizationId,
    });
    const citation = {
      citations: [
        {
          confidence: 1,
          evidenceId: "recovered-review-fixture",
          origin: "creator_provided" as const,
        },
      ],
      origin: "creator_provided" as const,
      state: "supported" as const,
    };
    const supportedString = (value: string) => ({ ...citation, value });
    const supportedList = (items: readonly string[]) => ({
      items: items.map(supportedString),
      state: "supported" as const,
    });
    const draft = Schema.decodeUnknownSync(RecipeDraft)({
      createdAt: "2026-08-16T00:00:00.000Z",
      evidenceFingerprint: "a".repeat(64),
      extraction: {
        author: supportedString("Fixture Cook"),
        category: supportedString("Dinner"),
        cookTimeMinutes: { ...citation, value: 20 },
        cost: {
          certainty: "known",
          currency: "USD",
          estimatedMicroUsd: 0,
        },
        cuisine: supportedString("Irish"),
        description: supportedString("Recovered recipe"),
        ingredientLines: supportedList(["1 onion"]),
        instructions: supportedList(["Cook the onion."]),
        name: supportedString("Recovered Onion"),
        nutrition: supportedString("Not stated"),
        prepTimeMinutes: { ...citation, value: 10 },
        sourceUrl: supportedString(
          "https://www.tiktok.com/@fixture/video/7520000000000000001"
        ),
        supportedClaims: supportedList(["Cook the onion."]),
        temperatureCelsius: { ...citation, value: 180 },
        tools: supportedList(["Saucepan"]),
        totalTimeMinutes: { ...citation, value: 30 },
        unresolvedFields: [],
        usage: {
          inputEvidenceItems: 1,
          inputTokens: 0,
          latencyMilliseconds: 0,
          modelCalls: 1,
          outputTokens: 0,
        },
        yield: supportedString("2 servings"),
      },
      extractionFingerprint: "b".repeat(64),
      extractor: {
        model: "fixture-model",
        provider: "workers-ai",
        version: "fixture-version",
      },
      generation: 1,
      importId,
      lifecycle: "needs_review",
      schemaVersion: 1,
      transcript: { status: "available" },
    });

    await Effect.runPromise(lifecycle.grounding);
    await Effect.runPromise(lifecycle.preparingReview);
    await Effect.runPromise(
      lifecycle.reviewAvailable(
        Schema.decodeUnknownSync(RecipeImportActionId)("c".repeat(64)),
        draft
      )
    );

    expect(transitions).toMatchObject([
      { transition: { _tag: "AdvanceStage", stage: "grounding_recipe" } },
      { transition: { _tag: "AdvanceStage", stage: "preparing_review" } },
    ]);
    expect(commits).toMatchObject([
      {
        evidenceFingerprint: "a".repeat(64),
        expectedGeneration: 1,
        extractionFingerprint: "b".repeat(64),
        intentId,
        review: { recipe: { name: "Recovered Onion" } },
      },
    ]);
  });

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

  it("advances a provider-error predecessor without rewriting it as unknown", async () => {
    const providers: number[] = [];
    const persisted: number[] = [];
    const result = await Effect.runPromise(
      runRecipeRecoveryLoop(input(1), {
        persistUnknown: (value) =>
          Effect.sync(() => persisted.push(value.ordinal)).pipe(Effect.asVoid),
        readAttempt: (ordinal) => Effect.succeed(attempt(ordinal)),
        runAttempt: (value) =>
          Effect.sync(() => {
            providers.push(value.ordinal);
            return value.ordinal === 1
              ? {
                  _tag: "Failed" as const,
                  code: "provider_error",
                  stage: "recipe" as const,
                }
              : { _tag: "Succeeded" as const, stage: "recipe" as const };
          }),
        waitForAuthorization: (ordinal) =>
          Effect.succeed(authorization(ordinal)),
      })
    );

    expect(result._tag).toBe("Succeeded");
    expect(providers).toEqual([1, 2]);
    expect(persisted).toEqual([]);
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

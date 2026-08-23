import { RecipeImportIntentId } from "@meal-planner/recipe-import-api";
import type { AnyD1Database } from "drizzle-orm/d1";
import { Effect, Schema } from "effect";

import {
  ImportEvidenceEventFailure,
  reconcileImportEvidenceQueueMessage,
} from "../imports/import-evidence-event.js";
import { makeD1ImportEvidenceRouteRepository } from "../imports/import-evidence-route.repository.d1.js";
import {
  makeHouseholdSpeechTranscriptionRepository,
  makeHouseholdVisualEvidenceRepository,
} from "../imports/import-evidence.repository.household.js";
import {
  AcquisitionGeneration,
  Sha256Hex,
} from "../imports/import-media.model.js";
import {
  ImportCorrelationId,
  ImportTraceContext,
} from "../imports/import-observability.js";
import { persistHouseholdProviderTerminalAuthority } from "../imports/import-provider-terminal-authority.js";
import {
  ProviderTerminalSettlementRequest,
  ProviderTerminalSettlementResponse,
  makeD1ProviderTerminalSettlementService,
} from "../imports/import-provider-terminal-settlement.js";
import {
  ImportId,
  ImportTimestamp,
  SourceCanonicalId,
} from "../imports/import.contracts.js";
import { workflowStartUnavailable } from "../imports/import.errors.js";
import {
  HouseholdObserveEvidenceReferenceInput,
  HouseholdReadEvidenceStageResult,
} from "./evidence/household-evidence.contract.js";
import type {
  HouseholdMutateEvidenceStageInput,
  HouseholdMutateEvidenceStageResult,
  HouseholdObserveEvidenceReferenceResult,
  HouseholdPrepareRecipeRecoveryInput,
  HouseholdPrepareRecipeRecoveryResult,
  HouseholdReadEvidenceReferencesInput,
  HouseholdReadEvidenceReferencesResult,
  HouseholdReadEvidenceStageInput,
  HouseholdReadImportTerminalCheckpointInput,
  HouseholdReadImportTerminalCheckpointResult,
  HouseholdReadRecipeRecoveryAttemptInput,
  HouseholdReadRecipeRecoveryAttemptResult,
} from "./evidence/household-evidence.contract.js";
import {
  HouseholdImportMutationId,
  HouseholdRecipeImportExecutionView,
  HouseholdRecipeImportFailure,
} from "./recipe-import/household-recipe-import.contract.js";
import type { HouseholdReadRecipeImportExecutionInput } from "./recipe-import/household-recipe-import.contract.js";
import { HouseholdSystemAdmission } from "./rpc/command-envelope.js";

interface TestKvNamespace {
  readonly get: (key: string) => Promise<string | null>;
  readonly put: (key: string, value: string) => Promise<void>;
}

interface TestR2Bucket {
  readonly head: (key: string) => Promise<{
    readonly checksums?: { readonly sha256?: ArrayBuffer };
    readonly customMetadata?: Record<string, string>;
  } | null>;
}

interface TestMessageBatch {
  readonly messages: readonly {
    readonly ack: () => void;
    readonly body: unknown;
    readonly retry: () => void;
  }[];
}

interface Environment {
  readonly EVIDENCE_EVENT_RESULTS: TestKvNamespace;
  readonly ImportEvidenceBucket: TestR2Bucket;
  readonly MealPlannerDatabase: AnyD1Database;
  readonly HouseholdDomainWorker: {
    readonly mutateEvidenceStage: (
      input: typeof HouseholdMutateEvidenceStageInput.Encoded
    ) => Promise<typeof HouseholdMutateEvidenceStageResult.Encoded>;
    readonly observeEvidenceReference: (
      input: typeof HouseholdObserveEvidenceReferenceInput.Encoded
    ) => Promise<typeof HouseholdObserveEvidenceReferenceResult.Encoded>;
    readonly readEvidenceReferences: (
      input: HouseholdReadEvidenceReferencesInput
    ) => Promise<typeof HouseholdReadEvidenceReferencesResult.Encoded>;
    readonly prepareRecipeRecovery: (
      input: typeof HouseholdPrepareRecipeRecoveryInput.Encoded
    ) => Promise<typeof HouseholdPrepareRecipeRecoveryResult.Encoded>;
    readonly readEvidenceStage: (
      input: HouseholdReadEvidenceStageInput
    ) => Promise<typeof HouseholdReadEvidenceStageResult.Encoded>;
    readonly readImportTerminalCheckpoint: (
      input: HouseholdReadImportTerminalCheckpointInput
    ) => Promise<typeof HouseholdReadImportTerminalCheckpointResult.Encoded>;
    readonly readRecipeImportExecution: (
      input: HouseholdReadRecipeImportExecutionInput
    ) => Promise<typeof HouseholdRecipeImportExecutionView.Encoded>;
    readonly readRecipeRecoveryAttempt: (
      input: HouseholdReadRecipeRecoveryAttemptInput
    ) => Promise<typeof HouseholdReadRecipeRecoveryAttemptResult.Encoded>;
  };
}

const RpcErrorEnvelope = Schema.Struct({
  _tag: Schema.Literal("~alchemy/rpc/error"),
  error: Schema.Struct({ reason: Schema.optionalKey(Schema.String) }),
});

const dependencyFailure = () =>
  new ImportEvidenceEventFailure({
    reason: "dependency_unavailable",
    retryable: true,
  });

const rpc = <A>(run: () => Promise<A>) =>
  Effect.tryPromise({ catch: dependencyFailure, try: run }).pipe(
    Effect.flatMap((value) => {
      const rejected = Schema.decodeUnknownOption(RpcErrorEnvelope)(value);
      if (rejected._tag === "None") {
        // Raw Workerd service bindings retain hidden RPC metadata. Normalize to
        // the plain structured clone returned by the Alchemy binding adapter.
        return Effect.try({
          catch: dependencyFailure,
          try: () => structuredClone(value),
        });
      }
      return Effect.fail(
        rejected.value.error.reason === "persistence_unavailable"
          ? dependencyFailure()
          : new ImportEvidenceEventFailure({
              reason: "stale_event",
              retryable: false,
            })
      );
    })
  );

const terminalRpc = <A>(run: () => Promise<A>) =>
  Effect.tryPromise({
    catch: () =>
      HouseholdRecipeImportFailure.make({
        reason: "persistence_unavailable",
      }),
    try: run,
  }).pipe(
    Effect.flatMap((value) => {
      const rejected = Schema.decodeUnknownOption(RpcErrorEnvelope)(value);
      if (rejected._tag === "Some") {
        return Effect.fail(
          HouseholdRecipeImportFailure.make({
            reason:
              rejected.value.error.reason === "persistence_unavailable"
                ? "persistence_unavailable"
                : "illegal_transition",
          })
        );
      }
      return Effect.try({
        catch: () =>
          HouseholdRecipeImportFailure.make({
            reason: "persistence_unavailable",
          }),
        try: () => structuredClone(value),
      });
    })
  );

const terminalHousehold = (environment: Environment) => ({
  mutateEvidenceStage: (
    input: typeof HouseholdMutateEvidenceStageInput.Encoded
  ) =>
    terminalRpc(() =>
      environment.HouseholdDomainWorker.mutateEvidenceStage(input)
    ),
  prepareRecipeRecovery: (
    input: typeof HouseholdPrepareRecipeRecoveryInput.Encoded
  ) =>
    terminalRpc(() =>
      environment.HouseholdDomainWorker.prepareRecipeRecovery(input)
    ),
  readEvidenceReferences: (input: HouseholdReadEvidenceReferencesInput) =>
    terminalRpc(() =>
      environment.HouseholdDomainWorker.readEvidenceReferences(input)
    ),
  readEvidenceStage: (input: HouseholdReadEvidenceStageInput) =>
    terminalRpc(() =>
      environment.HouseholdDomainWorker.readEvidenceStage(input)
    ),
  readImportTerminalCheckpoint: (
    input: HouseholdReadImportTerminalCheckpointInput
  ) =>
    terminalRpc(() =>
      environment.HouseholdDomainWorker.readImportTerminalCheckpoint(input)
    ),
  readRecipeImportExecution: (input: HouseholdReadRecipeImportExecutionInput) =>
    terminalRpc(() =>
      environment.HouseholdDomainWorker.readRecipeImportExecution(input)
    ),
  readRecipeRecoveryAttempt: (input: HouseholdReadRecipeRecoveryAttemptInput) =>
    terminalRpc(() =>
      environment.HouseholdDomainWorker.readRecipeRecoveryAttempt(input)
    ),
});

const ProviderTerminalAttemptCommand = Schema.Struct({
  admission: HouseholdSystemAdmission,
  canonicalSourceId: SourceCanonicalId,
  correlationId: ImportCorrelationId,
  dispatchId: Schema.String,
  expectedGeneration: AcquisitionGeneration,
  inputFingerprint: Sha256Hex,
  intentId: RecipeImportIntentId,
  stage: Schema.Literals(["speech", "visual"]),
});

const testMutationId = (seed: string) =>
  Effect.promise(() =>
    crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(`household-provider-test:v1:${seed}`)
    )
  ).pipe(
    Effect.map((digest) =>
      Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, "0")
      ).join("")
    ),
    Effect.map(Schema.decodeUnknownSync(HouseholdImportMutationId))
  );

const runAmbiguousProviderAttempt = (
  environment: Environment,
  command: typeof ProviderTerminalAttemptCommand.Type
) => {
  const householdDomain = terminalHousehold(environment);
  const repositoryInput = {
    canonicalSourceId: command.canonicalSourceId,
    correlationId: command.correlationId,
    generation: command.expectedGeneration,
    householdDomain,
    intentId: command.intentId,
    mutationId: testMutationId,
    organizationId: command.admission.organizationId,
  };
  const claim = {
    dispatchId: command.dispatchId,
    generation: command.expectedGeneration,
    importId: Schema.decodeUnknownSync(ImportId)(command.intentId),
    sourceMediaSha256: command.inputFingerprint,
    startedAt: Schema.decodeUnknownSync(ImportTimestamp)(
      "2026-08-23T10:00:00.000Z"
    ),
  };
  const persist = (
    failAmbiguous: Parameters<
      typeof persistHouseholdProviderTerminalAuthority
    >[0]["failAmbiguous"]
  ) =>
    persistHouseholdProviderTerminalAuthority({
      admission: command.admission,
      failAmbiguous,
      failure: {
        _tag: "Failed",
        code: "outcome_unknown",
        stage: command.stage,
      },
      generation: command.expectedGeneration,
      householdDomain,
      intentId: command.intentId,
      now: () =>
        Schema.decodeUnknownSync(ImportTimestamp)(new Date().toISOString()),
    });
  const invokeProviderOnce = Effect.promise(async () => {
    const key = `provider-attempt-calls:${command.dispatchId}`;
    if ((await environment.EVIDENCE_EVENT_RESULTS.get(key)) === null) {
      await environment.EVIDENCE_EVENT_RESULTS.put(key, "1");
    }
  });
  if (command.stage === "speech") {
    const repository =
      makeHouseholdSpeechTranscriptionRepository(repositoryInput);
    return repository
      .claim(claim)
      .pipe(
        Effect.andThen(invokeProviderOnce),
        Effect.andThen(persist(repository.fail))
      );
  }
  const repository = makeHouseholdVisualEvidenceRepository(repositoryInput);
  return repository
    .claim(claim)
    .pipe(
      Effect.andThen(invokeProviderOnce),
      Effect.andThen(persist(repository.fail))
    );
};

export default {
  async fetch(request: Request, environment: Environment) {
    if (request.headers.get("x-test-provider-terminal-attempt") === "1") {
      try {
        const command = await Schema.decodeUnknownPromise(
          ProviderTerminalAttemptCommand,
          { onExcessProperty: "error" }
        )(await request.json());
        return Response.json(
          await Effect.runPromise(
            runAmbiguousProviderAttempt(environment, command)
          )
        );
      } catch (error) {
        return Response.json(
          { error: JSON.stringify(error), rejected: true },
          { status: 409 }
        );
      }
    }
    if (request.headers.get("x-test-terminal-settlement") !== "1") {
      return new Response(null, { status: 404 });
    }
    try {
      const command = await Schema.decodeUnknownPromise(
        ProviderTerminalSettlementRequest,
        { onExcessProperty: "error" }
      )(await request.json());
      const restartProviderStage = (
        stage: "speech" | "visual",
        importId: typeof ImportId.Type
      ) =>
        Effect.tryPromise({
          catch: workflowStartUnavailable,
          try: async () => {
            const stateKey = `${stage}-restart:${importId}`;
            const state =
              await environment.EVIDENCE_EVENT_RESULTS.get(stateKey);
            if (state === "active" || state === "complete") {
              return;
            }
            const callsKey = `${stage}-restart-calls:${importId}`;
            const calls = Number(
              (await environment.EVIDENCE_EVENT_RESULTS.get(callsKey)) ?? "0"
            );
            await environment.EVIDENCE_EVENT_RESULTS.put(
              callsKey,
              String(calls + 1)
            );
            await environment.EVIDENCE_EVENT_RESULTS.put(stateKey, "active");
          },
        });
      const completeProviderStageBeforeRestartResponse = (
        stage: "speech" | "visual",
        importId: typeof ImportId.Type,
        generation: typeof AcquisitionGeneration.Type
      ) =>
        Effect.gen(function* completeProviderRecoveryBeforeResponseLoss() {
          yield* restartProviderStage(stage, importId);
          const routes = makeD1ImportEvidenceRouteRepository(
            environment.MealPlannerDatabase
          );
          const route = yield* routes
            .get(importId)
            .pipe(Effect.mapError(workflowStartUnavailable));
          if (route === null) {
            return yield* Effect.fail(workflowStartUnavailable());
          }
          const admission = Schema.decodeUnknownSync(HouseholdSystemAdmission)({
            actor: {
              _tag: "System",
              purpose: "recipe_import_lifecycle_commit",
            },
            organizationId: route.organizationId,
          });
          const intentId =
            Schema.decodeUnknownSync(RecipeImportIntentId)(importId);
          const household = terminalHousehold(environment);
          const execution = yield* household
            .readRecipeImportExecution({
              admission,
              expectedGeneration: generation,
              intentId,
            })
            .pipe(
              Effect.flatMap(
                Schema.decodeUnknownEffect(HouseholdRecipeImportExecutionView, {
                  onExcessProperty: "error",
                })
              ),
              Effect.mapError(workflowStartUnavailable)
            );
          const currentStage = yield* household
            .readEvidenceStage({
              admission,
              expectedGeneration: generation,
              intentId,
              stage,
            })
            .pipe(
              Effect.flatMap(
                Schema.decodeUnknownEffect(HouseholdReadEvidenceStageResult, {
                  onExcessProperty: "error",
                })
              ),
              Effect.mapError(workflowStartUnavailable)
            );
          if (currentStage === null) {
            return yield* Effect.fail(workflowStartUnavailable());
          }
          yield* runAmbiguousProviderAttempt(environment, {
            admission,
            canonicalSourceId: Schema.decodeUnknownSync(SourceCanonicalId)(
              execution.canonicalSourceId
            ),
            correlationId: Schema.decodeUnknownSync(ImportCorrelationId)(
              "00000000-0000-4000-8000-000000000195"
            ),
            dispatchId: currentStage.dispatchId,
            expectedGeneration: generation,
            inputFingerprint: Schema.decodeUnknownSync(Sha256Hex)(
              currentStage.inputFingerprint
            ),
            intentId,
            stage,
          });
          yield* Effect.promise(() =>
            environment.EVIDENCE_EVENT_RESULTS.put(
              `${stage}-restart:${importId}`,
              "complete"
            )
          );
          return yield* Effect.fail(workflowStartUnavailable());
        }).pipe(Effect.mapError(workflowStartUnavailable));
      const restartSpeech = (importId: typeof ImportId.Type) => {
        const behavior = request.headers.get("x-test-speech-restart");
        if (behavior === "fail") {
          return Effect.fail(workflowStartUnavailable());
        }
        if (behavior === "terminal-then-fail") {
          return "acquisitionGeneration" in command
            ? completeProviderStageBeforeRestartResponse(
                "speech",
                importId,
                command.acquisitionGeneration
              )
            : Effect.fail(workflowStartUnavailable());
        }
        return restartProviderStage("speech", importId);
      };
      const result = await Effect.runPromise(
        makeD1ProviderTerminalSettlementService({
          database: environment.MealPlannerDatabase,
          householdDomain: terminalHousehold(environment),
          now: () =>
            Schema.decodeUnknownSync(ImportTimestamp)(new Date().toISOString()),
          recipeRecoveryStarter: { start: () => Effect.void },
          runtimeStage: "pilot-gaia-118",
          trace: Schema.decodeUnknownSync(ImportTraceContext)({
            correlationId: "00000000-0000-4000-8000-000000000188",
          }),
          workflowStarter: {
            restartFromSpeech: restartSpeech,
            restartFromVisual: (importId) =>
              restartProviderStage("visual", importId),
          },
        }).settle(command)
      );
      if (request.headers.get("x-test-speech-restart") === "lose-response") {
        return Response.json({ responseLost: true }, { status: 409 });
      }
      return Response.json(
        Schema.encodeSync(ProviderTerminalSettlementResponse)(result)
      );
    } catch (error) {
      return Response.json(
        { error: JSON.stringify(error), rejected: true },
        { status: 409 }
      );
    }
  },
  async queue(batch: TestMessageBatch, environment: Environment) {
    const routes = makeD1ImportEvidenceRouteRepository(
      environment.MealPlannerDatabase
    );
    await Promise.all(
      batch.messages.map(async (message) => {
        const safeResult = await Effect.runPromise(
          reconcileImportEvidenceQueueMessage(message.body, {
            bucket: {
              head: (key) =>
                Effect.promise(() =>
                  environment.ImportEvidenceBucket.head(key)
                ).pipe(Effect.mapError(dependencyFailure)),
            },
            household: {
              observeEvidenceReference: (input) =>
                Schema.encodeEffect(HouseholdObserveEvidenceReferenceInput)(
                  input
                ).pipe(
                  Effect.mapError(dependencyFailure),
                  Effect.flatMap((encoded) =>
                    rpc(() =>
                      environment.HouseholdDomainWorker.observeEvidenceReference(
                        encoded
                      )
                    )
                  )
                ),
              readEvidenceReferences: (input) =>
                rpc(() =>
                  environment.HouseholdDomainWorker.readEvidenceReferences(
                    input
                  )
                ),
            },
            routes: {
              get: (importId) =>
                routes.get(importId).pipe(Effect.mapError(dependencyFailure)),
            },
          }).pipe(
            Effect.match({
              onFailure: (error) => ({
                _tag: "Rejected" as const,
                reason: error.reason,
                retryable: error.retryable,
              }),
              onSuccess: (value) => ({ _tag: "Accepted" as const, value }),
            })
          )
        );
        await environment.EVIDENCE_EVENT_RESULTS.put(
          "last",
          JSON.stringify(safeResult)
        );
        if (safeResult._tag === "Rejected" && safeResult.retryable) {
          message.retry();
        } else {
          message.ack();
        }
      })
    );
  },
};

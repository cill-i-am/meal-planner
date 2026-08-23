import { RecipeImportIntentId } from "@meal-planner/recipe-import-api";
import { RuntimeContext } from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import type { AnyD1Database } from "drizzle-orm/d1";
import { Effect, Option, Schema } from "effect";

import { ImportEvidenceBucket } from "../../infrastructure/import-evidence-bucket.js";
import { ImportProviderGateway } from "../../infrastructure/import-provider-gateway.js";
import { MealPlannerDatabase } from "../../infrastructure/meal-planner-database.js";
import { HouseholdDomainWorker } from "../households/household-domain-binding.js";
import type { HouseholdDomainWorkerMethods } from "../households/household-domain-worker.js";
import { HouseholdImportMutationId } from "../households/recipe-import/household-recipe-import.contract.js";
import {
  ProviderAccountingRunId,
  ProviderAccountingTimestamp,
} from "../provider-accounting/provider-accounting.js";
import { makeD1ProviderAccountingRepository } from "../provider-accounting/provider-accounting.repository.d1.js";
import { adaptAcquisitionBucket } from "./import-media-acquisition-bucket.alchemy.js";
import { makeD1ImportObservabilityTraceStore } from "./import-observability.d1.js";
import {
  ImportObservabilityTraceStore,
  observeImportWorkflowStart,
} from "./import-observability.js";
import type { ImportCorrelationId } from "./import-observability.js";
import {
  makeProviderDispatchGate,
  makeWorkersAiTransport,
} from "./import-provider-kernel.js";
import type { WorkersAiTransport } from "./import-provider-kernel.js";
import { makeInstalledRecipeExtractor } from "./import-provider-recipe.js";
import { ProviderTaskCheckpoint } from "./import-provider-workflow-checkpoint.js";
import {
  ProviderTaskStepConfig,
  runProviderTaskAttempt,
} from "./import-provider-workflow-task.js";
import { produceRecipeDraftForImport } from "./import-recipe-draft.js";
import { makeHouseholdRecipeDraftLifecycle } from "./import-recipe-lifecycle.household.js";
import {
  makeRecipeRecoveryHouseholdEvidenceRepositories,
  readHouseholdRecipeRecovery,
} from "./import-recipe-recovery.household.js";
import {
  RecipeRecoveryAuthorization,
  RecipeRecoveryOrdinal,
  recipeRecoveryAuthorizationEventType,
  recipeRecoveryDurableTaskNames,
  resolveRecipeRecoveryWorkflowInput,
} from "./import-recipe-recovery.js";
import type {
  RecipeRecoveryAttempt,
  RecipeRecoveryAuthorization as RecipeRecoveryAuthorizationType,
  RecipeRecoveryWorkflowInput,
  RecipeRecoveryWorkflowInputEncoded,
} from "./import-recipe-recovery.js";

export { runImportVisualAndRecipeWorkflow } from "./import-application-workflows.js";

type RecoveryCheckpoint = typeof ProviderTaskCheckpoint.Type;

/** Durable host operations needed by the Effect-owned recipe recovery loop. */
export interface RecipeRecoveryLoopDependencies<Requirements = never> {
  readonly persistUnknown: (
    attempt: RecipeRecoveryAttempt,
    durableTaskName: string
  ) => Effect.Effect<void, never, Requirements>;
  readonly readAttempt: (
    ordinal: RecipeRecoveryOrdinal
  ) => Effect.Effect<RecipeRecoveryAttempt | null, never, Requirements>;
  readonly runAttempt: (
    attempt: RecipeRecoveryAttempt,
    durableTaskName: string
  ) => Effect.Effect<RecoveryCheckpoint, never, Requirements>;
  readonly waitForAuthorization: (
    ordinal: RecipeRecoveryOrdinal
  ) => Effect.Effect<
    typeof RecipeRecoveryAuthorization.Encoded,
    never,
    Requirements
  >;
}

const failedRecoveryCheckpoint = (code: string): RecoveryCheckpoint => ({
  _tag: "Failed",
  code,
  stage: "recipe",
});

const nextRecoveryOrdinal = (ordinal: RecipeRecoveryOrdinal) =>
  Schema.decodeUnknownOption(RecipeRecoveryOrdinal)(ordinal + 1);

const normalizeDurableRecoveryAuthorization = (
  input: typeof RecipeRecoveryAuthorization.Encoded
): typeof RecipeRecoveryAuthorization.Encoded | undefined => {
  try {
    return structuredClone(input);
  } catch {
    return undefined;
  }
};

/**
 * Run the bounded recipe recovery application workflow while the host owns
 * every versioned Cloudflare task and authorization-wait primitive.
 */
export const runRecipeRecoveryLoop = Effect.fn(
  "ImportRuntime.runRecipeRecovery"
)(function* runRecipeRecoveryLoopEffect<Requirements>(
  input: typeof RecipeRecoveryWorkflowInput.Type,
  dependencies: RecipeRecoveryLoopDependencies<Requirements>
) {
  let ordinal = input.attemptOrdinal;
  for (let visited = 0; visited < 8; visited += 1) {
    const attempt = yield* dependencies.readAttempt(ordinal);
    if (
      attempt === null ||
      attempt.importId !== input.importId ||
      attempt.acquisitionGeneration !== input.acquisitionGeneration ||
      attempt.executionGeneration !== input.executionGeneration ||
      attempt.ordinal !== ordinal
    ) {
      return failedRecoveryCheckpoint("recovery_attempt_unavailable");
    }

    const durableTaskNames = recipeRecoveryDurableTaskNames(ordinal);
    const checkpoint = yield* dependencies.runAttempt(
      attempt,
      durableTaskNames.extraction
    );
    if (checkpoint._tag === "Succeeded") {
      return checkpoint;
    }
    if (checkpoint.code !== "outcome_unknown") {
      return checkpoint;
    }

    yield* dependencies.persistUnknown(attempt, durableTaskNames.terminal);
    const next = nextRecoveryOrdinal(ordinal);
    if (Option.isNone(next)) {
      return checkpoint;
    }

    const rawAuthorization = yield* dependencies.waitForAuthorization(
      next.value
    );
    const authorization = Schema.decodeUnknownOption(
      RecipeRecoveryAuthorization,
      { onExcessProperty: "error" }
    )(normalizeDurableRecoveryAuthorization(rawAuthorization));
    if (
      Option.isNone(authorization) ||
      authorization.value.importId !== input.importId ||
      authorization.value.acquisitionGeneration !==
        input.acquisitionGeneration ||
      authorization.value.executionGeneration !== input.executionGeneration ||
      authorization.value.attemptOrdinal !== next.value
    ) {
      return failedRecoveryCheckpoint("recovery_authorization_invalid");
    }
    ordinal = next.value;
  }
  return failedRecoveryCheckpoint("recovery_attempt_limit_reached");
});

const currentProviderAccountingTimestamp = () =>
  Schema.decodeUnknownSync(ProviderAccountingTimestamp)(
    new Date().toISOString()
  );

/** Shared production accounting and extraction composition for recipe Workflows. */
export const makeRecipeRecoveryProviderRuntime = (input: {
  readonly correlationId: ImportCorrelationId;
  readonly database: AnyD1Database;
  readonly now: () => typeof ProviderAccountingTimestamp.Type;
  readonly runId: typeof ProviderAccountingRunId.Type;
  readonly transport: WorkersAiTransport["recipe"];
}) => {
  const dispatch = makeProviderDispatchGate({
    correlationId: input.correlationId,
    now: input.now,
    repository: makeD1ProviderAccountingRepository(input.database),
    runId: input.runId,
  });
  return makeInstalledRecipeExtractor({
    correlationId: input.correlationId,
    dispatch,
    transport: input.transport,
  }).pipe(Effect.map((extractor) => ({ extractor })));
};

const recoveryMutationId = (semanticKey: string) =>
  Effect.promise(() =>
    crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(
        `household-recipe-import-recovery-workflow:v1:${semanticKey}`
      )
    )
  ).pipe(
    Effect.map((digest) =>
      Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, "0")
      ).join("")
    ),
    Effect.map(Schema.decodeUnknownSync(HouseholdImportMutationId))
  );

/** Cloudflare primitives retained by the recipe recovery Workflow host. */
export interface ImportRecipeRecoveryDurableHost {
  readonly task: typeof Cloudflare.Workflows.task;
  readonly waitForEvent: typeof Cloudflare.Workflows.waitForEvent;
}

/**
 * Acquire and compose the recipe-recovery application runtime. The Workflow
 * class supplies only the durable task and event-wait primitives.
 */
export const makeImportRecipeRecoveryWorkflowHandler = (
  durable: ImportRecipeRecoveryDurableHost
) =>
  Effect.gen(function* makeImportRecipeRecoveryWorkflowHandlerEffect() {
    const runtimeContext = yield* RuntimeContext;
    const queryDatabase =
      yield* Cloudflare.D1.QueryDatabase(MealPlannerDatabase);
    const evidenceBucket =
      yield* Cloudflare.R2.ReadWriteBucket(ImportEvidenceBucket);
    const householdDomain: HouseholdDomainWorkerMethods =
      yield* Cloudflare.Workers.bindWorker(HouseholdDomainWorker);
    const providerGateway = yield* Cloudflare.AI.QueryGateway(
      ImportProviderGateway
    );

    return (rawInput: RecipeRecoveryWorkflowInputEncoded) =>
      Effect.gen(function* runImportRecipeRecoveryWorkflow() {
        const workflowInput = yield* resolveRecipeRecoveryWorkflowInput(
          rawInput
        ).pipe(Effect.orDie);
        const database = yield* queryDatabase.raw;
        const bucket = adaptAcquisitionBucket(evidenceBucket, runtimeContext);
        const evidenceRepositories =
          yield* makeRecipeRecoveryHouseholdEvidenceRepositories({
            acquisitionGeneration: workflowInput.acquisitionGeneration,
            correlationId: workflowInput.trace.correlationId,
            executionGeneration: workflowInput.executionGeneration,
            householdDomain,
            importId: workflowInput.importId,
            mutationId: recoveryMutationId,
            organizationId: workflowInput.organizationId,
          }).pipe(Effect.orDie);
        const intentId = Schema.decodeUnknownSync(RecipeImportIntentId)(
          workflowInput.importId
        );
        const recipeLifecycle = makeHouseholdRecipeDraftLifecycle({
          executionGeneration: workflowInput.executionGeneration,
          householdDomain,
          intentId,
          mutationId: recoveryMutationId,
          organizationId: workflowInput.organizationId,
        });
        const traceStore = makeD1ImportObservabilityTraceStore(database, () =>
          new Date().toISOString()
        );
        const transport = yield* makeWorkersAiTransport(
          providerGateway,
          workflowInput.trace.correlationId,
          traceStore
        ).pipe(Effect.provideService(RuntimeContext, runtimeContext));
        const { extractor } = yield* makeRecipeRecoveryProviderRuntime({
          correlationId: workflowInput.trace.correlationId,
          database,
          now: currentProviderAccountingTimestamp,
          runId: Schema.decodeUnknownSync(ProviderAccountingRunId)(
            `recipe-import:recipe-recovery:${workflowInput.importId}`
          ),
          transport: transport.recipe,
        });
        const recipeRepository = evidenceRepositories.recipe;

        return yield* observeImportWorkflowStart(workflowInput.trace).pipe(
          Effect.andThen(
            runRecipeRecoveryLoop(workflowInput, {
              persistUnknown: (attempt, durableTaskName) =>
                durable.task(
                  durableTaskName,
                  recipeRepository
                    .fail({
                      completedAt: currentProviderAccountingTimestamp(),
                      extractionFingerprint:
                        attempt.currentExtractionFingerprint,
                      failureCode: "provider_error",
                    })
                    .pipe(Effect.orDie)
                ),
              readAttempt: (ordinal) =>
                readHouseholdRecipeRecovery({
                  acquisitionGeneration: workflowInput.acquisitionGeneration,
                  executionGeneration: workflowInput.executionGeneration,
                  householdDomain,
                  importId: workflowInput.importId,
                  organizationId: workflowInput.organizationId,
                  selector: {
                    _tag: "Ordinal",
                    ordinal,
                  },
                }).pipe(
                  Effect.map((attempt) => attempt as RecipeRecoveryAttempt),
                  Effect.catch(() => Effect.succeed(null))
                ),
              runAttempt: (attempt, durableTaskName) =>
                durable
                  .task(
                    durableTaskName,
                    runProviderTaskAttempt(
                      "recipe",
                      produceRecipeDraftForImport({
                        bucket,
                        extractor,
                        importId: attempt.importId,
                        importRepository: evidenceRepositories.current,
                        lifecycle: recipeLifecycle,
                        now: currentProviderAccountingTimestamp,
                        recipeRepository,
                        recovery: {
                          acquisitionGeneration: attempt.acquisitionGeneration,
                          dispatchId: attempt.currentDispatchId,
                          evidenceFingerprint: attempt.evidenceFingerprint,
                          extractionFingerprint:
                            attempt.currentExtractionFingerprint,
                          sourceMediaSha256: attempt.sourceMediaSha256,
                          transcriptSha256: attempt.transcriptSha256,
                          visualManifestSha256: attempt.visualManifestSha256,
                        },
                      }),
                      () => ({
                        _tag: "Succeeded" as const,
                        stage: "recipe" as const,
                      }),
                      workflowInput.trace
                    ),
                    ProviderTaskStepConfig
                  )
                  .pipe(
                    Effect.flatMap((encoded) =>
                      Schema.decodeUnknownEffect(ProviderTaskCheckpoint, {
                        onExcessProperty: "error",
                      })(encoded)
                    ),
                    Effect.orDie
                  ),
              waitForAuthorization: (ordinal) =>
                durable
                  .waitForEvent<RecipeRecoveryAuthorizationType>(
                    `authorize-recipe-recovery-${ordinal}`,
                    {
                      type: recipeRecoveryAuthorizationEventType(ordinal),
                    }
                  )
                  .pipe(Effect.map(({ payload }) => payload)),
            })
          ),
          Effect.provideService(ImportObservabilityTraceStore, traceStore)
        );
      });
  });

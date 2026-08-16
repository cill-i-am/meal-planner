import { RuntimeContext } from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import { Config, Effect, Layer, Option, Schema } from "effect";

import { ImportEvidenceBucket } from "../../infrastructure/import-evidence-bucket.js";
import { ImportProviderGateway } from "../../infrastructure/import-provider-gateway.js";
import { MealPlannerDatabase } from "../../infrastructure/meal-planner-database.js";
import {
  PilotBudgetRunId,
  PilotBudgetTimestamp,
  makePilotProviderBudgetRuntime,
} from "../pilots/pilot-provider-budget.js";
import { makeD1PilotProviderBudgetRepository } from "../pilots/pilot-provider-budget.repository.d1.js";
import { adaptAcquisitionBucket } from "./import-media-acquirer.js";
import { makeD1ImportObservabilityTraceStore } from "./import-observability.d1.js";
import { ImportObservabilityTraceStore } from "./import-observability.js";
import { makePilotProviderDispatchGate } from "./import-provider-kernel.js";
import { makeInstalledRecipeExtractor } from "./import-provider-recipe.js";
import { ProviderTaskCheckpoint } from "./import-provider-workflow-checkpoint.js";
import { runProviderTask } from "./import-provider-workflow-task.js";
import { produceRecipeDraftForImport } from "./import-recipe-draft.js";
import { makeD1RecipeDraftRepository } from "./import-recipe-draft.repository.d1.js";
import {
  RecipeRecoveryAuthorization,
  RecipeRecoveryOrdinal,
  RecipeRecoveryWorkflowInput,
  makeD1RecipeRecoveryRepository,
  recipeRecoveryAuthorizationEventType,
  recipeRecoveryDurableTaskNames,
} from "./import-recipe-recovery.js";
import type { RecipeRecoveryAttempt } from "./import-recipe-recovery.js";
import { makeD1ImportRepository } from "./import.repository.d1.js";

type RecoveryCheckpoint = typeof ProviderTaskCheckpoint.Type;

export interface RecipeRecoveryLoopDependencies<R = never> {
  readonly persistUnknown: (
    attempt: RecipeRecoveryAttempt,
    durableTaskName: string
  ) => Effect.Effect<void, never, R>;
  readonly readAttempt: (
    ordinal: RecipeRecoveryOrdinal
  ) => Effect.Effect<RecipeRecoveryAttempt | null, never, R>;
  readonly runAttempt: (
    attempt: RecipeRecoveryAttempt,
    durableTaskName: string
  ) => Effect.Effect<RecoveryCheckpoint, never, R>;
  readonly waitForAuthorization: (
    ordinal: RecipeRecoveryOrdinal
  ) => Effect.Effect<unknown, never, R>;
}

const failedCheckpoint = (code: string): RecoveryCheckpoint => ({
  _tag: "Failed",
  code,
  stage: "recipe",
});

const nextOrdinal = (ordinal: RecipeRecoveryOrdinal) =>
  Schema.decodeUnknownOption(RecipeRecoveryOrdinal)(ordinal + 1);

/** One bounded recovery algorithm; D1 and an explicit event gate every hop. */
export const runRecipeRecoveryLoop = Effect.fn("RecipeRecoveryWorkflow.run")(
  function* runRecipeRecoveryLoopEffect<R>(
    input: typeof RecipeRecoveryWorkflowInput.Type,
    dependencies: RecipeRecoveryLoopDependencies<R>
  ) {
    let ordinal = input.attemptOrdinal;
    for (let visited = 0; visited < 8; visited += 1) {
      const attempt = yield* dependencies.readAttempt(ordinal);
      if (
        attempt === null ||
        attempt.importId !== input.importId ||
        attempt.acquisitionGeneration !== input.acquisitionGeneration ||
        attempt.ordinal !== ordinal
      ) {
        return failedCheckpoint("recovery_attempt_unavailable");
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
      const next = nextOrdinal(ordinal);
      if (Option.isNone(next)) {
        return checkpoint;
      }

      const rawAuthorization = yield* dependencies.waitForAuthorization(
        next.value
      );
      const authorization = Schema.decodeUnknownOption(
        RecipeRecoveryAuthorization
      )(rawAuthorization);
      if (
        Option.isNone(authorization) ||
        authorization.value.importId !== input.importId ||
        authorization.value.acquisitionGeneration !==
          input.acquisitionGeneration ||
        authorization.value.attemptOrdinal !== next.value
      ) {
        return failedCheckpoint("recovery_authorization_invalid");
      }
      ordinal = next.value;
    }
    return failedCheckpoint("recovery_attempt_limit_reached");
  }
);

const currentTimestamp = () =>
  Schema.decodeUnknownSync(PilotBudgetTimestamp)(new Date().toISOString());

/** A recipe-only host with no acquisition, source, speech, or visual adapter. */
export default class ImportRecipeRecoveryWorkflow extends Cloudflare.Workflow<ImportRecipeRecoveryWorkflow>()(
  "ImportRecipeRecoveryWorkflow",
  Effect.gen(function* ImportRecipeRecoveryWorkflowInit() {
    const runtimeContext = yield* RuntimeContext;
    const queryDatabase =
      yield* Cloudflare.D1.QueryDatabase(MealPlannerDatabase);
    const evidenceBucket =
      yield* Cloudflare.R2.ReadWriteBucket(ImportEvidenceBucket);
    const providerGateway = yield* Cloudflare.AI.QueryGateway(
      ImportProviderGateway
    );
    const runtimeStage = yield* Config.string("ALCHEMY_STAGE");
    const budgetRuntime = makePilotProviderBudgetRuntime(runtimeStage);

    return (rawInput: unknown) =>
      Effect.gen(function* initializeRecipeRecoveryWorkflow() {
        const workflowInput = yield* Schema.decodeUnknownEffect(
          RecipeRecoveryWorkflowInput,
          { onExcessProperty: "error" }
        )(rawInput).pipe(Effect.orDie);
        const database = yield* queryDatabase.raw;
        const rawBucket = yield* evidenceBucket.raw;
        const recoveryRepository = makeD1RecipeRecoveryRepository(
          database,
          runtimeStage
        );
        const dispatch = makePilotProviderDispatchGate({
          correlationId: workflowInput.correlationId,
          now: currentTimestamp,
          repository: makeD1PilotProviderBudgetRepository(
            database,
            runtimeStage
          ),
          runId: Schema.decodeUnknownSync(PilotBudgetRunId)(
            `gaia-118:recipe-recovery:${workflowInput.importId}`
          ),
          runtime: budgetRuntime,
        });
        const extractor = yield* makeInstalledRecipeExtractor({
          client: providerGateway,
          correlationId: workflowInput.correlationId,
          dispatch,
        }).pipe(Effect.provideService(RuntimeContext, runtimeContext));
        const recipeRepository = makeD1RecipeDraftRepository(database);

        return yield* runRecipeRecoveryLoop(workflowInput, {
          persistUnknown: (attempt, durableTaskName) =>
            Cloudflare.Workflows.task(
              durableTaskName,
              recipeRepository
                .fail({
                  completedAt: currentTimestamp(),
                  extractionFingerprint: attempt.currentExtractionFingerprint,
                  failureCode: "provider_error",
                })
                .pipe(Effect.orDie)
            ),
          readAttempt: (ordinal) =>
            recoveryRepository
              .readAttempt({
                acquisitionGeneration: workflowInput.acquisitionGeneration,
                importId: workflowInput.importId,
                ordinal,
              })
              .pipe(Effect.map(Option.getOrNull), Effect.orDie),
          runAttempt: (attempt, durableTaskName) =>
            runProviderTask(
              durableTaskName,
              "recipe",
              produceRecipeDraftForImport({
                bucket: adaptAcquisitionBucket(rawBucket),
                extractor,
                importId: attempt.importId,
                importRepository: makeD1ImportRepository(database),
                now: currentTimestamp,
                recipeRepository,
                recovery: {
                  acquisitionGeneration: attempt.acquisitionGeneration,
                  dispatchId: attempt.currentDispatchId,
                  evidenceFingerprint: attempt.evidenceFingerprint,
                  extractionFingerprint: attempt.currentExtractionFingerprint,
                  sourceMediaSha256: attempt.sourceMediaSha256,
                  transcriptSha256: attempt.transcriptSha256,
                  visualManifestSha256: attempt.visualManifestSha256,
                },
              }),
              () => ({
                _tag: "Succeeded" as const,
                stage: "recipe" as const,
              }),
              workflowInput.correlationId
            ).pipe(
              Effect.flatMap((encoded) =>
                Schema.decodeUnknownEffect(ProviderTaskCheckpoint)(encoded)
              ),
              Effect.orDie
            ),
          waitForAuthorization: (ordinal) =>
            Cloudflare.Workflows.waitForEvent<unknown>(
              `authorize-recipe-recovery-${ordinal}`,
              { type: recipeRecoveryAuthorizationEventType(ordinal) }
            ).pipe(Effect.map(({ payload }) => payload)),
        }).pipe(
          Effect.provideService(
            ImportObservabilityTraceStore,
            makeD1ImportObservabilityTraceStore(database, () =>
              new Date().toISOString()
            )
          )
        );
      });
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        Cloudflare.AI.QueryGatewayBinding,
        Cloudflare.D1.QueryDatabaseBinding,
        Cloudflare.R2.ReadWriteBucketBinding
      )
    )
  )
) {}

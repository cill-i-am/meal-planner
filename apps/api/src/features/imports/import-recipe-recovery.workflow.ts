import { RuntimeContext } from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import { Config, Effect, Layer, Schema } from "effect";

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
import {
  makeInstalledRecipeExtractor,
  makePilotProviderDispatchGate,
} from "./import-provider-adapters.js";
import { ProviderTaskCheckpoint } from "./import-provider-workflow-checkpoint.js";
import { runProviderTask } from "./import-provider-workflow-task.js";
import { produceRecipeDraftForImport } from "./import-recipe-draft.js";
import { makeD1RecipeDraftRepository } from "./import-recipe-draft.repository.d1.js";
import {
  RecipeRecoveryWorkflowInput,
  makeD1RecipeRecoveryRepository,
} from "./import-recipe-recovery.js";
import { makeD1ImportRepository } from "./import.repository.d1.js";

const currentTimestamp = () =>
  Schema.decodeUnknownSync(PilotBudgetTimestamp)(new Date().toISOString());

/**
 * A recipe-only recovery host. It deliberately has no acquisition object,
 * source resolver, speech transcriber, visual extractor, or source queue.
 */
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
        return yield* Effect.gen(function* runRecipeRecoveryWorkflow() {
          const rawBucket = yield* evidenceBucket.raw;
          const recoveryRepository = makeD1RecipeRecoveryRepository(
            database,
            runtimeStage
          );
          const recovery = yield* (
            workflowInput.resumeOrdinal === 1
              ? recoveryRepository.readResume(workflowInput)
              : recoveryRepository.read(workflowInput)
          ).pipe(Effect.orDie);
          const recoveryTaskVersion = `v${recovery.recoveryOrdinal}`;
          const dispatch = makePilotProviderDispatchGate({
            correlationId: workflowInput.correlationId,
            now: currentTimestamp,
            repository: makeD1PilotProviderBudgetRepository(
              database,
              runtimeStage
            ),
            runId: Schema.decodeUnknownSync(PilotBudgetRunId)(
              `gaia-118:recipe-recovery:${recovery.importId}`
            ),
            runtime: budgetRuntime,
          });
          const extractor = yield* makeInstalledRecipeExtractor({
            client: providerGateway,
            correlationId: workflowInput.correlationId,
            dispatch,
          }).pipe(Effect.provideService(RuntimeContext, runtimeContext));
          const recipeRepository = makeD1RecipeDraftRepository(database);
          const encoded = yield* runProviderTask(
            `extract-recipe-recovery-${recoveryTaskVersion}`,
            "recipe",
            produceRecipeDraftForImport({
              bucket: adaptAcquisitionBucket(rawBucket),
              extractor,
              importId: recovery.importId,
              importRepository: makeD1ImportRepository(database),
              now: currentTimestamp,
              recipeRepository,
              recovery: {
                acquisitionGeneration: recovery.acquisitionGeneration,
                dispatchId: recovery.recoveryDispatchId,
                evidenceFingerprint: recovery.evidenceFingerprint,
                extractionFingerprint: recovery.recoveryExtractionFingerprint,
                transcriptSha256: recovery.transcriptSha256,
                visualManifestSha256: recovery.visualManifestSha256,
              },
            }),
            () => ({
              _tag: "Succeeded" as const,
              stage: "recipe" as const,
            }),
            workflowInput.correlationId
          );
          const checkpoint = yield* Schema.decodeUnknownEffect(
            ProviderTaskCheckpoint
          )(encoded).pipe(Effect.orDie);
          if (checkpoint._tag === "Failed") {
            yield* Cloudflare.Workflows.task(
              `persist-recipe-recovery-terminal-${recoveryTaskVersion}`,
              recipeRepository
                .fail({
                  completedAt: currentTimestamp(),
                  extractionFingerprint: recovery.recoveryExtractionFingerprint,
                  failureCode: "provider_error",
                })
                .pipe(Effect.orDie)
            );
          }
          return checkpoint;
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

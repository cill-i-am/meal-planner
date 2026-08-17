import { RecipeImportIntentId } from "@meal-planner/recipe-import-api";
import type { AnyD1Database } from "drizzle-orm/d1";
import { Effect, Layer, Schema } from "effect";
import type { Redacted } from "effect";

import { ImportBatchId, ImportBatchItemId } from "./import-batch.contracts.js";
import type { ImportBatchQueueShape } from "./import-batch.service.js";
import {
  ImportBatchService,
  makeImportBatchService,
} from "./import-batch.service.js";
import {
  OperatorCarouselImportService,
  makeOperatorCarouselImportService,
} from "./import-carousel-operator.service.js";
import { stageOperatorCarouselForWorkflow } from "./import-carousel-staging.js";
import { RecipeImportIntentApplication } from "./import-intent-api.http.js";
import { ImportIntentWorkflowTerminator } from "./import-intent-execution.js";
import type { ImportIntentWorkflowTerminatorShape } from "./import-intent-execution.js";
import {
  RecipeImportIntentReviewApplication,
  makeRecipeImportIntentReviewApplication,
} from "./import-intent-review.js";
import { makeD1RecipeImportIntentReviewRepository } from "./import-intent-review.repository.d1.js";
import {
  ImportIntentIdGenerator,
  makeImportIntentApplication,
} from "./import-intent.js";
import type { ImportPrincipal } from "./import-intent.js";
import type { AcquisitionBucketLike } from "./import-media-acquirer.js";
import { makeD1ImportObservabilityTraceStore } from "./import-observability.d1.js";
import type { ImportTraceContext } from "./import-observability.js";
import { ImportObservabilityTraceStore } from "./import-observability.js";
import {
  ProviderTerminalSettlementService,
  makeD1ProviderTerminalSettlementService,
} from "./import-provider-terminal-settlement.js";
import { makeD1ImportBatchStore } from "./import-queue-acceptance.d1.js";
import type { RecipeRecoveryWorkflowStarterShape } from "./import-recipe-recovery.js";
import { ImportSystemAuthorizer } from "./import-system.auth.js";
import { ImportAuthorizer, makeImportAuthorizer } from "./import.auth.js";
import type { ConfiguredImportPrincipal } from "./import.auth.js";
import { ImportTimestamp } from "./import.contracts.js";
import { makeD1ImportRepository } from "./import.repository.d1.js";
import type { ImportWorkflowReconcilerShape } from "./import.workflow.js";
import { CanonicalSourceIdentityResolver } from "./source-identity.js";
import { makeTikTokCanonicalSourceIdentityResolver } from "./source-identity.tiktok.js";

/** Inputs required to construct the import HTTP route services once. */
export interface ImportWorkerRequestLayerInput {
  readonly bucket: AcquisitionBucketLike;
  readonly configuredPrincipals: readonly ConfiguredImportPrincipal[];
  readonly database: AnyD1Database;
  readonly importWorkflowStarter: ImportWorkflowReconcilerShape;
  readonly importWorkflowTerminator: ImportIntentWorkflowTerminatorShape;
  readonly now: () => string;
  readonly queue: ImportBatchQueueShape;
  readonly recipeRecoveryStarter: RecipeRecoveryWorkflowStarterShape;
  readonly runtimeStage: string;
  readonly systemApiToken: Redacted.Redacted<string>;
  readonly systemPrincipal: ImportPrincipal;
  readonly trace: ImportTraceContext;
}

const timestamp = (now: () => string) =>
  Schema.decodeUnknownSync(ImportTimestamp)(now());

/** Construct the typed import route services at the Worker composition root. */
export const makeImportWorkerRequestLayer = (
  input: ImportWorkerRequestLayerInput
) => {
  const d1ImportRepository = makeD1ImportRepository(input.database);
  const identityResolver = makeTikTokCanonicalSourceIdentityResolver(
    globalThis.fetch
  );
  const intentApplication = makeImportIntentApplication(
    d1ImportRepository,
    input.importWorkflowStarter,
    input.trace
  );
  const batch = Layer.succeed(
    ImportBatchService,
    ImportBatchService.of(
      makeImportBatchService({
        identityResolver,
        newBatchId: () =>
          Schema.decodeUnknownSync(ImportBatchId)(crypto.randomUUID()),
        newItemId: () =>
          Schema.decodeUnknownSync(ImportBatchItemId)(crypto.randomUUID()),
        now: () => timestamp(input.now),
        queue: input.queue,
        store: makeD1ImportBatchStore(input.database),
      })
    )
  );
  const carousel = Layer.succeed(
    OperatorCarouselImportService,
    OperatorCarouselImportService.of(
      makeOperatorCarouselImportService({
        application: intentApplication,
        identityResolver,
        newIntentId: () =>
          Schema.decodeUnknownSync(RecipeImportIntentId)(crypto.randomUUID()),
        now: input.now,
        pipeline: {
          preflight: () => Effect.void,
          stage: (pipelineInput) =>
            stageOperatorCarouselForWorkflow({
              adapter: pipelineInput.adapter,
              bucket: input.bucket,
              descriptor: {
                canonicalId: pipelineInput.canonicalId,
                declaredPageCount: pipelineInput.declaredPageCount,
                kind: "tiktok_carousel",
                sourceUrl: pipelineInput.sourceUrl,
              },
              importId: pipelineInput.importId,
            }),
        },
      })
    )
  );
  const settlement = Layer.succeed(
    ProviderTerminalSettlementService,
    ProviderTerminalSettlementService.of(
      makeD1ProviderTerminalSettlementService({
        database: input.database,
        now: () => timestamp(input.now),
        recipeRecoveryStarter: input.recipeRecoveryStarter,
        runtimeStage: input.runtimeStage,
        workflowStarter: input.importWorkflowStarter,
      })
    )
  );
  const intentReview = makeRecipeImportIntentReviewApplication(
    makeD1RecipeImportIntentReviewRepository(input.database)
  );

  return Layer.mergeAll(
    Layer.effect(
      ImportAuthorizer,
      Effect.map(
        makeImportAuthorizer({
          configuredPrincipals: input.configuredPrincipals,
        }),
        ImportAuthorizer.of
      )
    ),
    Layer.effect(
      ImportSystemAuthorizer,
      Effect.map(
        makeImportAuthorizer({
          configuredPrincipals: [
            {
              principal: input.systemPrincipal,
              token: input.systemApiToken,
            },
          ],
        }),
        ImportSystemAuthorizer.of
      )
    ),
    ImportIntentIdGenerator.live,
    Layer.succeed(
      CanonicalSourceIdentityResolver,
      CanonicalSourceIdentityResolver.of(identityResolver)
    ),
    Layer.succeed(
      ImportIntentWorkflowTerminator,
      ImportIntentWorkflowTerminator.of(input.importWorkflowTerminator)
    ),
    Layer.succeed(
      RecipeImportIntentApplication,
      RecipeImportIntentApplication.of(intentApplication)
    ),
    Layer.succeed(
      RecipeImportIntentReviewApplication,
      RecipeImportIntentReviewApplication.of(intentReview)
    ),
    batch,
    carousel,
    Layer.succeed(
      ImportObservabilityTraceStore,
      makeD1ImportObservabilityTraceStore(input.database, input.now)
    ),
    settlement
  );
};

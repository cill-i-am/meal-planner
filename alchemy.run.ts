import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";

import TikTokMediaContainerLive from "./apps/api/src/features/imports/import-media-container.runtime.js";
import { EvidenceRetentionSeconds } from "./apps/api/src/features/imports/import-media.model.js";
import {
  ImportBatchDeadLetterQueue,
  ImportBatchQueue,
} from "./apps/api/src/infrastructure/import-batch-queue.js";
import { ImportEvidenceBucket } from "./apps/api/src/infrastructure/import-evidence-bucket.js";
import { MealPlannerDatabase } from "./apps/api/src/infrastructure/meal-planner-database.js";
import MealPlannerApi from "./apps/api/src/worker.js";

export default Alchemy.Stack(
  "MealPlanner",
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(),
  },
  Effect.gen(function* MealPlannerStack() {
    const database = yield* MealPlannerDatabase;
    const evidenceBucket = yield* ImportEvidenceBucket;
    const importBatchQueue = yield* ImportBatchQueue;
    const importBatchDeadLetterQueue = yield* ImportBatchDeadLetterQueue;
    const api = yield* MealPlannerApi;

    return {
      apiUrl: api.url,
      apiWorkerName: api.workerName,
      databaseName: database.databaseName,
      evidenceBucketName: evidenceBucket.bucketName,
      evidenceRetentionSeconds: EvidenceRetentionSeconds,
      importBatchDeadLetterQueueName: importBatchDeadLetterQueue.queueName,
      importBatchQueueName: importBatchQueue.queueName,
    };
  }).pipe(Effect.provide(TikTokMediaContainerLive))
);

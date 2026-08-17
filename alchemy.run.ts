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
import { ImportProviderGateway } from "./apps/api/src/infrastructure/import-provider-gateway.js";
import { MealPlannerAuthDatabase } from "./apps/api/src/infrastructure/meal-planner-auth-database.js";
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
    const authDatabase = yield* MealPlannerAuthDatabase;
    const evidenceBucket = yield* ImportEvidenceBucket;
    const importBatchQueue = yield* ImportBatchQueue;
    const importBatchDeadLetterQueue = yield* ImportBatchDeadLetterQueue;
    const importProviderGateway = yield* ImportProviderGateway;
    const api = yield* MealPlannerApi;
    const website = yield* Cloudflare.Website.Vite("MealPlannerWebsite", {
      assets: { runWorkerFirst: ["/api/auth/*", "/v1/*"] },
      env: { MEAL_PLANNER_API: api },
      main: "src/worker.ts",
      observability: {
        enabled: true,
        headSamplingRate: 1,
        logs: {
          enabled: true,
          headSamplingRate: 1,
          invocationLogs: false,
          persist: true,
        },
        traces: { enabled: false },
      },
      rootDir: "./apps/web",
    });

    return {
      apiUrl: api.url,
      apiWorkerName: api.workerName,
      authDatabaseName: authDatabase.databaseName,
      databaseName: database.databaseName,
      evidenceBucketName: evidenceBucket.bucketName,
      evidenceRetentionSeconds: EvidenceRetentionSeconds,
      importBatchDeadLetterQueueName: importBatchDeadLetterQueue.queueName,
      importBatchQueueName: importBatchQueue.queueName,
      importProviderGatewayId: importProviderGateway.gatewayId,
      websiteUrl: website.url,
      websiteWorkerName: website.workerName,
    };
  }).pipe(Effect.provide(TikTokMediaContainerLive))
);

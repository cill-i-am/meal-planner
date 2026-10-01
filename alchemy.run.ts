import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import HouseholdDomainWorkerLive from "./apps/api/src/features/households/household-domain-worker.js";
import TikTokMediaContainerLive from "./apps/api/src/features/imports/import-media-container.runtime.js";
import { EvidenceRetentionSeconds } from "./apps/api/src/features/imports/import-media.model.js";
import { ImportEvidenceBucket } from "./apps/api/src/infrastructure/import-evidence-bucket.js";
import { ImportProviderGateway } from "./apps/api/src/infrastructure/import-provider-gateway.js";
import { MealPlannerAuthDatabase } from "./apps/api/src/infrastructure/meal-planner-auth-database.js";
import { ProviderAccountingDatabase } from "./apps/api/src/infrastructure/provider-accounting-database.js";
import MealPlannerApi from "./apps/api/src/worker.js";
import { websiteSource } from "./apps/web/website-source.js";

export default Alchemy.Stack(
  "MealPlanner",
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(),
  },
  Effect.gen(function* MealPlannerStack() {
    const stage = yield* Alchemy.Stage;
    const providerAccountingDatabase = yield* ProviderAccountingDatabase;
    const authDatabase = yield* MealPlannerAuthDatabase;
    const evidenceBucket = yield* ImportEvidenceBucket;
    const importProviderGateway = yield* ImportProviderGateway;
    // Each long-lived stage owns a distinct sending domain. Ephemeral previews
    // do not create or delete production or E2E mail configuration.
    const emailSending =
      stage === "prod" || stage === "e2e"
        ? yield* Cloudflare.Email.SendingSubdomain("MealPlannerMail", {
            name: stage === "e2e" ? "mail.e2e.ceird.app" : "mail.ceird.app",
            zoneId: yield* Config.string("CEIRD_ZONE_ID"),
          })
        : undefined;
    const api = yield* MealPlannerApi;
    const websiteAddress =
      stage === "e2e"
        ? {
            domain: {
              name: "e2e.ceird.app",
              zoneId: yield* Config.string("CEIRD_ZONE_ID"),
            },
            workersDev: { enabled: false, previewsEnabled: false },
          }
        : { workersDev: true };
    const website = yield* Cloudflare.Website.Vite("MealPlannerWebsite", {
      assets: { runWorkerFirst: ["/api/auth/*", "/v1/*"] },
      dev: { port: 4399 },
      ...websiteAddress,
      env: { MEAL_PLANNER_API: api },
      ...websiteSource,
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
      emailSendingEnabled: emailSending?.enabled ?? null,
      emailSendingSubdomain: emailSending?.name ?? null,
      emailSendingSubdomainId: emailSending?.subdomainId ?? null,
      evidenceBucketName: evidenceBucket.bucketName,
      evidenceRetentionSeconds: EvidenceRetentionSeconds,
      importProviderGatewayId: importProviderGateway.gatewayId,
      providerAccountingDatabaseName: providerAccountingDatabase.databaseName,
      websiteUrl: website.url,
      websiteWorkerName: website.workerName,
    };
  }).pipe(
    Effect.provide(
      Layer.mergeAll(HouseholdDomainWorkerLive, TikTokMediaContainerLive)
    )
  )
);

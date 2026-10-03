import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import HouseholdDomainWorkerLive from "./apps/api/src/features/households/household-domain-worker.js";
import TikTokMediaContainerLive from "./apps/api/src/features/imports/import-media-container.runtime.js";
import { EvidenceRetentionSeconds } from "./apps/api/src/features/imports/import-media.model.js";
import { ImportEvidenceBucket } from "./apps/api/src/infrastructure/import-evidence-bucket.js";
import {
  ImportProviderGateway,
  ImportProviderGatewayId,
} from "./apps/api/src/infrastructure/import-provider-gateway.js";
import { MealPlannerAuthDatabase } from "./apps/api/src/infrastructure/meal-planner-auth-database.js";
import { ProviderAccountingDatabase } from "./apps/api/src/infrastructure/provider-accounting-database.js";
import { workerObservability } from "./apps/api/src/infrastructure/worker-observability.js";
import MealPlannerApi from "./apps/api/src/worker.js";
import { websiteSource } from "./apps/web/website-source.js";

export default Alchemy.Stack(
  "MealPlanner",
  {
    providers: Cloudflare.providers(),
    state: Layer.unwrap(
      Alchemy.AlchemyContext.pipe(
        Effect.map(({ dev }) =>
          dev ? Alchemy.localState() : Cloudflare.state()
        )
      )
    ),
  },
  Effect.gen(function* MealPlannerStack() {
    const stage = yield* Alchemy.Stage;
    const { dev } = yield* Alchemy.AlchemyContext;
    const providerAccountingDatabase = yield* ProviderAccountingDatabase;
    const authDatabase = yield* MealPlannerAuthDatabase;
    const evidenceBucket = yield* ImportEvidenceBucket;
    const importProviderGateway = dev
      ? undefined
      : yield* ImportProviderGateway;
    // The sending domain is account-wide. Only production owns its lifecycle;
    // preview and developer stages must not create or delete the same domain.
    const emailSending =
      stage === "prod"
        ? yield* Cloudflare.Email.SendingSubdomain("MealPlannerMail", {
            name: "mail.ceird.app",
            zoneId: yield* Config.String("CEIRD_ZONE_ID"),
          })
        : undefined;
    const browserAnalytics =
      stage === "prod" && !dev
        ? yield* Cloudflare.Rum.Site("MealPlannerWebAnalytics", {
            host: yield* Config.String("WEB_ANALYTICS_HOST"),
          })
        : undefined;
    const api = yield* MealPlannerApi;
    const website = yield* Cloudflare.Website.Vite("MealPlannerWebsite", {
      assets: { runWorkerFirst: ["/api/auth/*", "/v1/*"] },
      env: {
        BROWSER_ANALYTICS_TOKEN: browserAnalytics?.siteToken ?? "",
        MEAL_PLANNER_API: api,
      },
      ...websiteSource,
      ...workerObservability,
      rootDir: "./apps/web",
    });

    return {
      apiUrl: api.url,
      apiWorkerName: api.workerName,
      authDatabaseName: authDatabase.databaseName,
      emailSendingEnabled: emailSending?.enabled ?? null,
      emailSendingSubdomain: emailSending?.name ?? null,
      evidenceBucketName: evidenceBucket.bucketName,
      evidenceRetentionSeconds: EvidenceRetentionSeconds,
      importProviderGatewayId:
        importProviderGateway?.gatewayId ?? ImportProviderGatewayId,
      providerAccountingDatabaseName: providerAccountingDatabase.databaseName,
      webAnalyticsSiteId: browserAnalytics?.siteTag ?? null,
      websiteUrl: website.url,
      websiteWorkerName: website.workerName,
    };
  }).pipe(
    Effect.provide(
      Layer.mergeAll(HouseholdDomainWorkerLive, TikTokMediaContainerLive)
    )
  )
);

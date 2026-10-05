import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as GitHub from "alchemy/GitHub";
import * as Output from "alchemy/Output";
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
import { productionWebsiteHostname } from "./apps/web/website-domain.js";
import { websiteSource } from "./apps/web/website-source.js";

const websiteDomainConfiguration = (dev: boolean, stage: string) =>
  Effect.gen(function* WebsiteDomainConfiguration() {
    if (dev || (stage !== "prod" && stage !== "e2e")) {
      return;
    }
    const zoneId = yield* Config.String("CEIRD_ZONE_ID");
    if (stage === "e2e") {
      return {
        domain: { name: "e2e.ceird.app", zoneId },
        workersDev: { enabled: false, previewsEnabled: false },
      };
    }
    return { domain: { name: productionWebsiteHostname, zoneId } };
  });

const stageEmailSending = (dev: boolean, stage: string) =>
  Effect.gen(function* StageEmailSending() {
    if (dev || (stage !== "prod" && stage !== "e2e")) {
      return;
    }
    return yield* Cloudflare.Email.SendingSubdomain("MealPlannerMail", {
      name: stage === "e2e" ? "mail.e2e.ceird.app" : "mail.ceird.app",
      zoneId: yield* Config.String("CEIRD_ZONE_ID"),
    });
  });

export default Alchemy.Stack(
  "MealPlanner",
  {
    providers: Layer.mergeAll(Cloudflare.providers(), GitHub.providers()),
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
    const emailSending = yield* stageEmailSending(dev, stage);
    const browserAnalytics =
      stage === "prod" && !dev
        ? yield* Cloudflare.Rum.Site("MealPlannerWebAnalytics", {
            host: productionWebsiteHostname,
          })
        : undefined;
    const api = yield* MealPlannerApi;
    const websiteDomainProps = yield* websiteDomainConfiguration(dev, stage);
    const website = yield* Cloudflare.Website.Vite("MealPlannerWebsite", {
      assets: { runWorkerFirst: ["/api/auth/*", "/v1/*"] },
      dev: { port: 4399 },
      env: {
        BROWSER_ANALYTICS_TOKEN: browserAnalytics?.siteToken ?? "",
        MEAL_PLANNER_API: api,
      },
      ...websiteDomainProps,
      ...websiteSource,
      ...workerObservability,
      rootDir: "./apps/web",
    });

    if (!dev) {
      const github = yield* GitHub.GitHubEnv;
      if (github?.pr) {
        yield* GitHub.Comment("PreviewComment", {
          allowDelete: true,
          body: Output.interpolate`Preview: ${website.url}

Commit: ${github.sha}`,
          issueNumber: github.pr,
          owner: github.owner,
          repository: github.repository,
        });
      }
    }

    return {
      apiUrl: api.url,
      apiWorkerName: api.workerName,
      authDatabaseName: authDatabase.databaseName,
      emailSendingEnabled: emailSending?.enabled ?? null,
      emailSendingSubdomain: emailSending?.name ?? null,
      emailSendingSubdomainId: emailSending?.subdomainId ?? null,
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

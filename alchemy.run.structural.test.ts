import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const readRepoFile = (path: string): string =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf-8");

describe("Alchemy source structure (no provider lifecycle or runtime proof)", () => {
  it("composes the real private provider path without the synthetic import service", () => {
    const stackSource = readRepoFile("./alchemy.run.ts");
    const workerSource = readRepoFile("./apps/api/src/worker.ts");
    const workflowSource = readRepoFile(
      "./apps/api/src/features/imports/import.workflow.ts"
    );
    const providerTaskSource = readRepoFile(
      "./apps/api/src/features/imports/import-provider-workflow-task.ts"
    );
    const gatewaySource = readRepoFile(
      "./apps/api/src/infrastructure/import-provider-gateway.ts"
    );

    expect(workerSource).not.toContain(
      "makeProviderFreeSyntheticImportService"
    );
    expect(workflowSource).toContain("makeInstalledSpeechTranscriber");
    expect(workflowSource).toContain("makeInstalledVisualEvidenceExtractor");
    expect(workflowSource).toContain("makeInstalledRecipeExtractor");
    expect(workflowSource).toContain("makePilotProviderDispatchGate");
    expect(workflowSource).toContain("Cloudflare.AI.QueryGatewayBinding");
    expect(workflowSource).toContain('"extract-carousel-visual-evidence-v1"');
    expect(workflowSource).toContain('"extract-carousel-recipe-v1"');
    expect(workflowSource).toContain("runProviderTask,");
    expect(workflowSource).toContain("runProviderTaskAttempt,");
    expect(providerTaskSource).toContain("ProviderTaskStepConfig");
    expect(workerSource).toContain("stageOperatorCarouselForWorkflow");
    expect(workerSource).not.toContain("carouselProcessingUnavailable");
    expect(gatewaySource).toContain('"ImportProviderGateway"');
    expect(gatewaySource).toContain("collectLogs: false");
    expect(gatewaySource).toContain("zdr: true");
    expect(stackSource).toContain("importProviderGatewayId");
  });

  it("declares exactly one default-exported MealPlanner stack with Cloudflare state", () => {
    const source = readRepoFile("./alchemy.run.ts");

    expect(source.match(/export default Alchemy\.Stack/gu)).toHaveLength(1);
    expect(source.match(/Alchemy\.Stack\(/gu)).toHaveLength(1);
    expect(source).toMatch(/Alchemy\.Stack\(\s*"MealPlanner"/u);
    expect(source).toContain("providers: Cloudflare.providers()");
    expect(source).toContain("state: Cloudflare.state()");
  });

  it("keeps the Worker identity stable, private, and preserves its optional URL output", () => {
    const stackSource = readRepoFile("./alchemy.run.ts");
    const workerSource = readRepoFile("./apps/api/src/worker.ts");

    expect(workerSource).toContain('"MealPlannerApi"');
    expect(workerSource).toContain("main: import.meta.url");
    expect(workerSource).toContain("observability: {");
    expect(workerSource).toContain("invocationLogs: false");
    expect(workerSource).toMatch(
      /traces:\s*\{\s*\/\/[^]*?enabled:\s*false,\s*\}/u
    );
    expect(workerSource).not.toContain("invocationLogs: true");
    expect(workerSource).not.toMatch(/traces:\s*\{[^}]*enabled:\s*true/u);
    expect(workerSource).toContain("url: false");
    expect(workerSource).toContain("HealthRoutes");
    expect(workerSource).toContain("ImportRouteDefinitions");
    expect(stackSource).toContain("apiUrl: api.url");
    expect(stackSource).toContain("apiWorkerName: api.workerName");
    expect(stackSource).toContain("databaseName: database.databaseName");
    expect(stackSource).not.toContain("api.url.as<string>()");
  });

  it("declares one stable D1 resource with versioned local migrations", () => {
    const databaseSource = readRepoFile(
      "./apps/api/src/infrastructure/meal-planner-database.ts"
    );
    const migration = readRepoFile(
      "./apps/api/migrations/0000_recipe_imports.sql"
    );

    expect(databaseSource).toContain('"MealPlannerDatabase"');
    expect(databaseSource).toContain('migrationsDir: "./apps/api/migrations"');
    expect(databaseSource).toContain('migrationsTable: "d1_migrations"');
    expect(migration).toContain("CREATE TABLE `recipe_imports`");
    expect(migration).toContain("CREATE TABLE `import_requests`");
  });

  it("keeps exactly the reviewed deployable SQL migrations", () => {
    const migrationsDirectory = fileURLToPath(
      new URL("apps/api/migrations", import.meta.url)
    );
    const sqlFiles = readdirSync(migrationsDirectory, {
      recursive: true,
    })
      .map(String)
      .filter((path) => path.endsWith(".sql"))
      .toSorted();

    expect(sqlFiles).toEqual([
      "0000_recipe_imports.sql",
      "0001_import_media_acquisition.sql",
      "0002_import_speech_transcription.sql",
      "0003_import_visual_evidence.sql",
      "0004_import_recipe_extractions.sql",
      "0005_recipe_reviews.sql",
      "0006_import_carousel_evidence.sql",
      "0007_import_queue_acceptance.sql",
      "0008_pilot_provider_budget.sql",
      "0009_provider_terminal_recovery.sql",
      "0010_provider_recovery_stage_key.sql",
      "0011_provider_visual_recovery.sql",
      "0012_provider_visual_recovery_completion_guard.sql",
      "0013_provider_visual_retry_exhaustion_projection.sql",
      "0014_provider_visual_second_recovery.sql",
      "0015_provider_visual_unknown_outcome_second_recovery.sql",
      "0016_recipe_terminal_projection.sql",
      "0017_recipe_recovery.sql",
      "0018_recipe_second_recovery.sql",
      "0019_recipe_third_recovery.sql",
      "0020_recipe_fourth_recovery.sql",
      "0021_recipe_fifth_recovery.sql",
      "0022_recipe_sixth_recovery.sql",
    ]);
  });

  it("keeps the generated migration and snapshot byte-correlated for acquisition generations", () => {
    const migration = readRepoFile(
      "./apps/api/migrations/0001_import_media_acquisition.sql"
    );
    const snapshot = readRepoFile(
      "./apps/api/migrations/meta/20260720143000_import_media_acquisition/snapshot.json"
    );
    const parsedSnapshot = JSON.parse(snapshot) as {
      readonly ddl: readonly Record<string, unknown>[];
    };
    expect(migration).toContain(
      "`acquisition_generation` integer DEFAULT 0 NOT NULL"
    );
    expect(parsedSnapshot.ddl).toContainEqual(
      expect.objectContaining({
        default: 0,
        entityType: "columns",
        name: "acquisition_generation",
        notNull: true,
        table: "recipe_imports",
        type: "integer",
      })
    );
    const requiredFragments = [
      'typeof("acquisition_generation") = \'integer\' AND "acquisition_generation" >= 0 AND "acquisition_generation" <= 9007199254740991',
      "'/acquisition/v1/generations/' || \"acquisition_generation\" || '/original.mp4'",
      "'/acquisition/v1/generations/' || \"acquisition_generation\" || '/manifest.json'",
    ] as const;

    for (const fragment of requiredFragments) {
      expect(migration).toContain(fragment);
      expect(snapshot).toContain(JSON.stringify(fragment).slice(1, -1));
    }
    expect(migration).toContain(
      "`acquisition_generation`) SELECT `canonical_source_id`"
    );
    expect(migration).toContain(", 0 FROM `recipe_imports`");
  });

  it("binds the least-privilege acquisition resources without Images or Sharp", () => {
    const workerSource = readRepoFile("./apps/api/src/worker.ts");
    const databaseSource = readRepoFile(
      "./apps/api/src/infrastructure/meal-planner-database.ts"
    );
    const workflowSource = readRepoFile(
      "./apps/api/src/features/imports/import.workflow.ts"
    );
    const objectSource = readRepoFile(
      "./apps/api/src/features/imports/import-media-acquisition-object.ts"
    );
    const bucketSource = readRepoFile(
      "./apps/api/src/infrastructure/import-evidence-bucket.ts"
    );
    const mediaModelSource = readRepoFile(
      "./apps/api/src/features/imports/import-media.model.ts"
    );
    const allSource = `${workerSource}\n${databaseSource}\n${workflowSource}\n${objectSource}\n${bucketSource}`;

    expect(workerSource).toContain("Cloudflare.D1.QueryDatabase");
    expect(workerSource).toContain("ImportAcquisitionWorkflow");
    expect(workerSource).not.toContain("ImportWorkflowStarterDeferred");
    expect(workflowSource).toContain('"ImportAcquisitionWorkflow"');
    expect(workflowSource).toContain("Cloudflare.R2.ReadWriteBucket");
    expect(objectSource).toContain('"ImportMediaAcquisitionObject"');
    expect(objectSource).toContain("enableInternet: true");
    expect(bucketSource).toContain('"ImportEvidenceBucket"');
    expect(bucketSource).toContain("cors: []");
    expect(bucketSource).toContain("domains: []");
    expect(bucketSource).not.toMatch(/r2\.dev/iu);
    expect(mediaModelSource).toContain(
      "export const EvidenceRetentionSeconds = 604_800"
    );
    expect(workerSource).toMatch(
      /Config\.redacted\(\s*"MEAL_PLANNER_IMPORT_API_TOKEN"\s*\)/u
    );
    expect(allSource).not.toMatch(/Cloudflare\.Images|Images\.|sharp/iu);
  });

  it("declares isolated queues with exactly one private bounded Worker consumer", () => {
    const stackSource = readRepoFile("./alchemy.run.ts");
    const workerSource = readRepoFile("./apps/api/src/worker.ts");
    const queueSource = readRepoFile(
      "./apps/api/src/infrastructure/import-batch-queue.ts"
    );

    expect(queueSource).toContain('"ImportBatchQueue"');
    expect(queueSource).toContain('"ImportBatchDeadLetterQueue"');
    expect(queueSource).toContain("makeCloudflareImportBatchQueue");
    expect(queueSource).not.toContain("Consumer(");
    expect(queueSource).not.toContain("consumeQueueMessages");
    expect(workerSource.match(/consumeQueueMessages/gu)).toHaveLength(1);
    expect(workerSource).toContain("ImportBatchQueueMessage");
    expect(workerSource).toContain("ImportBatchDeadLetterQueue");
    expect(workerSource).toContain(
      "deadLetterQueue: importBatchDeadLetterQueue.queueName"
    );
    expect(workerSource).toContain(
      "deadLetterQueueId: importBatchDeadLetterQueue.queueId"
    );
    expect(workerSource).not.toMatch(
      /yield\*\s+yield\*\s+importBatchDeadLetterQueue/u
    );
    expect(workerSource).toContain("Cloudflare.Queues.EventSourceLive");
    expect(workerSource).toContain("batchSize: 1");
    expect(workerSource).toContain("maxConcurrency: 1");
    expect(workerSource).toContain("maxRetries: 3");
    expect(stackSource).toContain("importBatchQueueName");
    expect(stackSource).toContain("importBatchDeadLetterQueueName");
  });

  it("keeps Workflow checkpoints generation-fenced and acquisition R2 writes non-destructive", () => {
    const workflowSource = readRepoFile(
      "./apps/api/src/features/imports/import.workflow.ts"
    );
    const acquirerSource = readRepoFile(
      "./apps/api/src/features/imports/import-media-acquirer.ts"
    );
    const bucketSource = readRepoFile(
      "./apps/api/src/infrastructure/import-evidence-bucket.ts"
    );
    const modelSource = readRepoFile(
      "./apps/api/src/features/imports/import-media.model.ts"
    );

    expect(workflowSource).toContain('"claim-acquisition-v1"');
    expect(workflowSource).toContain('"resolve-acquire-store-verify-v2"');
    expect(workflowSource).toContain('"record-acquisition-v2"');
    expect(workflowSource).toContain("beginAcquisitionAttempt(importId)");
    expect(workflowSource).toContain("evidenceBucket.raw");
    expect(workflowSource).toContain(
      'retries: { limit: 3, delay: "2 seconds", backoff: "exponential" }'
    );
    expect(workflowSource).toContain(
      "export const MaximumNestedAcquisitionAttempts = 9"
    );
    expect(workflowSource).toContain(
      "export const MaximumScheduledWorkflowSeconds = 2985"
    );
    expect(workflowSource).toContain(
      "export const MaximumAbsoluteWorkflowSeconds = 3066"
    );
    expect(workflowSource).not.toContain("Miniflare");
    expect(workflowSource).not.toMatch(
      /export const Maximum\w+ = (?:12|3986|4094)/u
    );
    expect(workflowSource).not.toContain('"resolve-acquire-store-verify-v1"');
    expect(workflowSource).not.toContain('"record-acquisition-v1"');
    expect(modelSource).toMatch(/\/generations\/\$\{generation\}/u);
    expect(acquirerSource).not.toMatch(/\.delete\s*\(/u);
    expect(acquirerSource).not.toContain("acquisition/v1/original.mp4");
    expect(acquirerSource).not.toContain("acquisition/v1/manifest.json");
    expect(bucketSource).toContain('prefix: "imports/"');
  });

  it("registers one pinned, bounded, non-root media container runtime", () => {
    const stackSource = readRepoFile("./alchemy.run.ts");
    const runtimeSource = readRepoFile(
      "./apps/api/src/features/imports/import-media-container.runtime.ts"
    );
    const containerSource = readRepoFile(
      "./apps/api/src/features/imports/import-media-container.ts"
    );

    expect(stackSource).toContain("TikTokMediaContainerLive");
    expect(stackSource).toContain("Effect.provide(TikTokMediaContainerLive)");
    expect(containerSource).toContain('"TikTokMediaContainer"');
    expect(runtimeSource).toContain("node:22.19.0-bookworm-slim@sha256:");
    expect(runtimeSource).toContain("2026.07.04/yt-dlp_linux");
    expect(runtimeSource).toContain("https://github.com/FFmpeg/FFmpeg.git");
    expect(runtimeSource).toContain("tag n8.1.2");
    expect(runtimeSource).toContain("DD1EC9E8DE085C629B3E1846B18E8928B3948D64");
    expect(runtimeSource).toContain("38b88335f99e76ed89ff3c93f877fdefce736c13");
    expect(runtimeSource).toContain("git verify-tag n8.1.2");
    expect(runtimeSource).toContain(
      "git archive --format=tar n8.1.2 | tar --extract --directory /tmp/ffmpeg"
    );
    expect(runtimeSource).not.toContain("ffmpeg.org");
    expect(runtimeSource).toContain("--disable-network");
    expect(runtimeSource).toContain("USER 10001:10001");
    expect(runtimeSource).toContain('instanceType: "standard-1"');
    expect(runtimeSource).toContain("maxInstances: 2");
    expect(runtimeSource).toContain("acquisitionArtifactId(");
  });

  it("ignores local Alchemy, Wrangler, and Worker credential artifacts", () => {
    const ignoreSource = readRepoFile("./.gitignore");

    expect(ignoreSource).toContain(".alchemy/");
    expect(ignoreSource).toContain(".wrangler/");
    expect(ignoreSource).toContain(".dev.vars\n");
    expect(ignoreSource).toContain(".dev.vars.*");
  });

  it("documents stage, profile, bootstrap, optional URL, and cleanup boundaries", () => {
    const docs = readRepoFile("./docs/infrastructure/alchemy.md");
    const packageSource = readRepoFile("./package.json");

    expect(docs).toContain("dev_$USER");
    expect(docs).toContain("pr-<number>");
    expect(docs).toContain("explicit `prod`");
    expect(docs).toContain("optional `apiUrl`");
    expect(docs).toContain("independently verify the Cloudflare account");
    expect(docs).toContain("`.env.example` is intentionally trackable");
    expect(docs).toContain("internally enables automatic approval");
    expect(docs).toMatch(/shared state\s+store is not stage-owned cleanup/u);
    expect(packageSource).not.toContain('"alchemy:dev"');
  });
});

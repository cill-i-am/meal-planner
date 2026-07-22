import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const readRepoFile = (path: string): string =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf-8");

describe("Alchemy source structure (no provider lifecycle or runtime proof)", () => {
  it("declares exactly one default-exported MealPlanner stack with Cloudflare state", () => {
    const source = readRepoFile("./alchemy.run.ts");

    expect(source.match(/export default Alchemy\.Stack/gu)).toHaveLength(1);
    expect(source.match(/Alchemy\.Stack\(/gu)).toHaveLength(1);
    expect(source).toMatch(/Alchemy\.Stack\(\s*"MealPlanner"/u);
    expect(source).toContain("providers: Cloudflare.providers()");
    expect(source).toContain("state: Cloudflare.state()");
  });

  it("keeps the Worker identity stable and preserves its optional URL output", () => {
    const stackSource = readRepoFile("./alchemy.run.ts");
    const workerSource = readRepoFile("./apps/api/src/worker.ts");

    expect(workerSource).toContain('"MealPlannerApi"');
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
    expect(runtimeSource).toContain("ffmpeg-8.1.2.tar.xz");
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

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const readRepoFile = (path: string): string =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf-8");

describe("Alchemy source structure (no provider lifecycle or runtime proof)", () => {
  it("disables provider request logging and retention", () => {
    const source = readRepoFile(
      "./apps/api/src/infrastructure/import-provider-gateway.ts"
    );
    expect(source).toContain("collectLogs: false");
    expect(source).toContain("zdr: true");
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
    expect(workerSource).toMatch(/traces:\s*\{[^}]*enabled:\s*false,\s*\}/u);
    expect(workerSource).not.toContain("invocationLogs: true");
    expect(workerSource).not.toMatch(/traces:\s*\{[^}]*enabled:\s*true/u);
    expect(workerSource).toContain("workersDev: false");
    expect(stackSource).toContain("apiUrl: api.url");
    expect(stackSource).toContain("apiWorkerName: api.workerName");
    expect(stackSource).toContain(
      "authDatabaseName: authDatabase.databaseName"
    );
    expect(stackSource).toContain("providerAccountingDatabaseName:");
    expect(stackSource).not.toContain("api.url.as<string>()");
  });

  it("keeps provider-accounting migrations free of household authority", () => {
    const migrationsDirectory = fileURLToPath(
      new URL("apps/api/provider-accounting-migrations", import.meta.url)
    );
    const sqlFiles = readdirSync(migrationsDirectory, { recursive: true })
      .map(String)
      .filter((path) => path.endsWith(".sql"))
      .toSorted();

    expect(sqlFiles).not.toHaveLength(0);
    const migration = sqlFiles
      .map((file) => readFileSync(`${migrationsDirectory}/${file}`, "utf-8"))
      .join("\n");
    for (const table of [
      "provider_accounting_budgets",
      "provider_accounting_conservative_settlements",
      "provider_accounting_dispatches",
      "provider_accounting_recipe_replay_values",
      "provider_accounting_reconciliations",
    ]) {
      expect(migration).toContain(`CREATE TABLE \`${table}\``);
    }
    expect(migration).not.toMatch(
      /organization_id|import_evidence_routes|import_execution_runs/iu
    );
  });

  it("provisions Better Auth D1 while Drizzle Kit owns its checked-in migrations", () => {
    const stackSource = readRepoFile("./alchemy.run.ts");
    const databaseSource = readRepoFile(
      "./apps/api/src/infrastructure/meal-planner-auth-database.ts"
    );
    const authConfigSource = readRepoFile("./apps/api/auth.config.ts");
    const runtimeAuthSource = readRepoFile(
      "./apps/api/src/features/auth/auth.ts"
    );
    const schemaSource = readRepoFile(
      "./apps/api/src/features/auth/auth.database-schema.ts"
    );
    const drizzleConfigSource = readRepoFile(
      "./apps/api/drizzle.auth.config.ts"
    );
    const authMigrationsDirectory = fileURLToPath(
      new URL("apps/api/auth-migrations", import.meta.url)
    );
    const sqlFiles = readdirSync(authMigrationsDirectory, {
      recursive: true,
    })
      .map(String)
      .filter((path) => path.endsWith(".sql"))
      .toSorted();

    expect(databaseSource).toContain('"MealPlannerAuthDatabase"');
    expect(databaseSource).toContain('dir: "./apps/api/auth-migrations"');
    expect(databaseSource).toContain('table: "d1_migrations"');
    expect(databaseSource.match(/Cloudflare\.D1\.Database\(/gu)).toHaveLength(
      1
    );
    expect(stackSource).toContain(
      "authDatabaseName: authDatabase.databaseName"
    );
    expect(stackSource).not.toContain("@alchemy.run/better-auth");
    expect(authConfigSource).toContain("makeMealPlannerAuth");
    expect(authConfigSource).not.toContain("--adapter");
    expect(runtimeAuthSource).toContain(
      'from "@better-auth/drizzle-adapter/relations-v2"'
    );
    expect(schemaSource).toContain("defineRelationsPart(");
    expect(drizzleConfigSource).toContain(
      'schema: "./src/features/auth/auth.database-schema.ts"'
    );
    expect(sqlFiles).not.toHaveLength(0);

    const migration = sqlFiles
      .map((file) =>
        readFileSync(`${authMigrationsDirectory}/${file}`, "utf-8")
      )
      .join("\n");
    expect(migration).toContain("CREATE TABLE `user`");
    expect(migration).toContain("CREATE TABLE `session`");
    expect(migration).toContain("CREATE TABLE `organization`");
    expect(migration).toContain("CREATE TABLE `member`");
  });

  it("keeps the household Worker private", () => {
    const source = readRepoFile(
      "./apps/api/src/features/households/household-domain-worker.ts"
    );
    expect(source).toContain("workersDev: false");
  });

  it("keeps household host fixtures out of the API production program", () => {
    const apiRoot = fileURLToPath(new URL("apps/api", import.meta.url));
    const configPath = `${apiRoot}/tsconfig.build.json`;
    const config = ts.readConfigFile(configPath, ts.sys.readFile);
    const parsed = ts.parseJsonConfigFileContent(
      config.config,
      ts.sys,
      apiRoot,
      undefined,
      configPath
    );
    const householdFiles = parsed.fileNames
      .filter((path) => path.includes("/features/households/"))
      .map((path) => path.slice(apiRoot.length + 1))
      .toSorted();

    expect(householdFiles).toContain(
      "src/features/households/household-domain-worker.ts"
    );
    expect(householdFiles).toContain(
      "src/features/households/household-object.ts"
    );
    expect(
      householdFiles.filter(
        (path) =>
          path.includes(".test-fixture.") || path.includes(".test-types.")
      )
    ).toEqual([]);
  });

  it("keeps authentication same-origin through the Website service binding", () => {
    const stackSource = readRepoFile("./alchemy.run.ts");
    const apiWorkerSource = readRepoFile("./apps/api/src/worker.ts");

    expect(stackSource).toContain(
      'Cloudflare.Website.Vite("MealPlannerWebsite"'
    );
    expect(stackSource).toContain(
      'assets: { runWorkerFirst: ["/api/auth/*", "/v1/*"] }'
    );
    expect(stackSource).toContain("env: { MEAL_PLANNER_API: api }");
    expect(stackSource).toContain('main: "src/worker.ts"');
    expect(apiWorkerSource).toContain("auth.fetch(webRequest)");
    expect(apiWorkerSource).toContain('Config.redacted("BETTER_AUTH_SECRET")');
  });

  it("binds the least-privilege acquisition resources without Images or Sharp", () => {
    const workerSource = readRepoFile("./apps/api/src/worker.ts");
    const databaseSource = readRepoFile(
      "./apps/api/src/infrastructure/provider-accounting-database.ts"
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
    const authorizationConfigSource = readRepoFile(
      "./apps/api/src/features/imports/import.auth.config.ts"
    );
    const allSource = `${workerSource}\n${databaseSource}\n${workflowSource}\n${objectSource}\n${bucketSource}`;

    expect(workerSource).toContain("Cloudflare.D1.QueryDatabase");
    expect(workerSource).toContain("ImportAcquisitionWorkflow");
    expect(workflowSource).toContain('"ImportAcquisitionWorkflow"');
    expect(workflowSource).toContain("Cloudflare.R2.ReadWriteBucket");
    expect(objectSource).toContain('"ImportMediaAcquisitionObject"');
    expect(objectSource).not.toMatch(
      /this\.ctx\.storage|DurableObjectStorage/u
    );
    expect(objectSource).toContain("enableInternet: true");
    expect(bucketSource).toContain('"ImportEvidenceBucket"');
    expect(bucketSource).toContain("cors: []");
    expect(bucketSource).toContain("domains: []");
    expect(bucketSource).not.toMatch(/r2\.dev/iu);
    expect(mediaModelSource).toContain(
      "export const EvidenceRetentionSeconds = 604_800"
    );
    expect(authorizationConfigSource).toMatch(
      /Config\.redacted\(\s*"MEAL_PLANNER_IMPORT_API_TOKEN"\s*\)/u
    );
    expect(workerSource).toContain(
      'Config.string("MEAL_PLANNER_IMPORT_ACTOR_ID")'
    );
    expect(workerSource).toContain(
      'Config.string("MEAL_PLANNER_IMPORT_HOUSEHOLD_SCOPE_ID")'
    );
    expect(allSource).not.toMatch(/Cloudflare\.Images|Images\.|sharp/iu);
  });

  it("never deletes evidence while acquiring or adapting R2 writes", () => {
    for (const file of [
      "import-media-acquirer.ts",
      "import-media-acquisition-bucket.alchemy.ts",
    ]) {
      expect(
        readRepoFile(`./apps/api/src/features/imports/${file}`)
      ).not.toMatch(/\.delete\s*\(/u);
    }
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
    expect(runtimeSource).toContain("node:24.20.0-bookworm-slim@sha256:");
    expect(runtimeSource).toContain("2026.08.19/yt-dlp_linux");
    expect(runtimeSource).toContain("https://github.com/FFmpeg/FFmpeg.git");
    expect(runtimeSource).toContain("tag n9.0.1");
    expect(runtimeSource).toContain("DD1EC9E8DE085C629B3E1846B18E8928B3948D64");
    expect(runtimeSource).toContain("bf1b838f2ab88b4f8fd83443325c782ea0e0f7fa");
    expect(runtimeSource).toContain("git verify-tag n9.0.1");
    expect(runtimeSource).toContain(
      "git archive --format=tar n9.0.1 | tar --extract --directory /tmp/ffmpeg"
    );
    expect(runtimeSource).not.toContain("ffmpeg.org");
    expect(runtimeSource).toContain("--disable-network");
    expect(runtimeSource).toContain("USER 10001:10001");
    expect(runtimeSource).toContain('instanceType: "standard-1"');
    expect(runtimeSource).toContain("maxInstances: 2");
  });

  it("ignores local Alchemy, Wrangler, and Worker credential artifacts", () => {
    const ignoreSource = readRepoFile("./.gitignore");

    expect(ignoreSource).toContain(".alchemy/");
    expect(ignoreSource).toContain(".wrangler/");
    expect(ignoreSource).toContain(".dev.vars\n");
    expect(ignoreSource).toContain(".dev.vars.*");
  });
});

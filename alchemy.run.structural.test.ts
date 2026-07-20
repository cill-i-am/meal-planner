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

  it("keeps exactly one recursively discoverable deployable SQL migration", () => {
    const migrationsDirectory = fileURLToPath(
      new URL("apps/api/migrations", import.meta.url)
    );
    const sqlFiles = readdirSync(migrationsDirectory, {
      recursive: true,
    })
      .map(String)
      .filter((path) => path.endsWith(".sql"))
      .toSorted();

    expect(sqlFiles).toEqual(["0000_recipe_imports.sql"]);
  });

  it("binds only D1 and the redacted import token, without Images or Sharp", () => {
    const workerSource = readRepoFile("./apps/api/src/worker.ts");
    const databaseSource = readRepoFile(
      "./apps/api/src/infrastructure/meal-planner-database.ts"
    );
    const allSource = `${workerSource}\n${databaseSource}`;

    expect(workerSource).toContain("Cloudflare.D1.QueryDatabase");
    expect(workerSource).toMatch(
      /Config\.redacted\(\s*"MEAL_PLANNER_IMPORT_API_TOKEN"\s*\)/u
    );
    expect(allSource).not.toMatch(/Cloudflare\.Images|Images\.|sharp/iu);
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

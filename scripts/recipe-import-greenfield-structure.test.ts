import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
describe("greenfield recipe-import architecture", () => {
  it("configures only the canonical authenticated recipe-import surface", async () => {
    const environmentExample = await readFile(
      `${repositoryRoot}/.env.example`,
      "utf-8"
    );

    expect(environmentExample).not.toMatch(/\b(?:POST|GET) \/imports\b/u);
    expect(environmentExample).toContain("/v1/recipe-import-intents");
    expect(environmentExample).toContain("MEAL_PLANNER_IMPORT_ACTOR_ID=");
    expect(environmentExample).toContain(
      "MEAL_PLANNER_IMPORT_HOUSEHOLD_SCOPE_ID="
    );
  });
});

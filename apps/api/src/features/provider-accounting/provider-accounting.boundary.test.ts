import { access, readFile, readdir } from "node:fs/promises";
// eslint-disable-next-line unicorn/import-style -- This package does not enable synthetic default imports for Node built-ins.
import * as path from "node:path";

import { describe, expect, it } from "vitest";

const providerAccountingRoot = import.meta.dirname;
const featuresRoot = path.dirname(providerAccountingRoot);
const apiSourceRoot = path.dirname(featuresRoot);

const read = (filePath: string) => readFile(filePath, "utf-8");

const readProductionSources = async () => {
  const paths = await readdir(apiSourceRoot, { recursive: true });
  return Promise.all(
    paths
      .filter(
        (relativePath) =>
          relativePath.endsWith(".ts") &&
          !relativePath.endsWith(".test.ts") &&
          !relativePath.endsWith(".test-fixture.ts") &&
          !relativePath.startsWith("features/pilots/")
      )
      .map(async (relativePath) => ({
        path: relativePath,
        source: await read(path.join(apiSourceRoot, relativePath)),
      }))
  );
};

describe("provider accounting production boundary", () => {
  it("keeps production imports and composition independent of pilot code", async () => {
    const sources = await readProductionSources();
    const forbidden = [
      "/pilots/",
      "PilotProviderBudget",
      "PilotBudget",
      "makePilotProvider",
      "pilot_provider_",
      "pilot-gaia-118",
      "gaia-118:",
    ];

    for (const { path: sourcePath, source } of sources) {
      for (const token of forbidden) {
        expect(source, `${sourcePath} retains ${token}`).not.toContain(token);
      }
    }

    await expect(
      access(path.join(featuresRoot, "pilots/pilot-provider-budget.ts"))
    ).rejects.toThrow();
    await expect(
      access(
        path.join(featuresRoot, "pilots/pilot-provider-budget.repository.d1.ts")
      )
    ).rejects.toThrow();
  });

  it("owns only global cost accounting in the production feature", async () => {
    const paths = await readdir(providerAccountingRoot);
    const productionPaths = paths.filter(
      (relativePath) =>
        relativePath.endsWith(".ts") && !relativePath.endsWith(".test.ts")
    );
    expect(productionPaths.toSorted()).toEqual([
      "provider-accounting.repository.d1.ts",
      "provider-accounting.routes.ts",
      "provider-accounting.service.ts",
      "provider-accounting.ts",
    ]);

    const sources = await Promise.all(
      productionPaths.map(async (relativePath) => ({
        path: relativePath,
        source: await read(path.join(providerAccountingRoot, relativePath)),
      }))
    );
    for (const { path: sourcePath, source } of sources) {
      expect(source, `${sourcePath} imports Household authority`).not.toMatch(
        /features\/households|\.\.\/households|householdDomain|readHousehold|prepareHousehold/u
      );
    }

    const schema = await read(
      path.join(featuresRoot, "imports/import.database-schema.ts")
    );
    for (const table of [
      "provider_accounting_budgets",
      "provider_accounting_dispatches",
      "provider_accounting_reconciliations",
      "provider_accounting_conservative_settlements",
      "provider_accounting_recipe_replay_values",
    ]) {
      expect(schema).toContain(`"${table}"`);
    }
    expect(schema).not.toContain("pilot_provider_");
  });

  it("keeps Household recovery authority independent of global settlement", async () => {
    const contract = await read(
      path.join(
        featuresRoot,
        "households/evidence/household-evidence.contract.ts"
      )
    );
    const providerRecovery = contract
      .split('_tag: Schema.Literal("PrepareRecovery")')[1]
      ?.split("}),")[0];
    const recipeRecovery = contract
      .split("export const HouseholdPrepareRecipeRecoveryInput")[1]
      ?.split("export type HouseholdPrepareRecipeRecoveryInput")[0];

    expect(providerRecovery).toBeDefined();
    expect(recipeRecovery).toBeDefined();
    expect(providerRecovery).not.toContain("settlement");
    expect(recipeRecovery).not.toContain("settlement");

    const recoveryService = await read(
      path.join(featuresRoot, "imports/import-provider-recovery.ts")
    );
    expect(recoveryService).not.toContain("provider-accounting");
    expect(recoveryService).not.toContain("ProviderAccounting");
  });
});

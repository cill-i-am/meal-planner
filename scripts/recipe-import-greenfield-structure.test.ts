import { readdir, readFile, stat } from "node:fs/promises";
import path = require("node:path");
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));

const collectFiles = async (entryPath: string): Promise<readonly string[]> => {
  const entry = await stat(entryPath);
  if (entry.isFile()) {
    return [entryPath];
  }

  const children = await readdir(entryPath);
  const descendants = await Promise.all(
    children.map((child) => collectFiles(path.join(entryPath, child)))
  );
  return descendants.flat();
};

const isProductionSource = (entryPath: string): boolean =>
  [".ts", ".tsx"].includes(path.extname(entryPath)) &&
  !entryPath.includes(".test.") &&
  !entryPath.includes(".integration.") &&
  !entryPath.includes(".worker.") &&
  !entryPath.includes("/fixtures/") &&
  !entryPath.includes("/test-fixtures/");

const loadSources = async (
  paths: readonly string[],
  include: (path: string) => boolean
): Promise<readonly { readonly path: string; readonly source: string }[]> => {
  const collectedFiles = await Promise.all(paths.map(collectFiles));
  const files = collectedFiles.flat().filter(include);
  return Promise.all(
    files.map(async (entryPath) => ({
      path: path.relative(repositoryRoot, entryPath),
      source: await readFile(entryPath, "utf-8"),
    }))
  );
};

const violations = (
  sources: readonly { readonly path: string; readonly source: string }[],
  pattern: RegExp
): readonly string[] =>
  sources.flatMap(({ path: filePath, source }) =>
    source
      .split("\n")
      .flatMap((line, index) =>
        pattern.test(line) ? [`${filePath}:${index + 1}: ${line.trim()}`] : []
      )
  );

describe("greenfield recipe-import architecture", () => {
  it("keeps removed compatibility surfaces out of production code", async () => {
    const sources = await loadSources(
      [
        `${repositoryRoot}/apps/api/src/features/imports`,
        `${repositoryRoot}/apps/api/src/worker.ts`,
        `${repositoryRoot}/apps/web/src/features/recipe-import`,
      ],
      isProductionSource
    );
    const forbidden = [
      /["'`]\/imports(?:\/\$\{|["'`])/u,
      /["'`]\/recipe-drafts(?:\/|["'`])/u,
      /["'`]\/recipe-bank(?:\/|["'`])/u,
      /\bLegacyMealPlannerWorkerRoutes\b/u,
      /\blegacyRoutes\b/u,
      /\bRecipeReviewCompatibility\w*\b/u,
      /\bLegacyImportWorkflow(?:ExecutionGeneration|Input)\b/u,
      /\bLegacyPrivate(?:HouseholdScopeId|ImportActorId|ImportPrincipal)\b/u,
      /\bLegacyRecipeRecoveryWorkflowInput\b/u,
      /\b(?:derive|make)LegacyImportCorrelationId\b/u,
      /\blegacyStatus\b/u,
      /readonly start\?:/u,
    ] as const;

    expect(
      forbidden.flatMap((pattern) => violations(sources, pattern))
    ).toEqual([]);
  });

  it("uses the generated contract instead of a handwritten web transport", async () => {
    const sources = await loadSources(
      [`${repositoryRoot}/apps/web/src/features/recipe-import`],
      isProductionSource
    );
    const forbidden = [
      /\brequestJson\b/u,
      /\bImportStatusView\b/u,
      /\bRecipeBankView\b/u,
      /\bDraftId\b/u,
    ] as const;

    expect(
      forbidden.flatMap((pattern) => violations(sources, pattern))
    ).toEqual([]);
  });

  it("installs only the fresh canonical D1 schema", async () => {
    const sources = await loadSources(
      [`${repositoryRoot}/apps/api/migrations`],
      (entryPath) => path.extname(entryPath) === ".sql"
    );

    expect(violations(sources, /\bmigration_snapshot\b/u)).toEqual([]);
    expect(
      violations(sources, /\bimport_recipe_terminal_projections\b/u)
    ).toEqual([]);
  });

  it("documents only the current recipe-import design", async () => {
    const sources = await loadSources(
      [
        `${repositoryRoot}/apps/web/PRODUCT.md`,
        `${repositoryRoot}/apps/web/README.md`,
        `${repositoryRoot}/docs/architecture/recipe-import-intent.md`,
        `${repositoryRoot}/docs/infrastructure/alchemy.md`,
      ],
      (entryPath) => path.extname(entryPath) === ".md"
    );
    const forbidden = [
      /["'`]\/imports(?:\/\$\{|["'`])/u,
      /\/recipe-drafts(?:\/|\b)/u,
      /\/recipe-bank(?:\/|\b)/u,
      /\b(?:fake API|fake-api|production-shaped endpoints)\b/iu,
      /\bcompatibility-private\b/iu,
      /\bmigration_snapshot\b/u,
      /\btemporary transport adapter\b/iu,
      /\blegacy-route removal\b/iu,
    ] as const;

    expect(
      forbidden.flatMap((pattern) => violations(sources, pattern))
    ).toEqual([]);
  });

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

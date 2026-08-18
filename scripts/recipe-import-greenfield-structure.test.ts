import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path = require("node:path");
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));

const trackedFiles = execFileSync("git", ["ls-files", "-z"], {
  cwd: repositoryRoot,
  encoding: "utf-8",
})
  .split("\0")
  .filter((entryPath) => entryPath.length > 0);

const isProductionSource = (entryPath: string): boolean =>
  [".ts", ".tsx"].includes(path.extname(entryPath)) &&
  !entryPath.includes(".test.") &&
  !entryPath.includes(".integration.") &&
  !entryPath.includes(".support.") &&
  !entryPath.includes(".gen.") &&
  !entryPath.includes("/test/") &&
  !entryPath.includes("/tests/") &&
  !entryPath.includes("/__tests__/") &&
  !entryPath.includes("/fixtures/") &&
  !entryPath.includes("/test-fixtures/") &&
  !entryPath.includes("/support/") &&
  !entryPath.includes("/vendor/");

type WebProductionSourceCategory = "browser" | "website-worker";

const classifyWebProductionSource = (
  entryPath: string
): WebProductionSourceCategory | undefined => {
  if (
    !entryPath.startsWith("apps/web/src/") ||
    !isProductionSource(entryPath)
  ) {
    return undefined;
  }

  return entryPath === "apps/web/src/worker.ts" ? "website-worker" : "browser";
};

const loadSources = (
  paths: readonly string[],
  include: (path: string) => boolean
): Promise<readonly { readonly path: string; readonly source: string }[]> => {
  const requestedPaths = paths.map((entryPath) =>
    path.relative(repositoryRoot, entryPath)
  );
  const files = trackedFiles.filter(
    (entryPath) =>
      requestedPaths.some(
        (requestedPath) =>
          entryPath === requestedPath ||
          entryPath.startsWith(`${requestedPath}${path.sep}`)
      ) && include(entryPath)
  );
  return Promise.all(
    files.map(async (entryPath) => ({
      path: entryPath,
      source: await readFile(path.join(repositoryRoot, entryPath), "utf-8"),
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
  it.each([
    ["apps/web/src/worker.ts", "website-worker"],
    ["apps/web/src/background.worker.ts", "browser"],
    ["apps/web/src/support/secret.ts", undefined],
    ["apps/web/src/secret.support.ts", undefined],
  ] as const)("classifies %s as %s", (entryPath, expected) => {
    expect(classifyWebProductionSource(entryPath)).toBe(expected);
  });

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

  it("keeps browser and website worker code free of runtime secrets", async () => {
    const sources = await loadSources(
      [`${repositoryRoot}/apps/web/src`],
      (entryPath) => classifyWebProductionSource(entryPath) !== undefined
    );
    const sourcePaths = sources.map(({ path: sourcePath }) => sourcePath);
    const workerSources = sourcePaths.filter(
      (sourcePath) =>
        classifyWebProductionSource(sourcePath) === "website-worker"
    );
    const browserSources = sourcePaths.filter(
      (sourcePath) => classifyWebProductionSource(sourcePath) === "browser"
    );
    const forbidden = [/\bprocess\.env\b/u, /\bRedacted\.make\b/u] as const;

    expect(workerSources).toEqual(["apps/web/src/worker.ts"]);
    expect(browserSources.length).toBeGreaterThan(0);
    expect(sourcePaths).not.toContain("apps/web/src/routeTree.gen.ts");
    expect(sourcePaths).not.toContain("apps/web/src/test/setup.ts");
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

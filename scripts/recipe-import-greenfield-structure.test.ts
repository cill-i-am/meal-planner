import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path = require("node:path");
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { readOwnedSources } from "./owned-source-files.js";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));

const isProductionSource = (entryPath: string): boolean =>
  [".ts", ".tsx"].includes(path.extname(entryPath)) &&
  !entryPath.includes(".test.") &&
  !entryPath.includes(".integration.") &&
  !entryPath.includes(".support.") &&
  !entryPath.includes(".gen.") &&
  !entryPath.includes(".generated.") &&
  !entryPath.includes(".fixture.") &&
  !entryPath.includes("/test/") &&
  !entryPath.includes("/tests/") &&
  !entryPath.includes("/__tests__/") &&
  !entryPath.includes("/fixtures/") &&
  !entryPath.includes("/fixture/") &&
  !entryPath.includes("/generated/") &&
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
  include: (path: string) => boolean,
  root = repositoryRoot
): readonly { readonly path: string; readonly source: string }[] => {
  const requestedPaths = paths.map((entryPath) =>
    path.relative(root, entryPath)
  );
  const files = readOwnedSources(root).filter(
    ({ file }) =>
      requestedPaths.some(
        (requestedPath) =>
          file === requestedPath ||
          file.startsWith(`${requestedPath}${path.sep}`)
      ) && include(file)
  );
  return files.map(({ file, source }) => ({ path: file, source }));
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
  it("detects runtime secrets in new untracked browser source", () => {
    const root = mkdtempSync(
      path.join(tmpdir(), "meal-planner-recipe-structure-")
    );
    try {
      execFileSync("git", ["init", "--quiet", root]);
      mkdirSync(path.join(root, "apps/web/src"), { recursive: true });
      writeFileSync(path.join(root, "apps/web/src/tracked.ts"), "export {};\n");
      execFileSync("git", ["add", "."], { cwd: root });
      writeFileSync(
        path.join(root, "apps/web/src/untracked.ts"),
        "const secret = process.env.SECRET;\n"
      );
      const sources = loadSources(
        [path.join(root, "apps/web/src")],
        (entryPath) => classifyWebProductionSource(entryPath) !== undefined,
        root
      );
      expect(violations(sources, /\bprocess\.env\b/u)).toEqual([
        "apps/web/src/untracked.ts:1: const secret = process.env.SECRET;",
      ]);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it.each([
    ["apps/web/src/worker.ts", "website-worker"],
    ["apps/web/src/background.worker.ts", "browser"],
    ["apps/web/src/supporting/secret.ts", "browser"],
    ["apps/web/src/secret.supporting.ts", "browser"],
    ["apps/web/src/generated-client/secret.ts", "browser"],
    ["apps/web/src/secret.generated-client.ts", "browser"],
    ["apps/web/src/fixture-data/secret.ts", "browser"],
    ["apps/web/src/secret.fixture-data.ts", "browser"],
    ["apps/web/src/support/secret.ts", undefined],
    ["apps/web/src/secret.support.ts", undefined],
    ["apps/web/src/test/secret.ts", undefined],
    ["apps/web/src/tests/secret.ts", undefined],
    ["apps/web/src/__tests__/secret.ts", undefined],
    ["apps/web/src/fixtures/secret.ts", undefined],
    ["apps/web/src/fixture/secret.ts", undefined],
    ["apps/web/src/generated/secret.ts", undefined],
    ["apps/web/src/test-fixtures/secret.ts", undefined],
    ["apps/web/src/vendor/secret.ts", undefined],
    ["apps/web/src/secret.test.ts", undefined],
    ["apps/web/src/secret.integration.ts", undefined],
    ["apps/web/src/secret.gen.ts", undefined],
    ["apps/web/src/secret.generated.ts", undefined],
    ["apps/web/src/secret.fixture.ts", undefined],
    ["apps/web/src/secret.txt", undefined],
    ["apps/api/src/secret.ts", undefined],
    ["", undefined],
  ] as const)("classifies %s as %s", (entryPath, expected) => {
    expect(classifyWebProductionSource(entryPath)).toBe(expected);
  });

  it("keeps browser and website worker code free of runtime secrets", () => {
    const sources = loadSources(
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

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path = require("node:path");

const ownedDirectories = new Set(["apps", "packages", "scripts", "tools"]);
const ownedRootFiles = new Set([
  "alchemy.run.ts",
  "alchemy.run.structural.test.ts",
  "oxfmt.config.ts",
  "oxlint.config.ts",
  "vitest.alchemy.config.ts",
]);
const sourceExtensions = new Set([
  ".cjs",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".mts",
  ".ts",
  ".tsx",
]);

/** Read existing tracked and untracked owned source, respecting Git ignores. */
export const readOwnedSources = (repositoryRoot: string) => {
  const files = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: repositoryRoot, encoding: "utf-8" }
  ).split("\0");

  return files
    .filter(
      (file) =>
        (ownedRootFiles.has(file) ||
          ownedDirectories.has(file.split("/")[0] ?? "")) &&
        sourceExtensions.has(path.extname(file)) &&
        existsSync(path.join(repositoryRoot, file))
    )
    .map((file) => ({
      file,
      source: readFileSync(path.join(repositoryRoot, file), "utf-8"),
    }));
};

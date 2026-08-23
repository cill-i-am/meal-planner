import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repositoryRootUrl = new URL("../", import.meta.url);
const repositoryRoot = fileURLToPath(repositoryRootUrl);
const vendoredRulePath =
  "tools/oxlint/anti-slop/no-conditional-empty-object-spread.ts";
const upstreamRuleSha256 =
  "33f044030d208fcc10be73bb19c8172c275c5229df4b0ca8ec10f069bbe60062";
const nonOwnedSourcePrefixes = [".agents/"];
const sourceExtensions = [
  ".cjs",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".mts",
  ".ts",
  ".tsx",
];
const ruleName = ["anti-slop", "no-conditional-empty-object-spread"].join("/");

const readRepositoryFile = (path: string): string =>
  readFileSync(new URL(path, repositoryRootUrl), "utf-8");

const repositoryFiles = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  {
    cwd: repositoryRoot,
    encoding: "utf-8",
  }
)
  .split("\0")
  .filter(
    (file) => file.length > 0 && existsSync(new URL(file, repositoryRootUrl))
  );

const ownedSourceFiles = repositoryFiles.filter(
  (file) =>
    file !== vendoredRulePath &&
    !nonOwnedSourcePrefixes.some((prefix) => file.startsWith(prefix)) &&
    sourceExtensions.some((extension) => file.endsWith(extension))
);

describe("no-conditional-empty-object-spread enforcement", () => {
  it("keeps the exact upstream rule unchanged", () => {
    const source = readRepositoryFile(vendoredRulePath);

    expect(createHash("sha256").update(source).digest("hex")).toBe(
      upstreamRuleSha256
    );
  });

  it("registers and globally enables the target rule exactly once", () => {
    const plugin = readRepositoryFile("tools/oxlint/anti-slop/index.ts");
    const config = readRepositoryFile("oxlint.config.ts");
    const ruleConfiguration = `"${ruleName}":`;
    const ruleMentions = config
      .split("\n")
      .flatMap((line, index) =>
        line.includes(ruleConfiguration) ? [index + 1] : []
      );

    expect(plugin).toContain(
      '"no-conditional-empty-object-spread": noConditionalEmptyObjectSpreadRule'
    );
    expect(ruleMentions).toHaveLength(1);
    expect(config).toContain(`"${ruleName}": "error"`);
  });

  it("excludes only the immutable vendor source from lint self-application", () => {
    const lintConfig = readRepositoryFile("oxlint.config.ts");
    const formatConfig = readRepositoryFile("oxfmt.config.ts");

    expect(lintConfig).toContain(`"${vendoredRulePath}"`);
    expect(lintConfig).not.toContain('"tools/oxlint/anti-slop/*"');
    expect(lintConfig).not.toContain('"tools/oxlint/anti-slop/**"');
    expect(formatConfig).not.toContain(vendoredRulePath);
  });

  it("has no owned-code suppressions", () => {
    const disableDirective = ["oxlint", "disable"].join("-");
    const suppressions = ownedSourceFiles.flatMap((file) => {
      const source = readRepositoryFile(file);
      return source
        .split("\n")
        .some(
          (line) => line.includes(disableDirective) && line.includes(ruleName)
        )
        ? [file]
        : [];
    });

    expect(suppressions).toEqual([]);
  });
});

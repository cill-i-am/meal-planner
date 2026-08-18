import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repositoryRootUrl = new URL("../", import.meta.url);
const repositoryRoot = fileURLToPath(repositoryRootUrl);
const vendoredRulePath = "tools/oxlint/anti-slop/no-runtime-typeof.ts";
const upstreamRuleSha256 =
  "eed63d5667763ddbc48a6b83662e446f100c444cddefc3d066ac0015670590b8";
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
const ruleName = ["anti-slop", "no-runtime-typeof"].join("/");

const repositoryFiles = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  {
    cwd: repositoryRoot,
    encoding: "utf-8",
  }
)
  .split("\0")
  .filter((file) => file.length > 0);

const ownedSourceFiles = repositoryFiles.filter(
  (file) =>
    file !== vendoredRulePath &&
    !nonOwnedSourcePrefixes.some((prefix) => file.startsWith(prefix)) &&
    sourceExtensions.some((extension) => file.endsWith(extension))
);

describe("no-runtime-typeof enforcement", () => {
  it("keeps the exact upstream rule unchanged", () => {
    const source = readFileSync(
      new URL(vendoredRulePath, repositoryRootUrl),
      "utf-8"
    );

    expect(createHash("sha256").update(source).digest("hex")).toBe(
      upstreamRuleSha256
    );
  });

  it("keeps the rule globally enabled without rule-level exceptions", () => {
    const config = readFileSync(
      new URL("oxlint.config.ts", repositoryRootUrl),
      "utf-8"
    );
    const ruleConfiguration = `"${ruleName}":`;
    const ruleMentions = config
      .split("\n")
      .flatMap((line, index) =>
        line.includes(ruleConfiguration) ? [index + 1] : []
      );

    expect(ruleMentions).toHaveLength(1);
    expect(config).toContain(`"${ruleName}": "error"`);
  });

  it("excludes only the byte-identical upstream source from tool self-scans", () => {
    const configs = ["oxlint.config.ts", "oxfmt.config.ts"].map((file) =>
      readFileSync(new URL(file, repositoryRootUrl), "utf-8")
    );

    for (const config of configs) {
      expect(config).toContain(`"${vendoredRulePath}"`);
      expect(config).not.toContain('"tools/oxlint/anti-slop/*"');
      expect(config).not.toContain('"tools/oxlint/anti-slop/**"');
    }
  });

  it("has no owned-code suppressions", () => {
    const disableDirective = ["oxlint", "disable"].join("-");
    const suppressions = ownedSourceFiles.flatMap((file) => {
      const source = readFileSync(new URL(file, repositoryRootUrl), "utf-8");
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

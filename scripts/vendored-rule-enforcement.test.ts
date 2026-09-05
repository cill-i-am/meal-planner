import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path = require("node:path");
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { readOwnedSources } from "./owned-source-files.js";

const repositoryRootUrl = new URL("../", import.meta.url);
const ownedSources = readOwnedSources(fileURLToPath(repositoryRootUrl));
const lintConfig = readFileSync(
  new URL("oxlint.config.ts", repositoryRootUrl),
  "utf-8"
);
const formatConfig = readFileSync(
  new URL("oxfmt.config.ts", repositoryRootUrl),
  "utf-8"
);
const plugin = readFileSync(
  new URL("tools/oxlint/anti-slop/index.ts", repositoryRootUrl),
  "utf-8"
);

const rules = [
  {
    excludeFromFormat: true,
    exportName: "noRuntimeTypeofRule",
    name: "no-runtime-typeof",
    sha256: "eed63d5667763ddbc48a6b83662e446f100c444cddefc3d066ac0015670590b8",
  },
  {
    excludeFromFormat: false,
    exportName: "noConditionalEmptyObjectSpreadRule",
    name: "no-conditional-empty-object-spread",
    sha256: "33f044030d208fcc10be73bb19c8172c275c5229df4b0ca8ec10f069bbe60062",
  },
] as const;

describe.each(rules)("$name enforcement", (rule) => {
  const ruleName = `anti-slop/${rule.name}`;
  const vendoredRulePath = `tools/oxlint/anti-slop/${rule.name}.ts`;

  it("keeps the upstream rule byte-identical", () => {
    const source = readFileSync(
      new URL(vendoredRulePath, repositoryRootUrl),
      "utf-8"
    );
    expect(createHash("sha256").update(source).digest("hex")).toBe(rule.sha256);
  });

  it("registers and globally enables the rule without overrides", () => {
    expect(plugin).toContain(`"${rule.name}": ${rule.exportName}`);
    expect(lintConfig.split(`"${ruleName}":`)).toHaveLength(2);
    expect(lintConfig).toContain(`"${ruleName}": "error"`);
  });

  it("excludes only the immutable vendor file from tool self-scans", () => {
    expect(lintConfig).toContain(`"${vendoredRulePath}"`);
    expect(formatConfig.includes(`"${vendoredRulePath}"`)).toBe(
      rule.excludeFromFormat
    );
    for (const config of [lintConfig, formatConfig]) {
      expect(config).not.toContain('"tools/oxlint/anti-slop/*"');
      expect(config).not.toContain('"tools/oxlint/anti-slop/**"');
    }
  });

  it("has no owned-code suppressions", () => {
    const disableDirective = ["oxlint", "disable"].join("-");
    const suppressions = ownedSources
      .filter(
        ({ file, source }) =>
          file !== vendoredRulePath &&
          source
            .split("\n")
            .some(
              (line) =>
                line.includes(disableDirective) && line.includes(ruleName)
            )
      )
      .map(({ file }) => file);
    expect(suppressions).toEqual([]);
  });
});

it("includes owned tracked and untracked sources while ignoring deleted and unrelated files", () => {
  const root = mkdtempSync(path.join(tmpdir(), "meal-planner-owned-source-"));
  try {
    execFileSync("git", ["init", "--quiet", root]);
    for (const file of [
      "apps/api/tracked.ts",
      "apps/api/ignored.ts",
      "packages/removed.ts",
      "packages/present.mts",
      "scripts/check.js",
      "tools/lint.cts",
      ".agents/skill/tool.ts",
      "docs/example.ts",
      "scratch.ts",
      "oxlint.config.ts",
    ]) {
      mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      writeFileSync(path.join(root, file), "export {};\n");
    }
    writeFileSync(path.join(root, ".gitignore"), "apps/api/ignored.ts\n");
    execFileSync("git", ["add", "."], { cwd: root });
    rmSync(path.join(root, "packages/removed.ts"));
    writeFileSync(path.join(root, "apps/api/untracked.ts"), "export {};\n");

    expect(
      readOwnedSources(root)
        .map(({ file }) => file)
        .toSorted()
    ).toEqual([
      "apps/api/tracked.ts",
      "apps/api/untracked.ts",
      "oxlint.config.ts",
      "packages/present.mts",
      "scripts/check.js",
      "tools/lint.cts",
    ]);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

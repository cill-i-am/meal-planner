import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { readOwnedSources } from "./owned-source-files.js";

// Reviewed vendor boundary exceptions for the installed Alchemy pin.
const vendorContractExceptions = [
  {
    file: "apps/api/src/features/imports/import-provider-kernel.ts",
    id: "ASU001",
  },
  {
    file: "apps/api/src/features/imports/import-provider-kernel.ts",
    id: "ASU002",
  },
  {
    file: "apps/api/src/features/imports/import-provider-kernel.ts",
    id: "ASU003",
  },
  {
    file: "apps/api/src/features/imports/import-workflow-input.test-fixture.ts",
    id: "ASU004",
  },
  {
    file: "apps/api/src/features/imports/import-provider-workflow-task.test-fixture.ts",
    id: "ASU005",
  },
  {
    file: "apps/api/src/features/imports/import-provider-workflow-task.test-types.d.ts",
    id: "ASU006",
  },
  {
    file: "apps/api/src/features/imports/import-provider-workflow-task.test-types.d.ts",
    id: "ASU007",
  },
  {
    file: "apps/api/src/features/imports/import-provider-workflow-task.test-types.d.ts",
    id: "ASU008",
  },
  {
    file: "apps/api/src/features/imports/import-media-acquisition-object.integration.test.ts",
    id: "ASU009",
  },
] as const;

const repositoryRootUrl = new URL("../", import.meta.url);
const repositoryRoot = fileURLToPath(repositoryRootUrl);
const ownedSources = readOwnedSources(repositoryRoot);
const oxlintDisable = ["oxlint", "disable"].join("-");
const ruleName = ["anti-slop", "no-unknown-parameters"].join("/");
const suppression = `${oxlintDisable}-next-line ${ruleName}`;

const suppressionLines = (source: string): readonly number[] => {
  const commentPattern = /\/\/[^\n]*|\/\*[\s\S]*?\*\//gu;
  const locations: number[] = [];

  for (const match of source.matchAll(commentPattern)) {
    const [comment] = match;
    if (!(comment.includes(oxlintDisable) && comment.includes(ruleName))) {
      continue;
    }

    const matchIndex = match.index;
    locations.push(source.slice(0, matchIndex).split("\n").length);
  }

  return locations;
};

const suppressionLocations = ownedSources.flatMap(({ file, source }) =>
  suppressionLines(source).map((line) => `${file}:${line}`)
);

describe("anti-slop vendor contract exceptions", () => {
  it.each([
    `// ${oxlintDisable}-next-line ${ruleName}`,
    `const probe = (input: unknown) => input; // ${oxlintDisable}-line ${ruleName}`,
    `/* ${oxlintDisable} ${ruleName} */`,
    `/* ${oxlintDisable}\n * ${ruleName}\n */`,
  ])("detects every Oxlint suppression form", (directive) => {
    expect(suppressionLines(directive)).toHaveLength(1);
  });

  it("keeps the rule globally enabled without config-level exceptions", () => {
    const config = readFileSync(
      new URL("oxlint.config.ts", repositoryRootUrl),
      "utf-8"
    );
    const ruleMentions = config
      .split("\n")
      .flatMap((line, index) => (line.includes(ruleName) ? [index + 1] : []));

    expect(ruleMentions).toHaveLength(1);
    expect(config).toContain(`"${ruleName}": "error"`);
  });

  it("keeps exactly the nine reviewed Alchemy beta.72 exceptions", () => {
    expect(vendorContractExceptions).toHaveLength(9);
    expect(suppressionLocations).toHaveLength(vendorContractExceptions.length);

    for (const exception of vendorContractExceptions) {
      const source = readFileSync(
        new URL(exception.file, repositoryRootUrl),
        "utf-8"
      );
      const marker = `TODO(${exception.id} alchemy@2.0.0-beta.76)`;
      const comments = source
        .split("\n")
        .filter((line) => line.includes(marker));
      expect(comments, exception.id).toHaveLength(1);
      const [comment] = comments;
      expect(comment, exception.id).toContain(suppression);
      expect(
        comment?.split(`${marker}:`)[1]?.trim(),
        exception.id
      ).toBeTruthy();
    }
  });
});

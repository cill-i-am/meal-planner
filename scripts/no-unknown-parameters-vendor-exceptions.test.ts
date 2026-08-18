import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

interface VendorContractException {
  readonly id: string;
  readonly file: string;
  readonly parameter: string;
  readonly upstreamContract: string;
  readonly removalCondition: string;
}

// Last verified 2026-08-18: npm latest=next=alchemy@2.0.0-beta.72;
// anti-slop main=446268e5d15baa968eaec669ff65358d36ae6259;
// Alchemy main=6b73819a02f609e8942b1d9286dc197fbca200ab.
const vendorContractExceptions: readonly VendorContractException[] = [
  {
    file: "apps/api/src/features/imports/import-provider-kernel.ts",
    id: "ASU001",
    parameter: "body: unknown,",
    removalCondition: "public precise visual request transport",
    upstreamContract: "LanguageModel.callRaw -> Ai.run(model, body)",
  },
  {
    file: "apps/api/src/features/imports/import-provider-kernel.ts",
    id: "ASU002",
    parameter: "model: unknown,",
    removalCondition: "public precise visual request transport",
    upstreamContract: "LanguageModel.callRaw -> Ai.run(model, body)",
  },
  {
    file: "apps/api/src/features/imports/import-provider-kernel.ts",
    id: "ASU003",
    parameter: "body: unknown",
    removalCondition: "public precise visual request transport",
    upstreamContract: "LanguageModel.callRaw -> Ai.run(model, body)",
  },
  {
    file: "apps/api/src/features/imports/import-workflow-input.test-fixture.ts",
    id: "ASU004",
    parameter: "make: (rawEnv: unknown) => {",
    removalCondition: "precise env generic or supported real-runtime harness",
    upstreamContract: "WorkflowExport.make(env: unknown)",
  },
  {
    file: "apps/api/src/features/imports/import-provider-workflow-task.test-fixture.ts",
    id: "ASU005",
    parameter: "make: (rawEnv: unknown) => {",
    removalCondition: "precise env generic or supported real-runtime harness",
    upstreamContract: "WorkflowExport.make(env: unknown)",
  },
  {
    file: "apps/api/src/features/imports/import-provider-workflow-task.test-types.d.ts",
    id: "ASU006",
    parameter: "context: unknown,",
    removalCondition:
      "public precise host types or supported real-runtime harness",
    upstreamContract: "WorkflowEntrypoint constructor(context, env)",
  },
  {
    file: "apps/api/src/features/imports/import-provider-workflow-task.test-types.d.ts",
    id: "ASU007",
    parameter: "event: unknown,",
    removalCondition:
      "public precise host types or supported real-runtime harness",
    upstreamContract: "WorkflowEntrypoint.run(event, step)",
  },
  {
    file: "apps/api/src/features/imports/import-provider-workflow-task.test-types.d.ts",
    id: "ASU008",
    parameter: "step: unknown",
    removalCondition:
      "public precise host types or supported real-runtime harness",
    upstreamContract: "WorkflowEntrypoint.run(event, step)",
  },
  {
    file: "apps/api/src/features/imports/import-media-acquisition-object.integration.test.ts",
    id: "ASU009",
    parameter: "constructor(ctx: unknown) {",
    removalCondition:
      "public precise bridge generic or supported real-runtime harness",
    upstreamContract:
      "makeDurableObjectBridge(durableObject: typeof DurableObject)",
  },
];

const repositoryRootUrl = new URL("../", import.meta.url);
const repositoryRoot = fileURLToPath(repositoryRootUrl);
const ownedDirectories = ["apps", "packages", "scripts", "tools"];
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
const suppression = [
  "oxlint-disable-next-line ",
  "anti-slop/no-unknown-parameters",
].join("");

const trackedFiles = execFileSync("git", ["ls-files", "-z"], {
  cwd: repositoryRoot,
  encoding: "utf-8",
})
  .split("\0")
  .filter((file) => file.length > 0);

const ownedSourceFiles = (): readonly string[] =>
  trackedFiles.filter((file) => {
    const extension = file.slice(file.lastIndexOf("."));
    const isOwned =
      ownedRootFiles.has(file) ||
      ownedDirectories.some((directory) => file.startsWith(`${directory}/`));
    return isOwned && sourceExtensions.has(extension);
  });

const suppressionLocations = (): readonly string[] =>
  ownedSourceFiles().flatMap((file) =>
    readFileSync(new URL(file, repositoryRootUrl), "utf-8")
      .split("\n")
      .flatMap((line, index) =>
        line.includes(suppression) ? [`${file}:${index + 1}`] : []
      )
  );

describe("anti-slop vendor contract exceptions", () => {
  it("keeps exactly the nine reviewed Alchemy beta.72 exceptions", () => {
    expect(vendorContractExceptions).toHaveLength(9);
    expect(suppressionLocations()).toHaveLength(9);

    for (const exception of vendorContractExceptions) {
      const source = readFileSync(
        new URL(exception.file, repositoryRootUrl),
        "utf-8"
      );
      const lines = source.split("\n");
      const marker = `TODO(${exception.id} alchemy@2.0.0-beta.72)`;
      const markerIndexes = lines.flatMap((line, index) =>
        line.includes(marker) ? [index] : []
      );

      expect(markerIndexes, exception.id).toHaveLength(1);
      const [markerIndex] = markerIndexes;
      expect(markerIndex, exception.id).toBeDefined();
      if (markerIndex === undefined) {
        continue;
      }

      const comment = lines[markerIndex];
      expect(comment, exception.id).toContain(suppression);
      expect(comment, exception.id).toContain(exception.upstreamContract);
      expect(comment, exception.id).toContain("Schema");
      expect(comment, exception.id).toContain(exception.removalCondition);
      expect(lines[markerIndex + 1]?.trim(), exception.id).toBe(
        exception.parameter
      );
    }
  });
});

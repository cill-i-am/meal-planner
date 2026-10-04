import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import { readOwnedSources } from "./owned-source-files.js";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const domainRoot = path.join(repositoryRoot, "packages/recipe-domain/src");
const runtimeSpecifiers = (source: string) => {
  const file = ts.createSourceFile(
    "source.ts",
    source,
    ts.ScriptTarget.Latest,
    true
  );
  return file.statements.flatMap((statement) => {
    if (
      !ts.isImportDeclaration(statement) &&
      !ts.isExportDeclaration(statement)
    ) {
      return [];
    }
    if (
      ts.isImportDeclaration(statement) &&
      statement.importClause?.isTypeOnly
    ) {
      return [];
    }
    if (ts.isExportDeclaration(statement) && statement.isTypeOnly) {
      return [];
    }
    return statement.moduleSpecifier !== undefined &&
      ts.isStringLiteral(statement.moduleSpecifier)
      ? [statement.moduleSpecifier.text]
      : [];
  });
};

describe("recipe feature ownership", () => {
  it("keeps the domain independent from transports, hosts and provider adapters", () => {
    const dependencies = readdirSync(domainRoot)
      .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"))
      .flatMap((file) =>
        runtimeSpecifiers(readFileSync(path.join(domainRoot, file), "utf-8"))
      );
    expect(
      dependencies.filter(
        (dependency) => !dependency.startsWith(".") && dependency !== "effect"
      )
    ).toEqual([]);
  });

  it("keeps runtime domain dependencies acyclic", () => {
    const graph = new Map(
      readdirSync(domainRoot)
        .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"))
        .map((file) => [
          file,
          runtimeSpecifiers(readFileSync(path.join(domainRoot, file), "utf-8"))
            .filter((specifier) => specifier.startsWith("."))
            .map((specifier) =>
              path.basename(specifier).replace(/\.js$/u, ".ts")
            ),
        ])
    );
    const visit = (file: string, ancestors: readonly string[]): void => {
      expect(ancestors, `cycle through ${file}`).not.toContain(file);
      for (const dependency of graph.get(file) ?? []) {
        visit(dependency, [...ancestors, file]);
      }
    };
    for (const file of graph.keys()) {
      visit(file, []);
    }
  });

  it("keeps app consumers on the browser feature's public API", () => {
    const violations = readOwnedSources(repositoryRoot)
      .filter(
        ({ file }) =>
          file.startsWith("apps/web/src/") &&
          !file.includes("/features/recipe-import/") &&
          !file.includes(".test.")
      )
      .flatMap(({ file, source }) =>
        runtimeSpecifiers(source)
          .filter(
            (specifier) =>
              specifier.includes("/features/recipe-import/") &&
              !specifier.endsWith("/recipe-import/index.js")
          )
          .map((specifier) => `${file}: ${specifier}`)
      );
    expect(violations).toEqual([]);
  });
});

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseSync } from "oxc-parser";
import { describe, expect, it } from "vitest";

import { readOwnedSources } from "./owned-source-files.js";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const domainRoot = path.join(repositoryRoot, "packages/recipe-domain/src");
const runtimeSpecifiers = (file: string, source: string) => {
  const { program, errors } = parseSync(file, source);
  expect(errors, file).toEqual([]);
  return program.body.flatMap((statement) => {
    if (statement.type === "ImportDeclaration") {
      return statement.importKind === "type" ? [] : [statement.source.value];
    }
    if (
      (statement.type === "ExportNamedDeclaration" ||
        statement.type === "ExportAllDeclaration") &&
      statement.exportKind !== "type" &&
      statement.source
    ) {
      return [statement.source.value];
    }
    return [];
  });
};

describe("recipe feature ownership", () => {
  it("keeps the domain independent from transports, hosts and provider adapters", () => {
    const dependencies = readdirSync(domainRoot)
      .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"))
      .flatMap((file) =>
        runtimeSpecifiers(
          file,
          readFileSync(path.join(domainRoot, file), "utf-8")
        )
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
          runtimeSpecifiers(
            file,
            readFileSync(path.join(domainRoot, file), "utf-8")
          )
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
        runtimeSpecifiers(file, source)
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

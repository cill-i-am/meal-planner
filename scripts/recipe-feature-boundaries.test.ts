import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseSync } from "oxc-parser";
import { describe, expect, it } from "vitest";

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
    const visit = (file: string, ancestors: readonly string[]) => {
      expect(ancestors, `cycle through ${file}`).not.toContain(file);
      for (const dependency of graph.get(file) ?? []) {
        visit(dependency, [...ancestors, file]);
      }
    };
    for (const file of graph.keys()) {
      visit(file, []);
    }
  });
});

describe("recipe processing workspace ownership", () => {
  it("keeps source, media and evidence processing independent of the admitting API", () => {
    const root = path.join(repositoryRoot, "apps/recipe-imports/src");
    for (const file of readdirSync(root, {
      recursive: true,
      encoding: "utf-8",
    })) {
      if (!file.endsWith(".ts") || file.endsWith(".test.ts")) {
        continue;
      }
      const filePath = path.join(root, file);
      const { program, errors } = parseSync(
        file,
        readFileSync(filePath, "utf-8")
      );
      expect(errors, file).toEqual([]);
      for (const statement of program.body) {
        if (
          statement.type !== "ImportDeclaration" &&
          statement.type !== "ExportNamedDeclaration" &&
          statement.type !== "ExportAllDeclaration"
        ) {
          continue;
        }
        const specifier = statement.source?.value;
        if (!specifier) {
          continue;
        }
        if (specifier.startsWith(".")) {
          expect(
            path.relative(
              root,
              path.resolve(path.dirname(filePath), specifier)
            ),
            file
          ).not.toMatch(/^\.\.(?:\/|$)/u);
        } else {
          expect(specifier, file).not.toMatch(/^@meal-planner\/api(?:\/|$)/u);
        }
      }
    }
  });
});

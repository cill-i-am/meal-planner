import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { expect, it } from "vitest";

const root = fileURLToPath(new URL("../", import.meta.url));
const sources = (directory: string) =>
  readdirSync(path.join(root, directory), { recursive: true })
    .map(String)
    .filter(
      (file) =>
        /\.tsx?$/u.test(file) && !/\.(?:test|test-fixture|gen)\./u.test(file)
    )
    .map((file) => path.join(directory, file));
const imports = (file: string) => {
  const source = ts.createSourceFile(
    file,
    readFileSync(path.join(root, file), "utf-8"),
    ts.ScriptTarget.Latest,
    true
  );
  return source.statements.flatMap((statement) => {
    if (
      (ts.isImportDeclaration(statement) ||
        ts.isExportDeclaration(statement)) &&
      statement.moduleSpecifier &&
      ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      return [statement.moduleSpecifier.text];
    }
    return [];
  });
};
const owner = (file: string) =>
  /apps\/(?:web|api)\/src\/features\/(?<feature>[^/]+)\//u.exec(file)?.groups?.[
    "feature"
  ];
const target = (file: string, specifier: string) =>
  path.normalize(path.join(path.dirname(file), specifier));

it("consumes the reference frontend slices only through their public APIs", () => {
  const slices = new Set([
    "api-client",
    "auth",
    "family",
    "household-people",
    "household-profiles",
    "households",
    "recipe-import",
    "onboarding",
    "invitations",
    "request-recovery",
  ]);
  const violations: string[] = [];
  for (const file of sources("apps/web/src")) {
    for (const specifier of imports(file)) {
      if (
        /^@meal-planner\/(?:families|invitations)\/application$/u.test(
          specifier
        )
      ) {
        violations.push(
          `${file} imports server application capabilities: ${specifier}`
        );
      }
    }
    for (const specifier of imports(file).filter((value) =>
      value.startsWith(".")
    )) {
      const destination = target(file, specifier);
      const feature = owner(destination);
      if (
        feature &&
        slices.has(feature) &&
        owner(file) !== feature &&
        path.basename(destination) !== "index.js" &&
        !(
          feature === "api-client" &&
          file === "apps/web/src/router.tsx" &&
          path.basename(destination) === "start-runtime.js"
        )
      ) {
        violations.push(`${file} imports private ${destination}`);
      }
      if (
        ["auth", "family", "request-recovery"].includes(owner(file) ?? "") &&
        ["onboarding", "invitations"].includes(feature ?? "")
      ) {
        violations.push(`${file} depends on a caller feature: ${destination}`);
      }
    }
  }
  expect(violations).toEqual([]);
});

it("keeps family and invitation application packages independent of their hosts", () => {
  const violations: string[] = [];
  for (const feature of ["families", "invitations"]) {
    const directory = `packages/${feature}`;
    const manifest: {
      readonly exports: Readonly<Record<string, string>>;
      readonly dependencies: Readonly<Record<string, string>>;
    } = JSON.parse(
      readFileSync(path.join(root, directory, "package.json"), "utf-8")
    );
    expect(Object.keys(manifest.exports)).toContain("./application");
    for (const entry of Object.values(manifest.exports)) {
      expect(existsSync(path.join(root, directory, entry))).toBe(true);
    }
    for (const file of sources(`${directory}/src`)) {
      for (const specifier of imports(file)) {
        if (specifier.startsWith(".")) {
          if (!target(file, specifier).startsWith(`${directory}/src/`)) {
            violations.push(`${file}: ${specifier}`);
          }
        } else if (
          !Object.keys(manifest.dependencies).some(
            (dependency) =>
              specifier === dependency || specifier.startsWith(`${dependency}/`)
          )
        ) {
          violations.push(`${file}: undeclared host dependency ${specifier}`);
        }
        if (
          file.endsWith("/application.ts") &&
          /(?:http|react|drizzle|cloudflare|better-auth)/u.test(specifier)
        ) {
          violations.push(
            `${file}: application depends on transport ${specifier}`
          );
        }
      }
    }
  }
  expect(violations).toEqual([]);
});

it("keeps server feature adapters behind explicit auth and household interfaces", () => {
  const boundaries: Readonly<Record<string, readonly string[]>> = {
    auth: ["index.js", "http.js", "schema.js"],
    households: ["membership.js"],
  };
  const violations: string[] = [];
  for (const feature of ["families", "invitations"]) {
    for (const file of sources(`apps/api/src/features/${feature}`)) {
      for (const specifier of imports(file).filter((value) =>
        value.startsWith(".")
      )) {
        const destination = target(file, specifier);
        const destinationOwner = owner(destination);
        if (
          destinationOwner &&
          destinationOwner !== feature &&
          !boundaries[destinationOwner]?.includes(path.basename(destination))
        ) {
          violations.push(`${file} imports private ${destination}`);
        }
      }
    }
  }
  expect(violations).toEqual([]);
});

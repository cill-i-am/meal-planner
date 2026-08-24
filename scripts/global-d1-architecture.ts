import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path = require("node:path");

import ts from "typescript";

export interface TrackedArchitectureSource {
  readonly path: string;
  readonly source: string;
}

interface D1ResourceDeclaration {
  readonly exportName: string;
  readonly logicalId: string;
  readonly migrationsDir: string;
  readonly migrationsTable: string;
  readonly path: string;
}

interface ProviderAccountingTable {
  readonly exportName: string;
  readonly tableName: string;
}

interface D1QueryBinding {
  readonly path: string;
  readonly resource: string;
}

const expectedD1Resources: readonly D1ResourceDeclaration[] = [
  {
    exportName: "MealPlannerAuthDatabase",
    logicalId: "MealPlannerAuthDatabase",
    migrationsDir: "./apps/api/auth-migrations",
    migrationsTable: "d1_migrations",
    path: "apps/api/src/infrastructure/meal-planner-auth-database.ts",
  },
  {
    exportName: "ProviderAccountingDatabase",
    logicalId: "ProviderAccountingDatabase",
    migrationsDir: "./apps/api/provider-accounting-migrations",
    migrationsTable: "d1_migrations",
    path: "apps/api/src/infrastructure/provider-accounting-database.ts",
  },
];

const expectedD1ConsumerPaths = [
  "alchemy.run.ts",
  "apps/api/src/features/imports/import-recipe-recovery.workflow.ts",
  "apps/api/src/features/imports/import-runtime-composition.ts",
  "apps/api/src/features/imports/import-worker-request-layer.ts",
  "apps/api/src/features/imports/import.workflow.ts",
  "apps/api/src/features/provider-accounting/provider-accounting.repository.d1.ts",
  "apps/api/src/features/provider-accounting/provider-accounting.service.ts",
  "apps/api/src/worker.ts",
] as const;

const expectedD1QueryBindings: readonly D1QueryBinding[] = [
  {
    path: "apps/api/src/features/imports/import-runtime-composition.ts",
    resource: "ProviderAccountingDatabase",
  },
  {
    path: "apps/api/src/features/imports/import.workflow.ts",
    resource: "ProviderAccountingDatabase",
  },
  {
    path: "apps/api/src/worker.ts",
    resource: "MealPlannerAuthDatabase",
  },
  {
    path: "apps/api/src/worker.ts",
    resource: "ProviderAccountingDatabase",
  },
];

const expectedMigrationRoots = [
  "apps/api/auth-migrations",
  "apps/api/household-migrations",
  "apps/api/provider-accounting-migrations",
] as const;

const expectedProviderAccountingTables: readonly ProviderAccountingTable[] = [
  {
    exportName: "providerAccountingBudgets",
    tableName: "provider_accounting_budgets",
  },
  {
    exportName: "providerAccountingConservativeSettlements",
    tableName: "provider_accounting_conservative_settlements",
  },
  {
    exportName: "providerAccountingDispatches",
    tableName: "provider_accounting_dispatches",
  },
  {
    exportName: "providerAccountingRecipeReplayValues",
    tableName: "provider_accounting_recipe_replay_values",
  },
  {
    exportName: "providerAccountingReconciliations",
    tableName: "provider_accounting_reconciliations",
  },
];

const isProductionTypeScript = (entryPath: string): boolean =>
  [".ts", ".tsx"].includes(path.extname(entryPath)) &&
  !entryPath.endsWith(".d.ts") &&
  !entryPath.includes(".test.") &&
  !entryPath.includes(".test-fixture.") &&
  !entryPath.includes(".integration.") &&
  !entryPath.includes(".support.") &&
  !entryPath.includes(".fixture.") &&
  !entryPath.includes(".generated.") &&
  !entryPath.endsWith("-test-environment.ts") &&
  !entryPath.endsWith(".config.ts") &&
  !entryPath.includes("/test/") &&
  !entryPath.includes("/tests/") &&
  !entryPath.includes("/__tests__/") &&
  !entryPath.includes("/fixtures/") &&
  !entryPath.includes("/fixture/") &&
  !entryPath.includes("/generated/") &&
  !entryPath.includes("/support/") &&
  !entryPath.includes("/vendor/");

const isArchitectureSource = (entryPath: string): boolean =>
  entryPath === "alchemy.run.ts" ||
  (entryPath.startsWith("apps/api/src/") &&
    isProductionTypeScript(entryPath)) ||
  /^apps\/api\/[^/]*migrations\//u.test(entryPath);

/** Read the complete tracked production footprint inspected by the D1 guard. */
export const readTrackedGlobalD1Architecture = (
  repositoryRoot: string
): readonly TrackedArchitectureSource[] =>
  execFileSync("git", ["ls-files", "-z"], {
    cwd: repositoryRoot,
    encoding: "utf-8",
  })
    .split("\0")
    .filter(
      (entryPath) =>
        entryPath.length > 0 &&
        isArchitectureSource(entryPath) &&
        existsSync(path.join(repositoryRoot, entryPath))
    )
    .map((entryPath) => ({
      path: entryPath,
      source: readFileSync(path.join(repositoryRoot, entryPath), "utf-8"),
    }));

const sourceFile = ({ path: sourcePath, source }: TrackedArchitectureSource) =>
  ts.createSourceFile(
    sourcePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );

const stringProperty = (
  objectLiteral: ts.ObjectLiteralExpression | undefined,
  propertyName: string
): string | undefined => {
  const property = objectLiteral?.properties.find(
    (candidate): candidate is ts.PropertyAssignment =>
      ts.isPropertyAssignment(candidate) &&
      candidate.name.getText() === propertyName
  );
  return property && ts.isStringLiteralLike(property.initializer)
    ? property.initializer.text
    : undefined;
};

const collectD1Resources = (
  trackedSources: readonly TrackedArchitectureSource[]
): readonly D1ResourceDeclaration[] =>
  trackedSources.flatMap((trackedSource) => {
    const declarations: D1ResourceDeclaration[] = [];
    const file = sourceFile(trackedSource);

    const visit = (node: ts.Node): void => {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer &&
        ts.isCallExpression(node.initializer)
      ) {
        const call = node.initializer;
        const expression = call.expression.getText(file);
        if (
          expression === "D1.Database" ||
          expression.endsWith(".D1.Database")
        ) {
          const [logicalId, configuration] = call.arguments;
          declarations.push({
            exportName: node.name.text,
            logicalId:
              logicalId !== undefined && ts.isStringLiteralLike(logicalId)
                ? logicalId.text
                : "<non-literal>",
            migrationsDir:
              stringProperty(
                configuration !== undefined &&
                  ts.isObjectLiteralExpression(configuration)
                  ? configuration
                  : undefined,
                "migrationsDir"
              ) ?? "<missing>",
            migrationsTable:
              stringProperty(
                configuration !== undefined &&
                  ts.isObjectLiteralExpression(configuration)
                  ? configuration
                  : undefined,
                "migrationsTable"
              ) ?? "<missing>",
            path: trackedSource.path,
          });
        }
      }
      ts.forEachChild(node, visit);
    };

    visit(file);
    return declarations;
  });

const isD1Consumer = (trackedSource: TrackedArchitectureSource): boolean => {
  const file = sourceFile(trackedSource);
  let consumer = false;

  const visit = (node: ts.Node): void => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const moduleName = node.moduleSpecifier.text;
      consumer ||=
        moduleName === "drizzle-orm/d1" ||
        /\/infrastructure\/(?:meal-planner-auth|provider-accounting)-database\.js$/u.test(
          moduleName
        );
    }
    if (ts.isPropertyAccessExpression(node)) {
      const expression = node.getText(file);
      consumer ||=
        expression.endsWith("D1.QueryDatabase") ||
        expression.endsWith("D1.QueryDatabaseBinding");
    }
    ts.forEachChild(node, visit);
  };

  visit(file);
  return consumer;
};

const collectD1QueryBindings = (
  trackedSources: readonly TrackedArchitectureSource[]
): readonly D1QueryBinding[] =>
  trackedSources.flatMap((trackedSource) => {
    const bindings: D1QueryBinding[] = [];
    const file = sourceFile(trackedSource);

    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        node.expression.getText(file).endsWith("D1.QueryDatabase")
      ) {
        const [resource] = node.arguments;
        bindings.push({
          path: trackedSource.path,
          resource: resource?.getText(file) ?? "<missing>",
        });
      }
      ts.forEachChild(node, visit);
    };

    visit(file);
    return bindings;
  });

const collectMigrationRoots = (
  trackedSources: readonly TrackedArchitectureSource[]
): readonly string[] =>
  [
    ...new Set(
      trackedSources.flatMap(({ path: sourcePath }) => {
        const match = /^(?<migrationRoot>apps\/api\/[^/]*migrations)\//u.exec(
          sourcePath
        );
        return match?.groups?.["migrationRoot"]
          ? [match.groups["migrationRoot"]]
          : [];
      })
    ),
  ].toSorted();

const collectProviderAccountingTables = (
  trackedSource: TrackedArchitectureSource
): {
  readonly allSqliteTableCalls: number;
  readonly exportedTables: readonly ProviderAccountingTable[];
} => {
  const file = sourceFile(trackedSource);
  let allSqliteTableCalls = 0;
  const exportedTables: ProviderAccountingTable[] = [];

  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "sqliteTable"
    ) {
      allSqliteTableCalls += 1;
    }
    ts.forEachChild(node, visit);
  };
  visit(file);

  for (const statement of file.statements) {
    if (
      !ts.isVariableStatement(statement) ||
      !statement.modifiers?.some(
        (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword
      )
    ) {
      continue;
    }
    for (const declaration of statement.declarationList.declarations) {
      if (
        !ts.isIdentifier(declaration.name) ||
        !declaration.initializer ||
        !ts.isCallExpression(declaration.initializer) ||
        !ts.isIdentifier(declaration.initializer.expression) ||
        declaration.initializer.expression.text !== "sqliteTable"
      ) {
        continue;
      }
      const [tableName] = declaration.initializer.arguments;
      exportedTables.push({
        exportName: declaration.name.text,
        tableName:
          tableName !== undefined && ts.isStringLiteralLike(tableName)
            ? tableName.text
            : "<non-literal>",
      });
    }
  }

  return {
    allSqliteTableCalls,
    exportedTables: exportedTables.toSorted((left, right) =>
      left.exportName.localeCompare(right.exportName)
    ),
  };
};

const collectCreatedTables = (migration: string): readonly string[] =>
  [
    ...migration.matchAll(
      /\bCREATE\s+TABLE\s+[`"]?(?<tableName>[^`"\s(]+)[`"]?/giu
    ),
  ]
    .flatMap((match) =>
      match.groups?.["tableName"] ? [match.groups["tableName"]] : []
    )
    .toSorted();

const collectSnapshotTables = (snapshotSource: string): readonly string[] => {
  const snapshot = JSON.parse(snapshotSource) as {
    readonly ddl: readonly {
      readonly entityType?: string;
      readonly name?: string;
    }[];
  };
  return snapshot.ddl
    .flatMap((entry) =>
      entry.entityType === "tables" && entry.name !== undefined
        ? [entry.name]
        : []
    )
    .toSorted();
};

const exactValueViolation = <Actual, Expected>(
  label: string,
  actual: Actual,
  expected: Expected
): readonly string[] =>
  JSON.stringify(actual) === JSON.stringify(expected)
    ? []
    : [
        `${label}: expected ${JSON.stringify(expected)}, found ${JSON.stringify(actual)}`,
      ];

/**
 * Enforce the complete tracked production D1 footprint. This is an allowlist,
 * not a blacklist of retired prototype names.
 */
export const inspectGlobalD1Architecture = (
  trackedSources: readonly TrackedArchitectureSource[]
): readonly string[] => {
  const resources = collectD1Resources(trackedSources).toSorted((left, right) =>
    left.path.localeCompare(right.path)
  );
  const queryBindings = collectD1QueryBindings(trackedSources).toSorted(
    (left, right) =>
      left.path.localeCompare(right.path) ||
      left.resource.localeCompare(right.resource)
  );
  const consumerPaths = trackedSources
    .filter(isD1Consumer)
    .map(({ path: sourcePath }) => sourcePath)
    .toSorted();
  const migrationRoots = collectMigrationRoots(trackedSources);
  const providerSchemaPath =
    "apps/api/src/features/provider-accounting/provider-accounting.database-schema.ts";
  const providerMigrationPath =
    "apps/api/provider-accounting-migrations/20260824183013_provider_accounting/migration.sql";
  const providerSnapshotPath =
    "apps/api/provider-accounting-migrations/20260824183013_provider_accounting/snapshot.json";
  const providerSchema = trackedSources.find(
    ({ path: sourcePath }) => sourcePath === providerSchemaPath
  );
  const providerMigrations = trackedSources.filter(
    ({ path: sourcePath }) =>
      sourcePath.startsWith("apps/api/provider-accounting-migrations/") &&
      sourcePath.endsWith("/migration.sql")
  );

  const violations = [
    ...exactValueViolation(
      "global D1 resources",
      resources,
      expectedD1Resources
    ),
    ...exactValueViolation(
      "global D1 query bindings",
      queryBindings,
      expectedD1QueryBindings
    ),
    ...exactValueViolation(
      "global D1 consumers",
      consumerPaths,
      expectedD1ConsumerPaths
    ),
    ...exactValueViolation(
      "persistence migration roots",
      migrationRoots,
      expectedMigrationRoots
    ),
  ];

  if (providerSchema) {
    const tables = collectProviderAccountingTables(providerSchema);
    violations.push(
      ...exactValueViolation(
        "provider-accounting sqliteTable call count",
        tables.allSqliteTableCalls,
        expectedProviderAccountingTables.length
      ),
      ...exactValueViolation(
        "provider-accounting exported tables",
        tables.exportedTables,
        expectedProviderAccountingTables
      )
    );
  } else {
    violations.push(
      `provider-accounting schema missing: ${providerSchemaPath}`
    );
  }

  violations.push(
    ...exactValueViolation(
      "provider-accounting migration files",
      providerMigrations.map(({ path: sourcePath }) => sourcePath).toSorted(),
      [providerMigrationPath]
    )
  );
  const providerMigration = providerMigrations.find(
    ({ path: sourcePath }) => sourcePath === providerMigrationPath
  );
  if (providerMigration) {
    violations.push(
      ...exactValueViolation(
        "provider-accounting migration tables",
        collectCreatedTables(providerMigration.source),
        expectedProviderAccountingTables
          .map(({ tableName }) => tableName)
          .toSorted()
      )
    );
  }

  const providerSnapshots = trackedSources.filter(
    ({ path: sourcePath }) =>
      sourcePath.startsWith("apps/api/provider-accounting-migrations/") &&
      sourcePath.endsWith("/snapshot.json")
  );
  violations.push(
    ...exactValueViolation(
      "provider-accounting snapshot files",
      providerSnapshots.map(({ path: sourcePath }) => sourcePath).toSorted(),
      [providerSnapshotPath]
    )
  );
  const providerSnapshot = providerSnapshots.find(
    ({ path: sourcePath }) => sourcePath === providerSnapshotPath
  );
  if (providerSnapshot) {
    violations.push(
      ...exactValueViolation(
        "provider-accounting snapshot tables",
        collectSnapshotTables(providerSnapshot.source),
        expectedProviderAccountingTables
          .map(({ tableName }) => tableName)
          .toSorted()
      )
    );
  }

  return violations;
};

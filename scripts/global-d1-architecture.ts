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

interface D1ConsumerCall {
  readonly arguments: readonly string[];
  readonly binding: string;
  readonly path: string;
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

const expectedD1ConsumerCalls: readonly D1ConsumerCall[] = [
  {
    arguments: ["yield* authQueryDatabase.raw"],
    binding: "drizzle",
    path: "apps/api/src/worker.ts",
  },
];

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

const apiProductionPaths = (repositoryRoot: string): readonly string[] => {
  const apiRoot = path.join(repositoryRoot, "apps/api");
  const configPath = path.join(apiRoot, "tsconfig.build.json");
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  if (config.error) {
    throw new Error(
      ts.formatDiagnostic(config.error, {
        getCanonicalFileName: (fileName) => fileName,
        getCurrentDirectory: () => repositoryRoot,
        getNewLine: () => "\n",
      })
    );
  }
  const parsed = ts.parseJsonConfigFileContent(
    config.config,
    ts.sys,
    apiRoot,
    undefined,
    configPath
  );
  if (parsed.errors.length > 0) {
    throw new Error(
      ts.formatDiagnostics(parsed.errors, {
        getCanonicalFileName: (fileName) => fileName,
        getCurrentDirectory: () => repositoryRoot,
        getNewLine: () => "\n",
      })
    );
  }
  return parsed.fileNames.map((fileName) =>
    path.relative(repositoryRoot, fileName).split(path.sep).join("/")
  );
};

/** Read the complete tracked production footprint inspected by the D1 guard. */
export const readTrackedGlobalD1Architecture = (
  repositoryRoot: string
): readonly TrackedArchitectureSource[] => {
  const trackedPaths = execFileSync("git", ["ls-files", "-z"], {
    cwd: repositoryRoot,
    encoding: "utf-8",
  })
    .split("\0")
    .filter((entryPath) => entryPath.length > 0);
  const trackedPathSet = new Set(trackedPaths);
  const architecturePaths = [
    ...apiProductionPaths(repositoryRoot),
    "alchemy.run.ts",
    ...trackedPaths.filter((entryPath) =>
      /^apps\/api\/[^/]*migrations\//u.test(entryPath)
    ),
  ];
  return [...new Set(architecturePaths)]
    .filter(
      (entryPath) =>
        trackedPathSet.has(entryPath) &&
        existsSync(path.join(repositoryRoot, entryPath))
    )
    .toSorted()
    .map((entryPath) => ({
      path: entryPath,
      source: readFileSync(path.join(repositoryRoot, entryPath), "utf-8"),
    }));
};

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

const collectUnsupportedD1ResourceIndirection = (
  trackedSources: readonly TrackedArchitectureSource[]
): readonly string[] =>
  trackedSources.flatMap((trackedSource) => {
    const violations: string[] = [];
    const file = sourceFile(trackedSource);

    for (const statement of file.statements) {
      if (
        !ts.isImportDeclaration(statement) ||
        !ts.isStringLiteral(statement.moduleSpecifier) ||
        statement.moduleSpecifier.text !== "alchemy/Cloudflare" ||
        statement.importClause?.namedBindings === undefined ||
        !ts.isNamedImports(statement.importClause.namedBindings)
      ) {
        continue;
      }
      for (const binding of statement.importClause.namedBindings.elements) {
        if ((binding.propertyName ?? binding.name).text === "D1") {
          violations.push(
            `${trackedSource.path}: named D1 factory imports are forbidden`
          );
        }
      }
    }

    const visit = (node: ts.Node): void => {
      if (ts.isPropertyAccessExpression(node)) {
        const expression = node.getText(file);
        if (
          (expression === "D1.Database" ||
            expression.endsWith(".D1.Database")) &&
          !(
            ts.isCallExpression(node.parent) &&
            node.parent.expression === node &&
            ts.isVariableDeclaration(node.parent.parent) &&
            node.parent.parent.initializer === node.parent &&
            ts.isIdentifier(node.parent.parent.name)
          )
        ) {
          violations.push(
            `${trackedSource.path}: D1.Database must directly initialize a named resource declaration`
          );
        }
        if (
          node.name.text === "D1" &&
          !(
            ts.isPropertyAccessExpression(node.parent) &&
            node.parent.expression === node &&
            ["Database", "QueryDatabase", "QueryDatabaseBinding"].includes(
              node.parent.name.text
            )
          )
        ) {
          violations.push(
            `${trackedSource.path}: D1 namespaces must not be aliased or wrapped`
          );
        }
      }
      ts.forEachChild(node, visit);
    };

    visit(file);
    return violations;
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

const collectUnsupportedD1ConsumerIndirection = (
  trackedSources: readonly TrackedArchitectureSource[]
): readonly string[] =>
  trackedSources.flatMap((trackedSource) => {
    const violations: string[] = [];
    const file = sourceFile(trackedSource);
    const runtimeConsumerBindings = new Set<string>();

    for (const statement of file.statements) {
      if (
        !ts.isImportDeclaration(statement) ||
        !ts.isStringLiteral(statement.moduleSpecifier) ||
        statement.moduleSpecifier.text !== "drizzle-orm/d1" ||
        statement.importClause === undefined
      ) {
        continue;
      }
      const { importClause } = statement;
      if (importClause.name !== undefined) {
        violations.push(
          `${trackedSource.path}: default D1 consumer imports are forbidden`
        );
      }
      const bindings = importClause.namedBindings;
      if (bindings !== undefined && ts.isNamespaceImport(bindings)) {
        violations.push(
          `${trackedSource.path}: namespace D1 consumer imports are forbidden`
        );
      }
      if (bindings !== undefined && ts.isNamedImports(bindings)) {
        for (const binding of bindings.elements) {
          if (binding.propertyName !== undefined) {
            violations.push(
              `${trackedSource.path}: aliased D1 consumer imports are forbidden`
            );
          }
          if (!importClause.isTypeOnly && !binding.isTypeOnly) {
            runtimeConsumerBindings.add(binding.name.text);
          }
        }
      }
    }

    const visit = (node: ts.Node): void => {
      if (
        ts.isStringLiteralLike(node) &&
        node.text === "drizzle-orm/d1" &&
        !(
          ts.isImportDeclaration(node.parent) &&
          node.parent.moduleSpecifier === node
        )
      ) {
        violations.push(
          `${trackedSource.path}: dynamic D1 consumer imports are forbidden`
        );
      }
      if (
        ts.isIdentifier(node) &&
        runtimeConsumerBindings.has(node.text) &&
        !ts.isImportSpecifier(node.parent) &&
        !(ts.isCallExpression(node.parent) && node.parent.expression === node)
      ) {
        violations.push(
          `${trackedSource.path}: D1 consumer imports must be called directly`
        );
      }
      ts.forEachChild(node, visit);
    };
    visit(file);

    return violations;
  });

const collectD1ConsumerCalls = (
  trackedSources: readonly TrackedArchitectureSource[]
): readonly D1ConsumerCall[] =>
  trackedSources.flatMap((trackedSource) => {
    const file = sourceFile(trackedSource);
    const runtimeConsumerBindings = new Set<string>();
    const calls: D1ConsumerCall[] = [];

    for (const statement of file.statements) {
      if (
        !ts.isImportDeclaration(statement) ||
        !ts.isStringLiteral(statement.moduleSpecifier) ||
        statement.moduleSpecifier.text !== "drizzle-orm/d1" ||
        statement.importClause === undefined ||
        statement.importClause.isTypeOnly ||
        statement.importClause.namedBindings === undefined ||
        !ts.isNamedImports(statement.importClause.namedBindings)
      ) {
        continue;
      }
      for (const binding of statement.importClause.namedBindings.elements) {
        if (!binding.isTypeOnly) {
          runtimeConsumerBindings.add(binding.name.text);
        }
      }
    }

    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        runtimeConsumerBindings.has(node.expression.text)
      ) {
        calls.push({
          arguments: node.arguments.map((argument) => argument.getText(file)),
          binding: node.expression.text,
          path: trackedSource.path,
        });
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
    return calls;
  });

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

const collectUnsupportedD1QueryBindingIndirection = (
  trackedSources: readonly TrackedArchitectureSource[]
): readonly string[] =>
  trackedSources.flatMap((trackedSource) => {
    const violations: string[] = [];
    const file = sourceFile(trackedSource);

    const visit = (node: ts.Node): void => {
      if (ts.isPropertyAccessExpression(node)) {
        const expression = node.getText(file);
        if (
          (expression === "D1.QueryDatabase" ||
            expression.endsWith(".D1.QueryDatabase")) &&
          !(ts.isCallExpression(node.parent) && node.parent.expression === node)
        ) {
          violations.push(
            `${trackedSource.path}: D1.QueryDatabase aliases are forbidden`
          );
        }
        if (
          (expression === "D1.QueryDatabaseBinding" ||
            expression.endsWith(".D1.QueryDatabaseBinding")) &&
          !(
            ts.isCallExpression(node.parent) &&
            node.parent.arguments.some((argument) => argument === node)
          )
        ) {
          violations.push(
            `${trackedSource.path}: D1.QueryDatabaseBinding must be composed directly`
          );
        }
      }
      ts.forEachChild(node, visit);
    };

    visit(file);
    return violations;
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
  readonly unsupportedIndirections: readonly string[];
} => {
  const file = sourceFile(trackedSource);
  let allSqliteTableCalls = 0;
  const exportedTables: ProviderAccountingTable[] = [];
  const unsupportedIndirections: string[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && node.text === "sqliteTable") {
      const { parent } = node;
      const directCall =
        ts.isCallExpression(parent) && parent.expression === node;
      const directImport =
        ts.isImportSpecifier(parent) &&
        parent.name.text === "sqliteTable" &&
        parent.propertyName === undefined;
      if (!(directCall || directImport)) {
        unsupportedIndirections.push(
          `${trackedSource.path}: sqliteTable aliases and wrappers are forbidden`
        );
      }
    }
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
    unsupportedIndirections,
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
  const consumerCalls = collectD1ConsumerCalls(trackedSources).toSorted(
    (left, right) =>
      left.path.localeCompare(right.path) ||
      left.binding.localeCompare(right.binding) ||
      JSON.stringify(left.arguments).localeCompare(
        JSON.stringify(right.arguments)
      )
  );
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
    ...collectUnsupportedD1ResourceIndirection(trackedSources),
    ...collectUnsupportedD1QueryBindingIndirection(trackedSources),
    ...collectUnsupportedD1ConsumerIndirection(trackedSources),
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
      "global D1 consumer calls",
      consumerCalls,
      expectedD1ConsumerCalls
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
      ...tables.unsupportedIndirections,
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

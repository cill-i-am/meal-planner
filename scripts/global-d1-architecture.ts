import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path = require("node:path");

import ts from "typescript";

export interface TrackedArchitectureSource {
  readonly path: string;
  readonly source: string;
  readonly sourceFile?: ts.SourceFile;
}

/** The tracked production inventory and its authoritative API compiler program. */
export interface TrackedGlobalD1Architecture {
  readonly program: ts.Program;
  readonly sources: readonly TrackedArchitectureSource[];
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
  "apps/api/src/features/households/people/household-people.control-plane.ts",
  "apps/api/src/features/households/people/member-departure.workflow.ts",
  "apps/api/src/features/imports/import-recipe-recovery.workflow.ts",
  "apps/api/src/features/imports/import-runtime-composition.ts",
  "apps/api/src/features/imports/import-worker-request-layer.ts",
  "apps/api/src/features/imports/import.workflow.ts",
  "apps/api/src/features/provider-accounting/provider-accounting.database.ts",
  "apps/api/src/worker.ts",
] as const;

const expectedD1ConsumerCalls: readonly D1ConsumerCall[] = [
  {
    arguments: ["yield* options.authDatabase"],
    binding: "drizzle",
    path: "apps/api/src/features/households/people/member-departure.workflow.ts",
  },
  {
    arguments: ["binding"],
    binding: "drizzle",
    path: "apps/api/src/features/provider-accounting/provider-accounting.database.ts",
  },
  {
    arguments: ["yield* authQueryDatabase.raw"],
    binding: "drizzle",
    path: "apps/api/src/worker.ts",
  },
];

const expectedD1QueryBindings: readonly D1QueryBinding[] = [
  {
    path: "apps/api/src/features/households/people/member-departure.workflow.ts",
    resource: "MealPlannerAuthDatabase",
  },
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

const apiProductionProgram = (repositoryRoot: string): ts.Program => {
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
  if (parsed.projectReferences === undefined) {
    return ts.createProgram({
      options: parsed.options,
      rootNames: parsed.fileNames,
    });
  }
  return ts.createProgram({
    options: parsed.options,
    projectReferences: parsed.projectReferences,
    rootNames: parsed.fileNames,
  });
};

const repositoryPath = (repositoryRoot: string, absolutePath: string): string =>
  path.relative(repositoryRoot, absolutePath).split(path.sep).join("/");

const isRepositorySource = (entryPath: string): boolean =>
  entryPath.length > 0 &&
  entryPath !== ".." &&
  !entryPath.startsWith("../") &&
  !path.isAbsolute(entryPath) &&
  !entryPath.startsWith("node_modules/");

const localModuleSpecifiers = (
  sourceFile: ts.SourceFile
): readonly string[] => {
  const specifiers: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteralLike(node.moduleSpecifier) &&
      node.moduleSpecifier.text.startsWith(".")
    ) {
      specifiers.push(node.moduleSpecifier.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return specifiers;
};

/** Read the complete tracked production footprint inspected by the D1 guard. */
export const readTrackedGlobalD1Architecture = (
  repositoryRoot: string
): TrackedGlobalD1Architecture => {
  const trackedPaths = execFileSync("git", ["ls-files", "-z"], {
    cwd: repositoryRoot,
    encoding: "utf-8",
  })
    .split("\0")
    .filter((entryPath) => entryPath.length > 0);
  const trackedPathSet = new Set(trackedPaths);
  const program = apiProductionProgram(repositoryRoot);
  const programSources = program.getSourceFiles().flatMap((sourceFile) => {
    if (sourceFile.isDeclarationFile) {
      return [];
    }
    const entryPath = repositoryPath(repositoryRoot, sourceFile.fileName);
    return isRepositorySource(entryPath) ? [{ entryPath, sourceFile }] : [];
  });

  for (const { entryPath } of programSources) {
    if (!trackedPathSet.has(entryPath)) {
      throw new Error(`untracked local production source: ${entryPath}`);
    }
  }

  for (const { sourceFile } of programSources) {
    for (const moduleSpecifier of localModuleSpecifiers(sourceFile)) {
      const resolved = ts.resolveModuleName(
        moduleSpecifier,
        sourceFile.fileName,
        program.getCompilerOptions(),
        ts.sys
      ).resolvedModule;
      if (resolved === undefined) {
        throw new Error(
          `unresolved local production import: ${repositoryPath(repositoryRoot, sourceFile.fileName)} -> ${moduleSpecifier}`
        );
      }
    }
  }

  const sourceFileByPath = new Map(
    programSources.map(({ entryPath, sourceFile }) => [entryPath, sourceFile])
  );
  const architecturePaths = [
    ...sourceFileByPath.keys(),
    "alchemy.run.ts",
    ...trackedPaths.filter((entryPath) =>
      /^apps\/api\/[^/]*migrations\//u.test(entryPath)
    ),
  ];
  const sources = [...new Set(architecturePaths)]
    .filter(
      (entryPath) =>
        trackedPathSet.has(entryPath) &&
        existsSync(path.join(repositoryRoot, entryPath))
    )
    .toSorted()
    .map((entryPath) => {
      const compiledSource = sourceFileByPath.get(entryPath);
      const trackedSource = {
        path: entryPath,
        source: readFileSync(path.join(repositoryRoot, entryPath), "utf-8"),
      };
      return compiledSource === undefined
        ? trackedSource
        : { ...trackedSource, sourceFile: compiledSource };
    });
  return { program, sources };
};

const sourceFile = ({
  path: sourcePath,
  source,
  sourceFile: compiledSource,
}: TrackedArchitectureSource) =>
  compiledSource ??
  ts.createSourceFile(
    sourcePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );

interface SensitiveD1Symbols {
  readonly d1Namespace: ts.Symbol;
  readonly database: ts.Symbol;
  readonly drizzle: ts.Symbol;
  readonly queryDatabase: ts.Symbol;
  readonly queryDatabaseBinding: ts.Symbol;
  readonly sqliteTable: ts.Symbol;
}

const canonicalSymbol = (
  checker: ts.TypeChecker,
  symbol: ts.Symbol | undefined
): ts.Symbol | undefined =>
  symbol?.flags === ts.SymbolFlags.Alias
    ? checker.getAliasedSymbol(symbol)
    : symbol;

const requiredExport = (
  checker: ts.TypeChecker,
  moduleSymbol: ts.Symbol,
  exportName: string
): ts.Symbol => {
  const exported = checker
    .getExportsOfModule(moduleSymbol)
    .find((candidate) => candidate.getName() === exportName);
  const canonical = canonicalSymbol(checker, exported);
  if (canonical === undefined) {
    throw new Error(
      `global D1 guard could not resolve export ${moduleSymbol.getName()}.${exportName}`
    );
  }
  return canonical;
};

const requiredModule = (
  program: ts.Program,
  checker: ts.TypeChecker,
  moduleName: string
): ts.Symbol => {
  for (const file of program.getSourceFiles()) {
    for (const statement of file.statements) {
      if (
        ts.isImportDeclaration(statement) &&
        ts.isStringLiteralLike(statement.moduleSpecifier) &&
        statement.moduleSpecifier.text === moduleName
      ) {
        const symbol = canonicalSymbol(
          checker,
          checker.getSymbolAtLocation(statement.moduleSpecifier)
        );
        if (symbol !== undefined) {
          return symbol;
        }
      }
    }
  }
  throw new Error(`global D1 guard could not resolve module ${moduleName}`);
};

const sensitiveD1Symbols = (
  program: ts.Program,
  checker: ts.TypeChecker
): SensitiveD1Symbols => {
  const cloudflare = requiredModule(program, checker, "alchemy/Cloudflare");
  const d1Namespace = requiredExport(checker, cloudflare, "D1");
  const drizzleD1 = requiredModule(program, checker, "drizzle-orm/d1");
  const sqliteCore = requiredModule(
    program,
    checker,
    "drizzle-orm/sqlite-core"
  );
  return {
    d1Namespace,
    database: requiredExport(checker, d1Namespace, "Database"),
    drizzle: requiredExport(checker, drizzleD1, "drizzle"),
    queryDatabase: requiredExport(checker, d1Namespace, "QueryDatabase"),
    queryDatabaseBinding: requiredExport(
      checker,
      d1Namespace,
      "QueryDatabaseBinding"
    ),
    sqliteTable: requiredExport(checker, sqliteCore, "sqliteTable"),
  };
};

const constantString = (
  expression: ts.Expression,
  checker: ts.TypeChecker,
  seenSymbols: ReadonlySet<ts.Symbol> = new Set()
): string | undefined => {
  if (ts.isStringLiteralLike(expression)) {
    return expression.text;
  }
  if (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isTypeAssertionExpression(expression) ||
    ts.isSatisfiesExpression(expression)
  ) {
    return constantString(expression.expression, checker, seenSymbols);
  }
  if (
    ts.isBinaryExpression(expression) &&
    expression.operatorToken.kind === ts.SyntaxKind.PlusToken
  ) {
    const left = constantString(expression.left, checker, seenSymbols);
    const right = constantString(expression.right, checker, seenSymbols);
    return left === undefined || right === undefined ? undefined : left + right;
  }
  if (ts.isIdentifier(expression)) {
    const symbol = canonicalSymbol(
      checker,
      checker.getSymbolAtLocation(expression)
    );
    if (symbol === undefined || seenSymbols.has(symbol)) {
      return undefined;
    }
    const nextSeen = new Set([...seenSymbols, symbol]);
    for (const declaration of symbol.declarations ?? []) {
      if (
        ts.isVariableDeclaration(declaration) &&
        declaration.initializer !== undefined
      ) {
        const resolved = constantString(
          declaration.initializer,
          checker,
          nextSeen
        );
        if (resolved !== undefined) {
          return resolved;
        }
      }
    }
  }
  return undefined;
};

const expressionSymbol = (
  checker: ts.TypeChecker,
  expression: ts.Expression
): ts.Symbol | undefined => {
  const direct = canonicalSymbol(
    checker,
    checker.getSymbolAtLocation(expression)
  );
  if (direct !== undefined || !ts.isElementAccessExpression(expression)) {
    return direct;
  }
  const propertyName = constantString(expression.argumentExpression, checker);
  return propertyName === undefined
    ? undefined
    : canonicalSymbol(
        checker,
        checker.getPropertyOfType(
          checker.getTypeAtLocation(expression.expression),
          propertyName
        )
      );
};

const isImportBinding = (node: ts.Node): boolean =>
  ts.isImportSpecifier(node.parent) ||
  ts.isNamespaceImport(node.parent) ||
  (ts.isImportClause(node.parent) && node.parent.name === node);

const isPropertyName = (node: ts.Node): boolean =>
  ts.isIdentifier(node) &&
  ts.isPropertyAccessExpression(node.parent) &&
  node.parent.name === node;

const dynamicImportViolation = (
  node: ts.Node,
  checker: ts.TypeChecker,
  sourcePath: string
): string | undefined => {
  if (
    !ts.isCallExpression(node) ||
    node.expression.kind !== ts.SyntaxKind.ImportKeyword
  ) {
    return undefined;
  }
  const [moduleExpression] = node.arguments;
  const moduleName =
    moduleExpression === undefined
      ? undefined
      : constantString(moduleExpression, checker);
  if (moduleName === undefined) {
    return `${sourcePath}: dynamic imports must be statically resolvable by the global D1 guard`;
  }
  return moduleName === "drizzle-orm/d1"
    ? `${sourcePath}: dynamic D1 consumer imports are forbidden`
    : undefined;
};

const sensitiveExpression = (
  node: ts.Node
): node is
  | ts.Identifier
  | ts.PropertyAccessExpression
  | ts.ElementAccessExpression =>
  (ts.isIdentifier(node) ||
    ts.isPropertyAccessExpression(node) ||
    ts.isElementAccessExpression(node)) &&
  !isPropertyName(node);

const d1NamespaceViolation = (
  node: ts.Expression,
  checker: ts.TypeChecker,
  d1Members: ReadonlySet<ts.Symbol>,
  sourcePath: string
): string | undefined => {
  const { parent } = node;
  const composedMember =
    (ts.isPropertyAccessExpression(parent) ||
      ts.isElementAccessExpression(parent)) &&
    parent.expression === node
      ? expressionSymbol(checker, parent)
      : undefined;
  return composedMember === undefined || !d1Members.has(composedMember)
    ? `${sourcePath}: the Alchemy D1 namespace must be composed directly`
    : undefined;
};

const databaseViolation = (
  node: ts.Expression,
  file: ts.SourceFile,
  sourcePath: string
): string | undefined => {
  const { parent } = node;
  const directResource =
    ts.isCallExpression(parent) &&
    parent.expression === node &&
    node.getText(file) === "Cloudflare.D1.Database" &&
    ts.isVariableDeclaration(parent.parent) &&
    parent.parent.initializer === parent &&
    ts.isIdentifier(parent.parent.name);
  return directResource
    ? undefined
    : `${sourcePath}: D1.Database must directly initialize a named resource declaration`;
};

const queryDatabaseViolation = (
  node: ts.Expression,
  file: ts.SourceFile,
  sourcePath: string
): string | undefined => {
  const { parent } = node;
  const directQuery =
    ts.isCallExpression(parent) &&
    parent.expression === node &&
    node.getText(file) === "Cloudflare.D1.QueryDatabase";
  return directQuery
    ? undefined
    : `${sourcePath}: D1.QueryDatabase must be called directly`;
};

const queryDatabaseBindingViolation = (
  node: ts.Expression,
  file: ts.SourceFile,
  sourcePath: string
): string | undefined => {
  const { parent } = node;
  const directBinding =
    node.getText(file) === "Cloudflare.D1.QueryDatabaseBinding" &&
    ts.isCallExpression(parent) &&
    parent.arguments.some((argument) => argument === node);
  return directBinding
    ? undefined
    : `${sourcePath}: D1.QueryDatabaseBinding must be composed directly`;
};

const drizzleViolation = (
  node: ts.Expression,
  sourcePath: string
): string | undefined => {
  if (isImportBinding(node)) {
    return undefined;
  }
  const { parent } = node;
  const directConsumer =
    ts.isIdentifier(node) &&
    node.text === "drizzle" &&
    ts.isCallExpression(parent) &&
    parent.expression === node;
  return directConsumer
    ? undefined
    : `${sourcePath}: the D1 drizzle consumer must be called directly`;
};

const sqliteTableViolation = (
  node: ts.Expression,
  sourcePath: string
): string | undefined => {
  if (isImportBinding(node)) {
    return undefined;
  }
  const { parent } = node;
  const directTable =
    ts.isIdentifier(node) &&
    node.text === "sqliteTable" &&
    ts.isCallExpression(parent) &&
    parent.expression === node;
  return directTable
    ? undefined
    : `${sourcePath}: sqliteTable aliases, wrappers, and element access are forbidden`;
};

const semanticExpressionViolation = (
  node:
    | ts.Identifier
    | ts.PropertyAccessExpression
    | ts.ElementAccessExpression,
  symbol: ts.Symbol | undefined,
  checker: ts.TypeChecker,
  symbols: SensitiveD1Symbols,
  d1Members: ReadonlySet<ts.Symbol>,
  file: ts.SourceFile,
  sourcePath: string,
  providerSchemaPath: string
): string | undefined => {
  if (symbol === symbols.d1Namespace) {
    return d1NamespaceViolation(node, checker, d1Members, sourcePath);
  }
  if (symbol === symbols.database) {
    return databaseViolation(node, file, sourcePath);
  }
  if (symbol === symbols.queryDatabase) {
    return queryDatabaseViolation(node, file, sourcePath);
  }
  if (symbol === symbols.queryDatabaseBinding) {
    return queryDatabaseBindingViolation(node, file, sourcePath);
  }
  if (symbol === symbols.drizzle) {
    return drizzleViolation(node, sourcePath);
  }
  return sourcePath === providerSchemaPath && symbol === symbols.sqliteTable
    ? sqliteTableViolation(node, sourcePath)
    : undefined;
};

const collectSemanticD1Violations = (
  architecture: TrackedGlobalD1Architecture
): readonly string[] => {
  const checker = architecture.program.getTypeChecker();
  const symbols = sensitiveD1Symbols(architecture.program, checker);
  const d1Members = new Set([
    symbols.database,
    symbols.queryDatabase,
    symbols.queryDatabaseBinding,
  ]);
  const providerSchemaPath =
    "apps/api/src/features/provider-accounting/provider-accounting.database-schema.ts";
  const violations: string[] = [];

  for (const trackedSource of architecture.sources) {
    if (trackedSource.sourceFile === undefined) {
      continue;
    }
    const file = trackedSource.sourceFile;
    const visit = (node: ts.Node): void => {
      const dynamicViolation = dynamicImportViolation(
        node,
        checker,
        trackedSource.path
      );
      if (dynamicViolation !== undefined) {
        violations.push(dynamicViolation);
      }

      if (sensitiveExpression(node)) {
        const symbol = expressionSymbol(checker, node);
        const expressionViolation = semanticExpressionViolation(
          node,
          symbol,
          checker,
          symbols,
          d1Members,
          file,
          trackedSource.path,
          providerSchemaPath
        );
        if (expressionViolation !== undefined) {
          violations.push(expressionViolation);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
  }

  return violations;
};

const stringProperty = (
  objectLiteral: ts.ObjectLiteralExpression | undefined,
  propertyName: string
): string | undefined => {
  const property = objectLiteral?.properties.find(
    (candidate): candidate is ts.PropertyAssignment =>
      ts.isPropertyAssignment(candidate) &&
      (ts.isIdentifier(candidate.name) ||
        ts.isStringLiteralLike(candidate.name)) &&
      candidate.name.text === propertyName
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
          const migrationsProperty =
            configuration !== undefined &&
            ts.isObjectLiteralExpression(configuration)
              ? configuration.properties.find(
                  (property): property is ts.PropertyAssignment =>
                    ts.isPropertyAssignment(property) &&
                    (ts.isIdentifier(property.name) ||
                      ts.isStringLiteralLike(property.name)) &&
                    property.name.text === "migrations"
                )
              : undefined;
          const migrations =
            migrationsProperty &&
            ts.isObjectLiteralExpression(migrationsProperty.initializer)
              ? migrationsProperty.initializer
              : undefined;
          declarations.push({
            exportName: node.name.text,
            logicalId:
              logicalId !== undefined && ts.isStringLiteralLike(logicalId)
                ? logicalId.text
                : "<non-literal>",
            migrationsDir: stringProperty(migrations, "dir") ?? "<missing>",
            migrationsTable: stringProperty(migrations, "table") ?? "<missing>",
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

const collectUnsupportedD1ConsumerImports = (
  trackedSources: readonly TrackedArchitectureSource[]
): readonly string[] =>
  trackedSources.flatMap((trackedSource) => {
    const violations: string[] = [];
    const file = sourceFile(trackedSource);

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
        }
      }
    }
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
  architecture: TrackedGlobalD1Architecture
): readonly string[] => {
  const { sources: trackedSources } = architecture;
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
  const providerSchema = trackedSources.find(
    ({ path: sourcePath }) => sourcePath === providerSchemaPath
  );
  const providerMigrations = trackedSources.filter(
    ({ path: sourcePath }) =>
      sourcePath.startsWith("apps/api/provider-accounting-migrations/") &&
      sourcePath.endsWith(".sql")
  );

  const violations = [
    ...collectSemanticD1Violations(architecture),
    ...collectUnsupportedD1ConsumerImports(trackedSources),
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
      "provider-accounting migration tables",
      [
        ...new Set(
          providerMigrations.flatMap(({ source }) =>
            collectCreatedTables(source)
          )
        ),
      ].toSorted(),
      expectedProviderAccountingTables
        .map(({ tableName }) => tableName)
        .toSorted()
    )
  );

  const providerSnapshots = trackedSources.filter(
    ({ path: sourcePath }) =>
      sourcePath.startsWith("apps/api/provider-accounting-migrations/") &&
      sourcePath.endsWith("/snapshot.json")
  );
  if (providerSnapshots.length === 0) {
    violations.push("provider-accounting snapshots missing");
  }
  for (const providerSnapshot of providerSnapshots) {
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

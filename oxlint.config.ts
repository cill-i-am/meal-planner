import { defineConfig } from "oxlint";
import core from "ultracite/oxlint/core";

export default defineConfig({
  // The current Vitest add-on enforces assertion-count and exact thrown-text
  // policies that conflict with these comprehensive Effect schema tests.
  extends: [core],
  // Project-scoped vendor skills are executable tooling, not application source.
  ignorePatterns: [
    ...core.ignorePatterns,
    ".agents/**",
    "apps/api/auth-migrations/**/snapshot.json",
    "apps/api/src/features/auth/auth.database-schema.ts",
    // Byte-identical upstream plugin sources are verified separately and must
    // not lint themselves; repository-owned plugin glue remains in lint scope.
    "tools/oxlint/anti-slop/no-conditional-empty-object-spread.ts",
    "tools/oxlint/anti-slop/no-runtime-typeof.ts",
  ],
  jsPlugins: [
    {
      name: "anti-slop",
      specifier: "./tools/oxlint/anti-slop/index.ts",
    },
  ],
  overrides: [
    {
      files: [
        "apps/api/src/features/tesco/auth/auth-cookies.ts",
        "apps/api/src/features/tesco/auth/auth-session.test.ts",
        "apps/api/src/features/tesco/auth/auth-session.ts",
        "apps/api/src/features/tesco/auth/soft-login-auth-refresh.test.ts",
        "apps/api/src/features/tesco/auth/soft-login-auth-refresh.ts",
        "apps/api/src/features/tesco/auth/soft-login-discover.ts",
        "apps/api/src/features/tesco/catalogue/catalogue.routes.ts",
        "apps/api/src/features/tesco/catalogue/xapi-catalogue.ts",
      ],
      rules: {
        // Effect.gen uses anonymous generator callbacks; naming them after the
        // surrounding binding immediately conflicts with no-shadow.
        "func-names": "off",
      },
    },
    {
      files: [
        "apps/api/src/app/errors.ts",
        "apps/api/src/features/tesco/tesco.errors.ts",
      ],
      rules: {
        // Error unions are intentionally colocated and use concise readonly
        // constructor properties as their public data contract.
        "max-classes-per-file": "off",
        "typescript/parameter-properties": "off",
        // Optional unknown causes require an explicit undefined default.
        "unicorn/no-useless-undefined": "off",
      },
    },
    {
      files: ["apps/api/src/app/http/query-params.ts"],
      rules: {
        // Effect.succeed requires the explicit undefined value for this branch.
        "unicorn/no-useless-undefined": "off",
      },
    },
    {
      files: ["apps/api/src/app/errors.ts"],
      rules: {
        // TypeScript's noImplicitReturns checks this exhaustive tagged-union switch.
        "default-case": "off",
      },
    },
    {
      files: ["apps/api/src/app/http/responses.ts"],
      rules: {
        // These are Effect combinators; no Promise callbacks or .then calls exist.
        "promise/prefer-await-to-callbacks": "off",
        "promise/prefer-await-to-then": "off",
      },
    },
    {
      files: ["apps/api/src/features/auth/auth.principal.ts"],
      rules: {
        // Effect.mapError is an Effect combinator, not a Promise callback.
        "promise/prefer-await-to-callbacks": "off",
      },
    },
    {
      files: ["apps/api/src/features/tesco/catalogue/graphql-documents.ts"],
      rules: {
        // The inline marker enables GraphQL editor tooling for template literals.
        "no-inline-comments": "off",
      },
    },
    {
      files: [
        "apps/api/src/features/tesco/auth/soft-login-auth-refresh.test.ts",
      ],
      rules: {
        // Node's callback-only Server APIs require Promise adapters in this fixture.
        "promise/avoid-new": "off",
        "promise/prefer-await-to-callbacks": "off",
      },
    },
    {
      files: ["apps/web/**/*.test.ts", "apps/web/**/*.test.tsx"],
      rules: {
        // Async operation stubs intentionally satisfy the browser/server boundary.
        "promise/avoid-new": "off",
        "require-await": "off",
      },
    },
    {
      files: ["apps/web/scripts/poc-fake-api.ts"],
      rules: {
        // The small Node HTTP fixture dispatches five production-shaped routes.
        complexity: "off",
        "prefer-named-capture-group": "off",
        // Node's listen and close APIs require callback-to-Promise adapters.
        "promise/avoid-new": "off",
        "promise/prefer-await-to-callbacks": "off",
      },
    },
    {
      files: ["apps/web/src/features/recipe-import/recipe-import-page.tsx"],
      rules: {
        // JSX conditionals directly render the bounded workflow states.
        complexity: "off",
      },
    },
  ],
  rules: {
    "anti-slop/no-conditional-empty-object-spread": "error",
    "anti-slop/no-runtime-typeof": "error",
    "anti-slop/no-unknown-parameters": "error",
  },
});

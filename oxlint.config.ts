import { defineConfig } from "oxlint";
import core from "ultracite/oxlint/core";

export default defineConfig({
  // The current Vitest add-on enforces assertion-count and exact thrown-text
  // policies that conflict with these comprehensive Effect schema tests.
  extends: [core],
  ignorePatterns: core.ignorePatterns,
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
  ],
});

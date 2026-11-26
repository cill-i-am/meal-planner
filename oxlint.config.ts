import { defineConfig } from "oxlint";
import core from "ultracite/oxlint/core";
import landmines from "ultracite/oxlint/landmines";
import shadcn from "ultracite/oxlint/shadcn";

export default defineConfig({
  extends: [core, shadcn, landmines],

  ignorePatterns: [
    ...core.ignorePatterns,
    ".agents/**",
    "apps/api/auth-migrations/**/snapshot.json",
    "apps/api/src/features/auth/auth.database-schema.ts",

    "apps/api/household-migrations/migrations.d.ts",
    // WARNING: Migration regression tests require this historical repository snapshot byte for byte.
    "apps/api/src/features/provider-accounting/provider-accounting.repository.previous.fixture.ts",

    "tools/oxlint/anti-slop/no-conditional-empty-object-spread.ts",
    "tools/oxlint/anti-slop/no-runtime-typeof.ts",
  ],
  jsPlugins: [
    ...shadcn.jsPlugins,
    ...landmines.jsPlugins,
    {
      name: "anti-slop",
      specifier: "./tools/oxlint/anti-slop/index.ts",
    },
  ],
  overrides: [
    {
      files: ["**/*.{ts,tsx,mts,cts}"],
      rules: {
        "no-redeclare": "off",

        "unicorn/consistent-function-scoping": "off",
      },
    },
    {
      files: [
        "apps/api/src/features/households/household-object-host.fixture.ts",
        "apps/api/src/features/imports/household-import-batch-workflow.fixture.ts",
      ],
      rules: {
        "max-classes-per-file": "off",
      },
    },
    {
      files: ["apps/tesco/src/catalogue/xapi-catalogue.ts"],
      rules: {
        "func-names": "off",
      },
    },
    {
      files: ["apps/api/src/app/http/query-params.ts"],
      rules: {
        "unicorn/no-useless-undefined": "off",
      },
    },
    {
      files: ["apps/api/src/app/http/responses.ts"],
      rules: {
        "promise/prefer-await-to-callbacks": "off",
        "promise/prefer-await-to-then": "off",
      },
    },
    {
      files: ["apps/api/src/features/auth/auth.principal.ts"],
      rules: {
        "promise/prefer-await-to-callbacks": "off",
      },
    },
  ],
  rules: {
    "anti-slop/no-conditional-empty-object-spread": "error",
    "anti-slop/no-runtime-typeof": "error",
    "anti-slop/no-unknown-parameters": "error",
    // WARNING: These opt-in real-runtime suites exercise Docker provisioning, native expiry, and a measured provider budget window.
    "landmines-testing/no-flake-masking": [
      "error",
      {
        allow: {
          "apps/api/vitest.container.config.ts": 2,
          "scripts/sigen-worker-runtime.test.ts": 1,
        },
      },
    ],
    complexity: ["error", { max: 20 }],
  },
});

import { defineConfig } from "oxfmt";
import ultracite from "ultracite/oxfmt";

export default defineConfig({
  ...ultracite,
  // Meal-plan documents are user-authored data, not source files.
  ignorePatterns: [
    ...ultracite.ignorePatterns,
    ".agents/**",
    "apps/api/auth-migrations/**/snapshot.json",
    "apps/api/src/features/auth/auth.database-schema.ts",
    "docs/**",
    // Preserve the byte-identical upstream plugin source; repository-owned
    // plugin glue remains in the formatting scope.
    "tools/oxlint/anti-slop/no-runtime-typeof.ts",
  ],
  sortTailwindcss: {
    functions: ["clsx", "cn", "cva", "tw"],
  },
});

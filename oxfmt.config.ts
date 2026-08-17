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
  ],
  sortTailwindcss: {
    functions: ["clsx", "cn", "cva", "tw"],
  },
});

import { defineConfig } from "oxfmt";
import ultracite from "ultracite/oxfmt";

export default defineConfig({
  ...ultracite,

  ignorePatterns: [
    ...ultracite.ignorePatterns,
    ".agents/**",
    "apps/api/auth-migrations/**/snapshot.json",
    "apps/api/src/features/auth/auth.database-schema.ts",
    "docs/**",

    "tools/oxlint/anti-slop/no-runtime-typeof.ts",
  ],
  sortTailwindcss: {
    functions: ["clsx", "cn", "cva", "tw"],
  },
});

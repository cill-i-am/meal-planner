import { defineConfig } from "oxfmt";
import ultracite from "ultracite/oxfmt";

export default defineConfig({
  ...ultracite,
  // Meal-plan documents are user-authored data, not source files.
  ignorePatterns: [...ultracite.ignorePatterns, ".agents/**", "docs/**"],
  sortTailwindcss: {
    functions: ["clsx", "cn", "cva", "tw"],
  },
});

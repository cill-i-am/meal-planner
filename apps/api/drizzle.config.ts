import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  out: "./migrations/meta",
  schema: "./src/features/imports/import.database-schema.ts",
});

import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  out: "./provider-accounting-migrations",
  schema:
    "./src/features/provider-accounting/provider-accounting.database-schema.ts",
});

import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  driver: "durable-sqlite",
  out: "household-migrations",
  schema: "./src/features/households/household.database-schema.ts",
});

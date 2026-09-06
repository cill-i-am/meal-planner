import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  driver: "durable-sqlite",
  out: "private-output-migrations",
  schema: "./src/features/private-output/private-output.database-schema.ts",
});

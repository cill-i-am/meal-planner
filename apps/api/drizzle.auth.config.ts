import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  out: "./auth-migrations",
  schema: "./src/features/auth/auth.database-schema.ts",
});

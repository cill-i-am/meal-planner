import { DatabaseSync } from "node:sqlite";

import { drizzle } from "drizzle-orm/node-sqlite";

import { makeMealPlannerAuth } from "./src/features/auth/auth.js";

const database = drizzle(new DatabaseSync(":memory:"));

/** Better Auth CLI entrypoint. Drizzle Kit remains the sole migration owner. */
export const auth = makeMealPlannerAuth({
  baseURL: "http://localhost:8787",
  database,
  secret: "schema-generation-only-secret-at-least-32-characters",
});

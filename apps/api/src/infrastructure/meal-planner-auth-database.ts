import * as Cloudflare from "alchemy/Cloudflare";

/** Better Auth identity and organization storage, isolated from domain data. */
export const MealPlannerAuthDatabase = Cloudflare.D1.Database(
  "MealPlannerAuthDatabase",
  {
    migrationsDir: "./apps/api/auth-migrations",
    migrationsTable: "d1_migrations",
  }
);

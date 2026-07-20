import * as Cloudflare from "alchemy/Cloudflare";

/** Durable import storage. The logical ID and migration path are stable. */
export const MealPlannerDatabase = Cloudflare.D1.Database(
  "MealPlannerDatabase",
  {
    migrationsDir: "./apps/api/migrations",
    migrationsTable: "d1_migrations",
  }
);

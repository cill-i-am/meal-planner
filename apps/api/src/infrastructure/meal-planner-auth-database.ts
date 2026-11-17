import * as Cloudflare from "@alchemy.run/cloudflare";

/** Better Auth identity and organization storage, isolated from domain data. */
export const MealPlannerAuthDatabase = Cloudflare.D1.Database(
  "MealPlannerAuthDatabase",
  {
    migrations: { dir: "./apps/api/auth-migrations", table: "d1_migrations" },
  }
);

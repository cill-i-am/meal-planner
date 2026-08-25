import * as Cloudflare from "alchemy/Cloudflare";

/** Global operational D1 for cross-household provider cost accounting only. */
export const ProviderAccountingDatabase = Cloudflare.D1.Database(
  "ProviderAccountingDatabase",
  {
    migrationsDir: "./apps/api/provider-accounting-migrations",
    migrationsTable: "d1_migrations",
  }
);

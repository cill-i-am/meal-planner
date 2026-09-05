import * as Cloudflare from "alchemy/Cloudflare";

/** Global operational D1 for cross-household provider cost accounting only. */
export const ProviderAccountingDatabase = Cloudflare.D1.Database(
  "ProviderAccountingDatabase",
  {
    migrations: {
      dir: "./apps/api/provider-accounting-migrations",
      table: "d1_migrations",
    },
  }
);

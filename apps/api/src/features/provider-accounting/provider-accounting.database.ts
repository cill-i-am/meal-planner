import { instrumentDrizzle } from "cloudflare-drizzle-tracing";
import { drizzle } from "drizzle-orm/d1";
import type { AnyD1Database } from "drizzle-orm/d1";

export const makeProviderAccountingDatabase = (binding: AnyD1Database) =>
  instrumentDrizzle(drizzle(binding), {
    attributes: { "db.namespace": "provider-accounting" },
  });
export type ProviderAccountingDatabase = ReturnType<
  typeof makeProviderAccountingDatabase
>;

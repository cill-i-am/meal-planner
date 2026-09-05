import { drizzle } from "drizzle-orm/d1";
import type { AnyD1Database } from "drizzle-orm/d1";

export const makeProviderAccountingDatabase = (binding: AnyD1Database) =>
  drizzle(binding);
export type ProviderAccountingDatabase = ReturnType<
  typeof makeProviderAccountingDatabase
>;

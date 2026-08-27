import type { AnyD1Database, DrizzleD1Database } from "drizzle-orm/d1";
import { drizzle } from "drizzle-orm/d1";

/** Typed application database for the global provider-accounting authority. */
export type ProviderAccountingDatabase = DrizzleD1Database;

/** Admit the raw Cloudflare binding once, at composition, then use Drizzle. */
export const makeProviderAccountingDatabase = (
  binding: AnyD1Database
): ProviderAccountingDatabase => drizzle(binding);

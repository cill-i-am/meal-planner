import type { SqlMigrationSnapshot } from "alchemy/Cloudflare/Workers";

// The native fixture bundler captures these through Alchemy's SQL directory reader.
declare const __MEAL_PLANNER_TEST_SQL_MIGRATIONS__: Readonly<
  Record<string, SqlMigrationSnapshot>
>;
export const householdSqlMigrations = __MEAL_PLANNER_TEST_SQL_MIGRATIONS__;

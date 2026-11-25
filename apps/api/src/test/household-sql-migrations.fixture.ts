import type { SqlMigrationSnapshot } from "@alchemy.run/cloudflare/Workers";

declare const __MEAL_PLANNER_TEST_SQL_MIGRATIONS__: Readonly<
  Record<string, SqlMigrationSnapshot>
>;
export const householdSqlMigrations = __MEAL_PLANNER_TEST_SQL_MIGRATIONS__;

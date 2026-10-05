import { sql } from "drizzle-orm";
import { check, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/** One append-only authoritative version per accepted content, routine, or stock change. */
export const householdPlanningContentVersions = sqliteTable(
  "household_planning_content_versions",
  {
    actorId: text("actor_id").notNull(),
    intentDigest: text("intent_digest").notNull(),
    mutationId: text("mutation_id").notNull().unique(),
    snapshotJson: text("snapshot_json").notNull(),
    version: integer("version").primaryKey(),
  },
  (table) => [
    check("planning_content_version_positive", sql`${table.version} >= 1`),
  ]
);

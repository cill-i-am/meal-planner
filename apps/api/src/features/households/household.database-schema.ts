import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const householdMeta = sqliteTable("household_meta", {
  createdAtEpochMs: integer("created_at_epoch_ms").notNull(),
  organizationId: text("organization_id").notNull().unique(),
  singletonKey: text("singleton_key").primaryKey(),
});

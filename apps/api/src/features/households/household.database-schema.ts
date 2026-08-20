import {
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

export const householdMeta = sqliteTable("household_meta", {
  createdAtEpochMs: integer("created_at_epoch_ms").notNull(),
  organizationId: text("organization_id").notNull().unique(),
  singletonKey: text("singleton_key").primaryKey(),
});

export const householdMealPlans = sqliteTable("household_meal_plans", {
  draftId: text("draft_id").primaryKey(),
  planJson: text("plan_json").notNull(),
  requestFingerprintDigest: text("request_fingerprint_digest").notNull(),
  revision: integer("revision").notNull(),
});

export const householdMealPlanMutationReceipts = sqliteTable(
  "household_meal_plan_mutation_receipts",
  {
    draftId: text("draft_id").notNull(),
    mutationFingerprint: text("mutation_fingerprint").notNull(),
    mutationId: text("mutation_id").notNull(),
    resultJson: text("result_json").notNull(),
  },
  (table) => [primaryKey({ columns: [table.draftId, table.mutationId] })]
);

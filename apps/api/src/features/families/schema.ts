import {
  integer,
  sqliteTable,
  text,
  uniqueIndex,
  primaryKey,
} from "drizzle-orm/sqlite-core";

import { organization } from "../auth/schema.js";

/** Family lifecycle and creation receipt; names remain owned by organization. */
export const familyRecord = sqliteTable(
  "family",
  {
    completedAt: integer("completed_at", { mode: "timestamp_ms" }),
    creationMutationId: text("creation_mutation_id").notNull(),
    creationName: text("creation_name").notNull(),
    creatorDisplayName: text("creator_display_name").notNull(),
    creatorLinked: integer("creator_linked", { mode: "boolean" })
      .notNull()
      .default(false),
    creatorUserId: text("creator_user_id").notNull(),
    organizationId: text("organization_id")
      .primaryKey()
      .references(() => organization.id, { onDelete: "cascade" }),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
    version: integer("version").notNull().default(1),
  },
  (t) => [
    uniqueIndex("family_creation_request_uidx").on(
      t.creatorUserId,
      t.creationMutationId
    ),
  ]
);

/** Receipts outlive subsequent edits so a delayed retry cannot become a new rename. */
export const familyRenameReceipt = sqliteTable(
  "family_rename_receipt",
  {
    actorId: text("actor_id").notNull(),
    expectedVersion: integer("expected_version").notNull(),
    mutationId: text("mutation_id").notNull(),
    name: text("name").notNull(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.actorId, t.mutationId] })]
);

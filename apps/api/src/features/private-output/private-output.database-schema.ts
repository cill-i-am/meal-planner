import {
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

/** Output lifecycle metadata only; canonical membership and people stay elsewhere. */
export const outputMutations = sqliteTable("output_mutations", {
  intentKey: text("intent_key").notNull(),
  operationId: text("operation_id").primaryKey(),
  phase: text("phase", {
    enum: ["fencing", "ready", "dispatched", "settled"],
  }).notNull(),
});

export const outputRegistrations = sqliteTable(
  "output_registrations",
  {
    childName: text("child_name").notNull(),
    generation: text("generation").notNull(),
  },
  (table) => [primaryKey({ columns: [table.childName, table.generation] })]
);

export const privateSessionBinding = sqliteTable("private_session_binding", {
  accountKey: text("account_key").notNull(),
  householdKey: text("household_key").notNull(),
  linkageSubject: text("linkage_subject").notNull(),
  personId: text("person_id").notNull(),
  sessionReference: text("session_reference").primaryKey(),
  status: text("status", { enum: ["open", "completed"] }).notNull(),
});

export const privateOutputGeneration = sqliteTable(
  "private_output_generation",
  {
    expiresAt: integer("expires_at").notNull(),
    generation: text("generation").notNull(),
    singleton: integer("singleton").primaryKey(),
    status: text("status", {
      enum: ["pending", "authorized", "connected", "invalidated"],
    }).notNull(),
  }
);

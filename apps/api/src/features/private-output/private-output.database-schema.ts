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
    targetKind: text("target_kind", {
      enum: ["session", "directory"],
    }).notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.targetKind, table.childName, table.generation],
    }),
  ]
);

export const privateSessionBinding = sqliteTable("private_session_binding", {
  accountKey: text("account_key").notNull(),
  householdKey: text("household_key").notNull(),
  linkageSubject: text("linkage_subject").notNull(),
  personId: text("person_id").notNull(),
  sessionReference: text("session_reference").primaryKey(),
  status: text("status", { enum: ["open", "completed"] }).notNull(),
  version: integer("version").notNull().default(0),
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

export const privateDirectoryBinding = sqliteTable(
  "private_directory_binding",
  {
    accountKey: text("account_key").notNull(),
    bindingKey: text("binding_key").notNull(),
    householdKey: text("household_key").notNull(),
    linkageSubject: text("linkage_subject").notNull(),
    personId: text("person_id").notNull(),
    singleton: integer("singleton").primaryKey(),
  }
);
export const privateReservations = sqliteTable("private_reservations", {
  createdAt: integer("created_at").notNull(),
  ordinal: integer("ordinal").primaryKey({ autoIncrement: true }),
  sessionReference: text("session_reference").notNull().unique(),
});
export const privateMessages = sqliteTable("private_messages", {
  createdAt: integer("created_at").notNull(),
  id: text("id").notNull().unique(),
  ordinal: integer("ordinal").primaryKey({ autoIncrement: true }),
  role: text("role", { enum: ["participant", "assistant"] }).notNull(),
  text: text("text").notNull(),
});
export const privateReceipts = sqliteTable("private_receipts", {
  frame: text("frame").notNull(),
  intent: text("intent").notNull(),
  mutationId: text("mutation_id").primaryKey(),
});

/** Tentative/reviewed values and pending commands are private child state only. */
export const privateProfileCards = sqliteTable("private_profile_cards", {
  cardJson: text("card_json").notNull(),
  id: text("id").notNull().unique(),
  ordinal: integer("ordinal").primaryKey({ autoIncrement: true }),
});
export const privatePendingConfirmation = sqliteTable(
  "private_pending_confirmation",
  {
    cardId: text("card_id").notNull(),
    mutationId: text("mutation_id").notNull().unique(),
    payloadJson: text("payload_json").notNull(),
    singleton: integer("singleton").primaryKey(),
  }
);

/** Every attempt remains private and durable, including cancelled or unknown provider outcomes. */
export const privateAssistantTurns = sqliteTable("private_assistant_turns", {
  completedAt: integer("completed_at"),
  createdAt: integer("created_at").notNull(),
  expectedSessionVersion: integer("expected_session_version").notNull(),
  failure: text("failure", {
    enum: [
      "not_configured",
      "provider_unavailable",
      "invalid_output",
      "refused",
      "context_limit",
      "outcome_unknown",
      "connection_lost",
      "runtime_restarted",
    ],
  }),
  generation: text("generation").notNull(),
  id: text("id").notNull().unique(),
  ordinal: integer("ordinal").primaryKey({ autoIncrement: true }),
  provenanceJson: text("provenance_json"),
  sourceMessageId: text("source_message_id").notNull(),
  status: text("status", {
    enum: [
      "queued",
      "running",
      "succeeded",
      "failed",
      "interrupted",
      "cancelled",
    ],
  }).notNull(),
  summary: text("summary"),
  usageJson: text("usage_json"),
});

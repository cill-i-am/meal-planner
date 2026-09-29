import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const conversationBinding = sqliteTable("agent_conversation_binding", {
  conversationId: text("conversation_id").notNull().unique(),
  familyId: text("family_id"),
  id: text("id").primaryKey(),
  scopeKey: text("scope_key").notNull(),
  scopeTag: text("scope_tag", {
    enum: ["AccountPrivateSetup", "FamilyShared"],
  }).notNull(),
  version: integer("version").notNull().default(0),
});

export const conversationMessages = sqliteTable(
  "agent_conversation_messages",
  {
    id: text("id").notNull().unique(),
    ordinal: integer("ordinal").primaryKey({ autoIncrement: true }),
    role: text("role", { enum: ["adult", "assistant"] }).notNull(),
    text: text("text").notNull(),
    turnId: text("turn_id"),
  },
  (table) => [index("agent_conversation_messages_turn").on(table.turnId)]
);

export const conversationTurns = sqliteTable("agent_conversation_turns", {
  failure: text("failure"),
  finishedAt: integer("finished_at"),
  id: text("id").primaryKey(),
  replyJson: text("reply_json"),
  requestJson: text("request_json").notNull(),
  startedAt: integer("started_at").notNull(),
  status: text("status", {
    enum: ["running", "succeeded", "failed", "interrupted"],
  }).notNull(),
});

export const conversationBlocks = sqliteTable(
  "agent_conversation_blocks",
  {
    blockJson: text("block_json").notNull(),
    id: text("id").primaryKey(),
    revision: integer("revision").notNull(),
    status: text("status", {
      enum: ["proposed", "pending", "accepted", "answered", "dismissed"],
    }).notNull(),
    tag: text("tag").notNull(),
    turnId: text("turn_id").notNull(),
  },
  (table) => [index("agent_conversation_blocks_turn").on(table.turnId)]
);

export const conversationActions = sqliteTable("agent_conversation_actions", {
  blockId: text("block_id").notNull(),
  commandIdsJson: text("command_ids_json").notNull(),
  decisionJson: text("decision_json").notNull(),
  familyId: text("family_id"),
  id: text("id").primaryKey(),
  nextStep: integer("next_step").notNull().default(0),
  rejectionReason: text("rejection_reason", {
    enum: ["stale_review", "not_actionable", "permission_denied"],
  }),
  status: text("status", {
    enum: ["pending", "unknown", "committed", "rejected"],
  }).notNull(),
});

CREATE TABLE `agent_conversation_binding` (
  `id` text PRIMARY KEY NOT NULL,
  `conversation_id` text NOT NULL,
  `scope_tag` text NOT NULL,
  `scope_key` text NOT NULL,
  `family_id` text,
  `version` integer DEFAULT 0 NOT NULL
);
CREATE UNIQUE INDEX `agent_conversation_binding_conversation_id_unique` ON `agent_conversation_binding` (`conversation_id`);
CREATE TABLE `agent_conversation_messages` (
  `ordinal` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `id` text NOT NULL,
  `role` text NOT NULL,
  `text` text NOT NULL,
  `turn_id` text
);
CREATE UNIQUE INDEX `agent_conversation_messages_id_unique` ON `agent_conversation_messages` (`id`);
CREATE INDEX `agent_conversation_messages_turn` ON `agent_conversation_messages` (`turn_id`);
CREATE TABLE `agent_conversation_turns` (
  `id` text PRIMARY KEY NOT NULL,
  `request_json` text NOT NULL,
  `status` text NOT NULL,
  `failure` text,
  `reply_json` text,
  `started_at` integer NOT NULL,
  `finished_at` integer
);
CREATE TABLE `agent_conversation_blocks` (
  `id` text PRIMARY KEY NOT NULL,
  `turn_id` text NOT NULL,
  `revision` integer NOT NULL,
  `tag` text NOT NULL,
  `block_json` text NOT NULL,
  `status` text NOT NULL
);
CREATE INDEX `agent_conversation_blocks_turn` ON `agent_conversation_blocks` (`turn_id`);
CREATE TABLE `agent_conversation_actions` (
  `id` text PRIMARY KEY NOT NULL,
  `block_id` text NOT NULL,
  `command_ids_json` text NOT NULL,
  `decision_json` text NOT NULL,
  `family_id` text,
  `next_step` integer DEFAULT 0 NOT NULL,
  `rejection_reason` text,
  `status` text NOT NULL
);

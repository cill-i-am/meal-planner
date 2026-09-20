CREATE TABLE `private_chat_events` (
	`event_json` text NOT NULL,
	`run_id` text NOT NULL,
	`sequence` integer NOT NULL,
	CONSTRAINT `private_chat_events_pk` PRIMARY KEY(`run_id`, `sequence`)
);
--> statement-breakpoint
CREATE TABLE `private_chat_streams` (
	`closed` integer DEFAULT false NOT NULL,
	`run_id` text PRIMARY KEY,
	`wire_bytes` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE `private_assistant_turns` ADD `cancel_requested` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE TABLE `__new_private_messages` (
  `created_at` integer NOT NULL,
  `id` text NOT NULL UNIQUE,
  `message_json` text NOT NULL,
  `ordinal` integer PRIMARY KEY AUTOINCREMENT
);
--> statement-breakpoint
INSERT INTO `__new_private_messages` (`created_at`, `id`, `message_json`, `ordinal`)
SELECT `created_at`, `id`, json_object(
  'content', `text`,
  'createdAt', `created_at`,
  'id', `id`,
  'role', CASE WHEN `role` = 'participant' THEN 'user' ELSE 'assistant' END
), `ordinal` FROM `private_messages`;
--> statement-breakpoint
DROP TABLE `private_messages`;
--> statement-breakpoint
ALTER TABLE `__new_private_messages` RENAME TO `private_messages`;

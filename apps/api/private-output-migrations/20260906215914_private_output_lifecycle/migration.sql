CREATE TABLE `private_assistant_turns` (
	`completed_at` integer,
	`created_at` integer NOT NULL,
	`expected_session_version` integer NOT NULL,
	`failure` text,
	`generation` text NOT NULL,
	`id` text NOT NULL UNIQUE,
	`ordinal` integer PRIMARY KEY AUTOINCREMENT,
	`provenance_json` text,
	`source_message_id` text NOT NULL,
	`status` text NOT NULL,
	`summary` text,
	`usage_json` text
);

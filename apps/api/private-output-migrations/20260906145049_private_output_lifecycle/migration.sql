CREATE TABLE `private_pending_confirmation` (
	`singleton` integer PRIMARY KEY,
	`mutation_id` text NOT NULL UNIQUE,
	`card_id` text NOT NULL,
	`payload_json` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `private_profile_cards` (
	`ordinal` integer PRIMARY KEY AUTOINCREMENT,
	`id` text NOT NULL UNIQUE,
	`card_json` text NOT NULL
);

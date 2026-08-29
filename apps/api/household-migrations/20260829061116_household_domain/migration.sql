CREATE TABLE `household_people` (
	`created_at_epoch_ms` integer NOT NULL,
	`display_name` text NOT NULL,
	`kind` text NOT NULL,
	`lifecycle` text NOT NULL,
	`person_id` text PRIMARY KEY,
	`updated_at_epoch_ms` integer NOT NULL,
	`version` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `household_person_audits` (
	`actor_id` text NOT NULL,
	`at_epoch_ms` integer NOT NULL,
	`command` text NOT NULL,
	`next_lifecycle` text,
	`next_version` integer NOT NULL,
	`person_id` text NOT NULL,
	`previous_lifecycle` text,
	`sequence` integer PRIMARY KEY AUTOINCREMENT
);
--> statement-breakpoint
CREATE TABLE `household_person_creator_associations` (
	`created_at_epoch_ms` integer NOT NULL,
	`linkage_subject` text NOT NULL UNIQUE,
	`person_id` text NOT NULL UNIQUE,
	`singleton_key` text PRIMARY KEY
);
--> statement-breakpoint
CREATE TABLE `household_person_mutation_receipts` (
	`intent_digest` text NOT NULL,
	`mutation_id` text PRIMARY KEY,
	`result_json` text NOT NULL
);

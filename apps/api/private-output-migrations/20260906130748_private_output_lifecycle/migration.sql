CREATE TABLE `private_directory_binding` (
	`singleton` integer PRIMARY KEY,
	`account_key` text NOT NULL,
	`household_key` text NOT NULL,
	`linkage_subject` text NOT NULL,
	`person_id` text NOT NULL,
	`binding_key` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `private_messages` (
	`ordinal` integer PRIMARY KEY AUTOINCREMENT,
	`id` text NOT NULL UNIQUE,
	`created_at` integer NOT NULL,
	`role` text NOT NULL,
	`text` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `private_receipts` (
	`mutation_id` text PRIMARY KEY,
	`intent` text NOT NULL,
	`frame` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `private_reservations` (
	`ordinal` integer PRIMARY KEY AUTOINCREMENT,
	`session_reference` text NOT NULL UNIQUE,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `private_session_binding` ADD `version` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_output_registrations` (
	`target_kind` text NOT NULL,
	`child_name` text NOT NULL,
	`generation` text NOT NULL,
	CONSTRAINT `output_registrations_pk` PRIMARY KEY(`target_kind`, `child_name`, `generation`)
);
--> statement-breakpoint
INSERT INTO `__new_output_registrations`(`target_kind`, `child_name`, `generation`) SELECT 'session', `child_name`, `generation` FROM `output_registrations`;--> statement-breakpoint
DROP TABLE `output_registrations`;--> statement-breakpoint
ALTER TABLE `__new_output_registrations` RENAME TO `output_registrations`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
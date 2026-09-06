CREATE TABLE `output_mutations` (
	`intent_key` text NOT NULL,
	`operation_id` text PRIMARY KEY,
	`phase` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `output_registrations` (
	`child_name` text NOT NULL,
	`generation` text NOT NULL,
	CONSTRAINT `output_registrations_pk` PRIMARY KEY(`child_name`, `generation`)
);
--> statement-breakpoint
CREATE TABLE `private_output_generation` (
	`expires_at` integer NOT NULL,
	`generation` text NOT NULL,
	`singleton` integer PRIMARY KEY,
	`status` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `private_session_binding` (
	`account_key` text NOT NULL,
	`household_key` text NOT NULL,
	`linkage_subject` text NOT NULL,
	`person_id` text NOT NULL,
	`session_reference` text PRIMARY KEY,
	`status` text NOT NULL
);

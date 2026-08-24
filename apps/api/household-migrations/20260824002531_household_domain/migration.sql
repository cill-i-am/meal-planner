CREATE TABLE `household_import_batch_items` (
	`batch_id` text NOT NULL,
	`failure_code` text,
	`generation` integer NOT NULL,
	`idempotency_key` text NOT NULL,
	`intent_id` text,
	`item_id` text PRIMARY KEY,
	`ordinal` integer NOT NULL,
	`source_json` text NOT NULL,
	`status` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `household_import_batch_outbox` (
	`attempts` integer NOT NULL,
	`batch_id` text NOT NULL,
	`generation` integer NOT NULL,
	`item_id` text PRIMARY KEY,
	`next_attempt_at_epoch_ms` integer NOT NULL,
	`state` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `household_import_batches` (
	`actor_id` text NOT NULL,
	`batch_id` text PRIMARY KEY,
	`created_at` text NOT NULL,
	`idempotency_key_digest` text NOT NULL UNIQUE,
	`organization_id` text NOT NULL,
	`request_digest` text NOT NULL,
	`status` text NOT NULL,
	`updated_at` text NOT NULL,
	`version` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `household_import_batch_item_ordinal_unique` ON `household_import_batch_items` (`batch_id`,`ordinal`);--> statement-breakpoint
CREATE UNIQUE INDEX `household_import_batch_item_key_unique` ON `household_import_batch_items` (`batch_id`,`idempotency_key`);
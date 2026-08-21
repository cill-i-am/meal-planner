CREATE TABLE `household_import_workflow_admissions` (
	`command_digest` text NOT NULL,
	`committed_at_epoch_ms` integer NOT NULL,
	`committed_result_json` text NOT NULL,
	`dispatch_id` text NOT NULL UNIQUE,
	`execution_generation` integer NOT NULL,
	`import_id` text NOT NULL,
	`mutation_id` text PRIMARY KEY,
	`workflow_identity` text NOT NULL UNIQUE
);
--> statement-breakpoint
CREATE TABLE `household_outbox` (
	`attempts` integer NOT NULL,
	`dispatch_id` text PRIMARY KEY,
	`exhausted_at_epoch_ms` integer,
	`next_attempt_at_epoch_ms` integer NOT NULL,
	`payload_json` text NOT NULL,
	`purpose` text NOT NULL,
	`state` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `household_import_workflow_execution_unique` ON `household_import_workflow_admissions` (`import_id`,`execution_generation`);
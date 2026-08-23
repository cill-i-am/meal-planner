CREATE TABLE `import_recipe_recovery_attempts` (
	`created_at` text NOT NULL,
	`current_dispatch_id` text NOT NULL,
	`current_extraction_fingerprint` text NOT NULL,
	`evidence_fingerprint` text NOT NULL,
	`execution_generation` integer NOT NULL,
	`intent_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`predecessor_dispatch_id` text NOT NULL,
	`predecessor_extraction_fingerprint` text NOT NULL,
	`root_dispatch_id` text NOT NULL,
	`root_extraction_fingerprint` text NOT NULL,
	`source_media_sha256` text NOT NULL,
	`terminal_checkpoint_completed_at` text NOT NULL,
	`transcript_sha256` text NOT NULL,
	`visual_manifest_sha256` text NOT NULL,
	CONSTRAINT `import_recipe_recovery_attempts_pk` PRIMARY KEY(`intent_id`, `execution_generation`, `ordinal`)
);
--> statement-breakpoint
CREATE TABLE `import_terminal_checkpoints` (
	`completed_at` text NOT NULL,
	`execution_generation` integer NOT NULL,
	`failure_code` text NOT NULL,
	`input_fingerprint` text NOT NULL,
	`intent_id` text NOT NULL,
	`ownership_id` text NOT NULL,
	`stage` text NOT NULL,
	CONSTRAINT `import_terminal_checkpoints_pk` PRIMARY KEY(`intent_id`, `execution_generation`, `stage`, `ownership_id`)
);
--> statement-breakpoint
ALTER TABLE `household_evidence_references` ADD `observed_event_action` text;--> statement-breakpoint
ALTER TABLE `household_evidence_references` ADD `observed_event_time` text;--> statement-breakpoint
ALTER TABLE `household_evidence_stage_executions` ADD `claim_json` text;--> statement-breakpoint
ALTER TABLE `household_recipe_imports` ADD `source_kind` text;--> statement-breakpoint
CREATE UNIQUE INDEX `import_recipe_recovery_current_dispatch_unique` ON `import_recipe_recovery_attempts` (`intent_id`,`execution_generation`,`current_dispatch_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `import_recipe_recovery_current_extraction_unique` ON `import_recipe_recovery_attempts` (`intent_id`,`execution_generation`,`current_extraction_fingerprint`);
CREATE TABLE `household_evidence_mutation_receipts` (
	`command_digest` text NOT NULL,
	`mutation_id` text PRIMARY KEY,
	`result_json` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `household_evidence_references` (
	`availability` text DEFAULT 'available' NOT NULL,
	`byte_length` integer NOT NULL,
	`delete_at` text NOT NULL,
	`execution_generation` integer NOT NULL,
	`intent_id` text NOT NULL,
	`kind` text NOT NULL,
	`object_key` text NOT NULL,
	`observation_ordinal` integer DEFAULT 0 NOT NULL,
	`observed_at` text,
	`observed_event_action` text,
	`observed_event_time` text,
	`ordinal` integer NOT NULL,
	`sha256` text NOT NULL,
	CONSTRAINT `household_evidence_references_pk` PRIMARY KEY(`intent_id`, `execution_generation`, `ordinal`)
);
--> statement-breakpoint
CREATE TABLE `household_evidence_stage_executions` (
	`acquisition_attempt_generation` integer NOT NULL,
	`claim_json` text,
	`committed_at` text NOT NULL,
	`completed_at` text,
	`dispatch_id` text NOT NULL,
	`execution_generation` integer NOT NULL,
	`failure_code` text,
	`input_fingerprint` text NOT NULL,
	`intent_id` text NOT NULL,
	`result_json` text,
	`stage` text NOT NULL,
	`started_at` text NOT NULL,
	`state` text NOT NULL,
	CONSTRAINT `household_evidence_stage_executions_pk` PRIMARY KEY(`intent_id`, `execution_generation`, `stage`)
);
--> statement-breakpoint
CREATE TABLE `household_import_evidence_executions` (
	`acquisition_attempt_generation` integer NOT NULL,
	`acquisition_json` text NOT NULL,
	`command_digest` text NOT NULL,
	`committed_at` text NOT NULL,
	`execution_generation` integer NOT NULL,
	`intent_id` text NOT NULL,
	`result_json` text NOT NULL,
	`status` text NOT NULL,
	CONSTRAINT `household_import_evidence_executions_pk` PRIMARY KEY(`intent_id`, `execution_generation`)
);
--> statement-breakpoint
CREATE TABLE `import_recipe_recovery_attempts` (
	`acquisition_attempt_generation` integer NOT NULL,
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
ALTER TABLE `household_import_workflow_admissions` ADD `original_trace_json` text;--> statement-breakpoint
ALTER TABLE `household_recipe_imports` ADD `source_kind` text;--> statement-breakpoint
CREATE UNIQUE INDEX `household_evidence_reference_kind_unique` ON `household_evidence_references` (`intent_id`,`execution_generation`,`kind`);--> statement-breakpoint
CREATE UNIQUE INDEX `import_recipe_recovery_current_dispatch_unique` ON `import_recipe_recovery_attempts` (`intent_id`,`execution_generation`,`current_dispatch_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `import_recipe_recovery_current_extraction_unique` ON `import_recipe_recovery_attempts` (`intent_id`,`execution_generation`,`current_extraction_fingerprint`);
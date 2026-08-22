CREATE TABLE `household_evidence_mutation_receipts` (
	`command_digest` text NOT NULL,
	`mutation_id` text PRIMARY KEY,
	`result_json` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `household_evidence_references` (
	`byte_length` integer NOT NULL,
	`delete_at` text NOT NULL,
	`execution_generation` integer NOT NULL,
	`intent_id` text NOT NULL,
	`kind` text NOT NULL,
	`object_key` text NOT NULL,
	`ordinal` integer NOT NULL,
	`sha256` text NOT NULL,
	CONSTRAINT `household_evidence_references_pk` PRIMARY KEY(`intent_id`, `execution_generation`, `ordinal`)
);
--> statement-breakpoint
CREATE TABLE `household_import_evidence_executions` (
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
CREATE UNIQUE INDEX `household_evidence_reference_kind_unique` ON `household_evidence_references` (`intent_id`,`execution_generation`,`kind`);
CREATE TABLE `household_evidence_stage_executions` (
	`committed_at` text NOT NULL,
	`dispatch_id` text NOT NULL,
	`execution_generation` integer NOT NULL,
	`failure_code` text,
	`input_fingerprint` text NOT NULL,
	`intent_id` text NOT NULL,
	`result_json` text,
	`stage` text NOT NULL,
	`state` text NOT NULL,
	CONSTRAINT `household_evidence_stage_executions_pk` PRIMARY KEY(`intent_id`, `execution_generation`, `stage`)
);

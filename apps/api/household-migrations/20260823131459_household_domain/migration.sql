ALTER TABLE `household_evidence_stage_executions` ADD `started_at` text NOT NULL;--> statement-breakpoint
ALTER TABLE `household_import_evidence_executions` ADD `acquisition_attempt_generation` integer NOT NULL;--> statement-breakpoint
ALTER TABLE `household_import_workflow_admissions` ADD `original_trace_json` text;
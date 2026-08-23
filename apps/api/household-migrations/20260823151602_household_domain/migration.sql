ALTER TABLE `household_evidence_stage_executions` ADD `completed_at` text;--> statement-breakpoint
ALTER TABLE `import_recipe_recovery_attempts` ADD `acquisition_attempt_generation` integer NOT NULL;
CREATE TABLE `pilot_provider_terminal_checkpoints` (
	`acquisition_generation` integer NOT NULL,
	`completed_at` text NOT NULL,
	`created_at` text NOT NULL,
	`failure_code` text NOT NULL,
	`import_id` text NOT NULL,
	`ownership_id` text NOT NULL,
	`provider_stage` text NOT NULL,
	CONSTRAINT `pilot_provider_terminal_checkpoints_pk` PRIMARY KEY(`import_id`, `acquisition_generation`, `provider_stage`, `ownership_id`),
	CONSTRAINT `pilot_provider_terminal_checkpoints_import_generation_fk` FOREIGN KEY (`import_id`,`acquisition_generation`) REFERENCES `import_execution_runs`(`id`,`acquisition_generation`) ON UPDATE RESTRICT ON DELETE RESTRICT,
	CONSTRAINT "pilot_provider_terminal_checkpoints_generation_check" CHECK(typeof("acquisition_generation") = 'integer' AND "acquisition_generation" >= 0 AND "acquisition_generation" <= 9007199254740991),
	CONSTRAINT "pilot_provider_terminal_checkpoints_ownership_check" CHECK(length("ownership_id") BETWEEN 1 AND 128),
	CONSTRAINT "pilot_provider_terminal_checkpoints_failure_check" CHECK(length("failure_code") BETWEEN 1 AND 64)
);
--> statement-breakpoint
CREATE INDEX `pilot_provider_terminal_checkpoints_import_idx` ON `pilot_provider_terminal_checkpoints` (`import_id`,`acquisition_generation`,`provider_stage`,`completed_at`);
--> statement-breakpoint
CREATE TRIGGER `pilot_provider_terminal_checkpoints_immutable_update`
BEFORE UPDATE ON `pilot_provider_terminal_checkpoints`
BEGIN
	SELECT RAISE(ABORT, 'pilot provider terminal checkpoint is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `pilot_provider_terminal_checkpoints_immutable_delete`
BEFORE DELETE ON `pilot_provider_terminal_checkpoints`
BEGIN
	SELECT RAISE(ABORT, 'pilot provider terminal checkpoint is immutable');
END;

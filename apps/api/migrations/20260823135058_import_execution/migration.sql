PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_import_execution_runs` (
	`acquisition_generation` integer DEFAULT 0 NOT NULL,
	`canonical_source_id` text NOT NULL,
	`correlation_id` text NOT NULL,
	`created_at` text NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`recovery_action` text,
	`source_kind` text NOT NULL,
	`source_type` text NOT NULL,
	`status` text NOT NULL,
	`status_code` text,
	`updated_at` text NOT NULL,
	CONSTRAINT "import_execution_runs_acquisition_generation_check" CHECK(typeof("acquisition_generation") = 'integer' AND "acquisition_generation" >= 0 AND "acquisition_generation" <= 9007199254740991),
	CONSTRAINT "import_execution_runs_status_details_check" CHECK((
        "status" = 'queued'
        AND "status_code" IS NULL
        AND "recovery_action" IS NULL
      ) OR (
        "status" = 'acquiring'
        AND "status_code" IS NULL
        AND "recovery_action" IS NULL
      ) OR (
        "status" = 'failed'
        AND "status_code" = 'private_or_unavailable'
        AND "recovery_action" = 'check_source_visibility'
      ) OR (
        "status" = 'failed'
        AND "status_code" = 'acquisition_temporarily_unavailable'
        AND "recovery_action" = 'retry_later'
      ) OR (
        "status" = 'failed'
        AND "status_code" = 'invalid_or_unsupported_media'
        AND "recovery_action" = 'submit_supported_public_video'
      ) OR (
        "status" = 'unsupported'
        AND "status_code" = 'unsupported_post_type'
        AND "recovery_action" = 'submit_supported_public_video'
      ))
);
--> statement-breakpoint
DROP TABLE `import_execution_runs`;--> statement-breakpoint
ALTER TABLE `__new_import_execution_runs` RENAME TO `import_execution_runs`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `import_execution_runs_id_generation_unique` ON `import_execution_runs` (`id`,`acquisition_generation`);

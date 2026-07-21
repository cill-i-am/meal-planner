PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_recipe_imports` (
	`acquisition_generation` integer DEFAULT 0 NOT NULL,
	`canonical_source_id` text NOT NULL,
	`compatibility_fingerprint` text NOT NULL,
	`created_at` text NOT NULL,
	`evidence_references_json` text NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`recovery_action` text,
	`source_kind` text NOT NULL,
	`status` text NOT NULL,
	`status_code` text,
	`updated_at` text NOT NULL,
	CONSTRAINT "recipe_imports_evidence_json_check" CHECK(json_valid("evidence_references_json")),
	CONSTRAINT "recipe_imports_acquisition_generation_check" CHECK(typeof("acquisition_generation") = 'integer' AND "acquisition_generation" >= 0 AND "acquisition_generation" <= 9007199254740991),
	CONSTRAINT "recipe_imports_status_details_check" CHECK((
        "status" = 'queued'
        AND "status_code" IS NULL
        AND "recovery_action" IS NULL
        AND json_array_length("evidence_references_json") = 0
      ) OR (
        "status" = 'acquiring'
        AND "status_code" IS NULL
        AND "recovery_action" IS NULL
        AND json_array_length("evidence_references_json") = 0
      ) OR (
        "status" = 'acquired'
        AND "status_code" IS NULL
        AND "recovery_action" IS NULL
        AND json_array_length("evidence_references_json") = 2
        AND json_extract("evidence_references_json", '$[0].kind') = 'original_media'
        AND json_extract("evidence_references_json", '$[0].referenceId') = 'imports/' || "id" || '/acquisition/v1/generations/' || "acquisition_generation" || '/original.mp4'
        AND json_extract("evidence_references_json", '$[1].kind') = 'acquisition_manifest'
        AND json_extract("evidence_references_json", '$[1].referenceId') = 'imports/' || "id" || '/acquisition/v1/generations/' || "acquisition_generation" || '/manifest.json'
      ) OR (
        "status" = 'failed'
        AND "status_code" = 'private_or_unavailable'
        AND "recovery_action" = 'check_source_visibility'
        AND json_array_length("evidence_references_json") = 0
      ) OR (
        "status" = 'failed'
        AND "status_code" = 'acquisition_temporarily_unavailable'
        AND "recovery_action" = 'retry_later'
        AND json_array_length("evidence_references_json") = 0
      ) OR (
        "status" = 'failed'
        AND "status_code" = 'invalid_or_unsupported_media'
        AND "recovery_action" = 'submit_supported_public_video'
        AND json_array_length("evidence_references_json") = 0
      ) OR (
        "status" = 'unsupported'
        AND "status_code" = 'unsupported_post_type'
        AND "recovery_action" = 'submit_supported_public_video'
        AND json_array_length("evidence_references_json") = 0
      ))
);
--> statement-breakpoint
INSERT INTO `__new_recipe_imports`(`canonical_source_id`, `compatibility_fingerprint`, `created_at`, `evidence_references_json`, `id`, `recovery_action`, `source_kind`, `status`, `status_code`, `updated_at`, `acquisition_generation`) SELECT `canonical_source_id`, `compatibility_fingerprint`, `created_at`, '[]', `id`, `recovery_action`, `source_kind`, `status`, `status_code`, `updated_at`, 0 FROM `recipe_imports`;--> statement-breakpoint
CREATE TABLE `__new_import_requests` (
	`created_at` text NOT NULL,
	`idempotency_key_hash` text NOT NULL PRIMARY KEY,
	`import_id` text NOT NULL,
	`request_fingerprint` text NOT NULL,
	`source_locator_hash` text NOT NULL,
	CONSTRAINT `fk_import_requests_import_id_recipe_imports_id_fk` FOREIGN KEY (`import_id`) REFERENCES `__new_recipe_imports`(`id`) ON UPDATE RESTRICT ON DELETE RESTRICT
);
--> statement-breakpoint
INSERT INTO `__new_import_requests`(`created_at`, `idempotency_key_hash`, `import_id`, `request_fingerprint`, `source_locator_hash`) SELECT `created_at`, `idempotency_key_hash`, `import_id`, `request_fingerprint`, `source_locator_hash` FROM `import_requests`;--> statement-breakpoint
DROP TABLE `import_requests`;--> statement-breakpoint
DROP TABLE `recipe_imports`;--> statement-breakpoint
ALTER TABLE `__new_recipe_imports` RENAME TO `recipe_imports`;--> statement-breakpoint
ALTER TABLE `__new_import_requests` RENAME TO `import_requests`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `import_requests_import_id_index` ON `import_requests` (`import_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `recipe_imports_canonical_identity_unique` ON `recipe_imports` (`source_kind`,`canonical_source_id`);

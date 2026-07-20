CREATE TABLE `import_requests` (
	`created_at` text NOT NULL,
	`idempotency_key_hash` text NOT NULL PRIMARY KEY,
	`import_id` text NOT NULL,
	`request_fingerprint` text NOT NULL,
	`source_locator_hash` text NOT NULL,
	CONSTRAINT `fk_import_requests_import_id_recipe_imports_id_fk` FOREIGN KEY (`import_id`) REFERENCES `recipe_imports`(`id`) ON UPDATE RESTRICT ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TABLE `recipe_imports` (
	`canonical_source_id` text NOT NULL,
	`compatibility_fingerprint` text NOT NULL,
	`created_at` text NOT NULL,
	`evidence_references_json` text NOT NULL,
	`id` text NOT NULL PRIMARY KEY,
	`recovery_action` text,
	`source_kind` text NOT NULL,
	`status` text NOT NULL,
	`status_code` text,
	`updated_at` text NOT NULL,
	CONSTRAINT "recipe_imports_evidence_json_check" CHECK(json_valid("evidence_references_json")),
	CONSTRAINT "recipe_imports_status_details_check" CHECK((
        "status" = 'queued'
        AND "status_code" IS NULL
        AND "recovery_action" IS NULL
      ) OR (
        "status" = 'failed'
        AND "status_code" = 'private_or_unavailable'
        AND "recovery_action" = 'check_source_visibility'
      ) OR (
        "status" = 'unsupported'
        AND "status_code" = 'unsupported_post_type'
        AND "recovery_action" = 'submit_supported_public_video'
      ))
);
--> statement-breakpoint
CREATE INDEX `import_requests_import_id_index` ON `import_requests` (`import_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `recipe_imports_canonical_identity_unique` ON `recipe_imports` (`source_kind`,`canonical_source_id`);

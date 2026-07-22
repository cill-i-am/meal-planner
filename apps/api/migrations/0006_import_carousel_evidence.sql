CREATE TABLE `import_carousel_evidence` (
	`import_id` text NOT NULL,
	`acquisition_generation` integer NOT NULL,
	`descriptor_fingerprint` text NOT NULL,
	`dispatch_id` text NOT NULL,
	`state` text NOT NULL,
	`manifest_key` text,
	`manifest_sha256` text,
	`image_count` integer,
	`failure_code` text,
	`recovery_action` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`completed_at` text,
	PRIMARY KEY (`import_id`,`acquisition_generation`),
	CONSTRAINT `import_carousel_evidence_import_generation_fk` FOREIGN KEY (`import_id`,`acquisition_generation`) REFERENCES `recipe_imports`(`id`,`acquisition_generation`) ON UPDATE RESTRICT ON DELETE RESTRICT,
	CONSTRAINT `import_carousel_evidence_generation_check` CHECK(typeof(`acquisition_generation`) = 'integer' AND `acquisition_generation` >= 0 AND `acquisition_generation` <= 9007199254740991),
	CONSTRAINT `import_carousel_evidence_identity_check` CHECK(length(`descriptor_fingerprint`) = 64 AND `descriptor_fingerprint` NOT GLOB '*[^0-9a-f]*' AND length(`dispatch_id`) BETWEEN 1 AND 100),
	CONSTRAINT `import_carousel_evidence_state_check` CHECK((
		`state` = 'dispatching'
		AND `manifest_key` IS NULL AND `manifest_sha256` IS NULL
		AND `image_count` IS NULL AND `failure_code` IS NULL
		AND `recovery_action` IS NULL AND `completed_at` IS NULL
	) OR (
		`state` = 'completed'
		AND length(`manifest_key`) BETWEEN 1 AND 500
		AND length(`manifest_sha256`) = 64 AND `manifest_sha256` NOT GLOB '*[^0-9a-f]*'
		AND typeof(`image_count`) = 'integer' AND `image_count` BETWEEN 1 AND 12
		AND `failure_code` IS NULL AND `recovery_action` IS NULL
		AND `completed_at` IS NOT NULL
	) OR (
		`state` = 'failed'
		AND `manifest_key` IS NULL AND `manifest_sha256` IS NULL
		AND `image_count` IS NULL AND `completed_at` IS NOT NULL
		AND (
			(`failure_code` = 'carousel_inaccessible' AND `recovery_action` = 'check_source_visibility')
			OR (`failure_code` = 'carousel_partial' AND `recovery_action` = 'request_complete_carousel')
			OR (`failure_code` = 'carousel_layout_drift' AND `recovery_action` = 'update_carousel_adapter')
		)
	))
);--> statement-breakpoint
CREATE UNIQUE INDEX `import_carousel_evidence_dispatch_id_unique` ON `import_carousel_evidence` (`dispatch_id`);--> statement-breakpoint
CREATE INDEX `import_carousel_evidence_state_updated_index` ON `import_carousel_evidence` (`state`,`updated_at`);--> statement-breakpoint
CREATE TRIGGER `import_carousel_evidence_identity_immutable`
BEFORE UPDATE ON `import_carousel_evidence`
WHEN NEW.`import_id` <> OLD.`import_id`
  OR NEW.`acquisition_generation` <> OLD.`acquisition_generation`
  OR NEW.`descriptor_fingerprint` <> OLD.`descriptor_fingerprint`
  OR NEW.`dispatch_id` <> OLD.`dispatch_id`
BEGIN
  SELECT RAISE(ABORT, 'carousel evidence identity is immutable');
END;--> statement-breakpoint
PRAGMA foreign_key_check;

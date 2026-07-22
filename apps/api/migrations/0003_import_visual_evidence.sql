CREATE TABLE `import_visual_evidence` (
	`import_id` text NOT NULL,
	`acquisition_generation` integer NOT NULL,
	`dispatch_id` text NOT NULL,
	`source_media_sha256` text NOT NULL,
	`state` text NOT NULL,
	`outcome` text,
	`manifest_key` text,
	`manifest_sha256` text,
	`provider` text,
	`model` text,
	`input_frames` integer,
	`input_bytes` integer,
	`model_calls` integer,
	`estimated_cost_micro_usd` integer,
	`cost_currency` text,
	`cost_certainty` text,
	`observations_count` integer,
	`failure_code` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`completed_at` text,
	PRIMARY KEY(`import_id`, `acquisition_generation`),
	CONSTRAINT `import_visual_evidence_import_generation_fk` FOREIGN KEY (`import_id`,`acquisition_generation`) REFERENCES `recipe_imports`(`id`,`acquisition_generation`) ON UPDATE RESTRICT ON DELETE RESTRICT,
	CONSTRAINT `import_visual_evidence_generation_check` CHECK(typeof(`acquisition_generation`) = 'integer' AND `acquisition_generation` >= 0 AND `acquisition_generation` <= 9007199254740991),
	CONSTRAINT `import_visual_evidence_dispatch_id_check` CHECK(length(`dispatch_id`) BETWEEN 1 AND 100),
	CONSTRAINT `import_visual_evidence_source_sha_check` CHECK(length(`source_media_sha256`) = 64 AND `source_media_sha256` NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT `import_visual_evidence_state_check` CHECK((
		`state` = 'dispatching'
		AND `outcome` IS NULL
		AND `manifest_key` IS NULL AND `manifest_sha256` IS NULL
		AND `provider` IS NULL AND `model` IS NULL
		AND `input_frames` IS NULL AND `input_bytes` IS NULL
		AND `model_calls` IS NULL
		AND `estimated_cost_micro_usd` IS NULL
		AND `cost_currency` IS NULL AND `cost_certainty` IS NULL
		AND `observations_count` IS NULL AND `failure_code` IS NULL
		AND `completed_at` IS NULL
	) OR (
		`state` = 'completed'
		AND `outcome` IN ('empty', 'found', 'low_confidence')
		AND `manifest_key` IS NOT NULL
		AND length(`manifest_sha256`) = 64
		AND `manifest_sha256` NOT GLOB '*[^0-9a-f]*'
		AND length(`provider`) BETWEEN 1 AND 64
		AND length(`model`) BETWEEN 1 AND 64
		AND typeof(`input_frames`) = 'integer'
		AND `input_frames` BETWEEN 1 AND 12
		AND typeof(`input_bytes`) = 'integer' AND `input_bytes` > 0
		AND typeof(`model_calls`) = 'integer' AND `model_calls` = 1
		AND typeof(`estimated_cost_micro_usd`) = 'integer'
		AND `estimated_cost_micro_usd` >= 0
		AND `cost_currency` = 'USD'
		AND `cost_certainty` IN ('estimated', 'known')
		AND typeof(`observations_count`) = 'integer'
		AND `observations_count` >= 0
		AND `failure_code` IS NULL AND `completed_at` IS NOT NULL
	) OR (
		`state` = 'failed'
		AND `outcome` IS NULL
		AND `manifest_key` IS NULL AND `manifest_sha256` IS NULL
		AND `provider` IS NULL AND `model` IS NULL
		AND `input_frames` IS NULL AND `input_bytes` IS NULL
		AND `model_calls` IS NULL
		AND `estimated_cost_micro_usd` IS NULL
		AND `cost_currency` IS NULL AND `cost_certainty` IS NULL
		AND `observations_count` IS NULL
		AND `failure_code` IN (
			'frame_evidence_failed', 'frame_sampling_failed', 'outcome_unknown',
			'source_evidence_invalid', 'visual_evidence_failed',
			'visual_extraction_failed'
		)
		AND `completed_at` IS NOT NULL
	))
);--> statement-breakpoint
CREATE UNIQUE INDEX `import_visual_evidence_dispatch_id_unique` ON `import_visual_evidence` (`dispatch_id`);--> statement-breakpoint
CREATE INDEX `import_visual_evidence_state_updated_index` ON `import_visual_evidence` (`state`,`updated_at`);--> statement-breakpoint
CREATE TRIGGER `import_visual_evidence_identity_immutable`
BEFORE UPDATE ON `import_visual_evidence`
WHEN NEW.`import_id` <> OLD.`import_id`
  OR NEW.`acquisition_generation` <> OLD.`acquisition_generation`
  OR NEW.`dispatch_id` <> OLD.`dispatch_id`
  OR NEW.`source_media_sha256` <> OLD.`source_media_sha256`
BEGIN
  SELECT RAISE(ABORT, 'visual evidence identity is immutable');
END;--> statement-breakpoint
PRAGMA foreign_key_check;

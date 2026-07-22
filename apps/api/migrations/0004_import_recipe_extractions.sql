CREATE TABLE `import_recipe_extractions` (
	`extraction_fingerprint` text PRIMARY KEY NOT NULL,
	`import_id` text NOT NULL,
	`acquisition_generation` integer NOT NULL,
	`evidence_fingerprint` text NOT NULL,
	`extractor_provider` text NOT NULL,
	`extractor_model` text NOT NULL,
	`extractor_version` text NOT NULL,
	`state` text NOT NULL,
	`draft_json` text,
	`failure_code` text,
	`input_evidence_items` integer,
	`input_tokens` integer,
	`output_tokens` integer,
	`model_calls` integer,
	`latency_milliseconds` integer,
	`estimated_cost_micro_usd` integer,
	`cost_currency` text,
	`cost_certainty` text,
	`is_current` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`completed_at` text,
	CONSTRAINT `import_recipe_extractions_import_generation_fk` FOREIGN KEY (`import_id`,`acquisition_generation`) REFERENCES `recipe_imports`(`id`,`acquisition_generation`) ON UPDATE RESTRICT ON DELETE RESTRICT,
	CONSTRAINT `import_recipe_extractions_fingerprint_check` CHECK(length(`evidence_fingerprint`) = 64 AND `evidence_fingerprint` NOT GLOB '*[^0-9a-f]*' AND length(`extraction_fingerprint`) = 64 AND `extraction_fingerprint` NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT `import_recipe_extractions_state_check` CHECK((
		`state` = 'dispatching'
		AND `draft_json` IS NULL AND `failure_code` IS NULL
		AND `input_evidence_items` IS NULL AND `input_tokens` IS NULL
		AND `output_tokens` IS NULL AND `model_calls` IS NULL
		AND `latency_milliseconds` IS NULL AND `estimated_cost_micro_usd` IS NULL
		AND `cost_currency` IS NULL AND `cost_certainty` IS NULL
		AND `completed_at` IS NULL AND `is_current` = 0
	) OR (
		`state` = 'needs_review' AND json_valid(`draft_json`)
		AND `failure_code` IS NULL
		AND typeof(`input_evidence_items`) = 'integer' AND `input_evidence_items` > 0
		AND typeof(`input_tokens`) = 'integer' AND `input_tokens` >= 0
		AND typeof(`output_tokens`) = 'integer' AND `output_tokens` >= 0
		AND `model_calls` = 1
		AND typeof(`latency_milliseconds`) = 'integer' AND `latency_milliseconds` >= 0
		AND typeof(`estimated_cost_micro_usd`) = 'integer' AND `estimated_cost_micro_usd` >= 0
		AND `cost_currency` = 'USD' AND `cost_certainty` IN ('estimated', 'known')
		AND `completed_at` IS NOT NULL AND `is_current` IN (0, 1)
	) OR (
		`state` = 'failed' AND `draft_json` IS NULL
		AND `failure_code` IN ('insufficient_evidence', 'invalid_schema', 'model_refusal', 'provider_error')
		AND `input_evidence_items` IS NULL AND `input_tokens` IS NULL
		AND `output_tokens` IS NULL AND `model_calls` IS NULL
		AND `latency_milliseconds` IS NULL AND `estimated_cost_micro_usd` IS NULL
		AND `cost_currency` IS NULL AND `cost_certainty` IS NULL
		AND `completed_at` IS NOT NULL AND `is_current` = 0
	))
);--> statement-breakpoint
CREATE UNIQUE INDEX `import_recipe_extractions_current_unique` ON `import_recipe_extractions` (`import_id`,`acquisition_generation`) WHERE `is_current` = 1;--> statement-breakpoint
CREATE INDEX `import_recipe_extractions_state_updated_index` ON `import_recipe_extractions` (`state`,`updated_at`);--> statement-breakpoint
CREATE TRIGGER `import_recipe_extractions_identity_immutable`
BEFORE UPDATE ON `import_recipe_extractions`
WHEN NEW.`extraction_fingerprint` <> OLD.`extraction_fingerprint`
  OR NEW.`import_id` <> OLD.`import_id`
  OR NEW.`acquisition_generation` <> OLD.`acquisition_generation`
  OR NEW.`evidence_fingerprint` <> OLD.`evidence_fingerprint`
  OR NEW.`extractor_provider` <> OLD.`extractor_provider`
  OR NEW.`extractor_model` <> OLD.`extractor_model`
  OR NEW.`extractor_version` <> OLD.`extractor_version`
BEGIN
  SELECT RAISE(ABORT, 'recipe extraction identity is immutable');
END;--> statement-breakpoint
PRAGMA foreign_key_check;

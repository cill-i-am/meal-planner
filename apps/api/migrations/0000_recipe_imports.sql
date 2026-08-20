-- Canonical greenfield import persistence baseline. Existing pre-cutover data is intentionally unsupported.
CREATE TABLE IF NOT EXISTS "recipe_imports" (
	`acquisition_generation` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`evidence_references_json` text NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`recovery_action` text,
	`source_kind` text NOT NULL,
	`status` text NOT NULL,
	`status_code` text,
	`updated_at` text NOT NULL, `correlation_id` text NOT NULL, `household_scope_id` text NOT NULL, `actor_id` text NOT NULL, `intent_version` integer NOT NULL DEFAULT 1, `submitted_source_url` text NOT NULL, `resolved_canonical_source_id` text, `public_source_url` text, `public_source_kind` text, `public_status` text NOT NULL DEFAULT 'processing', `public_stage` text, `public_stage_started_at` text, `public_activity` text, `public_next_attempt_at` text, `active_action_id` text, `public_recipe_id` text, `public_failure_code` text, `public_failure_message` text, `public_recovery` text, `failed_at` text, `cancelled_at` text, `succeeded_at` text, `redirected_at` text, `redirected_to_import_id` text REFERENCES `recipe_imports`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT, `execution_generation` integer NOT NULL DEFAULT 1, `executor_owner_id` text, `transition_mutation_id` text, `transition_command_digest` text, `transition_actor_category` text, `transition_actor_identity_hash` text, `transition_provenance_version` integer, `public_speech` text, `public_visuals` text, `active_action_version` integer,
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
        "status" = 'transcribing'
        AND "status_code" IS NULL
        AND "recovery_action" IS NULL
        AND json_array_length("evidence_references_json") = 2
        AND json_extract("evidence_references_json", '$[0].kind') = 'original_media'
        AND json_extract("evidence_references_json", '$[0].referenceId') = 'imports/' || "id" || '/acquisition/v1/generations/' || "acquisition_generation" || '/original.mp4'
        AND json_extract("evidence_references_json", '$[1].kind') = 'acquisition_manifest'
        AND json_extract("evidence_references_json", '$[1].referenceId') = 'imports/' || "id" || '/acquisition/v1/generations/' || "acquisition_generation" || '/manifest.json'
      ) OR (
        "status" = 'transcribed'
        AND "status_code" IS NULL
        AND "recovery_action" IS NULL
        AND json_array_length("evidence_references_json") = 3
        AND json_extract("evidence_references_json", '$[0].kind') = 'original_media'
        AND json_extract("evidence_references_json", '$[0].referenceId') = 'imports/' || "id" || '/acquisition/v1/generations/' || "acquisition_generation" || '/original.mp4'
        AND json_extract("evidence_references_json", '$[1].kind') = 'acquisition_manifest'
        AND json_extract("evidence_references_json", '$[1].referenceId') = 'imports/' || "id" || '/acquisition/v1/generations/' || "acquisition_generation" || '/manifest.json'
        AND json_extract("evidence_references_json", '$[2].kind') = 'speech_transcript'
        AND json_extract("evidence_references_json", '$[2].referenceId') = 'imports/' || "id" || '/transcription/v1/generations/' || "acquisition_generation" || '/transcript.json'
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
        "status" = 'failed'
        AND "status_code" = 'transcription_failed'
        AND "recovery_action" = 'retry_later'
        AND json_array_length("evidence_references_json") = 2
        AND json_extract("evidence_references_json", '$[0].kind') = 'original_media'
        AND json_extract("evidence_references_json", '$[0].referenceId') = 'imports/' || "id" || '/acquisition/v1/generations/' || "acquisition_generation" || '/original.mp4'
        AND json_extract("evidence_references_json", '$[1].kind') = 'acquisition_manifest'
        AND json_extract("evidence_references_json", '$[1].referenceId') = 'imports/' || "id" || '/acquisition/v1/generations/' || "acquisition_generation" || '/manifest.json'
      ) OR (
        "status" = 'unsupported'
        AND "status_code" = 'unsupported_post_type'
        AND "recovery_action" = 'submit_supported_public_video'
        AND json_array_length("evidence_references_json") = 0
      ))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recipe_imports_id_generation_unique` ON `recipe_imports` (`id`,`acquisition_generation`);
--> statement-breakpoint
CREATE TABLE `import_transcriptions` (
	`import_id` text NOT NULL,
	`acquisition_generation` integer NOT NULL,
	`dispatch_id` text NOT NULL,
	`source_media_sha256` text NOT NULL,
	`state` text NOT NULL,
	`transcript_key` text,
	`transcript_sha256` text,
	`provider` text,
	`model` text,
	`detected_language` text,
	`usage_audio_milliseconds` integer,
	`usage_input_bytes` integer,
	`estimated_cost_micro_usd` integer,
	`cost_currency` text,
	`cost_certainty` text,
	`segments_count` integer,
	`failure_code` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`completed_at` text,
	PRIMARY KEY(`import_id`, `acquisition_generation`),
	CONSTRAINT `import_transcriptions_import_generation_fk` FOREIGN KEY (`import_id`,`acquisition_generation`) REFERENCES `recipe_imports`(`id`,`acquisition_generation`) ON UPDATE RESTRICT ON DELETE RESTRICT,
	CONSTRAINT `import_transcriptions_generation_check` CHECK(typeof(`acquisition_generation`) = 'integer' AND `acquisition_generation` >= 0 AND `acquisition_generation` <= 9007199254740991),
	CONSTRAINT `import_transcriptions_dispatch_id_check` CHECK(length(`dispatch_id`) BETWEEN 1 AND 100),
	CONSTRAINT `import_transcriptions_source_sha_check` CHECK(length(`source_media_sha256`) = 64 AND `source_media_sha256` NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT `import_transcriptions_state_check` CHECK((
      `state` = 'dispatching'
      AND `transcript_key` IS NULL AND `transcript_sha256` IS NULL
      AND `provider` IS NULL AND `model` IS NULL
      AND `detected_language` IS NULL
      AND `usage_audio_milliseconds` IS NULL AND `usage_input_bytes` IS NULL
      AND `estimated_cost_micro_usd` IS NULL
      AND `cost_currency` IS NULL AND `cost_certainty` IS NULL
      AND `segments_count` IS NULL AND `failure_code` IS NULL
      AND `completed_at` IS NULL
    ) OR (
      `state` = 'transcribed'
      AND `transcript_key` IS NOT NULL
      AND length(`transcript_sha256`) = 64
      AND `transcript_sha256` NOT GLOB '*[^0-9a-f]*'
      AND length(`provider`) BETWEEN 1 AND 64
      AND length(`model`) BETWEEN 1 AND 64
      AND `detected_language` GLOB '[a-z][a-z]'
      AND typeof(`usage_audio_milliseconds`) = 'integer'
      AND `usage_audio_milliseconds` > 0
      AND typeof(`usage_input_bytes`) = 'integer' AND `usage_input_bytes` > 0
      AND typeof(`estimated_cost_micro_usd`) = 'integer'
      AND `estimated_cost_micro_usd` >= 0
      AND `cost_currency` = 'USD'
      AND `cost_certainty` IN ('estimated', 'known')
      AND typeof(`segments_count`) = 'integer' AND `segments_count` > 0
      AND `failure_code` IS NULL AND `completed_at` IS NOT NULL
    ) OR (
      `state` = 'failed'
      AND `transcript_key` IS NULL AND `transcript_sha256` IS NULL
      AND `provider` IS NULL AND `model` IS NULL
      AND `detected_language` IS NULL
      AND `usage_audio_milliseconds` IS NULL AND `usage_input_bytes` IS NULL
      AND `estimated_cost_micro_usd` IS NULL
      AND `cost_currency` IS NULL AND `cost_certainty` IS NULL
      AND `segments_count` IS NULL
      AND `failure_code` IN (
        'audio_extraction_failed', 'outcome_unknown',
        'source_evidence_invalid', 'transcription_failed',
        'transcript_evidence_failed'
      )
      AND `completed_at` IS NOT NULL
    ))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `import_transcriptions_dispatch_id_unique` ON `import_transcriptions` (`dispatch_id`);
--> statement-breakpoint
CREATE INDEX `import_transcriptions_state_updated_index` ON `import_transcriptions` (`state`,`updated_at`);
--> statement-breakpoint
CREATE TRIGGER `import_transcriptions_identity_immutable`
BEFORE UPDATE ON `import_transcriptions`
WHEN NEW.`import_id` <> OLD.`import_id`
  OR NEW.`acquisition_generation` <> OLD.`acquisition_generation`
  OR NEW.`dispatch_id` <> OLD.`dispatch_id`
  OR NEW.`source_media_sha256` <> OLD.`source_media_sha256`
BEGIN
  SELECT RAISE(ABORT, 'import transcription identity is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `import_transcriptions_claim_parent`
AFTER INSERT ON `import_transcriptions`
WHEN NEW.`state` = 'dispatching'
BEGIN
  UPDATE `recipe_imports`
     SET `status` = 'transcribing', `status_code` = NULL,
         `recovery_action` = NULL, `updated_at` = NEW.`created_at`
   WHERE `id` = NEW.`import_id`
     AND `acquisition_generation` = NEW.`acquisition_generation`
     AND `status` = 'acquired'
     AND json_array_length(`evidence_references_json`) = 2;
  SELECT CASE changes()
    WHEN 1 THEN NULL
    ELSE RAISE(ABORT, 'speech dispatch parent transition rejected')
  END;
END;
--> statement-breakpoint
CREATE TRIGGER `import_transcriptions_complete_parent`
AFTER UPDATE OF `state` ON `import_transcriptions`
WHEN OLD.`state` = 'dispatching' AND NEW.`state` = 'transcribed'
BEGIN
  UPDATE `recipe_imports`
     SET `status` = 'transcribed', `status_code` = NULL,
         `recovery_action` = NULL,
         `evidence_references_json` = json_insert(
           `evidence_references_json`, '$[#]',
           json_object(
             'kind', 'speech_transcript',
             'referenceId', NEW.`transcript_key`
           )
         ),
         `updated_at` = NEW.`completed_at`
   WHERE `id` = NEW.`import_id`
     AND `acquisition_generation` = NEW.`acquisition_generation`
     AND `status` = 'transcribing'
     AND json_array_length(`evidence_references_json`) = 2;
  SELECT CASE changes()
    WHEN 1 THEN NULL
    ELSE RAISE(ABORT, 'speech completion parent transition rejected')
  END;
END;
--> statement-breakpoint
CREATE TRIGGER `import_transcriptions_fail_parent`
AFTER UPDATE OF `state` ON `import_transcriptions`
WHEN OLD.`state` = 'dispatching' AND NEW.`state` = 'failed'
BEGIN
  UPDATE `recipe_imports`
     SET `status` = 'failed', `status_code` = 'transcription_failed',
         `recovery_action` = 'retry_later',
         `updated_at` = NEW.`completed_at`
   WHERE `id` = NEW.`import_id`
     AND `acquisition_generation` = NEW.`acquisition_generation`
     AND `status` = 'transcribing'
     AND json_array_length(`evidence_references_json`) = 2;
  SELECT CASE changes()
    WHEN 1 THEN NULL
    ELSE RAISE(ABORT, 'speech failure parent transition rejected')
  END;
END;
--> statement-breakpoint
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
);
--> statement-breakpoint
CREATE UNIQUE INDEX `import_visual_evidence_dispatch_id_unique` ON `import_visual_evidence` (`dispatch_id`);
--> statement-breakpoint
CREATE INDEX `import_visual_evidence_state_updated_index` ON `import_visual_evidence` (`state`,`updated_at`);
--> statement-breakpoint
CREATE TRIGGER `import_visual_evidence_identity_immutable`
BEFORE UPDATE ON `import_visual_evidence`
WHEN NEW.`import_id` <> OLD.`import_id`
  OR NEW.`acquisition_generation` <> OLD.`acquisition_generation`
  OR NEW.`dispatch_id` <> OLD.`dispatch_id`
  OR NEW.`source_media_sha256` <> OLD.`source_media_sha256`
BEGIN
  SELECT RAISE(ABORT, 'visual evidence identity is immutable');
END;
--> statement-breakpoint
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
	CONSTRAINT `import_recipe_extractions_descriptor_check` CHECK(length(`extractor_provider`) BETWEEN 1 AND 64 AND length(`extractor_model`) BETWEEN 1 AND 64 AND length(`extractor_version`) BETWEEN 1 AND 64),
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
);
--> statement-breakpoint
CREATE UNIQUE INDEX `import_recipe_extractions_current_unique` ON `import_recipe_extractions` (`import_id`,`acquisition_generation`) WHERE `is_current` = 1;
--> statement-breakpoint
CREATE INDEX `import_recipe_extractions_state_updated_index` ON `import_recipe_extractions` (`state`,`updated_at`);
--> statement-breakpoint
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
END;
--> statement-breakpoint
CREATE TRIGGER `import_recipe_draft_immutable_update`
BEFORE UPDATE OF `draft_json` ON `import_recipe_extractions`
WHEN OLD.`state` = 'needs_review' AND NEW.`draft_json` IS NOT OLD.`draft_json`
BEGIN
  SELECT RAISE(ABORT, 'completed recipe drafts are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `import_recipe_draft_immutable_delete`
BEFORE DELETE ON `import_recipe_extractions`
WHEN OLD.`state` = 'needs_review'
BEGIN
  SELECT RAISE(ABORT, 'completed recipe drafts are immutable');
END;
--> statement-breakpoint
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
);
--> statement-breakpoint
CREATE UNIQUE INDEX `import_carousel_evidence_dispatch_id_unique` ON `import_carousel_evidence` (`dispatch_id`);
--> statement-breakpoint
CREATE INDEX `import_carousel_evidence_state_updated_index` ON `import_carousel_evidence` (`state`,`updated_at`);
--> statement-breakpoint
CREATE TRIGGER `import_carousel_evidence_identity_immutable`
BEFORE UPDATE ON `import_carousel_evidence`
WHEN NEW.`import_id` <> OLD.`import_id`
  OR NEW.`acquisition_generation` <> OLD.`acquisition_generation`
  OR NEW.`descriptor_fingerprint` <> OLD.`descriptor_fingerprint`
  OR NEW.`dispatch_id` <> OLD.`dispatch_id`
BEGIN
  SELECT RAISE(ABORT, 'carousel evidence identity is immutable');
END;
--> statement-breakpoint
CREATE TABLE `import_batches` (
  `id` text PRIMARY KEY NOT NULL,
  `idempotency_key_hash` text NOT NULL,
  `request_fingerprint` text NOT NULL,
  `status` text DEFAULT 'queued' NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  CONSTRAINT `import_batches_idempotency_key_hash_unique`
    UNIQUE (`idempotency_key_hash`),
  CONSTRAINT `import_batches_status_check`
    CHECK (`status` IN ('queued', 'running', 'completed', 'partial_failure', 'failed'))
);
--> statement-breakpoint
CREATE TABLE `import_operational_events` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `event_tag` text NOT NULL,
  `item_id` text,
  `actor_id` text,
  `event_json` text NOT NULL,
  `occurred_at` text NOT NULL,
  CONSTRAINT `import_operational_events_event_json_check`
    CHECK (json_valid(`event_json`))
);
--> statement-breakpoint
CREATE INDEX `import_operational_events_item_id_idx`
  ON `import_operational_events` (`item_id`);
--> statement-breakpoint
CREATE TABLE `pilot_provider_stage_budget` (
  `runtime_stage` text PRIMARY KEY NOT NULL,
  `budget_cap_micro_usd` integer DEFAULT 10000000 NOT NULL,
  `settled_micro_usd` integer DEFAULT 0 NOT NULL,
  `reserved_micro_usd` integer DEFAULT 0 NOT NULL,
  `state` text DEFAULT 'open' NOT NULL,
  `invoking_dispatch_id` text,
  `poison_dispatch_id` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  CONSTRAINT `pilot_provider_stage_budget_runtime_stage_check`
    CHECK (`runtime_stage` = 'pilot-gaia-118'),
  CONSTRAINT `pilot_provider_stage_budget_cap_check`
    CHECK (
      typeof(`budget_cap_micro_usd`) = 'integer'
      AND `budget_cap_micro_usd` = 10000000
    ),
  CONSTRAINT `pilot_provider_stage_budget_amounts_check`
    CHECK (
      typeof(`settled_micro_usd`) = 'integer'
      AND `settled_micro_usd` >= 0
      AND typeof(`reserved_micro_usd`) = 'integer'
      AND `reserved_micro_usd` >= 0
      AND `settled_micro_usd` + `reserved_micro_usd` <= `budget_cap_micro_usd`
    ),
  CONSTRAINT `pilot_provider_stage_budget_state_check`
    CHECK (
      (
        `state` = 'open'
        AND `invoking_dispatch_id` IS NULL
        AND `poison_dispatch_id` IS NULL
      )
      OR (
        `state` = 'invoking'
        AND `invoking_dispatch_id` IS NOT NULL
        AND `poison_dispatch_id` IS NULL
      )
      OR (
        `state` = 'poisoned'
        AND `invoking_dispatch_id` IS NULL
        AND `poison_dispatch_id` IS NOT NULL
      )
  )
);
--> statement-breakpoint
INSERT INTO `pilot_provider_stage_budget` (
  `runtime_stage`,
  `created_at`,
  `updated_at`
) VALUES (
  'pilot-gaia-118',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
);
--> statement-breakpoint
CREATE TABLE `pilot_provider_budget_dispatches` (
  `runtime_stage` text NOT NULL,
  `dispatch_id` text NOT NULL,
  `run_id` text NOT NULL,
  `provider_stage_id` text NOT NULL,
  `maximum_cost_micro_usd` integer NOT NULL,
  `actual_cost_micro_usd` integer,
  `state` text DEFAULT 'reserved' NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  `invocation_started_at` text,
  `completed_at` text,
  PRIMARY KEY (`runtime_stage`, `dispatch_id`),
  CONSTRAINT `pilot_provider_budget_dispatches_stage_fk`
    FOREIGN KEY (`runtime_stage`)
    REFERENCES `pilot_provider_stage_budget`(`runtime_stage`)
    ON DELETE RESTRICT,
  CONSTRAINT `pilot_provider_budget_dispatches_runtime_stage_check`
    CHECK (`runtime_stage` = 'pilot-gaia-118'),
  CONSTRAINT `pilot_provider_budget_dispatches_maximum_check`
    CHECK (
      typeof(`maximum_cost_micro_usd`) = 'integer'
      AND `maximum_cost_micro_usd` > 0
      AND `maximum_cost_micro_usd` <= 10000000
    ),
  CONSTRAINT `pilot_provider_budget_dispatches_shape_check`
    CHECK (
      (
        `state` = 'reserved'
        AND `actual_cost_micro_usd` IS NULL
        AND `invocation_started_at` IS NULL
        AND `completed_at` IS NULL
      )
      OR (
        `state` = 'invoking'
        AND `actual_cost_micro_usd` IS NULL
        AND `invocation_started_at` IS NOT NULL
        AND `completed_at` IS NULL
      )
      OR (
        `state` = 'released'
        AND `actual_cost_micro_usd` IS NULL
        AND `invocation_started_at` IS NULL
        AND `completed_at` IS NOT NULL
      )
      OR (
        `state` = 'settled_known'
        AND typeof(`actual_cost_micro_usd`) = 'integer'
        AND `actual_cost_micro_usd` >= 0
        AND `actual_cost_micro_usd` <= `maximum_cost_micro_usd`
        AND `invocation_started_at` IS NOT NULL
        AND `completed_at` IS NOT NULL
      )
      OR (
        `state` = 'settled_unknown'
        AND `actual_cost_micro_usd` IS NULL
        AND `invocation_started_at` IS NOT NULL
        AND `completed_at` IS NOT NULL
      )
    )
);
--> statement-breakpoint
CREATE INDEX `pilot_provider_budget_dispatches_run_idx`
  ON `pilot_provider_budget_dispatches` (`runtime_stage`, `run_id`);
--> statement-breakpoint
CREATE TRIGGER `pilot_provider_budget_dispatches_transition_guard`
BEFORE UPDATE ON `pilot_provider_budget_dispatches`
BEGIN
  SELECT CASE
    WHEN OLD.`runtime_stage` <> NEW.`runtime_stage`
      OR OLD.`dispatch_id` <> NEW.`dispatch_id`
      OR OLD.`run_id` <> NEW.`run_id`
      OR OLD.`provider_stage_id` <> NEW.`provider_stage_id`
      OR OLD.`maximum_cost_micro_usd` <> NEW.`maximum_cost_micro_usd`
      OR OLD.`created_at` <> NEW.`created_at`
    THEN RAISE(ABORT, 'pilot provider dispatch identity is immutable')
  END;
  SELECT CASE
    WHEN NOT (
      (OLD.`state` = 'reserved' AND NEW.`state` IN ('invoking', 'released'))
      OR (
        OLD.`state` = 'invoking'
        AND NEW.`state` IN ('settled_known', 'settled_unknown')
      )
    )
    THEN RAISE(ABORT, 'invalid pilot provider dispatch transition')
  END;
END;
--> statement-breakpoint
CREATE TRIGGER `pilot_provider_budget_dispatches_reserve`
AFTER INSERT ON `pilot_provider_budget_dispatches`
BEGIN
  UPDATE `pilot_provider_stage_budget`
     SET `reserved_micro_usd` =
           `reserved_micro_usd` + NEW.`maximum_cost_micro_usd`,
         `updated_at` = NEW.`updated_at`
   WHERE `runtime_stage` = NEW.`runtime_stage`
     AND `state` = 'open'
     AND `settled_micro_usd`
         + `reserved_micro_usd`
         + NEW.`maximum_cost_micro_usd`
       <= `budget_cap_micro_usd`;
  SELECT CASE
    WHEN changes() <> 1
    THEN RAISE(ABORT, 'pilot provider reservation rejected')
  END;
END;
--> statement-breakpoint
CREATE TRIGGER `pilot_provider_budget_dispatches_release`
AFTER UPDATE OF `state` ON `pilot_provider_budget_dispatches`
WHEN OLD.`state` = 'reserved' AND NEW.`state` = 'released'
BEGIN
  UPDATE `pilot_provider_stage_budget`
     SET `reserved_micro_usd` =
           `reserved_micro_usd` - OLD.`maximum_cost_micro_usd`,
         `updated_at` = NEW.`updated_at`
   WHERE `runtime_stage` = NEW.`runtime_stage`
     AND `state` = 'open';
  SELECT CASE
    WHEN changes() <> 1
    THEN RAISE(ABORT, 'pilot provider release rejected')
  END;
END;
--> statement-breakpoint
CREATE TRIGGER `pilot_provider_budget_dispatches_begin_invocation`
AFTER UPDATE OF `state` ON `pilot_provider_budget_dispatches`
WHEN OLD.`state` = 'reserved' AND NEW.`state` = 'invoking'
BEGIN
  UPDATE `pilot_provider_stage_budget`
     SET `state` = 'invoking',
         `invoking_dispatch_id` = NEW.`dispatch_id`,
         `updated_at` = NEW.`updated_at`
   WHERE `runtime_stage` = NEW.`runtime_stage`
     AND `state` = 'open';
  SELECT CASE
    WHEN changes() <> 1
    THEN RAISE(ABORT, 'pilot provider invocation rejected')
  END;
END;
--> statement-breakpoint
CREATE TRIGGER `pilot_provider_budget_dispatches_settle_known`
AFTER UPDATE OF `state` ON `pilot_provider_budget_dispatches`
WHEN OLD.`state` = 'invoking' AND NEW.`state` = 'settled_known'
BEGIN
  UPDATE `pilot_provider_stage_budget`
     SET `settled_micro_usd` =
           `settled_micro_usd` + NEW.`actual_cost_micro_usd`,
         `reserved_micro_usd` =
           `reserved_micro_usd` - OLD.`maximum_cost_micro_usd`,
         `state` = 'open',
         `invoking_dispatch_id` = NULL,
         `updated_at` = NEW.`updated_at`
   WHERE `runtime_stage` = NEW.`runtime_stage`
     AND `state` = 'invoking'
     AND `invoking_dispatch_id` = NEW.`dispatch_id`;
  SELECT CASE
    WHEN changes() <> 1
    THEN RAISE(ABORT, 'pilot provider known settlement rejected')
  END;
END;
--> statement-breakpoint
CREATE TRIGGER `pilot_provider_budget_dispatches_settle_unknown`
AFTER UPDATE OF `state` ON `pilot_provider_budget_dispatches`
WHEN OLD.`state` = 'invoking' AND NEW.`state` = 'settled_unknown'
BEGIN
  UPDATE `pilot_provider_stage_budget`
     SET `state` = 'poisoned',
         `invoking_dispatch_id` = NULL,
         `poison_dispatch_id` = NEW.`dispatch_id`,
         `updated_at` = NEW.`updated_at`
   WHERE `runtime_stage` = NEW.`runtime_stage`
     AND `state` = 'invoking'
     AND `invoking_dispatch_id` = NEW.`dispatch_id`;
  SELECT CASE
    WHEN changes() <> 1
    THEN RAISE(ABORT, 'pilot provider unknown settlement rejected')
  END;
END;
--> statement-breakpoint
CREATE TABLE `import_provider_terminal_checkpoints` (
  `import_id` text NOT NULL,
  `acquisition_generation` integer NOT NULL,
  `provider_stage` text NOT NULL,
  `ownership_id` text NOT NULL,
  `failure_code` text NOT NULL,
  `completed_at` text NOT NULL,
  `created_at` text NOT NULL,
  PRIMARY KEY (
    `import_id`,
    `acquisition_generation`,
    `provider_stage`,
    `ownership_id`
  ),
  CONSTRAINT `import_provider_terminal_checkpoints_import_generation_fk`
    FOREIGN KEY (`import_id`, `acquisition_generation`)
    REFERENCES `recipe_imports`(`id`, `acquisition_generation`)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT `import_provider_terminal_checkpoints_generation_check`
    CHECK (
      typeof(`acquisition_generation`) = 'integer'
      AND `acquisition_generation` >= 0
      AND `acquisition_generation` <= 9007199254740991
    ),
  CONSTRAINT `import_provider_terminal_checkpoints_stage_check`
    CHECK (`provider_stage` IN ('speech', 'visual', 'recipe')),
  CONSTRAINT `import_provider_terminal_checkpoints_ownership_check`
    CHECK (length(`ownership_id`) BETWEEN 1 AND 128),
  CONSTRAINT `import_provider_terminal_checkpoints_failure_check`
    CHECK (length(`failure_code`) BETWEEN 1 AND 64)
);
--> statement-breakpoint
CREATE INDEX `import_provider_terminal_checkpoints_import_idx`
  ON `import_provider_terminal_checkpoints` (
    `import_id`,
    `acquisition_generation`,
    `provider_stage`,
    `completed_at`
  );
--> statement-breakpoint
CREATE TRIGGER `import_provider_terminal_checkpoints_immutable_update`
BEFORE UPDATE ON `import_provider_terminal_checkpoints`
BEGIN
  SELECT RAISE(ABORT, 'provider terminal checkpoint is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `import_provider_terminal_checkpoints_immutable_delete`
BEFORE DELETE ON `import_provider_terminal_checkpoints`
BEGIN
  SELECT RAISE(ABORT, 'provider terminal checkpoint is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `import_provider_terminal_checkpoints_fail_speech`
AFTER INSERT ON `import_provider_terminal_checkpoints`
WHEN NEW.`provider_stage` = 'speech'
BEGIN
  UPDATE `import_transcriptions`
     SET `state` = 'failed',
         `failure_code` = iif(
           NEW.`failure_code` = 'outcome_unknown',
           'outcome_unknown',
           'transcription_failed'
         ),
         `completed_at` = NEW.`completed_at`,
         `updated_at` = NEW.`completed_at`
   WHERE `import_id` = NEW.`import_id`
     AND `acquisition_generation` = NEW.`acquisition_generation`
     AND `dispatch_id` = NEW.`ownership_id`
     AND `state` = 'dispatching';
  SELECT CASE
    WHEN changes() = 1 THEN NULL
    WHEN EXISTS (
      SELECT 1
        FROM `import_transcriptions`
       WHERE `import_id` = NEW.`import_id`
         AND `acquisition_generation` = NEW.`acquisition_generation`
         AND `dispatch_id` = NEW.`ownership_id`
         AND `state` = 'failed'
    ) THEN NULL
    ELSE RAISE(ABORT, 'speech terminal checkpoint ownership rejected')
  END;
END;
--> statement-breakpoint
CREATE TABLE `pilot_provider_budget_reconciliations` (
  `runtime_stage` text NOT NULL,
  `dispatch_id` text NOT NULL,
  `conservative_charge_micro_usd` integer NOT NULL,
  `actual_cost_was_unknown` integer DEFAULT 1 NOT NULL,
  `authority` text NOT NULL,
  `created_at` text NOT NULL,
  PRIMARY KEY (`runtime_stage`, `dispatch_id`),
  CONSTRAINT `pilot_provider_budget_reconciliations_dispatch_fk`
    FOREIGN KEY (`runtime_stage`, `dispatch_id`)
    REFERENCES `pilot_provider_budget_dispatches`(`runtime_stage`, `dispatch_id`)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT `pilot_provider_budget_reconciliations_stage_check`
    CHECK (`runtime_stage` = 'pilot-gaia-118'),
  CONSTRAINT `pilot_provider_budget_reconciliations_charge_check`
    CHECK (
      typeof(`conservative_charge_micro_usd`) = 'integer'
      AND `conservative_charge_micro_usd` > 0
      AND `conservative_charge_micro_usd` <= 10000000
    ),
  CONSTRAINT `pilot_provider_budget_reconciliations_unknown_check`
    CHECK (`actual_cost_was_unknown` = 1),
  CONSTRAINT `pilot_provider_budget_reconciliations_authority_check`
    CHECK (`authority` = 'authenticated_operator')
);
--> statement-breakpoint
CREATE TRIGGER `pilot_provider_budget_reconciliations_immutable_update`
BEFORE UPDATE ON `pilot_provider_budget_reconciliations`
BEGIN
  SELECT RAISE(ABORT, 'pilot provider budget reconciliation is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `pilot_provider_budget_reconciliations_immutable_delete`
BEFORE DELETE ON `pilot_provider_budget_reconciliations`
BEGIN
  SELECT RAISE(ABORT, 'pilot provider budget reconciliation is immutable');
END;
--> statement-breakpoint
CREATE TABLE `pilot_provider_speech_recoveries` (
  `runtime_stage` text NOT NULL,
  `import_id` text NOT NULL,
  `acquisition_generation` integer NOT NULL,
  `original_dispatch_id` text NOT NULL,
  `recovery_dispatch_id` text NOT NULL,
  `created_at` text NOT NULL,
  PRIMARY KEY (`runtime_stage`, `original_dispatch_id`),
  CONSTRAINT `pilot_provider_speech_recoveries_import_generation_fk`
    FOREIGN KEY (`import_id`, `acquisition_generation`)
    REFERENCES `recipe_imports`(`id`, `acquisition_generation`)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT `pilot_provider_speech_recoveries_original_dispatch_fk`
    FOREIGN KEY (`runtime_stage`, `original_dispatch_id`)
    REFERENCES `pilot_provider_budget_dispatches`(`runtime_stage`, `dispatch_id`)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT `pilot_provider_speech_recoveries_stage_check`
    CHECK (`runtime_stage` = 'pilot-gaia-118'),
  CONSTRAINT `pilot_provider_speech_recoveries_generation_check`
    CHECK (
      typeof(`acquisition_generation`) = 'integer'
      AND `acquisition_generation` >= 0
      AND `acquisition_generation` <= 9007199254740991
    ),
  CONSTRAINT `pilot_provider_speech_recoveries_dispatch_check`
    CHECK (
      length(`original_dispatch_id`) BETWEEN 1 AND 100
      AND length(`recovery_dispatch_id`) BETWEEN 1 AND 100
      AND `original_dispatch_id` <> `recovery_dispatch_id`
    )
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pilot_provider_speech_recoveries_recovery_dispatch_unique`
  ON `pilot_provider_speech_recoveries` (
    `runtime_stage`,
    `recovery_dispatch_id`
  );
--> statement-breakpoint
CREATE TRIGGER `pilot_provider_speech_recoveries_immutable_update`
BEFORE UPDATE ON `pilot_provider_speech_recoveries`
BEGIN
  SELECT RAISE(ABORT, 'pilot provider speech recovery is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `pilot_provider_speech_recoveries_immutable_delete`
BEFORE DELETE ON `pilot_provider_speech_recoveries`
BEGIN
  SELECT RAISE(ABORT, 'pilot provider speech recovery is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `pilot_provider_speech_recoveries_prepare`
AFTER INSERT ON `pilot_provider_speech_recoveries`
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
        FROM `pilot_provider_stage_budget` AS stage
        JOIN `pilot_provider_budget_dispatches` AS dispatch
          ON dispatch.`runtime_stage` = stage.`runtime_stage`
         AND dispatch.`dispatch_id` = stage.`poison_dispatch_id`
        JOIN `import_provider_terminal_checkpoints` AS checkpoint
          ON checkpoint.`import_id` = NEW.`import_id`
         AND checkpoint.`acquisition_generation` =
               NEW.`acquisition_generation`
         AND checkpoint.`provider_stage` = 'speech'
         AND checkpoint.`ownership_id` = NEW.`original_dispatch_id`
         AND checkpoint.`failure_code` = 'outcome_unknown'
       WHERE stage.`runtime_stage` = NEW.`runtime_stage`
         AND stage.`state` = 'poisoned'
         AND stage.`poison_dispatch_id` = NEW.`original_dispatch_id`
         AND stage.`invoking_dispatch_id` IS NULL
         AND dispatch.`state` = 'settled_unknown'
         AND dispatch.`provider_stage_id` = 'speech-transcription'
         AND dispatch.`actual_cost_micro_usd` IS NULL
         AND dispatch.`maximum_cost_micro_usd` <=
               stage.`reserved_micro_usd`
         AND stage.`settled_micro_usd` + stage.`reserved_micro_usd` <
               stage.`budget_cap_micro_usd`
    )
    THEN RAISE(ABORT, 'pilot provider speech recovery preconditions rejected')
  END;

  INSERT INTO `pilot_provider_budget_reconciliations` (
    `runtime_stage`,
    `dispatch_id`,
    `conservative_charge_micro_usd`,
    `authority`,
    `created_at`
  )
  SELECT
    NEW.`runtime_stage`,
    dispatch.`dispatch_id`,
    dispatch.`maximum_cost_micro_usd`,
    'authenticated_operator',
    NEW.`created_at`
  FROM `pilot_provider_budget_dispatches` AS dispatch
  WHERE dispatch.`runtime_stage` = NEW.`runtime_stage`
    AND dispatch.`dispatch_id` = NEW.`original_dispatch_id`
    AND dispatch.`state` = 'settled_unknown';
  SELECT CASE
    WHEN changes() = 1 THEN NULL
    ELSE RAISE(ABORT, 'pilot provider reconciliation audit rejected')
  END;

  UPDATE `pilot_provider_stage_budget`
     SET `settled_micro_usd` = `settled_micro_usd` + (
           SELECT `maximum_cost_micro_usd`
             FROM `pilot_provider_budget_dispatches`
            WHERE `runtime_stage` = NEW.`runtime_stage`
              AND `dispatch_id` = NEW.`original_dispatch_id`
         ),
         `reserved_micro_usd` = `reserved_micro_usd` - (
           SELECT `maximum_cost_micro_usd`
             FROM `pilot_provider_budget_dispatches`
            WHERE `runtime_stage` = NEW.`runtime_stage`
              AND `dispatch_id` = NEW.`original_dispatch_id`
         ),
         `state` = 'open',
         `poison_dispatch_id` = NULL,
         `updated_at` = NEW.`created_at`
   WHERE `runtime_stage` = NEW.`runtime_stage`
     AND `state` = 'poisoned'
     AND `poison_dispatch_id` = NEW.`original_dispatch_id`
     AND `invoking_dispatch_id` IS NULL;
  SELECT CASE
    WHEN changes() = 1 THEN NULL
    ELSE RAISE(ABORT, 'pilot provider stage reconciliation rejected')
  END;

  DELETE FROM `import_transcriptions`
   WHERE `import_id` = NEW.`import_id`
     AND `acquisition_generation` = NEW.`acquisition_generation`
     AND `dispatch_id` = NEW.`original_dispatch_id`
     AND `state` = 'failed'
     AND `failure_code` = 'outcome_unknown';
  SELECT CASE
    WHEN changes() = 1 THEN NULL
    ELSE RAISE(ABORT, 'pilot speech projection recovery rejected')
  END;

  UPDATE `recipe_imports`
     SET `status` = 'acquired',
         `status_code` = NULL,
         `recovery_action` = NULL,
         `updated_at` = NEW.`created_at`
   WHERE `id` = NEW.`import_id`
     AND `acquisition_generation` = NEW.`acquisition_generation`
     AND `status` = 'failed'
     AND `status_code` = 'transcription_failed'
     AND `recovery_action` = 'retry_later'
     AND json_array_length(`evidence_references_json`) = 2;
  SELECT CASE
    WHEN changes() = 1 THEN NULL
    ELSE RAISE(ABORT, 'pilot speech parent recovery rejected')
  END;
END;
--> statement-breakpoint
CREATE TABLE `pilot_provider_visual_recoveries` (
  `runtime_stage` text NOT NULL,
  `import_id` text NOT NULL,
  `acquisition_generation` integer NOT NULL,
  `original_dispatch_id` text NOT NULL,
  `recovery_dispatch_id` text NOT NULL,
  `created_at` text NOT NULL,
  PRIMARY KEY (`runtime_stage`, `original_dispatch_id`),
  CONSTRAINT `pilot_provider_visual_recoveries_import_generation_fk`
    FOREIGN KEY (`import_id`, `acquisition_generation`)
    REFERENCES `recipe_imports`(`id`, `acquisition_generation`)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT `pilot_provider_visual_recoveries_original_dispatch_fk`
    FOREIGN KEY (`runtime_stage`, `original_dispatch_id`)
    REFERENCES `pilot_provider_budget_dispatches`(`runtime_stage`, `dispatch_id`)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT `pilot_provider_visual_recoveries_stage_check`
    CHECK (`runtime_stage` = 'pilot-gaia-118'),
  CONSTRAINT `pilot_provider_visual_recoveries_generation_check`
    CHECK (
      typeof(`acquisition_generation`) = 'integer'
      AND `acquisition_generation` >= 0
      AND `acquisition_generation` <= 9007199254740991
    ),
  CONSTRAINT `pilot_provider_visual_recoveries_dispatch_check`
    CHECK (
      length(`original_dispatch_id`) BETWEEN 1 AND 100
      AND length(`recovery_dispatch_id`) BETWEEN 1 AND 100
      AND instr(`original_dispatch_id`, ':recovery:1') = 0
      AND `recovery_dispatch_id` =
            `original_dispatch_id` || ':recovery:1'
    )
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pilot_provider_visual_recoveries_recovery_dispatch_unique`
  ON `pilot_provider_visual_recoveries` (
    `runtime_stage`,
    `recovery_dispatch_id`
  );
--> statement-breakpoint
CREATE TRIGGER `pilot_provider_visual_recoveries_immutable_update`
BEFORE UPDATE ON `pilot_provider_visual_recoveries`
BEGIN
  SELECT RAISE(ABORT, 'pilot provider visual recovery is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `pilot_provider_visual_recoveries_immutable_delete`
BEFORE DELETE ON `pilot_provider_visual_recoveries`
BEGIN
  SELECT RAISE(ABORT, 'pilot provider visual recovery is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `pilot_provider_visual_recoveries_prepare`
AFTER INSERT ON `pilot_provider_visual_recoveries`
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
        FROM `pilot_provider_budget_reconciliations` AS audit
        JOIN `pilot_provider_budget_dispatches` AS dispatch
          ON dispatch.`runtime_stage` = audit.`runtime_stage`
         AND dispatch.`dispatch_id` = audit.`dispatch_id`
        JOIN `pilot_provider_stage_budget` AS stage
          ON stage.`runtime_stage` = audit.`runtime_stage`
        JOIN `import_provider_terminal_checkpoints` AS checkpoint
          ON checkpoint.`import_id` = NEW.`import_id`
         AND checkpoint.`acquisition_generation` =
               NEW.`acquisition_generation`
         AND checkpoint.`provider_stage` = 'visual'
         AND checkpoint.`ownership_id` = NEW.`original_dispatch_id`
         AND checkpoint.`failure_code` = 'visual_extraction_failed'
        JOIN `import_visual_evidence` AS visual
          ON visual.`import_id` = checkpoint.`import_id`
         AND visual.`acquisition_generation` =
               checkpoint.`acquisition_generation`
         AND visual.`dispatch_id` = checkpoint.`ownership_id`
         AND visual.`state` = 'failed'
         AND visual.`failure_code` = 'visual_extraction_failed'
        JOIN `recipe_imports` AS parent
          ON parent.`id` = checkpoint.`import_id`
         AND parent.`acquisition_generation` =
               checkpoint.`acquisition_generation`
         AND parent.`status` = 'transcribed'
         AND parent.`status_code` IS NULL
         AND parent.`recovery_action` IS NULL
         AND json_array_length(parent.`evidence_references_json`) = 3
        JOIN `import_transcriptions` AS transcription
          ON transcription.`import_id` = parent.`id`
         AND transcription.`acquisition_generation` =
               parent.`acquisition_generation`
         AND transcription.`state` = 'transcribed'
         AND transcription.`source_media_sha256` =
               visual.`source_media_sha256`
       WHERE audit.`runtime_stage` = NEW.`runtime_stage`
         AND audit.`dispatch_id` = NEW.`original_dispatch_id`
         AND audit.`actual_cost_was_unknown` = 1
         AND audit.`authority` = 'authenticated_operator'
         AND dispatch.`state` = 'settled_unknown'
         AND dispatch.`provider_stage_id` = 'visual-evidence'
         AND dispatch.`actual_cost_micro_usd` IS NULL
         AND dispatch.`maximum_cost_micro_usd` =
               audit.`conservative_charge_micro_usd`
         AND stage.`state` = 'open'
         AND stage.`reserved_micro_usd` = 0
         AND stage.`invoking_dispatch_id` IS NULL
         AND stage.`poison_dispatch_id` IS NULL
         AND stage.`settled_micro_usd` < stage.`budget_cap_micro_usd`
         AND NOT EXISTS (
           SELECT 1
             FROM `import_recipe_extractions` AS recipe
            WHERE recipe.`import_id` = parent.`id`
              AND recipe.`acquisition_generation` =
                    parent.`acquisition_generation`
         )
    )
    THEN RAISE(ABORT, 'pilot provider visual recovery preconditions rejected')
  END;

  DELETE FROM `import_visual_evidence`
   WHERE `import_id` = NEW.`import_id`
     AND `acquisition_generation` = NEW.`acquisition_generation`
     AND `dispatch_id` = NEW.`original_dispatch_id`
     AND `state` = 'failed'
     AND `failure_code` = 'visual_extraction_failed';
  SELECT CASE
    WHEN changes() = 1 THEN NULL
    ELSE RAISE(ABORT, 'pilot visual projection recovery rejected')
  END;
END;
--> statement-breakpoint
CREATE TRIGGER `import_provider_terminal_checkpoints_fail_visual`
AFTER INSERT ON `import_provider_terminal_checkpoints`
WHEN NEW.`provider_stage` = 'visual'
BEGIN
  UPDATE `import_visual_evidence`
     SET `state` = 'failed',
         `failure_code` = iif(
           NEW.`failure_code` = 'outcome_unknown',
           'outcome_unknown',
           iif(
             NEW.`failure_code` = 'visual_extraction_failed',
             'visual_extraction_failed',
             'visual_evidence_failed'
           )
         ),
         `completed_at` = NEW.`completed_at`,
         `updated_at` = NEW.`completed_at`
   WHERE `import_id` = NEW.`import_id`
     AND `acquisition_generation` = NEW.`acquisition_generation`
     AND `dispatch_id` = NEW.`ownership_id`
     AND (
       `state` = 'dispatching'
       OR (
         NEW.`failure_code` = 'visual_extraction_failed'
         AND `state` = 'failed'
         AND `failure_code` = 'outcome_unknown'
       )
     );
  SELECT CASE
    WHEN EXISTS (
      SELECT 1
        FROM `import_visual_evidence`
       WHERE `import_id` = NEW.`import_id`
         AND `acquisition_generation` = NEW.`acquisition_generation`
         AND `dispatch_id` = NEW.`ownership_id`
         AND `state` = 'failed'
         AND `failure_code` = iif(
           NEW.`failure_code` = 'outcome_unknown',
           'outcome_unknown',
           iif(
             NEW.`failure_code` = 'visual_extraction_failed',
             'visual_extraction_failed',
             'visual_evidence_failed'
           )
         )
         AND `completed_at` = NEW.`completed_at`
    ) THEN NULL
    ELSE RAISE(ABORT, 'visual terminal checkpoint ownership rejected')
  END;
END;
--> statement-breakpoint
CREATE TABLE `pilot_provider_visual_second_recoveries` (
  `runtime_stage` text NOT NULL,
  `import_id` text NOT NULL,
  `acquisition_generation` integer NOT NULL,
  `original_dispatch_id` text NOT NULL,
  `first_recovery_dispatch_id` text NOT NULL,
  `recovery_dispatch_id` text NOT NULL,
  `created_at` text NOT NULL,
  PRIMARY KEY (`runtime_stage`, `original_dispatch_id`),
  CONSTRAINT `pilot_provider_visual_second_recoveries_import_generation_fk`
    FOREIGN KEY (`import_id`, `acquisition_generation`)
    REFERENCES `recipe_imports`(`id`, `acquisition_generation`)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT `pilot_provider_visual_second_recoveries_original_recovery_fk`
    FOREIGN KEY (`runtime_stage`, `original_dispatch_id`)
    REFERENCES `pilot_provider_visual_recoveries`(
      `runtime_stage`,
      `original_dispatch_id`
    )
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT `pilot_provider_visual_second_recoveries_first_recovery_fk`
    FOREIGN KEY (`runtime_stage`, `first_recovery_dispatch_id`)
    REFERENCES `pilot_provider_visual_recoveries`(
      `runtime_stage`,
      `recovery_dispatch_id`
    )
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT `pilot_provider_visual_second_recoveries_first_dispatch_fk`
    FOREIGN KEY (`runtime_stage`, `first_recovery_dispatch_id`)
    REFERENCES `pilot_provider_budget_dispatches`(
      `runtime_stage`,
      `dispatch_id`
    )
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT `pilot_provider_visual_second_recoveries_stage_check`
    CHECK (`runtime_stage` = 'pilot-gaia-118'),
  CONSTRAINT `pilot_provider_visual_second_recoveries_generation_check`
    CHECK (
      typeof(`acquisition_generation`) = 'integer'
      AND `acquisition_generation` >= 0
      AND `acquisition_generation` <= 9007199254740991
    ),
  CONSTRAINT `pilot_provider_visual_second_recoveries_dispatch_check`
    CHECK (
      length(`original_dispatch_id`) BETWEEN 1 AND 100
      AND length(`first_recovery_dispatch_id`) BETWEEN 1 AND 100
      AND length(`recovery_dispatch_id`) BETWEEN 1 AND 100
      AND instr(`original_dispatch_id`, ':recovery:') = 0
      AND `first_recovery_dispatch_id` =
            `original_dispatch_id` || ':recovery:1'
      AND `recovery_dispatch_id` =
            `original_dispatch_id` || ':recovery:2'
    )
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pilot_provider_visual_second_recoveries_recovery_dispatch_unique`
  ON `pilot_provider_visual_second_recoveries` (
    `runtime_stage`,
    `recovery_dispatch_id`
  );
--> statement-breakpoint
CREATE TRIGGER `pilot_provider_visual_second_recoveries_immutable_update`
BEFORE UPDATE ON `pilot_provider_visual_second_recoveries`
BEGIN
  SELECT RAISE(
    ABORT,
    'pilot provider second visual recovery is immutable'
  );
END;
--> statement-breakpoint
CREATE TRIGGER `pilot_provider_visual_second_recoveries_immutable_delete`
BEFORE DELETE ON `pilot_provider_visual_second_recoveries`
BEGIN
  SELECT RAISE(
    ABORT,
    'pilot provider second visual recovery is immutable'
  );
END;
--> statement-breakpoint
CREATE TRIGGER `pilot_provider_visual_second_recoveries_prepare`
AFTER INSERT ON `pilot_provider_visual_second_recoveries`
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
        FROM `pilot_provider_visual_recoveries` AS first_recovery
        JOIN `pilot_provider_budget_reconciliations` AS audit
          ON audit.`runtime_stage` = first_recovery.`runtime_stage`
         AND audit.`dispatch_id` =
               first_recovery.`recovery_dispatch_id`
        JOIN `pilot_provider_budget_dispatches` AS dispatch
          ON dispatch.`runtime_stage` = audit.`runtime_stage`
         AND dispatch.`dispatch_id` = audit.`dispatch_id`
        JOIN `pilot_provider_stage_budget` AS stage
          ON stage.`runtime_stage` = audit.`runtime_stage`
        JOIN `import_provider_terminal_checkpoints` AS checkpoint
          ON checkpoint.`import_id` = NEW.`import_id`
         AND checkpoint.`acquisition_generation` =
               NEW.`acquisition_generation`
         AND checkpoint.`provider_stage` = 'visual'
         AND checkpoint.`ownership_id` =
               NEW.`first_recovery_dispatch_id`
         AND checkpoint.`failure_code` IN (
               'visual_extraction_failed',
               'outcome_unknown'
             )
        JOIN `import_visual_evidence` AS visual
          ON visual.`import_id` = checkpoint.`import_id`
         AND visual.`acquisition_generation` =
               checkpoint.`acquisition_generation`
         AND visual.`dispatch_id` = checkpoint.`ownership_id`
         AND visual.`state` = 'failed'
         AND visual.`failure_code` = checkpoint.`failure_code`
         AND visual.`completed_at` = checkpoint.`completed_at`
        JOIN `recipe_imports` AS parent
          ON parent.`id` = checkpoint.`import_id`
         AND parent.`acquisition_generation` =
               checkpoint.`acquisition_generation`
         AND parent.`status` = 'transcribed'
         AND parent.`status_code` IS NULL
         AND parent.`recovery_action` IS NULL
         AND json_array_length(parent.`evidence_references_json`) = 3
        JOIN `import_transcriptions` AS transcription
          ON transcription.`import_id` = parent.`id`
         AND transcription.`acquisition_generation` =
               parent.`acquisition_generation`
         AND transcription.`state` = 'transcribed'
         AND transcription.`source_media_sha256` =
               visual.`source_media_sha256`
       WHERE first_recovery.`runtime_stage` = NEW.`runtime_stage`
         AND first_recovery.`import_id` = NEW.`import_id`
         AND first_recovery.`acquisition_generation` =
               NEW.`acquisition_generation`
         AND first_recovery.`original_dispatch_id` =
               NEW.`original_dispatch_id`
         AND first_recovery.`recovery_dispatch_id` =
               NEW.`first_recovery_dispatch_id`
         AND audit.`actual_cost_was_unknown` = 1
         AND audit.`authority` = 'authenticated_operator'
         AND dispatch.`state` = 'settled_unknown'
         AND dispatch.`provider_stage_id` = 'visual-evidence'
         AND dispatch.`actual_cost_micro_usd` IS NULL
         AND dispatch.`maximum_cost_micro_usd` =
               audit.`conservative_charge_micro_usd`
         AND stage.`state` = 'open'
         AND stage.`reserved_micro_usd` = 0
         AND stage.`invoking_dispatch_id` IS NULL
         AND stage.`poison_dispatch_id` IS NULL
         AND stage.`settled_micro_usd` < stage.`budget_cap_micro_usd`
         AND NOT EXISTS (
           SELECT 1
             FROM `import_recipe_extractions` AS recipe
            WHERE recipe.`import_id` = parent.`id`
              AND recipe.`acquisition_generation` =
                    parent.`acquisition_generation`
         )
    )
    THEN RAISE(
      ABORT,
      'pilot provider second visual recovery preconditions rejected'
    )
  END;

  DELETE FROM `import_visual_evidence`
   WHERE `import_id` = NEW.`import_id`
     AND `acquisition_generation` = NEW.`acquisition_generation`
     AND `dispatch_id` = NEW.`first_recovery_dispatch_id`
     AND `state` = 'failed'
     AND `failure_code` IN (
           'visual_extraction_failed',
           'outcome_unknown'
         );
  SELECT CASE
    WHEN changes() = 1 THEN NULL
    ELSE RAISE(ABORT, 'pilot second visual projection recovery rejected')
  END;
END;
--> statement-breakpoint
CREATE TABLE `pilot_provider_budget_conservative_settlements` (
  `actual_cost_was_unknown` integer NOT NULL,
  `authority` text NOT NULL,
  `conservative_charge_micro_usd` integer NOT NULL,
  `created_at` text NOT NULL,
  `dispatch_id` text NOT NULL,
  `runtime_stage` text NOT NULL,
  PRIMARY KEY (`runtime_stage`, `dispatch_id`),
  CONSTRAINT `pilot_provider_budget_conservative_settlements_dispatch_fk`
    FOREIGN KEY (`runtime_stage`, `dispatch_id`)
    REFERENCES `pilot_provider_budget_dispatches` (
      `runtime_stage`,
      `dispatch_id`
    )
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT `pilot_provider_budget_conservative_settlements_stage_check`
    CHECK (`runtime_stage` = 'pilot-gaia-118'),
  CONSTRAINT `pilot_provider_budget_conservative_settlements_charge_check`
    CHECK (`conservative_charge_micro_usd` = 100000),
  CONSTRAINT `pilot_provider_budget_conservative_settlements_unknown_check`
    CHECK (`actual_cost_was_unknown` = 1),
  CONSTRAINT `pilot_provider_budget_conservative_settlements_authority_check`
    CHECK (`authority` = 'schema_valid_provider_response')
);
--> statement-breakpoint
CREATE TRIGGER `pilot_provider_budget_conservative_settlements_immutable_update`
BEFORE UPDATE ON `pilot_provider_budget_conservative_settlements`
BEGIN
  SELECT RAISE(
    ABORT,
    'provider conservative settlement audit is immutable'
  );
END;
--> statement-breakpoint
CREATE TRIGGER `pilot_provider_budget_conservative_settlements_immutable_delete`
BEFORE DELETE ON `pilot_provider_budget_conservative_settlements`
BEGIN
  SELECT RAISE(
    ABORT,
    'provider conservative settlement audit is immutable'
  );
END;
--> statement-breakpoint

CREATE TABLE `import_recipe_executor_terminal_checkpoints` (
  `acquisition_generation` integer NOT NULL,
  `evidence_references_json` text NOT NULL,
  `import_id` text NOT NULL,
  `ownership_id` text NOT NULL,
  `checkpointed_at` text NOT NULL,
  PRIMARY KEY (`import_id`, `acquisition_generation`),
  CONSTRAINT `import_recipe_executor_terminal_checkpoints_import_generation_fk`
    FOREIGN KEY (`import_id`, `acquisition_generation`)
    REFERENCES `recipe_imports` (`id`, `acquisition_generation`)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT `import_recipe_executor_terminal_checkpoints_details_check`
    CHECK (
      json_valid(`evidence_references_json`)
      AND json_array_length(`evidence_references_json`) IN (0, 3)
      AND length(`ownership_id`) = 64
      AND `ownership_id` NOT GLOB '*[^0-9a-f]*'
    )
);
--> statement-breakpoint
CREATE TRIGGER `import_recipe_executor_terminal_checkpoints_immutable_update`
BEFORE UPDATE ON `import_recipe_executor_terminal_checkpoints`
BEGIN
  SELECT RAISE(ABORT, 'recipe executor terminal checkpoint is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `import_recipe_executor_terminal_checkpoints_immutable_delete`
BEFORE DELETE ON `import_recipe_executor_terminal_checkpoints`
BEGIN
  SELECT RAISE(ABORT, 'recipe executor terminal checkpoint is immutable');
END;
--> statement-breakpoint
CREATE TABLE `pilot_provider_recipe_replay_values` (
  `created_at` text NOT NULL,
  `dispatch_id` text NOT NULL,
  `evidence_fingerprint` text NOT NULL,
  `expires_at` text NOT NULL,
  `generation` integer NOT NULL,
  `import_id` text NOT NULL,
  `runtime_stage` text NOT NULL,
  `value_json` text NOT NULL,
  `value_sha256` text NOT NULL,
  PRIMARY KEY (`runtime_stage`, `dispatch_id`),
  CONSTRAINT `pilot_provider_recipe_replay_values_audit_fk`
    FOREIGN KEY (`runtime_stage`, `dispatch_id`)
    REFERENCES `pilot_provider_budget_conservative_settlements` (
      `runtime_stage`,
      `dispatch_id`
    )
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT `pilot_provider_recipe_replay_values_stage_check`
    CHECK (`runtime_stage` = 'pilot-gaia-118'),
  CONSTRAINT `pilot_provider_recipe_replay_values_dispatch_check`
    CHECK (
      `dispatch_id` =
        'recipe:' || `import_id` || ':' || `generation` || ':' ||
        `evidence_fingerprint`
      OR `dispatch_id` =
        'recipe:' || `import_id` || ':' || `generation` || ':' ||
        `evidence_fingerprint` || ':recovery:1'
      OR `dispatch_id` =
        'recipe:' || `import_id` || ':' || `generation` || ':' ||
        `evidence_fingerprint` || ':recovery:2'
      OR `dispatch_id` =
        'recipe:' || `import_id` || ':' || `generation` || ':' ||
        `evidence_fingerprint` || ':recovery:3'
      OR `dispatch_id` =
        'recipe:' || `import_id` || ':' || `generation` || ':' ||
        `evidence_fingerprint` || ':recovery:4'
      OR `dispatch_id` =
        'recipe:' || `import_id` || ':' || `generation` || ':' ||
        `evidence_fingerprint` || ':recovery:5'
      OR `dispatch_id` =
        'recipe:' || `import_id` || ':' || `generation` || ':' ||
        `evidence_fingerprint` || ':recovery:6'
      OR `dispatch_id` =
        'recipe:' || `import_id` || ':' || `generation` || ':' ||
        `evidence_fingerprint` || ':recovery:7'
      OR `dispatch_id` =
        'recipe:' || `import_id` || ':' || `generation` || ':' ||
        `evidence_fingerprint` || ':recovery:8'
    ),
  CONSTRAINT `pilot_provider_recipe_replay_values_identity_check`
    CHECK (
      length(`import_id`) BETWEEN 1 AND 128
      AND `generation` >= 1
      AND length(`evidence_fingerprint`) = 64
      AND `evidence_fingerprint` NOT GLOB '*[^0-9a-f]*'
    ),
  CONSTRAINT `pilot_provider_recipe_replay_values_value_check`
    CHECK (
      length(CAST(`value_json` AS BLOB)) BETWEEN 1 AND 262144
      AND json_valid(`value_json`)
      AND length(`value_sha256`) = 64
      AND `value_sha256` NOT GLOB '*[^0-9a-f]*'
    ),
  CONSTRAINT `pilot_provider_recipe_replay_values_lifecycle_check`
    CHECK (
      `expires_at` =
        strftime('%Y-%m-%dT%H:%M:%fZ', `created_at`, '+7 days')
    )
);
--> statement-breakpoint
CREATE TRIGGER `pilot_provider_recipe_replay_values_immutable_update`
BEFORE UPDATE ON `pilot_provider_recipe_replay_values`
BEGIN
  SELECT RAISE(ABORT, 'provider recipe replay value is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `pilot_provider_recipe_replay_values_guarded_delete`
BEFORE DELETE ON `pilot_provider_recipe_replay_values`
WHEN
  OLD.`expires_at` >
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  AND NOT EXISTS (
    SELECT 1
      FROM `import_recipe_extractions`
     WHERE `import_id` = OLD.`import_id`
       AND `acquisition_generation` = OLD.`generation`
       AND `evidence_fingerprint` = OLD.`evidence_fingerprint`
       AND `state` IN ('needs_review', 'failed')
  )
BEGIN
  SELECT RAISE(ABORT, 'provider recipe replay value remains live');
END;
--> statement-breakpoint
CREATE TRIGGER `pilot_provider_recipe_replay_values_expired_cleanup`
AFTER INSERT ON `pilot_provider_recipe_replay_values`
BEGIN
  DELETE FROM `pilot_provider_recipe_replay_values`
   WHERE `expires_at` <=
         strftime('%Y-%m-%dT%H:%M:%fZ', 'now');
END;
--> statement-breakpoint
CREATE TRIGGER `pilot_provider_recipe_replay_values_budget_insert_cleanup`
AFTER INSERT ON `pilot_provider_budget_dispatches`
BEGIN
  DELETE FROM `pilot_provider_recipe_replay_values`
   WHERE `expires_at` <=
         strftime('%Y-%m-%dT%H:%M:%fZ', 'now');
END;
--> statement-breakpoint
CREATE TRIGGER `pilot_provider_recipe_replay_values_budget_update_cleanup`
AFTER UPDATE ON `pilot_provider_budget_dispatches`
BEGIN
  DELETE FROM `pilot_provider_recipe_replay_values`
   WHERE `expires_at` <=
         strftime('%Y-%m-%dT%H:%M:%fZ', 'now');
END;
--> statement-breakpoint
CREATE TRIGGER `import_recipe_extractions_cleanup_replay_insert`
AFTER INSERT ON `import_recipe_extractions`
WHEN NEW.`state` IN ('needs_review', 'failed')
BEGIN
  DELETE FROM `pilot_provider_recipe_replay_values`
   WHERE `import_id` = NEW.`import_id`
     AND `generation` = NEW.`acquisition_generation`
     AND `evidence_fingerprint` = NEW.`evidence_fingerprint`;
END;
--> statement-breakpoint
CREATE TRIGGER `import_recipe_extractions_cleanup_replay_update`
AFTER UPDATE OF `state` ON `import_recipe_extractions`
WHEN NEW.`state` IN ('needs_review', 'failed')
BEGIN
  DELETE FROM `pilot_provider_recipe_replay_values`
   WHERE `import_id` = NEW.`import_id`
     AND `generation` = NEW.`acquisition_generation`
     AND `evidence_fingerprint` = NEW.`evidence_fingerprint`;
END;
--> statement-breakpoint
CREATE TRIGGER `import_provider_terminal_checkpoints_fail_recipe`
AFTER INSERT ON `import_provider_terminal_checkpoints`
WHEN NEW.`provider_stage` = 'recipe'
BEGIN
  UPDATE `import_recipe_extractions`
     SET `state` = 'failed',
         `failure_code` = 'provider_error',
         `completed_at` = NEW.`completed_at`,
         `updated_at` = NEW.`completed_at`
   WHERE `import_id` = NEW.`import_id`
     AND `acquisition_generation` = NEW.`acquisition_generation`
     AND `extraction_fingerprint` = NEW.`ownership_id`
     AND `state` = 'dispatching';
  SELECT CASE
    WHEN changes() = 1 THEN NULL
    WHEN EXISTS (
      SELECT 1
        FROM `import_recipe_extractions`
       WHERE `import_id` = NEW.`import_id`
         AND `acquisition_generation` = NEW.`acquisition_generation`
         AND `extraction_fingerprint` = NEW.`ownership_id`
         AND `state` = 'failed'
         AND (
           `failure_code` = NEW.`failure_code`
           OR (
             `failure_code` = 'provider_error'
             AND NEW.`failure_code` = 'outcome_unknown'
           )
         )
         AND `completed_at` = NEW.`completed_at`
    ) THEN NULL
    ELSE RAISE(ABORT, 'recipe terminal checkpoint ownership rejected')
  END;

  INSERT INTO `import_recipe_executor_terminal_checkpoints` (
    `acquisition_generation`,
    `evidence_references_json`,
    `import_id`,
    `ownership_id`,
    `checkpointed_at`
  )
  SELECT
    parent.`acquisition_generation`,
    parent.`evidence_references_json`,
    parent.`id`,
    NEW.`ownership_id`,
    NEW.`completed_at`
  FROM `recipe_imports` AS parent
  WHERE parent.`id` = NEW.`import_id`
    AND parent.`acquisition_generation` = NEW.`acquisition_generation`
    AND (
      (
        parent.`status` = 'queued'
        AND json_array_length(parent.`evidence_references_json`) = 0
      ) OR (
        parent.`status` = 'transcribed'
        AND json_array_length(parent.`evidence_references_json`) = 3
      )
    )
  ON CONFLICT (`import_id`, `acquisition_generation`) DO NOTHING;

  SELECT CASE
    WHEN changes() = 1 THEN NULL
    WHEN EXISTS (
      SELECT 1
        FROM `import_recipe_executor_terminal_checkpoints` AS projection
        JOIN `recipe_imports` AS parent
          ON parent.`id` = projection.`import_id`
         AND parent.`acquisition_generation` =
               projection.`acquisition_generation`
       WHERE projection.`import_id` = NEW.`import_id`
         AND projection.`acquisition_generation` =
               NEW.`acquisition_generation`
         AND projection.`ownership_id` = NEW.`ownership_id`
         AND projection.`checkpointed_at` = NEW.`completed_at`
         AND projection.`evidence_references_json` =
               parent.`evidence_references_json`
    ) THEN NULL
    ELSE RAISE(ABORT, 'recipe executor terminal checkpoint rejected')
  END;
END;
--> statement-breakpoint

CREATE TABLE `import_batch_items` (
  `id` text PRIMARY KEY NOT NULL,
  `batch_id` text NOT NULL,
  `idempotency_key` text NOT NULL,
  `source_kind` text DEFAULT 'tiktok' NOT NULL,
  `source_canonical_id` text NOT NULL,
  `source_identity_kind` text DEFAULT 'video' NOT NULL,
  `delivery_mode` text DEFAULT 'ordinary' NOT NULL,
  `correlation_json` text,
  `status` text DEFAULT 'queued' NOT NULL,
  `failure_code` text,
  `attempt_count` integer DEFAULT 0 NOT NULL,
  `intent_id` text,
  `disposition` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  CONSTRAINT `import_batch_items_batch_fk`
    FOREIGN KEY (`batch_id`) REFERENCES `import_batches`(`id`) ON DELETE CASCADE,
  CONSTRAINT `import_batch_items_intent_fk`
    FOREIGN KEY (`intent_id`) REFERENCES `recipe_imports`(`id`) ON DELETE RESTRICT,
  CONSTRAINT `import_batch_items_batch_id_idempotency_key_unique`
    UNIQUE (`batch_id`, `idempotency_key`),
  CONSTRAINT `import_batch_items_source_kind_check`
    CHECK (`source_kind` = 'tiktok'),
  CONSTRAINT `import_batch_items_source_identity_kind_check`
    CHECK (`source_identity_kind` IN ('carousel', 'video')),
  CONSTRAINT `import_batch_items_delivery_mode_check`
    CHECK (`delivery_mode` IN ('ordinary', 'poison')),
  CONSTRAINT `import_batch_items_correlation_check`
    CHECK ((`delivery_mode` = 'poison' AND json_valid(`correlation_json`))
      OR (`delivery_mode` = 'ordinary' AND `correlation_json` IS NULL)),
  CONSTRAINT `import_batch_items_status_check`
    CHECK (`status` IN ('queued', 'running', 'succeeded', 'failed')),
  CONSTRAINT `import_batch_items_attempt_count_check`
    CHECK (typeof(`attempt_count`) = 'integer' AND `attempt_count` >= 0),
  CONSTRAINT `import_batch_items_failure_check`
    CHECK ((`status` = 'failed' AND `failure_code` IS NOT NULL)
      OR (`status` <> 'failed' AND `failure_code` IS NULL)),
  CONSTRAINT `import_batch_items_success_check`
    CHECK ((`status` = 'succeeded' AND `intent_id` IS NOT NULL
      AND `disposition` IN ('created', 'idempotency_replay'))
      OR (`status` <> 'succeeded' AND `intent_id` IS NULL
      AND `disposition` IS NULL))
);
--> statement-breakpoint

CREATE TABLE `import_dead_letters` (
  `item_id` text PRIMARY KEY NOT NULL,
  `failure_code` text NOT NULL,
  `correlation_json` text NOT NULL,
  `replay_state` text DEFAULT 'ready' NOT NULL,
  `replay_claim_id` text,
  `replay_claim_expires_at_epoch_milliseconds` integer,
  `replay_intent_id` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  CONSTRAINT `import_dead_letters_item_fk`
    FOREIGN KEY (`item_id`) REFERENCES `import_batch_items`(`id`) ON DELETE CASCADE,
  CONSTRAINT `import_dead_letters_replay_intent_fk`
    FOREIGN KEY (`replay_intent_id`) REFERENCES `recipe_imports`(`id`) ON DELETE RESTRICT,
  CONSTRAINT `import_dead_letters_failure_code_check`
    CHECK (`failure_code` IN (
      'idempotency_conflict', 'intent_not_found', 'intent_redirected',
      'intent_transition_conflict', 'intent_transition_rejected',
      'persistence_corrupt', 'persistence_unavailable',
      'workflow_start_unavailable'
    )),
  CONSTRAINT `import_dead_letters_correlation_json_check`
    CHECK (json_valid(`correlation_json`)),
  CONSTRAINT `import_dead_letters_replay_state_check`
    CHECK (`replay_state` IN ('ready', 'claimed', 'replayed')),
  CONSTRAINT `import_dead_letters_replay_claim_check`
    CHECK ((`replay_state` = 'ready' AND `replay_claim_id` IS NULL
      AND `replay_claim_expires_at_epoch_milliseconds` IS NULL)
      OR (`replay_state` = 'claimed' AND `replay_claim_id` IS NOT NULL
      AND typeof(`replay_claim_expires_at_epoch_milliseconds`) = 'integer'
      AND `replay_claim_expires_at_epoch_milliseconds` >= 0)
      OR (`replay_state` = 'replayed' AND `replay_claim_id` IS NOT NULL
      AND `replay_claim_expires_at_epoch_milliseconds` IS NULL)),
  CONSTRAINT `import_dead_letters_replay_intent_check`
    CHECK ((`replay_state` = 'replayed' AND `replay_intent_id` IS NOT NULL)
      OR (`replay_state` <> 'replayed' AND `replay_intent_id` IS NULL))
);
--> statement-breakpoint
CREATE TABLE `pilot_provider_recipe_recovery_attempts` (
  `runtime_stage` text NOT NULL,
  `import_id` text NOT NULL,
  `acquisition_generation` integer NOT NULL,
  `recovery_ordinal` integer NOT NULL,
  `root_dispatch_id` text NOT NULL,
  `predecessor_dispatch_id` text NOT NULL,
  `current_dispatch_id` text NOT NULL,
  `root_extraction_fingerprint` text NOT NULL,
  `predecessor_extraction_fingerprint` text NOT NULL,
  `current_extraction_fingerprint` text NOT NULL,
  `predecessor_outcome` text NOT NULL,
  `terminal_checkpoint_completed_at` text NOT NULL,
  `predecessor_reconciliation_created_at` text NOT NULL,
  `evidence_fingerprint` text NOT NULL,
  `source_media_sha256` text NOT NULL,
  `transcript_sha256` text NOT NULL,
  `visual_manifest_sha256` text NOT NULL,
  `evidence_references_json` text NOT NULL,
  `created_at` text NOT NULL,
  PRIMARY KEY (
    `runtime_stage`,
    `import_id`,
    `acquisition_generation`,
    `recovery_ordinal`
  ),
  CONSTRAINT `pilot_provider_recipe_recovery_attempts_import_fk`
    FOREIGN KEY (`import_id`, `acquisition_generation`)
    REFERENCES `recipe_imports` (`id`, `acquisition_generation`)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT `pilot_provider_recipe_recovery_attempts_root_dispatch_fk`
    FOREIGN KEY (`runtime_stage`, `root_dispatch_id`)
    REFERENCES `pilot_provider_budget_dispatches` (
      `runtime_stage`,
      `dispatch_id`
    )
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT `pilot_provider_recipe_recovery_attempts_root_extraction_fk`
    FOREIGN KEY (`root_extraction_fingerprint`)
    REFERENCES `import_recipe_extractions` (`extraction_fingerprint`)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT `pilot_provider_recipe_recovery_attempts_predecessor_extraction_fk`
    FOREIGN KEY (`predecessor_extraction_fingerprint`)
    REFERENCES `import_recipe_extractions` (`extraction_fingerprint`)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT `pilot_provider_recipe_recovery_attempts_stage_check`
    CHECK (`runtime_stage` = 'pilot-gaia-118'),
  CONSTRAINT `pilot_provider_recipe_recovery_attempts_identity_check`
    CHECK (
      `recovery_ordinal` BETWEEN 1 AND 8
      AND instr(`root_dispatch_id`, ':recovery:') = 0
      AND `current_dispatch_id` =
            `root_dispatch_id` || ':recovery:' || `recovery_ordinal`
      AND (
        (`recovery_ordinal` = 1
          AND `predecessor_dispatch_id` = `root_dispatch_id`
          AND `predecessor_extraction_fingerprint` =
                `root_extraction_fingerprint`)
        OR
        (`recovery_ordinal` > 1
          AND `predecessor_dispatch_id` =
                `root_dispatch_id` || ':recovery:' ||
                (`recovery_ordinal` - 1))
      )
      AND `current_extraction_fingerprint` <>
            `predecessor_extraction_fingerprint`
      AND `predecessor_outcome` = 'outcome_unknown'
      AND length(`evidence_fingerprint`) = 64
      AND `evidence_fingerprint` NOT GLOB '*[^0-9a-f]*'
      AND length(`source_media_sha256`) = 64
      AND `source_media_sha256` NOT GLOB '*[^0-9a-f]*'
      AND length(`root_extraction_fingerprint`) = 64
      AND `root_extraction_fingerprint` NOT GLOB '*[^0-9a-f]*'
      AND length(`predecessor_extraction_fingerprint`) = 64
      AND `predecessor_extraction_fingerprint` NOT GLOB '*[^0-9a-f]*'
      AND length(`current_extraction_fingerprint`) = 64
      AND `current_extraction_fingerprint` NOT GLOB '*[^0-9a-f]*'
      AND length(`transcript_sha256`) = 64
      AND `transcript_sha256` NOT GLOB '*[^0-9a-f]*'
      AND length(`visual_manifest_sha256`) = 64
      AND `visual_manifest_sha256` NOT GLOB '*[^0-9a-f]*'
      AND json_valid(`evidence_references_json`)
      AND json_array_length(`evidence_references_json`) = 3
    )
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pilot_provider_recipe_recovery_attempts_dispatch_unique`
  ON `pilot_provider_recipe_recovery_attempts` (
    `runtime_stage`,
    `current_dispatch_id`
  );
--> statement-breakpoint
CREATE UNIQUE INDEX `pilot_provider_recipe_recovery_attempts_extraction_unique`
  ON `pilot_provider_recipe_recovery_attempts` (
    `current_extraction_fingerprint`
  );
--> statement-breakpoint
CREATE INDEX `pilot_provider_recipe_recovery_attempts_cursor_index`
  ON `pilot_provider_recipe_recovery_attempts` (
    `runtime_stage`,
    `import_id`,
    `acquisition_generation`,
    `recovery_ordinal` DESC
  );
--> statement-breakpoint
CREATE TRIGGER `pilot_provider_recipe_recovery_attempts_immutable_update`
BEFORE UPDATE ON `pilot_provider_recipe_recovery_attempts`
BEGIN
  SELECT RAISE(ABORT, 'pilot provider recipe recovery attempt is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `pilot_provider_recipe_recovery_attempts_immutable_delete`
BEFORE DELETE ON `pilot_provider_recipe_recovery_attempts`
BEGIN
  SELECT RAISE(ABORT, 'pilot provider recipe recovery attempt is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `pilot_provider_recipe_recovery_attempts_ancestry_insert`
AFTER INSERT ON `pilot_provider_recipe_recovery_attempts`
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
        FROM `recipe_imports` AS parent
        JOIN `import_transcriptions` AS transcript
          ON transcript.`import_id` = parent.`id`
         AND transcript.`acquisition_generation` =
               parent.`acquisition_generation`
         AND transcript.`state` = 'transcribed'
         AND transcript.`transcript_sha256` = NEW.`transcript_sha256`
         AND transcript.`source_media_sha256` = NEW.`source_media_sha256`
        JOIN `import_visual_evidence` AS visual
          ON visual.`import_id` = parent.`id`
         AND visual.`acquisition_generation` =
               parent.`acquisition_generation`
         AND visual.`state` = 'completed'
         AND visual.`manifest_sha256` = NEW.`visual_manifest_sha256`
         AND visual.`source_media_sha256` = NEW.`source_media_sha256`
        JOIN `import_recipe_extractions` AS root_extraction
          ON root_extraction.`import_id` = parent.`id`
         AND root_extraction.`acquisition_generation` =
               parent.`acquisition_generation`
         AND root_extraction.`extraction_fingerprint` =
               NEW.`root_extraction_fingerprint`
         AND root_extraction.`evidence_fingerprint` =
               NEW.`evidence_fingerprint`
         AND root_extraction.`state` = 'failed'
         AND root_extraction.`failure_code` = 'provider_error'
        JOIN `import_recipe_extractions` AS predecessor_extraction
          ON predecessor_extraction.`import_id` = parent.`id`
         AND predecessor_extraction.`acquisition_generation` =
               parent.`acquisition_generation`
         AND predecessor_extraction.`extraction_fingerprint` =
               NEW.`predecessor_extraction_fingerprint`
         AND predecessor_extraction.`evidence_fingerprint` =
               NEW.`evidence_fingerprint`
         AND predecessor_extraction.`state` = 'failed'
         AND predecessor_extraction.`failure_code` = 'provider_error'
         AND predecessor_extraction.`is_current` = 0
        JOIN `import_provider_terminal_checkpoints` AS checkpoint
          ON checkpoint.`import_id` = parent.`id`
         AND checkpoint.`acquisition_generation` =
               parent.`acquisition_generation`
         AND checkpoint.`provider_stage` = 'recipe'
         AND checkpoint.`ownership_id` =
               NEW.`root_extraction_fingerprint`
         AND checkpoint.`failure_code` = NEW.`predecessor_outcome`
         AND checkpoint.`completed_at` =
               NEW.`terminal_checkpoint_completed_at`
         AND checkpoint.`completed_at` = root_extraction.`completed_at`
        JOIN `import_recipe_executor_terminal_checkpoints` AS projection
          ON projection.`import_id` = parent.`id`
         AND projection.`acquisition_generation` =
               parent.`acquisition_generation`
         AND projection.`ownership_id` = checkpoint.`ownership_id`
         AND projection.`checkpointed_at` = checkpoint.`completed_at`
         AND projection.`evidence_references_json` =
               parent.`evidence_references_json`
        JOIN `pilot_provider_budget_dispatches` AS root_dispatch
          ON root_dispatch.`runtime_stage` = NEW.`runtime_stage`
         AND root_dispatch.`dispatch_id` = NEW.`root_dispatch_id`
         AND root_dispatch.`provider_stage_id` = 'recipe-extraction'
        JOIN `pilot_provider_budget_dispatches` AS predecessor_dispatch
          ON predecessor_dispatch.`runtime_stage` = NEW.`runtime_stage`
         AND predecessor_dispatch.`dispatch_id` =
               NEW.`predecessor_dispatch_id`
         AND predecessor_dispatch.`provider_stage_id` = 'recipe-extraction'
         AND predecessor_dispatch.`state` = 'settled_unknown'
         AND predecessor_dispatch.`actual_cost_micro_usd` IS NULL
         AND predecessor_dispatch.`maximum_cost_micro_usd` = 100000
        JOIN `pilot_provider_budget_reconciliations` AS audit
          ON audit.`runtime_stage` = predecessor_dispatch.`runtime_stage`
         AND audit.`dispatch_id` = predecessor_dispatch.`dispatch_id`
         AND audit.`actual_cost_was_unknown` = 1
         AND audit.`authority` = 'authenticated_operator'
         AND audit.`conservative_charge_micro_usd` = 100000
         AND audit.`created_at` =
               NEW.`predecessor_reconciliation_created_at`
       WHERE parent.`id` = NEW.`import_id`
         AND parent.`acquisition_generation` =
               NEW.`acquisition_generation`
         AND parent.`evidence_references_json` =
               NEW.`evidence_references_json`
         AND (
           (NEW.`recovery_ordinal` = 1
             AND root_dispatch.`run_id` =
                   'gaia-118:' || NEW.`import_id`)
           OR
           (NEW.`recovery_ordinal` > 1
             AND predecessor_dispatch.`run_id` =
                   'gaia-118:recipe-recovery:' || NEW.`import_id`
             AND EXISTS (
               SELECT 1
                 FROM `pilot_provider_recipe_recovery_attempts` AS predecessor
                WHERE predecessor.`runtime_stage` = NEW.`runtime_stage`
                  AND predecessor.`import_id` = NEW.`import_id`
                  AND predecessor.`acquisition_generation` =
                        NEW.`acquisition_generation`
                  AND predecessor.`recovery_ordinal` =
                        NEW.`recovery_ordinal` - 1
                  AND predecessor.`root_dispatch_id` =
                        NEW.`root_dispatch_id`
                  AND predecessor.`current_dispatch_id` =
                        NEW.`predecessor_dispatch_id`
                  AND predecessor.`root_extraction_fingerprint` =
                        NEW.`root_extraction_fingerprint`
                  AND predecessor.`current_extraction_fingerprint` =
                        NEW.`predecessor_extraction_fingerprint`
                  AND predecessor.`evidence_fingerprint` =
                        NEW.`evidence_fingerprint`
                  AND predecessor.`source_media_sha256` =
                        NEW.`source_media_sha256`
                  AND predecessor.`transcript_sha256` =
                        NEW.`transcript_sha256`
                  AND predecessor.`visual_manifest_sha256` =
                        NEW.`visual_manifest_sha256`
                  AND predecessor.`evidence_references_json` =
                        NEW.`evidence_references_json`
             ))
         )
    )
    THEN RAISE(
      ABORT,
      'pilot provider recipe recovery attempt ancestry rejected'
    )
  END;
END;
--> statement-breakpoint
CREATE TRIGGER `pilot_provider_recipe_recovery_attempts_admission_insert`
AFTER INSERT ON `pilot_provider_recipe_recovery_attempts`
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
        FROM `recipe_imports` AS parent
        JOIN `pilot_provider_stage_budget` AS stage
          ON stage.`runtime_stage` = NEW.`runtime_stage`
         AND stage.`state` = 'open'
         AND stage.`reserved_micro_usd` = 0
         AND stage.`invoking_dispatch_id` IS NULL
         AND stage.`poison_dispatch_id` IS NULL
         AND stage.`settled_micro_usd` + 100000 <=
               stage.`budget_cap_micro_usd`
        JOIN `pilot_provider_budget_dispatches` AS predecessor_dispatch
          ON predecessor_dispatch.`runtime_stage` = NEW.`runtime_stage`
         AND predecessor_dispatch.`dispatch_id` =
               NEW.`predecessor_dispatch_id`
         AND predecessor_dispatch.`state` = 'settled_unknown'
         AND predecessor_dispatch.`actual_cost_micro_usd` IS NULL
        JOIN `pilot_provider_budget_reconciliations` AS audit
          ON audit.`runtime_stage` = predecessor_dispatch.`runtime_stage`
         AND audit.`dispatch_id` = predecessor_dispatch.`dispatch_id`
         AND audit.`actual_cost_was_unknown` = 1
         AND audit.`authority` = 'authenticated_operator'
         AND audit.`conservative_charge_micro_usd` = 100000
       WHERE parent.`id` = NEW.`import_id`
         AND parent.`acquisition_generation` =
               NEW.`acquisition_generation`
         AND parent.`status` = 'transcribed'
         AND parent.`status_code` IS NULL
         AND parent.`recovery_action` IS NULL
         AND parent.`evidence_references_json` =
               NEW.`evidence_references_json`
         AND NOT EXISTS (
           SELECT 1
             FROM `pilot_provider_recipe_replay_values` AS replay
            WHERE replay.`runtime_stage` = NEW.`runtime_stage`
              AND replay.`dispatch_id` = NEW.`predecessor_dispatch_id`
         )
         AND NOT EXISTS (
           SELECT 1
             FROM `pilot_provider_budget_dispatches` AS dispatched
            WHERE dispatched.`runtime_stage` = NEW.`runtime_stage`
              AND dispatched.`dispatch_id` = NEW.`current_dispatch_id`
         )
         AND NOT EXISTS (
           SELECT 1
             FROM `import_recipe_extractions` AS extraction
            WHERE extraction.`extraction_fingerprint` =
                  NEW.`current_extraction_fingerprint`
         )
    )
    THEN RAISE(
      ABORT,
      'pilot provider recipe recovery attempt admission rejected'
    )
  END;
END;
--> statement-breakpoint
CREATE TRIGGER `pilot_provider_recipe_recovery_budget_insert`
BEFORE INSERT ON `pilot_provider_budget_dispatches`
WHEN
  NEW.`provider_stage_id` = 'recipe-extraction'
  AND instr(NEW.`dispatch_id`, ':recovery:') > 0
BEGIN
  SELECT CASE
    WHEN NEW.`maximum_cost_micro_usd` <> 100000
      OR NOT EXISTS (
        SELECT 1
          FROM `pilot_provider_recipe_recovery_attempts` AS attempt
         WHERE attempt.`runtime_stage` = NEW.`runtime_stage`
           AND attempt.`current_dispatch_id` = NEW.`dispatch_id`
           AND NEW.`run_id` =
                 'gaia-118:recipe-recovery:' || attempt.`import_id`
      )
    THEN RAISE(
      ABORT,
      'pilot provider recipe recovery budget authority rejected'
    )
  END;
END;
--> statement-breakpoint
CREATE UNIQUE INDEX `recipe_imports_household_live_canonical_unique`
  ON `recipe_imports` (`household_scope_id`, `resolved_canonical_source_id`)
  WHERE `resolved_canonical_source_id` IS NOT NULL
    AND `public_status` IN ('processing', 'requires_action', 'succeeded');
--> statement-breakpoint
CREATE INDEX `recipe_imports_household_id_index`
  ON `recipe_imports` (`household_scope_id`, `id`);
--> statement-breakpoint
CREATE INDEX `recipe_imports_redirect_target_index`
  ON `recipe_imports` (`redirected_to_import_id`);
--> statement-breakpoint
CREATE TRIGGER `recipe_imports_intent_identity_insert_guard`
BEFORE INSERT ON `recipe_imports`
WHEN NOT (
  length(NEW.`household_scope_id`) = 64
  AND NEW.`household_scope_id` NOT GLOB '*[^0-9a-f]*'
  AND length(NEW.`actor_id`) = 64
  AND NEW.`actor_id` NOT GLOB '*[^0-9a-f]*'
  AND typeof(NEW.`intent_version`) = 'integer'
  AND NEW.`intent_version` >= 1
  AND typeof(NEW.`execution_generation`) = 'integer'
  AND NEW.`execution_generation` >= 1
  AND (
    NEW.`transition_mutation_id` IS NULL
    OR (
      length(NEW.`transition_mutation_id`) = 64
      AND NEW.`transition_mutation_id` NOT GLOB '*[^0-9a-f]*'
    )
  )
  AND (
    NEW.`transition_command_digest` IS NULL
    OR (
      length(NEW.`transition_command_digest`) = 64
      AND NEW.`transition_command_digest` NOT GLOB '*[^0-9a-f]*'
    )
  )
  AND (
    NEW.`transition_actor_category` IS NULL
    OR NEW.`transition_actor_category` IN (
      'household_member', 'system', 'support'
    )
  )
  AND (
    NEW.`transition_actor_identity_hash` IS NULL
    OR (
      length(NEW.`transition_actor_identity_hash`) = 64
      AND NEW.`transition_actor_identity_hash` NOT GLOB '*[^0-9a-f]*'
    )
  )
  AND (
    NEW.`transition_provenance_version` IS NULL
    OR (
      typeof(NEW.`transition_provenance_version`) = 'integer'
      AND NEW.`transition_provenance_version` >= 1
    )
  )
)
BEGIN
  SELECT RAISE(ABORT, 'invalid recipe import intent household scope, actor, version, or generation');
END;
--> statement-breakpoint
CREATE TRIGGER `recipe_imports_intent_identity_update_guard`
BEFORE UPDATE OF `household_scope_id`, `actor_id`, `intent_version`, `execution_generation`
ON `recipe_imports`
WHEN NOT (
  length(NEW.`household_scope_id`) = 64
  AND NEW.`household_scope_id` NOT GLOB '*[^0-9a-f]*'
  AND length(NEW.`actor_id`) = 64
  AND NEW.`actor_id` NOT GLOB '*[^0-9a-f]*'
  AND typeof(NEW.`intent_version`) = 'integer'
  AND NEW.`intent_version` >= 1
  AND typeof(NEW.`execution_generation`) = 'integer'
  AND NEW.`execution_generation` >= 1
  AND (
    NEW.`transition_mutation_id` IS NULL
    OR (
      length(NEW.`transition_mutation_id`) = 64
      AND NEW.`transition_mutation_id` NOT GLOB '*[^0-9a-f]*'
    )
  )
  AND (
    NEW.`transition_command_digest` IS NULL
    OR (
      length(NEW.`transition_command_digest`) = 64
      AND NEW.`transition_command_digest` NOT GLOB '*[^0-9a-f]*'
    )
  )
  AND (
    NEW.`transition_actor_category` IS NULL
    OR NEW.`transition_actor_category` IN (
      'household_member', 'system', 'support'
    )
  )
  AND (
    NEW.`transition_actor_identity_hash` IS NULL
    OR (
      length(NEW.`transition_actor_identity_hash`) = 64
      AND NEW.`transition_actor_identity_hash` NOT GLOB '*[^0-9a-f]*'
    )
  )
  AND (
    NEW.`transition_provenance_version` IS NULL
    OR (
      typeof(NEW.`transition_provenance_version`) = 'integer'
      AND NEW.`transition_provenance_version` >= 1
    )
  )
)
BEGIN
  SELECT RAISE(ABORT, 'invalid recipe import intent household scope, actor, version, or generation');
END;
--> statement-breakpoint
CREATE TRIGGER `recipe_imports_intent_state_insert_guard`
BEFORE INSERT ON `recipe_imports`
WHEN NOT (
  (
    NEW.`public_status` = 'processing'
    AND NEW.`public_stage` IN (
      'resolving_source', 'acquiring_media', 'analyzing_evidence',
      'extracting_recipe', 'grounding_recipe', 'preparing_review',
      'finalizing_recipe'
    )
    AND NEW.`public_stage_started_at` IS NOT NULL
    AND NEW.`public_activity` IN ('working', 'retrying')
    AND (NEW.`public_activity` = 'retrying' OR NEW.`public_next_attempt_at` IS NULL)
    AND NEW.`active_action_id` IS NULL
    AND NEW.`public_recipe_id` IS NULL
    AND NEW.`public_failure_code` IS NULL
    AND NEW.`public_failure_message` IS NULL
    AND NEW.`public_recovery` IS NULL
    AND NEW.`failed_at` IS NULL
    AND NEW.`cancelled_at` IS NULL
    AND NEW.`succeeded_at` IS NULL
    AND NEW.`redirected_at` IS NULL
    AND NEW.`redirected_to_import_id` IS NULL
  ) OR (
    NEW.`public_status` = 'requires_action'
    AND NEW.`resolved_canonical_source_id` IS NOT NULL
    AND NEW.`active_action_id` IS NOT NULL
    AND NEW.`public_stage` IS NULL
    AND NEW.`public_stage_started_at` IS NULL
    AND NEW.`public_activity` IS NULL
    AND NEW.`public_next_attempt_at` IS NULL
    AND NEW.`public_recipe_id` IS NULL
    AND NEW.`public_failure_code` IS NULL
    AND NEW.`public_failure_message` IS NULL
    AND NEW.`public_recovery` IS NULL
    AND NEW.`failed_at` IS NULL
    AND NEW.`cancelled_at` IS NULL
    AND NEW.`succeeded_at` IS NULL
    AND NEW.`redirected_at` IS NULL
    AND NEW.`redirected_to_import_id` IS NULL
    AND NEW.`executor_owner_id` IS NULL
  ) OR (
    NEW.`public_status` = 'succeeded'
    AND NEW.`resolved_canonical_source_id` IS NOT NULL
    AND NEW.`public_recipe_id` IS NOT NULL
    AND NEW.`succeeded_at` IS NOT NULL
    AND NEW.`active_action_id` IS NULL
    AND NEW.`public_stage` IS NULL
    AND NEW.`public_stage_started_at` IS NULL
    AND NEW.`public_activity` IS NULL
    AND NEW.`public_next_attempt_at` IS NULL
    AND NEW.`public_failure_code` IS NULL
    AND NEW.`public_failure_message` IS NULL
    AND NEW.`public_recovery` IS NULL
    AND NEW.`failed_at` IS NULL
    AND NEW.`cancelled_at` IS NULL
    AND NEW.`redirected_at` IS NULL
    AND NEW.`redirected_to_import_id` IS NULL
    AND NEW.`executor_owner_id` IS NULL
  ) OR (
    NEW.`public_status` = 'failed'
    AND NEW.`public_failure_code` IN (
      'source_unavailable', 'unsupported_source', 'invalid_media',
      'analysis_failed', 'recipe_extraction_failed', 'internal_error'
    )
    AND NEW.`public_failure_message` IS NOT NULL
    AND NEW.`public_recovery` IN ('create_new_intent', 'contact_support', 'none')
    AND NEW.`failed_at` IS NOT NULL
    AND NEW.`active_action_id` IS NULL
    AND NEW.`public_recipe_id` IS NULL
    AND NEW.`public_stage` IS NULL
    AND NEW.`public_stage_started_at` IS NULL
    AND NEW.`public_activity` IS NULL
    AND NEW.`public_next_attempt_at` IS NULL
    AND NEW.`cancelled_at` IS NULL
    AND NEW.`succeeded_at` IS NULL
    AND NEW.`redirected_at` IS NULL
    AND NEW.`redirected_to_import_id` IS NULL
    AND NEW.`executor_owner_id` IS NULL
  ) OR (
    NEW.`public_status` = 'cancelled'
    AND NEW.`cancelled_at` IS NOT NULL
    AND NEW.`active_action_id` IS NULL
    AND NEW.`public_recipe_id` IS NULL
    AND NEW.`public_stage` IS NULL
    AND NEW.`public_stage_started_at` IS NULL
    AND NEW.`public_activity` IS NULL
    AND NEW.`public_next_attempt_at` IS NULL
    AND NEW.`public_failure_code` IS NULL
    AND NEW.`public_failure_message` IS NULL
    AND NEW.`public_recovery` IS NULL
    AND NEW.`failed_at` IS NULL
    AND NEW.`succeeded_at` IS NULL
    AND NEW.`redirected_at` IS NULL
    AND NEW.`redirected_to_import_id` IS NULL
    AND NEW.`executor_owner_id` IS NULL
  ) OR (
    NEW.`public_status` = 'redirected'
    AND NEW.`resolved_canonical_source_id` IS NOT NULL
    AND NEW.`redirected_at` IS NOT NULL
    AND NEW.`redirected_to_import_id` IS NOT NULL
    AND NEW.`redirected_to_import_id` <> NEW.`id`
    AND NEW.`active_action_id` IS NULL
    AND NEW.`public_recipe_id` IS NULL
    AND NEW.`public_stage` IS NULL
    AND NEW.`public_stage_started_at` IS NULL
    AND NEW.`public_activity` IS NULL
    AND NEW.`public_next_attempt_at` IS NULL
    AND NEW.`public_failure_code` IS NULL
    AND NEW.`public_failure_message` IS NULL
    AND NEW.`public_recovery` IS NULL
    AND NEW.`failed_at` IS NULL
    AND NEW.`cancelled_at` IS NULL
    AND NEW.`succeeded_at` IS NULL
    AND NEW.`executor_owner_id` IS NULL
  )
)
BEGIN
  SELECT RAISE(ABORT, 'invalid recipe import intent public state');
END;
--> statement-breakpoint
CREATE TRIGGER `recipe_imports_source_stage_insert_guard`
BEFORE INSERT ON `recipe_imports`
WHEN NOT (
    (
      NEW.`resolved_canonical_source_id` IS NULL
      AND NEW.`public_source_url` IS NULL
      AND NEW.`public_source_kind` IS NULL
    ) OR (
      NEW.`resolved_canonical_source_id` IS NOT NULL
      AND NEW.`public_source_url` IS NOT NULL
      AND NEW.`public_source_kind` IN ('video', 'carousel')
      AND (
        NEW.`public_source_url` LIKE 'https://tiktok.com/%'
        OR NEW.`public_source_url` LIKE 'https://%.tiktok.com/%'
      )
      AND instr(NEW.`public_source_url`, '?') = 0
      AND instr(NEW.`public_source_url`, '#') = 0
      AND instr(
        substr(
          NEW.`public_source_url`,
          9,
          instr(substr(NEW.`public_source_url`, 9), '/') - 1
        ),
        '@'
      ) = 0
      AND instr(
        substr(
          NEW.`public_source_url`,
          9,
          instr(substr(NEW.`public_source_url`, 9), '/') - 1
        ),
        ':'
      ) = 0
    )
  )
  OR (
    NEW.`public_status` = 'processing'
    AND NOT (
      (
        NEW.`public_stage` = 'resolving_source'
        AND NEW.`resolved_canonical_source_id` IS NULL
      ) OR (
        NEW.`public_stage` <> 'resolving_source'
        AND NEW.`resolved_canonical_source_id` IS NOT NULL
      )
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'recipe import intent source and stage are inconsistent');
END;
--> statement-breakpoint
CREATE TRIGGER `recipe_imports_source_stage_update_guard`
BEFORE UPDATE OF
  `submitted_source_url`, `resolved_canonical_source_id`, `public_source_url`,
  `public_source_kind`, `public_status`, `public_stage`
ON `recipe_imports`
WHEN NOT (
    (
      NEW.`resolved_canonical_source_id` IS NULL
      AND NEW.`public_source_url` IS NULL
      AND NEW.`public_source_kind` IS NULL
    ) OR (
      NEW.`resolved_canonical_source_id` IS NOT NULL
      AND NEW.`public_source_url` IS NOT NULL
      AND NEW.`public_source_kind` IN ('video', 'carousel')
      AND (
        NEW.`public_source_url` LIKE 'https://tiktok.com/%'
        OR NEW.`public_source_url` LIKE 'https://%.tiktok.com/%'
      )
      AND instr(NEW.`public_source_url`, '?') = 0
      AND instr(NEW.`public_source_url`, '#') = 0
      AND instr(
        substr(
          NEW.`public_source_url`,
          9,
          instr(substr(NEW.`public_source_url`, 9), '/') - 1
        ),
        '@'
      ) = 0
      AND instr(
        substr(
          NEW.`public_source_url`,
          9,
          instr(substr(NEW.`public_source_url`, 9), '/') - 1
        ),
        ':'
      ) = 0
    )
  )
  OR (
    NEW.`public_status` = 'processing'
    AND NOT (
      (
        NEW.`public_stage` = 'resolving_source'
        AND NEW.`resolved_canonical_source_id` IS NULL
      ) OR (
        NEW.`public_stage` <> 'resolving_source'
        AND NEW.`resolved_canonical_source_id` IS NOT NULL
      )
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'recipe import intent source and stage are inconsistent');
END;
--> statement-breakpoint
CREATE TRIGGER `recipe_imports_redirect_target_insert_guard`
BEFORE INSERT ON `recipe_imports`
WHEN NEW.`public_status` = 'redirected'
  AND NOT EXISTS (
    SELECT 1
    FROM `recipe_imports` AS `target`
    WHERE `target`.`id` = NEW.`redirected_to_import_id`
      AND `target`.`household_scope_id` = NEW.`household_scope_id`
      AND `target`.`resolved_canonical_source_id` = NEW.`resolved_canonical_source_id`
      AND `target`.`public_status` IN (
        'processing', 'requires_action', 'succeeded'
      )
  )
BEGIN
  SELECT RAISE(ABORT, 'invalid recipe import intent redirect target');
END;
--> statement-breakpoint
CREATE TRIGGER `recipe_imports_redirect_target_update_guard`
BEFORE UPDATE OF
  `public_status`, `redirected_to_import_id`, `household_scope_id`,
  `resolved_canonical_source_id`
ON `recipe_imports`
WHEN NEW.`public_status` = 'redirected'
  AND NOT EXISTS (
    SELECT 1
    FROM `recipe_imports` AS `target`
    WHERE `target`.`id` = NEW.`redirected_to_import_id`
      AND `target`.`household_scope_id` = NEW.`household_scope_id`
      AND `target`.`resolved_canonical_source_id` = NEW.`resolved_canonical_source_id`
      AND `target`.`public_status` IN (
        'processing', 'requires_action', 'succeeded'
      )
  )
BEGIN
  SELECT RAISE(ABORT, 'invalid recipe import intent redirect target');
END;
--> statement-breakpoint
CREATE TRIGGER `recipe_imports_intent_state_update_guard`
BEFORE UPDATE OF
  `public_status`, `public_stage`, `public_stage_started_at`, `public_activity`,
  `public_next_attempt_at`, `active_action_id`, `public_recipe_id`,
  `public_failure_code`, `public_failure_message`, `public_recovery`,
  `failed_at`, `cancelled_at`, `succeeded_at`, `redirected_at`,
  `redirected_to_import_id`, `executor_owner_id`,
  `resolved_canonical_source_id`
ON `recipe_imports`
WHEN NOT (
  (
    NEW.`public_status` = 'processing'
    AND NEW.`public_stage` IN (
      'resolving_source', 'acquiring_media', 'analyzing_evidence',
      'extracting_recipe', 'grounding_recipe', 'preparing_review',
      'finalizing_recipe'
    )
    AND NEW.`public_stage_started_at` IS NOT NULL
    AND NEW.`public_activity` IN ('working', 'retrying')
    AND (NEW.`public_activity` = 'retrying' OR NEW.`public_next_attempt_at` IS NULL)
    AND NEW.`active_action_id` IS NULL
    AND NEW.`public_recipe_id` IS NULL
    AND NEW.`public_failure_code` IS NULL
    AND NEW.`public_failure_message` IS NULL
    AND NEW.`public_recovery` IS NULL
    AND NEW.`failed_at` IS NULL
    AND NEW.`cancelled_at` IS NULL
    AND NEW.`succeeded_at` IS NULL
    AND NEW.`redirected_at` IS NULL
    AND NEW.`redirected_to_import_id` IS NULL
  ) OR (
    NEW.`public_status` = 'requires_action'
    AND NEW.`resolved_canonical_source_id` IS NOT NULL
    AND NEW.`active_action_id` IS NOT NULL
    AND NEW.`public_stage` IS NULL
    AND NEW.`public_stage_started_at` IS NULL
    AND NEW.`public_activity` IS NULL
    AND NEW.`public_next_attempt_at` IS NULL
    AND NEW.`public_recipe_id` IS NULL
    AND NEW.`public_failure_code` IS NULL
    AND NEW.`public_failure_message` IS NULL
    AND NEW.`public_recovery` IS NULL
    AND NEW.`failed_at` IS NULL
    AND NEW.`cancelled_at` IS NULL
    AND NEW.`succeeded_at` IS NULL
    AND NEW.`redirected_at` IS NULL
    AND NEW.`redirected_to_import_id` IS NULL
    AND NEW.`executor_owner_id` IS NULL
  ) OR (
    NEW.`public_status` = 'succeeded'
    AND NEW.`resolved_canonical_source_id` IS NOT NULL
    AND NEW.`public_recipe_id` IS NOT NULL
    AND NEW.`succeeded_at` IS NOT NULL
    AND NEW.`active_action_id` IS NULL
    AND NEW.`public_stage` IS NULL
    AND NEW.`public_stage_started_at` IS NULL
    AND NEW.`public_activity` IS NULL
    AND NEW.`public_next_attempt_at` IS NULL
    AND NEW.`public_failure_code` IS NULL
    AND NEW.`public_failure_message` IS NULL
    AND NEW.`public_recovery` IS NULL
    AND NEW.`failed_at` IS NULL
    AND NEW.`cancelled_at` IS NULL
    AND NEW.`redirected_at` IS NULL
    AND NEW.`redirected_to_import_id` IS NULL
    AND NEW.`executor_owner_id` IS NULL
  ) OR (
    NEW.`public_status` = 'failed'
    AND NEW.`public_failure_code` IN (
      'source_unavailable', 'unsupported_source', 'invalid_media',
      'analysis_failed', 'recipe_extraction_failed', 'internal_error'
    )
    AND NEW.`public_failure_message` IS NOT NULL
    AND NEW.`public_recovery` IN ('create_new_intent', 'contact_support', 'none')
    AND NEW.`failed_at` IS NOT NULL
    AND NEW.`active_action_id` IS NULL
    AND NEW.`public_recipe_id` IS NULL
    AND NEW.`public_stage` IS NULL
    AND NEW.`public_stage_started_at` IS NULL
    AND NEW.`public_activity` IS NULL
    AND NEW.`public_next_attempt_at` IS NULL
    AND NEW.`cancelled_at` IS NULL
    AND NEW.`succeeded_at` IS NULL
    AND NEW.`redirected_at` IS NULL
    AND NEW.`redirected_to_import_id` IS NULL
    AND NEW.`executor_owner_id` IS NULL
  ) OR (
    NEW.`public_status` = 'cancelled'
    AND NEW.`cancelled_at` IS NOT NULL
    AND NEW.`active_action_id` IS NULL
    AND NEW.`public_recipe_id` IS NULL
    AND NEW.`public_stage` IS NULL
    AND NEW.`public_stage_started_at` IS NULL
    AND NEW.`public_activity` IS NULL
    AND NEW.`public_next_attempt_at` IS NULL
    AND NEW.`public_failure_code` IS NULL
    AND NEW.`public_failure_message` IS NULL
    AND NEW.`public_recovery` IS NULL
    AND NEW.`failed_at` IS NULL
    AND NEW.`succeeded_at` IS NULL
    AND NEW.`redirected_at` IS NULL
    AND NEW.`redirected_to_import_id` IS NULL
    AND NEW.`executor_owner_id` IS NULL
  ) OR (
    NEW.`public_status` = 'redirected'
    AND NEW.`resolved_canonical_source_id` IS NOT NULL
    AND NEW.`redirected_at` IS NOT NULL
    AND NEW.`redirected_to_import_id` IS NOT NULL
    AND NEW.`redirected_to_import_id` <> NEW.`id`
    AND NEW.`active_action_id` IS NULL
    AND NEW.`public_recipe_id` IS NULL
    AND NEW.`public_stage` IS NULL
    AND NEW.`public_stage_started_at` IS NULL
    AND NEW.`public_activity` IS NULL
    AND NEW.`public_next_attempt_at` IS NULL
    AND NEW.`public_failure_code` IS NULL
    AND NEW.`public_failure_message` IS NULL
    AND NEW.`public_recovery` IS NULL
    AND NEW.`failed_at` IS NULL
    AND NEW.`cancelled_at` IS NULL
    AND NEW.`succeeded_at` IS NULL
    AND NEW.`executor_owner_id` IS NULL
  )
)
BEGIN
  SELECT RAISE(ABORT, 'invalid recipe import intent public state');
END;
--> statement-breakpoint
CREATE TRIGGER `recipe_imports_stage_monotonic_guard`
BEFORE UPDATE OF `public_stage`, `public_stage_started_at` ON `recipe_imports`
WHEN OLD.`public_status` = 'processing'
  AND NEW.`public_status` = 'processing'
  AND (
    CASE NEW.`public_stage`
      WHEN 'resolving_source' THEN 1
      WHEN 'acquiring_media' THEN 2
      WHEN 'analyzing_evidence' THEN 3
      WHEN 'extracting_recipe' THEN 4
      WHEN 'grounding_recipe' THEN 5
      WHEN 'preparing_review' THEN 6
      WHEN 'finalizing_recipe' THEN 7
      ELSE 0
    END
  ) < (
    CASE OLD.`public_stage`
      WHEN 'resolving_source' THEN 1
      WHEN 'acquiring_media' THEN 2
      WHEN 'analyzing_evidence' THEN 3
      WHEN 'extracting_recipe' THEN 4
      WHEN 'grounding_recipe' THEN 5
      WHEN 'preparing_review' THEN 6
      WHEN 'finalizing_recipe' THEN 7
      ELSE 0
    END
  )
BEGIN
  SELECT RAISE(ABORT, 'recipe import intent stage must be monotonic');
END;
--> statement-breakpoint
CREATE TRIGGER `recipe_imports_stage_started_at_guard`
BEFORE UPDATE OF `public_stage_started_at` ON `recipe_imports`
WHEN OLD.`public_status` = 'processing'
  AND NEW.`public_status` = 'processing'
  AND OLD.`public_stage` = NEW.`public_stage`
  AND OLD.`public_stage_started_at` <> NEW.`public_stage_started_at`
BEGIN
  SELECT RAISE(ABORT, 'recipe import intent stage started_at is immutable');
END;
--> statement-breakpoint
CREATE TABLE `recipe_import_intent_history` (
  `intent_id` text NOT NULL,
  `intent_version` integer NOT NULL,
  `event_type` text NOT NULL,
  `occurred_at` text NOT NULL,
  `mutation_id` text,
  `command_digest` text,
  `actor_category` text NOT NULL,
  `actor_identity_hash` text,
  `from_public_status` text,
  `from_public_stage` text,
  `to_public_status` text NOT NULL,
  `to_public_stage` text,
  `public_status` text NOT NULL,
  `public_stage` text,
  `public_activity` text,
  `public_next_attempt_at` text,
  `public_source_url` text,
  `redirected_to_import_id` text,
  `action_id` text,
  `recipe_id` text,
  `failure_code` text, `public_speech` text, `public_visuals` text, `public_source_kind` text, `public_stage_started_at` text,
  PRIMARY KEY (`intent_id`, `intent_version`),
  CONSTRAINT `recipe_import_intent_history_intent_fk`
    FOREIGN KEY (`intent_id`) REFERENCES `recipe_imports`(`id`)
      ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `recipe_import_intent_history_version_check`
    CHECK (typeof(`intent_version`) = 'integer' AND `intent_version` >= 1),
  CONSTRAINT `recipe_import_intent_history_event_check`
    CHECK (`event_type` IN (
      'intent_admitted', 'source_resolved',
      'intent_redirected', 'processing_stage_changed', 'retrying',
      'recovered', 'action_available', 'intent_succeeded', 'intent_failed',
      'intent_cancelled'
    )),
  CONSTRAINT `recipe_import_intent_history_status_check`
    CHECK (`public_status` IN (
      'processing', 'requires_action', 'succeeded', 'failed', 'cancelled',
      'redirected'
    )),
  CONSTRAINT `recipe_import_intent_history_actor_check`
    CHECK (
      `actor_category` IN ('household_member', 'system', 'support')
      AND (
        `actor_category` <> 'household_member'
        OR `actor_identity_hash` IS NOT NULL
      )
      AND (
        `actor_identity_hash` IS NULL
        OR (
          length(`actor_identity_hash`) = 64
          AND `actor_identity_hash` NOT GLOB '*[^0-9a-f]*'
        )
      )
    ),
  CONSTRAINT `recipe_import_intent_history_mutation_check`
    CHECK (
      (`mutation_id` IS NULL AND `command_digest` IS NULL)
      OR (
        length(`mutation_id`) = 64
        AND `mutation_id` NOT GLOB '*[^0-9a-f]*'
        AND length(`command_digest`) = 64
        AND `command_digest` NOT GLOB '*[^0-9a-f]*'
      )
    ),
  CONSTRAINT `recipe_import_intent_history_transition_check`
    CHECK (
      (
        `from_public_status` IS NULL
        OR `from_public_status` IN (
          'processing', 'requires_action', 'succeeded', 'failed', 'cancelled',
          'redirected'
        )
      )
      AND `to_public_status` IN (
        'processing', 'requires_action', 'succeeded', 'failed', 'cancelled',
        'redirected'
      )
      AND (
        `from_public_stage` IS NULL
        OR `from_public_stage` IN (
          'resolving_source', 'acquiring_media', 'analyzing_evidence',
          'extracting_recipe', 'grounding_recipe', 'preparing_review',
          'finalizing_recipe'
        )
      )
      AND (
        `to_public_stage` IS NULL
        OR `to_public_stage` IN (
          'resolving_source', 'acquiring_media', 'analyzing_evidence',
          'extracting_recipe', 'grounding_recipe', 'preparing_review',
          'finalizing_recipe'
        )
      )
      AND `to_public_status` = `public_status`
      AND `to_public_stage` IS `public_stage`
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recipe_import_intent_history_mutation_unique`
  ON `recipe_import_intent_history` (`intent_id`, `mutation_id`)
  WHERE `mutation_id` IS NOT NULL;
--> statement-breakpoint
CREATE TRIGGER `recipe_import_intent_history_update_guard`
BEFORE UPDATE ON `recipe_import_intent_history`
BEGIN
  SELECT RAISE(ABORT, 'recipe import intent history is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `recipe_import_intent_history_delete_guard`
BEFORE DELETE ON `recipe_import_intent_history`
BEGIN
  SELECT RAISE(ABORT, 'recipe import intent history is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `recipe_import_intent_admitted_history`
AFTER INSERT ON `recipe_imports`
BEGIN
  INSERT INTO `recipe_import_intent_history` (
    `intent_id`, `intent_version`, `event_type`, `occurred_at`,
    `mutation_id`, `command_digest`, `actor_category`, `actor_identity_hash`,
    `from_public_status`, `from_public_stage`, `to_public_status`,
    `to_public_stage`, `public_status`, `public_stage`, `public_activity`,
    `public_next_attempt_at`, `public_source_url`, `redirected_to_import_id`,
    `action_id`, `recipe_id`, `failure_code`
  ) VALUES (
    NEW.`id`, NEW.`intent_version`, 'intent_admitted', NEW.`created_at`,
    CASE WHEN NEW.`transition_provenance_version` = NEW.`intent_version`
      THEN NEW.`transition_mutation_id` ELSE NULL END,
    CASE WHEN NEW.`transition_provenance_version` = NEW.`intent_version`
      THEN NEW.`transition_command_digest` ELSE NULL END,
    CASE WHEN NEW.`transition_provenance_version` = NEW.`intent_version`
      THEN coalesce(NEW.`transition_actor_category`, 'system') ELSE 'system' END,
    CASE WHEN NEW.`transition_provenance_version` = NEW.`intent_version`
      THEN NEW.`transition_actor_identity_hash` ELSE NULL END,
    NULL, NULL, NEW.`public_status`, NEW.`public_stage`, NEW.`public_status`,
    NEW.`public_stage`, NEW.`public_activity`, NEW.`public_next_attempt_at`,
    NEW.`public_source_url`, NEW.`redirected_to_import_id`,
    NEW.`active_action_id`, NEW.`public_recipe_id`, NEW.`public_failure_code`
  );
END;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "import_requests" (
  `household_scope_id` text NOT NULL,
  `created_at` text NOT NULL,
  `idempotency_key_hash` text NOT NULL,
  `import_id` text NOT NULL,
  `request_fingerprint` text NOT NULL,
  `source_locator_hash` text NOT NULL,
  PRIMARY KEY (`household_scope_id`, `idempotency_key_hash`),
  CONSTRAINT `import_requests_import_fk`
    FOREIGN KEY (`import_id`) REFERENCES `recipe_imports`(`id`)
      ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `import_requests_household_scope_check`
    CHECK (
      length(`household_scope_id`) = 64
      AND `household_scope_id` NOT GLOB '*[^0-9a-f]*'
    )
);
--> statement-breakpoint
CREATE INDEX `import_requests_import_id_index`
  ON `import_requests` (`import_id`);
--> statement-breakpoint
CREATE TRIGGER `recipe_imports_component_state_insert_guard`
BEFORE INSERT ON `recipe_imports`
WHEN NOT (
  (
    NEW.`public_status` = 'processing'
    AND NEW.`public_stage` = 'analyzing_evidence'
    AND NEW.`public_speech` IN ('not_started', 'processing', 'completed', 'skipped')
    AND NEW.`public_visuals` IN ('not_started', 'processing', 'completed', 'skipped')
  ) OR (
    NOT (NEW.`public_status` = 'processing' AND NEW.`public_stage` = 'analyzing_evidence')
    AND NEW.`public_speech` IS NULL
    AND NEW.`public_visuals` IS NULL
  )
)
BEGIN
  SELECT RAISE(ABORT, 'invalid recipe import intent component state');
END;
--> statement-breakpoint
CREATE TRIGGER `recipe_imports_component_state_update_guard`
BEFORE UPDATE OF `public_status`, `public_stage`, `public_speech`, `public_visuals`
ON `recipe_imports`
WHEN NOT (
  (
    NEW.`public_status` = 'processing'
    AND NEW.`public_stage` = 'analyzing_evidence'
    AND NEW.`public_speech` IN ('not_started', 'processing', 'completed', 'skipped')
    AND NEW.`public_visuals` IN ('not_started', 'processing', 'completed', 'skipped')
  ) OR (
    NOT (NEW.`public_status` = 'processing' AND NEW.`public_stage` = 'analyzing_evidence')
    AND NEW.`public_speech` IS NULL
    AND NEW.`public_visuals` IS NULL
  )
)
BEGIN
  SELECT RAISE(ABORT, 'invalid recipe import intent component state');
END;
--> statement-breakpoint
CREATE TRIGGER `recipe_import_intent_transition_history`
AFTER UPDATE OF `intent_version` ON `recipe_imports`
WHEN NEW.`intent_version` = OLD.`intent_version` + 1
BEGIN
  INSERT INTO `recipe_import_intent_history` (
    `intent_id`, `intent_version`, `event_type`, `occurred_at`,
    `mutation_id`, `command_digest`, `actor_category`, `actor_identity_hash`,
    `from_public_status`, `from_public_stage`, `to_public_status`,
    `to_public_stage`, `public_status`, `public_stage`, `public_activity`,
    `public_next_attempt_at`, `public_speech`, `public_visuals`,
    `public_source_kind`, `public_stage_started_at`, `public_source_url`,
    `redirected_to_import_id`, `action_id`, `recipe_id`, `failure_code`
  ) VALUES (
    NEW.`id`, NEW.`intent_version`,
    CASE
      WHEN NEW.`public_status` = 'redirected' THEN 'intent_redirected'
      WHEN NEW.`public_status` = 'requires_action' THEN 'action_available'
      WHEN NEW.`public_status` = 'succeeded' THEN 'intent_succeeded'
      WHEN NEW.`public_status` = 'failed' THEN 'intent_failed'
      WHEN NEW.`public_status` = 'cancelled' THEN 'intent_cancelled'
      WHEN OLD.`resolved_canonical_source_id` IS NULL
        AND NEW.`resolved_canonical_source_id` IS NOT NULL
        THEN 'source_resolved'
      WHEN OLD.`public_activity` IS NOT 'retrying'
        AND NEW.`public_activity` = 'retrying' THEN 'retrying'
      WHEN OLD.`public_activity` = 'retrying'
        AND NEW.`public_activity` = 'working' THEN 'recovered'
      ELSE 'processing_stage_changed'
    END,
    NEW.`updated_at`,
    CASE WHEN NEW.`transition_provenance_version` = NEW.`intent_version`
      THEN NEW.`transition_mutation_id` ELSE NULL END,
    CASE WHEN NEW.`transition_provenance_version` = NEW.`intent_version`
      THEN NEW.`transition_command_digest` ELSE NULL END,
    CASE WHEN NEW.`transition_provenance_version` = NEW.`intent_version`
      THEN coalesce(NEW.`transition_actor_category`, 'system') ELSE 'system' END,
    CASE WHEN NEW.`transition_provenance_version` = NEW.`intent_version`
      THEN NEW.`transition_actor_identity_hash` ELSE NULL END,
    OLD.`public_status`, OLD.`public_stage`, NEW.`public_status`,
    NEW.`public_stage`, NEW.`public_status`, NEW.`public_stage`,
    NEW.`public_activity`, NEW.`public_next_attempt_at`, NEW.`public_speech`,
    NEW.`public_visuals`, NEW.`public_source_kind`,
    NEW.`public_stage_started_at`, NEW.`public_source_url`,
    NEW.`redirected_to_import_id`, NEW.`active_action_id`, NEW.`public_recipe_id`,
    NEW.`public_failure_code`
  );
END;
--> statement-breakpoint
CREATE TRIGGER `recipe_imports_active_action_version_insert_guard`
BEFORE INSERT ON `recipe_imports`
WHEN NOT (
  (
    NEW.`public_status` = 'requires_action'
    AND NEW.`active_action_id` IS NOT NULL
    AND typeof(NEW.`active_action_version`) = 'integer'
    AND NEW.`active_action_version` >= 1
    AND NEW.`active_action_version` <= 9007199254740991
  ) OR (
    NEW.`public_status` <> 'requires_action'
    AND NEW.`active_action_version` IS NULL
  )
)
BEGIN
  SELECT RAISE(ABORT, 'invalid recipe import active action version');
END;
--> statement-breakpoint
CREATE TRIGGER `recipe_imports_active_action_version_update_guard`
BEFORE UPDATE OF `public_status`, `active_action_id`, `active_action_version`
ON `recipe_imports`
WHEN NOT (
  (
    NEW.`public_status` = 'requires_action'
    AND NEW.`active_action_id` IS NOT NULL
    AND typeof(NEW.`active_action_version`) = 'integer'
    AND NEW.`active_action_version` >= 1
    AND NEW.`active_action_version` <= 9007199254740991
  ) OR (
    NEW.`public_status` <> 'requires_action'
    AND NEW.`active_action_version` IS NULL
  )
)
BEGIN
  SELECT RAISE(ABORT, 'invalid recipe import active action version');
END;
--> statement-breakpoint
CREATE TRIGGER `recipe_imports_intent_version_advance_guard`
BEFORE UPDATE ON `recipe_imports`
WHEN
  NEW.`intent_version` NOT IN (OLD.`intent_version`, OLD.`intent_version` + 1)
  OR (
    (
      NEW.`public_status` IS NOT OLD.`public_status`
      OR NEW.`public_stage` IS NOT OLD.`public_stage`
      OR NEW.`public_stage_started_at` IS NOT OLD.`public_stage_started_at`
      OR NEW.`public_activity` IS NOT OLD.`public_activity`
      OR NEW.`public_next_attempt_at` IS NOT OLD.`public_next_attempt_at`
      OR NEW.`public_speech` IS NOT OLD.`public_speech`
      OR NEW.`public_visuals` IS NOT OLD.`public_visuals`
      OR NEW.`resolved_canonical_source_id` IS NOT OLD.`resolved_canonical_source_id`
      OR NEW.`public_source_url` IS NOT OLD.`public_source_url`
      OR NEW.`public_source_kind` IS NOT OLD.`public_source_kind`
      OR NEW.`active_action_id` IS NOT OLD.`active_action_id`
      OR NEW.`active_action_version` IS NOT OLD.`active_action_version`
      OR NEW.`public_recipe_id` IS NOT OLD.`public_recipe_id`
      OR NEW.`public_failure_code` IS NOT OLD.`public_failure_code`
      OR NEW.`public_failure_message` IS NOT OLD.`public_failure_message`
      OR NEW.`public_recovery` IS NOT OLD.`public_recovery`
      OR NEW.`failed_at` IS NOT OLD.`failed_at`
      OR NEW.`cancelled_at` IS NOT OLD.`cancelled_at`
      OR NEW.`succeeded_at` IS NOT OLD.`succeeded_at`
      OR NEW.`redirected_at` IS NOT OLD.`redirected_at`
      OR NEW.`redirected_to_import_id` IS NOT OLD.`redirected_to_import_id`
    )
    AND NEW.`intent_version` <> OLD.`intent_version` + 1
  )
  OR (
    NEW.`intent_version` = OLD.`intent_version` + 1
    AND NOT (
      NEW.`public_status` IS NOT OLD.`public_status`
      OR NEW.`public_stage` IS NOT OLD.`public_stage`
      OR NEW.`public_stage_started_at` IS NOT OLD.`public_stage_started_at`
      OR NEW.`public_activity` IS NOT OLD.`public_activity`
      OR NEW.`public_next_attempt_at` IS NOT OLD.`public_next_attempt_at`
      OR NEW.`public_speech` IS NOT OLD.`public_speech`
      OR NEW.`public_visuals` IS NOT OLD.`public_visuals`
      OR NEW.`resolved_canonical_source_id` IS NOT OLD.`resolved_canonical_source_id`
      OR NEW.`public_source_url` IS NOT OLD.`public_source_url`
      OR NEW.`public_source_kind` IS NOT OLD.`public_source_kind`
      OR NEW.`active_action_id` IS NOT OLD.`active_action_id`
      OR NEW.`active_action_version` IS NOT OLD.`active_action_version`
      OR NEW.`public_recipe_id` IS NOT OLD.`public_recipe_id`
      OR NEW.`public_failure_code` IS NOT OLD.`public_failure_code`
      OR NEW.`public_failure_message` IS NOT OLD.`public_failure_message`
      OR NEW.`public_recovery` IS NOT OLD.`public_recovery`
      OR NEW.`failed_at` IS NOT OLD.`failed_at`
      OR NEW.`cancelled_at` IS NOT OLD.`cancelled_at`
      OR NEW.`succeeded_at` IS NOT OLD.`succeeded_at`
      OR NEW.`redirected_at` IS NOT OLD.`redirected_at`
      OR NEW.`redirected_to_import_id` IS NOT OLD.`redirected_to_import_id`
    )
  )
  OR (
    OLD.`public_status` = 'requires_action'
    AND NEW.`public_status` = 'requires_action'
    AND NEW.`active_action_version` IS NOT OLD.`active_action_version`
    AND NEW.`active_action_version` <> OLD.`active_action_version` + 1
  )
BEGIN
  SELECT RAISE(ABORT, 'recipe import intent version must match one meaningful transition');
END;
--> statement-breakpoint

CREATE TABLE `import_carousel_evidence` (
	`acquisition_generation` integer NOT NULL,
	`completed_at` text,
	`created_at` text NOT NULL,
	`descriptor_fingerprint` text NOT NULL,
	`dispatch_id` text NOT NULL,
	`failure_code` text,
	`image_count` integer,
	`import_id` text NOT NULL,
	`manifest_key` text,
	`manifest_sha256` text,
	`recovery_action` text,
	`state` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT `import_carousel_evidence_pk` PRIMARY KEY(`import_id`, `acquisition_generation`),
	CONSTRAINT `import_carousel_evidence_import_generation_fk` FOREIGN KEY (`import_id`,`acquisition_generation`) REFERENCES `import_execution_runs`(`id`,`acquisition_generation`) ON UPDATE RESTRICT ON DELETE RESTRICT,
	CONSTRAINT "import_carousel_evidence_generation_check" CHECK(typeof("acquisition_generation") = 'integer' AND "acquisition_generation" >= 0 AND "acquisition_generation" <= 9007199254740991),
	CONSTRAINT "import_carousel_evidence_identity_check" CHECK(length("descriptor_fingerprint") = 64 AND "descriptor_fingerprint" NOT GLOB '*[^0-9a-f]*' AND length("dispatch_id") BETWEEN 1 AND 100),
	CONSTRAINT "import_carousel_evidence_state_check" CHECK((
        "state" = 'dispatching'
        AND "manifest_key" IS NULL
        AND "manifest_sha256" IS NULL
        AND "image_count" IS NULL
        AND "failure_code" IS NULL
        AND "recovery_action" IS NULL
        AND "completed_at" IS NULL
      ) OR (
        "state" = 'completed'
        AND length("manifest_key") BETWEEN 1 AND 500
        AND length("manifest_sha256") = 64
        AND "manifest_sha256" NOT GLOB '*[^0-9a-f]*'
        AND typeof("image_count") = 'integer'
        AND "image_count" BETWEEN 1 AND 12
        AND "failure_code" IS NULL
        AND "recovery_action" IS NULL
        AND "completed_at" IS NOT NULL
      ) OR (
        "state" = 'failed'
        AND "manifest_key" IS NULL
        AND "manifest_sha256" IS NULL
        AND "image_count" IS NULL
        AND "completed_at" IS NOT NULL
        AND (
          ("failure_code" = 'carousel_inaccessible' AND "recovery_action" = 'check_source_visibility')
          OR ("failure_code" = 'carousel_partial' AND "recovery_action" = 'request_complete_carousel')
          OR ("failure_code" = 'carousel_layout_drift' AND "recovery_action" = 'update_carousel_adapter')
        )
      ))
);
--> statement-breakpoint
CREATE TABLE `import_execution_runs` (
	`acquisition_generation` integer DEFAULT 0 NOT NULL,
	`canonical_source_id` text NOT NULL,
	`correlation_id` text NOT NULL,
	`created_at` text NOT NULL,
	`evidence_references_json` text NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`recovery_action` text,
	`source_kind` text NOT NULL,
	`source_type` text NOT NULL,
	`status` text NOT NULL,
	`status_code` text,
	`updated_at` text NOT NULL,
	CONSTRAINT "import_execution_runs_evidence_json_check" CHECK(json_valid("evidence_references_json")),
	CONSTRAINT "import_execution_runs_acquisition_generation_check" CHECK(typeof("acquisition_generation") = 'integer' AND "acquisition_generation" >= 0 AND "acquisition_generation" <= 9007199254740991),
	CONSTRAINT "import_execution_runs_status_details_check" CHECK((
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
CREATE TABLE `import_recipe_executor_terminal_checkpoints` (
	`acquisition_generation` integer NOT NULL,
	`checkpointed_at` text NOT NULL,
	`evidence_references_json` text NOT NULL,
	`import_id` text NOT NULL,
	`ownership_id` text NOT NULL,
	CONSTRAINT `import_recipe_executor_terminal_checkpoints_pk` PRIMARY KEY(`import_id`, `acquisition_generation`),
	CONSTRAINT `import_recipe_executor_terminal_checkpoints_import_generation_fk` FOREIGN KEY (`import_id`,`acquisition_generation`) REFERENCES `import_execution_runs`(`id`,`acquisition_generation`) ON UPDATE RESTRICT ON DELETE RESTRICT,
	CONSTRAINT "import_recipe_executor_terminal_checkpoints_details_check" CHECK(json_valid("evidence_references_json") AND json_array_length("evidence_references_json") IN (0, 3) AND length("ownership_id") = 64 AND "ownership_id" NOT GLOB '*[^0-9a-f]*')
);
--> statement-breakpoint
CREATE TABLE `import_recipe_extractions` (
	`acquisition_generation` integer NOT NULL,
	`completed_at` text,
	`cost_certainty` text,
	`cost_currency` text,
	`created_at` text NOT NULL,
	`draft_json` text,
	`estimated_cost_micro_usd` integer,
	`evidence_fingerprint` text NOT NULL,
	`extraction_fingerprint` text PRIMARY KEY NOT NULL,
	`extractor_model` text NOT NULL,
	`extractor_provider` text NOT NULL,
	`extractor_version` text NOT NULL,
	`failure_code` text,
	`import_id` text NOT NULL,
	`input_evidence_items` integer,
	`input_tokens` integer,
	`is_current` integer DEFAULT 0 NOT NULL,
	`latency_milliseconds` integer,
	`model_calls` integer,
	`output_tokens` integer,
	`state` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT `import_recipe_extractions_import_generation_fk` FOREIGN KEY (`import_id`,`acquisition_generation`) REFERENCES `import_execution_runs`(`id`,`acquisition_generation`) ON UPDATE RESTRICT ON DELETE RESTRICT,
	CONSTRAINT "import_recipe_extractions_fingerprint_check" CHECK(length("evidence_fingerprint") = 64 AND "evidence_fingerprint" NOT GLOB '*[^0-9a-f]*' AND length("extraction_fingerprint") = 64 AND "extraction_fingerprint" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "import_recipe_extractions_descriptor_check" CHECK(length("extractor_provider") BETWEEN 1 AND 64 AND length("extractor_model") BETWEEN 1 AND 64 AND length("extractor_version") BETWEEN 1 AND 64),
	CONSTRAINT "import_recipe_extractions_state_check" CHECK((
        "state" = 'dispatching'
        AND "draft_json" IS NULL
        AND "failure_code" IS NULL
        AND "input_evidence_items" IS NULL
        AND "input_tokens" IS NULL
        AND "output_tokens" IS NULL
        AND "model_calls" IS NULL
        AND "latency_milliseconds" IS NULL
        AND "estimated_cost_micro_usd" IS NULL
        AND "cost_currency" IS NULL
        AND "cost_certainty" IS NULL
        AND "completed_at" IS NULL
        AND "is_current" = 0
      ) OR (
        "state" = 'needs_review'
        AND json_valid("draft_json")
        AND "failure_code" IS NULL
        AND typeof("input_evidence_items") = 'integer' AND "input_evidence_items" > 0
        AND typeof("input_tokens") = 'integer' AND "input_tokens" >= 0
        AND typeof("output_tokens") = 'integer' AND "output_tokens" >= 0
        AND "model_calls" = 1
        AND typeof("latency_milliseconds") = 'integer' AND "latency_milliseconds" >= 0
        AND typeof("estimated_cost_micro_usd") = 'integer' AND "estimated_cost_micro_usd" >= 0
        AND "cost_currency" = 'USD'
        AND "cost_certainty" IN ('estimated', 'known')
        AND "completed_at" IS NOT NULL
        AND "is_current" IN (0, 1)
      ) OR (
        "state" = 'failed'
        AND "draft_json" IS NULL
        AND "failure_code" IN ('insufficient_evidence', 'invalid_schema', 'model_refusal', 'provider_error')
        AND "input_evidence_items" IS NULL
        AND "input_tokens" IS NULL
        AND "output_tokens" IS NULL
        AND "model_calls" IS NULL
        AND "latency_milliseconds" IS NULL
        AND "estimated_cost_micro_usd" IS NULL
        AND "cost_currency" IS NULL
        AND "cost_certainty" IS NULL
        AND "completed_at" IS NOT NULL
        AND "is_current" = 0
      ))
);
--> statement-breakpoint
CREATE TABLE `import_transcriptions` (
	`acquisition_generation` integer NOT NULL,
	`completed_at` text,
	`cost_certainty` text,
	`cost_currency` text,
	`created_at` text NOT NULL,
	`detected_language` text,
	`dispatch_id` text NOT NULL,
	`estimated_cost_micro_usd` integer,
	`failure_code` text,
	`import_id` text NOT NULL,
	`model` text,
	`provider` text,
	`segments_count` integer,
	`source_media_sha256` text NOT NULL,
	`state` text NOT NULL,
	`transcript_key` text,
	`transcript_sha256` text,
	`updated_at` text NOT NULL,
	`usage_audio_milliseconds` integer,
	`usage_input_bytes` integer,
	CONSTRAINT `import_transcriptions_pk` PRIMARY KEY(`import_id`, `acquisition_generation`),
	CONSTRAINT `import_transcriptions_import_generation_fk` FOREIGN KEY (`import_id`,`acquisition_generation`) REFERENCES `import_execution_runs`(`id`,`acquisition_generation`) ON UPDATE RESTRICT ON DELETE RESTRICT,
	CONSTRAINT "import_transcriptions_generation_check" CHECK(typeof("acquisition_generation") = 'integer' AND "acquisition_generation" >= 0 AND "acquisition_generation" <= 9007199254740991),
	CONSTRAINT "import_transcriptions_dispatch_id_check" CHECK(length("dispatch_id") BETWEEN 1 AND 100),
	CONSTRAINT "import_transcriptions_source_sha_check" CHECK(length("source_media_sha256") = 64 AND "source_media_sha256" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "import_transcriptions_state_check" CHECK((
        "state" = 'dispatching'
        AND "transcript_key" IS NULL
        AND "transcript_sha256" IS NULL
        AND "provider" IS NULL
        AND "model" IS NULL
        AND "detected_language" IS NULL
        AND "usage_audio_milliseconds" IS NULL
        AND "usage_input_bytes" IS NULL
        AND "estimated_cost_micro_usd" IS NULL
        AND "cost_currency" IS NULL
        AND "cost_certainty" IS NULL
        AND "segments_count" IS NULL
        AND "failure_code" IS NULL
        AND "completed_at" IS NULL
      ) OR (
        "state" = 'transcribed'
        AND "transcript_key" IS NOT NULL
        AND length("transcript_sha256") = 64
        AND "transcript_sha256" NOT GLOB '*[^0-9a-f]*'
        AND length("provider") BETWEEN 1 AND 64
        AND length("model") BETWEEN 1 AND 64
        AND "detected_language" GLOB '[a-z][a-z]'
        AND typeof("usage_audio_milliseconds") = 'integer'
        AND "usage_audio_milliseconds" > 0
        AND typeof("usage_input_bytes") = 'integer'
        AND "usage_input_bytes" > 0
        AND typeof("estimated_cost_micro_usd") = 'integer'
        AND "estimated_cost_micro_usd" >= 0
        AND "cost_currency" = 'USD'
        AND "cost_certainty" IN ('estimated', 'known')
        AND typeof("segments_count") = 'integer'
        AND "segments_count" > 0
        AND "failure_code" IS NULL
        AND "completed_at" IS NOT NULL
      ) OR (
        "state" = 'failed'
        AND "transcript_key" IS NULL
        AND "transcript_sha256" IS NULL
        AND "provider" IS NULL
        AND "model" IS NULL
        AND "detected_language" IS NULL
        AND "usage_audio_milliseconds" IS NULL
        AND "usage_input_bytes" IS NULL
        AND "estimated_cost_micro_usd" IS NULL
        AND "cost_currency" IS NULL
        AND "cost_certainty" IS NULL
        AND "segments_count" IS NULL
        AND "failure_code" IN (
          'audio_extraction_failed', 'outcome_unknown',
          'source_evidence_invalid', 'transcription_failed',
          'transcript_evidence_failed'
        )
        AND "completed_at" IS NOT NULL
      ))
);
--> statement-breakpoint
CREATE TABLE `import_visual_evidence` (
	`acquisition_generation` integer NOT NULL,
	`completed_at` text,
	`cost_certainty` text,
	`cost_currency` text,
	`created_at` text NOT NULL,
	`dispatch_id` text NOT NULL,
	`estimated_cost_micro_usd` integer,
	`failure_code` text,
	`import_id` text NOT NULL,
	`input_bytes` integer,
	`input_frames` integer,
	`manifest_key` text,
	`manifest_sha256` text,
	`model` text,
	`model_calls` integer,
	`observations_count` integer,
	`outcome` text,
	`provider` text,
	`source_media_sha256` text NOT NULL,
	`state` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT `import_visual_evidence_pk` PRIMARY KEY(`import_id`, `acquisition_generation`),
	CONSTRAINT `import_visual_evidence_import_generation_fk` FOREIGN KEY (`import_id`,`acquisition_generation`) REFERENCES `import_execution_runs`(`id`,`acquisition_generation`) ON UPDATE RESTRICT ON DELETE RESTRICT,
	CONSTRAINT "import_visual_evidence_generation_check" CHECK(typeof("acquisition_generation") = 'integer' AND "acquisition_generation" >= 0 AND "acquisition_generation" <= 9007199254740991),
	CONSTRAINT "import_visual_evidence_dispatch_id_check" CHECK(length("dispatch_id") BETWEEN 1 AND 100),
	CONSTRAINT "import_visual_evidence_source_sha_check" CHECK(length("source_media_sha256") = 64 AND "source_media_sha256" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "import_visual_evidence_state_check" CHECK((
        "state" = 'dispatching'
        AND "outcome" IS NULL
        AND "manifest_key" IS NULL
        AND "manifest_sha256" IS NULL
        AND "provider" IS NULL
        AND "model" IS NULL
        AND "input_frames" IS NULL
        AND "input_bytes" IS NULL
        AND "model_calls" IS NULL
        AND "estimated_cost_micro_usd" IS NULL
        AND "cost_currency" IS NULL
        AND "cost_certainty" IS NULL
        AND "observations_count" IS NULL
        AND "failure_code" IS NULL
        AND "completed_at" IS NULL
      ) OR (
        "state" = 'completed'
        AND "outcome" IN ('empty', 'found', 'low_confidence')
        AND "manifest_key" IS NOT NULL
        AND length("manifest_sha256") = 64
        AND "manifest_sha256" NOT GLOB '*[^0-9a-f]*'
        AND length("provider") BETWEEN 1 AND 64
        AND length("model") BETWEEN 1 AND 64
        AND typeof("input_frames") = 'integer'
        AND "input_frames" BETWEEN 1 AND 12
        AND typeof("input_bytes") = 'integer'
        AND "input_bytes" > 0
        AND typeof("model_calls") = 'integer'
        AND "model_calls" = 1
        AND typeof("estimated_cost_micro_usd") = 'integer'
        AND "estimated_cost_micro_usd" >= 0
        AND "cost_currency" = 'USD'
        AND "cost_certainty" IN ('estimated', 'known')
        AND typeof("observations_count") = 'integer'
        AND "observations_count" >= 0
        AND "failure_code" IS NULL
        AND "completed_at" IS NOT NULL
      ) OR (
        "state" = 'failed'
        AND "outcome" IS NULL
        AND "manifest_key" IS NULL
        AND "manifest_sha256" IS NULL
        AND "provider" IS NULL
        AND "model" IS NULL
        AND "input_frames" IS NULL
        AND "input_bytes" IS NULL
        AND "model_calls" IS NULL
        AND "estimated_cost_micro_usd" IS NULL
        AND "cost_currency" IS NULL
        AND "cost_certainty" IS NULL
        AND "observations_count" IS NULL
        AND "failure_code" IN (
          'frame_evidence_failed', 'frame_sampling_failed', 'outcome_unknown',
          'source_evidence_invalid', 'visual_evidence_failed',
          'visual_extraction_failed'
        )
        AND "completed_at" IS NOT NULL
      ))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `import_carousel_evidence_dispatch_id_unique` ON `import_carousel_evidence` (`dispatch_id`);--> statement-breakpoint
CREATE INDEX `import_carousel_evidence_state_updated_index` ON `import_carousel_evidence` (`state`,`updated_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `import_execution_runs_id_generation_unique` ON `import_execution_runs` (`id`,`acquisition_generation`);--> statement-breakpoint
CREATE UNIQUE INDEX `import_recipe_extractions_current_unique` ON `import_recipe_extractions` (`import_id`,`acquisition_generation`) WHERE "import_recipe_extractions"."is_current" = 1;--> statement-breakpoint
CREATE INDEX `import_recipe_extractions_state_updated_index` ON `import_recipe_extractions` (`state`,`updated_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `import_transcriptions_dispatch_id_unique` ON `import_transcriptions` (`dispatch_id`);--> statement-breakpoint
CREATE INDEX `import_transcriptions_state_updated_index` ON `import_transcriptions` (`state`,`updated_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `import_visual_evidence_dispatch_id_unique` ON `import_visual_evidence` (`dispatch_id`);--> statement-breakpoint
CREATE INDEX `import_visual_evidence_state_updated_index` ON `import_visual_evidence` (`state`,`updated_at`);
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
  UPDATE `import_execution_runs`
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
  UPDATE `import_execution_runs`
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
  UPDATE `import_execution_runs`
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
    REFERENCES `import_execution_runs`(`id`, `acquisition_generation`)
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
    REFERENCES `import_execution_runs`(`id`, `acquisition_generation`)
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

  UPDATE `import_execution_runs`
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
    REFERENCES `import_execution_runs`(`id`, `acquisition_generation`)
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
        JOIN `import_execution_runs` AS parent
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
    REFERENCES `import_execution_runs`(`id`, `acquisition_generation`)
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
        JOIN `import_execution_runs` AS parent
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
  FROM `import_execution_runs` AS parent
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
        JOIN `import_execution_runs` AS parent
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
    REFERENCES `import_execution_runs` (`id`, `acquisition_generation`)
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
        FROM `import_execution_runs` AS parent
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
        FROM `import_execution_runs` AS parent
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

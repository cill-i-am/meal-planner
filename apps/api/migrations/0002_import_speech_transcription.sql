PRAGMA defer_foreign_keys=ON;--> statement-breakpoint
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
);--> statement-breakpoint
INSERT INTO `__new_recipe_imports`(
  `acquisition_generation`, `canonical_source_id`, `compatibility_fingerprint`,
  `created_at`, `evidence_references_json`, `id`, `recovery_action`,
  `source_kind`, `status`, `status_code`, `updated_at`
) SELECT
  `acquisition_generation`, `canonical_source_id`, `compatibility_fingerprint`,
  `created_at`, `evidence_references_json`, `id`, `recovery_action`,
  `source_kind`, `status`, `status_code`, `updated_at`
FROM `recipe_imports`;--> statement-breakpoint
CREATE TABLE `__new_import_requests` (
	`created_at` text NOT NULL,
	`idempotency_key_hash` text NOT NULL PRIMARY KEY,
	`import_id` text NOT NULL,
	`request_fingerprint` text NOT NULL,
	`source_locator_hash` text NOT NULL,
	CONSTRAINT `fk_import_requests_import_id_recipe_imports_id_fk` FOREIGN KEY (`import_id`) REFERENCES `__new_recipe_imports`(`id`) ON UPDATE RESTRICT ON DELETE RESTRICT
);--> statement-breakpoint
INSERT INTO `__new_import_requests`(
  `created_at`, `idempotency_key_hash`, `import_id`, `request_fingerprint`,
  `source_locator_hash`
) SELECT
  `created_at`, `idempotency_key_hash`, `import_id`, `request_fingerprint`,
  `source_locator_hash`
FROM `import_requests`;--> statement-breakpoint
DROP TABLE `import_requests`;--> statement-breakpoint
DROP TABLE `recipe_imports`;--> statement-breakpoint
ALTER TABLE `__new_recipe_imports` RENAME TO `recipe_imports`;--> statement-breakpoint
ALTER TABLE `__new_import_requests` RENAME TO `import_requests`;--> statement-breakpoint
CREATE INDEX `import_requests_import_id_index` ON `import_requests` (`import_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `recipe_imports_canonical_identity_unique` ON `recipe_imports` (`source_kind`,`canonical_source_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `recipe_imports_id_generation_unique` ON `recipe_imports` (`id`,`acquisition_generation`);--> statement-breakpoint
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
);--> statement-breakpoint
CREATE UNIQUE INDEX `import_transcriptions_dispatch_id_unique` ON `import_transcriptions` (`dispatch_id`);--> statement-breakpoint
CREATE INDEX `import_transcriptions_state_updated_index` ON `import_transcriptions` (`state`,`updated_at`);--> statement-breakpoint
CREATE TRIGGER `import_transcriptions_identity_immutable`
BEFORE UPDATE ON `import_transcriptions`
WHEN NEW.`import_id` <> OLD.`import_id`
  OR NEW.`acquisition_generation` <> OLD.`acquisition_generation`
  OR NEW.`dispatch_id` <> OLD.`dispatch_id`
  OR NEW.`source_media_sha256` <> OLD.`source_media_sha256`
BEGIN
  SELECT RAISE(ABORT, 'import transcription identity is immutable');
END;--> statement-breakpoint
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
END;--> statement-breakpoint
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
END;--> statement-breakpoint
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
END;--> statement-breakpoint
PRAGMA foreign_key_check;

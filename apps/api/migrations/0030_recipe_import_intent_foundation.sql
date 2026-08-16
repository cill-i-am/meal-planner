ALTER TABLE `recipe_imports` ADD `household_scope_id` text NOT NULL DEFAULT '1111111111111111111111111111111111111111111111111111111111111111';
ALTER TABLE `recipe_imports` ADD `actor_id` text NOT NULL DEFAULT '0000000000000000000000000000000000000000000000000000000000000000';
ALTER TABLE `recipe_imports` ADD `intent_version` integer NOT NULL DEFAULT 1;
ALTER TABLE `recipe_imports` ADD `submitted_source_url` text;
ALTER TABLE `recipe_imports` ADD `resolved_canonical_source_id` text;
ALTER TABLE `recipe_imports` ADD `public_source_url` text;
ALTER TABLE `recipe_imports` ADD `public_source_kind` text;
ALTER TABLE `recipe_imports` ADD `public_status` text NOT NULL DEFAULT 'processing';
ALTER TABLE `recipe_imports` ADD `public_stage` text;
ALTER TABLE `recipe_imports` ADD `public_stage_started_at` text;
ALTER TABLE `recipe_imports` ADD `public_activity` text;
ALTER TABLE `recipe_imports` ADD `public_next_attempt_at` text;
ALTER TABLE `recipe_imports` ADD `active_action_id` text;
ALTER TABLE `recipe_imports` ADD `public_recipe_id` text;
ALTER TABLE `recipe_imports` ADD `public_failure_code` text;
ALTER TABLE `recipe_imports` ADD `public_failure_message` text;
ALTER TABLE `recipe_imports` ADD `public_recovery` text;
ALTER TABLE `recipe_imports` ADD `failed_at` text;
ALTER TABLE `recipe_imports` ADD `cancelled_at` text;
ALTER TABLE `recipe_imports` ADD `succeeded_at` text;
ALTER TABLE `recipe_imports` ADD `redirected_at` text;
ALTER TABLE `recipe_imports` ADD `redirected_to_import_id` text REFERENCES `recipe_imports`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `recipe_imports` ADD `execution_generation` integer NOT NULL DEFAULT 0;
ALTER TABLE `recipe_imports` ADD `executor_owner_id` text;
ALTER TABLE `recipe_imports` ADD `transition_mutation_id` text;
ALTER TABLE `recipe_imports` ADD `transition_command_digest` text;
ALTER TABLE `recipe_imports` ADD `transition_actor_category` text;
ALTER TABLE `recipe_imports` ADD `transition_actor_identity_hash` text;
ALTER TABLE `recipe_imports` ADD `transition_provenance_version` integer;

UPDATE `recipe_imports`
SET
  `resolved_canonical_source_id` = `canonical_source_id`,
  `public_source_url` = 'https://www.tiktok.com/video/' || `canonical_source_id`,
  `public_source_kind` = CASE
    WHEN EXISTS (
      SELECT 1
      FROM `import_carousel_evidence` AS `carousel`
      WHERE `carousel`.`import_id` = `recipe_imports`.`id`
        AND `carousel`.`acquisition_generation` = `recipe_imports`.`acquisition_generation`
    ) THEN 'carousel'
    ELSE 'video'
  END,
  `public_status` = CASE
    WHEN EXISTS (
      SELECT 1
      FROM `import_recipe_extractions` AS `extraction`
      JOIN `recipe_reviews` AS `review`
        ON `review`.`extraction_fingerprint` = `extraction`.`extraction_fingerprint`
      WHERE `extraction`.`import_id` = `recipe_imports`.`id`
        AND `extraction`.`is_current` = 1
        AND `review`.`lifecycle` = 'approved'
    ) THEN 'succeeded'
    WHEN EXISTS (
      SELECT 1
      FROM `import_recipe_extractions` AS `extraction`
      JOIN `recipe_reviews` AS `review`
        ON `review`.`extraction_fingerprint` = `extraction`.`extraction_fingerprint`
      WHERE `extraction`.`import_id` = `recipe_imports`.`id`
        AND `extraction`.`is_current` = 1
        AND `review`.`lifecycle` = 'needs_review'
    ) THEN 'requires_action'
    WHEN EXISTS (
      SELECT 1
      FROM `import_recipe_terminal_projections` AS `terminal`
      WHERE `terminal`.`import_id` = `recipe_imports`.`id`
        AND `terminal`.`acquisition_generation` = `recipe_imports`.`acquisition_generation`
    ) THEN 'failed'
    WHEN EXISTS (
      SELECT 1
      FROM `import_recipe_extractions` AS `extraction`
      JOIN `recipe_reviews` AS `review`
        ON `review`.`extraction_fingerprint` = `extraction`.`extraction_fingerprint`
      WHERE `extraction`.`import_id` = `recipe_imports`.`id`
        AND `extraction`.`is_current` = 1
        AND `review`.`lifecycle` = 'rejected'
    ) THEN 'failed'
    WHEN `status` IN ('failed', 'unsupported') THEN 'failed'
    ELSE 'processing'
  END,
  `active_action_id` = CASE
    WHEN EXISTS (
      SELECT 1
      FROM `import_recipe_extractions` AS `extraction`
      JOIN `recipe_reviews` AS `review`
        ON `review`.`extraction_fingerprint` = `extraction`.`extraction_fingerprint`
      WHERE `extraction`.`import_id` = `recipe_imports`.`id`
        AND `extraction`.`is_current` = 1
        AND `review`.`lifecycle` = 'needs_review'
    ) THEN (
      SELECT `extraction`.`extraction_fingerprint`
      FROM `import_recipe_extractions` AS `extraction`
      WHERE `extraction`.`import_id` = `recipe_imports`.`id`
        AND `extraction`.`is_current` = 1
      LIMIT 1
    )
    ELSE NULL
  END,
  `public_recipe_id` = CASE
    WHEN EXISTS (
      SELECT 1
      FROM `import_recipe_extractions` AS `extraction`
      JOIN `recipe_reviews` AS `review`
        ON `review`.`extraction_fingerprint` = `extraction`.`extraction_fingerprint`
      WHERE `extraction`.`import_id` = `recipe_imports`.`id`
        AND `extraction`.`is_current` = 1
        AND `review`.`lifecycle` = 'approved'
    ) THEN `id`
    ELSE NULL
  END;

UPDATE `recipe_imports`
SET
  `public_stage` = CASE
    WHEN `public_status` <> 'processing' THEN NULL
    WHEN EXISTS (
      SELECT 1
      FROM `import_recipe_extractions` AS `extraction`
      WHERE `extraction`.`import_id` = `recipe_imports`.`id`
        AND `extraction`.`is_current` = 1
    ) THEN 'preparing_review'
    -- The legacy row alone cannot prove both evidence component states. Keep
    -- its public projection at the last truthful stage without joining child
    -- execution ledgers at read time.
    WHEN `status` IN ('transcribed', 'transcribing') THEN 'acquiring_media'
    ELSE 'acquiring_media'
  END,
  `public_stage_started_at` = CASE
    WHEN `public_status` = 'processing' THEN `updated_at`
    ELSE NULL
  END,
  `public_activity` = CASE
    WHEN `public_status` = 'processing' THEN 'working'
    ELSE NULL
  END,
  `failed_at` = CASE
    WHEN `public_status` = 'failed' THEN `updated_at`
    ELSE NULL
  END,
  `succeeded_at` = CASE
    WHEN `public_status` = 'succeeded' THEN `updated_at`
    ELSE NULL
  END,
  `public_failure_code` = CASE
    WHEN `public_status` <> 'failed' THEN NULL
    WHEN EXISTS (
      SELECT 1
      FROM `import_recipe_terminal_projections` AS `terminal`
      WHERE `terminal`.`import_id` = `recipe_imports`.`id`
        AND `terminal`.`acquisition_generation` = `recipe_imports`.`acquisition_generation`
    ) THEN 'recipe_extraction_failed'
    WHEN `status_code` = 'private_or_unavailable' THEN 'source_unavailable'
    WHEN `status_code` IN ('invalid_or_unsupported_media', 'unsupported_post_type') THEN 'invalid_media'
    WHEN `status_code` IN ('transcription_failed', 'acquisition_temporarily_unavailable') THEN 'analysis_failed'
    ELSE 'internal_error'
  END,
  `public_failure_message` = CASE
    WHEN `public_status` <> 'failed' THEN NULL
    WHEN `status_code` = 'private_or_unavailable' THEN 'The source is not available.'
    WHEN `status_code` IN ('invalid_or_unsupported_media', 'unsupported_post_type') THEN 'The source media is not supported.'
    WHEN `status_code` IN ('transcription_failed', 'acquisition_temporarily_unavailable') THEN 'The source could not be analyzed.'
    WHEN EXISTS (
      SELECT 1
      FROM `import_recipe_terminal_projections` AS `terminal`
      WHERE `terminal`.`import_id` = `recipe_imports`.`id`
        AND `terminal`.`acquisition_generation` = `recipe_imports`.`acquisition_generation`
    ) THEN 'A recipe could not be extracted from this source.'
    ELSE 'This import did not produce a recipe.'
  END,
  `public_recovery` = CASE
    WHEN `public_status` <> 'failed' THEN NULL
    WHEN EXISTS (
      SELECT 1
      FROM `import_recipe_terminal_projections` AS `terminal`
      WHERE `terminal`.`import_id` = `recipe_imports`.`id`
        AND `terminal`.`acquisition_generation` = `recipe_imports`.`acquisition_generation`
    ) THEN 'contact_support'
    ELSE 'create_new_intent'
  END;

DROP INDEX `recipe_imports_canonical_identity_unique`;

CREATE UNIQUE INDEX `recipe_imports_legacy_canonical_identity_unique`
  ON `recipe_imports` (`source_kind`, `canonical_source_id`)
  WHERE `submitted_source_url` IS NULL;

CREATE UNIQUE INDEX `recipe_imports_household_live_canonical_unique`
  ON `recipe_imports` (`household_scope_id`, `resolved_canonical_source_id`)
  WHERE `resolved_canonical_source_id` IS NOT NULL
    AND `public_status` IN ('processing', 'requires_action', 'succeeded');

CREATE INDEX `recipe_imports_household_id_index`
  ON `recipe_imports` (`household_scope_id`, `id`);

CREATE INDEX `recipe_imports_redirect_target_index`
  ON `recipe_imports` (`redirected_to_import_id`);

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
  AND NEW.`execution_generation` >= 0
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
  AND NEW.`execution_generation` >= 0
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

CREATE TRIGGER `recipe_imports_intent_state_insert_guard`
BEFORE INSERT ON `recipe_imports`
WHEN NEW.`submitted_source_url` IS NOT NULL AND NOT (
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

CREATE TRIGGER `recipe_imports_source_stage_insert_guard`
BEFORE INSERT ON `recipe_imports`
WHEN NEW.`submitted_source_url` IS NOT NULL
  AND NOT (
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
    NEW.`submitted_source_url` IS NOT NULL
    AND NEW.`public_status` = 'processing'
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

CREATE TRIGGER `recipe_imports_source_stage_update_guard`
BEFORE UPDATE OF
  `submitted_source_url`, `resolved_canonical_source_id`, `public_source_url`,
  `public_source_kind`, `public_status`, `public_stage`
ON `recipe_imports`
WHEN NEW.`submitted_source_url` IS NOT NULL
  AND NOT (
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
    NEW.`submitted_source_url` IS NOT NULL
    AND NEW.`public_status` = 'processing'
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

CREATE TRIGGER `recipe_imports_stage_started_at_guard`
BEFORE UPDATE OF `public_stage_started_at` ON `recipe_imports`
WHEN OLD.`public_status` = 'processing'
  AND NEW.`public_status` = 'processing'
  AND OLD.`public_stage` = NEW.`public_stage`
  AND OLD.`public_stage_started_at` <> NEW.`public_stage_started_at`
BEGIN
  SELECT RAISE(ABORT, 'recipe import intent stage started_at is immutable');
END;

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
      OR NEW.`resolved_canonical_source_id` IS NOT OLD.`resolved_canonical_source_id`
      OR NEW.`public_source_url` IS NOT OLD.`public_source_url`
      OR NEW.`public_source_kind` IS NOT OLD.`public_source_kind`
      OR NEW.`active_action_id` IS NOT OLD.`active_action_id`
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
      OR NEW.`resolved_canonical_source_id` IS NOT OLD.`resolved_canonical_source_id`
      OR NEW.`public_source_url` IS NOT OLD.`public_source_url`
      OR NEW.`public_source_kind` IS NOT OLD.`public_source_kind`
      OR NEW.`active_action_id` IS NOT OLD.`active_action_id`
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
BEGIN
  SELECT RAISE(ABORT, 'recipe import intent version must match one meaningful transition');
END;

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
  `failure_code` text,
  PRIMARY KEY (`intent_id`, `intent_version`),
  CONSTRAINT `recipe_import_intent_history_intent_fk`
    FOREIGN KEY (`intent_id`) REFERENCES `recipe_imports`(`id`)
      ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `recipe_import_intent_history_version_check`
    CHECK (typeof(`intent_version`) = 'integer' AND `intent_version` >= 1),
  CONSTRAINT `recipe_import_intent_history_event_check`
    CHECK (`event_type` IN (
      'migration_snapshot', 'intent_admitted', 'source_resolved',
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
      `actor_category` IN ('migration', 'household_member', 'system', 'support')
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

CREATE UNIQUE INDEX `recipe_import_intent_history_mutation_unique`
  ON `recipe_import_intent_history` (`intent_id`, `mutation_id`)
  WHERE `mutation_id` IS NOT NULL;

INSERT INTO `recipe_import_intent_history` (
  `intent_id`, `intent_version`, `event_type`, `occurred_at`, `public_status`,
  `public_stage`, `public_activity`, `public_next_attempt_at`,
  `public_source_url`, `redirected_to_import_id`, `action_id`, `recipe_id`,
  `failure_code`, `mutation_id`, `command_digest`, `actor_category`,
  `actor_identity_hash`, `from_public_status`, `from_public_stage`,
  `to_public_status`, `to_public_stage`
)
SELECT
  `id`, `intent_version`, 'migration_snapshot', `updated_at`, `public_status`,
  `public_stage`, `public_activity`, `public_next_attempt_at`,
  `public_source_url`, `redirected_to_import_id`, `active_action_id`,
  `public_recipe_id`, `public_failure_code`, NULL, NULL, 'migration', NULL,
  NULL, NULL, `public_status`, `public_stage`
FROM `recipe_imports`;

CREATE TRIGGER `recipe_import_intent_history_update_guard`
BEFORE UPDATE ON `recipe_import_intent_history`
BEGIN
  SELECT RAISE(ABORT, 'recipe import intent history is append-only');
END;

CREATE TRIGGER `recipe_import_intent_history_delete_guard`
BEFORE DELETE ON `recipe_import_intent_history`
BEGIN
  SELECT RAISE(ABORT, 'recipe import intent history is append-only');
END;

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

CREATE TRIGGER `recipe_import_intent_transition_history`
AFTER UPDATE OF `intent_version` ON `recipe_imports`
WHEN NEW.`intent_version` = OLD.`intent_version` + 1
BEGIN
  INSERT INTO `recipe_import_intent_history` (
    `intent_id`, `intent_version`, `event_type`, `occurred_at`,
    `mutation_id`, `command_digest`, `actor_category`, `actor_identity_hash`,
    `from_public_status`, `from_public_stage`, `to_public_status`,
    `to_public_stage`, `public_status`, `public_stage`, `public_activity`,
    `public_next_attempt_at`, `public_source_url`, `redirected_to_import_id`,
    `action_id`, `recipe_id`, `failure_code`
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
    NEW.`public_activity`, NEW.`public_next_attempt_at`,
    NEW.`public_source_url`, NEW.`redirected_to_import_id`,
    NEW.`active_action_id`, NEW.`public_recipe_id`, NEW.`public_failure_code`
  );
END;

CREATE TABLE `__new_import_requests` (
  `household_scope_id` text NOT NULL DEFAULT '1111111111111111111111111111111111111111111111111111111111111111',
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

INSERT INTO `__new_import_requests` (
  `created_at`, `idempotency_key_hash`, `import_id`, `request_fingerprint`,
  `source_locator_hash`
)
SELECT
  `created_at`, `idempotency_key_hash`, `import_id`, `request_fingerprint`,
  `source_locator_hash`
FROM `import_requests`;

DROP TABLE `import_requests`;
ALTER TABLE `__new_import_requests` RENAME TO `import_requests`;

CREATE INDEX `import_requests_import_id_index`
  ON `import_requests` (`import_id`);

PRAGMA foreign_key_check;

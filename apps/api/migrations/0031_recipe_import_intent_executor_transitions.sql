ALTER TABLE `recipe_imports` ADD `public_speech` text;
ALTER TABLE `recipe_imports` ADD `public_visuals` text;

ALTER TABLE `recipe_import_intent_history` ADD `public_speech` text;
ALTER TABLE `recipe_import_intent_history` ADD `public_visuals` text;
ALTER TABLE `recipe_import_intent_history` ADD `public_source_kind` text;
ALTER TABLE `recipe_import_intent_history` ADD `public_stage_started_at` text;

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

DROP TRIGGER `recipe_imports_intent_version_advance_guard`;

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

DROP TRIGGER `recipe_import_intent_transition_history`;

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

PRAGMA foreign_key_check;

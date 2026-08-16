ALTER TABLE `recipe_imports` ADD `active_action_version` integer;

UPDATE `recipe_imports`
SET `active_action_version` = CASE
  WHEN `public_status` = 'requires_action' THEN (
    SELECT `review`.`version` + 1
      FROM `import_recipe_extractions` AS `extraction`
      JOIN `recipe_reviews` AS `review`
        ON `review`.`extraction_fingerprint` = `extraction`.`extraction_fingerprint`
     WHERE `extraction`.`import_id` = `recipe_imports`.`id`
       AND `extraction`.`is_current` = 1
       AND `review`.`lifecycle` = 'needs_review'
     LIMIT 1
  )
  ELSE NULL
END;

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

UPDATE `recipe_imports`
SET `active_action_version` = `active_action_version`;

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

DROP TRIGGER `recipe_review_corrections_append_only_update`;
DROP TRIGGER `recipe_review_corrections_append_only_delete`;

CREATE TABLE `__new_recipe_review_corrections` (
  `extraction_fingerprint` text NOT NULL,
  `version` integer NOT NULL,
  `ordinal` integer NOT NULL DEFAULT 0,
  `actor_id` text NOT NULL,
  `field` text NOT NULL,
  `before_json` text NOT NULL,
  `after_json` text NOT NULL,
  `reason` text NOT NULL,
  `tags_before_json` text NOT NULL,
  `tags_after_json` text NOT NULL,
  `corrected_at` text NOT NULL,
  PRIMARY KEY (`extraction_fingerprint`, `version`, `ordinal`),
  CONSTRAINT `recipe_review_corrections_review_fk`
    FOREIGN KEY (`extraction_fingerprint`)
    REFERENCES `recipe_reviews`(`extraction_fingerprint`)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT `recipe_review_corrections_version_check`
    CHECK(typeof(`version`) = 'integer' AND `version` > 0 AND `version` <= 9007199254740991),
  CONSTRAINT `recipe_review_corrections_ordinal_check`
    CHECK(typeof(`ordinal`) = 'integer' AND `ordinal` >= 0 AND `ordinal` <= 9007199254740991),
  CONSTRAINT `recipe_review_corrections_actor_check`
    CHECK(length(`actor_id`) BETWEEN 1 AND 128),
  CONSTRAINT `recipe_review_corrections_field_check`
    CHECK(`field` IN ('author', 'category', 'cook_time_minutes', 'cuisine', 'description', 'ingredient_lines', 'ingredient_quantities', 'ingredient_units', 'instructions', 'name', 'nutrition', 'prep_time_minutes', 'tags', 'temperature_celsius', 'tools', 'total_time_minutes', 'yield')),
  CONSTRAINT `recipe_review_corrections_json_check`
    CHECK(json_valid(`before_json`) AND json_valid(`after_json`) AND json_valid(`tags_before_json`) AND json_valid(`tags_after_json`)),
  CONSTRAINT `recipe_review_corrections_reason_check`
    CHECK(length(`reason`) BETWEEN 1 AND 4096)
);

INSERT INTO `__new_recipe_review_corrections` (
  `extraction_fingerprint`, `version`, `ordinal`, `actor_id`, `field`,
  `before_json`, `after_json`, `reason`, `tags_before_json`,
  `tags_after_json`, `corrected_at`
)
SELECT
  `extraction_fingerprint`, `version`, 0, `actor_id`, `field`,
  `before_json`, `after_json`, `reason`, `tags_before_json`,
  `tags_after_json`, `corrected_at`
FROM `recipe_review_corrections`;

DROP TABLE `recipe_review_corrections`;
ALTER TABLE `__new_recipe_review_corrections`
RENAME TO `recipe_review_corrections`;

CREATE TRIGGER `recipe_review_corrections_append_only_update`
BEFORE UPDATE ON `recipe_review_corrections`
BEGIN
  SELECT RAISE(ABORT, 'recipe review corrections are append-only');
END;

CREATE TRIGGER `recipe_review_corrections_append_only_delete`
BEFORE DELETE ON `recipe_review_corrections`
BEGIN
  SELECT RAISE(ABORT, 'recipe review corrections are append-only');
END;

DROP TRIGGER `recipe_review_mutations_append_only_update`;
DROP TRIGGER `recipe_review_mutations_append_only_delete`;

ALTER TABLE `recipe_review_mutations`
ADD `item_count` integer
CONSTRAINT `recipe_review_mutations_item_count_check`
CHECK(
  `item_count` IS NULL OR (
    typeof(`item_count`) = 'integer'
    AND `item_count` > 0
    AND `item_count` <= 9007199254740991
  )
);

UPDATE `recipe_review_mutations`
SET `item_count` = 1;

CREATE TRIGGER `recipe_review_mutations_append_only_update`
BEFORE UPDATE ON `recipe_review_mutations`
BEGIN
  SELECT RAISE(ABORT, 'recipe review mutations are append-only');
END;

CREATE TRIGGER `recipe_review_mutations_append_only_delete`
BEFORE DELETE ON `recipe_review_mutations`
BEGIN
  SELECT RAISE(ABORT, 'recipe review mutations are append-only');
END;

-- An explicit item count marks an intent-managed receipt. Legacy repository
-- writes omit it and retain their established receipt-before-detail order.
-- Workerd enforces SQLite's expression-depth limit, so the final receipt gate
-- is split by invariant; every part runs before the same INSERT can commit.
CREATE TRIGGER `recipe_review_mutations_intent_correction_root_completeness`
BEFORE INSERT ON `recipe_review_mutations`
WHEN NEW.`item_count` IS NOT NULL
  AND NEW.`command_kind` = 'correction'
  AND NOT EXISTS (
        SELECT 1
          FROM `import_recipe_extractions` AS `extraction`
          JOIN `recipe_imports` AS `intent`
            ON `intent`.`id` = `extraction`.`import_id`
          JOIN `recipe_reviews` AS `review`
            ON `review`.`extraction_fingerprint` = `extraction`.`extraction_fingerprint`
          JOIN `recipe_import_intent_history` AS `history`
            ON `history`.`intent_id` = `intent`.`id`
           AND `history`.`intent_version` = `intent`.`intent_version`
         WHERE `extraction`.`extraction_fingerprint` = NEW.`extraction_fingerprint`
           AND `extraction`.`is_current` = 1
           AND `review`.`lifecycle` = 'needs_review'
           AND `review`.`version` = NEW.`resulting_version`
           AND `review`.`updated_at` = NEW.`applied_at`
           AND `intent`.`public_status` = 'requires_action'
           AND `intent`.`active_action_id` IS NOT NULL
           AND `intent`.`active_action_version` = NEW.`resulting_version` + 1
           AND `intent`.`updated_at` = NEW.`applied_at`
           AND `intent`.`transition_mutation_id` = NEW.`mutation_id`
           AND `intent`.`transition_command_digest` = NEW.`command_digest`
           AND `intent`.`transition_actor_category` = 'household_member'
           AND `intent`.`transition_actor_identity_hash` IS NOT NULL
           AND `intent`.`transition_provenance_version` = `intent`.`intent_version`
           AND `history`.`event_type` = 'action_available'
           AND `history`.`occurred_at` = NEW.`applied_at`
           AND `history`.`mutation_id` = NEW.`mutation_id`
           AND `history`.`command_digest` = NEW.`command_digest`
           AND `history`.`actor_category` = 'household_member'
           AND `history`.`actor_identity_hash` = `intent`.`transition_actor_identity_hash`
           AND `history`.`from_public_status` = 'requires_action'
           AND `history`.`to_public_status` = 'requires_action'
           AND `history`.`public_status` = 'requires_action'
           AND `history`.`action_id` = `intent`.`active_action_id`
  )
BEGIN
  SELECT RAISE(ABORT, 'incomplete intent-managed recipe review receipt');
END;

CREATE TRIGGER `recipe_review_mutations_intent_correction_detail_completeness`
BEFORE INSERT ON `recipe_review_mutations`
WHEN NEW.`item_count` IS NOT NULL
  AND NEW.`command_kind` = 'correction'
  AND NOT EXISTS (
    SELECT 1
      FROM `import_recipe_extractions` AS `extraction`
      JOIN `recipe_imports` AS `intent`
        ON `intent`.`id` = `extraction`.`import_id`
     WHERE `extraction`.`extraction_fingerprint` = NEW.`extraction_fingerprint`
       AND `extraction`.`is_current` = 1
       AND `intent`.`transition_actor_identity_hash` IS NOT NULL
       AND (
         SELECT count(*)
           FROM `recipe_review_corrections` AS `correction`
          WHERE `correction`.`extraction_fingerprint` = NEW.`extraction_fingerprint`
            AND `correction`.`version` = NEW.`resulting_version`
            AND `correction`.`actor_id` = `intent`.`transition_actor_identity_hash`
            AND `correction`.`corrected_at` = NEW.`applied_at`
       ) = NEW.`item_count`
       AND NOT EXISTS (
         SELECT 1
           FROM `recipe_review_corrections` AS `correction`
          WHERE `correction`.`extraction_fingerprint` = NEW.`extraction_fingerprint`
            AND `correction`.`version` = NEW.`resulting_version`
            AND (
              `correction`.`actor_id` <> `intent`.`transition_actor_identity_hash`
              OR `correction`.`corrected_at` <> NEW.`applied_at`
            )
       )
  )
BEGIN
  SELECT RAISE(ABORT, 'incomplete intent-managed recipe review receipt');
END;

CREATE TRIGGER `recipe_review_mutations_intent_transition_root_completeness`
BEFORE INSERT ON `recipe_review_mutations`
WHEN NEW.`item_count` IS NOT NULL
  AND NEW.`command_kind` = 'transition'
  AND NOT EXISTS (
        SELECT 1
          FROM `import_recipe_extractions` AS `extraction`
          JOIN `recipe_imports` AS `intent`
            ON `intent`.`id` = `extraction`.`import_id`
          JOIN `recipe_reviews` AS `review`
            ON `review`.`extraction_fingerprint` = `extraction`.`extraction_fingerprint`
         WHERE `extraction`.`extraction_fingerprint` = NEW.`extraction_fingerprint`
           AND `extraction`.`is_current` = 1
           AND `review`.`lifecycle` = 'approved'
           AND `review`.`version` = NEW.`resulting_version`
           AND `review`.`updated_at` = NEW.`applied_at`
           AND `review`.`tags_json` IS NOT NULL
           AND `intent`.`public_status` = 'succeeded'
           AND `intent`.`public_recipe_id` = `intent`.`id`
           AND `intent`.`active_action_id` IS NULL
           AND `intent`.`active_action_version` IS NULL
           AND `intent`.`succeeded_at` = NEW.`applied_at`
           AND `intent`.`updated_at` = NEW.`applied_at`
           AND `intent`.`transition_mutation_id` IS NOT NEW.`mutation_id`
           AND `intent`.`transition_command_digest` = NEW.`command_digest`
           AND `intent`.`transition_actor_category` = 'household_member'
           AND `intent`.`transition_actor_identity_hash` IS NOT NULL
           AND `intent`.`transition_provenance_version` = `intent`.`intent_version`
    )
BEGIN
  SELECT RAISE(ABORT, 'incomplete intent-managed recipe review receipt');
END;

CREATE TRIGGER `recipe_review_mutations_intent_transition_history_completeness`
BEFORE INSERT ON `recipe_review_mutations`
WHEN NEW.`item_count` IS NOT NULL
  AND NEW.`command_kind` = 'transition'
  AND NOT EXISTS (
    SELECT 1
      FROM `import_recipe_extractions` AS `extraction`
      JOIN `recipe_imports` AS `intent`
        ON `intent`.`id` = `extraction`.`import_id`
      JOIN `recipe_import_intent_history` AS `finalizing_history`
        ON `finalizing_history`.`intent_id` = `intent`.`id`
       AND `finalizing_history`.`intent_version` = `intent`.`intent_version` - 1
      JOIN `recipe_import_intent_history` AS `succeeded_history`
        ON `succeeded_history`.`intent_id` = `intent`.`id`
       AND `succeeded_history`.`intent_version` = `intent`.`intent_version`
     WHERE `extraction`.`extraction_fingerprint` = NEW.`extraction_fingerprint`
       AND `extraction`.`is_current` = 1
       AND `finalizing_history`.`event_type` = 'processing_stage_changed'
       AND `finalizing_history`.`occurred_at` = NEW.`applied_at`
       AND `finalizing_history`.`mutation_id` = NEW.`mutation_id`
       AND `finalizing_history`.`command_digest` = NEW.`command_digest`
       AND `finalizing_history`.`actor_category` = 'household_member'
       AND `finalizing_history`.`actor_identity_hash` = `intent`.`transition_actor_identity_hash`
       AND `finalizing_history`.`from_public_status` = 'requires_action'
       AND `finalizing_history`.`to_public_status` = 'processing'
       AND `finalizing_history`.`to_public_stage` = 'finalizing_recipe'
       AND `finalizing_history`.`public_status` = 'processing'
       AND `finalizing_history`.`public_stage` = 'finalizing_recipe'
       AND `succeeded_history`.`event_type` = 'intent_succeeded'
       AND `succeeded_history`.`occurred_at` = NEW.`applied_at`
       AND `succeeded_history`.`mutation_id` = `intent`.`transition_mutation_id`
       AND `succeeded_history`.`mutation_id` IS NOT NEW.`mutation_id`
       AND `succeeded_history`.`command_digest` = NEW.`command_digest`
       AND `succeeded_history`.`actor_category` = 'household_member'
       AND `succeeded_history`.`actor_identity_hash` = `intent`.`transition_actor_identity_hash`
       AND `succeeded_history`.`from_public_status` = 'processing'
       AND `succeeded_history`.`from_public_stage` = 'finalizing_recipe'
       AND `succeeded_history`.`to_public_status` = 'succeeded'
       AND `succeeded_history`.`public_status` = 'succeeded'
       AND `succeeded_history`.`recipe_id` = `intent`.`public_recipe_id`
  )
BEGIN
  SELECT RAISE(ABORT, 'incomplete intent-managed recipe review receipt');
END;

CREATE TRIGGER `recipe_review_mutations_intent_transition_detail_completeness`
BEFORE INSERT ON `recipe_review_mutations`
WHEN NEW.`item_count` IS NOT NULL
  AND NEW.`command_kind` = 'transition'
  AND (
    NEW.`item_count` <> 1
    OR NOT EXISTS (
      SELECT 1
        FROM `import_recipe_extractions` AS `extraction`
        JOIN `recipe_imports` AS `intent`
          ON `intent`.`id` = `extraction`.`import_id`
        JOIN `recipe_review_transitions` AS `transition`
          ON `transition`.`extraction_fingerprint` = `extraction`.`extraction_fingerprint`
         AND `transition`.`version` = NEW.`resulting_version`
       WHERE `extraction`.`extraction_fingerprint` = NEW.`extraction_fingerprint`
         AND `extraction`.`is_current` = 1
         AND `transition`.`actor_id` = `intent`.`transition_actor_identity_hash`
         AND `transition`.`from_lifecycle` = 'needs_review'
         AND `transition`.`to_lifecycle` = 'approved'
         AND `transition`.`transitioned_at` = NEW.`applied_at`
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'incomplete intent-managed recipe review receipt');
END;

PRAGMA foreign_key_check;

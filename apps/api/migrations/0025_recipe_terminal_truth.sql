DROP TRIGGER `import_provider_terminal_checkpoints_fail_recipe`;

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

  INSERT INTO `import_recipe_terminal_projections` (
    `acquisition_generation`,
    `evidence_references_json`,
    `import_id`,
    `ownership_id`,
    `projected_at`,
    `recovery_action`,
    `status`,
    `status_code`
  )
  SELECT
    parent.`acquisition_generation`,
    parent.`evidence_references_json`,
    parent.`id`,
    NEW.`ownership_id`,
    NEW.`completed_at`,
    'operator_reconcile',
    'failed',
    'recipe_extraction_failed'
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
        FROM `import_recipe_terminal_projections` AS projection
        JOIN `recipe_imports` AS parent
          ON parent.`id` = projection.`import_id`
         AND parent.`acquisition_generation` =
               projection.`acquisition_generation`
       WHERE projection.`import_id` = NEW.`import_id`
         AND projection.`acquisition_generation` =
               NEW.`acquisition_generation`
         AND projection.`ownership_id` = NEW.`ownership_id`
         AND projection.`projected_at` = NEW.`completed_at`
         AND projection.`status` = 'failed'
         AND projection.`status_code` = 'recipe_extraction_failed'
         AND projection.`recovery_action` = 'operator_reconcile'
         AND projection.`evidence_references_json` =
               parent.`evidence_references_json`
    ) THEN NULL
    ELSE RAISE(ABORT, 'recipe terminal checkpoint projection rejected')
  END;
END;

INSERT INTO `import_provider_terminal_checkpoints` (
  `import_id`,
  `acquisition_generation`,
  `provider_stage`,
  `ownership_id`,
  `failure_code`,
  `completed_at`,
  `created_at`
)
SELECT
  extraction.`import_id`,
  extraction.`acquisition_generation`,
  'recipe',
  extraction.`extraction_fingerprint`,
  extraction.`failure_code`,
  extraction.`completed_at`,
  extraction.`completed_at`
FROM `import_recipe_extractions` AS extraction
JOIN `recipe_imports` AS parent
  ON parent.`id` = extraction.`import_id`
 AND parent.`acquisition_generation` = extraction.`acquisition_generation`
WHERE extraction.`state` = 'failed'
  AND extraction.`failure_code` IS NOT NULL
  AND extraction.`completed_at` IS NOT NULL
  AND (
    (
      parent.`status` = 'queued'
      AND json_array_length(parent.`evidence_references_json`) = 0
    ) OR (
      parent.`status` = 'transcribed'
      AND json_array_length(parent.`evidence_references_json`) = 3
    )
  )
  AND NOT EXISTS (
    SELECT 1
      FROM `import_provider_terminal_checkpoints` AS checkpoint
     WHERE checkpoint.`import_id` = extraction.`import_id`
       AND checkpoint.`acquisition_generation` =
             extraction.`acquisition_generation`
       AND checkpoint.`provider_stage` = 'recipe'
  )
  AND NOT EXISTS (
    SELECT 1
      FROM `import_recipe_terminal_projections` AS projection
     WHERE projection.`import_id` = extraction.`import_id`
       AND projection.`acquisition_generation` =
             extraction.`acquisition_generation`
  )
  AND NOT EXISTS (
    SELECT 1
      FROM `import_recipe_extractions` AS newer
     WHERE newer.`import_id` = extraction.`import_id`
       AND newer.`acquisition_generation` = extraction.`acquisition_generation`
       AND newer.`state` = 'failed'
       AND (
         newer.`completed_at` > extraction.`completed_at`
         OR (
           newer.`completed_at` = extraction.`completed_at`
           AND newer.`extraction_fingerprint` >
                 extraction.`extraction_fingerprint`
         )
       )
  )
ON CONFLICT (
  `import_id`, `acquisition_generation`, `provider_stage`, `ownership_id`
) DO NOTHING;

PRAGMA foreign_key_check;

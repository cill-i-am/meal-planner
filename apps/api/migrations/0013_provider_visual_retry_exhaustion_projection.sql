PRAGMA foreign_keys = ON;

DROP TRIGGER `import_provider_terminal_checkpoints_fail_visual`;

CREATE TRIGGER `import_provider_terminal_checkpoints_fail_visual`
AFTER INSERT ON `import_provider_terminal_checkpoints`
WHEN NEW.`provider_stage` = 'visual'
BEGIN
  UPDATE `import_visual_evidence`
     SET `state` = 'failed',
         `failure_code` = CASE
           WHEN NEW.`failure_code` = 'outcome_unknown'
             THEN 'outcome_unknown'
           WHEN NEW.`failure_code` = 'visual_extraction_failed'
             THEN 'visual_extraction_failed'
           ELSE 'visual_evidence_failed'
         END,
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
         AND `failure_code` = CASE
           WHEN NEW.`failure_code` = 'outcome_unknown'
             THEN 'outcome_unknown'
           WHEN NEW.`failure_code` = 'visual_extraction_failed'
             THEN 'visual_extraction_failed'
           ELSE 'visual_evidence_failed'
         END
         AND `completed_at` = NEW.`completed_at`
    ) THEN NULL
    ELSE RAISE(ABORT, 'visual terminal checkpoint ownership rejected')
  END;
END;

PRAGMA foreign_key_check;

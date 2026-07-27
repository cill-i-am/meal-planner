PRAGMA foreign_keys = ON;

DROP TRIGGER `pilot_provider_speech_recoveries_prepare`;

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

PRAGMA foreign_keys = ON;

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

CREATE INDEX `import_provider_terminal_checkpoints_import_idx`
  ON `import_provider_terminal_checkpoints` (
    `import_id`,
    `acquisition_generation`,
    `provider_stage`,
    `completed_at`
  );

CREATE TRIGGER `import_provider_terminal_checkpoints_immutable_update`
BEFORE UPDATE ON `import_provider_terminal_checkpoints`
BEGIN
  SELECT RAISE(ABORT, 'provider terminal checkpoint is immutable');
END;

CREATE TRIGGER `import_provider_terminal_checkpoints_immutable_delete`
BEFORE DELETE ON `import_provider_terminal_checkpoints`
BEGIN
  SELECT RAISE(ABORT, 'provider terminal checkpoint is immutable');
END;

CREATE TRIGGER `import_provider_terminal_checkpoints_fail_speech`
AFTER INSERT ON `import_provider_terminal_checkpoints`
WHEN NEW.`provider_stage` = 'speech'
BEGIN
  UPDATE `import_transcriptions`
     SET `state` = 'failed',
         `failure_code` = CASE
           WHEN NEW.`failure_code` = 'outcome_unknown'
             THEN 'outcome_unknown'
           ELSE 'transcription_failed'
         END,
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

CREATE TRIGGER `import_provider_terminal_checkpoints_fail_visual`
AFTER INSERT ON `import_provider_terminal_checkpoints`
WHEN NEW.`provider_stage` = 'visual'
BEGIN
  UPDATE `import_visual_evidence`
     SET `state` = 'failed',
         `failure_code` = CASE
           WHEN NEW.`failure_code` = 'outcome_unknown'
             THEN 'outcome_unknown'
           ELSE 'visual_evidence_failed'
         END,
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
        FROM `import_visual_evidence`
       WHERE `import_id` = NEW.`import_id`
         AND `acquisition_generation` = NEW.`acquisition_generation`
         AND `dispatch_id` = NEW.`ownership_id`
         AND `state` = 'failed'
    ) THEN NULL
    ELSE RAISE(ABORT, 'visual terminal checkpoint ownership rejected')
  END;
END;

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
    ) THEN NULL
    ELSE RAISE(ABORT, 'recipe terminal checkpoint ownership rejected')
  END;
END;

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

CREATE TRIGGER `pilot_provider_budget_reconciliations_immutable_update`
BEFORE UPDATE ON `pilot_provider_budget_reconciliations`
BEGIN
  SELECT RAISE(ABORT, 'pilot provider budget reconciliation is immutable');
END;

CREATE TRIGGER `pilot_provider_budget_reconciliations_immutable_delete`
BEFORE DELETE ON `pilot_provider_budget_reconciliations`
BEGIN
  SELECT RAISE(ABORT, 'pilot provider budget reconciliation is immutable');
END;

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

CREATE UNIQUE INDEX `pilot_provider_speech_recoveries_recovery_dispatch_unique`
  ON `pilot_provider_speech_recoveries` (
    `runtime_stage`,
    `recovery_dispatch_id`
  );

CREATE TRIGGER `pilot_provider_speech_recoveries_immutable_update`
BEFORE UPDATE ON `pilot_provider_speech_recoveries`
BEGIN
  SELECT RAISE(ABORT, 'pilot provider speech recovery is immutable');
END;

CREATE TRIGGER `pilot_provider_speech_recoveries_immutable_delete`
BEFORE DELETE ON `pilot_provider_speech_recoveries`
BEGIN
  SELECT RAISE(ABORT, 'pilot provider speech recovery is immutable');
END;

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
         AND dispatch.`provider_stage_id` = 'speech_transcription'
         AND dispatch.`actual_cost_micro_usd` IS NULL
         AND dispatch.`maximum_cost_micro_usd` <=
               stage.`reserved_micro_usd`
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

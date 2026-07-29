PRAGMA foreign_keys = ON;

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

CREATE UNIQUE INDEX
  `pilot_provider_visual_second_recoveries_recovery_dispatch_unique`
  ON `pilot_provider_visual_second_recoveries` (
    `runtime_stage`,
    `recovery_dispatch_id`
  );

CREATE TRIGGER `pilot_provider_visual_second_recoveries_immutable_update`
BEFORE UPDATE ON `pilot_provider_visual_second_recoveries`
BEGIN
  SELECT RAISE(
    ABORT,
    'pilot provider second visual recovery is immutable'
  );
END;

CREATE TRIGGER `pilot_provider_visual_second_recoveries_immutable_delete`
BEFORE DELETE ON `pilot_provider_visual_second_recoveries`
BEGIN
  SELECT RAISE(
    ABORT,
    'pilot provider second visual recovery is immutable'
  );
END;

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
         AND checkpoint.`failure_code` = 'visual_extraction_failed'
        JOIN `import_visual_evidence` AS visual
          ON visual.`import_id` = checkpoint.`import_id`
         AND visual.`acquisition_generation` =
               checkpoint.`acquisition_generation`
         AND visual.`dispatch_id` = checkpoint.`ownership_id`
         AND visual.`state` = 'failed'
         AND visual.`failure_code` = 'visual_extraction_failed'
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
     AND `failure_code` = 'visual_extraction_failed';
  SELECT CASE
    WHEN changes() = 1 THEN NULL
    ELSE RAISE(ABORT, 'pilot second visual projection recovery rejected')
  END;
END;

PRAGMA foreign_key_check;

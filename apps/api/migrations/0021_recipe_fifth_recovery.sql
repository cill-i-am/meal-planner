PRAGMA foreign_keys = OFF;
PRAGMA legacy_alter_table = ON;

DROP TRIGGER `pilot_provider_recipe_replay_values_immutable_update`;
DROP TRIGGER `pilot_provider_recipe_replay_values_guarded_delete`;
DROP TRIGGER `pilot_provider_recipe_replay_values_expired_cleanup`;
DROP TRIGGER `pilot_provider_recipe_replay_values_budget_insert_cleanup`;
DROP TRIGGER `pilot_provider_recipe_replay_values_budget_update_cleanup`;
DROP TRIGGER `import_recipe_extractions_cleanup_replay_insert`;
DROP TRIGGER `import_recipe_extractions_cleanup_replay_update`;

ALTER TABLE `pilot_provider_recipe_replay_values`
  RENAME TO `__old_pilot_provider_recipe_replay_values`;

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

INSERT INTO `pilot_provider_recipe_replay_values` (
  `created_at`, `dispatch_id`, `evidence_fingerprint`, `expires_at`,
  `generation`, `import_id`, `runtime_stage`, `value_json`, `value_sha256`
)
SELECT `created_at`, `dispatch_id`, `evidence_fingerprint`, `expires_at`,
       `generation`, `import_id`, `runtime_stage`, `value_json`, `value_sha256`
  FROM `__old_pilot_provider_recipe_replay_values`;

DROP TABLE `__old_pilot_provider_recipe_replay_values`;

PRAGMA legacy_alter_table = OFF;

CREATE TRIGGER `pilot_provider_recipe_replay_values_immutable_update`
BEFORE UPDATE ON `pilot_provider_recipe_replay_values`
BEGIN
  SELECT RAISE(ABORT, 'provider recipe replay value is immutable');
END;

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

CREATE TRIGGER `pilot_provider_recipe_replay_values_expired_cleanup`
AFTER INSERT ON `pilot_provider_recipe_replay_values`
BEGIN
  DELETE FROM `pilot_provider_recipe_replay_values`
   WHERE `expires_at` <=
         strftime('%Y-%m-%dT%H:%M:%fZ', 'now');
END;

CREATE TRIGGER `pilot_provider_recipe_replay_values_budget_insert_cleanup`
AFTER INSERT ON `pilot_provider_budget_dispatches`
BEGIN
  DELETE FROM `pilot_provider_recipe_replay_values`
   WHERE `expires_at` <=
         strftime('%Y-%m-%dT%H:%M:%fZ', 'now');
END;

CREATE TRIGGER `pilot_provider_recipe_replay_values_budget_update_cleanup`
AFTER UPDATE ON `pilot_provider_budget_dispatches`
BEGIN
  DELETE FROM `pilot_provider_recipe_replay_values`
   WHERE `expires_at` <=
         strftime('%Y-%m-%dT%H:%M:%fZ', 'now');
END;

CREATE TRIGGER `import_recipe_extractions_cleanup_replay_insert`
AFTER INSERT ON `import_recipe_extractions`
WHEN NEW.`state` IN ('needs_review', 'failed')
BEGIN
  DELETE FROM `pilot_provider_recipe_replay_values`
   WHERE `import_id` = NEW.`import_id`
     AND `generation` = NEW.`acquisition_generation`
     AND `evidence_fingerprint` = NEW.`evidence_fingerprint`;
END;

CREATE TRIGGER `import_recipe_extractions_cleanup_replay_update`
AFTER UPDATE OF `state` ON `import_recipe_extractions`
WHEN NEW.`state` IN ('needs_review', 'failed')
BEGIN
  DELETE FROM `pilot_provider_recipe_replay_values`
   WHERE `import_id` = NEW.`import_id`
     AND `generation` = NEW.`acquisition_generation`
     AND `evidence_fingerprint` = NEW.`evidence_fingerprint`;
END;

CREATE TABLE `pilot_provider_recipe_fifth_recoveries` (
  `runtime_stage` text NOT NULL,
  `import_id` text NOT NULL,
  `acquisition_generation` integer NOT NULL,
  `original_dispatch_id` text NOT NULL,
  `first_recovery_dispatch_id` text NOT NULL,
  `second_recovery_dispatch_id` text NOT NULL,
  `third_recovery_dispatch_id` text NOT NULL,
  `fourth_recovery_dispatch_id` text NOT NULL,
  `recovery_dispatch_id` text NOT NULL,
  `evidence_fingerprint` text NOT NULL,
  `fourth_recovery_extraction_fingerprint` text NOT NULL,
  `recovery_extraction_fingerprint` text NOT NULL,
  `transcript_sha256` text NOT NULL,
  `visual_manifest_sha256` text NOT NULL,
  `evidence_references_json` text NOT NULL,
  `created_at` text NOT NULL,
  PRIMARY KEY (`runtime_stage`, `import_id`, `acquisition_generation`),
  CONSTRAINT `pilot_provider_recipe_fifth_recoveries_import_fk`
    FOREIGN KEY (`import_id`, `acquisition_generation`)
    REFERENCES `recipe_imports` (`id`, `acquisition_generation`)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT `pilot_provider_recipe_fifth_recoveries_fourth_recovery_fk`
    FOREIGN KEY (`runtime_stage`, `fourth_recovery_dispatch_id`)
    REFERENCES `pilot_provider_recipe_fourth_recoveries` (
      `runtime_stage`,
      `recovery_dispatch_id`
    )
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT `pilot_provider_recipe_fifth_recoveries_fourth_extraction_fk`
    FOREIGN KEY (`fourth_recovery_extraction_fingerprint`)
    REFERENCES `import_recipe_extractions` (`extraction_fingerprint`)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT `pilot_provider_recipe_fifth_recoveries_stage_check`
    CHECK (`runtime_stage` = 'pilot-gaia-118'),
  CONSTRAINT `pilot_provider_recipe_fifth_recoveries_identity_check`
    CHECK (
      `first_recovery_dispatch_id` =
        `original_dispatch_id` || ':recovery:1'
      AND `second_recovery_dispatch_id` =
        `original_dispatch_id` || ':recovery:2'
      AND `third_recovery_dispatch_id` =
        `original_dispatch_id` || ':recovery:3'
      AND `fourth_recovery_dispatch_id` =
        `original_dispatch_id` || ':recovery:4'
      AND `recovery_dispatch_id` =
        `original_dispatch_id` || ':recovery:5'
      AND instr(`original_dispatch_id`, ':recovery:') = 0
      AND `fourth_recovery_extraction_fingerprint` <>
        `recovery_extraction_fingerprint`
      AND length(`evidence_fingerprint`) = 64
      AND `evidence_fingerprint` NOT GLOB '*[^0-9a-f]*'
      AND length(`fourth_recovery_extraction_fingerprint`) = 64
      AND `fourth_recovery_extraction_fingerprint`
        NOT GLOB '*[^0-9a-f]*'
      AND length(`recovery_extraction_fingerprint`) = 64
      AND `recovery_extraction_fingerprint` NOT GLOB '*[^0-9a-f]*'
      AND length(`transcript_sha256`) = 64
      AND `transcript_sha256` NOT GLOB '*[^0-9a-f]*'
      AND length(`visual_manifest_sha256`) = 64
      AND `visual_manifest_sha256` NOT GLOB '*[^0-9a-f]*'
      AND json_valid(`evidence_references_json`)
      AND json_array_length(`evidence_references_json`) = 3
    )
);

CREATE UNIQUE INDEX
  `pilot_provider_recipe_fifth_recoveries_recovery_dispatch_unique`
  ON `pilot_provider_recipe_fifth_recoveries` (
    `runtime_stage`,
    `recovery_dispatch_id`
  );

CREATE UNIQUE INDEX
  `pilot_provider_recipe_fifth_recoveries_recovery_extraction_unique`
  ON `pilot_provider_recipe_fifth_recoveries` (
    `recovery_extraction_fingerprint`
  );

CREATE TRIGGER `pilot_provider_recipe_fifth_recoveries_immutable_update`
BEFORE UPDATE ON `pilot_provider_recipe_fifth_recoveries`
BEGIN
  SELECT RAISE(ABORT, 'pilot provider fifth recipe recovery is immutable');
END;

CREATE TRIGGER `pilot_provider_recipe_fifth_recoveries_immutable_delete`
BEFORE DELETE ON `pilot_provider_recipe_fifth_recoveries`
BEGIN
  SELECT RAISE(ABORT, 'pilot provider fifth recipe recovery is immutable');
END;

DROP TRIGGER `pilot_provider_recipe_recovery_budget_insert`;

CREATE TRIGGER `pilot_provider_recipe_recovery_budget_insert`
BEFORE INSERT ON `pilot_provider_budget_dispatches`
WHEN
  NEW.`provider_stage_id` = 'recipe-extraction'
  AND NEW.`dispatch_id` GLOB '*:recovery:[12345]'
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
        FROM `pilot_provider_recipe_recoveries` AS recovery
       WHERE recovery.`runtime_stage` = NEW.`runtime_stage`
         AND recovery.`recovery_dispatch_id` = NEW.`dispatch_id`
         AND NEW.`run_id` =
               'gaia-118:recipe-recovery:' || recovery.`import_id`
         AND NEW.`maximum_cost_micro_usd` = 100000
      UNION ALL
      SELECT 1
        FROM `pilot_provider_recipe_second_recoveries` AS recovery
       WHERE recovery.`runtime_stage` = NEW.`runtime_stage`
         AND recovery.`recovery_dispatch_id` = NEW.`dispatch_id`
         AND NEW.`run_id` =
               'gaia-118:recipe-recovery:' || recovery.`import_id`
         AND NEW.`maximum_cost_micro_usd` = 100000
      UNION ALL
      SELECT 1
        FROM `pilot_provider_recipe_third_recoveries` AS recovery
       WHERE recovery.`runtime_stage` = NEW.`runtime_stage`
         AND recovery.`recovery_dispatch_id` = NEW.`dispatch_id`
         AND NEW.`run_id` =
               'gaia-118:recipe-recovery:' || recovery.`import_id`
         AND NEW.`maximum_cost_micro_usd` = 100000
      UNION ALL
      SELECT 1
        FROM `pilot_provider_recipe_fourth_recoveries` AS recovery
       WHERE recovery.`runtime_stage` = NEW.`runtime_stage`
         AND recovery.`recovery_dispatch_id` = NEW.`dispatch_id`
         AND NEW.`run_id` =
               'gaia-118:recipe-recovery:' || recovery.`import_id`
         AND NEW.`maximum_cost_micro_usd` = 100000
      UNION ALL
      SELECT 1
        FROM `pilot_provider_recipe_fifth_recoveries` AS recovery
       WHERE recovery.`runtime_stage` = NEW.`runtime_stage`
         AND recovery.`recovery_dispatch_id` = NEW.`dispatch_id`
         AND NEW.`run_id` =
               'gaia-118:recipe-recovery:' || recovery.`import_id`
         AND NEW.`maximum_cost_micro_usd` = 100000
    )
    THEN RAISE(
      ABORT,
      'pilot provider recipe recovery budget authority rejected'
    )
  END;
END;

CREATE TRIGGER `pilot_provider_recipe_fifth_recoveries_prepare`
AFTER INSERT ON `pilot_provider_recipe_fifth_recoveries`
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
        FROM `pilot_provider_recipe_fourth_recoveries` AS fourth_recovery
        JOIN `pilot_provider_recipe_third_recoveries` AS third_recovery
          ON third_recovery.`runtime_stage` =
               fourth_recovery.`runtime_stage`
         AND third_recovery.`import_id` = fourth_recovery.`import_id`
         AND third_recovery.`acquisition_generation` =
               fourth_recovery.`acquisition_generation`
         AND third_recovery.`recovery_dispatch_id` =
               fourth_recovery.`third_recovery_dispatch_id`
        JOIN `pilot_provider_recipe_second_recoveries` AS second_recovery
          ON second_recovery.`runtime_stage` =
               fourth_recovery.`runtime_stage`
         AND second_recovery.`import_id` = fourth_recovery.`import_id`
         AND second_recovery.`acquisition_generation` =
               fourth_recovery.`acquisition_generation`
         AND second_recovery.`recovery_dispatch_id` =
               fourth_recovery.`second_recovery_dispatch_id`
        JOIN `pilot_provider_recipe_recoveries` AS first_recovery
          ON first_recovery.`runtime_stage` =
               fourth_recovery.`runtime_stage`
         AND first_recovery.`import_id` = fourth_recovery.`import_id`
         AND first_recovery.`acquisition_generation` =
               fourth_recovery.`acquisition_generation`
         AND first_recovery.`recovery_dispatch_id` =
               fourth_recovery.`first_recovery_dispatch_id`
        JOIN `pilot_provider_budget_reconciliations` AS audit
          ON audit.`runtime_stage` = fourth_recovery.`runtime_stage`
         AND audit.`dispatch_id` = fourth_recovery.`recovery_dispatch_id`
        JOIN `pilot_provider_budget_dispatches` AS dispatch
          ON dispatch.`runtime_stage` = audit.`runtime_stage`
         AND dispatch.`dispatch_id` = audit.`dispatch_id`
        JOIN `pilot_provider_stage_budget` AS stage
          ON stage.`runtime_stage` = audit.`runtime_stage`
        JOIN `import_provider_terminal_checkpoints` AS checkpoint
          ON checkpoint.`import_id` = NEW.`import_id`
         AND checkpoint.`acquisition_generation` =
               NEW.`acquisition_generation`
         AND checkpoint.`provider_stage` = 'recipe'
         AND checkpoint.`ownership_id` =
               first_recovery.`original_extraction_fingerprint`
         AND checkpoint.`failure_code` = 'outcome_unknown'
        JOIN `import_recipe_extractions` AS original_extraction
          ON original_extraction.`extraction_fingerprint` =
               checkpoint.`ownership_id`
         AND original_extraction.`import_id` = checkpoint.`import_id`
         AND original_extraction.`acquisition_generation` =
               checkpoint.`acquisition_generation`
         AND original_extraction.`evidence_fingerprint` =
               NEW.`evidence_fingerprint`
         AND original_extraction.`state` = 'failed'
         AND original_extraction.`failure_code` = 'provider_error'
         AND original_extraction.`completed_at` = checkpoint.`completed_at`
        JOIN `import_recipe_extractions` AS fourth_extraction
          ON fourth_extraction.`extraction_fingerprint` =
               NEW.`fourth_recovery_extraction_fingerprint`
         AND fourth_extraction.`import_id` = checkpoint.`import_id`
         AND fourth_extraction.`acquisition_generation` =
               checkpoint.`acquisition_generation`
         AND fourth_extraction.`evidence_fingerprint` =
               NEW.`evidence_fingerprint`
         AND fourth_extraction.`state` = 'failed'
         AND fourth_extraction.`failure_code` = 'provider_error'
         AND fourth_extraction.`is_current` = 0
        JOIN `import_recipe_terminal_projections` AS projection
          ON projection.`import_id` = checkpoint.`import_id`
         AND projection.`acquisition_generation` =
               checkpoint.`acquisition_generation`
         AND projection.`ownership_id` = checkpoint.`ownership_id`
         AND projection.`projected_at` = checkpoint.`completed_at`
         AND projection.`status` = 'failed'
         AND projection.`status_code` = 'recipe_extraction_failed'
         AND projection.`recovery_action` = 'operator_reconcile'
        JOIN `recipe_imports` AS parent
          ON parent.`id` = checkpoint.`import_id`
         AND parent.`acquisition_generation` =
               checkpoint.`acquisition_generation`
         AND parent.`status` = 'transcribed'
         AND parent.`status_code` IS NULL
         AND parent.`recovery_action` IS NULL
         AND parent.`evidence_references_json` =
               NEW.`evidence_references_json`
         AND projection.`evidence_references_json` =
               parent.`evidence_references_json`
        JOIN `import_transcriptions` AS transcript
          ON transcript.`import_id` = parent.`id`
         AND transcript.`acquisition_generation` =
               parent.`acquisition_generation`
         AND transcript.`state` = 'transcribed'
         AND transcript.`transcript_sha256` = NEW.`transcript_sha256`
        JOIN `import_visual_evidence` AS visual
          ON visual.`import_id` = parent.`id`
         AND visual.`acquisition_generation` =
               parent.`acquisition_generation`
         AND visual.`state` = 'completed'
         AND visual.`manifest_sha256` = NEW.`visual_manifest_sha256`
         AND visual.`source_media_sha256` =
               transcript.`source_media_sha256`
       WHERE fourth_recovery.`runtime_stage` = NEW.`runtime_stage`
         AND fourth_recovery.`import_id` = NEW.`import_id`
         AND fourth_recovery.`acquisition_generation` =
               NEW.`acquisition_generation`
         AND fourth_recovery.`original_dispatch_id` =
               NEW.`original_dispatch_id`
         AND fourth_recovery.`first_recovery_dispatch_id` =
               NEW.`first_recovery_dispatch_id`
         AND fourth_recovery.`second_recovery_dispatch_id` =
               NEW.`second_recovery_dispatch_id`
         AND fourth_recovery.`third_recovery_dispatch_id` =
               NEW.`third_recovery_dispatch_id`
         AND fourth_recovery.`recovery_dispatch_id` =
               NEW.`fourth_recovery_dispatch_id`
         AND fourth_recovery.`recovery_extraction_fingerprint` =
               NEW.`fourth_recovery_extraction_fingerprint`
         AND fourth_recovery.`evidence_fingerprint` =
               NEW.`evidence_fingerprint`
         AND fourth_recovery.`transcript_sha256` =
               NEW.`transcript_sha256`
         AND fourth_recovery.`visual_manifest_sha256` =
               NEW.`visual_manifest_sha256`
         AND fourth_recovery.`evidence_references_json` =
               NEW.`evidence_references_json`
         AND audit.`actual_cost_was_unknown` = 1
         AND audit.`authority` = 'authenticated_operator'
         AND audit.`conservative_charge_micro_usd` = 100000
         AND dispatch.`state` = 'settled_unknown'
         AND dispatch.`provider_stage_id` = 'recipe-extraction'
         AND dispatch.`run_id` =
               'gaia-118:recipe-recovery:' || NEW.`import_id`
         AND dispatch.`actual_cost_micro_usd` IS NULL
         AND dispatch.`maximum_cost_micro_usd` = 100000
         AND stage.`state` = 'open'
         AND stage.`reserved_micro_usd` = 0
         AND stage.`invoking_dispatch_id` IS NULL
         AND stage.`poison_dispatch_id` IS NULL
         AND stage.`settled_micro_usd` + 100000 <=
               stage.`budget_cap_micro_usd`
         AND NOT EXISTS (
           SELECT 1
             FROM `pilot_provider_recipe_replay_values` AS replay
            WHERE replay.`runtime_stage` = fourth_recovery.`runtime_stage`
              AND replay.`dispatch_id` =
                    fourth_recovery.`recovery_dispatch_id`
         )
    )
    THEN RAISE(
      ABORT,
      'pilot provider fifth recipe recovery preconditions rejected'
    )
  END;
END;

PRAGMA foreign_key_check;
PRAGMA foreign_keys = ON;

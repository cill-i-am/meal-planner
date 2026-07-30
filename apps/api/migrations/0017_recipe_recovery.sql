PRAGMA foreign_keys = OFF;

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

INSERT INTO `pilot_provider_recipe_replay_values`
SELECT * FROM `__old_pilot_provider_recipe_replay_values`;

DROP TABLE `__old_pilot_provider_recipe_replay_values`;

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

CREATE TABLE `pilot_provider_recipe_recoveries` (
  `runtime_stage` text NOT NULL,
  `import_id` text NOT NULL,
  `acquisition_generation` integer NOT NULL,
  `recovery_ordinal` integer NOT NULL,
  `recovery_identity` text NOT NULL,
  `original_dispatch_id` text NOT NULL,
  `recovery_dispatch_id` text NOT NULL,
  `evidence_fingerprint` text NOT NULL,
  `original_extraction_fingerprint` text NOT NULL,
  `recovery_extraction_fingerprint` text NOT NULL,
  `transcript_sha256` text NOT NULL,
  `visual_manifest_sha256` text NOT NULL,
  `evidence_references_json` text NOT NULL,
  `created_at` text NOT NULL,
  PRIMARY KEY (
    `runtime_stage`,
    `import_id`,
    `acquisition_generation`,
    `recovery_ordinal`
  ),
  CONSTRAINT `pilot_provider_recipe_recoveries_import_generation_fk`
    FOREIGN KEY (`import_id`, `acquisition_generation`)
    REFERENCES `recipe_imports` (`id`, `acquisition_generation`)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT `pilot_provider_recipe_recoveries_original_dispatch_fk`
    FOREIGN KEY (`runtime_stage`, `original_dispatch_id`)
    REFERENCES `pilot_provider_budget_dispatches` (
      `runtime_stage`,
      `dispatch_id`
    )
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT `pilot_provider_recipe_recoveries_original_extraction_fk`
    FOREIGN KEY (`original_extraction_fingerprint`)
    REFERENCES `import_recipe_extractions` (`extraction_fingerprint`)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT `pilot_provider_recipe_recoveries_stage_check`
    CHECK (`runtime_stage` = 'pilot-gaia-118'),
  CONSTRAINT `pilot_provider_recipe_recoveries_identity_check`
    CHECK (
      `recovery_ordinal` = 1
      AND `recovery_identity` = 'recovery:1'
      AND `recovery_dispatch_id` =
            `original_dispatch_id` || ':recovery:1'
      AND instr(`original_dispatch_id`, ':recovery:') = 0
      AND `original_extraction_fingerprint` <>
            `recovery_extraction_fingerprint`
      AND length(`evidence_fingerprint`) = 64
      AND `evidence_fingerprint` NOT GLOB '*[^0-9a-f]*'
      AND length(`original_extraction_fingerprint`) = 64
      AND `original_extraction_fingerprint` NOT GLOB '*[^0-9a-f]*'
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
  `pilot_provider_recipe_recoveries_recovery_dispatch_unique`
  ON `pilot_provider_recipe_recoveries` (
    `runtime_stage`,
    `recovery_dispatch_id`
  );

CREATE UNIQUE INDEX
  `pilot_provider_recipe_recoveries_recovery_extraction_unique`
  ON `pilot_provider_recipe_recoveries` (
    `recovery_extraction_fingerprint`
  );

CREATE TRIGGER `pilot_provider_recipe_recoveries_immutable_update`
BEFORE UPDATE ON `pilot_provider_recipe_recoveries`
BEGIN
  SELECT RAISE(ABORT, 'pilot provider recipe recovery is immutable');
END;

CREATE TRIGGER `pilot_provider_recipe_recoveries_immutable_delete`
BEFORE DELETE ON `pilot_provider_recipe_recoveries`
BEGIN
  SELECT RAISE(ABORT, 'pilot provider recipe recovery is immutable');
END;

CREATE TRIGGER `pilot_provider_recipe_recovery_budget_insert`
BEFORE INSERT ON `pilot_provider_budget_dispatches`
WHEN
  NEW.`provider_stage_id` = 'recipe-extraction'
  AND NEW.`dispatch_id` GLOB '*:recovery:1'
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
    )
    THEN RAISE(
      ABORT,
      'pilot provider recipe recovery budget authority rejected'
    )
  END;
END;

CREATE TRIGGER `pilot_provider_recipe_recoveries_prepare`
AFTER INSERT ON `pilot_provider_recipe_recoveries`
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
        FROM `recipe_imports` AS parent
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
        JOIN `import_recipe_extractions` AS extraction
          ON extraction.`import_id` = parent.`id`
         AND extraction.`acquisition_generation` =
               parent.`acquisition_generation`
         AND extraction.`extraction_fingerprint` =
               NEW.`original_extraction_fingerprint`
         AND extraction.`evidence_fingerprint` =
               NEW.`evidence_fingerprint`
         AND extraction.`state` = 'failed'
         AND extraction.`failure_code` = 'provider_error'
         AND extraction.`is_current` = 0
        JOIN `import_provider_terminal_checkpoints` AS checkpoint
          ON checkpoint.`import_id` = parent.`id`
         AND checkpoint.`acquisition_generation` =
               parent.`acquisition_generation`
         AND checkpoint.`provider_stage` = 'recipe'
         AND checkpoint.`ownership_id` =
               extraction.`extraction_fingerprint`
         AND checkpoint.`failure_code` = 'outcome_unknown'
         AND checkpoint.`completed_at` = extraction.`completed_at`
        JOIN `import_recipe_terminal_projections` AS projection
          ON projection.`import_id` = parent.`id`
         AND projection.`acquisition_generation` =
               parent.`acquisition_generation`
         AND projection.`ownership_id` =
               extraction.`extraction_fingerprint`
         AND projection.`status` = 'failed'
         AND projection.`status_code` = 'recipe_extraction_failed'
         AND projection.`recovery_action` = 'operator_reconcile'
         AND projection.`evidence_references_json` =
               parent.`evidence_references_json`
        JOIN `pilot_provider_budget_dispatches` AS dispatch
          ON dispatch.`runtime_stage` = NEW.`runtime_stage`
         AND dispatch.`dispatch_id` = NEW.`original_dispatch_id`
         AND dispatch.`dispatch_id` =
               'recipe:' || parent.`id` || ':' ||
               parent.`acquisition_generation` || ':' ||
               extraction.`evidence_fingerprint`
         AND dispatch.`provider_stage_id` = 'recipe-extraction'
         AND dispatch.`state` = 'settled_unknown'
         AND dispatch.`actual_cost_micro_usd` IS NULL
        JOIN `pilot_provider_budget_reconciliations` AS audit
          ON audit.`runtime_stage` = dispatch.`runtime_stage`
         AND audit.`dispatch_id` = dispatch.`dispatch_id`
         AND audit.`authority` = 'authenticated_operator'
         AND audit.`actual_cost_was_unknown` = 1
         AND audit.`conservative_charge_micro_usd` = 100000
        JOIN `pilot_provider_stage_budget` AS stage
          ON stage.`runtime_stage` = dispatch.`runtime_stage`
         AND stage.`state` = 'open'
         AND stage.`reserved_micro_usd` = 0
         AND stage.`invoking_dispatch_id` IS NULL
         AND stage.`poison_dispatch_id` IS NULL
         AND stage.`settled_micro_usd` + 100000 <=
               stage.`budget_cap_micro_usd`
       WHERE parent.`id` = NEW.`import_id`
         AND parent.`acquisition_generation` =
               NEW.`acquisition_generation`
         AND parent.`status` = 'transcribed'
         AND parent.`status_code` IS NULL
         AND parent.`recovery_action` IS NULL
         AND parent.`evidence_references_json` =
               NEW.`evidence_references_json`
         AND NOT EXISTS (
           SELECT 1
             FROM `import_recipe_extractions` AS other
            WHERE other.`import_id` = parent.`id`
              AND other.`acquisition_generation` =
                    parent.`acquisition_generation`
              AND other.`extraction_fingerprint` <>
                    NEW.`original_extraction_fingerprint`
         )
    )
    THEN RAISE(
      ABORT,
      'pilot provider recipe recovery preconditions rejected'
    )
  END;
END;

PRAGMA foreign_key_check;
PRAGMA foreign_keys = ON;

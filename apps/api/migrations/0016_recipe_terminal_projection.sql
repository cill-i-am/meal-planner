CREATE TABLE `pilot_provider_budget_conservative_settlements` (
  `actual_cost_was_unknown` integer NOT NULL,
  `authority` text NOT NULL,
  `conservative_charge_micro_usd` integer NOT NULL,
  `created_at` text NOT NULL,
  `dispatch_id` text NOT NULL,
  `runtime_stage` text NOT NULL,
  PRIMARY KEY (`runtime_stage`, `dispatch_id`),
  CONSTRAINT `pilot_provider_budget_conservative_settlements_dispatch_fk`
    FOREIGN KEY (`runtime_stage`, `dispatch_id`)
    REFERENCES `pilot_provider_budget_dispatches` (
      `runtime_stage`,
      `dispatch_id`
    )
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT `pilot_provider_budget_conservative_settlements_stage_check`
    CHECK (`runtime_stage` = 'pilot-gaia-118'),
  CONSTRAINT `pilot_provider_budget_conservative_settlements_charge_check`
    CHECK (`conservative_charge_micro_usd` = 100000),
  CONSTRAINT `pilot_provider_budget_conservative_settlements_unknown_check`
    CHECK (`actual_cost_was_unknown` = 1),
  CONSTRAINT `pilot_provider_budget_conservative_settlements_authority_check`
    CHECK (`authority` = 'schema_valid_provider_response')
);

CREATE TRIGGER `pilot_provider_budget_conservative_settlements_immutable_update`
BEFORE UPDATE ON `pilot_provider_budget_conservative_settlements`
BEGIN
  SELECT RAISE(
    ABORT,
    'provider conservative settlement audit is immutable'
  );
END;

CREATE TRIGGER `pilot_provider_budget_conservative_settlements_immutable_delete`
BEFORE DELETE ON `pilot_provider_budget_conservative_settlements`
BEGIN
  SELECT RAISE(
    ABORT,
    'provider conservative settlement audit is immutable'
  );
END;

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
  SELECT RAISE(
    ABORT,
    'provider recipe replay value remains live'
  );
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

CREATE TABLE `import_recipe_terminal_projections` (
  `acquisition_generation` integer NOT NULL,
  `evidence_references_json` text NOT NULL,
  `import_id` text NOT NULL,
  `ownership_id` text NOT NULL,
  `projected_at` text NOT NULL,
  `recovery_action` text NOT NULL,
  `status` text NOT NULL,
  `status_code` text NOT NULL,
  PRIMARY KEY (`import_id`, `acquisition_generation`),
  CONSTRAINT `import_recipe_terminal_projections_import_fk`
    FOREIGN KEY (`import_id`)
    REFERENCES `recipe_imports` (`id`)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT `import_recipe_terminal_projections_details_check`
    CHECK (
      `status` = 'failed'
      AND `status_code` = 'recipe_extraction_failed'
      AND `recovery_action` = 'operator_reconcile'
      AND json_valid(`evidence_references_json`)
      AND json_array_length(`evidence_references_json`) IN (0, 3)
      AND length(`ownership_id`) = 64
      AND `ownership_id` NOT GLOB '*[^0-9a-f]*'
    )
);

CREATE TRIGGER `import_recipe_terminal_projections_immutable_update`
BEFORE UPDATE ON `import_recipe_terminal_projections`
BEGIN
  SELECT RAISE(ABORT, 'recipe terminal projection is immutable');
END;

CREATE TRIGGER `import_recipe_terminal_projections_immutable_delete`
BEFORE DELETE ON `import_recipe_terminal_projections`
BEGIN
  SELECT RAISE(ABORT, 'recipe terminal projection is immutable');
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
  checkpoint.`acquisition_generation`,
  parent.`evidence_references_json`,
  checkpoint.`import_id`,
  checkpoint.`ownership_id`,
  checkpoint.`completed_at`,
  'operator_reconcile',
  'failed',
  'recipe_extraction_failed'
FROM `import_provider_terminal_checkpoints` AS checkpoint
JOIN `import_recipe_extractions` AS extraction
  ON extraction.`import_id` = checkpoint.`import_id`
 AND extraction.`acquisition_generation` =
       checkpoint.`acquisition_generation`
 AND extraction.`extraction_fingerprint` = checkpoint.`ownership_id`
JOIN `recipe_imports` AS parent
  ON parent.`id` = checkpoint.`import_id`
 AND parent.`acquisition_generation` =
       checkpoint.`acquisition_generation`
WHERE checkpoint.`provider_stage` = 'recipe'
  AND extraction.`state` = 'failed'
  AND extraction.`failure_code` = 'provider_error'
  AND extraction.`completed_at` = checkpoint.`completed_at`
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
         AND `failure_code` = 'provider_error'
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

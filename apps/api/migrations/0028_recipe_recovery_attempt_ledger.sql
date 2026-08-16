PRAGMA foreign_keys = OFF;

CREATE TABLE `pilot_provider_recipe_recovery_attempts` (
  `runtime_stage` text NOT NULL,
  `import_id` text NOT NULL,
  `acquisition_generation` integer NOT NULL,
  `recovery_ordinal` integer NOT NULL,
  `root_dispatch_id` text NOT NULL,
  `predecessor_dispatch_id` text NOT NULL,
  `current_dispatch_id` text NOT NULL,
  `root_extraction_fingerprint` text NOT NULL,
  `predecessor_extraction_fingerprint` text NOT NULL,
  `current_extraction_fingerprint` text NOT NULL,
  `predecessor_outcome` text NOT NULL,
  `terminal_checkpoint_completed_at` text NOT NULL,
  `predecessor_reconciliation_created_at` text NOT NULL,
  `evidence_fingerprint` text NOT NULL,
  `source_media_sha256` text NOT NULL,
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
  CONSTRAINT `pilot_provider_recipe_recovery_attempts_import_fk`
    FOREIGN KEY (`import_id`, `acquisition_generation`)
    REFERENCES `recipe_imports` (`id`, `acquisition_generation`)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT `pilot_provider_recipe_recovery_attempts_root_dispatch_fk`
    FOREIGN KEY (`runtime_stage`, `root_dispatch_id`)
    REFERENCES `pilot_provider_budget_dispatches` (
      `runtime_stage`,
      `dispatch_id`
    )
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT `pilot_provider_recipe_recovery_attempts_root_extraction_fk`
    FOREIGN KEY (`root_extraction_fingerprint`)
    REFERENCES `import_recipe_extractions` (`extraction_fingerprint`)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT `pilot_provider_recipe_recovery_attempts_predecessor_extraction_fk`
    FOREIGN KEY (`predecessor_extraction_fingerprint`)
    REFERENCES `import_recipe_extractions` (`extraction_fingerprint`)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT `pilot_provider_recipe_recovery_attempts_stage_check`
    CHECK (`runtime_stage` = 'pilot-gaia-118'),
  CONSTRAINT `pilot_provider_recipe_recovery_attempts_identity_check`
    CHECK (
      `recovery_ordinal` BETWEEN 1 AND 8
      AND instr(`root_dispatch_id`, ':recovery:') = 0
      AND `current_dispatch_id` =
            `root_dispatch_id` || ':recovery:' || `recovery_ordinal`
      AND (
        (`recovery_ordinal` = 1
          AND `predecessor_dispatch_id` = `root_dispatch_id`
          AND `predecessor_extraction_fingerprint` =
                `root_extraction_fingerprint`)
        OR
        (`recovery_ordinal` > 1
          AND `predecessor_dispatch_id` =
                `root_dispatch_id` || ':recovery:' ||
                (`recovery_ordinal` - 1))
      )
      AND `current_extraction_fingerprint` <>
            `predecessor_extraction_fingerprint`
      AND `predecessor_outcome` = 'outcome_unknown'
      AND length(`evidence_fingerprint`) = 64
      AND `evidence_fingerprint` NOT GLOB '*[^0-9a-f]*'
      AND length(`source_media_sha256`) = 64
      AND `source_media_sha256` NOT GLOB '*[^0-9a-f]*'
      AND length(`root_extraction_fingerprint`) = 64
      AND `root_extraction_fingerprint` NOT GLOB '*[^0-9a-f]*'
      AND length(`predecessor_extraction_fingerprint`) = 64
      AND `predecessor_extraction_fingerprint` NOT GLOB '*[^0-9a-f]*'
      AND length(`current_extraction_fingerprint`) = 64
      AND `current_extraction_fingerprint` NOT GLOB '*[^0-9a-f]*'
      AND length(`transcript_sha256`) = 64
      AND `transcript_sha256` NOT GLOB '*[^0-9a-f]*'
      AND length(`visual_manifest_sha256`) = 64
      AND `visual_manifest_sha256` NOT GLOB '*[^0-9a-f]*'
      AND json_valid(`evidence_references_json`)
      AND json_array_length(`evidence_references_json`) = 3
    )
);

CREATE UNIQUE INDEX
  `pilot_provider_recipe_recovery_attempts_dispatch_unique`
  ON `pilot_provider_recipe_recovery_attempts` (
    `runtime_stage`,
    `current_dispatch_id`
  );

CREATE UNIQUE INDEX
  `pilot_provider_recipe_recovery_attempts_extraction_unique`
  ON `pilot_provider_recipe_recovery_attempts` (
    `current_extraction_fingerprint`
  );

CREATE INDEX `pilot_provider_recipe_recovery_attempts_cursor_index`
  ON `pilot_provider_recipe_recovery_attempts` (
    `runtime_stage`,
    `import_id`,
    `acquisition_generation`,
    `recovery_ordinal` DESC
  );

CREATE TRIGGER `pilot_provider_recipe_recovery_attempts_immutable_update`
BEFORE UPDATE ON `pilot_provider_recipe_recovery_attempts`
BEGIN
  SELECT RAISE(ABORT, 'pilot provider recipe recovery attempt is immutable');
END;

CREATE TRIGGER `pilot_provider_recipe_recovery_attempts_immutable_delete`
BEFORE DELETE ON `pilot_provider_recipe_recovery_attempts`
BEGIN
  SELECT RAISE(ABORT, 'pilot provider recipe recovery attempt is immutable');
END;

CREATE TRIGGER `pilot_provider_recipe_recovery_attempts_ancestry_insert`
AFTER INSERT ON `pilot_provider_recipe_recovery_attempts`
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
         AND transcript.`source_media_sha256` = NEW.`source_media_sha256`
        JOIN `import_visual_evidence` AS visual
          ON visual.`import_id` = parent.`id`
         AND visual.`acquisition_generation` =
               parent.`acquisition_generation`
         AND visual.`state` = 'completed'
         AND visual.`manifest_sha256` = NEW.`visual_manifest_sha256`
         AND visual.`source_media_sha256` = NEW.`source_media_sha256`
        JOIN `import_recipe_extractions` AS root_extraction
          ON root_extraction.`import_id` = parent.`id`
         AND root_extraction.`acquisition_generation` =
               parent.`acquisition_generation`
         AND root_extraction.`extraction_fingerprint` =
               NEW.`root_extraction_fingerprint`
         AND root_extraction.`evidence_fingerprint` =
               NEW.`evidence_fingerprint`
         AND root_extraction.`state` = 'failed'
         AND root_extraction.`failure_code` = 'provider_error'
        JOIN `import_recipe_extractions` AS predecessor_extraction
          ON predecessor_extraction.`import_id` = parent.`id`
         AND predecessor_extraction.`acquisition_generation` =
               parent.`acquisition_generation`
         AND predecessor_extraction.`extraction_fingerprint` =
               NEW.`predecessor_extraction_fingerprint`
         AND predecessor_extraction.`evidence_fingerprint` =
               NEW.`evidence_fingerprint`
         AND predecessor_extraction.`state` = 'failed'
         AND predecessor_extraction.`failure_code` = 'provider_error'
         AND predecessor_extraction.`is_current` = 0
        JOIN `import_provider_terminal_checkpoints` AS checkpoint
          ON checkpoint.`import_id` = parent.`id`
         AND checkpoint.`acquisition_generation` =
               parent.`acquisition_generation`
         AND checkpoint.`provider_stage` = 'recipe'
         AND checkpoint.`ownership_id` =
               NEW.`root_extraction_fingerprint`
         AND checkpoint.`failure_code` = NEW.`predecessor_outcome`
         AND checkpoint.`completed_at` =
               NEW.`terminal_checkpoint_completed_at`
         AND checkpoint.`completed_at` = root_extraction.`completed_at`
        JOIN `import_recipe_terminal_projections` AS projection
          ON projection.`import_id` = parent.`id`
         AND projection.`acquisition_generation` =
               parent.`acquisition_generation`
         AND projection.`ownership_id` = checkpoint.`ownership_id`
         AND projection.`projected_at` = checkpoint.`completed_at`
         AND projection.`status` = 'failed'
         AND projection.`status_code` = 'recipe_extraction_failed'
         AND projection.`recovery_action` = 'operator_reconcile'
         AND projection.`evidence_references_json` =
               parent.`evidence_references_json`
        JOIN `pilot_provider_budget_dispatches` AS root_dispatch
          ON root_dispatch.`runtime_stage` = NEW.`runtime_stage`
         AND root_dispatch.`dispatch_id` = NEW.`root_dispatch_id`
         AND root_dispatch.`provider_stage_id` = 'recipe-extraction'
        JOIN `pilot_provider_budget_dispatches` AS predecessor_dispatch
          ON predecessor_dispatch.`runtime_stage` = NEW.`runtime_stage`
         AND predecessor_dispatch.`dispatch_id` =
               NEW.`predecessor_dispatch_id`
         AND predecessor_dispatch.`provider_stage_id` = 'recipe-extraction'
         AND predecessor_dispatch.`state` = 'settled_unknown'
         AND predecessor_dispatch.`actual_cost_micro_usd` IS NULL
         AND predecessor_dispatch.`maximum_cost_micro_usd` = 100000
        JOIN `pilot_provider_budget_reconciliations` AS audit
          ON audit.`runtime_stage` = predecessor_dispatch.`runtime_stage`
         AND audit.`dispatch_id` = predecessor_dispatch.`dispatch_id`
         AND audit.`actual_cost_was_unknown` = 1
         AND audit.`authority` = 'authenticated_operator'
         AND audit.`conservative_charge_micro_usd` = 100000
         AND audit.`created_at` =
               NEW.`predecessor_reconciliation_created_at`
       WHERE parent.`id` = NEW.`import_id`
         AND parent.`acquisition_generation` =
               NEW.`acquisition_generation`
         AND parent.`evidence_references_json` =
               NEW.`evidence_references_json`
         AND (
           (NEW.`recovery_ordinal` = 1
             AND root_dispatch.`run_id` =
                   'gaia-118:' || NEW.`import_id`)
           OR
           (NEW.`recovery_ordinal` > 1
             AND predecessor_dispatch.`run_id` =
                   'gaia-118:recipe-recovery:' || NEW.`import_id`
             AND EXISTS (
               SELECT 1
                 FROM `pilot_provider_recipe_recovery_attempts` AS predecessor
                WHERE predecessor.`runtime_stage` = NEW.`runtime_stage`
                  AND predecessor.`import_id` = NEW.`import_id`
                  AND predecessor.`acquisition_generation` =
                        NEW.`acquisition_generation`
                  AND predecessor.`recovery_ordinal` =
                        NEW.`recovery_ordinal` - 1
                  AND predecessor.`root_dispatch_id` =
                        NEW.`root_dispatch_id`
                  AND predecessor.`current_dispatch_id` =
                        NEW.`predecessor_dispatch_id`
                  AND predecessor.`root_extraction_fingerprint` =
                        NEW.`root_extraction_fingerprint`
                  AND predecessor.`current_extraction_fingerprint` =
                        NEW.`predecessor_extraction_fingerprint`
                  AND predecessor.`evidence_fingerprint` =
                        NEW.`evidence_fingerprint`
                  AND predecessor.`source_media_sha256` =
                        NEW.`source_media_sha256`
                  AND predecessor.`transcript_sha256` =
                        NEW.`transcript_sha256`
                  AND predecessor.`visual_manifest_sha256` =
                        NEW.`visual_manifest_sha256`
                  AND predecessor.`evidence_references_json` =
                        NEW.`evidence_references_json`
             ))
         )
    )
    THEN RAISE(
      ABORT,
      'pilot provider recipe recovery attempt ancestry rejected'
    )
  END;
END;

INSERT INTO `pilot_provider_recipe_recovery_attempts` (
  `runtime_stage`, `import_id`, `acquisition_generation`, `recovery_ordinal`,
  `root_dispatch_id`, `predecessor_dispatch_id`, `current_dispatch_id`,
  `root_extraction_fingerprint`, `predecessor_extraction_fingerprint`,
  `current_extraction_fingerprint`, `predecessor_outcome`,
  `terminal_checkpoint_completed_at`,
  `predecessor_reconciliation_created_at`, `evidence_fingerprint`,
  `source_media_sha256`, `transcript_sha256`, `visual_manifest_sha256`,
  `evidence_references_json`,
  `created_at`
)
SELECT recovery.`runtime_stage`, recovery.`import_id`,
       recovery.`acquisition_generation`, 1, recovery.`original_dispatch_id`,
       recovery.`original_dispatch_id`, recovery.`recovery_dispatch_id`,
       recovery.`original_extraction_fingerprint`,
       recovery.`original_extraction_fingerprint`,
       recovery.`recovery_extraction_fingerprint`, 'outcome_unknown',
       checkpoint.`completed_at`, audit.`created_at`,
       recovery.`evidence_fingerprint`,
       (SELECT transcript.`source_media_sha256`
          FROM `import_transcriptions` AS transcript
         WHERE transcript.`import_id` = recovery.`import_id`
           AND transcript.`acquisition_generation` =
                 recovery.`acquisition_generation`),
       recovery.`transcript_sha256`,
       recovery.`visual_manifest_sha256`, recovery.`evidence_references_json`,
       recovery.`created_at`
  FROM `pilot_provider_recipe_recoveries` AS recovery
  JOIN `import_provider_terminal_checkpoints` AS checkpoint
    ON checkpoint.`import_id` = recovery.`import_id`
   AND checkpoint.`acquisition_generation` =
         recovery.`acquisition_generation`
   AND checkpoint.`provider_stage` = 'recipe'
   AND checkpoint.`ownership_id` =
         recovery.`original_extraction_fingerprint`
   AND checkpoint.`failure_code` = 'outcome_unknown'
  JOIN `pilot_provider_budget_reconciliations` AS audit
    ON audit.`runtime_stage` = recovery.`runtime_stage`
   AND audit.`dispatch_id` = recovery.`original_dispatch_id`;

INSERT INTO `pilot_provider_recipe_recovery_attempts` (
  `runtime_stage`, `import_id`, `acquisition_generation`, `recovery_ordinal`,
  `root_dispatch_id`, `predecessor_dispatch_id`, `current_dispatch_id`,
  `root_extraction_fingerprint`, `predecessor_extraction_fingerprint`,
  `current_extraction_fingerprint`, `predecessor_outcome`,
  `terminal_checkpoint_completed_at`,
  `predecessor_reconciliation_created_at`, `evidence_fingerprint`,
  `source_media_sha256`, `transcript_sha256`, `visual_manifest_sha256`,
  `evidence_references_json`,
  `created_at`
)
SELECT recovery.`runtime_stage`, recovery.`import_id`,
       recovery.`acquisition_generation`, 2, recovery.`original_dispatch_id`,
       recovery.`first_recovery_dispatch_id`, recovery.`recovery_dispatch_id`,
       first_recovery.`original_extraction_fingerprint`,
       recovery.`first_recovery_extraction_fingerprint`,
       recovery.`recovery_extraction_fingerprint`, 'outcome_unknown',
       checkpoint.`completed_at`, audit.`created_at`,
       recovery.`evidence_fingerprint`,
       (SELECT transcript.`source_media_sha256`
          FROM `import_transcriptions` AS transcript
         WHERE transcript.`import_id` = recovery.`import_id`
           AND transcript.`acquisition_generation` =
                 recovery.`acquisition_generation`),
       recovery.`transcript_sha256`,
       recovery.`visual_manifest_sha256`, recovery.`evidence_references_json`,
       recovery.`created_at`
  FROM `pilot_provider_recipe_second_recoveries` AS recovery
  JOIN `pilot_provider_recipe_recoveries` AS first_recovery
    ON first_recovery.`runtime_stage` = recovery.`runtime_stage`
   AND first_recovery.`import_id` = recovery.`import_id`
   AND first_recovery.`acquisition_generation` =
         recovery.`acquisition_generation`
   AND first_recovery.`recovery_dispatch_id` =
         recovery.`first_recovery_dispatch_id`
  JOIN `import_provider_terminal_checkpoints` AS checkpoint
    ON checkpoint.`import_id` = recovery.`import_id`
   AND checkpoint.`acquisition_generation` = recovery.`acquisition_generation`
   AND checkpoint.`provider_stage` = 'recipe'
   AND checkpoint.`ownership_id` =
         first_recovery.`original_extraction_fingerprint`
   AND checkpoint.`failure_code` = 'outcome_unknown'
  JOIN `pilot_provider_budget_reconciliations` AS audit
    ON audit.`runtime_stage` = recovery.`runtime_stage`
   AND audit.`dispatch_id` = recovery.`first_recovery_dispatch_id`;

INSERT INTO `pilot_provider_recipe_recovery_attempts` (
  `runtime_stage`, `import_id`, `acquisition_generation`, `recovery_ordinal`,
  `root_dispatch_id`, `predecessor_dispatch_id`, `current_dispatch_id`,
  `root_extraction_fingerprint`, `predecessor_extraction_fingerprint`,
  `current_extraction_fingerprint`, `predecessor_outcome`,
  `terminal_checkpoint_completed_at`,
  `predecessor_reconciliation_created_at`, `evidence_fingerprint`,
  `source_media_sha256`, `transcript_sha256`, `visual_manifest_sha256`,
  `evidence_references_json`,
  `created_at`
)
SELECT recovery.`runtime_stage`, recovery.`import_id`,
       recovery.`acquisition_generation`, 3, recovery.`original_dispatch_id`,
       recovery.`second_recovery_dispatch_id`, recovery.`recovery_dispatch_id`,
       first_recovery.`original_extraction_fingerprint`,
       recovery.`second_recovery_extraction_fingerprint`,
       recovery.`recovery_extraction_fingerprint`, 'outcome_unknown',
       checkpoint.`completed_at`, audit.`created_at`,
       recovery.`evidence_fingerprint`,
       (SELECT transcript.`source_media_sha256`
          FROM `import_transcriptions` AS transcript
         WHERE transcript.`import_id` = recovery.`import_id`
           AND transcript.`acquisition_generation` =
                 recovery.`acquisition_generation`),
       recovery.`transcript_sha256`,
       recovery.`visual_manifest_sha256`, recovery.`evidence_references_json`,
       recovery.`created_at`
  FROM `pilot_provider_recipe_third_recoveries` AS recovery
  JOIN `pilot_provider_recipe_recoveries` AS first_recovery
    ON first_recovery.`runtime_stage` = recovery.`runtime_stage`
   AND first_recovery.`import_id` = recovery.`import_id`
   AND first_recovery.`acquisition_generation` =
         recovery.`acquisition_generation`
   AND first_recovery.`recovery_dispatch_id` =
         recovery.`first_recovery_dispatch_id`
  JOIN `import_provider_terminal_checkpoints` AS checkpoint
    ON checkpoint.`import_id` = recovery.`import_id`
   AND checkpoint.`acquisition_generation` = recovery.`acquisition_generation`
   AND checkpoint.`provider_stage` = 'recipe'
   AND checkpoint.`ownership_id` =
         first_recovery.`original_extraction_fingerprint`
   AND checkpoint.`failure_code` = 'outcome_unknown'
  JOIN `pilot_provider_budget_reconciliations` AS audit
    ON audit.`runtime_stage` = recovery.`runtime_stage`
   AND audit.`dispatch_id` = recovery.`second_recovery_dispatch_id`;

INSERT INTO `pilot_provider_recipe_recovery_attempts` (
  `runtime_stage`, `import_id`, `acquisition_generation`, `recovery_ordinal`,
  `root_dispatch_id`, `predecessor_dispatch_id`, `current_dispatch_id`,
  `root_extraction_fingerprint`, `predecessor_extraction_fingerprint`,
  `current_extraction_fingerprint`, `predecessor_outcome`,
  `terminal_checkpoint_completed_at`,
  `predecessor_reconciliation_created_at`, `evidence_fingerprint`,
  `source_media_sha256`, `transcript_sha256`, `visual_manifest_sha256`,
  `evidence_references_json`,
  `created_at`
)
SELECT recovery.`runtime_stage`, recovery.`import_id`,
       recovery.`acquisition_generation`, 4, recovery.`original_dispatch_id`,
       recovery.`third_recovery_dispatch_id`, recovery.`recovery_dispatch_id`,
       first_recovery.`original_extraction_fingerprint`,
       recovery.`third_recovery_extraction_fingerprint`,
       recovery.`recovery_extraction_fingerprint`, 'outcome_unknown',
       checkpoint.`completed_at`, audit.`created_at`,
       recovery.`evidence_fingerprint`,
       (SELECT transcript.`source_media_sha256`
          FROM `import_transcriptions` AS transcript
         WHERE transcript.`import_id` = recovery.`import_id`
           AND transcript.`acquisition_generation` =
                 recovery.`acquisition_generation`),
       recovery.`transcript_sha256`,
       recovery.`visual_manifest_sha256`, recovery.`evidence_references_json`,
       recovery.`created_at`
  FROM `pilot_provider_recipe_fourth_recoveries` AS recovery
  JOIN `pilot_provider_recipe_recoveries` AS first_recovery
    ON first_recovery.`runtime_stage` = recovery.`runtime_stage`
   AND first_recovery.`import_id` = recovery.`import_id`
   AND first_recovery.`acquisition_generation` =
         recovery.`acquisition_generation`
   AND first_recovery.`recovery_dispatch_id` =
         recovery.`first_recovery_dispatch_id`
  JOIN `import_provider_terminal_checkpoints` AS checkpoint
    ON checkpoint.`import_id` = recovery.`import_id`
   AND checkpoint.`acquisition_generation` = recovery.`acquisition_generation`
   AND checkpoint.`provider_stage` = 'recipe'
   AND checkpoint.`ownership_id` =
         first_recovery.`original_extraction_fingerprint`
   AND checkpoint.`failure_code` = 'outcome_unknown'
  JOIN `pilot_provider_budget_reconciliations` AS audit
    ON audit.`runtime_stage` = recovery.`runtime_stage`
   AND audit.`dispatch_id` = recovery.`third_recovery_dispatch_id`;

INSERT INTO `pilot_provider_recipe_recovery_attempts` (
  `runtime_stage`, `import_id`, `acquisition_generation`, `recovery_ordinal`,
  `root_dispatch_id`, `predecessor_dispatch_id`, `current_dispatch_id`,
  `root_extraction_fingerprint`, `predecessor_extraction_fingerprint`,
  `current_extraction_fingerprint`, `predecessor_outcome`,
  `terminal_checkpoint_completed_at`,
  `predecessor_reconciliation_created_at`, `evidence_fingerprint`,
  `source_media_sha256`, `transcript_sha256`, `visual_manifest_sha256`,
  `evidence_references_json`,
  `created_at`
)
SELECT recovery.`runtime_stage`, recovery.`import_id`,
       recovery.`acquisition_generation`, 5, recovery.`original_dispatch_id`,
       recovery.`fourth_recovery_dispatch_id`, recovery.`recovery_dispatch_id`,
       first_recovery.`original_extraction_fingerprint`,
       recovery.`fourth_recovery_extraction_fingerprint`,
       recovery.`recovery_extraction_fingerprint`, 'outcome_unknown',
       checkpoint.`completed_at`, audit.`created_at`,
       recovery.`evidence_fingerprint`,
       (SELECT transcript.`source_media_sha256`
          FROM `import_transcriptions` AS transcript
         WHERE transcript.`import_id` = recovery.`import_id`
           AND transcript.`acquisition_generation` =
                 recovery.`acquisition_generation`),
       recovery.`transcript_sha256`,
       recovery.`visual_manifest_sha256`, recovery.`evidence_references_json`,
       recovery.`created_at`
  FROM `pilot_provider_recipe_fifth_recoveries` AS recovery
  JOIN `pilot_provider_recipe_recoveries` AS first_recovery
    ON first_recovery.`runtime_stage` = recovery.`runtime_stage`
   AND first_recovery.`import_id` = recovery.`import_id`
   AND first_recovery.`acquisition_generation` =
         recovery.`acquisition_generation`
   AND first_recovery.`recovery_dispatch_id` =
         recovery.`first_recovery_dispatch_id`
  JOIN `import_provider_terminal_checkpoints` AS checkpoint
    ON checkpoint.`import_id` = recovery.`import_id`
   AND checkpoint.`acquisition_generation` = recovery.`acquisition_generation`
   AND checkpoint.`provider_stage` = 'recipe'
   AND checkpoint.`ownership_id` =
         first_recovery.`original_extraction_fingerprint`
   AND checkpoint.`failure_code` = 'outcome_unknown'
  JOIN `pilot_provider_budget_reconciliations` AS audit
    ON audit.`runtime_stage` = recovery.`runtime_stage`
   AND audit.`dispatch_id` = recovery.`fourth_recovery_dispatch_id`;

INSERT INTO `pilot_provider_recipe_recovery_attempts` (
  `runtime_stage`, `import_id`, `acquisition_generation`, `recovery_ordinal`,
  `root_dispatch_id`, `predecessor_dispatch_id`, `current_dispatch_id`,
  `root_extraction_fingerprint`, `predecessor_extraction_fingerprint`,
  `current_extraction_fingerprint`, `predecessor_outcome`,
  `terminal_checkpoint_completed_at`,
  `predecessor_reconciliation_created_at`, `evidence_fingerprint`,
  `source_media_sha256`, `transcript_sha256`, `visual_manifest_sha256`,
  `evidence_references_json`,
  `created_at`
)
SELECT recovery.`runtime_stage`, recovery.`import_id`,
       recovery.`acquisition_generation`, 6, recovery.`original_dispatch_id`,
       recovery.`fifth_recovery_dispatch_id`, recovery.`recovery_dispatch_id`,
       first_recovery.`original_extraction_fingerprint`,
       recovery.`fifth_recovery_extraction_fingerprint`,
       recovery.`recovery_extraction_fingerprint`, 'outcome_unknown',
       checkpoint.`completed_at`, audit.`created_at`,
       recovery.`evidence_fingerprint`,
       (SELECT transcript.`source_media_sha256`
          FROM `import_transcriptions` AS transcript
         WHERE transcript.`import_id` = recovery.`import_id`
           AND transcript.`acquisition_generation` =
                 recovery.`acquisition_generation`),
       recovery.`transcript_sha256`,
       recovery.`visual_manifest_sha256`, recovery.`evidence_references_json`,
       recovery.`created_at`
  FROM `pilot_provider_recipe_sixth_recoveries` AS recovery
  JOIN `pilot_provider_recipe_recoveries` AS first_recovery
    ON first_recovery.`runtime_stage` = recovery.`runtime_stage`
   AND first_recovery.`import_id` = recovery.`import_id`
   AND first_recovery.`acquisition_generation` =
         recovery.`acquisition_generation`
   AND first_recovery.`recovery_dispatch_id` =
         recovery.`first_recovery_dispatch_id`
  JOIN `import_provider_terminal_checkpoints` AS checkpoint
    ON checkpoint.`import_id` = recovery.`import_id`
   AND checkpoint.`acquisition_generation` = recovery.`acquisition_generation`
   AND checkpoint.`provider_stage` = 'recipe'
   AND checkpoint.`ownership_id` =
         first_recovery.`original_extraction_fingerprint`
   AND checkpoint.`failure_code` = 'outcome_unknown'
  JOIN `pilot_provider_budget_reconciliations` AS audit
    ON audit.`runtime_stage` = recovery.`runtime_stage`
   AND audit.`dispatch_id` = recovery.`fifth_recovery_dispatch_id`;

INSERT INTO `pilot_provider_recipe_recovery_attempts` (
  `runtime_stage`, `import_id`, `acquisition_generation`, `recovery_ordinal`,
  `root_dispatch_id`, `predecessor_dispatch_id`, `current_dispatch_id`,
  `root_extraction_fingerprint`, `predecessor_extraction_fingerprint`,
  `current_extraction_fingerprint`, `predecessor_outcome`,
  `terminal_checkpoint_completed_at`,
  `predecessor_reconciliation_created_at`, `evidence_fingerprint`,
  `source_media_sha256`, `transcript_sha256`, `visual_manifest_sha256`,
  `evidence_references_json`,
  `created_at`
)
SELECT recovery.`runtime_stage`, recovery.`import_id`,
       recovery.`acquisition_generation`, 7, recovery.`original_dispatch_id`,
       recovery.`sixth_recovery_dispatch_id`, recovery.`recovery_dispatch_id`,
       first_recovery.`original_extraction_fingerprint`,
       recovery.`sixth_recovery_extraction_fingerprint`,
       recovery.`recovery_extraction_fingerprint`, 'outcome_unknown',
       checkpoint.`completed_at`, audit.`created_at`,
       recovery.`evidence_fingerprint`,
       (SELECT transcript.`source_media_sha256`
          FROM `import_transcriptions` AS transcript
         WHERE transcript.`import_id` = recovery.`import_id`
           AND transcript.`acquisition_generation` =
                 recovery.`acquisition_generation`),
       recovery.`transcript_sha256`,
       recovery.`visual_manifest_sha256`, recovery.`evidence_references_json`,
       recovery.`created_at`
  FROM `pilot_provider_recipe_seventh_recoveries` AS recovery
  JOIN `pilot_provider_recipe_recoveries` AS first_recovery
    ON first_recovery.`runtime_stage` = recovery.`runtime_stage`
   AND first_recovery.`import_id` = recovery.`import_id`
   AND first_recovery.`acquisition_generation` =
         recovery.`acquisition_generation`
   AND first_recovery.`recovery_dispatch_id` =
         recovery.`first_recovery_dispatch_id`
  JOIN `import_provider_terminal_checkpoints` AS checkpoint
    ON checkpoint.`import_id` = recovery.`import_id`
   AND checkpoint.`acquisition_generation` = recovery.`acquisition_generation`
   AND checkpoint.`provider_stage` = 'recipe'
   AND checkpoint.`ownership_id` =
         first_recovery.`original_extraction_fingerprint`
   AND checkpoint.`failure_code` = 'outcome_unknown'
  JOIN `pilot_provider_budget_reconciliations` AS audit
    ON audit.`runtime_stage` = recovery.`runtime_stage`
   AND audit.`dispatch_id` = recovery.`sixth_recovery_dispatch_id`;

INSERT INTO `pilot_provider_recipe_recovery_attempts` (
  `runtime_stage`, `import_id`, `acquisition_generation`, `recovery_ordinal`,
  `root_dispatch_id`, `predecessor_dispatch_id`, `current_dispatch_id`,
  `root_extraction_fingerprint`, `predecessor_extraction_fingerprint`,
  `current_extraction_fingerprint`, `predecessor_outcome`,
  `terminal_checkpoint_completed_at`,
  `predecessor_reconciliation_created_at`, `evidence_fingerprint`,
  `source_media_sha256`, `transcript_sha256`, `visual_manifest_sha256`,
  `evidence_references_json`,
  `created_at`
)
SELECT recovery.`runtime_stage`, recovery.`import_id`,
       recovery.`acquisition_generation`, 8, recovery.`original_dispatch_id`,
       recovery.`seventh_recovery_dispatch_id`, recovery.`recovery_dispatch_id`,
       first_recovery.`original_extraction_fingerprint`,
       recovery.`seventh_recovery_extraction_fingerprint`,
       recovery.`recovery_extraction_fingerprint`, 'outcome_unknown',
       checkpoint.`completed_at`, audit.`created_at`,
       recovery.`evidence_fingerprint`,
       (SELECT transcript.`source_media_sha256`
          FROM `import_transcriptions` AS transcript
         WHERE transcript.`import_id` = recovery.`import_id`
           AND transcript.`acquisition_generation` =
                 recovery.`acquisition_generation`),
       recovery.`transcript_sha256`,
       recovery.`visual_manifest_sha256`, recovery.`evidence_references_json`,
       recovery.`created_at`
  FROM `pilot_provider_recipe_eighth_recoveries` AS recovery
  JOIN `pilot_provider_recipe_recoveries` AS first_recovery
    ON first_recovery.`runtime_stage` = recovery.`runtime_stage`
   AND first_recovery.`import_id` = recovery.`import_id`
   AND first_recovery.`acquisition_generation` =
         recovery.`acquisition_generation`
   AND first_recovery.`recovery_dispatch_id` =
         recovery.`first_recovery_dispatch_id`
  JOIN `import_provider_terminal_checkpoints` AS checkpoint
    ON checkpoint.`import_id` = recovery.`import_id`
   AND checkpoint.`acquisition_generation` = recovery.`acquisition_generation`
   AND checkpoint.`provider_stage` = 'recipe'
   AND checkpoint.`ownership_id` =
         first_recovery.`original_extraction_fingerprint`
   AND checkpoint.`failure_code` = 'outcome_unknown'
  JOIN `pilot_provider_budget_reconciliations` AS audit
    ON audit.`runtime_stage` = recovery.`runtime_stage`
   AND audit.`dispatch_id` = recovery.`seventh_recovery_dispatch_id`;

CREATE TABLE `__s09_recipe_recovery_cutover_validation` (
  `is_valid` integer NOT NULL
);

CREATE TRIGGER `__s09_recipe_recovery_cutover_validation_guard`
BEFORE INSERT ON `__s09_recipe_recovery_cutover_validation`
WHEN NEW.`is_valid` <> 1
BEGIN
  SELECT RAISE(ABORT, 'recipe recovery attempt ledger backfill rejected');
END;

INSERT INTO `__s09_recipe_recovery_cutover_validation` (`is_valid`)
SELECT CASE
  WHEN
    (SELECT count(*) FROM `pilot_provider_recipe_recovery_attempts`) =
      (SELECT count(*) FROM `pilot_provider_recipe_recoveries`) +
      (SELECT count(*) FROM `pilot_provider_recipe_second_recoveries`) +
      (SELECT count(*) FROM `pilot_provider_recipe_third_recoveries`) +
      (SELECT count(*) FROM `pilot_provider_recipe_fourth_recoveries`) +
      (SELECT count(*) FROM `pilot_provider_recipe_fifth_recoveries`) +
      (SELECT count(*) FROM `pilot_provider_recipe_sixth_recoveries`) +
      (SELECT count(*) FROM `pilot_provider_recipe_seventh_recoveries`) +
      (SELECT count(*) FROM `pilot_provider_recipe_eighth_recoveries`)
    AND (SELECT count(*) FROM `pilot_provider_recipe_recovery_attempts`
          WHERE `recovery_ordinal` = 1) =
        (SELECT count(*) FROM `pilot_provider_recipe_recoveries`)
    AND (SELECT count(*) FROM `pilot_provider_recipe_recovery_attempts`
          WHERE `recovery_ordinal` = 2) =
        (SELECT count(*) FROM `pilot_provider_recipe_second_recoveries`)
    AND (SELECT count(*) FROM `pilot_provider_recipe_recovery_attempts`
          WHERE `recovery_ordinal` = 3) =
        (SELECT count(*) FROM `pilot_provider_recipe_third_recoveries`)
    AND (SELECT count(*) FROM `pilot_provider_recipe_recovery_attempts`
          WHERE `recovery_ordinal` = 4) =
        (SELECT count(*) FROM `pilot_provider_recipe_fourth_recoveries`)
    AND (SELECT count(*) FROM `pilot_provider_recipe_recovery_attempts`
          WHERE `recovery_ordinal` = 5) =
        (SELECT count(*) FROM `pilot_provider_recipe_fifth_recoveries`)
    AND (SELECT count(*) FROM `pilot_provider_recipe_recovery_attempts`
          WHERE `recovery_ordinal` = 6) =
        (SELECT count(*) FROM `pilot_provider_recipe_sixth_recoveries`)
    AND (SELECT count(*) FROM `pilot_provider_recipe_recovery_attempts`
          WHERE `recovery_ordinal` = 7) =
        (SELECT count(*) FROM `pilot_provider_recipe_seventh_recoveries`)
    AND (SELECT count(*) FROM `pilot_provider_recipe_recovery_attempts`
          WHERE `recovery_ordinal` = 8) =
        (SELECT count(*) FROM `pilot_provider_recipe_eighth_recoveries`)
  THEN 1 ELSE 0
END;

DROP TRIGGER `__s09_recipe_recovery_cutover_validation_guard`;
DROP TABLE `__s09_recipe_recovery_cutover_validation`;

CREATE TRIGGER `pilot_provider_recipe_recovery_attempts_admission_insert`
AFTER INSERT ON `pilot_provider_recipe_recovery_attempts`
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
        FROM `recipe_imports` AS parent
        JOIN `pilot_provider_stage_budget` AS stage
          ON stage.`runtime_stage` = NEW.`runtime_stage`
         AND stage.`state` = 'open'
         AND stage.`reserved_micro_usd` = 0
         AND stage.`invoking_dispatch_id` IS NULL
         AND stage.`poison_dispatch_id` IS NULL
         AND stage.`settled_micro_usd` + 100000 <=
               stage.`budget_cap_micro_usd`
        JOIN `pilot_provider_budget_dispatches` AS predecessor_dispatch
          ON predecessor_dispatch.`runtime_stage` = NEW.`runtime_stage`
         AND predecessor_dispatch.`dispatch_id` =
               NEW.`predecessor_dispatch_id`
         AND predecessor_dispatch.`state` = 'settled_unknown'
         AND predecessor_dispatch.`actual_cost_micro_usd` IS NULL
        JOIN `pilot_provider_budget_reconciliations` AS audit
          ON audit.`runtime_stage` = predecessor_dispatch.`runtime_stage`
         AND audit.`dispatch_id` = predecessor_dispatch.`dispatch_id`
         AND audit.`actual_cost_was_unknown` = 1
         AND audit.`authority` = 'authenticated_operator'
         AND audit.`conservative_charge_micro_usd` = 100000
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
             FROM `pilot_provider_recipe_replay_values` AS replay
            WHERE replay.`runtime_stage` = NEW.`runtime_stage`
              AND replay.`dispatch_id` = NEW.`predecessor_dispatch_id`
         )
         AND NOT EXISTS (
           SELECT 1
             FROM `pilot_provider_budget_dispatches` AS dispatched
            WHERE dispatched.`runtime_stage` = NEW.`runtime_stage`
              AND dispatched.`dispatch_id` = NEW.`current_dispatch_id`
         )
         AND NOT EXISTS (
           SELECT 1
             FROM `import_recipe_extractions` AS extraction
            WHERE extraction.`extraction_fingerprint` =
                  NEW.`current_extraction_fingerprint`
         )
    )
    THEN RAISE(
      ABORT,
      'pilot provider recipe recovery attempt admission rejected'
    )
  END;
END;

DROP TRIGGER `pilot_provider_recipe_recovery_budget_insert`;

CREATE TRIGGER `pilot_provider_recipe_recovery_budget_insert`
BEFORE INSERT ON `pilot_provider_budget_dispatches`
WHEN
  NEW.`provider_stage_id` = 'recipe-extraction'
  AND instr(NEW.`dispatch_id`, ':recovery:') > 0
BEGIN
  SELECT CASE
    WHEN NEW.`maximum_cost_micro_usd` <> 100000
      OR NOT EXISTS (
        SELECT 1
          FROM `pilot_provider_recipe_recovery_attempts` AS attempt
         WHERE attempt.`runtime_stage` = NEW.`runtime_stage`
           AND attempt.`current_dispatch_id` = NEW.`dispatch_id`
           AND NEW.`run_id` =
                 'gaia-118:recipe-recovery:' || attempt.`import_id`
      )
    THEN RAISE(
      ABORT,
      'pilot provider recipe recovery budget authority rejected'
    )
  END;
END;

DROP TRIGGER IF EXISTS `pilot_provider_recipe_eighth_recoveries_prepare`;
DROP TRIGGER IF EXISTS `pilot_provider_recipe_eighth_recoveries_immutable_update`;
DROP TRIGGER IF EXISTS `pilot_provider_recipe_eighth_recoveries_immutable_delete`;
DROP TRIGGER IF EXISTS `pilot_provider_recipe_seventh_recoveries_prepare`;
DROP TRIGGER IF EXISTS `pilot_provider_recipe_seventh_recoveries_immutable_update`;
DROP TRIGGER IF EXISTS `pilot_provider_recipe_seventh_recoveries_immutable_delete`;
DROP TRIGGER IF EXISTS `pilot_provider_recipe_sixth_recoveries_prepare`;
DROP TRIGGER IF EXISTS `pilot_provider_recipe_sixth_recoveries_immutable_update`;
DROP TRIGGER IF EXISTS `pilot_provider_recipe_sixth_recoveries_immutable_delete`;
DROP TRIGGER IF EXISTS `pilot_provider_recipe_fifth_recoveries_prepare`;
DROP TRIGGER IF EXISTS `pilot_provider_recipe_fifth_recoveries_immutable_update`;
DROP TRIGGER IF EXISTS `pilot_provider_recipe_fifth_recoveries_immutable_delete`;
DROP TRIGGER IF EXISTS `pilot_provider_recipe_fourth_recoveries_prepare`;
DROP TRIGGER IF EXISTS `pilot_provider_recipe_fourth_recoveries_immutable_update`;
DROP TRIGGER IF EXISTS `pilot_provider_recipe_fourth_recoveries_immutable_delete`;
DROP TRIGGER IF EXISTS `pilot_provider_recipe_third_recoveries_prepare`;
DROP TRIGGER IF EXISTS `pilot_provider_recipe_third_recoveries_immutable_update`;
DROP TRIGGER IF EXISTS `pilot_provider_recipe_third_recoveries_immutable_delete`;
DROP TRIGGER IF EXISTS `pilot_provider_recipe_second_recoveries_prepare`;
DROP TRIGGER IF EXISTS `pilot_provider_recipe_second_recoveries_immutable_update`;
DROP TRIGGER IF EXISTS `pilot_provider_recipe_second_recoveries_immutable_delete`;
DROP TRIGGER IF EXISTS `pilot_provider_recipe_recoveries_prepare`;
DROP TRIGGER IF EXISTS `pilot_provider_recipe_recoveries_immutable_update`;
DROP TRIGGER IF EXISTS `pilot_provider_recipe_recoveries_immutable_delete`;

DROP TABLE `pilot_provider_recipe_eighth_recoveries`;
DROP TABLE `pilot_provider_recipe_seventh_recoveries`;
DROP TABLE `pilot_provider_recipe_sixth_recoveries`;
DROP TABLE `pilot_provider_recipe_fifth_recoveries`;
DROP TABLE `pilot_provider_recipe_fourth_recoveries`;
DROP TABLE `pilot_provider_recipe_third_recoveries`;
DROP TABLE `pilot_provider_recipe_second_recoveries`;
DROP TABLE `pilot_provider_recipe_recoveries`;

PRAGMA foreign_key_check;
PRAGMA foreign_keys = ON;

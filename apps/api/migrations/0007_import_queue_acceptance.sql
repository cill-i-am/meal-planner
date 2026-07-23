PRAGMA foreign_keys = ON;

CREATE TABLE `import_batches` (
  `id` text PRIMARY KEY NOT NULL,
  `idempotency_key_hash` text NOT NULL,
  `request_fingerprint` text NOT NULL,
  `status` text DEFAULT 'queued' NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  CONSTRAINT `import_batches_idempotency_key_hash_unique`
    UNIQUE (`idempotency_key_hash`),
  CONSTRAINT `import_batches_status_check`
    CHECK (`status` IN ('queued', 'running', 'completed', 'partial_failure', 'failed'))
);

CREATE TABLE `import_batch_items` (
  `id` text PRIMARY KEY NOT NULL,
  `batch_id` text NOT NULL,
  `idempotency_key` text NOT NULL,
  `source_kind` text DEFAULT 'tiktok' NOT NULL,
  `source_canonical_id` text NOT NULL,
  `delivery_mode` text DEFAULT 'ordinary' NOT NULL,
  `correlation_json` text,
  `status` text DEFAULT 'queued' NOT NULL,
  `failure_code` text,
  `attempt_count` integer DEFAULT 0 NOT NULL,
  `import_id` text,
  `canonical_source_id` text,
  `import_status_json` text,
  `disposition` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  CONSTRAINT `import_batch_items_batch_id_import_batches_id_fk`
    FOREIGN KEY (`batch_id`) REFERENCES `import_batches`(`id`) ON DELETE CASCADE,
  CONSTRAINT `import_batch_items_batch_id_idempotency_key_unique`
    UNIQUE (`batch_id`, `idempotency_key`),
  CONSTRAINT `import_batch_items_source_kind_check`
    CHECK (`source_kind` = 'tiktok'),
  CONSTRAINT `import_batch_items_delivery_mode_check`
    CHECK (`delivery_mode` IN ('ordinary', 'poison')),
  CONSTRAINT `import_batch_items_correlation_check`
    CHECK (
      (`delivery_mode` = 'poison' AND json_valid(`correlation_json`))
      OR (`delivery_mode` = 'ordinary' AND `correlation_json` IS NULL)
    ),
  CONSTRAINT `import_batch_items_status_check`
    CHECK (`status` IN ('queued', 'running', 'succeeded', 'failed')),
  CONSTRAINT `import_batch_items_attempt_count_check`
    CHECK (typeof(`attempt_count`) = 'integer' AND `attempt_count` >= 0),
  CONSTRAINT `import_batch_items_failure_check`
    CHECK (
      (`status` = 'failed' AND `failure_code` IS NOT NULL)
      OR (`status` <> 'failed' AND `failure_code` IS NULL)
    ),
  CONSTRAINT `import_batch_items_success_check`
    CHECK (
      (
        `status` = 'succeeded'
        AND `import_id` IS NOT NULL
        AND `canonical_source_id` IS NOT NULL
        AND json_valid(`import_status_json`)
        AND `disposition` IN ('created', 'idempotency_replay')
      )
      OR (
        `status` <> 'succeeded'
        AND `import_id` IS NULL
        AND `canonical_source_id` IS NULL
        AND `import_status_json` IS NULL
        AND `disposition` IS NULL
      )
    )
);

CREATE INDEX `import_batch_items_batch_id_idx`
  ON `import_batch_items` (`batch_id`);

CREATE TABLE `import_dead_letters` (
  `item_id` text PRIMARY KEY NOT NULL,
  `failure_code` text NOT NULL,
  `correlation_json` text NOT NULL,
  `replay_state` text DEFAULT 'ready' NOT NULL,
  `replay_claim_id` text,
  `replay_claim_expires_at_epoch_milliseconds` integer,
  `replay_import_json` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  CONSTRAINT `import_dead_letters_item_id_import_batch_items_id_fk`
    FOREIGN KEY (`item_id`) REFERENCES `import_batch_items`(`id`) ON DELETE CASCADE,
  CONSTRAINT `import_dead_letters_failure_code_check`
    CHECK (`failure_code` IN (
      'idempotency_conflict',
      'persistence_corrupt',
      'persistence_unavailable',
      'incompatible_duplicate',
      'invalid_source',
      'source_identity_unavailable',
      'source_validation_unavailable',
      'workflow_start_unavailable'
    )),
  CONSTRAINT `import_dead_letters_correlation_json_check`
    CHECK (json_valid(`correlation_json`)),
  CONSTRAINT `import_dead_letters_replay_state_check`
    CHECK (`replay_state` IN ('ready', 'claimed', 'replayed')),
  CONSTRAINT `import_dead_letters_replay_claim_check`
    CHECK (
      (
        `replay_state` = 'ready'
        AND `replay_claim_id` IS NULL
        AND `replay_claim_expires_at_epoch_milliseconds` IS NULL
      )
      OR (
        `replay_state` = 'claimed'
        AND `replay_claim_id` IS NOT NULL
        AND typeof(`replay_claim_expires_at_epoch_milliseconds`) = 'integer'
        AND `replay_claim_expires_at_epoch_milliseconds` >= 0
      )
      OR (
        `replay_state` = 'replayed'
        AND `replay_claim_id` IS NOT NULL
        AND `replay_claim_expires_at_epoch_milliseconds` IS NULL
      )
    ),
  CONSTRAINT `import_dead_letters_replay_import_check`
    CHECK (
      (`replay_state` = 'replayed' AND json_valid(`replay_import_json`))
      OR (`replay_state` <> 'replayed' AND `replay_import_json` IS NULL)
    )
);

CREATE TABLE `import_operational_events` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `event_tag` text NOT NULL,
  `item_id` text,
  `actor_id` text,
  `event_json` text NOT NULL,
  `occurred_at` text NOT NULL,
  CONSTRAINT `import_operational_events_event_json_check`
    CHECK (json_valid(`event_json`))
);

CREATE INDEX `import_operational_events_item_id_idx`
  ON `import_operational_events` (`item_id`);

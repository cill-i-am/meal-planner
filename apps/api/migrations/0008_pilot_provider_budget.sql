PRAGMA foreign_keys = ON;

CREATE TABLE `pilot_provider_stage_budget` (
  `runtime_stage` text PRIMARY KEY NOT NULL,
  `budget_cap_micro_usd` integer DEFAULT 10000000 NOT NULL,
  `settled_micro_usd` integer DEFAULT 0 NOT NULL,
  `reserved_micro_usd` integer DEFAULT 0 NOT NULL,
  `state` text DEFAULT 'open' NOT NULL,
  `invoking_dispatch_id` text,
  `poison_dispatch_id` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  CONSTRAINT `pilot_provider_stage_budget_runtime_stage_check`
    CHECK (`runtime_stage` = 'pilot-gaia-118'),
  CONSTRAINT `pilot_provider_stage_budget_cap_check`
    CHECK (
      typeof(`budget_cap_micro_usd`) = 'integer'
      AND `budget_cap_micro_usd` = 10000000
    ),
  CONSTRAINT `pilot_provider_stage_budget_amounts_check`
    CHECK (
      typeof(`settled_micro_usd`) = 'integer'
      AND `settled_micro_usd` >= 0
      AND typeof(`reserved_micro_usd`) = 'integer'
      AND `reserved_micro_usd` >= 0
      AND `settled_micro_usd` + `reserved_micro_usd` <= `budget_cap_micro_usd`
    ),
  CONSTRAINT `pilot_provider_stage_budget_state_check`
    CHECK (
      (
        `state` = 'open'
        AND `invoking_dispatch_id` IS NULL
        AND `poison_dispatch_id` IS NULL
      )
      OR (
        `state` = 'invoking'
        AND `invoking_dispatch_id` IS NOT NULL
        AND `poison_dispatch_id` IS NULL
      )
      OR (
        `state` = 'poisoned'
        AND `invoking_dispatch_id` IS NULL
        AND `poison_dispatch_id` IS NOT NULL
      )
  )
);

INSERT INTO `pilot_provider_stage_budget` (
  `runtime_stage`,
  `created_at`,
  `updated_at`
) VALUES (
  'pilot-gaia-118',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
);

CREATE TABLE `pilot_provider_budget_dispatches` (
  `runtime_stage` text NOT NULL,
  `dispatch_id` text NOT NULL,
  `run_id` text NOT NULL,
  `provider_stage_id` text NOT NULL,
  `maximum_cost_micro_usd` integer NOT NULL,
  `actual_cost_micro_usd` integer,
  `state` text DEFAULT 'reserved' NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  `invocation_started_at` text,
  `completed_at` text,
  PRIMARY KEY (`runtime_stage`, `dispatch_id`),
  CONSTRAINT `pilot_provider_budget_dispatches_stage_fk`
    FOREIGN KEY (`runtime_stage`)
    REFERENCES `pilot_provider_stage_budget`(`runtime_stage`)
    ON DELETE RESTRICT,
  CONSTRAINT `pilot_provider_budget_dispatches_runtime_stage_check`
    CHECK (`runtime_stage` = 'pilot-gaia-118'),
  CONSTRAINT `pilot_provider_budget_dispatches_maximum_check`
    CHECK (
      typeof(`maximum_cost_micro_usd`) = 'integer'
      AND `maximum_cost_micro_usd` > 0
      AND `maximum_cost_micro_usd` <= 10000000
    ),
  CONSTRAINT `pilot_provider_budget_dispatches_shape_check`
    CHECK (
      (
        `state` = 'reserved'
        AND `actual_cost_micro_usd` IS NULL
        AND `invocation_started_at` IS NULL
        AND `completed_at` IS NULL
      )
      OR (
        `state` = 'invoking'
        AND `actual_cost_micro_usd` IS NULL
        AND `invocation_started_at` IS NOT NULL
        AND `completed_at` IS NULL
      )
      OR (
        `state` = 'released'
        AND `actual_cost_micro_usd` IS NULL
        AND `invocation_started_at` IS NULL
        AND `completed_at` IS NOT NULL
      )
      OR (
        `state` = 'settled_known'
        AND typeof(`actual_cost_micro_usd`) = 'integer'
        AND `actual_cost_micro_usd` >= 0
        AND `actual_cost_micro_usd` <= `maximum_cost_micro_usd`
        AND `invocation_started_at` IS NOT NULL
        AND `completed_at` IS NOT NULL
      )
      OR (
        `state` = 'settled_unknown'
        AND `actual_cost_micro_usd` IS NULL
        AND `invocation_started_at` IS NOT NULL
        AND `completed_at` IS NOT NULL
      )
    )
);

CREATE INDEX `pilot_provider_budget_dispatches_run_idx`
  ON `pilot_provider_budget_dispatches` (`runtime_stage`, `run_id`);

CREATE TRIGGER `pilot_provider_budget_dispatches_transition_guard`
BEFORE UPDATE ON `pilot_provider_budget_dispatches`
BEGIN
  SELECT CASE
    WHEN OLD.`runtime_stage` <> NEW.`runtime_stage`
      OR OLD.`dispatch_id` <> NEW.`dispatch_id`
      OR OLD.`run_id` <> NEW.`run_id`
      OR OLD.`provider_stage_id` <> NEW.`provider_stage_id`
      OR OLD.`maximum_cost_micro_usd` <> NEW.`maximum_cost_micro_usd`
      OR OLD.`created_at` <> NEW.`created_at`
    THEN RAISE(ABORT, 'pilot provider dispatch identity is immutable')
  END;
  SELECT CASE
    WHEN NOT (
      (OLD.`state` = 'reserved' AND NEW.`state` IN ('invoking', 'released'))
      OR (
        OLD.`state` = 'invoking'
        AND NEW.`state` IN ('settled_known', 'settled_unknown')
      )
    )
    THEN RAISE(ABORT, 'invalid pilot provider dispatch transition')
  END;
END;

CREATE TRIGGER `pilot_provider_budget_dispatches_reserve`
AFTER INSERT ON `pilot_provider_budget_dispatches`
BEGIN
  UPDATE `pilot_provider_stage_budget`
     SET `reserved_micro_usd` =
           `reserved_micro_usd` + NEW.`maximum_cost_micro_usd`,
         `updated_at` = NEW.`updated_at`
   WHERE `runtime_stage` = NEW.`runtime_stage`
     AND `state` = 'open'
     AND `settled_micro_usd`
         + `reserved_micro_usd`
         + NEW.`maximum_cost_micro_usd`
       <= `budget_cap_micro_usd`;
  SELECT CASE
    WHEN changes() <> 1
    THEN RAISE(ABORT, 'pilot provider reservation rejected')
  END;
END;

CREATE TRIGGER `pilot_provider_budget_dispatches_release`
AFTER UPDATE OF `state` ON `pilot_provider_budget_dispatches`
WHEN OLD.`state` = 'reserved' AND NEW.`state` = 'released'
BEGIN
  UPDATE `pilot_provider_stage_budget`
     SET `reserved_micro_usd` =
           `reserved_micro_usd` - OLD.`maximum_cost_micro_usd`,
         `updated_at` = NEW.`updated_at`
   WHERE `runtime_stage` = NEW.`runtime_stage`
     AND `state` = 'open';
  SELECT CASE
    WHEN changes() <> 1
    THEN RAISE(ABORT, 'pilot provider release rejected')
  END;
END;

CREATE TRIGGER `pilot_provider_budget_dispatches_begin_invocation`
AFTER UPDATE OF `state` ON `pilot_provider_budget_dispatches`
WHEN OLD.`state` = 'reserved' AND NEW.`state` = 'invoking'
BEGIN
  UPDATE `pilot_provider_stage_budget`
     SET `state` = 'invoking',
         `invoking_dispatch_id` = NEW.`dispatch_id`,
         `updated_at` = NEW.`updated_at`
   WHERE `runtime_stage` = NEW.`runtime_stage`
     AND `state` = 'open';
  SELECT CASE
    WHEN changes() <> 1
    THEN RAISE(ABORT, 'pilot provider invocation rejected')
  END;
END;

CREATE TRIGGER `pilot_provider_budget_dispatches_settle_known`
AFTER UPDATE OF `state` ON `pilot_provider_budget_dispatches`
WHEN OLD.`state` = 'invoking' AND NEW.`state` = 'settled_known'
BEGIN
  UPDATE `pilot_provider_stage_budget`
     SET `settled_micro_usd` =
           `settled_micro_usd` + NEW.`actual_cost_micro_usd`,
         `reserved_micro_usd` =
           `reserved_micro_usd` - OLD.`maximum_cost_micro_usd`,
         `state` = 'open',
         `invoking_dispatch_id` = NULL,
         `updated_at` = NEW.`updated_at`
   WHERE `runtime_stage` = NEW.`runtime_stage`
     AND `state` = 'invoking'
     AND `invoking_dispatch_id` = NEW.`dispatch_id`;
  SELECT CASE
    WHEN changes() <> 1
    THEN RAISE(ABORT, 'pilot provider known settlement rejected')
  END;
END;

CREATE TRIGGER `pilot_provider_budget_dispatches_settle_unknown`
AFTER UPDATE OF `state` ON `pilot_provider_budget_dispatches`
WHEN OLD.`state` = 'invoking' AND NEW.`state` = 'settled_unknown'
BEGIN
  UPDATE `pilot_provider_stage_budget`
     SET `state` = 'poisoned',
         `invoking_dispatch_id` = NULL,
         `poison_dispatch_id` = NEW.`dispatch_id`,
         `updated_at` = NEW.`updated_at`
   WHERE `runtime_stage` = NEW.`runtime_stage`
     AND `state` = 'invoking'
     AND `invoking_dispatch_id` = NEW.`dispatch_id`;
  SELECT CASE
    WHEN changes() <> 1
    THEN RAISE(ABORT, 'pilot provider unknown settlement rejected')
  END;
END;

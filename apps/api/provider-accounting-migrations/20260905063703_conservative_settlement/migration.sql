DROP TRIGGER `provider_accounting_dispatches_transition_guard`;
--> statement-breakpoint
CREATE TRIGGER `provider_accounting_dispatches_transition_guard`
BEFORE UPDATE ON `provider_accounting_dispatches`
BEGIN
	SELECT CASE
		WHEN OLD.`accounting_scope` <> NEW.`accounting_scope`
			OR OLD.`dispatch_id` <> NEW.`dispatch_id`
			OR OLD.`run_id` <> NEW.`run_id`
			OR OLD.`provider_stage_id` <> NEW.`provider_stage_id`
			OR OLD.`maximum_cost_micro_usd` <> NEW.`maximum_cost_micro_usd`
			OR OLD.`created_at` <> NEW.`created_at`
		THEN RAISE(ABORT, 'provider dispatch identity is immutable')
	END;
	SELECT CASE
		WHEN NOT (
			(OLD.`state` = 'reserved' AND NEW.`state` IN ('invoking', 'released'))
			OR (OLD.`state` = 'invoking' AND NEW.`state` IN ('settled_known', 'settled_unknown', 'settled_conservative'))
		)
		THEN RAISE(ABORT, 'invalid provider dispatch transition')
	END;
END;
--> statement-breakpoint
CREATE TRIGGER `provider_accounting_dispatches_settle_conservative`
AFTER UPDATE OF `state` ON `provider_accounting_dispatches`
WHEN OLD.`state` = 'invoking' AND NEW.`state` = 'settled_conservative'
BEGIN
  SELECT CASE WHEN NEW.`provider_stage_id` <> 'recipe-extraction'
    OR NEW.`maximum_cost_micro_usd` <> 100000
    OR NOT EXISTS (
      SELECT 1 FROM `provider_accounting_conservative_settlements` AS audit
      JOIN `provider_accounting_recipe_replay_values` AS replay
        ON replay.`accounting_scope` = audit.`accounting_scope`
        AND replay.`dispatch_id` = audit.`dispatch_id`
      WHERE audit.`accounting_scope` = NEW.`accounting_scope`
        AND audit.`dispatch_id` = NEW.`dispatch_id`
        AND audit.`actual_cost_was_unknown` = 1
        AND audit.`authority` = 'schema_valid_provider_response'
        AND audit.`conservative_charge_micro_usd` = NEW.`maximum_cost_micro_usd`
    ) THEN RAISE(ABORT, 'provider conservative settlement evidence missing') END;
  UPDATE `provider_accounting_budgets`
    SET `settled_micro_usd` = `settled_micro_usd` + NEW.`maximum_cost_micro_usd`,
      `reserved_micro_usd` = `reserved_micro_usd` - OLD.`maximum_cost_micro_usd`,
      `state` = 'open', `invoking_dispatch_id` = NULL,
      `updated_at` = NEW.`updated_at`
    WHERE `accounting_scope` = NEW.`accounting_scope`
      AND `state` = 'invoking' AND `invoking_dispatch_id` = NEW.`dispatch_id`;
  SELECT CASE WHEN changes() <> 1 THEN RAISE(ABORT, 'provider conservative settlement rejected') END;
END;

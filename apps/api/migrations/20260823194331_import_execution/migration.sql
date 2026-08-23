DROP TABLE IF EXISTS `pilot_provider_recipe_replay_values`;
--> statement-breakpoint
DROP TABLE IF EXISTS `pilot_provider_budget_conservative_settlements`;
--> statement-breakpoint
DROP TABLE IF EXISTS `pilot_provider_budget_reconciliations`;
--> statement-breakpoint
DROP TABLE IF EXISTS `pilot_provider_budget_dispatches`;
--> statement-breakpoint
DROP TABLE IF EXISTS `pilot_provider_stage_budget`;
--> statement-breakpoint
CREATE TABLE `provider_accounting_budgets` (
	`accounting_scope` text PRIMARY KEY,
	`budget_cap_micro_usd` integer DEFAULT 10000000 NOT NULL,
	`created_at` text NOT NULL,
	`invoking_dispatch_id` text,
	`poison_dispatch_id` text,
	`reserved_micro_usd` integer DEFAULT 0 NOT NULL,
	`settled_micro_usd` integer DEFAULT 0 NOT NULL,
	`state` text DEFAULT 'open' NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "provider_accounting_budgets_scope_check" CHECK("accounting_scope" = 'recipe-import'),
	CONSTRAINT "provider_accounting_budgets_cap_check" CHECK(typeof("budget_cap_micro_usd") = 'integer' AND "budget_cap_micro_usd" = 10000000),
	CONSTRAINT "provider_accounting_budgets_amounts_check" CHECK(typeof("settled_micro_usd") = 'integer' AND "settled_micro_usd" >= 0 AND typeof("reserved_micro_usd") = 'integer' AND "reserved_micro_usd" >= 0 AND "settled_micro_usd" + "reserved_micro_usd" <= "budget_cap_micro_usd"),
	CONSTRAINT "provider_accounting_budgets_state_check" CHECK(("state" = 'open' AND "invoking_dispatch_id" IS NULL AND "poison_dispatch_id" IS NULL) OR ("state" = 'invoking' AND "invoking_dispatch_id" IS NOT NULL AND "poison_dispatch_id" IS NULL) OR ("state" = 'poisoned' AND "invoking_dispatch_id" IS NULL AND "poison_dispatch_id" IS NOT NULL))
);
--> statement-breakpoint
INSERT INTO `provider_accounting_budgets` (
	`accounting_scope`, `created_at`, `updated_at`
) VALUES (
	'recipe-import',
	strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
	strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
);
--> statement-breakpoint
CREATE TABLE `provider_accounting_conservative_settlements` (
	`accounting_scope` text NOT NULL,
	`actual_cost_was_unknown` integer NOT NULL,
	`authority` text NOT NULL,
	`conservative_charge_micro_usd` integer NOT NULL,
	`created_at` text NOT NULL,
	`dispatch_id` text NOT NULL,
	CONSTRAINT `provider_accounting_conservative_settlements_pk` PRIMARY KEY(`accounting_scope`, `dispatch_id`),
	CONSTRAINT `provider_accounting_conservative_settlements_dispatch_fk` FOREIGN KEY (`accounting_scope`,`dispatch_id`) REFERENCES `provider_accounting_dispatches`(`accounting_scope`,`dispatch_id`) ON DELETE RESTRICT,
	CONSTRAINT "provider_accounting_conservative_settlements_scope_check" CHECK("accounting_scope" = 'recipe-import'),
	CONSTRAINT "provider_accounting_conservative_settlements_charge_check" CHECK("conservative_charge_micro_usd" = 100000),
	CONSTRAINT "provider_accounting_conservative_settlements_unknown_check" CHECK("actual_cost_was_unknown" = 1),
	CONSTRAINT "provider_accounting_conservative_settlements_authority_check" CHECK("authority" = 'schema_valid_provider_response')
);
--> statement-breakpoint
CREATE TABLE `provider_accounting_dispatches` (
	`accounting_scope` text NOT NULL,
	`actual_cost_micro_usd` integer,
	`completed_at` text,
	`created_at` text NOT NULL,
	`dispatch_id` text NOT NULL,
	`invocation_expires_at` text,
	`invocation_generation` integer DEFAULT 0 NOT NULL,
	`invocation_started_at` text,
	`maximum_cost_micro_usd` integer NOT NULL,
	`provider_stage_id` text NOT NULL,
	`run_id` text NOT NULL,
	`state` text DEFAULT 'reserved' NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT `provider_accounting_dispatches_pk` PRIMARY KEY(`accounting_scope`, `dispatch_id`),
	CONSTRAINT `provider_accounting_dispatches_budget_fk` FOREIGN KEY (`accounting_scope`) REFERENCES `provider_accounting_budgets`(`accounting_scope`) ON DELETE RESTRICT,
	CONSTRAINT "provider_accounting_dispatches_scope_check" CHECK("accounting_scope" = 'recipe-import'),
	CONSTRAINT "provider_accounting_dispatches_maximum_check" CHECK(typeof("maximum_cost_micro_usd") = 'integer' AND "maximum_cost_micro_usd" > 0 AND "maximum_cost_micro_usd" <= 10000000),
	CONSTRAINT "provider_accounting_dispatches_shape_check" CHECK(("state" = 'reserved' AND "actual_cost_micro_usd" IS NULL AND "invocation_generation" = 0 AND "invocation_started_at" IS NULL AND "invocation_expires_at" IS NULL AND "completed_at" IS NULL) OR ("state" = 'invoking' AND "actual_cost_micro_usd" IS NULL AND typeof("invocation_generation") = 'integer' AND "invocation_generation" >= 1 AND "invocation_started_at" IS NOT NULL AND "invocation_expires_at" IS NOT NULL AND "completed_at" IS NULL) OR ("state" = 'released' AND "actual_cost_micro_usd" IS NULL AND "invocation_generation" = 0 AND "invocation_started_at" IS NULL AND "invocation_expires_at" IS NULL AND "completed_at" IS NOT NULL) OR ("state" = 'settled_known' AND typeof("actual_cost_micro_usd") = 'integer' AND "actual_cost_micro_usd" >= 0 AND "actual_cost_micro_usd" <= "maximum_cost_micro_usd" AND typeof("invocation_generation") = 'integer' AND "invocation_generation" >= 1 AND "invocation_started_at" IS NOT NULL AND "invocation_expires_at" IS NULL AND "completed_at" IS NOT NULL) OR ("state" = 'settled_unknown' AND "actual_cost_micro_usd" IS NULL AND typeof("invocation_generation") = 'integer' AND "invocation_generation" >= 1 AND "invocation_started_at" IS NOT NULL AND "invocation_expires_at" IS NULL AND "completed_at" IS NOT NULL) OR ("state" = 'settled_conservative' AND "actual_cost_micro_usd" IS NULL AND typeof("invocation_generation") = 'integer' AND "invocation_generation" >= 1 AND "invocation_started_at" IS NOT NULL AND "invocation_expires_at" IS NULL AND "completed_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE `provider_accounting_recipe_replay_values` (
	`accounting_scope` text NOT NULL,
	`created_at` text NOT NULL,
	`dispatch_id` text NOT NULL,
	`evidence_fingerprint` text NOT NULL,
	`expires_at` text NOT NULL,
	`generation` integer NOT NULL,
	`import_id` text NOT NULL,
	`value_json` text NOT NULL,
	`value_sha256` text NOT NULL,
	CONSTRAINT `provider_accounting_recipe_replay_values_pk` PRIMARY KEY(`accounting_scope`, `dispatch_id`),
	CONSTRAINT `provider_accounting_recipe_replay_values_audit_fk` FOREIGN KEY (`accounting_scope`,`dispatch_id`) REFERENCES `provider_accounting_conservative_settlements`(`accounting_scope`,`dispatch_id`) ON DELETE RESTRICT,
	CONSTRAINT "provider_accounting_recipe_replay_values_scope_check" CHECK("accounting_scope" = 'recipe-import'),
	CONSTRAINT "provider_accounting_recipe_replay_values_dispatch_check" CHECK("dispatch_id" = 'recipe:' || "import_id" || ':' || "generation" || ':' || "evidence_fingerprint" OR "dispatch_id" = 'recipe:' || "import_id" || ':' || "generation" || ':' || "evidence_fingerprint" || ':recovery:1' OR "dispatch_id" = 'recipe:' || "import_id" || ':' || "generation" || ':' || "evidence_fingerprint" || ':recovery:2' OR "dispatch_id" = 'recipe:' || "import_id" || ':' || "generation" || ':' || "evidence_fingerprint" || ':recovery:3' OR "dispatch_id" = 'recipe:' || "import_id" || ':' || "generation" || ':' || "evidence_fingerprint" || ':recovery:4' OR "dispatch_id" = 'recipe:' || "import_id" || ':' || "generation" || ':' || "evidence_fingerprint" || ':recovery:5' OR "dispatch_id" = 'recipe:' || "import_id" || ':' || "generation" || ':' || "evidence_fingerprint" || ':recovery:6' OR "dispatch_id" = 'recipe:' || "import_id" || ':' || "generation" || ':' || "evidence_fingerprint" || ':recovery:7' OR "dispatch_id" = 'recipe:' || "import_id" || ':' || "generation" || ':' || "evidence_fingerprint" || ':recovery:8'),
	CONSTRAINT "provider_accounting_recipe_replay_values_identity_check" CHECK(length("import_id") BETWEEN 1 AND 128 AND "generation" >= 1 AND length("evidence_fingerprint") = 64 AND "evidence_fingerprint" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "provider_accounting_recipe_replay_values_value_check" CHECK(length(CAST("value_json" AS BLOB)) BETWEEN 1 AND 262144 AND json_valid("value_json") AND length("value_sha256") = 64 AND "value_sha256" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "provider_accounting_recipe_replay_values_lifecycle_check" CHECK("expires_at" = strftime('%Y-%m-%dT%H:%M:%fZ', "created_at", '+7 days'))
);
--> statement-breakpoint
CREATE TABLE `provider_accounting_reconciliations` (
	`accounting_scope` text NOT NULL,
	`actual_cost_was_unknown` integer DEFAULT 1 NOT NULL,
	`authority` text NOT NULL,
	`conservative_charge_micro_usd` integer NOT NULL,
	`created_at` text NOT NULL,
	`dispatch_id` text NOT NULL,
	CONSTRAINT `provider_accounting_reconciliations_pk` PRIMARY KEY(`accounting_scope`, `dispatch_id`),
	CONSTRAINT `provider_accounting_reconciliations_dispatch_fk` FOREIGN KEY (`accounting_scope`,`dispatch_id`) REFERENCES `provider_accounting_dispatches`(`accounting_scope`,`dispatch_id`) ON DELETE RESTRICT,
	CONSTRAINT "provider_accounting_reconciliations_scope_check" CHECK("accounting_scope" = 'recipe-import'),
	CONSTRAINT "provider_accounting_reconciliations_charge_check" CHECK(typeof("conservative_charge_micro_usd") = 'integer' AND "conservative_charge_micro_usd" > 0 AND "conservative_charge_micro_usd" <= 10000000),
	CONSTRAINT "provider_accounting_reconciliations_unknown_check" CHECK("actual_cost_was_unknown" = 1),
	CONSTRAINT "provider_accounting_reconciliations_authority_check" CHECK("authority" = 'authenticated_operator')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `provider_accounting_dispatches_run_idx` ON `provider_accounting_dispatches` (`accounting_scope`,`run_id`,`dispatch_id`);
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
			OR (OLD.`state` = 'invoking' AND NEW.`state` IN ('settled_known', 'settled_unknown'))
		)
		THEN RAISE(ABORT, 'invalid provider dispatch transition')
	END;
END;
--> statement-breakpoint
CREATE TRIGGER `provider_accounting_dispatches_reserve`
AFTER INSERT ON `provider_accounting_dispatches`
BEGIN
	UPDATE `provider_accounting_budgets`
		SET `reserved_micro_usd` = `reserved_micro_usd` + NEW.`maximum_cost_micro_usd`,
			`updated_at` = NEW.`updated_at`
		WHERE `accounting_scope` = NEW.`accounting_scope`
			AND `state` = 'open'
			AND `settled_micro_usd` + `reserved_micro_usd` + NEW.`maximum_cost_micro_usd` <= `budget_cap_micro_usd`;
	SELECT CASE WHEN changes() <> 1 THEN RAISE(ABORT, 'provider reservation rejected') END;
END;
--> statement-breakpoint
CREATE TRIGGER `provider_accounting_dispatches_release`
AFTER UPDATE OF `state` ON `provider_accounting_dispatches`
WHEN OLD.`state` = 'reserved' AND NEW.`state` = 'released'
BEGIN
	UPDATE `provider_accounting_budgets`
		SET `reserved_micro_usd` = `reserved_micro_usd` - OLD.`maximum_cost_micro_usd`,
			`updated_at` = NEW.`updated_at`
		WHERE `accounting_scope` = NEW.`accounting_scope` AND `state` = 'open';
	SELECT CASE WHEN changes() <> 1 THEN RAISE(ABORT, 'provider release rejected') END;
END;
--> statement-breakpoint
CREATE TRIGGER `provider_accounting_dispatches_begin_invocation`
AFTER UPDATE OF `state` ON `provider_accounting_dispatches`
WHEN OLD.`state` = 'reserved' AND NEW.`state` = 'invoking'
BEGIN
	UPDATE `provider_accounting_budgets`
		SET `state` = 'invoking', `invoking_dispatch_id` = NEW.`dispatch_id`,
			`updated_at` = NEW.`updated_at`
		WHERE `accounting_scope` = NEW.`accounting_scope` AND `state` = 'open';
	SELECT CASE WHEN changes() <> 1 THEN RAISE(ABORT, 'provider invocation rejected') END;
END;
--> statement-breakpoint
CREATE TRIGGER `provider_accounting_dispatches_settle_known`
AFTER UPDATE OF `state` ON `provider_accounting_dispatches`
WHEN OLD.`state` = 'invoking' AND NEW.`state` = 'settled_known'
BEGIN
	UPDATE `provider_accounting_budgets`
		SET `settled_micro_usd` = `settled_micro_usd` + NEW.`actual_cost_micro_usd`,
			`reserved_micro_usd` = `reserved_micro_usd` - OLD.`maximum_cost_micro_usd`,
			`state` = 'open', `invoking_dispatch_id` = NULL,
			`updated_at` = NEW.`updated_at`
		WHERE `accounting_scope` = NEW.`accounting_scope`
			AND `state` = 'invoking' AND `invoking_dispatch_id` = NEW.`dispatch_id`;
	SELECT CASE WHEN changes() <> 1 THEN RAISE(ABORT, 'provider known settlement rejected') END;
END;
--> statement-breakpoint
CREATE TRIGGER `provider_accounting_dispatches_settle_unknown`
AFTER UPDATE OF `state` ON `provider_accounting_dispatches`
WHEN OLD.`state` = 'invoking' AND NEW.`state` = 'settled_unknown'
BEGIN
	UPDATE `provider_accounting_budgets`
		SET `state` = 'poisoned', `invoking_dispatch_id` = NULL,
			`poison_dispatch_id` = NEW.`dispatch_id`, `updated_at` = NEW.`updated_at`
		WHERE `accounting_scope` = NEW.`accounting_scope`
			AND `state` = 'invoking' AND `invoking_dispatch_id` = NEW.`dispatch_id`;
	SELECT CASE WHEN changes() <> 1 THEN RAISE(ABORT, 'provider unknown settlement rejected') END;
END;
--> statement-breakpoint
CREATE TRIGGER `provider_accounting_reconciliations_immutable_update`
BEFORE UPDATE ON `provider_accounting_reconciliations`
BEGIN
	SELECT RAISE(ABORT, 'provider accounting reconciliation is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `provider_accounting_reconciliations_immutable_delete`
BEFORE DELETE ON `provider_accounting_reconciliations`
BEGIN
	SELECT RAISE(ABORT, 'provider accounting reconciliation is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `provider_accounting_conservative_settlements_immutable_update`
BEFORE UPDATE ON `provider_accounting_conservative_settlements`
BEGIN
	SELECT RAISE(ABORT, 'provider conservative settlement audit is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `provider_accounting_conservative_settlements_immutable_delete`
BEFORE DELETE ON `provider_accounting_conservative_settlements`
BEGIN
	SELECT RAISE(ABORT, 'provider conservative settlement audit is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `provider_accounting_recipe_replay_values_immutable_update`
BEFORE UPDATE ON `provider_accounting_recipe_replay_values`
BEGIN
	SELECT RAISE(ABORT, 'provider recipe replay value is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `provider_accounting_recipe_replay_values_expired_cleanup`
AFTER INSERT ON `provider_accounting_recipe_replay_values`
BEGIN
	DELETE FROM `provider_accounting_recipe_replay_values`
		WHERE `expires_at` <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now');
END;
--> statement-breakpoint
CREATE TRIGGER `provider_accounting_recipe_replay_values_dispatch_insert_cleanup`
AFTER INSERT ON `provider_accounting_dispatches`
BEGIN
	DELETE FROM `provider_accounting_recipe_replay_values`
		WHERE `expires_at` <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now');
END;
--> statement-breakpoint
CREATE TRIGGER `provider_accounting_recipe_replay_values_dispatch_update_cleanup`
AFTER UPDATE ON `provider_accounting_dispatches`
BEGIN
	DELETE FROM `provider_accounting_recipe_replay_values`
		WHERE `expires_at` <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now');
END;

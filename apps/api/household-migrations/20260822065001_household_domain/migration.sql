CREATE TABLE `household_recipe_import_mutation_receipts` (
	`command_digest` text NOT NULL,
	`mutation_id` text PRIMARY KEY,
	`result_json` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `household_recipe_import_requests` (
	`idempotency_key_digest` text PRIMARY KEY,
	`intent_id` text NOT NULL,
	`request_digest` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `household_recipe_import_timeline` (
	`event_json` text NOT NULL,
	`intent_id` text NOT NULL,
	`intent_version` integer NOT NULL,
	CONSTRAINT `household_recipe_import_timeline_pk` PRIMARY KEY(`intent_id`, `intent_version`)
);
--> statement-breakpoint
CREATE TABLE `household_recipe_imports` (
	`action_json` text,
	`actor_id` text NOT NULL,
	`canonical_source_id` text,
	`created_at` text NOT NULL,
	`evidence_fingerprint` text,
	`execution_generation` integer NOT NULL,
	`extraction_fingerprint` text,
	`intent_id` text PRIMARY KEY,
	`intent_json` text NOT NULL,
	`recipe_id` text,
	`review_json` text,
	`status` text NOT NULL,
	`submitted_source_url` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `household_recipe_review_corrections` (
	`action_version` integer NOT NULL,
	`correction_json` text NOT NULL,
	`intent_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	CONSTRAINT `household_recipe_review_corrections_pk` PRIMARY KEY(`intent_id`, `action_version`, `ordinal`)
);
--> statement-breakpoint
CREATE TABLE `household_recipe_review_transitions` (
	`intent_id` text NOT NULL,
	`transition_json` text NOT NULL,
	`version` integer NOT NULL,
	CONSTRAINT `household_recipe_review_transitions_pk` PRIMARY KEY(`intent_id`, `version`)
);
--> statement-breakpoint
CREATE TABLE `household_recipes` (
	`import_id` text NOT NULL UNIQUE,
	`planning_recipe_json` text NOT NULL,
	`public_recipe_json` text NOT NULL,
	`published_at` text NOT NULL,
	`recipe_id` text PRIMARY KEY,
	`version` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `household_recipe_imports_recipe_unique` ON `household_recipe_imports` (`recipe_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `household_recipe_imports_live_source_unique` ON `household_recipe_imports` (`canonical_source_id`) WHERE "household_recipe_imports"."canonical_source_id" IS NOT NULL AND "household_recipe_imports"."status" IN ('processing', 'requires_action', 'succeeded');
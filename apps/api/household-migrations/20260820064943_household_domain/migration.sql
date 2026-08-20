CREATE TABLE `household_recipe_bank` (
	`approved_recipe_json` text NOT NULL,
	`import_id` text PRIMARY KEY,
	`review_version` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `household_recipe_review_mutation_receipts` (
	`command_digest` text NOT NULL,
	`import_id` text NOT NULL,
	`mutation_id` text NOT NULL,
	`result_json` text NOT NULL,
	CONSTRAINT `household_recipe_review_mutation_receipts_pk` PRIMARY KEY(`import_id`, `mutation_id`)
);

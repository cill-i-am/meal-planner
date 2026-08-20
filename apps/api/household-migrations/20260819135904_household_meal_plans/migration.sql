CREATE TABLE `household_meal_plan_mutation_receipts` (
	`draft_id` text NOT NULL,
	`mutation_fingerprint` text NOT NULL,
	`mutation_id` text NOT NULL,
	`result_json` text NOT NULL,
	CONSTRAINT `household_meal_plan_mutation_receipts_pk` PRIMARY KEY(`draft_id`, `mutation_id`)
);
--> statement-breakpoint
CREATE TABLE `household_meal_plans` (
	`draft_id` text PRIMARY KEY,
	`plan_json` text NOT NULL,
	`request_fingerprint_digest` text NOT NULL,
	`revision` integer NOT NULL
);

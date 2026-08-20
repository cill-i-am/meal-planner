CREATE TABLE `household_recipe_reviews` (
	`extraction_fingerprint` text NOT NULL,
	`import_id` text PRIMARY KEY,
	`lifecycle` text NOT NULL,
	`opened_at` text NOT NULL,
	`review_json` text NOT NULL,
	`version` integer NOT NULL
);

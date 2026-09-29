CREATE TABLE `household_planning_content_versions` (
	`actor_id` text NOT NULL,
	`intent_digest` text NOT NULL,
	`mutation_id` text NOT NULL UNIQUE,
	`snapshot_json` text NOT NULL,
	`version` integer PRIMARY KEY,
	CONSTRAINT "planning_content_version_positive" CHECK("version" >= 1)
);

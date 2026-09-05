CREATE TABLE `household_profile_versions` (
	`intent_digest` text NOT NULL,
	`mutation_id` text NOT NULL UNIQUE,
	`person_id` text NOT NULL,
	`snapshot_json` text NOT NULL,
	`version` integer NOT NULL,
	CONSTRAINT `household_profile_versions_pk` PRIMARY KEY(`person_id`, `version`)
);

CREATE TABLE `household_meta` (
	`created_at_epoch_ms` integer NOT NULL,
	`organization_id` text NOT NULL UNIQUE,
	`singleton_key` text PRIMARY KEY
);

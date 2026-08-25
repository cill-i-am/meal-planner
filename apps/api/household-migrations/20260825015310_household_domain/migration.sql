CREATE TABLE `household_import_acquisition_attempts` (
	`acquisition_attempt_generation` integer NOT NULL,
	`attempt_identity` text PRIMARY KEY,
	`attempt_ordinal` integer NOT NULL,
	`canonical_source_id` text NOT NULL,
	`claimed_at` text NOT NULL,
	`execution_generation` integer NOT NULL,
	`intent_id` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `household_import_acquisition_attempt_ordinal_unique` ON `household_import_acquisition_attempts` (`intent_id`,`execution_generation`,`attempt_ordinal`);--> statement-breakpoint
CREATE UNIQUE INDEX `household_import_acquisition_generation_unique` ON `household_import_acquisition_attempts` (`intent_id`,`acquisition_attempt_generation`);
ALTER TABLE `household_evidence_references` ADD `availability` text DEFAULT 'available' NOT NULL;--> statement-breakpoint
ALTER TABLE `household_evidence_references` ADD `observation_ordinal` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `household_evidence_references` ADD `observed_at` text;
CREATE TABLE `household_member_departure_operations` (
	`actor_id` text NOT NULL,
	`created_at_epoch_ms` integer NOT NULL,
	`execution_generation` integer NOT NULL,
	`last_attempt_at_epoch_ms` integer,
	`link_id` text NOT NULL,
	`operation_id` text PRIMARY KEY,
	`person_id` text NOT NULL,
	`reason` text NOT NULL,
	`state` text NOT NULL,
	`updated_at_epoch_ms` integer NOT NULL,
	`version` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `household_person_account_links` (
	`created_at_epoch_ms` integer NOT NULL,
	`link_id` text PRIMARY KEY,
	`linkage_subject` text NOT NULL,
	`person_id` text NOT NULL,
	`state` text NOT NULL,
	`updated_at_epoch_ms` integer NOT NULL,
	`version` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `household_person_invitation_associations` (
	`associated_at_epoch_ms` integer NOT NULL,
	`consumed_at_epoch_ms` integer,
	`invitation_digest` text PRIMARY KEY,
	`person_id` text NOT NULL,
	`state` text NOT NULL,
	`version` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `household_person_audits` ADD `next_association_state` text;--> statement-breakpoint
ALTER TABLE `household_person_audits` ADD `operation_id` text;--> statement-breakpoint
ALTER TABLE `household_person_audits` ADD `previous_association_state` text;
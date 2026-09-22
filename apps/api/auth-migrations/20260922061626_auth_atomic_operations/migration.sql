CREATE TABLE `auth_mutation_receipt` (
	`id` text PRIMARY KEY,
	`account_id` text NOT NULL,
	`request_digest` text NOT NULL,
	`attempt_id` text NOT NULL,
	`applied` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `member_organization_user_uidx` ON `member` (`organization_id`,`user_id`);
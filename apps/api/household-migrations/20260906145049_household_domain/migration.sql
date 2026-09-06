CREATE TABLE `household_interview_profile_receipts` (
	`mutation_id` text PRIMARY KEY,
	`intent_digest` text NOT NULL,
	`outcome_json` text NOT NULL
);

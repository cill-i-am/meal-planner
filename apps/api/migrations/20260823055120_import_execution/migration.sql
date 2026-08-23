CREATE TABLE `import_evidence_routes` (
	`import_id` text PRIMARY KEY,
	`organization_id` text NOT NULL,
	`route_version` integer NOT NULL,
	CONSTRAINT "import_evidence_routes_version_check" CHECK("route_version" = 1)
);
--> statement-breakpoint
DROP TRIGGER IF EXISTS `pilot_provider_recipe_recovery_budget_insert`;
--> statement-breakpoint
DROP TABLE `import_provider_terminal_checkpoints`;
--> statement-breakpoint
DROP TABLE IF EXISTS `pilot_provider_terminal_checkpoints`;
--> statement-breakpoint
DROP TABLE IF EXISTS `pilot_provider_visual_second_recoveries`;
--> statement-breakpoint
DROP TABLE IF EXISTS `pilot_provider_visual_recoveries`;
--> statement-breakpoint
DROP TABLE IF EXISTS `pilot_provider_speech_recoveries`;
--> statement-breakpoint
DROP TABLE IF EXISTS `pilot_provider_recipe_recovery_attempts`;

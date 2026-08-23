DROP TRIGGER IF EXISTS `pilot_provider_recipe_replay_values_guarded_delete`;--> statement-breakpoint
DROP INDEX IF EXISTS `import_carousel_evidence_dispatch_id_unique`;--> statement-breakpoint
DROP INDEX IF EXISTS `import_carousel_evidence_state_updated_index`;--> statement-breakpoint
DROP INDEX IF EXISTS `import_recipe_extractions_current_unique`;--> statement-breakpoint
DROP INDEX IF EXISTS `import_recipe_extractions_state_updated_index`;--> statement-breakpoint
DROP INDEX IF EXISTS `import_transcriptions_dispatch_id_unique`;--> statement-breakpoint
DROP INDEX IF EXISTS `import_transcriptions_state_updated_index`;--> statement-breakpoint
DROP INDEX IF EXISTS `import_visual_evidence_dispatch_id_unique`;--> statement-breakpoint
DROP INDEX IF EXISTS `import_visual_evidence_state_updated_index`;--> statement-breakpoint
DROP TABLE `import_carousel_evidence`;--> statement-breakpoint
DROP TABLE `import_recipe_extractions`;--> statement-breakpoint
DROP TABLE `import_transcriptions`;--> statement-breakpoint
DROP TABLE `import_visual_evidence`;

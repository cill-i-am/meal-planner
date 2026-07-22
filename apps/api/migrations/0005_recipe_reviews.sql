CREATE TABLE `recipe_reviews` (
	`extraction_fingerprint` text PRIMARY KEY NOT NULL,
	`lifecycle` text NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`tags_json` text,
	`last_mutation_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT `recipe_reviews_extraction_fk` FOREIGN KEY (`extraction_fingerprint`) REFERENCES `import_recipe_extractions`(`extraction_fingerprint`) ON UPDATE RESTRICT ON DELETE RESTRICT,
	CONSTRAINT `recipe_reviews_lifecycle_check` CHECK(`lifecycle` IN ('needs_review', 'approved', 'rejected')),
	CONSTRAINT `recipe_reviews_version_check` CHECK(typeof(`version`) = 'integer' AND `version` >= 0 AND `version` <= 9007199254740991),
	CONSTRAINT `recipe_reviews_tags_check` CHECK((`tags_json` IS NULL OR json_valid(`tags_json`)) AND (`lifecycle` <> 'approved' OR `tags_json` IS NOT NULL)),
	CONSTRAINT `recipe_reviews_mutation_check` CHECK(`last_mutation_id` IS NULL OR length(`last_mutation_id`) BETWEEN 1 AND 512)
);--> statement-breakpoint
CREATE INDEX `recipe_reviews_lifecycle_updated_index` ON `recipe_reviews` (`lifecycle`,`updated_at`);--> statement-breakpoint
CREATE TABLE `recipe_review_corrections` (
	`extraction_fingerprint` text NOT NULL,
	`version` integer NOT NULL,
	`actor_id` text NOT NULL,
	`field` text NOT NULL,
	`before_json` text NOT NULL,
	`after_json` text NOT NULL,
	`reason` text NOT NULL,
	`tags_before_json` text NOT NULL,
	`tags_after_json` text NOT NULL,
	`corrected_at` text NOT NULL,
	PRIMARY KEY (`extraction_fingerprint`,`version`),
	CONSTRAINT `recipe_review_corrections_review_fk` FOREIGN KEY (`extraction_fingerprint`) REFERENCES `recipe_reviews`(`extraction_fingerprint`) ON UPDATE RESTRICT ON DELETE RESTRICT,
	CONSTRAINT `recipe_review_corrections_version_check` CHECK(typeof(`version`) = 'integer' AND `version` > 0 AND `version` <= 9007199254740991),
	CONSTRAINT `recipe_review_corrections_actor_check` CHECK(length(`actor_id`) BETWEEN 1 AND 128),
	CONSTRAINT `recipe_review_corrections_field_check` CHECK(`field` IN ('author', 'category', 'cook_time_minutes', 'cuisine', 'description', 'ingredient_lines', 'ingredient_quantities', 'ingredient_units', 'instructions', 'name', 'nutrition', 'prep_time_minutes', 'temperature_celsius', 'tools', 'total_time_minutes', 'yield')),
	CONSTRAINT `recipe_review_corrections_json_check` CHECK(json_valid(`before_json`) AND json_valid(`after_json`) AND json_valid(`tags_before_json`) AND json_valid(`tags_after_json`)),
	CONSTRAINT `recipe_review_corrections_reason_check` CHECK(length(`reason`) BETWEEN 1 AND 4096)
);--> statement-breakpoint
CREATE TABLE `recipe_review_transitions` (
	`extraction_fingerprint` text NOT NULL,
	`version` integer NOT NULL,
	`actor_id` text NOT NULL,
	`from_lifecycle` text NOT NULL,
	`to_lifecycle` text NOT NULL,
	`reason` text NOT NULL,
	`transitioned_at` text NOT NULL,
	PRIMARY KEY (`extraction_fingerprint`,`version`),
	CONSTRAINT `recipe_review_transitions_review_fk` FOREIGN KEY (`extraction_fingerprint`) REFERENCES `recipe_reviews`(`extraction_fingerprint`) ON UPDATE RESTRICT ON DELETE RESTRICT,
	CONSTRAINT `recipe_review_transitions_version_check` CHECK(typeof(`version`) = 'integer' AND `version` > 0 AND `version` <= 9007199254740991),
	CONSTRAINT `recipe_review_transitions_actor_check` CHECK(length(`actor_id`) BETWEEN 1 AND 128),
	CONSTRAINT `recipe_review_transitions_lifecycle_check` CHECK(`from_lifecycle` IN ('needs_review', 'approved', 'rejected') AND `to_lifecycle` IN ('needs_review', 'approved', 'rejected') AND `from_lifecycle` <> `to_lifecycle`),
	CONSTRAINT `recipe_review_transitions_reason_check` CHECK(length(`reason`) BETWEEN 1 AND 4096)
);--> statement-breakpoint
CREATE TRIGGER `recipe_review_corrections_append_only_update`
BEFORE UPDATE ON `recipe_review_corrections`
BEGIN
  SELECT RAISE(ABORT, 'recipe review corrections are append-only');
END;--> statement-breakpoint
CREATE TRIGGER `recipe_review_corrections_append_only_delete`
BEFORE DELETE ON `recipe_review_corrections`
BEGIN
  SELECT RAISE(ABORT, 'recipe review corrections are append-only');
END;--> statement-breakpoint
CREATE TRIGGER `recipe_review_transitions_append_only_update`
BEFORE UPDATE ON `recipe_review_transitions`
BEGIN
  SELECT RAISE(ABORT, 'recipe review transitions are append-only');
END;--> statement-breakpoint
CREATE TRIGGER `recipe_review_transitions_append_only_delete`
BEFORE DELETE ON `recipe_review_transitions`
BEGIN
  SELECT RAISE(ABORT, 'recipe review transitions are append-only');
END;--> statement-breakpoint
CREATE TRIGGER `recipe_reviews_history_preserved`
BEFORE DELETE ON `recipe_reviews`
BEGIN
  SELECT RAISE(ABORT, 'recipe review history is preserved');
END;--> statement-breakpoint
CREATE TRIGGER `import_recipe_draft_immutable_update`
BEFORE UPDATE OF `draft_json` ON `import_recipe_extractions`
WHEN OLD.`state` = 'needs_review' AND NEW.`draft_json` IS NOT OLD.`draft_json`
BEGIN
  SELECT RAISE(ABORT, 'completed recipe drafts are immutable');
END;--> statement-breakpoint
CREATE TRIGGER `import_recipe_draft_immutable_delete`
BEFORE DELETE ON `import_recipe_extractions`
WHEN OLD.`state` = 'needs_review'
BEGIN
  SELECT RAISE(ABORT, 'completed recipe drafts are immutable');
END;--> statement-breakpoint
PRAGMA foreign_key_check;

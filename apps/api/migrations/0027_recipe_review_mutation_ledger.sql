DROP TRIGGER `recipe_reviews_history_preserved`;--> statement-breakpoint
DROP TRIGGER `recipe_review_corrections_append_only_update`;--> statement-breakpoint
DROP TRIGGER `recipe_review_corrections_append_only_delete`;--> statement-breakpoint
DROP TRIGGER `recipe_review_transitions_append_only_update`;--> statement-breakpoint
DROP TRIGGER `recipe_review_transitions_append_only_delete`;--> statement-breakpoint
CREATE TABLE `__new_recipe_reviews` (
	`extraction_fingerprint` text PRIMARY KEY NOT NULL,
	`lifecycle` text NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`tags_json` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT `recipe_reviews_extraction_fk` FOREIGN KEY (`extraction_fingerprint`) REFERENCES `import_recipe_extractions`(`extraction_fingerprint`) ON UPDATE RESTRICT ON DELETE RESTRICT,
	CONSTRAINT `recipe_reviews_lifecycle_check` CHECK(`lifecycle` IN ('needs_review', 'approved', 'rejected')),
	CONSTRAINT `recipe_reviews_version_check` CHECK(typeof(`version`) = 'integer' AND `version` >= 0 AND `version` <= 9007199254740991),
	CONSTRAINT `recipe_reviews_tags_check` CHECK((`tags_json` IS NULL OR json_valid(`tags_json`)) AND (`lifecycle` <> 'approved' OR `tags_json` IS NOT NULL))
);--> statement-breakpoint
INSERT INTO `__new_recipe_reviews` (
	`extraction_fingerprint`, `lifecycle`, `version`, `tags_json`,
	`created_at`, `updated_at`
)
SELECT
	`extraction_fingerprint`, `lifecycle`, `version`, `tags_json`,
	`created_at`, `updated_at`
FROM `recipe_reviews`;--> statement-breakpoint
CREATE TABLE `__new_recipe_review_corrections` (
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
	CONSTRAINT `recipe_review_corrections_review_fk` FOREIGN KEY (`extraction_fingerprint`) REFERENCES `__new_recipe_reviews`(`extraction_fingerprint`) ON UPDATE RESTRICT ON DELETE RESTRICT,
	CONSTRAINT `recipe_review_corrections_version_check` CHECK(typeof(`version`) = 'integer' AND `version` > 0 AND `version` <= 9007199254740991),
	CONSTRAINT `recipe_review_corrections_actor_check` CHECK(length(`actor_id`) BETWEEN 1 AND 128),
	CONSTRAINT `recipe_review_corrections_field_check` CHECK(`field` IN ('author', 'category', 'cook_time_minutes', 'cuisine', 'description', 'ingredient_lines', 'ingredient_quantities', 'ingredient_units', 'instructions', 'name', 'nutrition', 'prep_time_minutes', 'temperature_celsius', 'tools', 'total_time_minutes', 'yield')),
	CONSTRAINT `recipe_review_corrections_json_check` CHECK(json_valid(`before_json`) AND json_valid(`after_json`) AND json_valid(`tags_before_json`) AND json_valid(`tags_after_json`)),
	CONSTRAINT `recipe_review_corrections_reason_check` CHECK(length(`reason`) BETWEEN 1 AND 4096)
);--> statement-breakpoint
INSERT INTO `__new_recipe_review_corrections` (
	`extraction_fingerprint`, `version`, `actor_id`, `field`, `before_json`,
	`after_json`, `reason`, `tags_before_json`, `tags_after_json`, `corrected_at`
)
SELECT
	`extraction_fingerprint`, `version`, `actor_id`, `field`, `before_json`,
	`after_json`, `reason`, `tags_before_json`, `tags_after_json`, `corrected_at`
FROM `recipe_review_corrections`;--> statement-breakpoint
CREATE TABLE `__new_recipe_review_transitions` (
	`extraction_fingerprint` text NOT NULL,
	`version` integer NOT NULL,
	`actor_id` text NOT NULL,
	`from_lifecycle` text NOT NULL,
	`to_lifecycle` text NOT NULL,
	`reason` text NOT NULL,
	`transitioned_at` text NOT NULL,
	PRIMARY KEY (`extraction_fingerprint`,`version`),
	CONSTRAINT `recipe_review_transitions_review_fk` FOREIGN KEY (`extraction_fingerprint`) REFERENCES `__new_recipe_reviews`(`extraction_fingerprint`) ON UPDATE RESTRICT ON DELETE RESTRICT,
	CONSTRAINT `recipe_review_transitions_version_check` CHECK(typeof(`version`) = 'integer' AND `version` > 0 AND `version` <= 9007199254740991),
	CONSTRAINT `recipe_review_transitions_actor_check` CHECK(length(`actor_id`) BETWEEN 1 AND 128),
	CONSTRAINT `recipe_review_transitions_lifecycle_check` CHECK(`from_lifecycle` IN ('needs_review', 'approved', 'rejected') AND `to_lifecycle` IN ('needs_review', 'approved', 'rejected') AND `from_lifecycle` <> `to_lifecycle`),
	CONSTRAINT `recipe_review_transitions_reason_check` CHECK(length(`reason`) BETWEEN 1 AND 4096)
);--> statement-breakpoint
INSERT INTO `__new_recipe_review_transitions` (
	`extraction_fingerprint`, `version`, `actor_id`, `from_lifecycle`,
	`to_lifecycle`, `reason`, `transitioned_at`
)
SELECT
	`extraction_fingerprint`, `version`, `actor_id`, `from_lifecycle`,
	`to_lifecycle`, `reason`, `transitioned_at`
FROM `recipe_review_transitions`;--> statement-breakpoint
DROP TABLE `recipe_review_corrections`;--> statement-breakpoint
DROP TABLE `recipe_review_transitions`;--> statement-breakpoint
DROP TABLE `recipe_reviews`;--> statement-breakpoint
ALTER TABLE `__new_recipe_reviews` RENAME TO `recipe_reviews`;--> statement-breakpoint
ALTER TABLE `__new_recipe_review_corrections` RENAME TO `recipe_review_corrections`;--> statement-breakpoint
ALTER TABLE `__new_recipe_review_transitions` RENAME TO `recipe_review_transitions`;--> statement-breakpoint
CREATE INDEX `recipe_reviews_lifecycle_updated_index` ON `recipe_reviews` (`lifecycle`,`updated_at`);--> statement-breakpoint
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
CREATE TABLE `recipe_review_mutations` (
	`extraction_fingerprint` text NOT NULL,
	`mutation_id` text NOT NULL,
	`command_kind` text NOT NULL,
	`command_digest` text NOT NULL,
	`resulting_version` integer NOT NULL,
	`applied_at` text NOT NULL,
	PRIMARY KEY (`extraction_fingerprint`,`mutation_id`),
	CONSTRAINT `recipe_review_mutations_review_fk` FOREIGN KEY (`extraction_fingerprint`) REFERENCES `recipe_reviews`(`extraction_fingerprint`) ON UPDATE RESTRICT ON DELETE RESTRICT,
	CONSTRAINT `recipe_review_mutations_identity_check` CHECK(length(`mutation_id`) BETWEEN 1 AND 128),
	CONSTRAINT `recipe_review_mutations_kind_check` CHECK(`command_kind` IN ('correction', 'transition')),
	CONSTRAINT `recipe_review_mutations_digest_check` CHECK(length(`command_digest`) = 64 AND `command_digest` NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT `recipe_review_mutations_version_check` CHECK(typeof(`resulting_version`) = 'integer' AND `resulting_version` > 0 AND `resulting_version` <= 9007199254740991)
);--> statement-breakpoint
CREATE UNIQUE INDEX `recipe_review_mutations_review_version_unique` ON `recipe_review_mutations` (`extraction_fingerprint`,`resulting_version`);--> statement-breakpoint
CREATE TRIGGER `recipe_review_mutations_append_only_update`
BEFORE UPDATE ON `recipe_review_mutations`
BEGIN
  SELECT RAISE(ABORT, 'recipe review mutations are append-only');
END;--> statement-breakpoint
CREATE TRIGGER `recipe_review_mutations_append_only_delete`
BEFORE DELETE ON `recipe_review_mutations`
BEGIN
  SELECT RAISE(ABORT, 'recipe review mutations are append-only');
END;--> statement-breakpoint
PRAGMA foreign_key_check;

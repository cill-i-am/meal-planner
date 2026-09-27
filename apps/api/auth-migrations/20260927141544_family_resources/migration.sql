CREATE TABLE `family` (
	`completed_at` integer,
	`creation_mutation_id` text NOT NULL,
	`creation_name` text NOT NULL,
	`creator_display_name` text NOT NULL,
	`creator_linked` integer DEFAULT false NOT NULL,
	`creator_user_id` text NOT NULL,
	`organization_id` text PRIMARY KEY,
	`updated_at` integer NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	CONSTRAINT `fk_family_organization_id_organization_id_fk` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `family_rename_receipt` (
	`actor_id` text NOT NULL,
	`expected_version` integer NOT NULL,
	`mutation_id` text NOT NULL,
	`name` text NOT NULL,
	`organization_id` text NOT NULL,
	CONSTRAINT `family_rename_receipt_pk` PRIMARY KEY(`organization_id`, `actor_id`, `mutation_id`),
	CONSTRAINT `fk_family_rename_receipt_organization_id_organization_id_fk` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX `family_creation_request_uidx` ON `family` (`creator_user_id`,`creation_mutation_id`);--> statement-breakpoint
-- Do not discard an unresolved submitted command during the schema change.
-- Finish these requests with the previous application before applying this migration.
CREATE TABLE IF NOT EXISTS `_family_migration_guard` (`pending_count` integer CHECK (`pending_count` = 0));
--> statement-breakpoint
INSERT INTO `_family_migration_guard` (`pending_count`)
SELECT count(*) FROM user WHERE json_extract(setup_progress, '$.checkpoint.stage') IN (
  'person-create', 'person-invite', 'person-rename', 'person-manage', 'invitation-response', 'invitation-link'
);
--> statement-breakpoint
DROP TABLE `_family_migration_guard`;
--> statement-breakpoint
-- Carry domain identity and completion forward before removing screen checkpoints.
-- Pick the original creator where its interrupted creation names this organization;
-- otherwise use the earliest remaining owner (then member for an ownerless family).
INSERT INTO family (organization_id, creator_user_id, creation_mutation_id, creation_name,
  creator_display_name, creator_linked, completed_at, updated_at, version)
SELECT o.id, u.id,
  CASE WHEN json_extract(u.setup_progress, '$.checkpoint.stage') = 'family-create'
    AND json_extract(u.setup_progress, '$.checkpoint.slug') = o.slug
    THEN json_extract(u.setup_progress, '$.checkpoint.creator.mutationId')
    ELSE 'migrated-' || o.id END,
  o.name,
  CASE WHEN json_extract(u.setup_progress, '$.checkpoint.stage') = 'family-create'
    AND json_extract(u.setup_progress, '$.checkpoint.slug') = o.slug
    THEN json_extract(u.setup_progress, '$.checkpoint.creator.displayName')
    ELSE substr(trim(u.name), 1, 80) END,
  CASE WHEN json_extract(u.setup_progress, '$.checkpoint.stage') = 'family-create'
    AND json_extract(u.setup_progress, '$.checkpoint.slug') = o.slug THEN 0 ELSE 1 END,
  CASE WHEN EXISTS (
    SELECT 1 FROM user finished
    WHERE json_extract(finished.setup_progress, '$.checkpoint.organizationId') = o.id
      AND json_extract(finished.setup_progress, '$.checkpoint.stage') = 'complete'
  ) THEN o.created_at ELSE NULL END,
  o.created_at, 1
FROM organization o
JOIN user u ON u.id = (
  SELECT m.user_id FROM member m JOIN user candidate ON candidate.id = m.user_id
  WHERE m.organization_id = o.id
  ORDER BY CASE WHEN json_extract(candidate.setup_progress, '$.checkpoint.stage') = 'family-create'
    AND json_extract(candidate.setup_progress, '$.checkpoint.slug') = o.slug THEN 0
    WHEN m.role = 'owner' THEN 1 ELSE 2 END, m.created_at, m.id
  LIMIT 1
)
WHERE NOT EXISTS (SELECT 1 FROM family f WHERE f.organization_id = o.id);
--> statement-breakpoint
ALTER TABLE `user` DROP COLUMN `setup_progress`;--> statement-breakpoint
ALTER TABLE `user` DROP COLUMN `setup_progress_version`;
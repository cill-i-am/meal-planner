CREATE TABLE `household_meal_plan_retired_mutation_receipts` (
	`draft_id` text NOT NULL,
	`mutation_fingerprint` text NOT NULL,
	`mutation_id` text NOT NULL,
	`result_json` text NOT NULL,
	CONSTRAINT `household_meal_plan_retired_mutation_receipts_pk` PRIMARY KEY(`draft_id`, `mutation_id`)
);
--> statement-breakpoint
CREATE TABLE `household_meal_plan_retired_plans` (
	`draft_id` text PRIMARY KEY,
	`plan_json` text NOT NULL,
	`request_fingerprint_digest` text NOT NULL,
	`revision` integer NOT NULL
);
--> statement-breakpoint
INSERT OR IGNORE INTO `household_meal_plan_retired_plans`
  (`draft_id`, `plan_json`, `request_fingerprint_digest`, `revision`)
SELECT `draft_id`, `plan_json`, `request_fingerprint_digest`, `revision`
FROM `household_meal_plans`
WHERE CASE
  WHEN json_valid(`plan_json`) THEN
    json_type(`plan_json`, '$.planId') IS NULL
    AND (
      json_type(`plan_json`, '$.draftId') = 'text'
      OR substr(`draft_id`, 1, 6) = 'draft-'
    )
  ELSE substr(`draft_id`, 1, 6) = 'draft-'
END;
--> statement-breakpoint
INSERT OR IGNORE INTO `household_meal_plan_retired_mutation_receipts`
  (`draft_id`, `mutation_fingerprint`, `mutation_id`, `result_json`)
SELECT r.`draft_id`, r.`mutation_fingerprint`, r.`mutation_id`, r.`result_json`
FROM `household_meal_plan_mutation_receipts` AS r
WHERE EXISTS (
  SELECT 1 FROM `household_meal_plan_retired_plans` AS a
  JOIN `household_meal_plans` AS p ON p.`draft_id` = a.`draft_id`
  WHERE p.`draft_id` = r.`draft_id`
    AND p.`plan_json` = a.`plan_json`
    AND p.`request_fingerprint_digest` = a.`request_fingerprint_digest`
    AND p.`revision` = a.`revision`
)
OR (
  substr(r.`draft_id`, 1, 6) = 'draft-'
  AND NOT EXISTS (
    SELECT 1 FROM `household_meal_plans` AS p
    WHERE p.`draft_id` = r.`draft_id`
  )
);
--> statement-breakpoint
DELETE FROM `household_meal_plan_mutation_receipts` AS r
WHERE EXISTS (
  SELECT 1 FROM `household_meal_plan_retired_mutation_receipts` AS a
  WHERE a.`draft_id` = r.`draft_id`
    AND a.`mutation_id` = r.`mutation_id`
    AND a.`mutation_fingerprint` = r.`mutation_fingerprint`
    AND a.`result_json` = r.`result_json`
)
AND (
  EXISTS (
    SELECT 1 FROM `household_meal_plan_retired_plans` AS a
    JOIN `household_meal_plans` AS p ON p.`draft_id` = a.`draft_id`
    WHERE p.`draft_id` = r.`draft_id`
      AND p.`plan_json` = a.`plan_json`
      AND p.`request_fingerprint_digest` = a.`request_fingerprint_digest`
      AND p.`revision` = a.`revision`
  )
  OR NOT EXISTS (
    SELECT 1 FROM `household_meal_plans` AS p
    WHERE p.`draft_id` = r.`draft_id`
  )
);
--> statement-breakpoint
DELETE FROM `household_meal_plans` AS p
WHERE EXISTS (
  SELECT 1 FROM `household_meal_plan_retired_plans` AS a
  WHERE a.`draft_id` = p.`draft_id`
    AND a.`plan_json` = p.`plan_json`
    AND a.`request_fingerprint_digest` = p.`request_fingerprint_digest`
    AND a.`revision` = p.`revision`
);

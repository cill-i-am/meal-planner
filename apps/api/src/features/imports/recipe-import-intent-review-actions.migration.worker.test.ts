import { applyD1Migrations, env } from "cloudflare:test";
import type { AnyD1Database } from "drizzle-orm/d1";
import { describe, expect, it } from "vitest";

const testEnv = env as unknown as {
  readonly MealPlannerDatabase: AnyD1Database;
  readonly TEST_MIGRATIONS: {
    readonly name: string;
    readonly queries: string[];
  }[];
};

const migrationName = "0032_recipe_import_intent_review_actions.sql";
const importId = "018f47ad-91aa-7c35-b6fe-000000003200";
const processingImportId = "018f47ad-91aa-7c35-b6fe-000000003201";
const actionId = "018f47ad-91aa-7c35-b6fe-000000003299";
const extractionFingerprint = "a".repeat(64);
const legacyExtractionFingerprint = "9".repeat(64);
const actorIdentityHash = "7".repeat(64);
const correctionMutationId = "2".repeat(64);
const correctionCommandDigest = "3".repeat(64);
const approvalMutationId = "4".repeat(64);
const approvalCommandDigest = "5".repeat(64);
const succeededMutationId = "6".repeat(64);
const timestamp = "2026-08-16T12:00:00.000Z";

const insertImport = async (input: {
  readonly actionId: string | null;
  readonly canonicalSourceId: string;
  readonly id: string;
  readonly publicStatus: "processing" | "requires_action";
}) => {
  await testEnv.MealPlannerDatabase.prepare(
    `INSERT INTO recipe_imports (
       id, acquisition_generation, canonical_source_id,
       compatibility_fingerprint, created_at, evidence_references_json,
       recovery_action, source_kind, status, status_code, updated_at,
       household_scope_id, actor_id, intent_version,
       resolved_canonical_source_id, public_source_url, public_source_kind,
       public_status, active_action_id, execution_generation
     ) VALUES (?, 0, ?, ?, ?, '[]', NULL, 'tiktok', 'queued', NULL, ?, ?, ?,
               1, ?, ?, 'video', ?, ?, 0)`
  )
    .bind(
      input.id,
      input.canonicalSourceId,
      "b".repeat(64),
      timestamp,
      timestamp,
      "c".repeat(64),
      "d".repeat(64),
      input.canonicalSourceId,
      `https://www.tiktok.com/video/${input.canonicalSourceId}`,
      input.publicStatus,
      input.actionId
    )
    .run();
};

const insertExtractionAndReview = async (input: {
  readonly extractionFingerprint: string;
  readonly importId: string;
}) => {
  await testEnv.MealPlannerDatabase.batch([
    testEnv.MealPlannerDatabase.prepare(
      `INSERT INTO import_recipe_extractions (
         extraction_fingerprint, import_id, acquisition_generation,
         evidence_fingerprint, extractor_provider, extractor_model,
         extractor_version, state, draft_json, input_evidence_items,
         input_tokens, output_tokens, model_calls, latency_milliseconds,
         estimated_cost_micro_usd, cost_currency, cost_certainty, is_current,
         created_at, updated_at, completed_at
       ) VALUES (?, ?, 0, ?, 'test', 'test', 'test', 'needs_review', '{}',
                 1, 0, 0, 1, 0, 0, 'USD', 'known', 1, ?, ?, ?)`
    ).bind(
      input.extractionFingerprint,
      input.importId,
      "e".repeat(64),
      timestamp,
      timestamp,
      timestamp
    ),
    testEnv.MealPlannerDatabase.prepare(
      `INSERT INTO recipe_reviews (
         extraction_fingerprint, lifecycle, version, tags_json,
         created_at, updated_at
       ) VALUES (?, 'needs_review', 1, NULL, ?, ?)`
    ).bind(input.extractionFingerprint, timestamp, timestamp),
  ]);
};

describe("recipe import intent review actions migration", () => {
  it("backfills public action versions and rejects incomplete aggregate receipts", async () => {
    const migrationIndex = testEnv.TEST_MIGRATIONS.findIndex(
      ({ name }) => name === migrationName
    );
    expect(migrationIndex).toBeGreaterThan(0);
    await applyD1Migrations(
      testEnv.MealPlannerDatabase,
      testEnv.TEST_MIGRATIONS.slice(0, migrationIndex),
      "d1_migrations"
    );

    await insertImport({
      actionId,
      canonicalSourceId: "752000000000003200",
      id: importId,
      publicStatus: "requires_action",
    });
    await insertImport({
      actionId: null,
      canonicalSourceId: "752000000000003201",
      id: processingImportId,
      publicStatus: "processing",
    });
    await insertExtractionAndReview({ extractionFingerprint, importId });
    await insertExtractionAndReview({
      extractionFingerprint: legacyExtractionFingerprint,
      importId: processingImportId,
    });
    await testEnv.MealPlannerDatabase.batch([
      testEnv.MealPlannerDatabase.prepare(
        `INSERT INTO recipe_review_corrections (
           extraction_fingerprint, version, actor_id, field, before_json,
           after_json, reason, tags_before_json, tags_after_json, corrected_at
         ) VALUES (?, 1, 'legacy-actor', 'name', 'null', '"Legacy name"',
                   'Historical correction.', 'null', 'null', ?)`
      ).bind(extractionFingerprint, timestamp),
      testEnv.MealPlannerDatabase.prepare(
        `INSERT INTO recipe_review_mutations (
           extraction_fingerprint, mutation_id, command_kind, command_digest,
           resulting_version, applied_at
         ) VALUES (?, 'legacy-correction-1', 'correction', ?, 1, ?)`
      ).bind(extractionFingerprint, "f".repeat(64), timestamp),
    ]);

    const migration = testEnv.TEST_MIGRATIONS[migrationIndex];
    if (migration === undefined) {
      throw new Error(`Missing ${migrationName}`);
    }
    await applyD1Migrations(
      testEnv.MealPlannerDatabase,
      [migration],
      "d1_migrations"
    );

    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT id, active_action_id, active_action_version
           FROM recipe_imports
          WHERE id IN (?, ?)
          ORDER BY id`
      )
        .bind(importId, processingImportId)
        .all()
    ).resolves.toMatchObject({
      results: [
        {
          active_action_id: actionId,
          active_action_version: 2,
          id: importId,
        },
        {
          active_action_id: null,
          active_action_version: null,
          id: processingImportId,
        },
      ],
    });
    expect(actionId).not.toBe(extractionFingerprint);
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT ordinal, field
           FROM recipe_review_corrections
          WHERE extraction_fingerprint = ? AND version = 1`
      )
        .bind(extractionFingerprint)
        .all()
    ).resolves.toMatchObject({ results: [{ field: "name", ordinal: 0 }] });
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT item_count
           FROM recipe_review_mutations
          WHERE extraction_fingerprint = ? AND resulting_version = 1`
      )
        .bind(extractionFingerprint)
        .first()
    ).resolves.toEqual({ item_count: 1 });

    // Existing repositories omit item_count. Even a 64-hex mutation id remains
    // legacy-compatible and can retain the established receipt-first order.
    await expect(
      testEnv.MealPlannerDatabase.batch([
        testEnv.MealPlannerDatabase.prepare(
          `UPDATE recipe_reviews
              SET version = 2, updated_at = ?
            WHERE extraction_fingerprint = ? AND version = 1`
        ).bind(timestamp, legacyExtractionFingerprint),
        testEnv.MealPlannerDatabase.prepare(
          `INSERT INTO recipe_review_mutations (
             extraction_fingerprint, mutation_id, command_kind,
             command_digest, resulting_version, applied_at
           ) VALUES (?, ?, 'correction', ?, 2, ?)`
        ).bind(
          legacyExtractionFingerprint,
          "0".repeat(64),
          "1".repeat(64),
          timestamp
        ),
        testEnv.MealPlannerDatabase.prepare(
          `INSERT INTO recipe_review_corrections (
             extraction_fingerprint, version, actor_id, field,
             before_json, after_json, reason, tags_before_json,
             tags_after_json, corrected_at
           ) VALUES (?, 2, 'legacy-actor', 'description', 'null',
                     '"Legacy description"', 'Legacy write order.', 'null',
                     'null', ?)`
        ).bind(legacyExtractionFingerprint, timestamp),
      ])
    ).resolves.toBeDefined();
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT item_count
           FROM recipe_review_mutations
          WHERE extraction_fingerprint = ? AND resulting_version = 2`
      )
        .bind(legacyExtractionFingerprint)
        .first()
    ).resolves.toEqual({ item_count: null });

    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `UPDATE recipe_imports
            SET active_action_version = 4, intent_version = 2
          WHERE id = ? AND intent_version = 1`
      )
        .bind(importId)
        .run()
    ).rejects.toThrow(
      /recipe import intent version must match one meaningful transition/u
    );

    // A zero-row root CAS must not allow review rows to commit when the final
    // intent-managed receipt is inserted.
    await expect(
      testEnv.MealPlannerDatabase.batch([
        testEnv.MealPlannerDatabase.prepare(
          `UPDATE recipe_imports
              SET active_action_version = 3, intent_version = 2,
                  updated_at = ?, transition_mutation_id = ?,
                  transition_command_digest = ?,
                  transition_actor_category = 'household_member',
                  transition_actor_identity_hash = ?,
                  transition_provenance_version = 2
            WHERE id = ? AND intent_version = 99`
        ).bind(
          timestamp,
          correctionMutationId,
          correctionCommandDigest,
          actorIdentityHash,
          importId
        ),
        testEnv.MealPlannerDatabase.prepare(
          `UPDATE recipe_reviews
              SET version = 2, updated_at = ?
            WHERE extraction_fingerprint = ? AND version = 1`
        ).bind(timestamp, extractionFingerprint),
        ...[
          [0, "name", '"Legacy name"', '"Intent name"'],
          [1, "tags", "null", '["weeknight"]'],
        ].map(([ordinal, field, beforeJson, afterJson]) =>
          testEnv.MealPlannerDatabase.prepare(
            `INSERT INTO recipe_review_corrections (
               extraction_fingerprint, version, ordinal, actor_id, field,
               before_json, after_json, reason, tags_before_json,
               tags_after_json, corrected_at
             ) VALUES (?, 2, ?, ?, ?, ?, ?, 'Intent answer.', 'null',
                       '["weeknight"]', ?)`
          ).bind(
            extractionFingerprint,
            ordinal,
            actorIdentityHash,
            field,
            beforeJson,
            afterJson,
            timestamp
          )
        ),
        testEnv.MealPlannerDatabase.prepare(
          `INSERT INTO recipe_review_mutations (
             extraction_fingerprint, mutation_id, command_kind,
             command_digest, resulting_version, item_count, applied_at
           ) VALUES (?, ?, 'correction', ?, 2, 2, ?)`
        ).bind(
          extractionFingerprint,
          correctionMutationId,
          correctionCommandDigest,
          timestamp
        ),
      ])
    ).rejects.toThrow(/incomplete intent-managed recipe review receipt/u);
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT version,
                (SELECT count(*) FROM recipe_review_corrections
                  WHERE extraction_fingerprint = ? AND version = 2) AS rows,
                (SELECT count(*) FROM recipe_review_mutations
                  WHERE extraction_fingerprint = ? AND resulting_version = 2)
                  AS receipts
           FROM recipe_reviews
          WHERE extraction_fingerprint = ?`
      )
        .bind(
          extractionFingerprint,
          extractionFingerprint,
          extractionFingerprint
        )
        .first()
    ).resolves.toEqual({ receipts: 0, rows: 0, version: 1 });
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT active_action_version, intent_version,
                (SELECT count(*) FROM recipe_import_intent_history
                  WHERE intent_id = ? AND intent_version = 2) AS history_rows
           FROM recipe_imports WHERE id = ?`
      )
        .bind(importId, importId)
        .first()
    ).resolves.toEqual({
      active_action_version: 2,
      history_rows: 0,
      intent_version: 1,
    });

    await expect(
      testEnv.MealPlannerDatabase.batch([
        testEnv.MealPlannerDatabase.prepare(
          `UPDATE recipe_reviews
              SET version = 2, updated_at = ?
            WHERE extraction_fingerprint = ? AND version = 1`
        ).bind(timestamp, extractionFingerprint),
        ...[
          [0, "name", '"Legacy name"', '"Intent name"'],
          [1, "tags", "null", '["weeknight"]'],
        ].map(([ordinal, field, beforeJson, afterJson]) =>
          testEnv.MealPlannerDatabase.prepare(
            `INSERT INTO recipe_review_corrections (
               extraction_fingerprint, version, ordinal, actor_id, field,
               before_json, after_json, reason, tags_before_json,
               tags_after_json, corrected_at
             ) VALUES (?, 2, ?, ?, ?, ?, ?, 'Intent answer.', 'null',
                       '["weeknight"]', ?)`
          ).bind(
            extractionFingerprint,
            ordinal,
            actorIdentityHash,
            field,
            beforeJson,
            afterJson,
            timestamp
          )
        ),
        testEnv.MealPlannerDatabase.prepare(
          `UPDATE recipe_imports
              SET active_action_version = 3, intent_version = 2,
                  updated_at = ?, transition_mutation_id = ?,
                  transition_command_digest = ?,
                  transition_actor_category = 'household_member',
                  transition_actor_identity_hash = ?,
                  transition_provenance_version = 2
            WHERE id = ? AND intent_version = 1
              AND public_status = 'requires_action'
              AND active_action_id = ? AND active_action_version = 2`
        ).bind(
          timestamp,
          correctionMutationId,
          correctionCommandDigest,
          actorIdentityHash,
          importId,
          actionId
        ),
        testEnv.MealPlannerDatabase.prepare(
          `INSERT INTO recipe_review_mutations (
             extraction_fingerprint, mutation_id, command_kind,
             command_digest, resulting_version, item_count, applied_at
           ) VALUES (?, ?, 'correction', ?, 2, 2, ?)`
        ).bind(
          extractionFingerprint,
          correctionMutationId,
          correctionCommandDigest,
          timestamp
        ),
      ])
    ).resolves.toBeDefined();
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT ordinal, field
           FROM recipe_review_corrections
          WHERE extraction_fingerprint = ? AND version = 2
          ORDER BY ordinal`
      )
        .bind(extractionFingerprint)
        .all()
    ).resolves.toMatchObject({
      results: [
        { field: "name", ordinal: 0 },
        { field: "tags", ordinal: 1 },
      ],
    });
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT active_action_version, intent_version
           FROM recipe_imports WHERE id = ?`
      )
        .bind(importId)
        .first()
    ).resolves.toEqual({ active_action_version: 3, intent_version: 2 });

    await expect(
      testEnv.MealPlannerDatabase.batch([
        testEnv.MealPlannerDatabase.prepare(
          `UPDATE recipe_reviews
              SET lifecycle = 'approved', version = 3,
                  tags_json = '["weeknight"]', updated_at = ?
            WHERE extraction_fingerprint = ? AND version = 2
              AND lifecycle = 'needs_review'`
        ).bind(timestamp, extractionFingerprint),
        testEnv.MealPlannerDatabase.prepare(
          `INSERT INTO recipe_review_transitions (
             extraction_fingerprint, version, actor_id, from_lifecycle,
             to_lifecycle, reason, transitioned_at
           ) VALUES (?, 3, ?, 'needs_review', 'approved',
                     'Approved through intent.', ?)`
        ).bind(extractionFingerprint, actorIdentityHash, timestamp),
        testEnv.MealPlannerDatabase.prepare(
          `INSERT INTO recipe_review_mutations (
             extraction_fingerprint, mutation_id, command_kind,
             command_digest, resulting_version, item_count, applied_at
           ) VALUES (?, ?, 'transition', ?, 3, 1, ?)`
        ).bind(
          extractionFingerprint,
          approvalMutationId,
          approvalCommandDigest,
          timestamp
        ),
      ])
    ).rejects.toThrow(/incomplete intent-managed recipe review receipt/u);
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT review.lifecycle, review.version,
                intent.public_status, intent.active_action_version,
                intent.intent_version,
                (SELECT count(*) FROM recipe_review_transitions
                  WHERE extraction_fingerprint = ? AND version = 3)
                  AS transition_rows,
                (SELECT count(*) FROM recipe_review_mutations
                  WHERE extraction_fingerprint = ? AND resulting_version = 3)
                  AS receipt_rows,
                (SELECT count(*) FROM recipe_import_intent_history
                  WHERE intent_id = ? AND intent_version >= 3) AS history_rows
           FROM recipe_reviews AS review
           JOIN import_recipe_extractions AS extraction
             ON extraction.extraction_fingerprint = review.extraction_fingerprint
           JOIN recipe_imports AS intent ON intent.id = extraction.import_id
          WHERE review.extraction_fingerprint = ?`
      )
        .bind(
          extractionFingerprint,
          extractionFingerprint,
          importId,
          extractionFingerprint
        )
        .first()
    ).resolves.toEqual({
      active_action_version: 3,
      history_rows: 0,
      intent_version: 2,
      lifecycle: "needs_review",
      public_status: "requires_action",
      receipt_rows: 0,
      transition_rows: 0,
      version: 2,
    });

    await expect(
      testEnv.MealPlannerDatabase.batch([
        testEnv.MealPlannerDatabase.prepare(
          `UPDATE recipe_reviews
              SET lifecycle = 'approved', version = 3,
                  tags_json = '["weeknight"]', updated_at = ?
            WHERE extraction_fingerprint = ? AND version = 2
              AND lifecycle = 'needs_review'`
        ).bind(timestamp, extractionFingerprint),
        testEnv.MealPlannerDatabase.prepare(
          `INSERT INTO recipe_review_transitions (
             extraction_fingerprint, version, actor_id, from_lifecycle,
             to_lifecycle, reason, transitioned_at
           ) VALUES (?, 3, ?, 'needs_review', 'approved',
                     'Approved through intent.', ?)`
        ).bind(extractionFingerprint, actorIdentityHash, timestamp),
        testEnv.MealPlannerDatabase.prepare(
          `UPDATE recipe_imports
              SET public_status = 'processing',
                  public_stage = 'finalizing_recipe',
                  public_stage_started_at = ?, public_activity = 'working',
                  active_action_id = NULL, active_action_version = NULL,
                  intent_version = 3, updated_at = ?,
                  transition_mutation_id = ?, transition_command_digest = ?,
                  transition_actor_category = 'household_member',
                  transition_actor_identity_hash = ?,
                  transition_provenance_version = 3
            WHERE id = ? AND intent_version = 2
              AND public_status = 'requires_action'
              AND active_action_id = ? AND active_action_version = 3`
        ).bind(
          timestamp,
          timestamp,
          approvalMutationId,
          approvalCommandDigest,
          actorIdentityHash,
          importId,
          actionId
        ),
        testEnv.MealPlannerDatabase.prepare(
          `UPDATE recipe_imports
              SET public_status = 'succeeded', public_stage = NULL,
                  public_stage_started_at = NULL, public_activity = NULL,
                  public_recipe_id = ?, succeeded_at = ?, intent_version = 4,
                  updated_at = ?, transition_mutation_id = ?,
                  transition_command_digest = ?,
                  transition_actor_category = 'household_member',
                  transition_actor_identity_hash = ?,
                  transition_provenance_version = 4
            WHERE id = ? AND intent_version = 3
              AND public_status = 'processing'
              AND public_stage = 'finalizing_recipe'`
        ).bind(
          importId,
          timestamp,
          timestamp,
          succeededMutationId,
          approvalCommandDigest,
          actorIdentityHash,
          importId
        ),
        testEnv.MealPlannerDatabase.prepare(
          `INSERT INTO recipe_review_mutations (
             extraction_fingerprint, mutation_id, command_kind,
             command_digest, resulting_version, item_count, applied_at
           ) VALUES (?, ?, 'transition', ?, 3, 1, ?)`
        ).bind(
          extractionFingerprint,
          approvalMutationId,
          approvalCommandDigest,
          timestamp
        ),
      ])
    ).resolves.toBeDefined();
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT public_status, public_recipe_id, active_action_id,
                active_action_version, intent_version
           FROM recipe_imports WHERE id = ?`
      )
        .bind(importId)
        .first()
    ).resolves.toEqual({
      active_action_id: null,
      active_action_version: null,
      intent_version: 4,
      public_recipe_id: importId,
      public_status: "succeeded",
    });
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT intent_version, event_type, mutation_id
           FROM recipe_import_intent_history
          WHERE intent_id = ? AND intent_version >= 2
          ORDER BY intent_version`
      )
        .bind(importId)
        .all()
    ).resolves.toMatchObject({
      results: [
        {
          event_type: "action_available",
          intent_version: 2,
          mutation_id: correctionMutationId,
        },
        {
          event_type: "processing_stage_changed",
          intent_version: 3,
          mutation_id: approvalMutationId,
        },
        {
          event_type: "intent_succeeded",
          intent_version: 4,
          mutation_id: succeededMutationId,
        },
      ],
    });

    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `UPDATE recipe_imports SET active_action_version = 99 WHERE id = ?`
      )
        .bind(processingImportId)
        .run()
    ).rejects.toThrow(
      /invalid recipe import active action version|recipe import intent version/u
    );
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `INSERT INTO recipe_review_corrections (
           extraction_fingerprint, version, ordinal, actor_id, field,
           before_json, after_json, reason, tags_before_json,
           tags_after_json, corrected_at
         ) VALUES (?, 2, 0, ?, 'tags', 'null', '[]',
                   'Duplicate ordinal.', 'null', '[]', ?)`
      )
        .bind(extractionFingerprint, actorIdentityHash, timestamp)
        .run()
    ).rejects.toThrow(/UNIQUE/u);
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `INSERT INTO recipe_review_mutations (
           extraction_fingerprint, mutation_id, command_kind, command_digest,
           resulting_version, item_count, applied_at
         ) VALUES (?, 'invalid-count', 'correction', ?, 5, 0, ?)`
      )
        .bind(extractionFingerprint, "8".repeat(64), timestamp)
        .run()
    ).rejects.toThrow(
      /recipe_review_mutations_item_count_check|incomplete intent-managed recipe review receipt/u
    );
    await expect(
      testEnv.MealPlannerDatabase.prepare("PRAGMA foreign_key_check").all()
    ).resolves.toMatchObject({ results: [] });
  });
});

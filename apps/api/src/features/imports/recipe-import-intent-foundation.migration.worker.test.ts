import { RecipeImportIntentId } from "@meal-planner/recipe-import-api";
import { applyD1Migrations, env } from "cloudflare:test";
import type { AnyD1Database } from "drizzle-orm/d1";
import { Effect, Option, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { LegacyPrivateImportPrincipal } from "./import-intent.js";
import { makeD1ImportRepository } from "./import.repository.d1.js";

const testEnv = env as unknown as {
  readonly MealPlannerDatabase: AnyD1Database;
  readonly TEST_MIGRATIONS: {
    readonly name: string;
    readonly queries: string[];
  }[];
};

const timestamp = "2026-08-16T12:00:00.000Z";
const privateScope = "1".repeat(64);

const insertLegacyImport = (input: {
  readonly canonicalSourceId: string;
  readonly id: string;
  readonly status?: "queued" | "failed";
}) =>
  testEnv.MealPlannerDatabase.prepare(
    `INSERT INTO recipe_imports (
       acquisition_generation, canonical_source_id,
       compatibility_fingerprint, created_at, evidence_references_json, id,
       recovery_action, source_kind, status, status_code, updated_at
     ) VALUES (0, ?, ?, ?, '[]', ?, ?, 'tiktok', ?, ?, ?)`
  )
    .bind(
      input.canonicalSourceId,
      "a".repeat(64),
      timestamp,
      input.id,
      input.status === "failed" ? "check_source_visibility" : null,
      input.status ?? "queued",
      input.status === "failed" ? "private_or_unavailable" : null,
      timestamp
    )
    .run();

const insertReview = async (input: {
  readonly importId: string;
  readonly lifecycle: "approved" | "needs_review";
  readonly seed: string;
}) => {
  const fingerprint = input.seed.repeat(64);
  await testEnv.MealPlannerDatabase.prepare(
    `INSERT INTO import_recipe_extractions (
       extraction_fingerprint, import_id, acquisition_generation,
       evidence_fingerprint, extractor_provider, extractor_model,
       extractor_version, state, draft_json, input_evidence_items,
       input_tokens, output_tokens, model_calls, latency_milliseconds,
       estimated_cost_micro_usd, cost_currency, cost_certainty, is_current,
       created_at, updated_at, completed_at
     ) VALUES (?, ?, 0, ?, 'test', 'test', 'test', 'needs_review', '{}',
               1, 1, 1, 1, 1, 1, 'USD', 'known', 1, ?, ?, ?)`
  )
    .bind(
      fingerprint,
      input.importId,
      input.seed.repeat(64),
      timestamp,
      timestamp,
      timestamp
    )
    .run();
  await testEnv.MealPlannerDatabase.prepare(
    `INSERT INTO recipe_reviews (
       extraction_fingerprint, lifecycle, version, tags_json,
       created_at, updated_at
     ) VALUES (?, ?, 1, ?, ?, ?)`
  )
    .bind(
      fingerprint,
      input.lifecycle,
      input.lifecycle === "approved" ? "{}" : null,
      timestamp,
      timestamp
    )
    .run();
};

describe("recipe import intent foundation migration", () => {
  it("backfills one authoritative scoped lifecycle and enforces its durable invariants", async () => {
    const migrationIndex = testEnv.TEST_MIGRATIONS.findIndex(
      ({ name }) => name === "0030_recipe_import_intent_foundation.sql"
    );
    expect(migrationIndex).toBeGreaterThan(0);
    await applyD1Migrations(
      testEnv.MealPlannerDatabase,
      testEnv.TEST_MIGRATIONS.slice(0, migrationIndex),
      "d1_migrations"
    );

    const processingId = "00000000-0000-4000-8000-000000000301";
    const failedId = "00000000-0000-4000-8000-000000000302";
    const reviewId = "00000000-0000-4000-8000-000000000303";
    const approvedId = "00000000-0000-4000-8000-000000000304";
    await insertLegacyImport({
      canonicalSourceId: "legacy-processing",
      id: processingId,
    });
    await insertLegacyImport({
      canonicalSourceId: "legacy-failed",
      id: failedId,
      status: "failed",
    });
    await insertLegacyImport({
      canonicalSourceId: "legacy-review",
      id: reviewId,
    });
    await insertLegacyImport({
      canonicalSourceId: "legacy-approved",
      id: approvedId,
    });
    await insertReview({
      importId: reviewId,
      lifecycle: "needs_review",
      seed: "b",
    });
    await insertReview({
      importId: approvedId,
      lifecycle: "approved",
      seed: "c",
    });
    await Promise.all(
      [reviewId, approvedId].map((importId) =>
        testEnv.MealPlannerDatabase.prepare(
          `INSERT INTO import_recipe_terminal_projections (
           acquisition_generation, evidence_references_json, import_id,
           ownership_id, projected_at, recovery_action, status, status_code
         ) VALUES (0, '[]', ?, ?, ?, 'operator_reconcile', 'failed',
                   'recipe_extraction_failed')`
        )
          .bind(importId, "9".repeat(64), timestamp)
          .run()
      )
    );
    await testEnv.MealPlannerDatabase.prepare(
      `INSERT INTO import_requests (
         created_at, idempotency_key_hash, import_id, request_fingerprint,
         source_locator_hash
       ) VALUES (?, ?, ?, ?, ?)`
    )
      .bind(
        timestamp,
        "d".repeat(64),
        processingId,
        "e".repeat(64),
        "f".repeat(64)
      )
      .run();

    const migration = testEnv.TEST_MIGRATIONS[migrationIndex];
    if (migration === undefined) {
      throw new Error("Missing recipe import intent foundation migration");
    }
    await testEnv.MealPlannerDatabase.batch(
      migration.queries.map((query) =>
        testEnv.MealPlannerDatabase.prepare(query)
      )
    );

    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT id, household_scope_id, resolved_canonical_source_id,
                public_status, public_stage, active_action_id,
                public_recipe_id, intent_version
           FROM recipe_imports
          ORDER BY id`
      ).all()
    ).resolves.toMatchObject({
      results: [
        {
          active_action_id: null,
          household_scope_id: privateScope,
          id: processingId,
          intent_version: 1,
          public_recipe_id: null,
          public_stage: "acquiring_media",
          public_status: "processing",
          resolved_canonical_source_id: "legacy-processing",
        },
        {
          active_action_id: null,
          household_scope_id: privateScope,
          id: failedId,
          intent_version: 1,
          public_recipe_id: null,
          public_stage: null,
          public_status: "failed",
          resolved_canonical_source_id: "legacy-failed",
        },
        {
          active_action_id: "b".repeat(64),
          household_scope_id: privateScope,
          id: reviewId,
          intent_version: 1,
          public_recipe_id: null,
          public_stage: null,
          public_status: "requires_action",
          resolved_canonical_source_id: "legacy-review",
        },
        {
          active_action_id: null,
          household_scope_id: privateScope,
          id: approvedId,
          intent_version: 1,
          public_recipe_id: approvedId,
          public_stage: null,
          public_status: "succeeded",
          resolved_canonical_source_id: "legacy-approved",
        },
      ],
    });
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT count(*) AS count,
                min(event_type) AS event_type,
                min(intent_version) AS intent_version,
                min(actor_category) AS actor_category,
                min(from_public_status) AS from_public_status
           FROM recipe_import_intent_history`
      ).first()
    ).resolves.toEqual({
      actor_category: "migration",
      count: 4,
      event_type: "migration_snapshot",
      from_public_status: null,
      intent_version: 1,
    });
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT household_scope_id, import_id
           FROM import_requests
          WHERE idempotency_key_hash = ?`
      )
        .bind("d".repeat(64))
        .first()
    ).resolves.toEqual({
      household_scope_id: privateScope,
      import_id: processingId,
    });

    const executorMigration = testEnv.TEST_MIGRATIONS.find(
      ({ name }) =>
        name === "0031_recipe_import_intent_executor_transitions.sql"
    );
    if (executorMigration === undefined) {
      throw new Error("Missing recipe import intent executor migration");
    }
    await testEnv.MealPlannerDatabase.batch(
      executorMigration.queries.map((query) =>
        testEnv.MealPlannerDatabase.prepare(query)
      )
    );

    const repository = makeD1ImportRepository(testEnv.MealPlannerDatabase);
    const readLegacy = (id: string) =>
      Effect.runPromise(
        repository.findIntent(
          LegacyPrivateImportPrincipal,
          Schema.decodeUnknownSync(RecipeImportIntentId)(id)
        )
      ).then(Option.getOrThrow);
    const [processing, requiresAction, succeeded] = await Promise.all([
      readLegacy(processingId),
      readLegacy(reviewId),
      readLegacy(approvedId),
    ]);
    expect(processing).toMatchObject({
      id: processingId,
      processing: { sourceKind: "video", type: "acquiring_media" },
      source: {
        canonicalUrl: "https://www.tiktok.com/video/legacy-processing",
        resolution: "resolved",
      },
      status: "processing",
    });
    expect(requiresAction).toMatchObject({
      action: { id: "b".repeat(64), type: "review_recipe" },
      id: reviewId,
      status: "requires_action",
    });
    expect(succeeded).toMatchObject({
      id: approvedId,
      result: { recipeId: approvedId },
      status: "succeeded",
    });

    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `UPDATE recipe_import_intent_history SET event_type = 'intent_failed'`
      ).run()
    ).rejects.toThrow(/append-only/u);
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `DELETE FROM recipe_import_intent_history`
      ).run()
    ).rejects.toThrow(/append-only/u);

    const insertCurrent = (input: {
      readonly actionId?: string;
      readonly household: string;
      readonly id: string;
      readonly privateCanonical: string;
      readonly publicCanonical: string | null;
      readonly recipeId?: string;
      readonly stage?: "acquiring_media" | "resolving_source";
      readonly status:
        | "cancelled"
        | "failed"
        | "processing"
        | "redirected"
        | "requires_action"
        | "succeeded";
      readonly redirectId?: string;
      readonly executorOwner?: string;
    }) =>
      testEnv.MealPlannerDatabase.prepare(
        `INSERT INTO recipe_imports (
           acquisition_generation, active_action_id, actor_id, cancelled_at,
           canonical_source_id,
           compatibility_fingerprint, created_at, evidence_references_json,
           executor_owner_id, failed_at, household_scope_id, id, intent_version,
           public_activity, public_stage, public_stage_started_at,
           public_failure_code, public_failure_message, public_recovery,
           public_recipe_id, public_status, redirected_at,
           redirected_to_import_id,
           resolved_canonical_source_id, recovery_action, source_kind,
           status, status_code, submitted_source_url, succeeded_at, updated_at,
           public_source_url, public_source_kind
         ) VALUES (0, ?, ?, ?, ?, ?, ?, '[]', ?, ?, ?, ?, 1, ?, ?, ?, ?, ?,
                   ?, ?, ?, ?, ?, ?, NULL, 'tiktok', 'queued', NULL, ?, ?, ?, ?, ?)`
      ).bind(
        input.actionId ?? null,
        "2".repeat(64),
        input.status === "cancelled" ? timestamp : null,
        input.privateCanonical,
        "3".repeat(64),
        timestamp,
        input.executorOwner ?? null,
        input.status === "failed" ? timestamp : null,
        input.household,
        input.id,
        input.status === "processing" ? "working" : null,
        input.status === "processing"
          ? (input.stage ??
              (input.publicCanonical === null
                ? "resolving_source"
                : "acquiring_media"))
          : null,
        input.status === "processing" ? timestamp : null,
        input.status === "failed" ? "source_unavailable" : null,
        input.status === "failed" ? "The source is not available." : null,
        input.status === "failed" ? "create_new_intent" : null,
        input.recipeId ?? null,
        input.status,
        input.status === "redirected" ? timestamp : null,
        input.redirectId ?? null,
        input.publicCanonical,
        "https://www.tiktok.com/t/submitted",
        input.status === "succeeded" ? timestamp : null,
        timestamp,
        input.publicCanonical === null
          ? null
          : "https://www.tiktok.com/@household/video/123",
        input.publicCanonical === null ? null : "video"
      );

    await insertCurrent({
      household: "4".repeat(64),
      id: "00000000-0000-4000-8000-000000000311",
      privateCanonical: "provisional-one",
      publicCanonical: "same-source",
      status: "processing",
    }).run();
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT event_type, actor_category, mutation_id, command_digest,
                from_public_status, from_public_stage, to_public_status,
                to_public_stage
           FROM recipe_import_intent_history
          WHERE intent_id = ? AND intent_version = 1`
      )
        .bind("00000000-0000-4000-8000-000000000311")
        .first()
    ).resolves.toEqual({
      actor_category: "system",
      command_digest: null,
      event_type: "intent_admitted",
      from_public_stage: null,
      from_public_status: null,
      mutation_id: null,
      to_public_stage: "acquiring_media",
      to_public_status: "processing",
    });
    await testEnv.MealPlannerDatabase.prepare(
      `INSERT INTO recipe_import_intent_history (
         intent_id, intent_version, event_type, occurred_at, public_status,
         public_stage, public_activity, public_source_url,
         mutation_id, command_digest, actor_category, actor_identity_hash,
         from_public_status, from_public_stage, to_public_status,
         to_public_stage
       ) VALUES (?, 2, 'retrying', ?, 'processing', 'acquiring_media',
                 'retrying', 'https://www.tiktok.com/@household/video/123',
                 ?, ?, 'household_member', ?, 'processing', 'acquiring_media',
                 'processing', 'acquiring_media')`
    )
      .bind(
        "00000000-0000-4000-8000-000000000311",
        timestamp,
        "a".repeat(64),
        "b".repeat(64),
        "2".repeat(64)
      )
      .run();
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `INSERT INTO recipe_import_intent_history (
           intent_id, intent_version, event_type, occurred_at, public_status,
           public_stage, public_activity, public_source_url,
           mutation_id, command_digest, actor_category, actor_identity_hash,
           from_public_status, from_public_stage, to_public_status,
           to_public_stage
         ) VALUES (?, 3, 'retrying', ?, 'processing', 'acquiring_media',
                   'retrying', 'https://www.tiktok.com/@household/video/123',
                   ?, ?, 'household_member', ?, 'processing',
                   'acquiring_media', 'processing', 'acquiring_media')`
      )
        .bind(
          "00000000-0000-4000-8000-000000000311",
          timestamp,
          "a".repeat(64),
          "c".repeat(64),
          "2".repeat(64)
        )
        .run()
    ).rejects.toThrow(/UNIQUE/u);
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `UPDATE recipe_imports
            SET public_activity = 'retrying', public_next_attempt_at = ?,
                intent_version = 2, updated_at = ?
          WHERE id = ?`
      )
        .bind(
          "2026-08-16T12:05:00.000Z",
          timestamp,
          "00000000-0000-4000-8000-000000000311"
        )
        .run()
    ).rejects.toThrow(/UNIQUE/u);
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT intent_version, public_activity
           FROM recipe_imports WHERE id = ?`
      )
        .bind("00000000-0000-4000-8000-000000000311")
        .first()
    ).resolves.toEqual({ intent_version: 1, public_activity: "working" });
    await expect(
      insertCurrent({
        household: "4".repeat(64),
        id: "00000000-0000-4000-8000-000000000312",
        privateCanonical: "provisional-two",
        publicCanonical: "same-source",
        status: "processing",
      }).run()
    ).rejects.toThrow(/UNIQUE/u);
    await expect(
      insertCurrent({
        actionId: "7".repeat(64),
        household: "4".repeat(64),
        id: "00000000-0000-4000-8000-000000000317",
        privateCanonical: "provisional-action",
        publicCanonical: "same-source",
        status: "requires_action",
      }).run()
    ).rejects.toThrow(/UNIQUE/u);
    await expect(
      insertCurrent({
        household: "4".repeat(64),
        id: "00000000-0000-4000-8000-000000000318",
        privateCanonical: "provisional-success",
        publicCanonical: "same-source",
        recipeId: "00000000-0000-4000-8000-000000000318",
        status: "succeeded",
      }).run()
    ).rejects.toThrow(/UNIQUE/u);
    await insertCurrent({
      household: "4".repeat(64),
      id: "00000000-0000-4000-8000-000000000313",
      privateCanonical: "provisional-three",
      publicCanonical: "same-source",
      status: "failed",
    }).run();
    await insertCurrent({
      household: "4".repeat(64),
      id: "00000000-0000-4000-8000-000000000319",
      privateCanonical: "provisional-cancelled",
      publicCanonical: "same-source",
      status: "cancelled",
    }).run();
    await insertCurrent({
      household: "5".repeat(64),
      id: "00000000-0000-4000-8000-000000000314",
      privateCanonical: "provisional-four",
      publicCanonical: "same-source",
      status: "processing",
    }).run();
    await insertCurrent({
      household: "4".repeat(64),
      id: "00000000-0000-4000-8000-000000000320",
      privateCanonical: "retry-failed",
      publicCanonical: "retry-source",
      status: "failed",
    }).run();
    await insertCurrent({
      household: "4".repeat(64),
      id: "00000000-0000-4000-8000-000000000321",
      privateCanonical: "retry-cancelled",
      publicCanonical: "retry-source",
      status: "cancelled",
    }).run();
    await insertCurrent({
      household: "4".repeat(64),
      id: "00000000-0000-4000-8000-000000000322",
      privateCanonical: "retry-processing",
      publicCanonical: "retry-source",
      status: "processing",
    }).run();
    await insertCurrent({
      household: "4".repeat(64),
      id: "00000000-0000-4000-8000-000000000323",
      privateCanonical: "unresolved-admission",
      publicCanonical: null,
      status: "processing",
    }).run();
    await expect(
      insertCurrent({
        household: "4".repeat(64),
        id: "00000000-0000-4000-8000-000000000324",
        privateCanonical: "unresolved-late-stage",
        publicCanonical: null,
        stage: "acquiring_media",
        status: "processing",
      }).run()
    ).rejects.toThrow(/source and stage/u);
    await expect(
      insertCurrent({
        household: "4".repeat(64),
        id: "00000000-0000-4000-8000-000000000325",
        privateCanonical: "resolved-early-stage",
        publicCanonical: "early-source",
        stage: "resolving_source",
        status: "processing",
      }).run()
    ).rejects.toThrow(/source and stage/u);

    await insertCurrent({
      household: "4".repeat(64),
      id: "00000000-0000-4000-8000-000000000326",
      privateCanonical: "redirect-valid",
      publicCanonical: "same-source",
      redirectId: "00000000-0000-4000-8000-000000000311",
      status: "redirected",
    }).run();
    await Promise.all(
      (
        [
          [
            "00000000-0000-4000-8000-000000000327",
            "00000000-0000-4000-8000-000000000314",
            "same-source",
          ],
          [
            "00000000-0000-4000-8000-000000000328",
            "00000000-0000-4000-8000-000000000313",
            "same-source",
          ],
          [
            "00000000-0000-4000-8000-000000000329",
            "00000000-0000-4000-8000-000000000322",
            "same-source",
          ],
        ] as const
      ).map(([id, targetId, source]) =>
        expect(
          insertCurrent({
            household: "4".repeat(64),
            id,
            privateCanonical: `redirect-invalid-${id}`,
            publicCanonical: source,
            redirectId: targetId,
            status: "redirected",
          }).run()
        ).rejects.toThrow(/redirect target/u)
      )
    );

    await testEnv.MealPlannerDatabase.prepare(
      `INSERT INTO import_requests (
         household_scope_id, created_at, idempotency_key_hash, import_id,
         request_fingerprint, source_locator_hash
       ) VALUES (?, ?, ?, ?, ?, ?)`
    )
      .bind(
        "4".repeat(64),
        timestamp,
        "8".repeat(64),
        "00000000-0000-4000-8000-000000000311",
        "9".repeat(64),
        "a".repeat(64)
      )
      .run();
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `INSERT INTO import_requests (
           household_scope_id, created_at, idempotency_key_hash, import_id,
           request_fingerprint, source_locator_hash
         ) VALUES (?, ?, ?, ?, ?, ?)`
      )
        .bind(
          "4".repeat(64),
          timestamp,
          "8".repeat(64),
          "00000000-0000-4000-8000-000000000313",
          "b".repeat(64),
          "c".repeat(64)
        )
        .run()
    ).rejects.toThrow(/UNIQUE/u);
    await testEnv.MealPlannerDatabase.prepare(
      `INSERT INTO import_requests (
         household_scope_id, created_at, idempotency_key_hash, import_id,
         request_fingerprint, source_locator_hash
       ) VALUES (?, ?, ?, ?, ?, ?)`
    )
      .bind(
        "5".repeat(64),
        timestamp,
        "8".repeat(64),
        "00000000-0000-4000-8000-000000000314",
        "d".repeat(64),
        "e".repeat(64)
      )
      .run();
    await expect(
      insertCurrent({
        executorOwner: "6".repeat(64),
        household: "4".repeat(64),
        id: "00000000-0000-4000-8000-000000000315",
        privateCanonical: "provisional-five",
        publicCanonical: "same-source",
        redirectId: "00000000-0000-4000-8000-000000000311",
        status: "redirected",
      }).run()
    ).rejects.toThrow(/invalid recipe import intent public state/u);
    await expect(
      insertCurrent({
        household: "invalid-scope",
        id: "00000000-0000-4000-8000-000000000316",
        privateCanonical: "provisional-six",
        publicCanonical: null,
        status: "processing",
      }).run()
    ).rejects.toThrow(/household scope/u);
    await expect(
      testEnv.MealPlannerDatabase.prepare("PRAGMA foreign_key_check").all()
    ).resolves.toMatchObject({ results: [] });
  });
});

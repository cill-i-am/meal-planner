import { applyD1Migrations, env } from "cloudflare:test";
import type { AnyD1Database } from "drizzle-orm/d1";
import { DateTime, Effect, Schema } from "effect";
import { beforeAll, describe, expect, it } from "vitest";

import { AcquisitionGeneration } from "./import-media.model.js";
import { RecipeDraft } from "./import-recipe-draft.repository.d1.js";
import {
  PlanningTags,
  RecipeReviewView,
  RecipeReviewerActorId,
  makeRecipeReviewService,
  recipeReviewNullablePolicy,
} from "./import-recipe-review.js";
import { makeD1RecipeReviewRepository } from "./import-recipe-review.repository.d1.js";
import {
  EvidenceReference,
  ImportId,
  ImportTimestamp,
} from "./import.contracts.js";

const testEnv = env as unknown as {
  readonly MealPlannerDatabase: AnyD1Database;
  readonly TEST_MIGRATIONS: {
    readonly name: string;
    readonly queries: string[];
  }[];
};

const decodeImportId = Schema.decodeUnknownSync(ImportId);
const decodeTimestamp = Schema.decodeUnknownSync(ImportTimestamp);
const decodeGeneration = Schema.decodeUnknownSync(AcquisitionGeneration);
const decodeActor = Schema.decodeUnknownSync(RecipeReviewerActorId);
const decodeTags = Schema.decodeUnknownSync(PlanningTags);

const actorId = decodeActor("private_api_credential");
const tags = decodeTags({
  cuisines: ["Irish"],
  dietaryFit: "household_match",
  difficulty: "easy",
  leftovers: "one_meal",
  mealTypes: ["dinner"],
  totalTimeBand: "30_to_60_minutes",
});

const fixtureHash = (character: string) => character.repeat(64);
const citation = {
  citations: [
    {
      confidence: 1,
      evidenceId: "caption:fixture",
      origin: "creator_provided" as const,
    },
  ],
  origin: "creator_provided" as const,
  state: "supported" as const,
};
const supportedString = (value: string) => ({ ...citation, value });
const supportedNumber = (value: number) => ({ ...citation, value });
const supportedList = (values: readonly string[]) => ({
  items: values.map(supportedString),
  state: "supported" as const,
});
const unresolved = (reason: string) => ({
  citations: [] as const,
  origin: "unresolved" as const,
  reason,
  state: "unresolved" as const,
});

const makeDraft = (importId: ImportId, fingerprintCharacter: string) =>
  Schema.decodeUnknownSync(RecipeDraft)({
    createdAt: "2026-07-22T10:00:00.000Z",
    evidenceFingerprint: fixtureHash("a"),
    extraction: {
      author: supportedString("Fixture Cook"),
      category: supportedString("Dinner"),
      cookTimeMinutes: supportedNumber(20),
      cost: {
        certainty: "known",
        currency: "USD",
        estimatedMicroUsd: 0,
      },
      cuisine: supportedString("Irish"),
      description: supportedString("A deterministic fixture."),
      ingredientLines: supportedList(["1 onion", "2 tomatoes"]),
      instructions: supportedList([
        "Chop the onion.",
        "Simmer for 20 minutes.",
      ]),
      name: unresolved("The title was not visible."),
      nutrition: unresolved("Nutrition was not stated."),
      prepTimeMinutes: supportedNumber(10),
      sourceUrl: supportedString(
        "https://www.tiktok.com/@fixture/video/7520000000000000001"
      ),
      supportedClaims: supportedList(["Simmer for 20 minutes."]),
      temperatureCelsius: unresolved("Temperature was not stated."),
      tools: supportedList(["Saucepan"]),
      totalTimeMinutes: supportedNumber(30),
      unresolvedFields: [
        "name",
        "nutrition",
        "temperature_celsius",
        "ingredient_quantities",
        "ingredient_units",
      ],
      usage: {
        inputEvidenceItems: 1,
        inputTokens: 0,
        latencyMilliseconds: 0,
        modelCalls: 1,
        outputTokens: 0,
      },
      yield: supportedString("2 servings"),
    },
    extractionFingerprint: fixtureHash(fingerprintCharacter),
    extractor: {
      model: "fixture-v1",
      provider: "deterministic_fake",
      version: "schema-1",
    },
    generation: decodeGeneration(1),
    importId,
    lifecycle: "needs_review",
    schemaVersion: 1,
  });

const seedDraft = async (draft: RecipeDraft, canonicalId: string) => {
  const evidence = [
    {
      kind: "original_media",
      referenceId: `imports/${draft.importId}/acquisition/v1/generations/1/original.mp4`,
    },
    {
      kind: "acquisition_manifest",
      referenceId: `imports/${draft.importId}/acquisition/v1/generations/1/manifest.json`,
    },
    {
      kind: "speech_transcript",
      referenceId: `imports/${draft.importId}/transcription/v1/generations/1/transcript.json`,
    },
  ];
  await testEnv.MealPlannerDatabase.batch([
    testEnv.MealPlannerDatabase.prepare(
      `INSERT INTO recipe_imports (
         id, acquisition_generation, canonical_source_id,
         compatibility_fingerprint, created_at, evidence_references_json,
         recovery_action, source_kind, status, status_code, updated_at
       ) VALUES (?, 1, ?, ?, ?, ?, NULL, 'tiktok', 'transcribed', NULL, ?)`
    ).bind(
      draft.importId,
      canonicalId,
      fixtureHash("c"),
      "2026-07-22T09:59:00.000Z",
      JSON.stringify(evidence),
      "2026-07-22T10:00:00.000Z"
    ),
    testEnv.MealPlannerDatabase.prepare(
      `INSERT INTO import_recipe_extractions (
         extraction_fingerprint, import_id, acquisition_generation,
         evidence_fingerprint, extractor_provider, extractor_model,
         extractor_version, state, draft_json, failure_code,
         input_evidence_items, input_tokens, output_tokens, model_calls,
         latency_milliseconds, estimated_cost_micro_usd, cost_currency,
         cost_certainty, is_current, created_at, updated_at, completed_at
       ) VALUES (?, ?, 1, ?, 'deterministic_fake', 'fixture-v1', 'schema-1',
                 'needs_review', ?, NULL, 1, 0, 0, 1, 0, 0, 'USD', 'known',
                 1, ?, ?, ?)`
    ).bind(
      draft.extractionFingerprint,
      draft.importId,
      draft.evidenceFingerprint,
      JSON.stringify(Schema.encodeSync(RecipeDraft)(draft)),
      DateTime.formatIso(draft.createdAt),
      DateTime.formatIso(draft.createdAt),
      DateTime.formatIso(draft.createdAt)
    ),
  ]);
};

beforeAll(async () => {
  await applyD1Migrations(
    testEnv.MealPlannerDatabase,
    [...testEnv.TEST_MIGRATIONS],
    "d1_migrations"
  );
});

describe("provider-free D1 recipe review tracer", () => {
  it("audits correction and approval with stale-write rejection and approved-only reads", async () => {
    const approvedId = decodeImportId("018f47ad-91aa-7c35-b6fe-000000000311");
    const rejectedId = decodeImportId("018f47ad-91aa-7c35-b6fe-000000000312");
    const approvedDraft = makeDraft(approvedId, "b");
    const rejectedDraft = makeDraft(rejectedId, "d");
    await seedDraft(approvedDraft, "7520000000000000311");
    await seedDraft(rejectedDraft, "7520000000000000312");

    const storedBoundary = await testEnv.MealPlannerDatabase.prepare(
      `SELECT extraction.draft_json, parent.evidence_references_json
         FROM import_recipe_extractions AS extraction
         JOIN recipe_imports AS parent ON parent.id = extraction.import_id
        WHERE extraction.import_id = ? AND extraction.is_current = 1`
    )
      .bind(approvedId)
      .first<{ draft_json: string; evidence_references_json: string }>();
    expect(storedBoundary).not.toBeNull();
    expect(
      Schema.decodeUnknownSync(RecipeDraft)(
        JSON.parse(storedBoundary?.draft_json ?? "null")
      )
    ).toEqual(approvedDraft);
    expect(
      Schema.decodeUnknownSync(Schema.Array(EvidenceReference))(
        JSON.parse(storedBoundary?.evidence_references_json ?? "null")
      )
    ).toHaveLength(3);
    const reviewBoundary = await testEnv.MealPlannerDatabase.prepare(
      `SELECT extraction.draft_json, parent.evidence_references_json,
              extraction.extraction_fingerprint, review.lifecycle,
              review.version, review.tags_json
         FROM import_recipe_extractions AS extraction
         JOIN recipe_imports AS parent ON parent.id = extraction.import_id
         LEFT JOIN recipe_reviews AS review
           ON review.extraction_fingerprint = extraction.extraction_fingerprint
        WHERE extraction.state = 'needs_review'
          AND extraction.draft_json IS NOT NULL
          AND extraction.import_id = ? AND extraction.is_current = 1`
    )
      .bind(approvedId)
      .first();
    expect(reviewBoundary).not.toBeNull();
    expect(
      Schema.decodeUnknownSync(RecipeReviewView)({
        corrections: [],
        draft: JSON.parse(
          (reviewBoundary as { draft_json: string }).draft_json
        ),
        evidence: JSON.parse(
          (reviewBoundary as { evidence_references_json: string })
            .evidence_references_json
        ),
        lifecycle: "needs_review",
        nullablePolicy: recipeReviewNullablePolicy,
        tags: null,
        transitions: [],
        unresolvedRequiredFields: ["name"],
        version: 0,
      })
    ).toMatchObject({ lifecycle: "needs_review", version: 0 });
    const repository = makeD1RecipeReviewRepository(
      testEnv.MealPlannerDatabase
    );
    let tick = 0;
    const service = makeRecipeReviewService({
      now: () => decodeTimestamp(`2026-07-22T10:0${++tick}:00.000Z`),
      repository,
    });

    const initial = await Effect.runPromise(service.get(approvedId));
    expect(initial).toMatchObject({
      corrections: [],
      draft: {
        evidenceFingerprint: approvedDraft.evidenceFingerprint,
        lifecycle: "needs_review",
      },
      lifecycle: "needs_review",
      unresolvedRequiredFields: ["name"],
      version: 0,
    });

    await expect(
      Effect.runPromise(
        service.approve(
          approvedId,
          { expectedVersion: 0, reason: "Ready for the recipe bank." },
          actorId
        )
      )
    ).rejects.toMatchObject({
      _tag: "RecipeApprovalBlocked",
      blockers: { unresolvedRequiredFields: ["name"] },
      tagsRequired: true,
    });

    const corrected = await Effect.runPromise(
      service.correct(
        approvedId,
        {
          correction: {
            field: "name",
            reason: "The title is visible in the cited caption frame.",
            value: "Tomato and Onion Stew",
          },
          expectedVersion: 0,
          tags,
        },
        actorId
      )
    );
    expect(corrected).toMatchObject({
      corrections: [
        {
          actorId,
          after: "Tomato and Onion Stew",
          before: null,
          field: "name",
          reason: "The title is visible in the cited caption frame.",
          version: 1,
        },
      ],
      lifecycle: "needs_review",
      tags,
      unresolvedRequiredFields: [],
      version: 1,
    });
    expect(corrected.draft).toEqual(initial.draft);

    await expect(
      Effect.runPromise(
        service.correct(
          approvedId,
          {
            correction: {
              field: "name",
              reason: "A stale competing correction.",
              value: "Stale title",
            },
            expectedVersion: 0,
            tags,
          },
          actorId
        )
      )
    ).rejects.toMatchObject({
      _tag: "RecipeReviewVersionConflict",
      actualVersion: 1,
      expectedVersion: 0,
    });

    const approved = await Effect.runPromise(
      service.approve(
        approvedId,
        { expectedVersion: 1, reason: "Validated and ready for planning." },
        actorId
      )
    );
    expect(approved).toMatchObject({
      lifecycle: "approved",
      transitions: [
        {
          actorId,
          from: "needs_review",
          to: "approved",
          version: 2,
        },
      ],
      version: 2,
    });

    const rejected = await Effect.runPromise(
      service.reject(
        rejectedId,
        { expectedVersion: 0, reason: "Insufficient recipe detail." },
        actorId
      )
    );
    expect(rejected).toMatchObject({ lifecycle: "rejected", version: 1 });
    expect(rejected.draft).toEqual(rejectedDraft);
    expect(rejected.evidence).toHaveLength(3);

    const bank = await Effect.runPromise(service.listApproved());
    expect(bank).toEqual([
      expect.objectContaining({
        extractionFingerprint: approvedDraft.extractionFingerprint,
        importId: approvedId,
        recipe: expect.objectContaining({ name: "Tomato and Onion Stew" }),
        tags,
      }),
    ]);

    const correctionRows = await testEnv.MealPlannerDatabase.prepare(
      `SELECT actor_id, before_json, after_json, reason, version
         FROM recipe_review_corrections
        WHERE extraction_fingerprint = ?`
    )
      .bind(approvedDraft.extractionFingerprint)
      .all();
    expect(correctionRows.results).toEqual([
      expect.objectContaining({
        actor_id: actorId,
        after_json: JSON.stringify("Tomato and Onion Stew"),
        before_json: "null",
        reason: "The title is visible in the cited caption frame.",
        version: 1,
      }),
    ]);
  });

  it("preserves immutable extraction evidence and append-only review history", async () => {
    const id = decodeImportId("018f47ad-91aa-7c35-b6fe-000000000313");
    const draft = makeDraft(id, "e");
    await seedDraft(draft, "7520000000000000313");
    const repository = makeD1RecipeReviewRepository(
      testEnv.MealPlannerDatabase
    );
    const service = makeRecipeReviewService({
      now: () => decodeTimestamp("2026-07-22T10:10:00.000Z"),
      repository,
    });
    await Effect.runPromise(
      service.reject(
        id,
        { expectedVersion: 0, reason: "Return after evidence review." },
        actorId
      )
    );
    const returned = await Effect.runPromise(
      service.returnToReview(
        id,
        { expectedVersion: 1, reason: "Evidence is available for correction." },
        actorId
      )
    );
    expect(returned).toMatchObject({ lifecycle: "needs_review", version: 2 });
    expect(returned.draft).toEqual(draft);

    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `UPDATE import_recipe_extractions SET draft_json = '{}'
          WHERE extraction_fingerprint = ?`
      )
        .bind(draft.extractionFingerprint)
        .run()
    ).rejects.toThrow(/completed recipe drafts are immutable/u);
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `DELETE FROM recipe_review_transitions
          WHERE extraction_fingerprint = ? AND version = 1`
      )
        .bind(draft.extractionFingerprint)
        .run()
    ).rejects.toThrow(/append-only/u);
  });
});

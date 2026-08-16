import { applyD1Migrations, env } from "cloudflare:test";
import type { AnyD1Database } from "drizzle-orm/d1";
import { DateTime, Effect, Schema } from "effect";
import { beforeAll, describe, expect, it } from "vitest";

import { AcquisitionGeneration } from "./import-media.model.js";
import { RecipeDraft } from "./import-recipe-draft.repository.d1.js";
import {
  CorrectRecipeDraftRequest,
  PlanningTags,
  RecipeReviewMutationId,
  RecipeReviewView,
  RecipeReviewerActorId,
  TransitionRecipeDraftRequest,
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
const decodeMutationId = Schema.decodeUnknownSync(RecipeReviewMutationId);
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

const expectAppliedReview = (outcome: {
  readonly _tag: "Applied" | "Replayed";
  readonly review: RecipeReviewView;
}) => {
  expect(outcome._tag).toBe("Applied");
  return outcome.review;
};

const correctionPairs = [
  { field: "author", value: "Corrected author" },
  { field: "category", value: "Corrected category" },
  { field: "cook_time_minutes", value: 21 },
  { field: "cuisine", value: "Corrected cuisine" },
  { field: "description", value: "Corrected description" },
  { field: "ingredient_lines", value: ["1 corrected ingredient"] },
  { field: "ingredient_quantities", value: ["1"] },
  { field: "ingredient_units", value: ["cup"] },
  { field: "instructions", value: ["Follow the corrected instruction."] },
  { field: "name", value: "Corrected name" },
  { field: "nutrition", value: "Corrected nutrition" },
  { field: "prep_time_minutes", value: 11 },
  { field: "temperature_celsius", value: 180 },
  { field: "tools", value: ["Corrected tool"] },
  { field: "total_time_minutes", value: 31 },
  { field: "yield", value: "3 servings" },
];
const correctionCases = correctionPairs.map((correction, index) => ({
  ...correction,
  index,
}));

const fixtureHash = (character: string) => character.repeat(64);
const fixtureFingerprint = (index: number) =>
  index.toString(16).padStart(64, "0");
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

const makeDraft = (
  importId: ImportId,
  extractionFingerprint: string,
  nameResolved = false
) =>
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
      name: nameResolved
        ? supportedString("Tomato and Onion Stew")
        : unresolved("The title was not visible."),
      nutrition: unresolved("Nutrition was not stated."),
      prepTimeMinutes: supportedNumber(10),
      sourceUrl: supportedString(
        "https://www.tiktok.com/@fixture/video/7520000000000000001"
      ),
      supportedClaims: supportedList(["Simmer for 20 minutes."]),
      temperatureCelsius: unresolved("Temperature was not stated."),
      tools: supportedList(["Saucepan"]),
      totalTimeMinutes: supportedNumber(30),
      unresolvedFields: nameResolved
        ? [
            "nutrition",
            "temperature_celsius",
            "ingredient_quantities",
            "ingredient_units",
          ]
        : [
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
    extractionFingerprint,
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
  it("installs the fresh review schema with only the durable mutation ledger identity", async () => {
    const reviewColumns = await testEnv.MealPlannerDatabase.prepare(
      "PRAGMA table_info(recipe_reviews)"
    ).all<{ readonly name: string }>();
    expect(
      reviewColumns.results.map((row: { readonly name: string }) => row.name)
    ).not.toContain("last_mutation_id");

    const mutationColumns = await testEnv.MealPlannerDatabase.prepare(
      "PRAGMA table_info(recipe_review_mutations)"
    ).all<{ readonly name: string }>();
    expect(
      mutationColumns.results.map((row: { readonly name: string }) => row.name)
    ).toEqual([
      "extraction_fingerprint",
      "mutation_id",
      "command_kind",
      "command_digest",
      "resulting_version",
      "applied_at",
    ]);
  });

  it.each(correctionCases)(
    "round-trips the schema-valid $field correction pairing through D1",
    async ({ index, ...correction }) => {
      const repository = makeD1RecipeReviewRepository(
        testEnv.MealPlannerDatabase
      );
      const service = makeRecipeReviewService({
        now: () => decodeTimestamp("2026-07-22T10:00:00.000Z"),
        repository,
      });
      const importId = decodeImportId(
        `018f47ad-91aa-7c35-b6fe-${String(index + 320).padStart(12, "0")}`
      );
      const draft = makeDraft(importId, fixtureFingerprint(index + 320));
      await seedDraft(draft, `7520000000000000${index + 320}`);
      const request = Schema.decodeUnknownSync(CorrectRecipeDraftRequest)({
        correction: {
          ...correction,
          reason: "The correction is visible in the cited caption frame.",
        },
        expectedVersion: 0,
        mutationId: `correction-${index + 320}`,
        tags,
      });

      const outcome = await Effect.runPromise(
        service.correct(importId, request, actorId)
      );
      expect(outcome._tag).toBe("Applied");
      const corrected = outcome.review;
      expect(corrected).toMatchObject({
        corrections: [
          expect.objectContaining({
            after: correction.value,
            field: correction.field,
          }),
        ],
        version: 1,
      });
      const roundTripped = await Effect.runPromise(service.get(importId));
      expect(roundTripped).toEqual(corrected);
    }
  );

  it("replays one correction identity without advancing audit history and rejects changed-command reuse", async () => {
    const importId = decodeImportId("018f47ad-91aa-7c35-b6fe-000000000337");
    const draft = makeDraft(importId, fixtureFingerprint(337));
    await seedDraft(draft, "7520000000000000337");
    const repository = makeD1RecipeReviewRepository(
      testEnv.MealPlannerDatabase
    );
    const service = makeRecipeReviewService({
      now: () => decodeTimestamp("2026-07-22T10:30:00.000Z"),
      repository,
    });
    const request = Schema.decodeUnknownSync(CorrectRecipeDraftRequest)({
      correction: {
        field: "name",
        reason: "The title is visible in the cited caption frame.",
        value: "Tomato and Onion Stew",
      },
      expectedVersion: 0,
      mutationId: "correction-retry-337",
      tags,
    });

    const applied = await Effect.runPromise(
      service.correct(importId, request, actorId)
    );
    expect(applied).toMatchObject({
      _tag: "Applied",
      mutationId: decodeMutationId("correction-retry-337"),
      review: { version: 1 },
    });

    const replayed = await Effect.runPromise(
      service.correct(importId, request, actorId)
    );
    expect(replayed).toMatchObject({
      _tag: "Replayed",
      mutationId: decodeMutationId("correction-retry-337"),
      review: { version: 1 },
    });

    const conflictingRequest = Schema.decodeUnknownSync(
      CorrectRecipeDraftRequest
    )({
      correction: {
        field: "name",
        reason: request.correction.reason,
        value: "A conflicting title",
      },
      expectedVersion: request.expectedVersion,
      mutationId: request.mutationId,
      tags: request.tags,
    });

    await expect(
      Effect.runPromise(service.correct(importId, conflictingRequest, actorId))
    ).rejects.toMatchObject({
      _tag: "RecipeReviewMutationConflict",
      mutationId: decodeMutationId("correction-retry-337"),
    });

    const reconstructed = makeRecipeReviewService({
      now: () => decodeTimestamp("2026-07-22T11:30:00.000Z"),
      repository: makeD1RecipeReviewRepository(testEnv.MealPlannerDatabase),
    });
    await expect(
      Effect.runPromise(reconstructed.correct(importId, request, actorId))
    ).resolves.toMatchObject({ _tag: "Replayed", review: { version: 1 } });

    await expect(
      Effect.runPromise(
        service.correct(
          importId,
          {
            ...request,
            mutationId: decodeMutationId("different-correction-337"),
          },
          actorId
        )
      )
    ).rejects.toMatchObject({
      _tag: "RecipeReviewVersionConflict",
      actualVersion: 1,
      expectedVersion: 0,
    });

    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT
           (SELECT count(*) FROM recipe_reviews
             WHERE extraction_fingerprint = ?) AS reviews,
           (SELECT count(*) FROM recipe_review_corrections
             WHERE extraction_fingerprint = ?) AS corrections,
           (SELECT count(*) FROM recipe_review_mutations
             WHERE extraction_fingerprint = ?) AS mutations,
           (SELECT version FROM recipe_reviews
             WHERE extraction_fingerprint = ?) AS version`
      )
        .bind(
          draft.extractionFingerprint,
          draft.extractionFingerprint,
          draft.extractionFingerprint,
          draft.extractionFingerprint
        )
        .first()
    ).resolves.toEqual({
      corrections: 1,
      mutations: 1,
      reviews: 1,
      version: 1,
    });

    const ledgerRow = await testEnv.MealPlannerDatabase.prepare(
      `SELECT mutation_id, command_kind, command_digest, resulting_version,
              applied_at
         FROM recipe_review_mutations
        WHERE extraction_fingerprint = ?`
    )
      .bind(draft.extractionFingerprint)
      .first();
    expect(ledgerRow).toEqual({
      applied_at: "2026-07-22T10:30:00.000Z",
      command_digest: expect.stringMatching(/^[a-f\d]{64}$/u),
      command_kind: "correction",
      mutation_id: "correction-retry-337",
      resulting_version: 1,
    });
    expect(JSON.stringify(ledgerRow)).not.toContain(request.correction.reason);
    expect(JSON.stringify(ledgerRow)).not.toContain(request.correction.value);
  });

  it("serializes concurrent duplicate corrections into one applied and one replayed outcome", async () => {
    const importId = decodeImportId("018f47ad-91aa-7c35-b6fe-000000000338");
    const draft = makeDraft(importId, fixtureFingerprint(338));
    await seedDraft(draft, "7520000000000000338");
    let tick = 0;
    const service = makeRecipeReviewService({
      now: () => {
        tick += 1;
        return decodeTimestamp(`2026-07-22T10:4${tick}:00.000Z`);
      },
      repository: makeD1RecipeReviewRepository(testEnv.MealPlannerDatabase),
    });
    const request = Schema.decodeUnknownSync(CorrectRecipeDraftRequest)({
      correction: {
        field: "name",
        reason: "The title is visible in the cited caption frame.",
        value: "Tomato and Onion Stew",
      },
      expectedVersion: 0,
      mutationId: "concurrent-correction-338",
      tags,
    });

    const outcomes = await Promise.all([
      Effect.runPromise(service.correct(importId, request, actorId)),
      Effect.runPromise(service.correct(importId, request, actorId)),
    ]);
    expect(outcomes.map(({ _tag }) => _tag).toSorted()).toEqual([
      "Applied",
      "Replayed",
    ]);
    expect(outcomes.map(({ resultingVersion }) => resultingVersion)).toEqual([
      1, 1,
    ]);
    expect(outcomes.every(({ review }) => review.version === 1)).toBe(true);

    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT
           (SELECT count(*) FROM recipe_review_corrections
             WHERE extraction_fingerprint = ?) AS corrections,
           (SELECT count(*) FROM recipe_review_mutations
             WHERE extraction_fingerprint = ?) AS mutations,
           (SELECT version FROM recipe_reviews
             WHERE extraction_fingerprint = ?) AS version`
      )
        .bind(
          draft.extractionFingerprint,
          draft.extractionFingerprint,
          draft.extractionFingerprint
        )
        .first()
    ).resolves.toEqual({ corrections: 1, mutations: 1, version: 1 });
  });

  it("replays, collides, and serializes transition mutation identities exactly once", async () => {
    const sequentialId = decodeImportId("018f47ad-91aa-7c35-b6fe-000000000339");
    const concurrentId = decodeImportId("018f47ad-91aa-7c35-b6fe-000000000340");
    const sequentialDraft = makeDraft(sequentialId, fixtureFingerprint(339));
    const concurrentDraft = makeDraft(concurrentId, fixtureFingerprint(340));
    await seedDraft(sequentialDraft, "7520000000000000339");
    await seedDraft(concurrentDraft, "7520000000000000340");
    let tick = 0;
    const service = makeRecipeReviewService({
      now: () => {
        tick += 1;
        return decodeTimestamp(`2026-07-22T10:5${tick}:00.000Z`);
      },
      repository: makeD1RecipeReviewRepository(testEnv.MealPlannerDatabase),
    });
    const request = Schema.decodeUnknownSync(TransitionRecipeDraftRequest)({
      expectedVersion: 0,
      mutationId: "transition-retry-339",
      reason: "Insufficient recipe detail.",
    });

    await expect(
      Effect.runPromise(service.reject(sequentialId, request, actorId))
    ).resolves.toMatchObject({
      _tag: "Applied",
      resultingVersion: 1,
      review: { lifecycle: "rejected", version: 1 },
    });
    await expect(
      Effect.runPromise(service.reject(sequentialId, request, actorId))
    ).resolves.toMatchObject({
      _tag: "Replayed",
      resultingVersion: 1,
      review: { lifecycle: "rejected", version: 1 },
    });
    await expect(
      Effect.runPromise(
        service.reject(
          sequentialId,
          Schema.decodeUnknownSync(TransitionRecipeDraftRequest)({
            ...Schema.encodeSync(TransitionRecipeDraftRequest)(request),
            reason: "A different rejection reason.",
          }),
          actorId
        )
      )
    ).rejects.toMatchObject({
      _tag: "RecipeReviewMutationConflict",
      mutationId: decodeMutationId("transition-retry-339"),
    });
    await expect(
      Effect.runPromise(
        service.reject(
          sequentialId,
          {
            ...request,
            mutationId: decodeMutationId("different-transition-339"),
          },
          actorId
        )
      )
    ).rejects.toMatchObject({
      _tag: "RecipeReviewVersionConflict",
      actualVersion: 1,
      expectedVersion: 0,
    });

    const concurrentRequest = Schema.decodeUnknownSync(
      TransitionRecipeDraftRequest
    )({
      expectedVersion: 0,
      mutationId: "concurrent-transition-340",
      reason: "Insufficient recipe detail.",
    });
    const concurrentOutcomes = await Promise.all([
      Effect.runPromise(
        service.reject(concurrentId, concurrentRequest, actorId)
      ),
      Effect.runPromise(
        service.reject(concurrentId, concurrentRequest, actorId)
      ),
    ]);
    expect(concurrentOutcomes.map(({ _tag }) => _tag).toSorted()).toEqual([
      "Applied",
      "Replayed",
    ]);

    await Promise.all(
      [sequentialDraft, concurrentDraft].map((draft) =>
        expect(
          testEnv.MealPlannerDatabase.prepare(
            `SELECT
               (SELECT count(*) FROM recipe_review_transitions
                 WHERE extraction_fingerprint = ?) AS transitions,
               (SELECT count(*) FROM recipe_review_mutations
                 WHERE extraction_fingerprint = ?) AS mutations,
               (SELECT version FROM recipe_reviews
                 WHERE extraction_fingerprint = ?) AS version`
          )
            .bind(
              draft.extractionFingerprint,
              draft.extractionFingerprint,
              draft.extractionFingerprint
            )
            .first()
        ).resolves.toEqual({ mutations: 1, transitions: 1, version: 1 })
      )
    );

    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `SELECT mutation_id, command_kind, command_digest, resulting_version
           FROM recipe_review_mutations
          WHERE extraction_fingerprint = ?`
      )
        .bind(sequentialDraft.extractionFingerprint)
        .first()
    ).resolves.toEqual({
      command_digest: expect.stringMatching(/^[a-f\d]{64}$/u),
      command_kind: "transition",
      mutation_id: "transition-retry-339",
      resulting_version: 1,
    });
  });

  it("audits correction and approval with stale-write rejection and approved-only reads", async () => {
    const approvedId = decodeImportId("018f47ad-91aa-7c35-b6fe-000000000311");
    const rejectedId = decodeImportId("018f47ad-91aa-7c35-b6fe-000000000312");
    const approvedDraft = makeDraft(approvedId, fixtureHash("b"));
    const rejectedDraft = makeDraft(rejectedId, fixtureHash("d"));
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
      now: () => {
        tick += 1;
        return decodeTimestamp(`2026-07-22T10:0${tick}:00.000Z`);
      },
      repository,
    });

    const initial = await Effect.runPromise(service.get(approvedId));
    expect(initial).toMatchObject({
      _tag: "NeedsReview",
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
          {
            expectedVersion: 0,
            mutationId: decodeMutationId("approve-blocked-311"),
            reason: "Ready for the recipe bank.",
          },
          actorId
        )
      )
    ).rejects.toMatchObject({
      _tag: "RecipeApprovalBlocked",
      blockers: { unresolvedRequiredFields: ["name"] },
      tagsRequired: true,
    });

    const correctedOutcome = await Effect.runPromise(
      service.correct(
        approvedId,
        {
          correction: {
            field: "name",
            reason: "The title is visible in the cited caption frame.",
            value: "Tomato and Onion Stew",
          },
          expectedVersion: 0,
          mutationId: decodeMutationId("correction-311"),
          tags,
        },
        actorId
      )
    );
    const corrected = expectAppliedReview(correctedOutcome);
    expect(corrected).toMatchObject({
      _tag: "NeedsReview",
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
            mutationId: decodeMutationId("stale-correction-311"),
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

    const approvedOutcome = await Effect.runPromise(
      service.approve(
        approvedId,
        {
          expectedVersion: 1,
          mutationId: decodeMutationId("approve-311"),
          reason: "Validated and ready for planning.",
        },
        actorId
      )
    );
    const approved = expectAppliedReview(approvedOutcome);
    expect(approved).toMatchObject({
      _tag: "Approved",
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

    const rejectedOutcome = await Effect.runPromise(
      service.reject(
        rejectedId,
        {
          expectedVersion: 0,
          mutationId: decodeMutationId("reject-312"),
          reason: "Insufficient recipe detail.",
        },
        actorId
      )
    );
    const rejected = expectAppliedReview(rejectedOutcome);
    expect(rejected).toMatchObject({
      _tag: "Rejected",
      lifecycle: "rejected",
      version: 1,
    });
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
    const draft = makeDraft(id, fixtureHash("e"));
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
        {
          expectedVersion: 0,
          mutationId: decodeMutationId("reject-313"),
          reason: "Return after evidence review.",
        },
        actorId
      )
    );
    const returnedOutcome = await Effect.runPromise(
      service.returnToReview(
        id,
        {
          expectedVersion: 1,
          mutationId: decodeMutationId("return-313"),
          reason: "Evidence is available for correction.",
        },
        actorId
      )
    );
    const returned = expectAppliedReview(returnedOutcome);
    expect(returned).toMatchObject({
      _tag: "NeedsReview",
      lifecycle: "needs_review",
      version: 2,
    });
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
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `UPDATE recipe_review_mutations
            SET command_digest = ?
          WHERE extraction_fingerprint = ? AND mutation_id = ?`
      )
        .bind("f".repeat(64), draft.extractionFingerprint, "reject-313")
        .run()
    ).rejects.toThrow(/append-only/u);
    await expect(
      testEnv.MealPlannerDatabase.prepare(
        `DELETE FROM recipe_review_mutations
          WHERE extraction_fingerprint = ? AND mutation_id = ?`
      )
        .bind(draft.extractionFingerprint, "return-313")
        .run()
    ).rejects.toThrow(/append-only/u);
  });

  it("classifies an approved current row with rejected terminal history as corruption", async () => {
    const id = decodeImportId("018f47ad-91aa-7c35-b6fe-000000000336");
    const draft = makeDraft(id, fixtureFingerprint(336), true);
    await seedDraft(draft, "7520000000000000336");
    await testEnv.MealPlannerDatabase.prepare(
      `INSERT INTO recipe_reviews (
         extraction_fingerprint, lifecycle, version, tags_json,
         created_at, updated_at
       ) VALUES (?, 'needs_review', 0, ?, ?, ?)`
    )
      .bind(
        draft.extractionFingerprint,
        JSON.stringify(Schema.encodeSync(PlanningTags)(tags)),
        "2026-07-22T10:20:00.000Z",
        "2026-07-22T10:20:00.000Z"
      )
      .run();
    const repository = makeD1RecipeReviewRepository(
      testEnv.MealPlannerDatabase
    );
    let tick = 0;
    const service = makeRecipeReviewService({
      now: () => {
        tick += 1;
        return decodeTimestamp(`2026-07-22T10:2${tick}:00.000Z`);
      },
      repository,
    });

    const approvedOutcome = await Effect.runPromise(
      service.approve(
        id,
        {
          expectedVersion: 0,
          mutationId: decodeMutationId("approve-336"),
          reason: "Ready for planning.",
        },
        actorId
      )
    );
    const approved = expectAppliedReview(approvedOutcome);
    expect(approved).toMatchObject({
      _tag: "Approved",
      transitions: [expect.objectContaining({ to: "approved", version: 1 })],
      version: 1,
    });
    const returnedOutcome = await Effect.runPromise(
      service.returnToReview(
        id,
        {
          expectedVersion: 1,
          mutationId: decodeMutationId("return-336"),
          reason: "Returned for correction.",
        },
        actorId
      )
    );
    const returned = expectAppliedReview(returnedOutcome);
    expect(returned).toMatchObject({
      _tag: "NeedsReview",
      transitions: [
        expect.objectContaining({ to: "approved", version: 1 }),
        expect.objectContaining({ to: "needs_review", version: 2 }),
      ],
      version: 2,
    });
    const rejectedOutcome = await Effect.runPromise(
      service.reject(
        id,
        {
          expectedVersion: 2,
          mutationId: decodeMutationId("reject-336"),
          reason: "Rejected after review.",
        },
        actorId
      )
    );
    const rejected = expectAppliedReview(rejectedOutcome);
    expect(rejected).toMatchObject({
      _tag: "Rejected",
      transitions: [
        expect.objectContaining({ to: "approved", version: 1 }),
        expect.objectContaining({ to: "needs_review", version: 2 }),
        expect.objectContaining({ to: "rejected", version: 3 }),
      ],
      version: 3,
    });

    await testEnv.MealPlannerDatabase.prepare(
      `UPDATE recipe_reviews
          SET lifecycle = 'approved'
        WHERE extraction_fingerprint = ?`
    )
      .bind(draft.extractionFingerprint)
      .run();

    await expect(Effect.runPromise(service.get(id))).rejects.toMatchObject({
      _tag: "ImportPersistenceCorrupt",
    });
    await expect(
      Effect.runPromise(service.listApproved())
    ).rejects.toMatchObject({
      _tag: "ImportPersistenceCorrupt",
    });
  });
});

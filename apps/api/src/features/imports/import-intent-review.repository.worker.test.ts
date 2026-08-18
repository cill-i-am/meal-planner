import {
  AnswerReviewRecipeActionRequest,
  CancelRecipeImportIntentRequest,
  ConfirmRecipeImportActionRequest,
  IdempotencyKey,
  RecipeId,
  RecipeImportActionId,
  RecipeImportIntentId,
} from "@meal-planner/recipe-import-api";
import { applyD1Migrations, env } from "cloudflare:test";
import type { AnyD1Database } from "drizzle-orm/d1";
import { Cause, DateTime, Effect, Exit, Schema } from "effect";
import { beforeAll, describe, expect, it } from "vitest";

import { ImportIntentWorkflowTerminator } from "./import-intent-execution.js";
import { makeRecipeImportIntentReviewApplication } from "./import-intent-review.js";
import { makeD1RecipeImportIntentReviewRepository } from "./import-intent-review.repository.d1.js";
import {
  ImportPrincipal,
  makeImportIntentApplication,
} from "./import-intent.js";
import { AcquisitionGeneration } from "./import-media.model.js";
import { RecipeDraft } from "./import-recipe-draft.repository.d1.js";
import { ImportId } from "./import.contracts.js";
import { makeD1ImportRepository } from "./import.repository.d1.js";
import { TestImportTrace } from "./import.test-fixtures.js";

const testEnv = env as unknown as {
  readonly MealPlannerDatabase: AnyD1Database;
  readonly TEST_MIGRATIONS: {
    readonly name: string;
    readonly queries: string[];
  }[];
};

const principal = Schema.decodeUnknownSync(ImportPrincipal)({
  actorId: "a".repeat(64),
  householdScopeId: "b".repeat(64),
});
const otherPrincipal = Schema.decodeUnknownSync(ImportPrincipal)({
  actorId: "1".repeat(64),
  householdScopeId: "2".repeat(64),
});
const intentId = Schema.decodeUnknownSync(RecipeImportIntentId)(
  "04fd071a-36dc-41b7-a8a6-a1ca4d82d741"
);
const importId = Schema.decodeUnknownSync(ImportId)(intentId);
const actionId = Schema.decodeUnknownSync(RecipeImportActionId)("c".repeat(64));
const extractionFingerprint = "d".repeat(64);
const evidenceFingerprint = "e".repeat(64);
const instant = "2026-08-16T14:00:00.000Z";
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

const draft = Schema.decodeUnknownSync(RecipeDraft)({
  createdAt: instant,
  evidenceFingerprint,
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
    instructions: supportedList(["Chop the onion.", "Simmer for 20 minutes."]),
    name: unresolved("The title was not visible."),
    nutrition: unresolved("Nutrition was not stated."),
    prepTimeMinutes: supportedNumber(10),
    sourceUrl: supportedString(
      "https://www.tiktok.com/@fixture/video/7520000000000000701"
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
  extractionFingerprint,
  extractor: {
    model: "fixture-v1",
    provider: "deterministic_fake",
    version: "schema-1",
  },
  generation: Schema.decodeUnknownSync(AcquisitionGeneration)(1),
  importId,
  lifecycle: "needs_review",
  schemaVersion: 1,
});

const tags = {
  cuisines: ["Irish"],
  dietaryFit: "household_match",
  difficulty: "easy",
  leftovers: "one_meal",
  mealTypes: ["dinner"],
  totalTimeBand: "30_to_60_minutes",
} as const;

const cancelRequest = Schema.decodeUnknownSync(CancelRecipeImportIntentRequest)(
  { expectedIntentVersion: 2 }
);

const failureTag = (exit: Exit.Exit<unknown, unknown>) => {
  expect(Exit.isFailure(exit)).toBe(true);
  if (Exit.isSuccess(exit)) {
    throw new Error("Expected the Effect to fail");
  }
  const error = Cause.findErrorOption(exit.cause);
  expect(error._tag).toBe("Some");
  return error._tag === "Some"
    ? Schema.decodeUnknownOption(Schema.Struct({ _tag: Schema.String }), {
        onExcessProperty: "ignore",
      })(error.value).pipe((decoded) =>
        decoded._tag === "Some" ? decoded.value._tag : undefined
      )
    : undefined;
};

const seedAction = async () => {
  const evidence = [
    {
      kind: "original_media",
      referenceId: `imports/${importId}/acquisition/v1/generations/1/original.mp4`,
    },
    {
      kind: "acquisition_manifest",
      referenceId: `imports/${importId}/acquisition/v1/generations/1/manifest.json`,
    },
    {
      kind: "speech_transcript",
      referenceId: `imports/${importId}/transcription/v1/generations/1/transcript.json`,
    },
  ];
  await testEnv.MealPlannerDatabase.batch([
    testEnv.MealPlannerDatabase.prepare(
      `INSERT INTO recipe_imports (
         id, acquisition_generation, actor_id, correlation_id,
         created_at, evidence_references_json, execution_generation,
         household_scope_id, recovery_action, resolved_canonical_source_id,
         source_kind, status, status_code, submitted_source_url,
         public_source_url, public_source_kind, public_status, public_stage,
         public_stage_started_at, public_activity, updated_at
       ) VALUES (?, 1, ?, ?, ?, ?, 1, ?, NULL, ?, 'tiktok', 'transcribed',
                 NULL, ?, ?, 'video', 'processing', 'preparing_review', ?,
                 'working', ?)`
    ).bind(
      importId,
      principal.actorId,
      TestImportTrace.correlationId,
      instant,
      JSON.stringify(evidence),
      principal.householdScopeId,
      "7520000000000000701",
      "https://www.tiktok.com/t/ZTEST701",
      "https://www.tiktok.com/@fixture/video/7520000000000000701",
      instant,
      instant
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
      extractionFingerprint,
      importId,
      evidenceFingerprint,
      JSON.stringify(Schema.encodeSync(RecipeDraft)(draft)),
      DateTime.formatIso(draft.createdAt),
      DateTime.formatIso(draft.createdAt),
      DateTime.formatIso(draft.createdAt)
    ),
    testEnv.MealPlannerDatabase.prepare(
      `INSERT INTO recipe_reviews (
         extraction_fingerprint, lifecycle, version, tags_json,
         created_at, updated_at
       ) VALUES (?, 'needs_review', 0, NULL, ?, ?)`
    ).bind(extractionFingerprint, instant, instant),
    testEnv.MealPlannerDatabase.prepare(
      `UPDATE recipe_imports
          SET public_status = 'requires_action', public_stage = NULL,
              public_stage_started_at = NULL, public_activity = NULL,
              active_action_id = ?, active_action_version = 1,
              intent_version = intent_version + 1, updated_at = ?
        WHERE id = ?`
    ).bind(actionId, instant, importId),
  ]);
};

interface SeededActionFixture {
  readonly actionId: typeof RecipeImportActionId.Type;
  readonly application: ReturnType<
    typeof makeRecipeImportIntentReviewApplication
  >;
  readonly extractionFingerprint: string;
  readonly importId: typeof ImportId.Type;
  readonly intentId: typeof RecipeImportIntentId.Type;
}

const seedDistinctAction = async (
  ordinal: number,
  options: { readonly confirmable?: boolean } = {}
): Promise<SeededActionFixture> => {
  const suffix = ordinal.toString().padStart(12, "0");
  const fixtureIntentId = Schema.decodeUnknownSync(RecipeImportIntentId)(
    `04fd071a-36dc-41b7-a8a6-${suffix}`
  );
  const fixtureImportId = Schema.decodeUnknownSync(ImportId)(fixtureIntentId);
  const ordinalHex = ordinal.toString(16);
  const fixtureActionId = Schema.decodeUnknownSync(RecipeImportActionId)(
    ordinalHex.padStart(64, "a")
  );
  const fixtureExtractionFingerprint = ordinalHex.padStart(64, "d");
  const fixtureEvidenceFingerprint = ordinalHex.padStart(64, "e");
  const videoId = 7_520_000_000_000_000_000n + BigInt(ordinal);
  const encodedDraft = Schema.encodeSync(RecipeDraft)(draft);
  const fixtureDraft = Schema.decodeUnknownSync(RecipeDraft)({
    ...encodedDraft,
    evidenceFingerprint: fixtureEvidenceFingerprint,
    extraction: {
      ...encodedDraft.extraction,
      name: options.confirmable
        ? supportedString(`Fixture Recipe ${ordinal}`)
        : encodedDraft.extraction.name,
      sourceUrl: supportedString(
        `https://www.tiktok.com/@fixture/video/${videoId}`
      ),
      unresolvedFields: options.confirmable
        ? encodedDraft.extraction.unresolvedFields.filter(
            (field) => field !== "name"
          )
        : encodedDraft.extraction.unresolvedFields,
    },
    extractionFingerprint: fixtureExtractionFingerprint,
    importId: fixtureImportId,
  });
  const evidence = [
    {
      kind: "original_media",
      referenceId: `imports/${fixtureImportId}/acquisition/v1/generations/1/original.mp4`,
    },
    {
      kind: "acquisition_manifest",
      referenceId: `imports/${fixtureImportId}/acquisition/v1/generations/1/manifest.json`,
    },
    {
      kind: "speech_transcript",
      referenceId: `imports/${fixtureImportId}/transcription/v1/generations/1/transcript.json`,
    },
  ];
  await testEnv.MealPlannerDatabase.batch([
    testEnv.MealPlannerDatabase.prepare(
      `INSERT INTO recipe_imports (
         id, acquisition_generation, actor_id, correlation_id,
         created_at, evidence_references_json, execution_generation,
         household_scope_id, recovery_action, resolved_canonical_source_id,
         source_kind, status, status_code, submitted_source_url,
         public_source_url, public_source_kind, public_status, public_stage,
         public_stage_started_at, public_activity, updated_at
       ) VALUES (?, 1, ?, ?, ?, ?, 1, ?, NULL, ?, 'tiktok', 'transcribed',
                 NULL, ?, ?, 'video', 'processing', 'preparing_review', ?,
                 'working', ?)`
    ).bind(
      fixtureImportId,
      principal.actorId,
      TestImportTrace.correlationId,
      instant,
      JSON.stringify(evidence),
      principal.householdScopeId,
      `${videoId}`,
      `https://www.tiktok.com/t/ZTEST${ordinal}`,
      `https://www.tiktok.com/@fixture/video/${videoId}`,
      instant,
      instant
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
      fixtureExtractionFingerprint,
      fixtureImportId,
      fixtureEvidenceFingerprint,
      JSON.stringify(Schema.encodeSync(RecipeDraft)(fixtureDraft)),
      instant,
      instant,
      instant
    ),
    testEnv.MealPlannerDatabase.prepare(
      `INSERT INTO recipe_reviews (
         extraction_fingerprint, lifecycle, version, tags_json,
         created_at, updated_at
       ) VALUES (?, 'needs_review', 0, ?, ?, ?)`
    ).bind(
      fixtureExtractionFingerprint,
      options.confirmable ? JSON.stringify(tags) : null,
      instant,
      instant
    ),
    testEnv.MealPlannerDatabase.prepare(
      `UPDATE recipe_imports
          SET public_status = 'requires_action', public_stage = NULL,
              public_stage_started_at = NULL, public_activity = NULL,
              active_action_id = ?, active_action_version = 1,
              intent_version = intent_version + 1, updated_at = ?
        WHERE id = ?`
    ).bind(fixtureActionId, instant, fixtureImportId),
  ]);
  return {
    actionId: fixtureActionId,
    application: makeRecipeImportIntentReviewApplication(
      makeD1RecipeImportIntentReviewRepository(testEnv.MealPlannerDatabase)
    ),
    extractionFingerprint: fixtureExtractionFingerprint,
    importId: fixtureImportId,
    intentId: fixtureIntentId,
  };
};

const answerRequest = (value: string, expectedActionVersion = 1) =>
  Schema.decodeUnknownSync(AnswerReviewRecipeActionRequest)({
    answers: [{ field: "name", value }],
    expectedActionVersion,
  });

const confirmRequest = (expectedActionVersion = 1) =>
  Schema.decodeUnknownSync(ConfirmRecipeImportActionRequest)({
    expectedActionVersion,
  });

const auditFixture = (fixture: SeededActionFixture) =>
  testEnv.MealPlannerDatabase.prepare(
    `SELECT
       (SELECT public_status FROM recipe_imports WHERE id = ?) AS public_status,
       (SELECT intent_version FROM recipe_imports WHERE id = ?) AS intent_version,
       (SELECT active_action_version FROM recipe_imports WHERE id = ?) AS action_version,
       (SELECT version FROM recipe_reviews WHERE extraction_fingerprint = ?) AS review_version,
       (SELECT count(*) FROM recipe_review_mutations WHERE extraction_fingerprint = ?) AS mutations,
       (SELECT count(*) FROM recipe_import_intent_history WHERE intent_id = ?) AS history,
       (SELECT count(*) FROM recipe_reviews WHERE extraction_fingerprint = ? AND lifecycle = 'approved') AS approved,
       (SELECT count(*) FROM recipe_imports WHERE id = ? AND public_recipe_id = id) AS results`
  )
    .bind(
      fixture.importId,
      fixture.importId,
      fixture.importId,
      fixture.extractionFingerprint,
      fixture.extractionFingerprint,
      fixture.importId,
      fixture.extractionFingerprint,
      fixture.importId
    )
    .first();

beforeAll(async () => {
  await applyD1Migrations(
    testEnv.MealPlannerDatabase,
    [...testEnv.TEST_MIGRATIONS],
    "d1_migrations"
  );
});

describe("recipe import action composite D1 repository", () => {
  it("answers and confirms once across intent, review, and recipe projections", async () => {
    await seedAction();
    const application = makeRecipeImportIntentReviewApplication(
      makeD1RecipeImportIntentReviewRepository(testEnv.MealPlannerDatabase)
    );
    const request = Schema.decodeUnknownSync(AnswerReviewRecipeActionRequest)({
      answers: [
        { field: "name", value: "Tomato and Onion Stew" },
        { field: "tags", value: tags },
      ],
      expectedActionVersion: 1,
    });
    const key = Schema.decodeUnknownSync(IdempotencyKey)("answer-action-701");

    const applied = await Effect.runPromise(
      application.answerAction(principal, intentId, actionId, request, key)
    );
    const replayed = await Effect.runPromise(
      application.answerAction(principal, intentId, actionId, request, key)
    );

    expect(applied).toMatchObject({
      action: { id: actionId },
      id: intentId,
      intentVersion: 3,
      status: "requires_action",
    });
    expect(replayed).toEqual(applied);
    const audit = await testEnv.MealPlannerDatabase.prepare(
      `SELECT
         (SELECT active_action_version FROM recipe_imports WHERE id = ?) AS action_version,
         (SELECT intent_version FROM recipe_imports WHERE id = ?) AS intent_version,
         (SELECT version FROM recipe_reviews WHERE extraction_fingerprint = ?) AS review_version,
         (SELECT count(*) FROM recipe_review_corrections WHERE extraction_fingerprint = ?) AS corrections,
         (SELECT count(*) FROM recipe_review_mutations WHERE extraction_fingerprint = ?) AS mutations,
         (SELECT count(*) FROM recipe_import_intent_history WHERE intent_id = ?) AS history`
    )
      .bind(
        importId,
        importId,
        extractionFingerprint,
        extractionFingerprint,
        extractionFingerprint,
        importId
      )
      .first();
    expect(audit).toEqual({
      action_version: 2,
      corrections: 2,
      history: 3,
      intent_version: 3,
      mutations: 1,
      review_version: 1,
    });

    const action = await Effect.runPromise(
      application.getAction(principal, intentId, actionId)
    );
    expect(action).toMatchObject({
      actionVersion: 2,
      id: actionId,
      review: {
        answers: expect.arrayContaining([
          { field: "name", value: "Tomato and Onion Stew" },
          { field: "tags", value: tags },
        ]),
      },
      status: "active",
    });

    const confirmationRequest = Schema.decodeUnknownSync(
      ConfirmRecipeImportActionRequest
    )({ expectedActionVersion: 2 });
    const confirmKey =
      Schema.decodeUnknownSync(IdempotencyKey)("confirm-action-701");
    const confirmed = await Effect.runPromise(
      application.confirmAction(
        principal,
        intentId,
        actionId,
        confirmationRequest,
        confirmKey
      )
    );
    const confirmReplay = await Effect.runPromise(
      application.confirmAction(
        principal,
        intentId,
        actionId,
        confirmationRequest,
        confirmKey
      )
    );
    expect(confirmed).toMatchObject({
      id: intentId,
      intentVersion: 5,
      result: { recipeId: intentId },
      status: "succeeded",
    });
    expect(confirmReplay).toEqual(confirmed);

    const recipeId = Schema.decodeUnknownSync(RecipeId)(intentId);
    const recipe = await Effect.runPromise(
      application.getRecipe(principal, recipeId)
    );
    expect(recipe).toMatchObject({
      id: recipeId,
      recipe: { name: "Tomato and Onion Stew" },
      tags,
    });
    const completedAction = await Effect.runPromise(
      application.getAction(principal, intentId, actionId)
    );
    expect(completedAction).toMatchObject({
      actionVersion: 2,
      completion: { type: "confirmed" },
      status: "completed",
    });
    const unrelatedActionId = Schema.decodeUnknownSync(RecipeImportActionId)(
      "9".repeat(64)
    );
    const unrelatedAction = await Effect.runPromise(
      Effect.exit(application.getAction(principal, intentId, unrelatedActionId))
    );
    expect(failureTag(unrelatedAction)).toBe("RecipeImportActionNotFound");

    const completedAudit = await testEnv.MealPlannerDatabase.prepare(
      `SELECT
         (SELECT count(*) FROM recipe_review_mutations WHERE extraction_fingerprint = ?) AS mutations,
         (SELECT count(*) FROM recipe_review_transitions WHERE extraction_fingerprint = ?) AS transitions,
         (SELECT version FROM recipe_reviews WHERE extraction_fingerprint = ?) AS review_version,
         (SELECT count(*) FROM recipe_import_intent_history WHERE intent_id = ?) AS history,
         (SELECT public_status FROM recipe_imports WHERE id = ?) AS public_status,
         (SELECT public_recipe_id FROM recipe_imports WHERE id = ?) AS recipe_id`
    )
      .bind(
        extractionFingerprint,
        extractionFingerprint,
        extractionFingerprint,
        importId,
        importId,
        importId
      )
      .first();
    expect(completedAudit).toEqual({
      history: 5,
      mutations: 2,
      public_status: "succeeded",
      recipe_id: importId,
      review_version: 2,
      transitions: 1,
    });
  });

  it("replays one concurrent answer and rejects changed commands for its key", async () => {
    const fixture = await seedDistinctAction(702);
    const request = answerRequest("Concurrent Stew");
    const key = Schema.decodeUnknownSync(IdempotencyKey)("answer-action-702");
    const [left, right] = await Promise.all([
      Effect.runPromise(
        fixture.application.answerAction(
          principal,
          fixture.intentId,
          fixture.actionId,
          request,
          key
        )
      ),
      Effect.runPromise(
        fixture.application.answerAction(
          principal,
          fixture.intentId,
          fixture.actionId,
          request,
          key
        )
      ),
    ]);
    expect(right).toEqual(left);

    const changed = await Effect.runPromise(
      Effect.exit(
        fixture.application.answerAction(
          principal,
          fixture.intentId,
          fixture.actionId,
          answerRequest("Changed Stew"),
          key
        )
      )
    );
    expect(failureTag(changed)).toBe("RecipeImportActionMutationConflict");
    expect(await auditFixture(fixture)).toEqual({
      action_version: 2,
      approved: 0,
      history: 3,
      intent_version: 3,
      mutations: 1,
      public_status: "requires_action",
      results: 0,
      review_version: 1,
    });
  });

  it("allows one distinct-key correction at an expected action version", async () => {
    const fixture = await seedDistinctAction(703);
    const exits = await Promise.all([
      Effect.runPromise(
        Effect.exit(
          fixture.application.answerAction(
            principal,
            fixture.intentId,
            fixture.actionId,
            answerRequest("First Stew"),
            Schema.decodeUnknownSync(IdempotencyKey)("answer-action-703-a")
          )
        )
      ),
      Effect.runPromise(
        Effect.exit(
          fixture.application.answerAction(
            principal,
            fixture.intentId,
            fixture.actionId,
            answerRequest("Second Stew"),
            Schema.decodeUnknownSync(IdempotencyKey)("answer-action-703-b")
          )
        )
      ),
    ]);
    expect(exits.filter((exit) => exit._tag === "Success")).toHaveLength(1);
    const failed = exits.find((exit) => exit._tag === "Failure");
    if (failed === undefined) {
      throw new Error("Expected one stale-version loser");
    }
    expect(failureTag(failed)).toBe("RecipeImportActionVersionConflict");
    expect(await auditFixture(fixture)).toEqual({
      action_version: 2,
      approved: 0,
      history: 3,
      intent_version: 3,
      mutations: 1,
      public_status: "requires_action",
      results: 0,
      review_version: 1,
    });
  });

  it("reads an action after a name-only correction", async () => {
    const fixture = await seedDistinctAction(709);
    await Effect.runPromise(
      fixture.application.answerAction(
        principal,
        fixture.intentId,
        fixture.actionId,
        answerRequest("Browser Fixture Stew"),
        Schema.decodeUnknownSync(IdempotencyKey)("answer-action-709")
      )
    );

    const action = await Effect.runPromise(
      fixture.application.getAction(
        principal,
        fixture.intentId,
        fixture.actionId
      )
    );

    expect(action).toMatchObject({
      actionVersion: 2,
      review: {
        answers: [{ field: "name", value: "Browser Fixture Stew" }],
        recipe: { name: "Browser Fixture Stew" },
      },
      status: "active",
    });
  });

  it("allows one of correction and confirmation at the same action version", async () => {
    const fixture = await seedDistinctAction(704, { confirmable: true });
    const exits = await Promise.all([
      Effect.runPromise(
        Effect.exit(
          fixture.application.answerAction(
            principal,
            fixture.intentId,
            fixture.actionId,
            answerRequest("Corrected Fixture"),
            Schema.decodeUnknownSync(IdempotencyKey)("answer-action-704")
          )
        )
      ),
      Effect.runPromise(
        Effect.exit(
          fixture.application.confirmAction(
            principal,
            fixture.intentId,
            fixture.actionId,
            confirmRequest(),
            Schema.decodeUnknownSync(IdempotencyKey)("confirm-action-704")
          )
        )
      ),
    ]);
    expect(exits.filter((exit) => exit._tag === "Success")).toHaveLength(1);
    const failed = exits.find((exit) => exit._tag === "Failure");
    if (failed === undefined) {
      throw new Error("Expected one action-mutation loser");
    }
    expect([
      "RecipeImportActionTransitionRejected",
      "RecipeImportActionVersionConflict",
    ]).toContain(failureTag(failed));
    const audit = await auditFixture(fixture);
    const expectedAudit =
      audit?.public_status === "succeeded"
        ? {
            action_version: null,
            approved: 1,
            history: 4,
            intent_version: 4,
            mutations: 1,
            public_status: "succeeded",
            results: 1,
            review_version: 1,
          }
        : {
            action_version: 2,
            approved: 0,
            history: 3,
            intent_version: 3,
            mutations: 1,
            public_status: "requires_action",
            results: 0,
            review_version: 1,
          };
    expect(audit).toEqual(expectedAudit);
  });

  it.each([
    { confirmable: false, operation: "answer" as const, ordinal: 705 },
    { confirmable: true, operation: "confirm" as const, ordinal: 706 },
  ])(
    "allows one of $operation and cancellation to own the intent root",
    async ({ confirmable, operation, ordinal }) => {
      const fixture = await seedDistinctAction(ordinal, { confirmable });
      const cancellation = makeImportIntentApplication(
        makeD1ImportRepository(testEnv.MealPlannerDatabase),
        { ensureStarted: () => Effect.succeed("already_active" as const) },
        TestImportTrace
      );
      const terminator = ImportIntentWorkflowTerminator.of({
        terminate: () => Effect.void,
      });
      const actionExit =
        operation === "answer"
          ? Effect.runPromise(
              Effect.exit(
                fixture.application.answerAction(
                  principal,
                  fixture.intentId,
                  fixture.actionId,
                  answerRequest("Cancellation Race Stew"),
                  Schema.decodeUnknownSync(IdempotencyKey)(
                    `answer-action-${ordinal}`
                  )
                )
              )
            )
          : Effect.runPromise(
              Effect.exit(
                fixture.application.confirmAction(
                  principal,
                  fixture.intentId,
                  fixture.actionId,
                  confirmRequest(),
                  Schema.decodeUnknownSync(IdempotencyKey)(
                    `confirm-action-${ordinal}`
                  )
                )
              )
            );
      const exits = await Promise.all([
        actionExit,
        Effect.runPromise(
          Effect.exit(
            cancellation
              .cancel(
                principal,
                fixture.intentId,
                cancelRequest,
                Schema.decodeUnknownSync(IdempotencyKey)(
                  `cancel-action-${ordinal}`
                )
              )
              .pipe(
                Effect.provideService(
                  ImportIntentWorkflowTerminator,
                  terminator
                )
              )
          )
        ),
      ]);
      expect(exits.filter((exit) => exit._tag === "Success")).toHaveLength(1);
      const failed = exits.find((exit) => exit._tag === "Failure");
      if (failed === undefined) {
        throw new Error("Expected one intent-root race loser");
      }
      expect([
        "RecipeImportActionTransitionRejected",
        "RecipeImportActionVersionConflict",
        "RecipeImportIntentVersionConflict",
      ]).toContain(failureTag(failed));
      const audit = await auditFixture(fixture);
      let expectedAudit;
      if (audit?.public_status === "cancelled") {
        expectedAudit = {
          action_version: null,
          approved: 0,
          history: 3,
          intent_version: 3,
          mutations: 0,
          public_status: "cancelled",
          results: 0,
          review_version: 0,
        };
      } else if (operation === "confirm") {
        expectedAudit = {
          action_version: null,
          approved: 1,
          history: 4,
          intent_version: 4,
          mutations: 1,
          public_status: "succeeded",
          results: 1,
          review_version: 1,
        };
      } else {
        expectedAudit = {
          action_version: 2,
          approved: 0,
          history: 3,
          intent_version: 3,
          mutations: 1,
          public_status: "requires_action",
          results: 0,
          review_version: 1,
        };
      }
      expect(audit).toEqual(expectedAudit);
    }
  );

  it("does not reveal or mutate another household's action or recipe", async () => {
    const fixture = await seedDistinctAction(707, { confirmable: true });
    const actionRead = await Effect.runPromise(
      Effect.exit(
        fixture.application.getAction(
          otherPrincipal,
          fixture.intentId,
          fixture.actionId
        )
      )
    );
    expect(failureTag(actionRead)).toBe("RecipeImportActionNotFound");
    const answer = await Effect.runPromise(
      Effect.exit(
        fixture.application.answerAction(
          otherPrincipal,
          fixture.intentId,
          fixture.actionId,
          answerRequest("Leaked Stew"),
          Schema.decodeUnknownSync(IdempotencyKey)("answer-action-707")
        )
      )
    );
    expect(failureTag(answer)).toBe("RecipeImportActionNotFound");

    await Effect.runPromise(
      fixture.application.confirmAction(
        principal,
        fixture.intentId,
        fixture.actionId,
        confirmRequest(),
        Schema.decodeUnknownSync(IdempotencyKey)("confirm-action-707")
      )
    );
    const foreignRecipe = await Effect.runPromise(
      Effect.exit(
        fixture.application.getRecipe(
          otherPrincipal,
          Schema.decodeUnknownSync(RecipeId)(fixture.intentId)
        )
      )
    );
    expect(failureTag(foreignRecipe)).toBe("RecipeImportRecipeNotFound");
  });

  it("types an owned corrupt succeeded projection as persistence corruption", async () => {
    const fixture = await seedDistinctAction(708, { confirmable: true });
    await Effect.runPromise(
      fixture.application.confirmAction(
        principal,
        fixture.intentId,
        fixture.actionId,
        confirmRequest(),
        Schema.decodeUnknownSync(IdempotencyKey)("confirm-action-708")
      )
    );
    await testEnv.MealPlannerDatabase.prepare(
      `UPDATE recipe_reviews SET lifecycle = 'rejected'
        WHERE extraction_fingerprint = ?`
    )
      .bind(fixture.extractionFingerprint)
      .run();
    const recipe = await Effect.runPromise(
      Effect.exit(
        fixture.application.getRecipe(
          principal,
          Schema.decodeUnknownSync(RecipeId)(fixture.intentId)
        )
      )
    );
    expect(failureTag(recipe)).toBe("ImportPersistenceCorrupt");
  });
});

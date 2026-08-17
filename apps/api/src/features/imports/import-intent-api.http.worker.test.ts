import {
  AnswerReviewRecipeActionRequest,
  ConfirmRecipeImportActionRequest,
  CreateRecipeImportIntentRequest,
  IdempotencyKey,
  RecipeImportActionId,
  makeRecipeImportApiClientLayer,
  RecipeImportApiClient,
} from "@meal-planner/recipe-import-api";
import { applyD1Migrations, env } from "cloudflare:test";
import type { AnyD1Database } from "drizzle-orm/d1";
import { Cause, Effect, Exit, Layer, Redacted, Schema } from "effect";
import {
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
  HttpRouter,
} from "effect/unstable/http";
import { beforeAll, describe, expect, it } from "vitest";

import {
  RecipeImportIntentApplication,
  makeRecipeImportHttpApiLayer,
} from "./import-intent-api.http.js";
import { ImportIntentWorkflowTerminator } from "./import-intent-execution.js";
import {
  RecipeImportIntentReviewApplication,
  makeRecipeImportIntentReviewApplication,
} from "./import-intent-review.js";
import { makeD1RecipeImportIntentReviewRepository } from "./import-intent-review.repository.d1.js";
import {
  ImportIntentIdGenerator,
  ImportPrincipal,
  makeImportIntentApplication,
} from "./import-intent.js";
import { AcquisitionGeneration } from "./import-media.model.js";
import { RecipeDraft } from "./import-recipe-draft.repository.d1.js";
import { ImportAuthorizer, makeImportAuthorizer } from "./import.auth.js";
import { ImportId, SourceCanonicalId } from "./import.contracts.js";
import { makeD1ImportRepository } from "./import.repository.d1.js";
import {
  TestImportPrincipal,
  TestImportTrace,
} from "./import.test-fixtures.js";
import {
  CanonicalSourceIdentityResolver,
  ValidatedVideoUrl,
} from "./source-identity.js";

const testEnv = env as unknown as {
  readonly MealPlannerDatabase: AnyD1Database;
  readonly TEST_MIGRATIONS: {
    readonly name: string;
    readonly queries: string[];
  }[];
};

const bearerToken = "http-worker-private-bearer";
const submittedUrl =
  "https://www.tiktok.com/t/http-worker-private-url?share_app_id=private";
const canonicalUrl =
  "https://www.tiktok.com/@fixture/video/7520000000000000901";
const canonicalSourceId = "7520000000000000901";
const cancellationSubmittedUrl =
  "https://www.tiktok.com/t/http-worker-private-cancellation";
const cancellationCanonicalUrl =
  "https://www.tiktok.com/@fixture/video/7520000000000000902";
const cancellationCanonicalSourceId = "7520000000000000902";
const privateProvider = "http-worker-private-provider";
const privateModel = "http-worker-private-model";
const privateTranscript = "http-worker-private-transcript";
const extractionFingerprint = "d".repeat(64);
const evidenceFingerprint = "e".repeat(64);
const actionId = Schema.decodeUnknownSync(RecipeImportActionId)("c".repeat(64));
const secondActionId = Schema.decodeUnknownSync(RecipeImportActionId)(
  "f".repeat(64)
);
const foreignHouseholdScopeId = "9".repeat(64);
const secondBearerToken = "http-worker-second-private-bearer";
const secondActorId = "8".repeat(64);
const secondExtractionFingerprint = "6".repeat(64);
const secondEvidenceFingerprint = "7".repeat(64);
const instant = "2026-08-16T18:00:00.000Z";

interface ReviewFixture {
  readonly actionId: typeof RecipeImportActionId.Type;
  readonly evidenceFingerprint: string;
  readonly extractionFingerprint: string;
}

const firstReviewFixture: ReviewFixture = {
  actionId,
  evidenceFingerprint,
  extractionFingerprint,
};
const secondReviewFixture: ReviewFixture = {
  actionId: secondActionId,
  evidenceFingerprint: secondEvidenceFingerprint,
  extractionFingerprint: secondExtractionFingerprint,
};

const citation = {
  citations: [
    {
      confidence: 1,
      evidenceId: privateTranscript,
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
const reviewTags = {
  cuisines: ["Irish"],
  dietaryFit: "household_match",
  difficulty: "easy",
  leftovers: "one_meal",
  mealTypes: ["dinner"],
  totalTimeBand: "30_to_60_minutes",
} as const;
const privateR2References = (intentId: string) => [
  `imports/${intentId}/acquisition/v1/generations/1/original.mp4`,
  `imports/${intentId}/acquisition/v1/generations/1/manifest.json`,
  `imports/${intentId}/transcription/v1/generations/1/transcript.json`,
];

const makeDraft = (importId: typeof ImportId.Type, fixture: ReviewFixture) =>
  Schema.decodeUnknownSync(RecipeDraft)({
    createdAt: instant,
    evidenceFingerprint: fixture.evidenceFingerprint,
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
      description: supportedString("A deterministic HTTP fixture."),
      ingredientLines: supportedList(["1 onion", "2 tomatoes"]),
      instructions: supportedList([
        "Chop the onion.",
        "Simmer for 20 minutes.",
      ]),
      name: unresolved("The title was not visible."),
      nutrition: unresolved("Nutrition was not stated."),
      prepTimeMinutes: supportedNumber(10),
      sourceUrl: supportedString(canonicalUrl),
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
    extractionFingerprint: fixture.extractionFingerprint,
    extractor: {
      model: privateModel,
      provider: privateProvider,
      version: "schema-1",
    },
    generation: Schema.decodeUnknownSync(AcquisitionGeneration)(1),
    importId,
    lifecycle: "needs_review",
    schemaVersion: 1,
  });

const seedRequiresAction = async (
  database: AnyD1Database,
  intentId: string,
  fixture: ReviewFixture
) => {
  const importId = Schema.decodeUnknownSync(ImportId)(intentId);
  const encodedDraft = Schema.encodeSync(RecipeDraft)(
    makeDraft(importId, fixture)
  );
  const [originalMedia, manifest, transcript] = privateR2References(importId);
  const evidence = [
    { kind: "original_media", referenceId: originalMedia },
    { kind: "acquisition_manifest", referenceId: manifest },
    { kind: "speech_transcript", referenceId: transcript },
  ];
  await database.batch([
    database
      .prepare(
        `UPDATE recipe_imports
            SET acquisition_generation = 1,
                evidence_references_json = ?,
                source_kind = 'tiktok', status = 'transcribed',
                status_code = NULL, public_status = 'requires_action',
                public_stage = NULL, public_stage_started_at = NULL,
                public_activity = NULL, active_action_id = ?,
                active_action_version = 1,
                intent_version = intent_version + 1, updated_at = ?
          WHERE id = ?`
      )
      .bind(JSON.stringify(evidence), fixture.actionId, instant, importId),
    database
      .prepare(
        `INSERT INTO import_recipe_extractions (
           extraction_fingerprint, import_id, acquisition_generation,
           evidence_fingerprint, extractor_provider, extractor_model,
           extractor_version, state, draft_json, failure_code,
           input_evidence_items, input_tokens, output_tokens, model_calls,
           latency_milliseconds, estimated_cost_micro_usd, cost_currency,
           cost_certainty, is_current, created_at, updated_at, completed_at
         ) VALUES (?, ?, 1, ?, ?, ?, 'schema-1', 'needs_review', ?, NULL,
                   1, 0, 0, 1, 0, 0, 'USD', 'known', 1, ?, ?, ?)`
      )
      .bind(
        fixture.extractionFingerprint,
        importId,
        fixture.evidenceFingerprint,
        privateProvider,
        privateModel,
        JSON.stringify(encodedDraft),
        instant,
        instant,
        instant
      ),
    database
      .prepare(
        `INSERT INTO recipe_reviews (
           extraction_fingerprint, lifecycle, version, tags_json,
           created_at, updated_at
         ) VALUES (?, 'needs_review', 0, NULL, ?, ?)`
      )
      .bind(fixture.extractionFingerprint, instant, instant),
  ]);
};

const failureValue = (exit: Exit.Exit<unknown, unknown>) => {
  expect(Exit.isFailure(exit)).toBe(true);
  if (Exit.isSuccess(exit)) {
    throw new Error("Expected the request to fail");
  }
  const error = Cause.findErrorOption(exit.cause);
  expect(error._tag).toBe("Some");
  return error._tag === "Some" ? error.value : undefined;
};

const auditConfirmation = (
  database: AnyD1Database,
  intentId: string,
  fixtureExtractionFingerprint = extractionFingerprint
) =>
  database
    .prepare(
      `SELECT
         (SELECT count(*) FROM recipe_review_corrections WHERE extraction_fingerprint = ?) AS corrections,
         (SELECT count(*) FROM recipe_review_mutations WHERE extraction_fingerprint = ?) AS mutations,
         (SELECT count(*) FROM recipe_review_transitions WHERE extraction_fingerprint = ?) AS transitions,
         (SELECT count(*) FROM recipe_import_intent_history WHERE intent_id = ?) AS history,
         (SELECT version FROM recipe_reviews WHERE extraction_fingerprint = ?) AS review_version,
         (SELECT public_status FROM recipe_imports WHERE id = ?) AS public_status,
         (SELECT public_recipe_id FROM recipe_imports WHERE id = ?) AS recipe_id`
    )
    .bind(
      fixtureExtractionFingerprint,
      fixtureExtractionFingerprint,
      fixtureExtractionFingerprint,
      intentId,
      fixtureExtractionFingerprint,
      intentId,
      intentId
    )
    .first();

const assertNoPrivateTransport = (
  value: unknown,
  additionalSentinels: readonly string[] = []
): void => {
  const sentinels = [
    submittedUrl,
    cancellationSubmittedUrl,
    bearerToken,
    secondBearerToken,
    privateProvider,
    privateModel,
    privateTranscript,
    evidenceFingerprint,
    extractionFingerprint,
    TestImportPrincipal.actorId,
    TestImportPrincipal.householdScopeId,
    secondActorId,
    foreignHouseholdScopeId,
    ...additionalSentinels,
  ];
  if (typeof value === "string") {
    for (const sentinel of sentinels) {
      expect(value).not.toContain(sentinel);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      assertNoPrivateTransport(item, additionalSentinels);
    }
    return;
  }
  if (typeof value === "object" && value !== null) {
    for (const [key, child] of Object.entries(value)) {
      assertNoPrivateTransport(key, additionalSentinels);
      assertNoPrivateTransport(child, additionalSentinels);
    }
  }
};

beforeAll(async () => {
  await applyD1Migrations(
    testEnv.MealPlannerDatabase,
    [...testEnv.TEST_MIGRATIONS],
    "d1_migrations"
  );
});

describe("recipe import intent HTTP API with real D1", () => {
  it("isolates two configured households through one Worker and one D1 database", async () => {
    const app: {
      current?: ReturnType<typeof HttpRouter.toWebHandler>;
    } = {};
    const program = Effect.gen(function* realD1HttpScenario() {
      const database = testEnv.MealPlannerDatabase;
      const started: string[] = [];
      const activeWorkflowIds = new Set<string>();
      const terminated: string[] = [];
      const secondPrincipal = Schema.decodeUnknownSync(ImportPrincipal)({
        actorId: secondActorId,
        householdScopeId: foreignHouseholdScopeId,
      });
      const authorizer = yield* makeImportAuthorizer({
        configuredPrincipals: [
          {
            principal: TestImportPrincipal,
            token: Redacted.make(bearerToken),
          },
          {
            principal: secondPrincipal,
            token: Redacted.make(secondBearerToken),
          },
        ],
      });
      const intentApplication = makeImportIntentApplication(
        makeD1ImportRepository(database),
        {
          ensureStarted: (intentId) =>
            Effect.sync(() => {
              if (activeWorkflowIds.has(intentId)) {
                return "already_active" as const;
              }
              activeWorkflowIds.add(intentId);
              started.push(intentId);
              return "created" as const;
            }),
        },
        TestImportTrace
      );
      const reviewApplication = makeRecipeImportIntentReviewApplication(
        makeD1RecipeImportIntentReviewRepository(database)
      );
      const services = Layer.mergeAll(
        ImportIntentIdGenerator.live,
        Layer.succeed(ImportAuthorizer, ImportAuthorizer.of(authorizer)),
        Layer.succeed(
          RecipeImportIntentApplication,
          RecipeImportIntentApplication.of(intentApplication)
        ),
        Layer.succeed(
          RecipeImportIntentReviewApplication,
          RecipeImportIntentReviewApplication.of(reviewApplication)
        ),
        Layer.succeed(
          ImportIntentWorkflowTerminator,
          ImportIntentWorkflowTerminator.of({
            terminate: (intentId) =>
              Effect.sync(() => {
                terminated.push(intentId);
              }),
          })
        ),
        Layer.succeed(
          CanonicalSourceIdentityResolver,
          CanonicalSourceIdentityResolver.of({
            resolve: (source) =>
              Effect.succeed({
                _tag: "VideoIdentity" as const,
                identity: {
                  canonicalId: Schema.decodeUnknownSync(SourceCanonicalId)(
                    source.url === cancellationSubmittedUrl
                      ? cancellationCanonicalSourceId
                      : canonicalSourceId
                  ),
                  kind: "tiktok" as const,
                },
                videoUrl: Schema.decodeUnknownSync(ValidatedVideoUrl)(
                  source.url === cancellationSubmittedUrl
                    ? cancellationCanonicalUrl
                    : canonicalUrl
                ),
              }),
          })
        )
      );
      const mounted = HttpRouter.toWebHandler(
        makeRecipeImportHttpApiLayer().pipe(
          Layer.provide(services),
          HttpRouter.provideRequest(services)
        ),
        { disableLogger: true }
      );
      app.current = mounted;
      const webHttpClient = HttpClient.make((request, _url, signal) =>
        HttpClientRequest.toWeb(request, { signal }).pipe(
          Effect.orDie,
          Effect.flatMap((webRequest) =>
            Effect.promise(() => mounted.handler(webRequest))
          ),
          Effect.map((response) =>
            HttpClientResponse.fromWeb(request, response)
          )
        )
      );
      const makeClientLayer = (token: string) =>
        makeRecipeImportApiClientLayer({
          baseUrl: "http://meal-planner.test",
          token: Redacted.make(token),
        }).pipe(
          Layer.provide(Layer.succeed(HttpClient.HttpClient, webHttpClient))
        );
      const firstClientLayer = makeClientLayer(bearerToken);
      const secondClientLayer = makeClientLayer(secondBearerToken);
      const request = Schema.decodeUnknownSync(CreateRecipeImportIntentRequest)(
        {
          source: { kind: "tiktok", url: submittedUrl },
        }
      );
      const changedRequest = Schema.decodeUnknownSync(
        CreateRecipeImportIntentRequest
      )({
        source: {
          kind: "tiktok",
          url: "https://www.tiktok.com/t/http-worker-changed-command",
        },
      });
      const cancellationRequest = Schema.decodeUnknownSync(
        CreateRecipeImportIntentRequest
      )({
        source: { kind: "tiktok", url: cancellationSubmittedUrl },
      });
      const idempotencyKey = Schema.decodeUnknownSync(IdempotencyKey);

      const results = yield* Effect.gen(function* generatedClientScenario() {
        const client = yield* RecipeImportApiClient;
        const created = yield* client.recipeImportIntents.create({
          headers: {
            "idempotency-key": idempotencyKey("http-worker-admission"),
          },
          payload: request,
        });
        let continued = yield* client.recipeImportIntents.get({
          params: { id: created.body.id },
        });
        for (
          let attempt = 0;
          attempt < 20 &&
          continued.body.status === "processing" &&
          continued.body.processing.type === "resolving_source";
          attempt += 1
        ) {
          yield* Effect.sleep("1 millis");
          continued = yield* client.recipeImportIntents.get({
            params: { id: created.body.id },
          });
        }
        const replayed = yield* client.recipeImportIntents.create({
          headers: {
            "idempotency-key": idempotencyKey("http-worker-admission"),
          },
          payload: request,
        });
        const redirected = yield* client.recipeImportIntents.create({
          headers: {
            "idempotency-key": idempotencyKey(
              "http-worker-same-household-duplicate"
            ),
          },
          payload: request,
        });
        let redirectedIntent = yield* client.recipeImportIntents.get({
          params: { id: redirected.body.id },
        });
        for (
          let attempt = 0;
          attempt < 20 &&
          redirectedIntent.body.status === "processing" &&
          redirectedIntent.body.processing.type === "resolving_source";
          attempt += 1
        ) {
          yield* Effect.sleep("1 millis");
          redirectedIntent = yield* client.recipeImportIntents.get({
            params: { id: redirected.body.id },
          });
        }
        const conflictExit = yield* Effect.exit(
          client.recipeImportIntents.create({
            headers: {
              "idempotency-key": idempotencyKey("http-worker-admission"),
            },
            payload: changedRequest,
          })
        );
        const conflict = failureValue(conflictExit);

        yield* Effect.promise(() =>
          seedRequiresAction(database, created.body.id, firstReviewFixture)
        );
        const requiresAction = yield* client.recipeImportIntents.get({
          params: { id: created.body.id },
        });
        const activeAction = yield* client.recipeImportIntents.getAction({
          params: { actionId, id: created.body.id },
        });
        const answerRequest = Schema.decodeUnknownSync(
          AnswerReviewRecipeActionRequest
        )({
          answers: [
            { field: "name", value: "Tomato and Onion Stew" },
            { field: "tags", value: reviewTags },
          ],
          expectedActionVersion: 1,
        });
        const answered = yield* client.recipeImportIntents.answerAction({
          headers: {
            "idempotency-key": idempotencyKey("http-worker-answer"),
          },
          params: { actionId, id: created.body.id },
          payload: answerRequest,
        });
        const confirmRequest = Schema.decodeUnknownSync(
          ConfirmRecipeImportActionRequest
        )({ expectedActionVersion: 2 });
        const confirmed = yield* client.recipeImportIntents.confirmAction({
          headers: {
            "idempotency-key": idempotencyKey("http-worker-confirm"),
          },
          params: { actionId, id: created.body.id },
          payload: confirmRequest,
        });
        const afterConfirm = yield* Effect.promise(() =>
          auditConfirmation(database, created.body.id)
        );
        const confirmReplay = yield* client.recipeImportIntents.confirmAction({
          headers: {
            "idempotency-key": idempotencyKey("http-worker-confirm"),
          },
          params: { actionId, id: created.body.id },
          payload: confirmRequest,
        });
        const afterReplay = yield* Effect.promise(() =>
          auditConfirmation(database, created.body.id)
        );
        const completedAction = yield* client.recipeImportIntents.getAction({
          params: { actionId, id: created.body.id },
        });
        const recipe = yield* client.recipes.get({
          params: { recipeId: confirmed.result.recipeId },
        });

        return {
          activeAction,
          afterConfirm,
          afterReplay,
          answered,
          completedAction,
          confirmReplay,
          confirmed,
          conflict,
          continued,
          created,
          recipe,
          redirected,
          redirectedIntent,
          replayed,
          requiresAction,
        };
      }).pipe(Effect.provide(firstClientLayer));

      const secondResults = yield* Effect.gen(
        function* secondGeneratedClientScenario() {
          const client = yield* RecipeImportApiClient;
          const created = yield* client.recipeImportIntents.create({
            headers: {
              "idempotency-key": idempotencyKey(
                "http-worker-second-household-admission"
              ),
            },
            payload: request,
          });
          let continued = yield* client.recipeImportIntents.get({
            params: { id: created.body.id },
          });
          for (
            let attempt = 0;
            attempt < 20 &&
            continued.body.status === "processing" &&
            continued.body.processing.type === "resolving_source";
            attempt += 1
          ) {
            yield* Effect.sleep("1 millis");
            continued = yield* client.recipeImportIntents.get({
              params: { id: created.body.id },
            });
          }

          yield* Effect.promise(() =>
            seedRequiresAction(database, created.body.id, secondReviewFixture)
          );
          const requiresAction = yield* client.recipeImportIntents.get({
            params: { id: created.body.id },
          });
          const activeAction = yield* client.recipeImportIntents.getAction({
            params: { actionId: secondActionId, id: created.body.id },
          });
          const answered = yield* client.recipeImportIntents.answerAction({
            headers: {
              "idempotency-key": idempotencyKey(
                "http-worker-second-household-answer"
              ),
            },
            params: { actionId: secondActionId, id: created.body.id },
            payload: Schema.decodeUnknownSync(AnswerReviewRecipeActionRequest)({
              answers: [
                { field: "name", value: "Second Household Stew" },
                { field: "tags", value: reviewTags },
              ],
              expectedActionVersion: 1,
            }),
          });
          const confirmRequest = Schema.decodeUnknownSync(
            ConfirmRecipeImportActionRequest
          )({ expectedActionVersion: 2 });
          const confirmed = yield* client.recipeImportIntents.confirmAction({
            headers: {
              "idempotency-key": idempotencyKey(
                "http-worker-second-household-confirm"
              ),
            },
            params: { actionId: secondActionId, id: created.body.id },
            payload: confirmRequest,
          });
          const afterConfirm = yield* Effect.promise(() =>
            auditConfirmation(
              database,
              created.body.id,
              secondExtractionFingerprint
            )
          );
          const completedAction = yield* client.recipeImportIntents.getAction({
            params: { actionId: secondActionId, id: created.body.id },
          });
          const recipe = yield* client.recipes.get({
            params: { recipeId: confirmed.result.recipeId },
          });
          const timeline = yield* client.recipeImportIntents.timeline({
            params: { id: created.body.id },
          });
          const firstIntentRead = failureValue(
            yield* Effect.exit(
              client.recipeImportIntents.get({
                params: { id: results.created.body.id },
              })
            )
          );
          const firstActionRead = failureValue(
            yield* Effect.exit(
              client.recipeImportIntents.getAction({
                params: { actionId, id: results.created.body.id },
              })
            )
          );
          const firstRecipeRead = failureValue(
            yield* Effect.exit(
              client.recipes.get({
                params: { recipeId: results.confirmed.result.recipeId },
              })
            )
          );
          const firstAnswerMutation = failureValue(
            yield* Effect.exit(
              client.recipeImportIntents.answerAction({
                headers: {
                  "idempotency-key": idempotencyKey(
                    "http-worker-cross-household-answer"
                  ),
                },
                params: { actionId, id: results.created.body.id },
                payload: Schema.decodeUnknownSync(
                  AnswerReviewRecipeActionRequest
                )({
                  answers: [{ field: "name", value: "Hidden mutation" }],
                  expectedActionVersion: 2,
                }),
              })
            )
          );
          const firstConfirmMutation = failureValue(
            yield* Effect.exit(
              client.recipeImportIntents.confirmAction({
                headers: {
                  "idempotency-key": idempotencyKey(
                    "http-worker-cross-household-confirm"
                  ),
                },
                params: { actionId, id: results.created.body.id },
                payload: Schema.decodeUnknownSync(
                  ConfirmRecipeImportActionRequest
                )({ expectedActionVersion: 2 }),
              })
            )
          );
          const firstCancelMutation = failureValue(
            yield* Effect.exit(
              client.recipeImportIntents.cancel({
                headers: {
                  "idempotency-key": idempotencyKey(
                    "http-worker-cross-household-cancel"
                  ),
                },
                params: { id: results.created.body.id },
                payload: {
                  expectedIntentVersion: results.confirmed.intentVersion,
                },
              })
            )
          );
          const cancellationCreated = yield* client.recipeImportIntents.create({
            headers: {
              "idempotency-key": idempotencyKey(
                "http-worker-second-household-cancellation-admission"
              ),
            },
            payload: cancellationRequest,
          });
          const cancellable = yield* client.recipeImportIntents.get({
            params: { id: cancellationCreated.body.id },
          });
          if (cancellable.body.status !== "processing") {
            return yield* Effect.die(
              "The provider-free cancellation fixture must remain mutable"
            );
          }
          const cancelled = yield* client.recipeImportIntents.cancel({
            headers: {
              "idempotency-key": idempotencyKey(
                "http-worker-second-household-cancel"
              ),
            },
            params: { id: cancellable.body.id },
            payload: {
              expectedIntentVersion: cancellable.body.intentVersion,
            },
          });
          const cancellationTimeline =
            yield* client.recipeImportIntents.timeline({
              params: { id: cancellationCreated.body.id },
            });
          const succeededAfterCancellation =
            yield* client.recipeImportIntents.get({
              params: { id: created.body.id },
            });

          return {
            activeAction,
            afterConfirm,
            answered,
            cancellable,
            cancellationCreated,
            cancellationTimeline,
            cancelled,
            completedAction,
            confirmed,
            continued,
            created,
            firstActionRead,
            firstAnswerMutation,
            firstCancelMutation,
            firstConfirmMutation,
            firstIntentRead,
            firstRecipeRead,
            recipe,
            requiresAction,
            succeededAfterCancellation,
            timeline,
          };
        }
      ).pipe(Effect.provide(secondClientLayer));
      const firstHouseholdCancellationRead = yield* Effect.gen(
        function* firstHouseholdCancellationIsolation() {
          const client = yield* RecipeImportApiClient;
          return failureValue(
            yield* Effect.exit(
              client.recipeImportIntents.get({
                params: { id: secondResults.cancellationCreated.body.id },
              })
            )
          );
        }
      ).pipe(Effect.provide(firstClientLayer));

      expect(results.created.body).toMatchObject({ status: "processing" });
      expect(results.created.body).toMatchObject({
        processing: { type: "resolving_source" },
        source: { resolution: "pending" },
      });
      expect(results.continued.body).toMatchObject({
        processing: { sourceKind: "video", type: "acquiring_media" },
        source: { canonicalUrl, resolution: "resolved" },
        status: "processing",
      });
      expect(results.created.headers.location).toContain(
        results.created.body.id
      );
      expect(results.replayed).toEqual(results.created);
      expect(results.redirectedIntent.body).toMatchObject({
        redirect: { intentId: results.created.body.id },
        status: "redirected",
      });
      expect(results.redirected.body.id).not.toBe(results.created.body.id);
      expect(results.conflict).toMatchObject({
        code: "idempotency_conflict",
        status: 409,
      });
      expect(results.requiresAction.body).toMatchObject({
        source: { canonicalUrl, resolution: "resolved" },
        status: "requires_action",
      });
      expect(results.activeAction).toMatchObject({
        actionVersion: 1,
        id: actionId,
        status: "active",
      });
      expect(results.answered).toMatchObject({
        action: { id: actionId },
        intentVersion: 4,
        status: "requires_action",
      });
      expect(results.confirmed).toMatchObject({
        id: results.created.body.id,
        intentVersion: 6,
        result: { recipeId: results.created.body.id },
        status: "succeeded",
      });
      expect(results.confirmReplay).toEqual(results.confirmed);
      expect(results.afterReplay).toEqual(results.afterConfirm);
      expect(results.afterConfirm).toEqual({
        corrections: 2,
        history: 6,
        mutations: 2,
        public_status: "succeeded",
        recipe_id: results.created.body.id,
        review_version: 2,
        transitions: 1,
      });
      expect(results.completedAction).toMatchObject({
        actionVersion: 2,
        completion: { type: "confirmed" },
        id: actionId,
        status: "completed",
      });
      expect(results.recipe).toMatchObject({
        id: results.created.body.id,
        recipe: { name: "Tomato and Onion Stew" },
        tags: reviewTags,
      });
      expect(secondResults.created.body.id).not.toBe(results.created.body.id);
      expect(secondResults.created.body).toMatchObject({
        source: { resolution: "pending" },
        status: "processing",
      });
      expect(secondResults.continued.body).toMatchObject({
        processing: { sourceKind: "video", type: "acquiring_media" },
        source: { canonicalUrl, resolution: "resolved" },
        status: "processing",
      });
      expect(secondResults.requiresAction.body).toMatchObject({
        source: { canonicalUrl, resolution: "resolved" },
        status: "requires_action",
      });
      expect(secondResults.activeAction).toMatchObject({
        actionVersion: 1,
        id: secondActionId,
        status: "active",
      });
      expect(secondResults.answered).toMatchObject({
        action: { id: secondActionId },
        status: "requires_action",
      });
      expect(secondResults.confirmed).toMatchObject({
        id: secondResults.created.body.id,
        result: { recipeId: secondResults.created.body.id },
        status: "succeeded",
      });
      expect(secondResults.completedAction).toMatchObject({
        completion: { type: "confirmed" },
        id: secondActionId,
        status: "completed",
      });
      expect(secondResults.recipe).toMatchObject({
        id: secondResults.created.body.id,
        recipe: { name: "Second Household Stew" },
        tags: reviewTags,
      });
      expect(secondResults.afterConfirm).toEqual({
        corrections: 2,
        history: 6,
        mutations: 2,
        public_status: "succeeded",
        recipe_id: secondResults.created.body.id,
        review_version: 2,
        transitions: 1,
      });
      expect(secondResults.timeline.data.at(-1)).toMatchObject({
        recipeId: secondResults.created.body.id,
        type: "intent_succeeded",
      });
      expect(secondResults.firstIntentRead).toMatchObject({
        code: "intent_not_found",
        status: 404,
      });
      expect(secondResults.firstActionRead).toMatchObject({
        code: "action_not_found",
        status: 404,
      });
      expect(secondResults.firstRecipeRead).toMatchObject({
        code: "recipe_not_found",
        status: 404,
      });
      expect(secondResults.firstAnswerMutation).toMatchObject({
        code: "action_not_found",
        status: 404,
      });
      expect(secondResults.firstConfirmMutation).toMatchObject({
        code: "action_not_found",
        status: 404,
      });
      expect(secondResults.firstCancelMutation).toMatchObject({
        code: "intent_not_found",
        status: 404,
      });
      expect(secondResults.cancellable.body).toMatchObject({
        source: { resolution: "pending" },
        status: "processing",
      });
      expect(secondResults.cancelled).toMatchObject({
        id: secondResults.cancellationCreated.body.id,
        status: "cancelled",
      });
      expect(secondResults.cancellationTimeline.data.at(-1)).toMatchObject({
        type: "intent_cancelled",
      });
      expect(secondResults.succeededAfterCancellation.body).toEqual(
        secondResults.confirmed
      );
      expect(firstHouseholdCancellationRead).toMatchObject({
        code: "intent_not_found",
        status: 404,
      });
      const publicPayloads = [
        results.created,
        results.continued,
        results.replayed,
        results.redirected,
        results.redirectedIntent,
        results.conflict,
        results.requiresAction,
        results.activeAction,
        results.answered,
        results.confirmed,
        results.confirmReplay,
        results.completedAction,
        results.recipe,
        secondResults.created,
        secondResults.continued,
        secondResults.requiresAction,
        secondResults.activeAction,
        secondResults.answered,
        secondResults.confirmed,
        secondResults.completedAction,
        secondResults.recipe,
        secondResults.timeline,
        secondResults.firstIntentRead,
        secondResults.firstActionRead,
        secondResults.firstRecipeRead,
        secondResults.firstAnswerMutation,
        secondResults.firstConfirmMutation,
        secondResults.firstCancelMutation,
        secondResults.cancellationCreated,
        secondResults.cancellable,
        secondResults.cancelled,
        secondResults.cancellationTimeline,
        secondResults.succeededAfterCancellation,
        firstHouseholdCancellationRead,
      ];
      for (const payload of publicPayloads) {
        assertNoPrivateTransport(payload, [
          ...privateR2References(results.created.body.id),
          ...privateR2References(secondResults.created.body.id),
        ]);
      }
      expect(JSON.stringify(publicPayloads)).toContain(canonicalUrl);
      expect(started).toEqual([
        results.created.body.id,
        secondResults.created.body.id,
      ]);
      expect(terminated).toEqual([secondResults.cancellationCreated.body.id]);
    });
    try {
      await Effect.runPromise(program);
    } finally {
      await app.current?.dispose();
    }
  });
});

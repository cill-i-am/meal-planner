import {
  CancelledRecipeImportIntent,
  IdempotencyKey,
  ProcessingRecipeImportIntent,
  Recipe,
  RecipeImportAction,
  RecipeImportApi,
  RecipeImportApiClient,
  RecipeImportPrincipal,
  RecipeImportTimeline,
  RequiresActionRecipeImportIntent,
  SucceededRecipeImportIntent,
  SourceUrl,
  makeRecipeImportApiClientLayer,
} from "@meal-planner/recipe-import-api";
import { Effect, Layer, Redacted, Schema } from "effect";
import {
  FetchHttpClient,
  HttpRouter,
  HttpServerResponse,
} from "effect/unstable/http";
import { OpenApi } from "effect/unstable/httpapi";
import { afterAll, describe, expect, it } from "vitest";

import {
  RecipeImportIntentApplication,
  makeMealPlannerWorkerHttpLayer,
  makeRecipeImportHttpApiLayer,
} from "./import-intent-api.http.js";
import type { RecipeImportIntentApplicationShape } from "./import-intent-api.http.js";
import { ImportIntentWorkflowTerminator } from "./import-intent-execution.js";
import { RecipeImportIntentReviewApplication } from "./import-intent-review.js";
import type { RecipeImportIntentReviewApplicationShape } from "./import-intent-review.js";
import { ImportIntentIdGenerator } from "./import-intent.js";
import { ImportAuthorizer, makeImportAuthorizer } from "./import.auth.js";

const intentId = "018f47ad-91aa-7c35-b6fe-000000000001";
const actionId = "a".repeat(64);
const recipeId = "018f47ad-91aa-7c35-b6fe-000000000003";
const createdAt = "2026-08-16T12:00:00.000Z";
const commonIntent = {
  createdAt,
  id: intentId,
  intentVersion: 1,
  links: {
    self: `/v1/recipe-import-intents/${intentId}`,
    timeline: `/v1/recipe-import-intents/${intentId}/timeline`,
  },
  object: "recipe_import_intent",
  updatedAt: createdAt,
} as const;
const pendingSource = { kind: "tiktok", resolution: "pending" } as const;
const resolvedSource = {
  canonicalUrl: "https://www.tiktok.com/@household/video/123",
  kind: "tiktok",
  resolution: "resolved",
} as const;
const processingIntent = Schema.decodeUnknownSync(ProcessingRecipeImportIntent)(
  {
    ...commonIntent,
    activity: { type: "working" },
    processing: { startedAt: createdAt, type: "resolving_source" },
    source: pendingSource,
    status: "processing",
  }
);
const actionReference = {
  id: actionId,
  link: `/v1/recipe-import-intents/${intentId}/actions/${actionId}`,
  type: "review_recipe",
} as const;
const emptyRecipe = {
  author: null,
  category: null,
  cookTimeMinutes: null,
  cuisine: null,
  description: null,
  ingredientLines: null,
  ingredientQuantities: null,
  ingredientUnits: null,
  instructions: null,
  name: null,
  nutrition: null,
  prepTimeMinutes: null,
  temperatureCelsius: null,
  tools: null,
  totalTimeMinutes: null,
  yield: null,
} as const;
const planningTags = {
  cuisines: ["Irish"],
  dietaryFit: "household_match",
  difficulty: "easy",
  leftovers: "one_meal",
  mealTypes: ["dinner"],
  totalTimeBand: "30_to_60_minutes",
} as const;
const editableFields = [
  "author",
  "category",
  "cook_time_minutes",
  "cuisine",
  "description",
  "ingredient_lines",
  "ingredient_quantities",
  "ingredient_units",
  "instructions",
  "name",
  "nutrition",
  "prep_time_minutes",
  "temperature_celsius",
  "tools",
  "total_time_minutes",
  "yield",
  "tags",
] as const;
const review = {
  answers: [],
  blockers: {
    invalidFields: [],
    unresolvedRequiredFields: ["name", "ingredient_lines", "instructions"],
  },
  editableFields,
  recipe: emptyRecipe,
  tags: null,
} as const;
const requiresActionIntent = Schema.decodeUnknownSync(
  RequiresActionRecipeImportIntent
)({
  ...commonIntent,
  action: actionReference,
  source: resolvedSource,
  status: "requires_action",
});
const succeededIntent = Schema.decodeUnknownSync(SucceededRecipeImportIntent)({
  ...commonIntent,
  completedAt: createdAt,
  result: { recipeId },
  source: resolvedSource,
  status: "succeeded",
});
const cancelledIntent = Schema.decodeUnknownSync(CancelledRecipeImportIntent)({
  ...commonIntent,
  cancelledAt: createdAt,
  source: pendingSource,
  status: "cancelled",
});
const activeAction = Schema.decodeUnknownSync(RecipeImportAction)({
  actionVersion: 1,
  id: actionId,
  intentId,
  object: "recipe_import_action",
  review,
  status: "active",
  type: "review_recipe",
});
const timeline = Schema.decodeUnknownSync(RecipeImportTimeline)({
  data: [{ at: createdAt, intentVersion: 1, type: "intent_admitted" }],
  object: "list",
});
const recipe = Schema.decodeUnknownSync(Recipe)({
  id: recipeId,
  object: "recipe",
  recipe: emptyRecipe,
  tags: planningTags,
});

const unused = () => Effect.die("not used by this HTTP boundary test");
// eslint-disable-next-line typescript/no-explicit-any -- Effect's test route collection intentionally accepts heterogeneous error and context parameters.
type AnyHttpRoute = HttpRouter.Route<any, any>;

interface MakeAppOptions {
  readonly fallbackRoutes?: readonly AnyHttpRoute[];
  readonly intent?: Partial<RecipeImportIntentApplicationShape>;
  readonly legacyRoutes?: readonly AnyHttpRoute[];
  readonly review?: Partial<RecipeImportIntentReviewApplicationShape>;
}

const makeApp = async (options: MakeAppOptions = {}) => {
  const authorizer = await Effect.runPromise(
    makeImportAuthorizer(Redacted.make("test-import-token"))
  );
  const intentApplication = {
    admit: unused,
    cancel: unused,
    get: unused,
    reconcileStalledStarts: unused,
    requireMutable: unused,
    resolveSource: unused,
    timeline: unused,
    ...options.intent,
  } as RecipeImportIntentApplicationShape;
  const reviewApplication = {
    answerAction: unused,
    confirmAction: unused,
    getAction: unused,
    getRecipe: unused,
    ...options.review,
  } as RecipeImportIntentReviewApplicationShape;
  const services = Layer.mergeAll(
    ImportIntentIdGenerator.live,
    Layer.succeed(
      ImportIntentWorkflowTerminator,
      ImportIntentWorkflowTerminator.of({ terminate: () => Effect.void })
    ),
    Layer.succeed(ImportAuthorizer, ImportAuthorizer.of(authorizer)),
    Layer.succeed(
      RecipeImportIntentApplication,
      RecipeImportIntentApplication.of(intentApplication)
    ),
    Layer.succeed(
      RecipeImportIntentReviewApplication,
      RecipeImportIntentReviewApplication.of(reviewApplication)
    )
  );
  const apiLayer =
    options.legacyRoutes === undefined
      ? makeRecipeImportHttpApiLayer()
      : makeMealPlannerWorkerHttpLayer({
          fallbackRoutes: options.fallbackRoutes ?? [],
          legacyRoutes: options.legacyRoutes,
        });
  return HttpRouter.toWebHandler(
    apiLayer.pipe(Layer.provide(services), HttpRouter.provideRequest(services)),
    { disableLogger: true }
  );
};

describe("recipe import HttpApi boundary", () => {
  const apps: Awaited<ReturnType<typeof makeApp>>[] = [];

  afterAll(async () => {
    await Promise.all(apps.map(({ dispose }) => dispose()));
  });

  it("authenticates before decoding a malformed payload", async () => {
    const app = await makeApp();
    apps.push(app);

    const response = await app.handler(
      new Request("https://meal-planner.test/v1/recipe-import-intents", {
        body: "{not-json",
        headers: {
          authorization: "Bearer wrong-token",
          "content-type": "application/json",
          "idempotency-key": "test-key",
        },
        method: "POST",
      })
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("content-type")).toContain(
      "application/problem+json"
    );
    await expect(response.json()).resolves.toMatchObject({
      code: "unauthorized",
      status: 401,
    });
  });

  it("returns a safe problem for an authorized malformed payload", async () => {
    const app = await makeApp();
    apps.push(app);

    const response = await app.handler(
      new Request("https://meal-planner.test/v1/recipe-import-intents", {
        body: "{not-json",
        headers: {
          authorization: "Bearer test-import-token",
          "content-type": "application/json",
          "idempotency-key": "test-key",
        },
        method: "POST",
      })
    );

    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toContain(
      "application/problem+json"
    );
    await expect(response.json()).resolves.toEqual({
      code: "invalid_request",
      detail: "The request did not match the API contract.",
      status: 400,
      title: "Invalid request",
      type: "https://meal-planner.local/problems/invalid-request",
    });
  });

  it("rejects an excess private mutation field before invoking the application", async () => {
    let invoked = false;
    const app = await makeApp({
      intent: {
        admit: () => {
          invoked = true;
          return Effect.die("application must not run");
        },
      },
    });
    apps.push(app);

    const response = await app.handler(
      new Request("https://meal-planner.test/v1/recipe-import-intents", {
        body: JSON.stringify({
          privateProviderId: "must-not-cross",
          source: {
            kind: "tiktok",
            url: "https://vm.tiktok.com/valid-source",
          },
        }),
        headers: {
          authorization: "Bearer test-import-token",
          "content-type": "application/json",
          "idempotency-key": "test-key",
        },
        method: "POST",
      })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "invalid_request",
      status: 400,
    });
    expect(invoked).toBe(false);
  });

  it("maps response encoding failures to a logged, privacy-safe 500", async () => {
    const privateResponse = "private-response-schema-sentinel";
    const app = await makeApp({
      intent: {
        get: () => Effect.succeed({ privateResponse } as never),
      },
    });
    apps.push(app);

    const response = await app.handler(
      new Request(
        `https://meal-planner.test/v1/recipe-import-intents/${intentId}`,
        { headers: { authorization: "Bearer test-import-token" } }
      )
    );

    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).toContain(
      "application/problem+json"
    );
    const body = await response.json();
    expect(body).toEqual({
      code: "internal_error",
      detail: "The request could not be completed.",
      status: 500,
      title: "Internal error",
      type: "https://meal-planner.local/problems/internal-error",
    });
    expect(JSON.stringify(body)).not.toContain(privateResponse);
  });

  it("maps defects to a logged 500 without exposing the cause", async () => {
    const privateCause = "private-provider-defect-sentinel";
    const app = await makeApp({
      intent: { get: () => Effect.die(privateCause) },
    });
    apps.push(app);

    const response = await app.handler(
      new Request(
        `https://meal-planner.test/v1/recipe-import-intents/${intentId}`,
        { headers: { authorization: "Bearer test-import-token" } }
      )
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).toContain(
      "application/problem+json"
    );
    expect(body).toMatchObject({ code: "internal_error", status: 500 });
    expect(JSON.stringify(body)).not.toContain(privateCause);
  });

  it("round-trips all eight endpoints through the generated client without leaking private state", async () => {
    const sentinels = [
      "test-import-token",
      "https://vm.tiktok.com/submitted-private-url",
      "private-provider",
      "private-model",
      "private-r2-reference",
      "private-transcript",
      "private-evidence",
      "private-fingerprint",
      "0".repeat(64),
      "1".repeat(64),
    ] as const;
    const privateTransport = {
      evidence: sentinels[6],
      fingerprint: sentinels[7],
      model: sentinels[3],
      provider: sentinels[2],
      r2Reference: sentinels[4],
      transcript: sentinels[5],
    };
    const withPrivateTransport = <Value extends object>(value: Value) => ({
      ...value,
      privateTransport,
    });
    const app = await makeApp({
      intent: {
        admit: () =>
          Effect.succeed({ disposition: "created", intent: processingIntent }),
        cancel: () => Effect.succeed(cancelledIntent),
        get: () => Effect.succeed(withPrivateTransport(processingIntent)),
        timeline: () => Effect.succeed(withPrivateTransport(timeline)),
      },
      review: {
        answerAction: () =>
          Effect.succeed(withPrivateTransport(requiresActionIntent)),
        confirmAction: () =>
          Effect.succeed(withPrivateTransport(succeededIntent)),
        getAction: () => Effect.succeed(withPrivateTransport(activeAction)),
        getRecipe: () => Effect.succeed(withPrivateTransport(recipe)),
      },
    });
    apps.push(app);

    const clientLayer = makeRecipeImportApiClientLayer({
      baseUrl: "https://meal-planner.test",
      token: Redacted.make(sentinels[0]),
    }).pipe(Layer.provide(FetchHttpClient.layer));
    const idempotencyKey = Schema.decodeUnknownSync(IdempotencyKey);
    const submittedSource = Schema.decodeUnknownSync(SourceUrl)(sentinels[1]);
    const testFetch: typeof globalThis.fetch = (input, init) =>
      app.handler(new Request(input, init));
    const results = await Effect.runPromise(
      Effect.gen(function* generatedClientRoundTrip() {
        const client = yield* RecipeImportApiClient;
        const created = yield* client.recipeImportIntents.create({
          headers: { "idempotency-key": idempotencyKey("create-once") },
          payload: {
            source: { kind: "tiktok", url: submittedSource },
          },
        });
        const read = yield* client.recipeImportIntents.get({
          params: { id: processingIntent.id },
        });
        const readAction = yield* client.recipeImportIntents.getAction({
          params: { actionId: activeAction.id, id: processingIntent.id },
        });
        const answered = yield* client.recipeImportIntents.answerAction({
          headers: { "idempotency-key": idempotencyKey("answer-once") },
          params: { actionId: activeAction.id, id: processingIntent.id },
          payload: {
            answers: [{ field: "name", value: "Soda bread" }],
            expectedActionVersion: activeAction.actionVersion,
          },
        });
        const confirmed = yield* client.recipeImportIntents.confirmAction({
          headers: { "idempotency-key": idempotencyKey("confirm-once") },
          params: { actionId: activeAction.id, id: processingIntent.id },
          payload: { expectedActionVersion: activeAction.actionVersion },
        });
        const cancelled = yield* client.recipeImportIntents.cancel({
          headers: { "idempotency-key": idempotencyKey("cancel-once") },
          params: { id: processingIntent.id },
          payload: { expectedIntentVersion: processingIntent.intentVersion },
        });
        const events = yield* client.recipeImportIntents.timeline({
          params: { id: processingIntent.id },
        });
        const readRecipe = yield* client.recipes.get({
          params: { recipeId: recipe.id },
        });
        return {
          responses: [
            created,
            read,
            readAction,
            answered,
            confirmed,
            cancelled,
            events,
            readRecipe,
          ],
          retryAfter: {
            create: created.headers["retry-after"],
            read: read.headers["retry-after"],
          },
        };
      }).pipe(
        Effect.provide(clientLayer),
        Effect.provideService(FetchHttpClient.Fetch, testFetch)
      )
    );

    const assertNoSentinels = (value: unknown): void => {
      if (typeof value === "string") {
        for (const sentinel of sentinels) {
          expect(value).not.toContain(sentinel);
        }
        return;
      }
      if (Array.isArray(value)) {
        for (const item of value) {
          assertNoSentinels(item);
        }
        return;
      }
      if (typeof value === "object" && value !== null) {
        for (const [key, child] of Object.entries(value)) {
          assertNoSentinels(key);
          assertNoSentinels(child);
        }
      }
    };
    expect(results.responses).toHaveLength(8);
    for (const response of results.responses) {
      assertNoSentinels(response);
    }
    expect(results.retryAfter).toEqual({ create: 2, read: 2 });
  });

  it("keeps typed routes, legacy routes, and the wildcard fallback side by side", async () => {
    const app = await makeApp({
      fallbackRoutes: [
        HttpRouter.route(
          "*",
          "*",
          HttpServerResponse.text("legacy fallback", { status: 404 })
        ),
      ],
      intent: { get: () => Effect.succeed(processingIntent) },
      legacyRoutes: [
        HttpRouter.route(
          "GET",
          "/legacy-proof",
          HttpServerResponse.empty({ status: 204 })
        ),
      ],
    });
    apps.push(app);

    const [legacy, typed, fallback] = await Promise.all([
      app.handler(new Request("https://meal-planner.test/legacy-proof")),
      app.handler(
        new Request(
          `https://meal-planner.test/v1/recipe-import-intents/${intentId}`,
          { headers: { authorization: "Bearer test-import-token" } }
        )
      ),
      app.handler(new Request("https://meal-planner.test/not-a-route")),
    ]);

    expect(legacy.status).toBe(204);
    expect(typed.status).toBe(200);
    expect(fallback.status).toBe(404);
    await expect(fallback.text()).resolves.toBe("legacy fallback");
  });

  it("serves the exact generated contract from the mounted endpoint", async () => {
    const app = await makeApp();
    apps.push(app);

    const response = await app.handler(
      new Request("https://meal-planner.test/openapi.json")
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(
      OpenApi.fromApi(RecipeImportApi)
    );
  });

  it("keeps the security principal schema at the shared protocol boundary", () => {
    expect(
      Schema.decodeUnknownSync(RecipeImportPrincipal)({
        actorId: "0".repeat(64),
        householdScopeId: "1".repeat(64),
      })
    ).toEqual({
      actorId: "0".repeat(64),
      householdScopeId: "1".repeat(64),
    });
  });
});

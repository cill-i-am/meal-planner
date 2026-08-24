import { HouseholdOrganizationId } from "@meal-planner/household-api";
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
import { Effect, Layer, Schema } from "effect";
import { FetchHttpClient, HttpRouter } from "effect/unstable/http";
import { OpenApi } from "effect/unstable/httpapi";
import { afterAll, describe, expect, it } from "vitest";

import {
  AuthenticatedOrganizationResolver,
  AuthPrincipalResolver,
} from "../auth/auth.principal.js";
import { HealthRoutes } from "../health/health.routes.js";
import type { HouseholdDomainWorkerMethods } from "../households/household-domain-worker.js";
import { ProviderAccountingRouteDefinitions } from "../provider-accounting/provider-accounting.routes.js";
import { ProviderAccountingService } from "../provider-accounting/provider-accounting.service.js";
import {
  RecipeImportHouseholdDomain,
  makeRecipeImportHttpApiLayer,
  makeRecipeImportWorkerHttpLayer,
} from "./import-intent-api.http.js";
import { ProviderRecoveryService } from "./import-provider-recovery.js";
import { ProviderRecoveryRouteDefinitions } from "./import-provider-recovery.routes.js";
import { ImportSystemAuthorizer } from "./import-system.auth.js";
import { RecipeImportWorkflowDispatcher } from "./import-workflow-dispatcher.js";
import type { RecipeImportWorkflowDispatcherService } from "./import-workflow-dispatcher.js";
import {
  makeTestAuthPrincipalResolver,
  makeTestSystemAuthorizer,
} from "./import.test-fixtures.js";

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
const processingIntentWire = Schema.encodeUnknownSync(
  ProcessingRecipeImportIntent
)(processingIntent);
const requiresActionIntentWire = Schema.encodeUnknownSync(
  RequiresActionRecipeImportIntent
)(requiresActionIntent);
const succeededIntentWire = Schema.encodeUnknownSync(
  SucceededRecipeImportIntent
)(succeededIntent);
const cancelledIntentWire = Schema.encodeUnknownSync(
  CancelledRecipeImportIntent
)(cancelledIntent);
const activeActionWire =
  Schema.encodeUnknownSync(RecipeImportAction)(activeAction);
const timelineWire = Schema.encodeUnknownSync(RecipeImportTimeline)(timeline);
const recipeWire = Schema.encodeUnknownSync(Recipe)(recipe);

const unused = () => Effect.die("not used by this HTTP boundary test");
// eslint-disable-next-line typescript/no-explicit-any -- Effect's test route collection intentionally accepts heterogeneous error and context parameters.
type AnyHttpRoute = HttpRouter.Route<any, any>;

interface MakeAppOptions {
  readonly household?: Partial<
    Record<keyof HouseholdDomainWorkerMethods, unknown>
  >;
  readonly operationalRoutes?: readonly AnyHttpRoute[];
  readonly workflowDispatcher?: RecipeImportWorkflowDispatcherService;
}

const makeApp = async (options: MakeAppOptions = {}) => {
  const systemAuthorizer = await Effect.runPromise(
    makeTestSystemAuthorizer("system-import-token")
  );
  const household = {
    admitImportBatch: unused,
    admitRecipeImport: unused,
    answerRecipeImportAction: unused,
    approveMealPlan: unused,
    cancelRecipeImport: unused,
    claimImportBatchItem: unused,
    commitRecipeImportDraft: unused,
    completeImportBatchItem: unused,
    confirmRecipeImportAction: unused,
    createMealPlan: unused,
    createMealPlanFromRecipeBank: unused,
    ensureHousehold: unused,
    failImportBatchItem: unused,
    listRecipeBank: unused,
    readImportBatch: unused,
    readMealPlan: unused,
    readRecipe: unused,
    readRecipeImport: unused,
    readRecipeImportAction: unused,
    readRecipeImportTimeline: unused,
    recordImportBatchDispatch: unused,
    rejectMealPlan: unused,
    resolveRecipeImportSource: unused,
    swapMealPlan: unused,
    swapMealPlanFromRecipeBank: unused,
    ...options.household,
  } as unknown as HouseholdDomainWorkerMethods;
  const services = Layer.mergeAll(
    Layer.succeed(
      AuthPrincipalResolver,
      AuthPrincipalResolver.of(makeTestAuthPrincipalResolver("test-session"))
    ),
    Layer.succeed(
      AuthenticatedOrganizationResolver,
      AuthenticatedOrganizationResolver.of({
        resolve: () =>
          Effect.succeed({
            organizationId: Schema.decodeUnknownSync(HouseholdOrganizationId)(
              "test-household"
            ),
            userId: "test-user",
          }),
      })
    ),
    Layer.succeed(
      ImportSystemAuthorizer,
      ImportSystemAuthorizer.of(systemAuthorizer)
    ),
    Layer.succeed(
      RecipeImportHouseholdDomain,
      RecipeImportHouseholdDomain.of(household)
    ),
    Layer.succeed(
      RecipeImportWorkflowDispatcher,
      RecipeImportWorkflowDispatcher.of(
        options.workflowDispatcher ?? { dispatch: () => Effect.void }
      )
    ),
    Layer.succeed(
      ProviderAccountingService,
      ProviderAccountingService.of({ reconcile: unused })
    ),
    Layer.succeed(
      ProviderRecoveryService,
      ProviderRecoveryService.of({ recover: unused })
    )
  );
  const apiLayer =
    options.operationalRoutes === undefined
      ? makeRecipeImportHttpApiLayer()
      : makeRecipeImportWorkerHttpLayer({
          operationalRoutes: options.operationalRoutes,
        });
  return HttpRouter.toWebHandler(
    apiLayer.pipe(Layer.provide(services), HttpRouter.provideRequest(services)),
    { disableLogger: true }
  );
};

const makeSystemOnlyRequest = (path: string, token: string) =>
  new Request(`https://meal-planner.test${path}`, {
    body: "{not-json",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "idempotency-key": "operator-test",
    },
    method: "POST",
  });

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
          "content-type": "application/json",
          cookie: "better-auth.session_token=wrong-session",
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
          "content-type": "application/json",
          cookie: "better-auth.session_token=test-session",
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
      household: {
        admitRecipeImport: () => {
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
          "content-type": "application/json",
          cookie: "better-auth.session_token=test-session",
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

  it("dispatches the atomically recorded Workflow identity after admission without changing the committed response", async () => {
    const dispatches: Parameters<
      RecipeImportWorkflowDispatcherService["dispatch"]
    >[0][] = [];
    const committed = {
      dispatchId: "dispatch-test",
      intent: processingIntentWire,
      workflowIdentity: `import-acquisition:v1:${"a".repeat(64)}`,
    } as const;
    const app = await makeApp({
      household: {
        admitRecipeImport: () => Effect.succeed(committed),
      },
      workflowDispatcher: {
        dispatch: (input) => {
          dispatches.push(input);
          return Effect.void;
        },
      },
    });
    apps.push(app);

    const response = await app.handler(
      new Request("https://meal-planner.test/v1/recipe-import-intents", {
        body: JSON.stringify({
          source: {
            kind: "tiktok",
            url: "https://vm.tiktok.com/valid-source",
          },
        }),
        headers: {
          "content-type": "application/json",
          cookie: "better-auth.session_token=test-session",
          "idempotency-key": "test-key",
        },
        method: "POST",
      })
    );

    expect(response.status).toBe(201);
    expect(dispatches).toHaveLength(1);
    expect(dispatches[0]?.committed).toMatchObject({
      dispatchId: committed.dispatchId,
      intent: { id: processingIntent.id },
      workflowIdentity: committed.workflowIdentity,
    });
    await expect(response.json()).resolves.toEqual(processingIntentWire);
  });

  it("maps response encoding failures to a logged, privacy-safe 500", async () => {
    const privateResponse = "private-response-schema-sentinel";
    const app = await makeApp({
      household: {
        readRecipeImport: () => Effect.succeed({ privateResponse } as never),
      },
    });
    apps.push(app);

    const response = await app.handler(
      new Request(
        `https://meal-planner.test/v1/recipe-import-intents/${intentId}`,
        { headers: { cookie: "better-auth.session_token=test-session" } }
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
      household: { readRecipeImport: () => Effect.die(privateCause) },
    });
    apps.push(app);

    const response = await app.handler(
      new Request(
        `https://meal-planner.test/v1/recipe-import-intents/${intentId}`,
        { headers: { cookie: "better-auth.session_token=test-session" } }
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
      "test-session",
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
    const app = await makeApp({
      household: {
        admitRecipeImport: () =>
          Effect.succeed({
            dispatchId: "dispatch-test",
            intent: processingIntentWire,
            workflowIdentity: `import-acquisition:v1:${"a".repeat(64)}`,
          }),
        answerRecipeImportAction: () =>
          Effect.succeed(requiresActionIntentWire),
        cancelRecipeImport: () => Effect.succeed(cancelledIntentWire),
        confirmRecipeImportAction: () => Effect.succeed(succeededIntentWire),
        readRecipe: () => Effect.succeed(recipeWire),
        readRecipeImport: () => Effect.succeed(processingIntentWire),
        readRecipeImportAction: () => Effect.succeed(activeActionWire),
        readRecipeImportTimeline: () => Effect.succeed(timelineWire),
      },
    });
    apps.push(app);

    const clientLayer = makeRecipeImportApiClientLayer({
      baseUrl: "https://meal-planner.test",
    }).pipe(Layer.provide(FetchHttpClient.layer));
    const idempotencyKey = Schema.decodeUnknownSync(IdempotencyKey);
    const submittedSource = Schema.decodeUnknownSync(SourceUrl)(sentinels[1]);
    const testFetch: typeof globalThis.fetch = (input, init) => {
      const request = new Request(input, init);
      request.headers.set("cookie", "better-auth.session_token=test-session");
      return app.handler(request);
    };
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

    const assertNoSentinels = (value: Schema.Json): void => {
      if (Schema.is(Schema.String)(value)) {
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
      if (Schema.is(Schema.Record(Schema.String, Schema.Json))(value)) {
        for (const [key, child] of Object.entries(value)) {
          assertNoSentinels(key);
          assertNoSentinels(child);
        }
      }
    };
    expect(results.responses).toHaveLength(8);
    for (const response of results.responses) {
      const serializedResponse = JSON.stringify(response);
      if (serializedResponse === undefined) {
        throw new Error("Expected a serializable public response");
      }
      assertNoSentinels(
        Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Json))(
          serializedResponse
        )
      );
    }
    expect(results.retryAfter).toEqual({ create: 2, read: 2 });
  });

  it("mounts only the canonical and current operational surface before a safe wildcard 404", async () => {
    const app = await makeApp({
      household: {
        readRecipeImport: () => Effect.succeed(processingIntentWire),
      },
      operationalRoutes: [
        ...HealthRoutes,
        ...ProviderAccountingRouteDefinitions,
        ...ProviderRecoveryRouteDefinitions,
      ],
    });
    apps.push(app);

    const [health, typed, carousel, batch, settlement] = await Promise.all([
      app.handler(new Request("https://meal-planner.test/health")),
      app.handler(
        new Request(
          `https://meal-planner.test/v1/recipe-import-intents/${intentId}`,
          { headers: { cookie: "better-auth.session_token=test-session" } }
        )
      ),
      app.handler(
        new Request("https://meal-planner.test/imports/operator-carousel", {
          method: "POST",
        })
      ),
      app.handler(
        new Request("https://meal-planner.test/import-batches", {
          method: "POST",
        })
      ),
      app.handler(
        new Request(
          "https://meal-planner.test/imports/operator-provider-accounting",
          { method: "POST" }
        )
      ),
    ]);

    expect(health.status).toBe(200);
    expect(typed.status).toBe(200);
    expect(carousel.status).toBe(404);
    expect(batch.status).toBe(404);
    expect(settlement.status).toBe(401);

    const removedRequests = [
      new Request("https://meal-planner.test/imports", { method: "POST" }),
      new Request("https://meal-planner.test/imports/legacy-id"),
      new Request("https://meal-planner.test/recipe-drafts/legacy-id"),
      new Request("https://meal-planner.test/recipe-drafts/legacy-id", {
        method: "PATCH",
      }),
      new Request("https://meal-planner.test/recipe-bank"),
      new Request("https://meal-planner.test/import-batches", {
        method: "POST",
      }),
      new Request("https://meal-planner.test/imports/operator-carousel", {
        method: "POST",
      }),
      new Request("https://meal-planner.test/not-a-route"),
    ];
    const removedResponses = await Promise.all(
      removedRequests.map((request) => app.handler(request))
    );
    const removedBodies = await Promise.all(
      removedResponses.map((response) => response.json())
    );
    for (const [index, response] of removedResponses.entries()) {
      expect(response.status).toBe(404);
      expect(removedBodies[index]).toEqual({
        error: {
          code: "not_found",
          message: "The route was not found.",
        },
      });
    }
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

  it("keeps browser principals out of the system-only import surfaces", async () => {
    const app = await makeApp({
      operationalRoutes: [
        ...ProviderAccountingRouteDefinitions,
        ...ProviderRecoveryRouteDefinitions,
      ],
    });
    apps.push(app);

    const systemOnlyPaths = [
      "/imports/operator-provider-accounting",
      "/imports/operator-provider-recovery",
    ];
    const [browserPrincipalResponses, systemPrincipalResponses] =
      await Promise.all([
        Promise.all(
          systemOnlyPaths.map((path) =>
            app.handler(makeSystemOnlyRequest(path, "test-import-token"))
          )
        ),
        Promise.all(
          systemOnlyPaths.map((path) =>
            app.handler(makeSystemOnlyRequest(path, "system-import-token"))
          )
        ),
      ]);

    expect(browserPrincipalResponses.map(({ status }) => status)).toEqual([
      401, 401,
    ]);
    expect(systemPrincipalResponses.map(({ status }) => status)).toEqual([
      400, 400,
    ]);
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

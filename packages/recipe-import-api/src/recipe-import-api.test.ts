import { Option, Schema } from "effect";
import type { JsonSchema } from "effect";
import { OpenApi } from "effect/unstable/httpapi";
import { describe, expect, it } from "vitest";

import * as Protocol from "./index.js";

const {
  AnswerReviewRecipeActionRequest,
  CreateRecipeImportIntentRequest,
  IdempotencyKey,
  IntentRedirectedProblem,
  RecipeImportAction,
  RecipeImportApi,
  RecipeImportIntent,
  RecipeImportIntentId,
  RecipeImportTimeline,
  RecipeId,
  RequiresActionRecipeImportIntent,
} = Protocol;

const intentId = "018f47ad-91aa-7c35-b6fe-000000000001";
const actionId = "a".repeat(64);
const canonicalIntentId = "018f47ad-91aa-7c35-b6fe-000000000002";
const recipeId = "018f47ad-91aa-7c35-b6fe-000000000003";
const createdAt = "2026-08-16T12:00:00.000Z";
const canonicalSource = {
  canonicalUrl: "https://www.tiktok.com/@household/video/123",
  kind: "tiktok",
  resolution: "resolved",
} as const;
const common = {
  createdAt,
  id: intentId,
  intentVersion: 1,
  links: {
    self: `/v1/recipe-import-intents/${intentId}`,
    timeline: `/v1/recipe-import-intents/${intentId}/timeline`,
  },
  object: "recipe_import_intent",
  source: { kind: "tiktok", resolution: "pending" },
  updatedAt: createdAt,
} as const;
const action = {
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

const decodeIntent = Schema.decodeUnknownSync(RecipeImportIntent, {
  onExcessProperty: "error",
});

const OpenApiReference = Schema.Struct({
  $ref: Schema.String,
});
const decodeOpenApiReference = Schema.decodeUnknownOption(OpenApiReference, {
  onExcessProperty: "ignore",
});
const OpenApiObjectProperty = Schema.Struct({
  properties: Schema.Struct({ object: Schema.Json }),
});
const decodeOpenApiObjectProperty = Schema.decodeUnknownOption(
  OpenApiObjectProperty,
  { onExcessProperty: "ignore" }
);

const openApiReferenceName = (
  schema: JsonSchema.JsonSchema | Schema.Json | undefined
): string | undefined =>
  Option.getOrUndefined(decodeOpenApiReference(schema))?.$ref.split("/").at(-1);

describe("RecipeImportIntent protocol", () => {
  it.each([
    {
      ...common,
      activity: { type: "working" },
      processing: { startedAt: createdAt, type: "resolving_source" },
      status: "processing",
    },
    {
      ...common,
      activity: {
        nextAttemptAt: "2026-08-16T12:05:00.000Z",
        type: "retrying",
      },
      processing: {
        sourceKind: "carousel",
        startedAt: createdAt,
        type: "acquiring_media",
      },
      source: canonicalSource,
      status: "processing",
    },
    {
      ...common,
      activity: { type: "working" },
      processing: {
        speech: "skipped",
        startedAt: createdAt,
        type: "analyzing_evidence",
        visuals: "processing",
      },
      source: canonicalSource,
      status: "processing",
    },
    ...[
      "extracting_recipe",
      "grounding_recipe",
      "preparing_review",
      "finalizing_recipe",
    ].map((type) => ({
      ...common,
      activity: { type: "working" },
      processing: { startedAt: createdAt, type },
      source: canonicalSource,
      status: "processing",
    })),
    {
      ...common,
      action,
      source: canonicalSource,
      status: "requires_action",
    },
    {
      ...common,
      completedAt: createdAt,
      result: { recipeId },
      source: canonicalSource,
      status: "succeeded",
    },
    {
      ...common,
      error: {
        code: "source_unavailable",
        message: "The source is not available.",
        recovery: "create_new_intent",
      },
      failedAt: createdAt,
      source: canonicalSource,
      status: "failed",
    },
    { ...common, cancelledAt: createdAt, status: "cancelled" },
    {
      ...common,
      redirect: {
        intentId: canonicalIntentId,
        link: `/v1/recipe-import-intents/${canonicalIntentId}`,
      },
      redirectedAt: createdAt,
      source: canonicalSource,
      status: "redirected",
    },
  ])("accepts legal variant $status", (value) => {
    expect(Schema.encodeSync(RecipeImportIntent)(decodeIntent(value))).toEqual(
      value
    );
  });

  it.each([
    { ...common, status: "processing" },
    {
      ...common,
      activity: { type: "working" },
      error: {
        code: "source_unavailable",
        message: "Safe",
        recovery: "create_new_intent",
      },
      processing: { startedAt: createdAt, type: "resolving_source" },
      status: "processing",
    },
    {
      ...common,
      cancelledAt: createdAt,
      evidenceReferences: ["private-r2-key"],
      status: "cancelled",
    },
    {
      ...common,
      redirect: {
        intentId: canonicalIntentId,
        link: `/v1/recipe-import-intents/${canonicalIntentId}`,
      },
      redirectedAt: createdAt,
      status: "redirected",
    },
    {
      ...common,
      error: {
        code: "review_rejected",
        message: "Deferred public failure code",
        recovery: "retry_later",
      },
      failedAt: createdAt,
      status: "failed",
    },
    {
      ...common,
      activity: { type: "working" },
      processing: {
        sourceKind: "video",
        startedAt: createdAt,
        type: "acquiring_media",
      },
      status: "processing",
    },
    {
      ...common,
      activity: { type: "working" },
      processing: { startedAt: createdAt, type: "resolving_source" },
      source: canonicalSource,
      status: "processing",
    },
  ])("rejects illegal cross-state, excess, or retired fields", (value) => {
    expect(() => decodeIntent(value)).toThrow();
  });

  it("establishes public action and resource brands only through parsing", () => {
    expect(Schema.decodeUnknownSync(RecipeImportIntentId)(intentId)).toBe(
      intentId
    );
    expect(
      Schema.decodeUnknownSync(Protocol.RecipeImportActionId)(actionId)
    ).toBe(actionId);
    expect(Schema.decodeUnknownSync(RecipeId)(recipeId)).toBe(recipeId);
    expect(Schema.decodeUnknownSync(IdempotencyKey)("create-once")).toBe(
      "create-once"
    );
    expect(() => Schema.decodeUnknownSync(IdempotencyKey)(" ")).toThrow();
    expect("RecipeImportRequirementId" in Protocol).toBe(false);
    expect(
      Object.keys(RequiresActionRecipeImportIntent.fields).filter(
        (field) => field === "action"
      )
    ).toEqual(["action"]);
  });

  it("rejects excess properties at every public mutation boundary by default", () => {
    for (const [schema, value] of [
      [
        CreateRecipeImportIntentRequest,
        {
          source: {
            kind: "tiktok",
            privateProviderId: "must-not-cross",
            url: "https://www.tiktok.com/t/abc",
          },
        },
      ],
      [
        AnswerReviewRecipeActionRequest,
        {
          answers: [{ field: "name", privateEvidence: "hidden", value: "Pie" }],
          expectedActionVersion: 1,
        },
      ],
      [
        Protocol.ConfirmRecipeImportActionRequest,
        { expectedActionVersion: 1, providerReceipt: "hidden" },
      ],
      [
        Protocol.CancelRecipeImportIntentRequest,
        { expectedIntentVersion: 1, workflowId: "hidden" },
      ],
    ] as const) {
      expect(() => Schema.decodeUnknownSync(schema)(value)).toThrow();
    }
  });

  it("exposes only a sanitized canonical HTTPS URL after resolution", () => {
    expect(
      decodeIntent({
        ...common,
        activity: { type: "working" },
        processing: {
          sourceKind: "video",
          startedAt: createdAt,
          type: "acquiring_media",
        },
        source: canonicalSource,
        status: "processing",
      })
    ).toBeDefined();
    expect(() =>
      decodeIntent({
        ...common,
        activity: { type: "working" },
        processing: { startedAt: createdAt, type: "resolving_source" },
        source: {
          kind: "tiktok",
          resolution: "pending",
          submittedUrl: "https://vm.tiktok.com/private-token",
        },
        status: "processing",
      })
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(Protocol.CanonicalTikTokUrl)(
        "https://www.tiktok.com:8443/@household/video/123"
      )
    ).toThrow();
  });

  it("keeps the full safe review, answers, tags, and version on the action", () => {
    const decode = Schema.decodeUnknownSync(RecipeImportAction, {
      onExcessProperty: "error",
    });
    const active = decode({
      actionVersion: 3,
      id: actionId,
      intentId,
      object: "recipe_import_action",
      review,
      status: "active",
      type: "review_recipe",
    });
    const completed = decode({
      actionVersion: 4,
      completion: { confirmedAt: createdAt, type: "confirmed" },
      id: actionId,
      intentId,
      object: "recipe_import_action",
      review: {
        ...review,
        answers: [{ field: "name", value: "Soda bread" }],
        blockers: { invalidFields: [], unresolvedRequiredFields: [] },
        recipe: { ...emptyRecipe, name: "Soda bread" },
        tags: planningTags,
      },
      status: "completed",
      type: "review_recipe",
    });
    expect(active.actionVersion).toBe(3);
    expect(completed.status).toBe("completed");
    expect(() =>
      decodeIntent({
        ...common,
        action: { ...action, actionVersion: 3, review },
        source: canonicalSource,
        status: "requires_action",
      })
    ).toThrow();
  });

  it("rejects duplicate answer fields before invoking an action mutation", () => {
    expect(() =>
      Schema.decodeUnknownSync(Protocol.AnswerReviewRecipeActionRequest)({
        answers: [
          { field: "name", value: "First name" },
          { field: "name", value: "Second name" },
        ],
        expectedActionVersion: 1,
      })
    ).toThrow();
  });

  it("accepts an atomic non-empty batch across supported recipe fields and tags", () => {
    const decode = Schema.decodeUnknownSync(AnswerReviewRecipeActionRequest, {
      onExcessProperty: "error",
    });
    expect(
      decode({
        answers: [
          { field: "name", value: "Soda bread" },
          { field: "cook_time_minutes", value: 45 },
          { field: "ingredient_lines", value: ["500g flour"] },
          { field: "tags", value: planningTags },
        ],
        expectedActionVersion: 3,
      })
    ).toBeDefined();
    expect(() => decode({ answers: [], expectedActionVersion: 3 })).toThrow();
    expect(() =>
      decode({
        answers: [{ field: "provider_transcript", value: "private" }],
        expectedActionVersion: 3,
      })
    ).toThrow();
  });

  it("keeps every meaningful public event and rejects executor noise", () => {
    const decode = Schema.decodeUnknownSync(RecipeImportTimeline, {
      onExcessProperty: "error",
    });
    const data = [
      { at: createdAt, intentVersion: 1, type: "intent_admitted" },
      {
        at: createdAt,
        canonicalUrl: canonicalSource.canonicalUrl,
        intentVersion: 2,
        type: "source_resolved",
      },
      {
        at: createdAt,
        intentVersion: 3,
        processing: { startedAt: createdAt, type: "extracting_recipe" },
        type: "processing_stage_changed",
      },
      {
        at: createdAt,
        intentVersion: 4,
        nextAttemptAt: "2026-08-16T12:05:00.000Z",
        type: "retrying",
      },
      { at: createdAt, intentVersion: 5, type: "recovered" },
      { action, at: createdAt, intentVersion: 6, type: "action_available" },
      {
        at: createdAt,
        intentVersion: 2,
        redirect: {
          intentId: canonicalIntentId,
          link: `/v1/recipe-import-intents/${canonicalIntentId}`,
        },
        type: "intent_redirected",
      },
    ];
    expect(decode({ data, object: "list" })).toBeDefined();
    for (const privateField of [
      { heartbeatAt: createdAt },
      { attempt: 3 },
      { provider: "tiktok" },
    ]) {
      expect(() =>
        decode({ data: [{ ...data[0], ...privateField }], object: "list" })
      ).toThrow();
    }
  });

  it("models redirect conflicts as a safe typed convergence response", () => {
    const redirectedIntent = {
      ...common,
      redirect: {
        intentId: canonicalIntentId,
        link: `/v1/recipe-import-intents/${canonicalIntentId}`,
      },
      redirectedAt: createdAt,
      source: canonicalSource,
      status: "redirected",
    } as const;
    expect(
      Schema.decodeUnknownSync(IntentRedirectedProblem, {
        onExcessProperty: "error",
      })({
        code: "intent_redirected",
        detail: "This intent redirected to the household canonical intent.",
        intent: redirectedIntent,
        redirect: redirectedIntent.redirect,
        status: 409,
        title: "Recipe import intent redirected",
        type: "https://meal-planner.local/problems/intent-redirected",
      })
    ).toBeDefined();
  });

  it("binds every ordinary problem code to its exact HTTP body status", () => {
    const decode = Schema.decodeUnknownSync(Protocol.ProblemDetails);
    const base = {
      detail: "Safe detail",
      title: "Safe title",
      type: "https://meal-planner.local/problems/test",
    };
    expect(() =>
      decode({ ...base, code: "invalid_request", status: 409 })
    ).toThrow();
    expect(() =>
      decode({ ...base, code: "intent_not_found", status: 400 })
    ).toThrow();
    expect(() =>
      decode({ ...base, code: "internal_error", status: 401 })
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(Protocol.IntentNotFoundProblemDetails)({
        ...base,
        code: "action_not_found",
        status: 404,
      })
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(Protocol.ActionNotFoundProblemDetails)({
        ...base,
        code: "intent_not_found",
        status: 404,
      })
    ).toThrow();
  });
});

describe("RecipeImportApi HttpApi declaration", () => {
  it("declares the approved complete unmounted surface and safe metadata", () => {
    const document = OpenApi.fromApi(RecipeImportApi);
    expect(document.info).toMatchObject({
      title: "Meal Planner Recipe Import API",
      version: "1.0.0",
    });
    expect(Object.keys(document.paths).toSorted()).toEqual([
      "/v1/recipe-import-batches",
      "/v1/recipe-import-batches/{batchId}",
      "/v1/recipe-import-intents",
      "/v1/recipe-import-intents/{id}",
      "/v1/recipe-import-intents/{id}/actions/{actionId}",
      "/v1/recipe-import-intents/{id}/actions/{actionId}/answers",
      "/v1/recipe-import-intents/{id}/actions/{actionId}/confirm",
      "/v1/recipe-import-intents/{id}/cancel",
      "/v1/recipe-import-intents/{id}/timeline",
      "/v1/recipes/{recipeId}",
    ]);
    expect(document.components.securitySchemes).toEqual({});

    const operations = [
      {
        errors: [400, 401, 409, 500],
        idempotent: true,
        method: "post",
        path: "/v1/recipe-import-batches",
        success: 201,
        successHeaders: ["location"],
      },
      {
        errors: [400, 401, 404, 500],
        idempotent: false,
        method: "get",
        path: "/v1/recipe-import-batches/{batchId}",
        success: 200,
        successHeaders: [],
      },
      {
        errors: [400, 401, 409, 500],
        idempotent: true,
        method: "post",
        path: "/v1/recipe-import-intents",
        success: 201,
        successHeaders: ["location", "retry-after"],
      },
      {
        errors: [400, 401, 404, 500],
        idempotent: false,
        method: "get",
        path: "/v1/recipe-import-intents/{id}",
        success: 200,
        successHeaders: ["retry-after"],
      },
      {
        errors: [400, 401, 404, 500],
        idempotent: false,
        method: "get",
        path: "/v1/recipe-import-intents/{id}/actions/{actionId}",
        success: 200,
        successHeaders: [],
      },
      {
        errors: [400, 401, 404, 409, 500],
        idempotent: true,
        method: "post",
        path: "/v1/recipe-import-intents/{id}/actions/{actionId}/answers",
        success: 200,
        successHeaders: [],
      },
      {
        errors: [400, 401, 404, 409, 500],
        idempotent: true,
        method: "post",
        path: "/v1/recipe-import-intents/{id}/actions/{actionId}/confirm",
        success: 200,
        successHeaders: [],
      },
      {
        errors: [400, 401, 404, 409, 500],
        idempotent: true,
        method: "post",
        path: "/v1/recipe-import-intents/{id}/cancel",
        success: 200,
        successHeaders: [],
      },
      {
        errors: [400, 401, 404, 500],
        idempotent: false,
        method: "get",
        path: "/v1/recipe-import-intents/{id}/timeline",
        success: 200,
        successHeaders: [],
      },
      {
        errors: [400, 401, 404, 500],
        idempotent: false,
        method: "get",
        path: "/v1/recipes/{recipeId}",
        success: 200,
        successHeaders: [],
      },
    ] as const;

    for (const operation of operations) {
      const declaration = document.paths[operation.path]?.[operation.method];
      expect(declaration?.security).toEqual([]);
      expect(Object.keys(declaration?.responses ?? {}).toSorted()).toEqual(
        [operation.success, ...operation.errors].map(String).toSorted()
      );
      expect(
        Object.keys(
          declaration?.responses?.[operation.success]?.headers ?? {}
        ).toSorted()
      ).toEqual([...operation.successHeaders].toSorted());
      expect(
        declaration?.responses?.[operation.success]?.content
      ).toHaveProperty("application/json");
      for (const status of operation.errors) {
        expect(declaration?.responses?.[status]?.content).toEqual({
          "application/problem+json": expect.any(Object),
        });
      }
      expect(
        declaration?.parameters?.some(
          (parameter) =>
            "in" in parameter &&
            parameter.in === "header" &&
            parameter.name === "idempotency-key"
        ) ?? false
      ).toBe(operation.idempotent);
    }
  });

  it("omits private provider and household fields", () => {
    const document = OpenApi.fromApi(RecipeImportApi);
    const serializedDocument = JSON.stringify(document);
    for (const privateField of [
      "actorId",
      "evidenceReferences",
      "householdScopeId",
      "model",
      "provider",
      "r2Reference",
      "submittedUrl",
      "transcript",
    ]) {
      expect(serializedDocument).not.toContain(`"${privateField}"`);
    }
  });

  it("declares the answer-review response contract", () => {
    const document = OpenApi.fromApi(RecipeImportApi);
    expect(
      document.paths[
        "/v1/recipe-import-intents/{id}/actions/{actionId}/answers"
      ]?.post
    ).toMatchObject({
      parameters: expect.arrayContaining([
        expect.objectContaining({ in: "header", name: "idempotency-key" }),
      ]),
      responses: {
        "409": {
          content: { "application/problem+json": expect.any(Object) },
        },
      },
    });

    const answerSchema =
      document.paths[
        "/v1/recipe-import-intents/{id}/actions/{actionId}/answers"
      ]?.post?.responses?.["200"]?.content?.["application/json"]?.schema;
    const answerReference = openApiReferenceName(answerSchema);
    const resolvedAnswerSchema =
      answerReference === undefined
        ? answerSchema
        : document.components.schemas[answerReference];
    expect(resolvedAnswerSchema).toMatchObject({
      properties: {
        action: expect.any(Object),
        object: expect.any(Object),
        status: { enum: ["requires_action"], type: "string" },
      },
      type: "object",
    });
    expect(JSON.stringify(resolvedAnswerSchema)).not.toContain(
      '"actionVersion"'
    );

    const objectSchema = Option.getOrUndefined(
      decodeOpenApiObjectProperty(resolvedAnswerSchema)
    )?.properties.object;
    const objectReference = openApiReferenceName(objectSchema);
    expect(
      objectReference === undefined
        ? objectSchema
        : document.components.schemas[objectReference]
    ).toMatchObject({ enum: ["recipe_import_intent"], type: "string" });
  });
});

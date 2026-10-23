import {
  makeRecipeContent,
  recipeIngredientFromText,
  recipeInstructionFromText,
} from "@meal-planner/recipe-domain";
import {
  CancelRecipeImportIntentRequest,
  ConfirmRecipeImportActionRequest,
  CreateRecipeImportIntentRequest,
  RecipeImportAction,
  RecipeImportIntent,
  RecipeImportTimeline,
} from "@meal-planner/recipe-import-api";
import { Effect, Redacted, Schema } from "effect";

import type { ProductScope } from "./product-api.contract.js";
import { makeProductMcpState } from "./product-mcp-state.js";
import type { ProductMcpDispatch } from "./product-mcp-tools.js";

export const familyId = "family-transport-test";
export const intentId = "018f47ad-91aa-7c35-b6fe-000000000001";
export const actionId = "a".repeat(64);
const recipeId = "018f47ad-91aa-7c35-b6fe-000000000003";
const intentPath = `/v1/recipe-import-intents/${intentId}`;
const actionPath = `${intentPath}/actions/${actionId}`;
const sourceUrl = "https://www.tiktok.com/@household/video/123";
const strict = { onExcessProperty: "error" } as const;

export const createArguments = {
  familyId,
  headers: { "idempotency-key": "transport-create-1" },
  input: { source: { kind: "tiktok", url: sourceUrl } },
};
export const confirmArguments = {
  familyId,
  headers: { "idempotency-key": "transport-confirm-1" },
  input: { expectedActionVersion: 1 },
  path: { actionId, id: intentId },
};

/**
 * A transport seam fixture, not a provider/database substitute: public request
 * and response schemas are real; transitions, membership and receipts are in
 * memory. Native domain persistence and OAuth admission have separate tests.
 */
export const makeImportTransportFixture = () => {
  const at = new Date(Date.now() - 1000).toISOString();
  const actionReference = {
    id: actionId,
    link: actionPath,
    type: "review_recipe",
  } as const;
  const resolvedSource = {
    canonicalUrl: sourceUrl,
    kind: "tiktok",
    resolution: "resolved",
  } as const;
  const common = {
    createdAt: at,
    id: intentId,
    links: { self: intentPath, timeline: `${intentPath}/timeline` },
    object: "recipe_import_intent",
    updatedAt: at,
  } as const;
  const recipe = makeRecipeContent({
    ingredients: [recipeIngredientFromText("500 g potatoes, peeled")],
    instructions: [recipeInstructionFromText("Simmer for 20 minutes.", 1)],
    name: "Potato soup",
    notes: ["Taste before seasoning."],
  });
  const tags = {
    cuisines: ["Irish"],
    difficulty: "easy",
    leftovers: "one_meal",
    mealTypes: ["dinner"],
    totalTimeBand: "under_30_minutes",
  } as const;
  const decodeIntent = Schema.decodeUnknownSync(RecipeImportIntent, strict);
  let intent = decodeIntent({
    ...common,
    activity: { type: "working" },
    intentVersion: 1,
    processing: { startedAt: at, type: "resolving_source" },
    source: { kind: "tiktok", resolution: "pending" },
    status: "processing",
  });
  let action = Schema.decodeUnknownSync(
    RecipeImportAction,
    strict
  )({
    actionVersion: 1,
    id: actionId,
    intentId,
    object: "recipe_import_action",
    review: {
      answers: [],
      blockers: { invalidFields: [], unresolvedRequiredFields: [] },
      editableFields: ["name", "ingredients", "instructions", "tags"],
      recipe,
      tags,
    },
    status: "active",
    type: "review_recipe",
  });
  const events: unknown[] = [{ at, intentVersion: 1, type: "intent_admitted" }];
  const append = (event: object) => {
    events.push({ at, intentVersion: events.length + 1, ...event });
  };
  const transition = (fields: object) => {
    intent = decodeIntent({
      ...common,
      intentVersion: events.length,
      source: resolvedSource,
      ...fields,
    });
  };
  const receipts = new Map<string, typeof RecipeImportIntent.Type>();
  const creationReceipts = new Set<string>();
  const requests: { method: string; path: string; key: string | null }[] = [];
  const cancellations: { expectedIntentVersion: number; key: string }[] = [];
  let publications = 0;
  let member = true;
  let loseCreateResponse = false;
  let advanceBeforeCancellation = false;
  const intentResponse = (value = intent, status = 200) =>
    Response.json(Schema.encodeSync(RecipeImportIntent)(value), { status });
  const conflict = () =>
    Response.json({ code: "version_conflict" }, { status: 409 });

  const route = async (request: Request): Promise<Response> => {
    const path = new URL(request.url).pathname;
    const operation = `${request.method} ${path}`;
    const key = request.headers.get("idempotency-key");
    requests.push({ key, method: request.method, path });
    if (
      !member ||
      request.headers.get("x-meal-planner-household") !== familyId
    ) {
      return Response.json({ code: "forbidden" }, { status: 403 });
    }
    if (operation === "POST /v1/recipe-import-intents") {
      Schema.decodeUnknownSync(
        CreateRecipeImportIntentRequest,
        strict
      )(await request.json());
      if (key === null) {
        return Response.json({}, { status: 400 });
      }
      creationReceipts.add(key);
      if (loseCreateResponse) {
        loseCreateResponse = false;
        throw new Error("Fixture lost the response after durable admission");
      }
      return intentResponse(intent, 201);
    }
    if (operation === `GET ${intentPath}`) {
      return intentResponse();
    }
    if (operation === `GET ${intentPath}/timeline`) {
      const timeline = Schema.decodeUnknownSync(
        RecipeImportTimeline,
        strict
      )({
        data: events,
        object: "list",
      });
      return Response.json(Schema.encodeSync(RecipeImportTimeline)(timeline));
    }
    if (operation === `GET ${actionPath}`) {
      if (intent.status === "cancelled") {
        return Response.json({ code: "action_not_found" }, { status: 404 });
      }
      return Response.json(Schema.encodeSync(RecipeImportAction)(action));
    }
    if (operation === `POST ${actionPath}/confirm`) {
      const payload = Schema.decodeUnknownSync(
        ConfirmRecipeImportActionRequest,
        strict
      )(await request.json());
      if (key === null) {
        return Response.json({}, { status: 400 });
      }
      const previous = receipts.get(key);
      if (previous !== undefined) {
        return intentResponse(previous);
      }
      if (
        payload.expectedActionVersion !== action.actionVersion ||
        action.status !== "active"
      ) {
        return conflict();
      }
      publications += 1;
      append({ recipeId, type: "intent_succeeded" });
      transition({
        completedAt: at,
        result: { recipeId },
        status: "succeeded",
      });
      action = Schema.decodeUnknownSync(
        RecipeImportAction,
        strict
      )({
        ...Schema.encodeSync(RecipeImportAction)(action),
        completion: { confirmedAt: at, type: "confirmed" },
        status: "completed",
      });
      receipts.set(key, intent);
      return intentResponse();
    }
    if (operation === `POST ${intentPath}/cancel`) {
      const payload = Schema.decodeUnknownSync(
        CancelRecipeImportIntentRequest,
        strict
      )(await request.json());
      if (key === null) {
        return Response.json({}, { status: 400 });
      }
      cancellations.push({
        expectedIntentVersion: payload.expectedIntentVersion,
        key,
      });
      if (advanceBeforeCancellation) {
        advanceBeforeCancellation = false;
        append({ canonicalUrl: sourceUrl, type: "source_resolved" });
        transition({
          activity: { type: "working" },
          processing: { startedAt: at, type: "extracting_recipe" },
          status: "processing",
        });
      }
      if (payload.expectedIntentVersion !== intent.intentVersion) {
        return conflict();
      }
      append({ type: "intent_cancelled" });
      transition({ cancelledAt: at, status: "cancelled" });
      return intentResponse();
    }
    return Response.json({ code: "not_found" }, { status: 404 });
  };

  return {
    cancelDomain: () => {
      append({ type: "intent_cancelled" });
      transition({ cancelledAt: at, status: "cancelled" });
    },
    cancellations,
    changeReview: () => {
      action = Schema.decodeUnknownSync(
        RecipeImportAction,
        strict
      )({
        ...Schema.encodeSync(RecipeImportAction)(action),
        actionVersion: action.actionVersion + 1,
      });
    },
    creationReceipts,
    dispatch: (
      options: {
        owner?: { clientId: string; userId: string };
        scopes?: readonly ProductScope[];
      } = {}
    ): Effect.Effect<ProductMcpDispatch> =>
      makeProductMcpState({
        owner: options.owner ?? {
          clientId: "transport-client",
          userId: "transport-user",
        },
        secret: Redacted.make(
          "transport-only-secret-with-more-than-32-characters"
        ),
      }).pipe(
        Effect.map((state) => ({
          call: (request: Request) => Effect.promise(() => route(request)),
          permits: (scopes: readonly ProductScope[]) =>
            scopes.every((scope) =>
              (
                options.scopes ?? ["meal-planner:read", "meal-planner:write"]
              ).includes(scope)
            ),
          state,
        })),
        Effect.orDie
      ),
    fail: () => {
      append({ code: "analysis_failed", type: "intent_failed" });
      transition({
        error: {
          code: "analysis_failed",
          message: "Provider unavailable",
          recovery: "none",
        },
        failedAt: at,
        status: "failed",
      });
    },
    getPublications: () => publications,
    getStatus: () => intent.status,
    loseNextCreateResponse: () => {
      loseCreateResponse = true;
    },
    raceNextCancellation: () => {
      advanceBeforeCancellation = true;
    },
    ready: () => {
      append({ canonicalUrl: sourceUrl, type: "source_resolved" });
      append({ action: actionReference, type: "action_available" });
      transition({ action: actionReference, status: "requires_action" });
    },
    redirect: () => {
      const redirect = {
        intentId: "018f47ad-91aa-7c35-b6fe-000000000009",
        link: "/v1/recipe-import-intents/018f47ad-91aa-7c35-b6fe-000000000009",
      };
      append({ redirect, type: "intent_redirected" });
      transition({ redirect, redirectedAt: at, status: "redirected" });
    },
    requests,
    review: { recipe, tags },
    revokeMembership: () => {
      member = false;
    },
  };
};

import {
  IntentRedirectedProblem,
  makeRecipeImportApiClientLayer,
  ProblemDetails,
  RecipeImportApiClient,
} from "@meal-planner/recipe-import-api";
import type {
  AnswerReviewRecipeActionRequest,
  CancelRecipeImportIntentRequest,
  ConfirmRecipeImportActionRequest,
  CreateRecipeImportIntentRequest,
  IdempotencyKey,
  RecipeImportActionId,
  RecipeImportIntentId,
  Recipe,
} from "@meal-planner/recipe-import-api";
import { Cause, Data, Effect, Layer, Option, Schema } from "effect";

import {
  apiHttpLayer,
  queryFailure,
  queryFailureCause,
} from "../api-client/index.js";
import type { ApiRuntime } from "../api-client/index.js";
import { displayedIdentityHeaders } from "../auth/index.js";
import type { DisplayedIdentity } from "../auth/index.js";

class RecipeImportOperationError<Failure> extends Data.TaggedError(
  "RecipeImportOperationError"
)<{ readonly cause: Failure }> {}

/** Classify the current attempt; an earlier unknown result must still be preserved by the caller. */
export const isDefiniteRecipeImportRejection = (error: Error | null) => {
  const cause = queryFailureCause(error);
  if (
    Option.isSome(cause) &&
    (cause.value.reasons.length !== 1 ||
      !cause.value.reasons.every(Cause.isFailReason))
  ) {
    return false;
  }
  const failure = queryFailure(error);
  if (!(failure instanceof RecipeImportOperationError)) {
    return false;
  }
  const problem = Schema.decodeUnknownOption(ProblemDetails)(failure.cause);
  return (
    (Option.isSome(problem) && problem.value.status < 500) ||
    Schema.is(IntentRedirectedProblem)(failure.cause)
  );
};

const makeClientRunner = (runtime: ApiRuntime, scope: DisplayedIdentity) => {
  const layer = makeRecipeImportApiClientLayer({
    baseUrl: runtime.baseUrl,
    headers: displayedIdentityHeaders(scope),
  }).pipe(Layer.provide(apiHttpLayer(runtime)));
  return <A, E>(
    operation: (client: RecipeImportApiClient) => Effect.Effect<A, E>
  ) =>
    RecipeImportApiClient.pipe(
      Effect.flatMap(operation),
      Effect.provide(layer),
      Effect.mapError((cause) => new RecipeImportOperationError({ cause }))
    );
};

/** Generated-client request shaping; the query adapter owns execution. */
export const makeRecipeImportEffectOperations = (
  scope: DisplayedIdentity,
  runtime: ApiRuntime
) => {
  const run = makeClientRunner(runtime, scope);
  return {
    answerAction: (input: {
      readonly actionId: RecipeImportActionId;
      readonly idempotencyKey: IdempotencyKey;
      readonly intentId: RecipeImportIntentId;
      readonly request: AnswerReviewRecipeActionRequest;
    }) =>
      run((client) =>
        client.recipeImportIntents.answerAction({
          headers: { "idempotency-key": input.idempotencyKey },
          params: { actionId: input.actionId, id: input.intentId },
          payload: input.request,
        })
      ),
    cancel: (input: {
      readonly idempotencyKey: IdempotencyKey;
      readonly intentId: RecipeImportIntentId;
      readonly request: CancelRecipeImportIntentRequest;
    }) =>
      run((client) =>
        client.recipeImportIntents.cancel({
          headers: { "idempotency-key": input.idempotencyKey },
          params: { id: input.intentId },
          payload: input.request,
        })
      ),
    confirmAction: (input: {
      readonly actionId: RecipeImportActionId;
      readonly idempotencyKey: IdempotencyKey;
      readonly intentId: RecipeImportIntentId;
      readonly request: ConfirmRecipeImportActionRequest;
    }) =>
      run((client) =>
        client.recipeImportIntents.confirmAction({
          headers: { "idempotency-key": input.idempotencyKey },
          params: { actionId: input.actionId, id: input.intentId },
          payload: input.request,
        })
      ),
    create: (input: {
      readonly idempotencyKey: IdempotencyKey;
      readonly request: CreateRecipeImportIntentRequest;
    }) =>
      run((client) =>
        client.recipeImportIntents
          .create({
            headers: { "idempotency-key": input.idempotencyKey },
            payload: input.request,
          })
          .pipe(Effect.map((response) => response.body))
      ),
    getAction: (input: {
      readonly actionId: RecipeImportActionId;
      readonly intentId: RecipeImportIntentId;
    }) =>
      run((client) =>
        client.recipeImportIntents.getAction({
          params: { actionId: input.actionId, id: input.intentId },
        })
      ),
    getIntent: (input: { readonly intentId: RecipeImportIntentId }) =>
      run((client) =>
        client.recipeImportIntents
          .get({ params: { id: input.intentId } })
          .pipe(Effect.map((response) => response.body))
      ),
    getRecipe: (input: { readonly recipeId: Recipe["id"] }) =>
      run((client) =>
        client.recipes.get({ params: { recipeId: input.recipeId } })
      ),
  };
};

export type RecipeImportOperations = ReturnType<
  typeof makeRecipeImportEffectOperations
>;

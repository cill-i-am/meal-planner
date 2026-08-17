import {
  AnswerReviewRecipeActionRequest,
  CancelRecipeImportIntentRequest,
  ConfirmRecipeImportActionRequest,
  CreateRecipeImportIntentRequest,
  IdempotencyKey,
  RecipeId,
  Recipe,
  RecipeImportAction,
  RecipeImportActionId,
  RecipeImportIntentId,
  RecipeImportIntent,
} from "@meal-planner/recipe-import-api";
import type { RecipeImportApiClientShape } from "@meal-planner/recipe-import-api";
import { createServerFn } from "@tanstack/react-start";
import { Effect, Schema } from "effect";

import {
  RecipeImportProfileAlias,
  RecipeImportPublicProfileConfiguration,
} from "../profiles.js";
import {
  RecipeImportProfileRegistry,
  recipeImportProfileRuntime,
} from "./recipe-import-api-client.server.js";

const CreateIntentInput = Schema.Struct({
  idempotencyKey: IdempotencyKey,
  profileAlias: RecipeImportProfileAlias,
  request: CreateRecipeImportIntentRequest,
});
const GetIntentInput = Schema.Struct({
  intentId: RecipeImportIntentId,
  profileAlias: RecipeImportProfileAlias,
});
const GetActionInput = Schema.Struct({
  actionId: RecipeImportActionId,
  intentId: RecipeImportIntentId,
  profileAlias: RecipeImportProfileAlias,
});
const ConfirmActionInput = Schema.Struct({
  actionId: RecipeImportActionId,
  idempotencyKey: IdempotencyKey,
  intentId: RecipeImportIntentId,
  profileAlias: RecipeImportProfileAlias,
  request: ConfirmRecipeImportActionRequest,
});
const AnswerActionInput = Schema.Struct({
  actionId: RecipeImportActionId,
  idempotencyKey: IdempotencyKey,
  intentId: RecipeImportIntentId,
  profileAlias: RecipeImportProfileAlias,
  request: AnswerReviewRecipeActionRequest,
});
const CancelIntentInput = Schema.Struct({
  idempotencyKey: IdempotencyKey,
  intentId: RecipeImportIntentId,
  profileAlias: RecipeImportProfileAlias,
  request: CancelRecipeImportIntentRequest,
});
const GetRecipeInput = Schema.Struct({
  profileAlias: RecipeImportProfileAlias,
  recipeId: RecipeId,
});

const validate =
  <S extends Schema.ConstraintDecoder<unknown>>(schema: S) =>
  (input: unknown): S["Type"] => {
    try {
      return Schema.decodeUnknownSync(schema, { onExcessProperty: "error" })(
        input
      );
    } catch {
      throw new Error("Invalid recipe import request.");
    }
  };

const recipeImportUnavailable = () =>
  new Error("Recipe importing is unavailable.");

const run = async <A, E>(
  profileAlias: typeof RecipeImportProfileAlias.Type,
  operation: (client: RecipeImportApiClientShape) => Effect.Effect<A, E>
) => {
  try {
    return await recipeImportProfileRuntime.runPromise(
      Effect.gen(function* runProfileOperation() {
        const registry = yield* RecipeImportProfileRegistry;
        const client = yield* registry.clientFor(profileAlias);
        return yield* operation(client);
      }).pipe(Effect.mapError(recipeImportUnavailable))
    );
  } catch {
    throw recipeImportUnavailable();
  }
};

export const getRecipeImportProfileConfiguration = createServerFn({
  method: "GET",
}).handler(async () => {
  try {
    return await recipeImportProfileRuntime.runPromise(
      RecipeImportProfileRegistry.pipe(
        Effect.map((registry) => registry.publicConfiguration),
        Effect.map(Schema.encodeSync(RecipeImportPublicProfileConfiguration))
      )
    );
  } catch {
    throw recipeImportUnavailable();
  }
});

export const createRecipeImportIntent = createServerFn({ method: "POST" })
  .validator(validate(CreateIntentInput))
  .handler(({ data }) =>
    run(data.profileAlias, (client) =>
      client.recipeImportIntents
        .create({
          headers: { "idempotency-key": data.idempotencyKey },
          payload: data.request,
        })
        .pipe(
          Effect.map((response) => response.body),
          Effect.map(Schema.encodeSync(RecipeImportIntent))
        )
    )
  );

export const getRecipeImportIntent = createServerFn({ method: "GET" })
  .validator(validate(GetIntentInput))
  .handler(({ data }) =>
    run(data.profileAlias, (client) =>
      client.recipeImportIntents
        .get({
          params: { id: data.intentId },
        })
        .pipe(
          Effect.map((response) => response.body),
          Effect.map(Schema.encodeSync(RecipeImportIntent))
        )
    )
  );

export const getRecipeImportAction = createServerFn({ method: "GET" })
  .validator(validate(GetActionInput))
  .handler(({ data }) =>
    run(data.profileAlias, (client) =>
      client.recipeImportIntents
        .getAction({
          params: { actionId: data.actionId, id: data.intentId },
        })
        .pipe(Effect.map(Schema.encodeSync(RecipeImportAction)))
    )
  );

export const answerRecipeImportAction = createServerFn({ method: "POST" })
  .validator(validate(AnswerActionInput))
  .handler(({ data }) =>
    run(data.profileAlias, (client) =>
      client.recipeImportIntents
        .answerAction({
          headers: { "idempotency-key": data.idempotencyKey },
          params: { actionId: data.actionId, id: data.intentId },
          payload: data.request,
        })
        .pipe(Effect.map(Schema.encodeSync(RecipeImportIntent)))
    )
  );

export const confirmRecipeImportAction = createServerFn({ method: "POST" })
  .validator(validate(ConfirmActionInput))
  .handler(({ data }) =>
    run(data.profileAlias, (client) =>
      client.recipeImportIntents
        .confirmAction({
          headers: { "idempotency-key": data.idempotencyKey },
          params: { actionId: data.actionId, id: data.intentId },
          payload: data.request,
        })
        .pipe(Effect.map(Schema.encodeSync(RecipeImportIntent)))
    )
  );

export const cancelRecipeImportIntent = createServerFn({ method: "POST" })
  .validator(validate(CancelIntentInput))
  .handler(({ data }) =>
    run(data.profileAlias, (client) =>
      client.recipeImportIntents
        .cancel({
          headers: { "idempotency-key": data.idempotencyKey },
          params: { id: data.intentId },
          payload: data.request,
        })
        .pipe(Effect.map(Schema.encodeSync(RecipeImportIntent)))
    )
  );

export const getImportedRecipe = createServerFn({ method: "GET" })
  .validator(validate(GetRecipeInput))
  .handler(({ data }) =>
    run(data.profileAlias, (client) =>
      client.recipes
        .get({ params: { recipeId: data.recipeId } })
        .pipe(Effect.map(Schema.encodeSync(Recipe)))
    )
  );

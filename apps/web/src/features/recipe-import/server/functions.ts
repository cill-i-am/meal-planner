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
  RecipeImportApiClient,
  RecipeImportIntentId,
  RecipeImportIntent,
} from "@meal-planner/recipe-import-api";
import { createServerFn } from "@tanstack/react-start";
import { Effect, Redacted, Schema } from "effect";

import { makeRuntimeRecipeImportApiClientLayer } from "./recipe-import-api-client.server.js";

const RuntimeConfiguration = Schema.Struct({
  baseUrl: Schema.String.pipe(Schema.check(Schema.isNonEmpty())),
  token: Schema.String.pipe(Schema.check(Schema.isNonEmpty())),
});
const CreateIntentInput = Schema.Struct({
  idempotencyKey: IdempotencyKey,
  request: CreateRecipeImportIntentRequest,
});
const GetIntentInput = Schema.Struct({ intentId: RecipeImportIntentId });
const GetActionInput = Schema.Struct({
  actionId: RecipeImportActionId,
  intentId: RecipeImportIntentId,
});
const ConfirmActionInput = Schema.Struct({
  actionId: RecipeImportActionId,
  idempotencyKey: IdempotencyKey,
  intentId: RecipeImportIntentId,
  request: ConfirmRecipeImportActionRequest,
});
const AnswerActionInput = Schema.Struct({
  actionId: RecipeImportActionId,
  idempotencyKey: IdempotencyKey,
  intentId: RecipeImportIntentId,
  request: AnswerReviewRecipeActionRequest,
});
const CancelIntentInput = Schema.Struct({
  idempotencyKey: IdempotencyKey,
  intentId: RecipeImportIntentId,
  request: CancelRecipeImportIntentRequest,
});
const GetRecipeInput = Schema.Struct({ recipeId: RecipeId });

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

const runtimeClientLayer = () => {
  try {
    const configuration = Schema.decodeUnknownSync(RuntimeConfiguration)({
      baseUrl: process.env["RECIPE_IMPORT_API_BASE_URL"],
      token: process.env["RECIPE_IMPORT_API_TOKEN"],
    });
    return makeRuntimeRecipeImportApiClientLayer({
      baseUrl: configuration.baseUrl,
      token: Redacted.make(configuration.token),
    });
  } catch {
    throw new Error("Recipe importing is unavailable.");
  }
};

const run = <A, E>(program: Effect.Effect<A, E, RecipeImportApiClient>) =>
  Effect.runPromise(
    program.pipe(
      Effect.mapError(() => new Error("Recipe importing is unavailable.")),
      Effect.provide(runtimeClientLayer())
    )
  );

export const createRecipeImportIntent = createServerFn({ method: "POST" })
  .validator(validate(CreateIntentInput))
  .handler(({ data }) =>
    run(
      Effect.gen(function* createIntent() {
        const client = yield* RecipeImportApiClient;
        return yield* client.recipeImportIntents.create({
          headers: { "idempotency-key": data.idempotencyKey },
          payload: data.request,
        });
      }).pipe(
        Effect.map((response) => response.body),
        Effect.map(Schema.encodeSync(RecipeImportIntent))
      )
    )
  );

export const getRecipeImportIntent = createServerFn({ method: "GET" })
  .validator(validate(GetIntentInput))
  .handler(({ data }) =>
    run(
      Effect.gen(function* getIntent() {
        const client = yield* RecipeImportApiClient;
        return yield* client.recipeImportIntents.get({
          params: { id: data.intentId },
        });
      }).pipe(
        Effect.map((response) => response.body),
        Effect.map(Schema.encodeSync(RecipeImportIntent))
      )
    )
  );

export const getRecipeImportAction = createServerFn({ method: "GET" })
  .validator(validate(GetActionInput))
  .handler(({ data }) =>
    run(
      Effect.gen(function* getAction() {
        const client = yield* RecipeImportApiClient;
        return yield* client.recipeImportIntents.getAction({
          params: { actionId: data.actionId, id: data.intentId },
        });
      }).pipe(Effect.map(Schema.encodeSync(RecipeImportAction)))
    )
  );

export const answerRecipeImportAction = createServerFn({ method: "POST" })
  .validator(validate(AnswerActionInput))
  .handler(({ data }) =>
    run(
      Effect.gen(function* answerAction() {
        const client = yield* RecipeImportApiClient;
        return yield* client.recipeImportIntents.answerAction({
          headers: { "idempotency-key": data.idempotencyKey },
          params: { actionId: data.actionId, id: data.intentId },
          payload: data.request,
        });
      }).pipe(Effect.map(Schema.encodeSync(RecipeImportIntent)))
    )
  );

export const confirmRecipeImportAction = createServerFn({ method: "POST" })
  .validator(validate(ConfirmActionInput))
  .handler(({ data }) =>
    run(
      Effect.gen(function* confirmAction() {
        const client = yield* RecipeImportApiClient;
        return yield* client.recipeImportIntents.confirmAction({
          headers: { "idempotency-key": data.idempotencyKey },
          params: { actionId: data.actionId, id: data.intentId },
          payload: data.request,
        });
      }).pipe(Effect.map(Schema.encodeSync(RecipeImportIntent)))
    )
  );

export const cancelRecipeImportIntent = createServerFn({ method: "POST" })
  .validator(validate(CancelIntentInput))
  .handler(({ data }) =>
    run(
      Effect.gen(function* cancelIntent() {
        const client = yield* RecipeImportApiClient;
        return yield* client.recipeImportIntents.cancel({
          headers: { "idempotency-key": data.idempotencyKey },
          params: { id: data.intentId },
          payload: data.request,
        });
      }).pipe(Effect.map(Schema.encodeSync(RecipeImportIntent)))
    )
  );

export const getImportedRecipe = createServerFn({ method: "GET" })
  .validator(validate(GetRecipeInput))
  .handler(({ data }) =>
    run(
      Effect.gen(function* getRecipe() {
        const client = yield* RecipeImportApiClient;
        return yield* client.recipes.get({ params: data });
      }).pipe(Effect.map(Schema.encodeSync(Recipe)))
    )
  );

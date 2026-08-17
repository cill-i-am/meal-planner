import {
  Recipe,
  RecipeImportAction,
  RecipeImportIntent,
} from "@meal-planner/recipe-import-api";
import type {
  AnswerReviewRecipeActionRequest,
  CancelRecipeImportIntentRequest,
  ConfirmRecipeImportActionRequest,
  CreateRecipeImportIntentRequest,
  IdempotencyKey,
  RecipeImportActionId,
  RecipeImportIntentId,
} from "@meal-planner/recipe-import-api";
import { Schema } from "effect";

import type { RecipeImportProfileAlias } from "./profiles.js";

export interface RecipeImportOperations {
  readonly answerAction: (input: {
    readonly actionId: RecipeImportActionId;
    readonly idempotencyKey: IdempotencyKey;
    readonly intentId: RecipeImportIntentId;
    readonly request: AnswerReviewRecipeActionRequest;
  }) => Promise<RecipeImportIntent>;
  readonly cancel: (input: {
    readonly idempotencyKey: IdempotencyKey;
    readonly intentId: RecipeImportIntentId;
    readonly request: CancelRecipeImportIntentRequest;
  }) => Promise<RecipeImportIntent>;
  readonly confirmAction: (input: {
    readonly actionId: RecipeImportActionId;
    readonly idempotencyKey: IdempotencyKey;
    readonly intentId: RecipeImportIntentId;
    readonly request: ConfirmRecipeImportActionRequest;
  }) => Promise<RecipeImportIntent>;
  readonly create: (input: {
    readonly idempotencyKey: IdempotencyKey;
    readonly request: CreateRecipeImportIntentRequest;
  }) => Promise<RecipeImportIntent>;
  readonly getAction: (input: {
    readonly actionId: RecipeImportActionId;
    readonly intentId: RecipeImportIntentId;
  }) => Promise<RecipeImportAction>;
  readonly getIntent: (input: {
    readonly intentId: RecipeImportIntentId;
  }) => Promise<RecipeImportIntent>;
  readonly getRecipe: (input: {
    readonly recipeId: Recipe["id"];
  }) => Promise<Recipe>;
}

interface ProfiledServerData<T> {
  readonly data: T & { readonly profileAlias: RecipeImportProfileAlias };
}

export interface RecipeImportServerOperations {
  readonly answerAction: (
    options: ProfiledServerData<
      Parameters<RecipeImportOperations["answerAction"]>[0]
    >
  ) => Promise<unknown>;
  readonly cancel: (
    options: ProfiledServerData<Parameters<RecipeImportOperations["cancel"]>[0]>
  ) => Promise<unknown>;
  readonly confirmAction: (
    options: ProfiledServerData<
      Parameters<RecipeImportOperations["confirmAction"]>[0]
    >
  ) => Promise<unknown>;
  readonly create: (
    options: ProfiledServerData<Parameters<RecipeImportOperations["create"]>[0]>
  ) => Promise<unknown>;
  readonly getAction: (
    options: ProfiledServerData<
      Parameters<RecipeImportOperations["getAction"]>[0]
    >
  ) => Promise<unknown>;
  readonly getIntent: (
    options: ProfiledServerData<
      Parameters<RecipeImportOperations["getIntent"]>[0]
    >
  ) => Promise<unknown>;
  readonly getRecipe: (
    options: ProfiledServerData<
      Parameters<RecipeImportOperations["getRecipe"]>[0]
    >
  ) => Promise<unknown>;
}

export const makeRecipeImportOperations = (
  profileAlias: RecipeImportProfileAlias,
  server: RecipeImportServerOperations
): RecipeImportOperations => ({
  answerAction: async (data) =>
    Schema.decodeUnknownSync(RecipeImportIntent)(
      await server.answerAction({ data: { ...data, profileAlias } })
    ),
  cancel: async (data) =>
    Schema.decodeUnknownSync(RecipeImportIntent)(
      await server.cancel({ data: { ...data, profileAlias } })
    ),
  confirmAction: async (data) =>
    Schema.decodeUnknownSync(RecipeImportIntent)(
      await server.confirmAction({ data: { ...data, profileAlias } })
    ),
  create: async (data) =>
    Schema.decodeUnknownSync(RecipeImportIntent)(
      await server.create({ data: { ...data, profileAlias } })
    ),
  getAction: async (data) =>
    Schema.decodeUnknownSync(RecipeImportAction)(
      await server.getAction({ data: { ...data, profileAlias } })
    ),
  getIntent: async (data) =>
    Schema.decodeUnknownSync(RecipeImportIntent)(
      await server.getIntent({ data: { ...data, profileAlias } })
    ),
  getRecipe: async (data) =>
    Schema.decodeUnknownSync(Recipe)(
      await server.getRecipe({ data: { ...data, profileAlias } })
    ),
});

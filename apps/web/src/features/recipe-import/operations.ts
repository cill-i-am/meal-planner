import type {
  AnswerReviewRecipeActionRequest,
  CancelRecipeImportIntentRequest,
  ConfirmRecipeImportActionRequest,
  CreateRecipeImportIntentRequest,
  IdempotencyKey,
  Recipe,
  RecipeImportAction,
  RecipeImportActionId,
  RecipeImportIntent,
  RecipeImportIntentId,
} from "@meal-planner/recipe-import-api";

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

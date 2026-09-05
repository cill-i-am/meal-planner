import type {
  AnswerReviewRecipeActionRequest,
  RequiresActionRecipeImportIntent,
  CancelledRecipeImportIntent,
  SucceededRecipeImportIntent,
  ProcessingRecipeImportIntent,
  CancelRecipeImportIntentRequest,
  ConfirmRecipeImportActionRequest,
  CreateRecipeImportIntentRequest,
  IdempotencyKey,
  RecipeImportAction,
  RecipeImportActionId,
  RecipeImportIntent,
  RecipeImportIntentId,
  Recipe,
} from "@meal-planner/recipe-import-api";

export interface RecipeImportOperations {
  readonly answerAction: (input: {
    readonly actionId: RecipeImportActionId;
    readonly idempotencyKey: IdempotencyKey;
    readonly intentId: RecipeImportIntentId;
    readonly request: AnswerReviewRecipeActionRequest;
  }) => Promise<RequiresActionRecipeImportIntent>;
  readonly cancel: (input: {
    readonly idempotencyKey: IdempotencyKey;
    readonly intentId: RecipeImportIntentId;
    readonly request: CancelRecipeImportIntentRequest;
  }) => Promise<CancelledRecipeImportIntent>;
  readonly confirmAction: (input: {
    readonly actionId: RecipeImportActionId;
    readonly idempotencyKey: IdempotencyKey;
    readonly intentId: RecipeImportIntentId;
    readonly request: ConfirmRecipeImportActionRequest;
  }) => Promise<SucceededRecipeImportIntent>;
  readonly create: (input: {
    readonly idempotencyKey: IdempotencyKey;
    readonly request: CreateRecipeImportIntentRequest;
  }) => Promise<ProcessingRecipeImportIntent>;
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

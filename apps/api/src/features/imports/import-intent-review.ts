import { Recipe } from "@meal-planner/recipe-import-api";
import type {
  AnswerReviewRecipeActionRequest,
  ConfirmRecipeImportActionRequest,
  IdempotencyKey,
  Recipe as PublicRecipe,
  RecipeId,
  RecipeImportAction,
  RecipeImportActionId,
  RecipeImportIntentId,
  RequiresActionRecipeImportIntent,
  SucceededRecipeImportIntent,
} from "@meal-planner/recipe-import-api";
import { Clock, Context, Effect, Schema } from "effect";

import type { ImportPrincipal } from "./import-intent.js";
import type { ApprovedReview } from "./import-recipe-review.js";
import {
  RecipeReviewerActorId,
  applyCorrectionOverlay,
} from "./import-recipe-review.js";
import type {
  ImportPersistenceCorrupt,
  ImportPersistenceUnavailable,
} from "./import.errors.js";

const Sha256Hex = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[a-f\d]{64}$/u))
);

export const RecipeImportActionMutationId = Sha256Hex.pipe(
  Schema.brand("RecipeImportActionMutationId")
);
export type RecipeImportActionMutationId =
  typeof RecipeImportActionMutationId.Type;

export const RecipeImportActionCommandDigest = Sha256Hex.pipe(
  Schema.brand("RecipeImportActionCommandDigest")
);
export type RecipeImportActionCommandDigest =
  typeof RecipeImportActionCommandDigest.Type;

export interface RecipeImportActionNotFound {
  readonly _tag: "RecipeImportActionNotFound";
}
export const RecipeImportActionNotFound =
  // eslint-disable-next-line unicorn/throw-new-error -- Schema.TaggedError is Effect's constructor factory, not a thrown expression.
  Schema.TaggedError<RecipeImportActionNotFound>()(
    "RecipeImportActionNotFound",
    {}
  );

export interface RecipeImportActionVersionConflict {
  readonly _tag: "RecipeImportActionVersionConflict";
}
export const RecipeImportActionVersionConflict =
  // eslint-disable-next-line unicorn/throw-new-error -- Schema.TaggedError is Effect's constructor factory, not a thrown expression.
  Schema.TaggedError<RecipeImportActionVersionConflict>()(
    "RecipeImportActionVersionConflict",
    {}
  );

export interface RecipeImportActionMutationConflict {
  readonly _tag: "RecipeImportActionMutationConflict";
}
export const RecipeImportActionMutationConflict =
  // eslint-disable-next-line unicorn/throw-new-error -- Schema.TaggedError is Effect's constructor factory, not a thrown expression.
  Schema.TaggedError<RecipeImportActionMutationConflict>()(
    "RecipeImportActionMutationConflict",
    {}
  );

export interface RecipeImportActionTransitionRejected {
  readonly _tag: "RecipeImportActionTransitionRejected";
}
export const RecipeImportActionTransitionRejected =
  // eslint-disable-next-line unicorn/throw-new-error -- Schema.TaggedError is Effect's constructor factory, not a thrown expression.
  Schema.TaggedError<RecipeImportActionTransitionRejected>()(
    "RecipeImportActionTransitionRejected",
    {}
  );

export interface RecipeImportRecipeNotFound {
  readonly _tag: "RecipeImportRecipeNotFound";
}
export const RecipeImportRecipeNotFound =
  // eslint-disable-next-line unicorn/throw-new-error -- Schema.TaggedError is Effect's constructor factory, not a thrown expression.
  Schema.TaggedError<RecipeImportRecipeNotFound>()(
    "RecipeImportRecipeNotFound",
    {}
  );

export type RecipeImportIntentReviewError =
  | ImportPersistenceCorrupt
  | ImportPersistenceUnavailable
  | RecipeImportActionMutationConflict
  | RecipeImportActionNotFound
  | RecipeImportActionTransitionRejected
  | RecipeImportActionVersionConflict
  | RecipeImportRecipeNotFound;

const bytesToHex = (value: ArrayBuffer) =>
  Array.from(new Uint8Array(value), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");

const sha256Hex = (value: string) =>
  Effect.promise(() =>
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
  ).pipe(Effect.map(bytesToHex));

const canonicalPlanningTags = (
  tags: Extract<
    AnswerReviewRecipeActionRequest["answers"][number],
    { readonly field: "tags" }
  >["value"]
) => ({
  cuisines: [...tags.cuisines],
  dietaryFit: tags.dietaryFit,
  difficulty: tags.difficulty,
  leftovers: tags.leftovers,
  mealTypes: [...tags.mealTypes],
  totalTimeBand: tags.totalTimeBand,
});

const canonicalAnswers = (
  answers: AnswerReviewRecipeActionRequest["answers"]
) =>
  answers
    .toSorted((left, right) => left.field.localeCompare(right.field))
    .map((answer) => ({
      field: answer.field,
      value:
        answer.field === "tags"
          ? canonicalPlanningTags(answer.value)
          : answer.value,
    }));

export const recipeImportActionMutationId = (input: {
  readonly actionId: RecipeImportActionId;
  readonly idempotencyKey: IdempotencyKey;
  readonly intentId: RecipeImportIntentId;
  readonly principal: ImportPrincipal;
}) =>
  sha256Hex(
    `recipe-import-action-mutation:v1:${input.principal.actorId}:${input.intentId}:${input.actionId}:${input.idempotencyKey}`
  ).pipe(Effect.map(Schema.decodeUnknownSync(RecipeImportActionMutationId)));

export const recipeImportActionAnswerDigest = (input: {
  readonly actionId: RecipeImportActionId;
  readonly intentId: RecipeImportIntentId;
  readonly principal: ImportPrincipal;
  readonly request: AnswerReviewRecipeActionRequest;
}) =>
  sha256Hex(
    JSON.stringify({
      actionId: input.actionId,
      actorId: input.principal.actorId,
      answers: canonicalAnswers(input.request.answers),
      expectedActionVersion: input.request.expectedActionVersion,
      householdScopeId: input.principal.householdScopeId,
      intentId: input.intentId,
      operation: "answer",
      version: 1,
    })
  ).pipe(Effect.map(Schema.decodeUnknownSync(RecipeImportActionCommandDigest)));

export const recipeImportActionConfirmDigest = (input: {
  readonly actionId: RecipeImportActionId;
  readonly intentId: RecipeImportIntentId;
  readonly principal: ImportPrincipal;
  readonly request: ConfirmRecipeImportActionRequest;
}) =>
  sha256Hex(
    JSON.stringify({
      actionId: input.actionId,
      actorId: input.principal.actorId,
      expectedActionVersion: input.request.expectedActionVersion,
      householdScopeId: input.principal.householdScopeId,
      intentId: input.intentId,
      operation: "confirm",
      version: 1,
    })
  ).pipe(Effect.map(Schema.decodeUnknownSync(RecipeImportActionCommandDigest)));

export const succeededRecipeMutationId = (
  mutationId: RecipeImportActionMutationId
) =>
  sha256Hex(`recipe-import-action-succeeded:v1:${mutationId}`).pipe(
    Effect.map(Schema.decodeUnknownSync(RecipeImportActionMutationId))
  );

export const projectPublicRecipe = (
  recipeId: RecipeId,
  review: ApprovedReview
): PublicRecipe =>
  Schema.decodeUnknownSync(Recipe, { onExcessProperty: "error" })({
    id: recipeId,
    object: "recipe",
    recipe: applyCorrectionOverlay(review.draft, review.corrections),
    tags: review.tags,
  });

export interface AnswerRecipeImportActionCommand {
  readonly actionId: RecipeImportActionId;
  readonly actorId: typeof RecipeReviewerActorId.Type;
  readonly answeredAt: string;
  readonly commandDigest: RecipeImportActionCommandDigest;
  readonly intentId: RecipeImportIntentId;
  readonly mutationId: RecipeImportActionMutationId;
  readonly principal: ImportPrincipal;
  readonly request: AnswerReviewRecipeActionRequest;
}

export interface ConfirmRecipeImportActionCommand {
  readonly actionId: RecipeImportActionId;
  readonly actorId: typeof RecipeReviewerActorId.Type;
  readonly commandDigest: RecipeImportActionCommandDigest;
  readonly confirmedAt: string;
  readonly intentId: RecipeImportIntentId;
  readonly mutationId: RecipeImportActionMutationId;
  readonly principal: ImportPrincipal;
  readonly request: ConfirmRecipeImportActionRequest;
  readonly succeededMutationId: RecipeImportActionMutationId;
}

export interface RecipeImportIntentReviewRepositoryShape {
  readonly answerAction: (
    command: AnswerRecipeImportActionCommand
  ) => Effect.Effect<
    RequiresActionRecipeImportIntent,
    RecipeImportIntentReviewError
  >;
  readonly confirmAction: (
    command: ConfirmRecipeImportActionCommand
  ) => Effect.Effect<
    SucceededRecipeImportIntent,
    RecipeImportIntentReviewError
  >;
  readonly getAction: (
    principal: ImportPrincipal,
    intentId: RecipeImportIntentId,
    actionId: RecipeImportActionId
  ) => Effect.Effect<RecipeImportAction, RecipeImportIntentReviewError>;
  readonly getRecipe: (
    principal: ImportPrincipal,
    recipeId: RecipeId
  ) => Effect.Effect<PublicRecipe, RecipeImportIntentReviewError>;
}

export const makeRecipeImportIntentReviewApplication = (
  repository: RecipeImportIntentReviewRepositoryShape
) => ({
  answerAction: Effect.fn("RecipeImportIntent.answerAction")(
    function* answerAction(
      principal: ImportPrincipal,
      intentId: RecipeImportIntentId,
      actionId: RecipeImportActionId,
      request: AnswerReviewRecipeActionRequest,
      idempotencyKey: IdempotencyKey
    ) {
      const [mutationId, commandDigest, currentTimeMillis] = yield* Effect.all([
        recipeImportActionMutationId({
          actionId,
          idempotencyKey,
          intentId,
          principal,
        }),
        recipeImportActionAnswerDigest({
          actionId,
          intentId,
          principal,
          request,
        }),
        Clock.currentTimeMillis,
      ]);
      return yield* repository.answerAction({
        actionId,
        actorId: Schema.decodeUnknownSync(RecipeReviewerActorId)(
          principal.actorId
        ),
        answeredAt: new Date(currentTimeMillis).toISOString(),
        commandDigest,
        intentId,
        mutationId,
        principal,
        request,
      });
    }
  ),
  confirmAction: Effect.fn("RecipeImportIntent.confirmAction")(
    function* confirmAction(
      principal: ImportPrincipal,
      intentId: RecipeImportIntentId,
      actionId: RecipeImportActionId,
      request: ConfirmRecipeImportActionRequest,
      idempotencyKey: IdempotencyKey
    ) {
      const [mutationId, commandDigest, currentTimeMillis] = yield* Effect.all([
        recipeImportActionMutationId({
          actionId,
          idempotencyKey,
          intentId,
          principal,
        }),
        recipeImportActionConfirmDigest({
          actionId,
          intentId,
          principal,
          request,
        }),
        Clock.currentTimeMillis,
      ]);
      return yield* repository.confirmAction({
        actionId,
        actorId: Schema.decodeUnknownSync(RecipeReviewerActorId)(
          principal.actorId
        ),
        commandDigest,
        confirmedAt: new Date(currentTimeMillis).toISOString(),
        intentId,
        mutationId,
        principal,
        request,
        succeededMutationId: yield* succeededRecipeMutationId(mutationId),
      });
    }
  ),
  getAction: repository.getAction,
  getRecipe: repository.getRecipe,
});

export type RecipeImportIntentReviewApplicationShape = ReturnType<
  typeof makeRecipeImportIntentReviewApplication
>;

export class RecipeImportIntentReviewApplication extends Context.Service<
  RecipeImportIntentReviewApplication,
  RecipeImportIntentReviewApplicationShape
>()("meal-planner/RecipeImportIntentReviewApplication") {}

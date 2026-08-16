import {
  AnswerReviewRecipeActionRequest,
  ConfirmRecipeImportActionRequest,
  IdempotencyKey,
  RecipeImportActionId,
  RecipeImportActionVersion,
  RecipeImportIntentId,
  RecipeReviewAnswer,
} from "@meal-planner/recipe-import-api";
import type { AnyD1Database } from "drizzle-orm/d1";
import { Context, Effect, Option, Schema } from "effect";

import type { RecipeImportIntentReviewError } from "./import-intent-review.js";
import type { ImportPrincipal } from "./import-intent.js";
import type {
  ApprovedRecipe,
  CorrectRecipeDraftRequest,
  RecipeReviewServiceShape,
  RecipeReviewServiceError,
  Review,
  TransitionRecipeDraftRequest,
} from "./import-recipe-review.js";
import {
  RecipeReviewerActorId,
  RecipeReviewMutationConflict,
  RecipeReviewMutationOutcome,
  approvalBlockers,
  projectApprovedReview,
  recipeApprovalBlocked,
  recipeReviewNotFound,
  recipeReviewTransitionRejected,
  recipeReviewVersionConflict,
} from "./import-recipe-review.js";
import { ImportId } from "./import.contracts.js";
import {
  importPersistenceCorrupt,
  importPersistenceUnavailable,
} from "./import.errors.js";

export type RecipeReviewCompatibilityTarget =
  | { readonly _tag: "ForeignIntent" }
  | { readonly _tag: "Legacy" }
  | {
      readonly _tag: "OwnedIntent";
      readonly actionId: Option.Option<RecipeImportActionId>;
      readonly intentId: RecipeImportIntentId;
    };

/** Read-only classification queries used by the compatibility capability. */
export interface RecipeReviewCompatibilityRepositoryShape {
  readonly classify: (
    principal: ImportPrincipal,
    importId: ImportId
  ) => Effect.Effect<
    RecipeReviewCompatibilityTarget,
    Extract<
      RecipeReviewServiceError,
      {
        readonly _tag:
          | "ImportPersistenceCorrupt"
          | "ImportPersistenceUnavailable";
      }
    >
  >;
  readonly listSucceededImportIds: (
    principal: ImportPrincipal
  ) => Effect.Effect<
    readonly ImportId[],
    Extract<
      RecipeReviewServiceError,
      {
        readonly _tag:
          | "ImportPersistenceCorrupt"
          | "ImportPersistenceUnavailable";
      }
    >
  >;
}

interface RecipeImportIntentReviewMutations {
  readonly answerAction: (
    principal: ImportPrincipal,
    intentId: RecipeImportIntentId,
    actionId: RecipeImportActionId,
    request: AnswerReviewRecipeActionRequest,
    idempotencyKey: IdempotencyKey
  ) => Effect.Effect<unknown, RecipeImportIntentReviewError>;
  readonly confirmAction: (
    principal: ImportPrincipal,
    intentId: RecipeImportIntentId,
    actionId: RecipeImportActionId,
    request: ConfirmRecipeImportActionRequest,
    idempotencyKey: IdempotencyKey
  ) => Effect.Effect<unknown, RecipeImportIntentReviewError>;
}

const actorFromPrincipal = (principal: ImportPrincipal) =>
  Schema.decodeUnknownSync(RecipeReviewerActorId)(principal.actorId);

const legacyIdempotencyKey = (mutationId: string) =>
  Schema.decodeUnknownSync(IdempotencyKey)(mutationId);

const canonicalActionVersion = (legacyVersion: number) =>
  Schema.decodeUnknownSync(RecipeImportActionVersion)(legacyVersion + 1);

const canonicalCorrectionAnswer = (request: CorrectRecipeDraftRequest) =>
  Schema.decodeUnknownSync(RecipeReviewAnswer)({
    field: request.correction.field,
    value: request.correction.value,
  });

const mutationOutcome = (
  request: CorrectRecipeDraftRequest | TransitionRecipeDraftRequest,
  before: Review,
  after: Review
) =>
  RecipeReviewMutationOutcome.make({
    _tag: before.version === request.expectedVersion ? "Applied" : "Replayed",
    mutationId: request.mutationId,
    resultingVersion: after.version,
    review: after,
  });

const translateCanonicalError = (
  legacy: RecipeReviewServiceShape,
  importId: ImportId,
  request: CorrectRecipeDraftRequest | TransitionRecipeDraftRequest,
  error: RecipeImportIntentReviewError
): Effect.Effect<never, RecipeReviewServiceError> => {
  switch (error._tag) {
    case "ImportPersistenceCorrupt":
    case "ImportPersistenceUnavailable": {
      return Effect.fail(error);
    }
    case "RecipeImportActionMutationConflict": {
      return Effect.fail(
        new RecipeReviewMutationConflict({ mutationId: request.mutationId })
      );
    }
    case "RecipeImportActionNotFound":
    case "RecipeImportRecipeNotFound": {
      return Effect.fail(recipeReviewNotFound());
    }
    case "RecipeImportActionTransitionRejected": {
      return legacy
        .get(importId)
        .pipe(
          Effect.flatMap((review) =>
            Effect.fail(recipeReviewTransitionRejected(review.lifecycle))
          )
        );
    }
    case "RecipeImportActionVersionConflict": {
      return legacy
        .get(importId)
        .pipe(
          Effect.flatMap((review) =>
            Effect.fail(
              recipeReviewVersionConflict(
                request.expectedVersion,
                review.version
              )
            )
          )
        );
    }
    default: {
      return error satisfies never;
    }
  }
};

const withOwnedAction = <A>(
  legacy: RecipeReviewServiceShape,
  importId: ImportId,
  target: Extract<RecipeReviewCompatibilityTarget, { _tag: "OwnedIntent" }>,
  use: (
    intentId: RecipeImportIntentId,
    actionId: RecipeImportActionId
  ) => Effect.Effect<A, RecipeReviewServiceError>
) =>
  Option.match(target.actionId, {
    onNone: () =>
      legacy
        .get(importId)
        .pipe(
          Effect.flatMap((review) =>
            Effect.fail(recipeReviewTransitionRejected(review.lifecycle))
          )
        ),
    onSome: (actionId) => use(target.intentId, actionId),
  });

/**
 * Adapts the legacy recipe-review surface onto the canonical intent review
 * writer without duplicating lifecycle state or mutation persistence.
 */
export const makeRecipeReviewCompatibility = (input: {
  readonly intentReviews: RecipeImportIntentReviewMutations;
  readonly legacy: RecipeReviewServiceShape;
  readonly repository: RecipeReviewCompatibilityRepositoryShape;
}): RecipeReviewCompatibilityShape => {
  const ownedCorrection = Effect.fn("RecipeReviewCompatibility.correct")(
    function* correctIntentManagedReview(
      principal: ImportPrincipal,
      importId: ImportId,
      request: CorrectRecipeDraftRequest,
      target: Extract<RecipeReviewCompatibilityTarget, { _tag: "OwnedIntent" }>
    ) {
      const before = yield* input.legacy.get(importId);
      return yield* withOwnedAction(
        input.legacy,
        importId,
        target,
        (intentId, actionId) =>
          input.intentReviews
            .answerAction(
              principal,
              intentId,
              actionId,
              AnswerReviewRecipeActionRequest.make({
                answers: [
                  canonicalCorrectionAnswer(request),
                  { field: "tags", value: request.tags },
                ],
                expectedActionVersion: canonicalActionVersion(
                  request.expectedVersion
                ),
              }),
              legacyIdempotencyKey(request.mutationId)
            )
            .pipe(
              Effect.matchEffect({
                onFailure: (error) =>
                  translateCanonicalError(
                    input.legacy,
                    importId,
                    request,
                    error
                  ),
                onSuccess: Effect.succeed,
              }),
              Effect.andThen(input.legacy.get(importId)),
              Effect.map((after) => mutationOutcome(request, before, after))
            )
      );
    }
  );

  const ownedApproval = Effect.fn("RecipeReviewCompatibility.approve")(
    function* approveIntentManagedReview(
      principal: ImportPrincipal,
      importId: ImportId,
      request: TransitionRecipeDraftRequest,
      target: Extract<RecipeReviewCompatibilityTarget, { _tag: "OwnedIntent" }>
    ) {
      const before = yield* input.legacy.get(importId);
      if (before.version === request.expectedVersion) {
        if (before.lifecycle !== "needs_review") {
          return yield* Effect.fail(
            recipeReviewTransitionRejected(before.lifecycle)
          );
        }
        const blockers = approvalBlockers(before.draft, before.corrections);
        if (
          blockers.invalidFields.length > 0 ||
          blockers.unresolvedRequiredFields.length > 0 ||
          before.tags === null
        ) {
          return yield* Effect.fail(
            recipeApprovalBlocked(blockers, before.tags === null)
          );
        }
      }
      return yield* withOwnedAction(
        input.legacy,
        importId,
        target,
        (intentId, actionId) =>
          input.intentReviews
            .confirmAction(
              principal,
              intentId,
              actionId,
              ConfirmRecipeImportActionRequest.make({
                expectedActionVersion: canonicalActionVersion(
                  request.expectedVersion
                ),
              }),
              legacyIdempotencyKey(request.mutationId)
            )
            .pipe(
              Effect.matchEffect({
                onFailure: (error) =>
                  translateCanonicalError(
                    input.legacy,
                    importId,
                    request,
                    error
                  ),
                onSuccess: Effect.succeed,
              }),
              Effect.andThen(input.legacy.get(importId)),
              Effect.map((after) => mutationOutcome(request, before, after))
            )
      );
    }
  );

  const classify = (principal: ImportPrincipal, importId: ImportId) =>
    input.repository.classify(principal, importId);

  const fencedTransition = (
    principal: ImportPrincipal,
    importId: ImportId,
    request: TransitionRecipeDraftRequest,
    legacyTransition: RecipeReviewServiceShape["reject"]
  ) =>
    classify(principal, importId).pipe(
      Effect.flatMap((target) => {
        switch (target._tag) {
          case "ForeignIntent": {
            return Effect.fail(recipeReviewNotFound());
          }
          case "Legacy": {
            return legacyTransition(
              importId,
              request,
              actorFromPrincipal(principal)
            );
          }
          case "OwnedIntent": {
            return input.legacy
              .get(importId)
              .pipe(
                Effect.flatMap((review) =>
                  Effect.fail(recipeReviewTransitionRejected(review.lifecycle))
                )
              );
          }
          default: {
            return target satisfies never;
          }
        }
      })
    );

  return {
    approve: (principal, importId, request) =>
      classify(principal, importId).pipe(
        Effect.flatMap((target) => {
          switch (target._tag) {
            case "ForeignIntent": {
              return Effect.fail(recipeReviewNotFound());
            }
            case "Legacy": {
              return input.legacy.approve(
                importId,
                request,
                actorFromPrincipal(principal)
              );
            }
            case "OwnedIntent": {
              return ownedApproval(principal, importId, request, target);
            }
            default: {
              return target satisfies never;
            }
          }
        })
      ),
    correct: (principal, importId, request) =>
      classify(principal, importId).pipe(
        Effect.flatMap((target) => {
          switch (target._tag) {
            case "ForeignIntent": {
              return Effect.fail(recipeReviewNotFound());
            }
            case "Legacy": {
              return input.legacy.correct(
                importId,
                request,
                actorFromPrincipal(principal)
              );
            }
            case "OwnedIntent": {
              return ownedCorrection(principal, importId, request, target);
            }
            default: {
              return target satisfies never;
            }
          }
        })
      ),
    get: (principal, importId) =>
      classify(principal, importId).pipe(
        Effect.flatMap((target) =>
          target._tag === "ForeignIntent"
            ? Effect.fail(recipeReviewNotFound())
            : input.legacy.get(importId)
        )
      ),
    listApproved: (principal) =>
      input.repository.listSucceededImportIds(principal).pipe(
        Effect.flatMap((ids) =>
          Effect.forEach((id: ImportId) => input.legacy.get(id))(ids)
        ),
        Effect.filterOrFail(
          (reviews) => reviews.every((review) => review._tag === "Approved"),
          importPersistenceCorrupt
        ),
        Effect.map((reviews) =>
          reviews.map((review) => projectApprovedReview(review))
        )
      ),
    reject: (principal, importId, request) =>
      fencedTransition(principal, importId, request, input.legacy.reject),
    returnToReview: (principal, importId, request) =>
      fencedTransition(
        principal,
        importId,
        request,
        input.legacy.returnToReview
      ),
  };
};

const IntentClassificationRow = Schema.Struct({
  action_id: Schema.NullOr(Schema.String),
  household_scope_id: Schema.String,
  submitted_source_url: Schema.NullOr(Schema.String),
});

const SucceededImportRows = Schema.Struct({
  results: Schema.Array(Schema.Struct({ id: ImportId })),
});

const persistenceEffect = <A>(operation: () => PromiseLike<A>) =>
  Effect.tryPromise({
    catch: importPersistenceUnavailable,
    try: () => Promise.resolve(operation()),
  });

const decode = <S extends Schema.Top>(schema: S, value: unknown) =>
  Schema.decodeUnknownEffect(schema, { onExcessProperty: "ignore" })(
    value
  ).pipe(Effect.mapError(() => importPersistenceCorrupt()));

/** D1 read adapter for legacy-versus-intent ownership and recipe-bank scope. */
export const makeRecipeReviewCompatibilityRepositoryD1 = (
  binding: AnyD1Database
): RecipeReviewCompatibilityRepositoryShape => ({
  classify: (principal, importId) =>
    Effect.gen(function* classifyRecipeReview() {
      const value = yield* persistenceEffect(() =>
        binding
          .prepare(
            `SELECT parent.household_scope_id, parent.submitted_source_url,
                    COALESCE(
                      parent.active_action_id,
                      (
                        SELECT history.action_id
                          FROM recipe_import_intent_history AS history
                         WHERE history.intent_id = parent.id
                           AND history.event_type = 'action_available'
                           AND history.action_id IS NOT NULL
                         ORDER BY history.intent_version DESC
                         LIMIT 1
                      )
                    ) AS action_id
               FROM recipe_imports AS parent
              WHERE parent.id = ?`
          )
          .bind(importId)
          .first()
      );
      if (value === null) {
        return { _tag: "Legacy" } satisfies RecipeReviewCompatibilityTarget;
      }
      const row = yield* decode(IntentClassificationRow, value);
      if (row.submitted_source_url === null) {
        return { _tag: "Legacy" } satisfies RecipeReviewCompatibilityTarget;
      }
      if (row.household_scope_id !== principal.householdScopeId) {
        return {
          _tag: "ForeignIntent",
        } satisfies RecipeReviewCompatibilityTarget;
      }
      const resolvedActionId =
        row.action_id === null
          ? Option.none<RecipeImportActionId>()
          : Option.some(yield* decode(RecipeImportActionId, row.action_id));
      return {
        _tag: "OwnedIntent",
        actionId: resolvedActionId,
        intentId: yield* decode(RecipeImportIntentId, importId),
      } satisfies RecipeReviewCompatibilityTarget;
    }),
  listSucceededImportIds: (principal) =>
    persistenceEffect(() =>
      binding
        .prepare(
          `SELECT id
             FROM recipe_imports
            WHERE submitted_source_url IS NOT NULL
              AND household_scope_id = ?
              AND public_status = 'succeeded'
              AND public_recipe_id = id
            ORDER BY succeeded_at, id`
        )
        .bind(principal.householdScopeId)
        .all()
    ).pipe(
      Effect.flatMap((value) => decode(SucceededImportRows, value)),
      Effect.map(({ results }) => results.map(({ id }) => id))
    ),
});

/** Principal-aware compatibility capability for the legacy recipe review HTTP surface. */
export interface RecipeReviewCompatibilityShape {
  readonly approve: (
    principal: ImportPrincipal,
    importId: ImportId,
    request: TransitionRecipeDraftRequest
  ) => Effect.Effect<RecipeReviewMutationOutcome, RecipeReviewServiceError>;
  readonly correct: (
    principal: ImportPrincipal,
    importId: ImportId,
    request: CorrectRecipeDraftRequest
  ) => Effect.Effect<RecipeReviewMutationOutcome, RecipeReviewServiceError>;
  readonly get: (
    principal: ImportPrincipal,
    importId: ImportId
  ) => Effect.Effect<Review, RecipeReviewServiceError>;
  readonly listApproved: (
    principal: ImportPrincipal
  ) => Effect.Effect<readonly ApprovedRecipe[], RecipeReviewServiceError>;
  readonly reject: (
    principal: ImportPrincipal,
    importId: ImportId,
    request: TransitionRecipeDraftRequest
  ) => Effect.Effect<RecipeReviewMutationOutcome, RecipeReviewServiceError>;
  readonly returnToReview: (
    principal: ImportPrincipal,
    importId: ImportId,
    request: TransitionRecipeDraftRequest
  ) => Effect.Effect<RecipeReviewMutationOutcome, RecipeReviewServiceError>;
}

/** Effect service consumed by the legacy recipe review routes. */
export class RecipeReviewCompatibility extends Context.Service<
  RecipeReviewCompatibility,
  RecipeReviewCompatibilityShape
>()("meal-planner/RecipeReviewCompatibility") {}

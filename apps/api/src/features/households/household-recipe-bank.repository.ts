import type { RecipeReviewAnswer } from "@meal-planner/recipe-import-api";
import { and, eq } from "drizzle-orm";
import type { EffectSQLiteDoDatabase } from "drizzle-orm/effect-sqlite-do";
import { DateTime, Effect, Option, Schema } from "effect";

import type { RecipeDraft } from "../imports/import-recipe-draft.repository.d1.js";
import {
  ApprovedRecipe,
  RecipeCorrection,
  RecipeReviewTransition,
  RecipeReviewView,
  Review,
  approvalBlockers,
  applyCorrectionOverlay,
  projectApprovedReview,
  recipeReviewNullablePolicy,
  recipeReviewTransitionPolicy,
  refineRecipeReview,
} from "../imports/import-recipe-review.js";
import type {
  EvidenceReference,
  ImportId,
  ImportTimestamp,
} from "../imports/import.contracts.js";
import type {
  HouseholdAnswerRecipeReviewInput,
  HouseholdTransitionRecipeReviewInput,
  RecipeReviewMutationConflict,
  RecipeReviewNotFound,
  RecipeReviewOpenConflict,
  RecipeReviewTransitionRejected,
  RecipeReviewVersionConflict,
} from "./household-recipe-bank.contract.js";
import {
  RecipeReviewMutationConflict as RecipeReviewMutationConflictSchema,
  RecipeReviewNotFound as RecipeReviewNotFoundSchema,
  RecipeReviewOpenConflict as RecipeReviewOpenConflictSchema,
  RecipeReviewTransitionRejected as RecipeReviewTransitionRejectedSchema,
  RecipeReviewVersionConflict as RecipeReviewVersionConflictSchema,
} from "./household-recipe-bank.contract.js";
import type { HouseholdPersistenceFailure } from "./household.contract.js";
import { HouseholdPersistenceFailure as HouseholdPersistenceFailureSchema } from "./household.contract.js";
import {
  householdRecipeBank,
  householdRecipeReviewMutationReceipts,
  householdRecipeReviews,
} from "./household.database-schema.js";

const EncodedReview = Schema.fromJsonString(Review);
const EncodedApprovedRecipe = Schema.fromJsonString(ApprovedRecipe);
const encodeReview = Schema.encodeSync(EncodedReview);
const decodeReview = Schema.decodeUnknownEffect(EncodedReview);
const encodeApprovedRecipe = Schema.encodeSync(EncodedApprovedRecipe);

const persistenceFailure = () =>
  HouseholdPersistenceFailureSchema.make({ operation: "save" });

const mapPersistenceErrors = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.catchTags({
      EffectDrizzleQueryError: () => Effect.fail(persistenceFailure()),
      SchemaError: () => Effect.fail(persistenceFailure()),
      SqlError: () => Effect.fail(persistenceFailure()),
    })
  );

type RecipeReviewCommandDigestInput =
  | {
      readonly actorId: HouseholdAnswerRecipeReviewInput["actorId"];
      readonly answeredAt: HouseholdAnswerRecipeReviewInput["answeredAt"];
      readonly answers: readonly HouseholdAnswerRecipeReviewInput["answers"][number][];
      readonly expectedVersion: HouseholdAnswerRecipeReviewInput["expectedVersion"];
      readonly importId: HouseholdAnswerRecipeReviewInput["importId"];
      readonly operation: "answer";
    }
  | {
      readonly actorId: HouseholdTransitionRecipeReviewInput["actorId"];
      readonly expectedVersion: HouseholdTransitionRecipeReviewInput["expectedVersion"];
      readonly importId: HouseholdTransitionRecipeReviewInput["importId"];
      readonly operation: "transition";
      readonly reason: HouseholdTransitionRecipeReviewInput["reason"];
      readonly to: HouseholdTransitionRecipeReviewInput["to"];
      readonly transitionedAt: HouseholdTransitionRecipeReviewInput["transitionedAt"];
    };

const digest = (value: RecipeReviewCommandDigestInput) =>
  Effect.tryPromise({
    catch: persistenceFailure,
    try: async () => {
      const bytes = new TextEncoder().encode(JSON.stringify(value));
      const hashed = await crypto.subtle.digest("SHA-256", bytes);
      return Array.from(new Uint8Array(hashed), (byte) =>
        byte.toString(16).padStart(2, "0")
      ).join("");
    },
  });

const currentAnswerValue = (
  review: typeof Review.Type,
  answer: RecipeReviewAnswer
): unknown => {
  if (answer.field === "tags") {
    return review.tags;
  }
  const recipe = applyCorrectionOverlay(review.draft, review.corrections);
  switch (answer.field) {
    case "author": {
      return recipe.author;
    }
    case "category": {
      return recipe.category;
    }
    case "cook_time_minutes": {
      return recipe.cookTimeMinutes;
    }
    case "cuisine": {
      return recipe.cuisine;
    }
    case "description": {
      return recipe.description;
    }
    case "ingredient_lines": {
      return recipe.ingredientLines;
    }
    case "ingredient_quantities": {
      return recipe.ingredientQuantities;
    }
    case "ingredient_units": {
      return recipe.ingredientUnits;
    }
    case "instructions": {
      return recipe.instructions;
    }
    case "name": {
      return recipe.name;
    }
    case "nutrition": {
      return recipe.nutrition;
    }
    case "prep_time_minutes": {
      return recipe.prepTimeMinutes;
    }
    case "temperature_celsius": {
      return recipe.temperatureCelsius;
    }
    case "tools": {
      return recipe.tools;
    }
    case "total_time_minutes": {
      return recipe.totalTimeMinutes;
    }
    case "yield": {
      return recipe.yield;
    }
    default: {
      return answer satisfies never;
    }
  }
};

const readCurrent = (
  database: EffectSQLiteDoDatabase,
  importId: ImportId
): Effect.Effect<
  typeof Review.Type,
  HouseholdPersistenceFailure | RecipeReviewNotFound
> =>
  database
    .select()
    .from(householdRecipeReviews)
    .where(eq(householdRecipeReviews.importId, importId))
    .limit(1)
    .pipe(
      Effect.flatMap(([row]) =>
        Effect.gen(function* decodeCurrentRecipeReview() {
          if (row === undefined) {
            return yield* Effect.fail(
              RecipeReviewNotFoundSchema.make({ importId })
            );
          }
          return yield* decodeReview(row.reviewJson);
        })
      ),
      mapPersistenceErrors
    );

const reviewView = (
  review: typeof Review.Type,
  changes: Partial<typeof RecipeReviewView.Type>
) =>
  RecipeReviewView.make({
    corrections: changes.corrections ?? review.corrections,
    draft: review.draft,
    evidence: review.evidence,
    lifecycle: changes.lifecycle ?? review.lifecycle,
    nullablePolicy: review.nullablePolicy,
    tags: changes.tags === undefined ? review.tags : changes.tags,
    transitions: changes.transitions ?? review.transitions,
    unresolvedRequiredFields:
      changes.unresolvedRequiredFields ?? review.unresolvedRequiredFields,
    version: changes.version ?? review.version,
  });

type MutationFailure =
  | HouseholdPersistenceFailure
  | RecipeReviewMutationConflict
  | RecipeReviewNotFound
  | RecipeReviewTransitionRejected
  | RecipeReviewVersionConflict;

export const makeHouseholdRecipeBankRepository = (
  database: EffectSQLiteDoDatabase
) => ({
  answer: (
    input: HouseholdAnswerRecipeReviewInput
  ): Effect.Effect<typeof Review.Type, MutationFailure> =>
    Effect.gen(function* answerHouseholdRecipeReview() {
      const commandDigest = yield* digest({
        actorId: input.actorId,
        answeredAt: input.answeredAt,
        answers: input.answers.toSorted((left, right) =>
          left.field.localeCompare(right.field)
        ),
        expectedVersion: input.expectedVersion,
        importId: input.importId,
        operation: "answer",
      });
      return yield* database.transaction((transaction) =>
        Effect.gen(function* persistRecipeReviewAnswers() {
          const [receipt] = yield* transaction
            .select()
            .from(householdRecipeReviewMutationReceipts)
            .where(
              and(
                eq(
                  householdRecipeReviewMutationReceipts.importId,
                  input.importId
                ),
                eq(
                  householdRecipeReviewMutationReceipts.mutationId,
                  input.mutationId
                )
              )
            )
            .limit(1);
          if (receipt !== undefined) {
            return receipt.commandDigest === commandDigest
              ? yield* decodeReview(receipt.resultJson)
              : yield* Effect.fail(
                  RecipeReviewMutationConflictSchema.make({
                    mutationId: input.mutationId,
                  })
                );
          }
          const [row] = yield* transaction
            .select()
            .from(householdRecipeReviews)
            .where(eq(householdRecipeReviews.importId, input.importId))
            .limit(1);
          if (row === undefined) {
            return yield* Effect.fail(
              RecipeReviewNotFoundSchema.make({ importId: input.importId })
            );
          }
          const current = yield* decodeReview(row.reviewJson);
          if (current._tag !== "NeedsReview") {
            return yield* Effect.fail(
              RecipeReviewTransitionRejectedSchema.make({
                lifecycle: current.lifecycle,
              })
            );
          }
          if (current.version !== input.expectedVersion) {
            return yield* Effect.fail(
              RecipeReviewVersionConflictSchema.make({
                actualVersion: current.version,
                expectedVersion: input.expectedVersion,
              })
            );
          }
          const resultingVersion = current.version + 1;
          const corrections = yield* Effect.all(
            input.answers.map((answer) =>
              answer.field === "tags"
                ? Effect.succeed(null)
                : Schema.decodeUnknownEffect(RecipeCorrection)({
                    actorId: input.actorId,
                    after: answer.value,
                    before: currentAnswerValue(current, answer),
                    correctedAt: input.answeredAt,
                    field: answer.field,
                    reason: "Household answered recipe review action",
                    version: resultingVersion,
                  })
            )
          );
          const nextCorrections = [
            ...current.corrections,
            ...corrections.filter((correction) => correction !== null),
          ];
          const tags =
            input.answers.find((answer) => answer.field === "tags")?.value ??
            current.tags;
          const next = Option.getOrThrow(
            refineRecipeReview(
              reviewView(current, {
                corrections: nextCorrections,
                tags,
                unresolvedRequiredFields: approvalBlockers(
                  current.draft,
                  nextCorrections
                ).unresolvedRequiredFields,
                version: resultingVersion,
              })
            )
          );
          const resultJson = encodeReview(next);
          yield* transaction
            .update(householdRecipeReviews)
            .set({ reviewJson: resultJson, version: resultingVersion })
            .where(eq(householdRecipeReviews.importId, input.importId));
          yield* transaction
            .insert(householdRecipeReviewMutationReceipts)
            .values({
              commandDigest,
              importId: input.importId,
              mutationId: input.mutationId,
              resultJson,
            });
          return next;
        })
      );
    }).pipe(mapPersistenceErrors),

  find: (importId: ImportId) => readCurrent(database, importId),

  listApproved: () =>
    database
      .select({ approvedRecipeJson: householdRecipeBank.approvedRecipeJson })
      .from(householdRecipeBank)
      .pipe(
        Effect.flatMap((rows) =>
          Effect.all(
            rows.map((row) =>
              Schema.decodeUnknownEffect(EncodedApprovedRecipe)(
                row.approvedRecipeJson
              )
            )
          )
        ),
        mapPersistenceErrors
      ),

  open: (input: {
    readonly draft: RecipeDraft;
    readonly evidence: readonly EvidenceReference[];
    readonly openedAt: ImportTimestamp;
  }): Effect.Effect<
    typeof Review.Type,
    HouseholdPersistenceFailure | RecipeReviewOpenConflict
  > =>
    database
      .transaction((transaction) =>
        Effect.gen(function* openHouseholdRecipeReview() {
          const [existing] = yield* transaction
            .select()
            .from(householdRecipeReviews)
            .where(eq(householdRecipeReviews.importId, input.draft.importId))
            .limit(1);
          if (existing !== undefined) {
            if (
              existing.extractionFingerprint !==
              input.draft.extractionFingerprint
            ) {
              return yield* Effect.fail(
                new RecipeReviewOpenConflictSchema({
                  importId: input.draft.importId,
                })
              );
            }
            return yield* decodeReview(existing.reviewJson);
          }
          const review = Option.getOrThrow(
            refineRecipeReview(
              RecipeReviewView.make({
                corrections: [],
                draft: input.draft,
                evidence: input.evidence,
                lifecycle: "needs_review",
                nullablePolicy: recipeReviewNullablePolicy,
                tags: null,
                transitions: [],
                unresolvedRequiredFields: approvalBlockers(input.draft, [])
                  .unresolvedRequiredFields,
                version: 0,
              })
            )
          );
          yield* transaction.insert(householdRecipeReviews).values({
            extractionFingerprint: input.draft.extractionFingerprint,
            importId: input.draft.importId,
            lifecycle: review.lifecycle,
            openedAt: DateTime.formatIso(input.openedAt),
            reviewJson: encodeReview(review),
            version: review.version,
          });
          return review;
        })
      )
      .pipe(mapPersistenceErrors),

  transition: (
    input: HouseholdTransitionRecipeReviewInput
  ): Effect.Effect<typeof Review.Type, MutationFailure> =>
    Effect.gen(function* transitionHouseholdRecipeReview() {
      const commandDigest = yield* digest({
        actorId: input.actorId,
        expectedVersion: input.expectedVersion,
        importId: input.importId,
        operation: "transition",
        reason: input.reason,
        to: input.to,
        transitionedAt: input.transitionedAt,
      });
      return yield* database.transaction((transaction) =>
        Effect.gen(function* persistRecipeReviewTransition() {
          const [receipt] = yield* transaction
            .select()
            .from(householdRecipeReviewMutationReceipts)
            .where(
              and(
                eq(
                  householdRecipeReviewMutationReceipts.importId,
                  input.importId
                ),
                eq(
                  householdRecipeReviewMutationReceipts.mutationId,
                  input.mutationId
                )
              )
            )
            .limit(1);
          if (receipt !== undefined) {
            return receipt.commandDigest === commandDigest
              ? yield* decodeReview(receipt.resultJson)
              : yield* Effect.fail(
                  RecipeReviewMutationConflictSchema.make({
                    mutationId: input.mutationId,
                  })
                );
          }
          const [row] = yield* transaction
            .select()
            .from(householdRecipeReviews)
            .where(eq(householdRecipeReviews.importId, input.importId))
            .limit(1);
          if (row === undefined) {
            return yield* Effect.fail(
              RecipeReviewNotFoundSchema.make({ importId: input.importId })
            );
          }
          const current = yield* decodeReview(row.reviewJson);
          if (current.version !== input.expectedVersion) {
            return yield* Effect.fail(
              RecipeReviewVersionConflictSchema.make({
                actualVersion: current.version,
                expectedVersion: input.expectedVersion,
              })
            );
          }
          if (
            Option.isNone(
              recipeReviewTransitionPolicy(current.lifecycle, input.to)
            )
          ) {
            return yield* Effect.fail(
              RecipeReviewTransitionRejectedSchema.make({
                lifecycle: current.lifecycle,
              })
            );
          }
          if (input.to === "approved") {
            const blockers = approvalBlockers(
              current.draft,
              current.corrections
            );
            if (
              current.tags === null ||
              blockers.invalidFields.length > 0 ||
              blockers.unresolvedRequiredFields.length > 0
            ) {
              return yield* Effect.fail(
                RecipeReviewTransitionRejectedSchema.make({
                  lifecycle: current.lifecycle,
                })
              );
            }
          }
          const resultingVersion = current.version + 1;
          const transition = yield* Schema.decodeUnknownEffect(
            RecipeReviewTransition
          )({
            actorId: input.actorId,
            from: current.lifecycle,
            reason: input.reason,
            to: input.to,
            transitionedAt: input.transitionedAt,
            version: resultingVersion,
          });
          const refined = refineRecipeReview(
            reviewView(current, {
              lifecycle: input.to,
              transitions: [...current.transitions, transition],
              version: resultingVersion,
            })
          );
          if (Option.isNone(refined)) {
            return yield* Effect.fail(
              RecipeReviewTransitionRejectedSchema.make({
                lifecycle: current.lifecycle,
              })
            );
          }
          const next = refined.value;
          const resultJson = encodeReview(next);
          yield* transaction
            .update(householdRecipeReviews)
            .set({
              lifecycle: next.lifecycle,
              reviewJson: resultJson,
              version: resultingVersion,
            })
            .where(eq(householdRecipeReviews.importId, input.importId));
          if (next._tag === "Approved") {
            const approvedRecipeJson = encodeApprovedRecipe(
              projectApprovedReview(next)
            );
            yield* transaction
              .insert(householdRecipeBank)
              .values({
                approvedRecipeJson,
                importId: input.importId,
                reviewVersion: resultingVersion,
              })
              .onConflictDoUpdate({
                set: { approvedRecipeJson, reviewVersion: resultingVersion },
                target: householdRecipeBank.importId,
              });
          } else {
            yield* transaction
              .delete(householdRecipeBank)
              .where(eq(householdRecipeBank.importId, input.importId));
          }
          yield* transaction
            .insert(householdRecipeReviewMutationReceipts)
            .values({
              commandDigest,
              importId: input.importId,
              mutationId: input.mutationId,
              resultJson,
            });
          return next;
        })
      );
    }).pipe(mapPersistenceErrors),
});

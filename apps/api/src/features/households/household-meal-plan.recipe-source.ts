import { MealPlanRecipeSnapshot } from "@meal-planner/household-api";
import type { HouseholdOrganizationId } from "@meal-planner/household-api";
import { RecipeImportHouseholdScopeId } from "@meal-planner/recipe-import-api";
import { and, desc, eq } from "drizzle-orm";
import type { AnyD1Database } from "drizzle-orm/d1";
import { drizzle } from "drizzle-orm/d1";
import { Effect, Option, Schema } from "effect";

import {
  ApprovedRecipe,
  projectApprovedReview,
  refineRecipeReview,
} from "../imports/import-recipe-review.js";
import type { RecipeReviewPersistenceError } from "../imports/import-recipe-review.js";
import { makeD1RecipeReviewRepository } from "../imports/import-recipe-review.repository.d1.js";
import { ImportId } from "../imports/import.contracts.js";
import {
  importRecipeExtractions,
  recipeImports,
  recipeReviews,
} from "../imports/import.database-schema.js";
import { importPersistenceUnavailable } from "../imports/import.errors.js";

const hashOrganizationId = (organizationId: HouseholdOrganizationId) =>
  Effect.promise(() =>
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(organizationId))
  ).pipe(
    Effect.map((digest) =>
      Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, "0")
      ).join("")
    ),
    Effect.flatMap(Schema.decodeUnknownEffect(RecipeImportHouseholdScopeId))
  );

const MaximumApprovedRecipeCandidates = 128;
const RecipeReviewReadConcurrency = 8;

const decodeSnapshot = (review: Parameters<typeof projectApprovedReview>[0]) =>
  Schema.encodeEffect(ApprovedRecipe)(projectApprovedReview(review)).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(MealPlanRecipeSnapshot)),
    Effect.mapError(() => importPersistenceUnavailable())
  );

/**
 * Read approved recipe snapshots from their existing shared-D1 authority.
 * The ownership query is Drizzle-scoped before any review is projected.
 */
export const listApprovedMealPlanRecipeSnapshots = (
  binding: AnyD1Database,
  organizationId: HouseholdOrganizationId
): Effect.Effect<
  readonly (typeof MealPlanRecipeSnapshot.Type)[],
  RecipeReviewPersistenceError
> =>
  Effect.gen(function* listHouseholdApprovedRecipes() {
    const householdScopeId = yield* hashOrganizationId(organizationId).pipe(
      Effect.mapError(() => importPersistenceUnavailable())
    );
    const rows = yield* Effect.tryPromise({
      catch: () => importPersistenceUnavailable(),
      try: () =>
        drizzle(binding)
          .select({ importId: recipeImports.id })
          .from(recipeImports)
          .innerJoin(
            importRecipeExtractions,
            and(
              eq(importRecipeExtractions.importId, recipeImports.id),
              eq(
                importRecipeExtractions.acquisitionGeneration,
                recipeImports.acquisitionGeneration
              ),
              eq(importRecipeExtractions.isCurrent, 1)
            )
          )
          .innerJoin(
            recipeReviews,
            and(
              eq(
                recipeReviews.extractionFingerprint,
                importRecipeExtractions.extractionFingerprint
              ),
              eq(recipeReviews.lifecycle, "approved")
            )
          )
          .where(eq(recipeImports.householdScopeId, householdScopeId))
          .orderBy(desc(recipeReviews.updatedAt), recipeImports.id)
          .limit(MaximumApprovedRecipeCandidates),
    });
    const reviews = makeD1RecipeReviewRepository(binding);
    return yield* Effect.all(
      rows.map(({ importId }) =>
        Schema.decodeUnknownEffect(ImportId)(importId).pipe(
          Effect.mapError(() => importPersistenceUnavailable()),
          Effect.flatMap(reviews.find),
          Effect.flatMap(
            Option.match({
              onNone: () => Effect.succeed(Option.none()),
              onSome: (review) => {
                const refined = refineRecipeReview(review);
                return Option.isSome(refined) &&
                  refined.value._tag === "Approved"
                  ? decodeSnapshot(refined.value).pipe(Effect.map(Option.some))
                  : Effect.succeed(Option.none());
              },
            })
          )
        )
      ),
      { concurrency: RecipeReviewReadConcurrency }
    ).pipe(
      Effect.map((snapshots) =>
        snapshots.flatMap((snapshot) => Option.toArray(snapshot))
      )
    );
  });

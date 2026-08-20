import { MealPlanRecipeSnapshot } from "@meal-planner/household-api";
import type {
  HouseholdOrganizationId,
  MealPlanRecipeSnapshotId,
} from "@meal-planner/household-api";
import { RecipeImportHouseholdScopeId } from "@meal-planner/recipe-import-api";
import type { AnyD1Database } from "drizzle-orm/d1";
import { Data, Effect, Option, Schema } from "effect";

import {
  findCurrentApprovedRecipeProjection,
  findCurrentApprovedRecipeProjections,
  readCurrentApprovedRecipeCandidateCatalogue,
} from "../imports/import-approved-recipe-projection.d1.js";
import type {
  ApprovedRecipeAuthorityMismatch,
  ApprovedRecipeAuthorityToken,
  ApprovedRecipeCandidateCatalogue,
  ApprovedRecipeCandidatePageTooLarge,
  ApprovedRecipeCandidateQueryCapacityExceeded,
  ApprovedRecipeProjectionTooLarge,
} from "../imports/import-approved-recipe-projection.d1.js";
import { ApprovedRecipe } from "../imports/import-recipe-review.js";
import type { RecipeReviewPersistenceError } from "../imports/import-recipe-review.js";
import { ImportId } from "../imports/import.contracts.js";
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

// One MiB stays well below the 1.9 MB persisted-plan ceiling and leaves room
// for the request, policy, RPC envelope, and generated-plan growth. The
// persisted-plan repository remains the final authority for its own limit.
const MaximumApprovedRecipeTransferBytes = 1_048_576;
const EmptyJsonArrayBytes = 2;
const JsonArraySeparatorBytes = 1;
const utf8Encoder = new TextEncoder();
const encodeSnapshotJson = Schema.encodeEffect(
  Schema.fromJsonString(MealPlanRecipeSnapshot)
);

/** The approved recipe set cannot be transferred safely within its byte budget. */
export class ApprovedMealPlanRecipePayloadTooLarge extends Data.TaggedError(
  "ApprovedMealPlanRecipePayloadTooLarge"
) {}

const decodeSnapshot = (approved: ApprovedRecipe) =>
  Schema.encodeEffect(ApprovedRecipe)(approved).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(MealPlanRecipeSnapshot)),
    Effect.mapError(() => importPersistenceUnavailable())
  );

/** Read one coherent bounded catalogue of current approved planning facts. */
export const readApprovedMealPlanRecipeCandidateCatalogue = (
  binding: AnyD1Database,
  organizationId: HouseholdOrganizationId
): Effect.Effect<
  ApprovedRecipeCandidateCatalogue,
  | ApprovedRecipeAuthorityMismatch
  | ApprovedRecipeCandidatePageTooLarge
  | ApprovedRecipeCandidateQueryCapacityExceeded
  | RecipeReviewPersistenceError
> =>
  Effect.gen(function* readHouseholdApprovedRecipeCandidateCatalogue() {
    const householdScopeId = yield* hashOrganizationId(organizationId).pipe(
      Effect.mapError(() => importPersistenceUnavailable())
    );
    return yield* readCurrentApprovedRecipeCandidateCatalogue(
      binding,
      householdScopeId
    );
  });

export interface ApprovedMealPlanRecipeSelection {
  readonly authorityToken: ApprovedRecipeAuthorityToken;
  readonly importId: MealPlanRecipeSnapshotId;
}

/** Hydrate only selected current approved recipes within the RPC byte budget. */
export const hydrateApprovedMealPlanRecipeSnapshots = (
  binding: AnyD1Database,
  organizationId: HouseholdOrganizationId,
  selectedRecipes: readonly ApprovedMealPlanRecipeSelection[]
): Effect.Effect<
  readonly (typeof MealPlanRecipeSnapshot.Type)[],
  | ApprovedMealPlanRecipePayloadTooLarge
  | ApprovedRecipeAuthorityMismatch
  | ApprovedRecipeProjectionTooLarge
  | RecipeReviewPersistenceError
> =>
  Effect.gen(function* hydrateHouseholdApprovedRecipes() {
    const householdScopeId = yield* hashOrganizationId(organizationId).pipe(
      Effect.mapError(() => importPersistenceUnavailable())
    );
    const selections = yield* Effect.all(
      selectedRecipes.map((selection) =>
        Schema.decodeUnknownEffect(ImportId)(selection.importId).pipe(
          Effect.mapError(() => importPersistenceUnavailable()),
          Effect.map((importId) => ({
            authorityToken: selection.authorityToken,
            importId,
          }))
        )
      )
    );
    const approvedRecipes = yield* findCurrentApprovedRecipeProjections(
      binding,
      { householdScopeId, selections }
    );
    const snapshots: (typeof MealPlanRecipeSnapshot.Type)[] = [];
    let aggregateBytes = EmptyJsonArrayBytes;
    for (const approvedRecipe of approvedRecipes) {
      const selectedSnapshot = yield* decodeSnapshot(approvedRecipe);
      const encodedSnapshot = yield* encodeSnapshotJson(selectedSnapshot).pipe(
        Effect.mapError(() => importPersistenceUnavailable())
      );
      const nextAggregateBytes =
        aggregateBytes +
        (snapshots.length === 0 ? 0 : JsonArraySeparatorBytes) +
        utf8Encoder.encode(encodedSnapshot).byteLength;
      if (nextAggregateBytes > MaximumApprovedRecipeTransferBytes) {
        return yield* new ApprovedMealPlanRecipePayloadTooLarge();
      }
      snapshots.push(selectedSnapshot);
      aggregateBytes = nextAggregateBytes;
    }
    return snapshots;
  });

/** Resolve one current approved recipe for an admitted household and import. */
export const findApprovedMealPlanRecipeSnapshot = (
  binding: AnyD1Database,
  organizationId: HouseholdOrganizationId,
  importId: MealPlanRecipeSnapshotId
): Effect.Effect<
  Option.Option<typeof MealPlanRecipeSnapshot.Type>,
  | ApprovedRecipeAuthorityMismatch
  | ApprovedRecipeProjectionTooLarge
  | RecipeReviewPersistenceError
> =>
  Effect.gen(function* findHouseholdApprovedRecipe() {
    const householdScopeId = yield* hashOrganizationId(organizationId).pipe(
      Effect.mapError(() => importPersistenceUnavailable())
    );
    const requestedImportId = yield* Schema.decodeUnknownEffect(ImportId)(
      importId
    ).pipe(Effect.mapError(() => importPersistenceUnavailable()));
    return yield* findCurrentApprovedRecipeProjection(binding, {
      householdScopeId,
      importId: requestedImportId,
    }).pipe(
      Effect.flatMap(
        Option.match({
          onNone: () => Effect.succeed(Option.none()),
          onSome: (approved) =>
            decodeSnapshot(approved).pipe(Effect.map(Option.some)),
        })
      )
    );
  });

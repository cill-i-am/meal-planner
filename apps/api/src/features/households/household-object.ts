import {
  ManualMealSwapRequest,
  MealPlan,
  MealPlanDecisionRequest,
  MealPlanPersistenceFailure,
  MealPlanPolicy,
  MealPlanRecipeSnapshot,
  MealPlanRequest,
} from "@meal-planner/household-api";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Drizzle from "alchemy/Drizzle/Cloudflare";
import type { EffectSQLiteDoDatabase } from "drizzle-orm/effect-sqlite-do";
import { Effect, Option, Schema } from "effect";

import migrations from "../../../household-migrations/migrations.js";
import { RecipeDraft } from "../imports/import-recipe-draft.repository.d1.js";
import { ApprovedRecipe, Review } from "../imports/import-recipe-review.js";
import {
  EvidenceReference,
  ImportTimestamp,
} from "../imports/import.contracts.js";
import {
  makeDeterministicMealPlanPlanner,
  makeMealPlanService,
} from "../meal-planning/meal-plan.js";
import {
  HouseholdCreateMealPlanInput,
  HouseholdDecideMealPlanInput,
  HouseholdReadMealPlanInput,
  HouseholdSwapMealPlanInput,
} from "./household-meal-plan.contract.js";
import { makeHouseholdMealPlanRepository } from "./household-meal-plan.repository.js";
import {
  HouseholdAnswerRecipeReviewInput,
  HouseholdOpenRecipeReviewInput,
  HouseholdReadRecipeReviewInput,
  HouseholdTransitionRecipeReviewInput,
} from "./household-recipe-bank.contract.js";
import { makeHouseholdRecipeBankRepository } from "./household-recipe-bank.repository.js";
import type { HouseholdMetadata } from "./household.contract.js";
import {
  HouseholdEnsureInput,
  HouseholdInvalidInput,
  HouseholdPersistenceFailure,
  HouseholdProvenanceMismatch,
} from "./household.contract.js";
import { householdMeta } from "./household.database-schema.js";

const singletonKey = "household";

const ensureHousehold = (
  database: EffectSQLiteDoDatabase,
  input: HouseholdEnsureInput
) =>
  Effect.gen(function* ensureHouseholdProvenance() {
    const createdAtEpochMs = Date.now();
    yield* database
      .insert(householdMeta)
      .values({
        createdAtEpochMs,
        organizationId: input.organizationId,
        singletonKey,
      })
      .onConflictDoNothing()
      .pipe(
        Effect.mapError(() =>
          HouseholdPersistenceFailure.make({ operation: "ensure" })
        )
      );
    const rows = yield* database
      .select()
      .from(householdMeta)
      .limit(1)
      .pipe(
        Effect.mapError(() =>
          HouseholdPersistenceFailure.make({ operation: "read" })
        )
      );
    const [persisted] = rows;
    if (persisted === undefined) {
      return yield* Effect.fail(
        HouseholdPersistenceFailure.make({ operation: "read" })
      );
    }
    const persistedOrganizationId = yield* Schema.decodeUnknownEffect(
      HouseholdEnsureInput.fields.organizationId
    )(persisted.organizationId).pipe(
      Effect.mapError(() =>
        HouseholdPersistenceFailure.make({ operation: "read" })
      )
    );
    if (persistedOrganizationId !== input.organizationId) {
      return yield* Effect.fail(
        HouseholdProvenanceMismatch.make({
          organizationId: input.organizationId,
          persistedOrganizationId,
        })
      );
    }
    return {
      createdAtEpochMs: persisted.createdAtEpochMs,
      organizationId: persistedOrganizationId,
    } satisfies HouseholdMetadata;
  });

const invalidInput = () => HouseholdInvalidInput.make({});

const encodeMealPlan = (plan: typeof MealPlan.Type) =>
  Schema.encodeEffect(MealPlan)(plan).pipe(Effect.mapError(invalidInput));

const makeService = (database: EffectSQLiteDoDatabase) => {
  const recipeBank = makeHouseholdRecipeBankRepository(database);
  return makeMealPlanService({
    drafts: makeHouseholdMealPlanRepository(database),
    planner: makeDeterministicMealPlanPlanner(),
    recipeReviews: {
      listApproved: () =>
        recipeBank.listApproved().pipe(
          Effect.flatMap((recipes) =>
            Effect.all(
              recipes.map((recipe) =>
                Schema.encodeEffect(ApprovedRecipe)(recipe).pipe(
                  Effect.flatMap(
                    Schema.decodeUnknownEffect(MealPlanRecipeSnapshot)
                  )
                )
              )
            )
          ),
          Effect.mapError(() =>
            MealPlanPersistenceFailure.make({ operation: "read" })
          )
        ),
    },
  });
};

export const HouseholdObjectRuntime = Effect.gen(
  function* initializeHouseholdObject() {
    const durableObjectState = yield* Cloudflare.DurableObjectState;
    const scoped = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      effect.pipe(
        Effect.provideService(
          Cloudflare.DurableObjectState,
          durableObjectState
        ),
        Effect.scoped
      );
    const database = Drizzle.DurableObject({ migrations });

    return Effect.succeed({
      answerRecipeReview: (untrustedInput: HouseholdAnswerRecipeReviewInput) =>
        scoped(
          Effect.gen(function* answerHouseholdRecipeReview() {
            const command = yield* Schema.decodeUnknownEffect(
              HouseholdAnswerRecipeReviewInput
            )(untrustedInput).pipe(Effect.mapError(invalidInput));
            const connection = yield* database;
            yield* ensureHousehold(connection, command);
            const review =
              yield* makeHouseholdRecipeBankRepository(connection).answer(
                command
              );
            return yield* Schema.encodeEffect(Review)(review).pipe(
              Effect.mapError(invalidInput)
            );
          })
        ),
      approveMealPlan: (untrustedInput: HouseholdDecideMealPlanInput) =>
        scoped(
          Effect.gen(function* approveHouseholdMealPlan() {
            const command = yield* Schema.decodeUnknownEffect(
              HouseholdDecideMealPlanInput
            )(untrustedInput).pipe(Effect.mapError(invalidInput));
            const connection = yield* database;
            yield* ensureHousehold(connection, command);
            const request = yield* Schema.decodeUnknownEffect(
              MealPlanDecisionRequest
            )(command.request).pipe(Effect.mapError(invalidInput));
            const plan = yield* makeService(connection).approve(request);
            return yield* encodeMealPlan(plan);
          })
        ),
      createMealPlan: (untrustedInput: HouseholdCreateMealPlanInput) =>
        scoped(
          Effect.gen(function* createHouseholdMealPlan() {
            const command = yield* Schema.decodeUnknownEffect(
              HouseholdCreateMealPlanInput
            )(untrustedInput).pipe(Effect.mapError(invalidInput));
            const connection = yield* database;
            yield* ensureHousehold(connection, command);
            const policy = yield* Schema.decodeUnknownEffect(MealPlanPolicy)(
              command.policy
            ).pipe(Effect.mapError(invalidInput));
            const request = yield* Schema.decodeUnknownEffect(MealPlanRequest)(
              command.request
            ).pipe(Effect.mapError(invalidInput));
            const plan = yield* makeService(connection).create(request, policy);
            return yield* encodeMealPlan(plan);
          })
        ),
      ensureHousehold: (untrustedInput: HouseholdEnsureInput) =>
        scoped(
          Effect.gen(function* ensureHouseholdObject() {
            const input = yield* Schema.decodeUnknownEffect(
              HouseholdEnsureInput
            )(untrustedInput).pipe(Effect.mapError(invalidInput));
            const connection = yield* database;
            return yield* ensureHousehold(connection, input);
          })
        ),
      listApprovedRecipes: (untrustedInput: HouseholdEnsureInput) =>
        scoped(
          Effect.gen(function* listApprovedHouseholdRecipes() {
            const command = yield* Schema.decodeUnknownEffect(
              HouseholdEnsureInput
            )(untrustedInput).pipe(Effect.mapError(invalidInput));
            const connection = yield* database;
            yield* ensureHousehold(connection, command);
            const recipes =
              yield* makeHouseholdRecipeBankRepository(
                connection
              ).listApproved();
            return yield* Effect.all(
              recipes.map((recipe) =>
                Schema.encodeEffect(ApprovedRecipe)(recipe).pipe(
                  Effect.mapError(invalidInput)
                )
              )
            );
          })
        ),
      openRecipeReview: (untrustedInput: HouseholdOpenRecipeReviewInput) =>
        scoped(
          Effect.gen(function* openHouseholdRecipeReview() {
            const command = yield* Schema.decodeUnknownEffect(
              HouseholdOpenRecipeReviewInput
            )(untrustedInput).pipe(Effect.mapError(invalidInput));
            const connection = yield* database;
            yield* ensureHousehold(connection, command);
            const [draft, evidence, openedAt] = yield* Effect.all([
              Schema.decodeUnknownEffect(RecipeDraft)(command.snapshot.draft),
              Effect.all(
                command.snapshot.evidence.map((reference) =>
                  Schema.decodeUnknownEffect(EvidenceReference)(reference)
                )
              ),
              Schema.decodeUnknownEffect(ImportTimestamp)(command.openedAt),
            ]).pipe(Effect.mapError(invalidInput));
            const review = yield* makeHouseholdRecipeBankRepository(
              connection
            ).open({ draft, evidence, openedAt });
            return yield* Schema.encodeEffect(Review)(review).pipe(
              Effect.mapError(invalidInput)
            );
          })
        ),
      readMealPlan: (untrustedInput: HouseholdReadMealPlanInput) =>
        scoped(
          Effect.gen(function* readHouseholdMealPlan() {
            const command = yield* Schema.decodeUnknownEffect(
              HouseholdReadMealPlanInput
            )(untrustedInput).pipe(Effect.mapError(invalidInput));
            const connection = yield* database;
            yield* ensureHousehold(connection, command);
            const plan = yield* makeService(connection).read(command.draftId);
            return yield* Option.match(plan, {
              onNone: () => Effect.succeed(null),
              onSome: encodeMealPlan,
            });
          })
        ),
      readRecipeReview: (untrustedInput: HouseholdReadRecipeReviewInput) =>
        scoped(
          Effect.gen(function* readHouseholdRecipeReview() {
            const command = yield* Schema.decodeUnknownEffect(
              HouseholdReadRecipeReviewInput
            )(untrustedInput).pipe(Effect.mapError(invalidInput));
            const connection = yield* database;
            yield* ensureHousehold(connection, command);
            const review = yield* makeHouseholdRecipeBankRepository(
              connection
            ).find(command.importId);
            return yield* Schema.encodeEffect(Review)(review).pipe(
              Effect.mapError(invalidInput)
            );
          })
        ),
      rejectMealPlan: (untrustedInput: HouseholdDecideMealPlanInput) =>
        scoped(
          Effect.gen(function* rejectHouseholdMealPlan() {
            const command = yield* Schema.decodeUnknownEffect(
              HouseholdDecideMealPlanInput
            )(untrustedInput).pipe(Effect.mapError(invalidInput));
            const connection = yield* database;
            yield* ensureHousehold(connection, command);
            const request = yield* Schema.decodeUnknownEffect(
              MealPlanDecisionRequest
            )(command.request).pipe(Effect.mapError(invalidInput));
            const plan = yield* makeService(connection).reject(request);
            return yield* encodeMealPlan(plan);
          })
        ),
      swapMealPlan: (untrustedInput: HouseholdSwapMealPlanInput) =>
        scoped(
          Effect.gen(function* swapHouseholdMealPlan() {
            const command = yield* Schema.decodeUnknownEffect(
              HouseholdSwapMealPlanInput
            )(untrustedInput).pipe(Effect.mapError(invalidInput));
            const connection = yield* database;
            yield* ensureHousehold(connection, command);
            const request = yield* Schema.decodeUnknownEffect(
              ManualMealSwapRequest
            )(command.request).pipe(Effect.mapError(invalidInput));
            const plan = yield* makeService(connection).swap(request);
            return yield* encodeMealPlan(plan);
          })
        ),
      transitionRecipeReview: (
        untrustedInput: HouseholdTransitionRecipeReviewInput
      ) =>
        scoped(
          Effect.gen(function* transitionHouseholdRecipeReview() {
            const command = yield* Schema.decodeUnknownEffect(
              HouseholdTransitionRecipeReviewInput
            )(untrustedInput).pipe(Effect.mapError(invalidInput));
            const connection = yield* database;
            yield* ensureHousehold(connection, command);
            const review =
              yield* makeHouseholdRecipeBankRepository(connection).transition(
                command
              );
            return yield* Schema.encodeEffect(Review)(review).pipe(
              Effect.mapError(invalidInput)
            );
          })
        ),
    });
  }
);

export default class HouseholdObject extends Cloudflare.DurableObject<HouseholdObject>()(
  "HouseholdObject",
  HouseholdObjectRuntime
) {}

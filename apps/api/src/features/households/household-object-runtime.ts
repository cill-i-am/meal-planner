import {
  ManualMealSwapRequest,
  MealPlan,
  MealPlanDecisionRequest,
  MealPlanPolicy,
  MealPlanRecipeSnapshot,
  MealPlanRequest,
} from "@meal-planner/household-api";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Drizzle from "alchemy/Drizzle/Cloudflare";
import type { EffectSQLiteDoDatabase } from "drizzle-orm/effect-sqlite-do";
import { Effect, Option, Schema } from "effect";

import migrations from "../../../household-migrations/migrations.js";
import {
  makeDeterministicMealPlanPlanner,
  makeMealPlanService,
} from "../meal-planning/meal-plan.js";
import { ensureHouseholdProvenance } from "./foundation/household-provenance.js";
import {
  HouseholdCreateMealPlanInput,
  HouseholdDecideMealPlanInput,
  HouseholdReadMealPlanInput,
  HouseholdSwapMealPlanInput,
} from "./household-meal-plan.contract.js";
import { makeHouseholdMealPlanRepository } from "./household-meal-plan.repository.js";
import {
  HouseholdEnsureInput,
  HouseholdInvalidInput,
} from "./household.contract.js";
import { requireHouseholdCommandAdmission } from "./rpc/command-envelope.js";
import { HouseholdDigest } from "./shared-kernel/authority-services.js";

const invalidInput = () => HouseholdInvalidInput.make({});

const encodeMealPlan = (plan: typeof MealPlan.Type) =>
  Schema.encodeEffect(MealPlan)(plan).pipe(Effect.mapError(invalidInput));

const makeService = (
  database: EffectSQLiteDoDatabase,
  digest: Effect.Success<typeof HouseholdDigest>,
  approvedRecipes: readonly MealPlanRecipeSnapshot[] = []
) =>
  makeMealPlanService({
    drafts: makeHouseholdMealPlanRepository(database, digest),
    planner: makeDeterministicMealPlanPlanner(),
    recipeReviews: {
      listApproved: () => Effect.succeed(approvedRecipes),
    },
  });

const decodeApprovedRecipes = (
  encoded: HouseholdCreateMealPlanInput["approvedRecipes"]
) =>
  Effect.all(
    encoded.map((recipe) =>
      Schema.decodeUnknownEffect(MealPlanRecipeSnapshot)(recipe).pipe(
        Effect.mapError(invalidInput)
      )
    )
  );

export const HouseholdObjectRuntime = Effect.gen(
  function* initializeHouseholdObject() {
    const durableObjectState = yield* Cloudflare.DurableObjectState;
    const digest = yield* HouseholdDigest;
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
      approveMealPlan: (untrustedInput: HouseholdDecideMealPlanInput) =>
        scoped(
          Effect.gen(function* approveHouseholdMealPlan() {
            const command = yield* Schema.decodeUnknownEffect(
              HouseholdDecideMealPlanInput,
              { onExcessProperty: "error" }
            )(untrustedInput).pipe(Effect.mapError(invalidInput));
            yield* requireHouseholdCommandAdmission(
              command.admission,
              "approve_meal_plan"
            );
            const connection = yield* database;
            yield* ensureHouseholdProvenance(
              connection,
              command.admission.organizationId
            );
            const request = yield* Schema.decodeUnknownEffect(
              MealPlanDecisionRequest
            )(command.request).pipe(Effect.mapError(invalidInput));
            const plan = yield* makeService(connection, digest).approve(
              request
            );
            return yield* encodeMealPlan(plan);
          })
        ),
      createMealPlan: (untrustedInput: HouseholdCreateMealPlanInput) =>
        scoped(
          Effect.gen(function* createHouseholdMealPlan() {
            const command = yield* Schema.decodeUnknownEffect(
              HouseholdCreateMealPlanInput,
              { onExcessProperty: "error" }
            )(untrustedInput).pipe(Effect.mapError(invalidInput));
            yield* requireHouseholdCommandAdmission(
              command.admission,
              "create_meal_plan"
            );
            const connection = yield* database;
            yield* ensureHouseholdProvenance(
              connection,
              command.admission.organizationId
            );
            const approvedRecipes = yield* decodeApprovedRecipes(
              command.approvedRecipes
            );
            const policy = yield* Schema.decodeUnknownEffect(MealPlanPolicy)(
              command.policy
            ).pipe(Effect.mapError(invalidInput));
            const request = yield* Schema.decodeUnknownEffect(MealPlanRequest)(
              command.request
            ).pipe(Effect.mapError(invalidInput));
            const plan = yield* makeService(
              connection,
              digest,
              approvedRecipes
            ).create(request, policy);
            return yield* encodeMealPlan(plan);
          })
        ),
      ensureHousehold: (untrustedInput: HouseholdEnsureInput) =>
        scoped(
          Effect.gen(function* ensureHouseholdObject() {
            const input = yield* Schema.decodeUnknownEffect(
              HouseholdEnsureInput,
              { onExcessProperty: "error" }
            )(untrustedInput).pipe(Effect.mapError(invalidInput));
            yield* requireHouseholdCommandAdmission(
              input.admission,
              "ensure_household"
            );
            const connection = yield* database;
            return yield* ensureHouseholdProvenance(
              connection,
              input.admission.organizationId
            );
          })
        ),
      readMealPlan: (untrustedInput: HouseholdReadMealPlanInput) =>
        scoped(
          Effect.gen(function* readHouseholdMealPlan() {
            const command = yield* Schema.decodeUnknownEffect(
              HouseholdReadMealPlanInput,
              { onExcessProperty: "error" }
            )(untrustedInput).pipe(Effect.mapError(invalidInput));
            yield* requireHouseholdCommandAdmission(
              command.admission,
              "read_meal_plan"
            );
            const connection = yield* database;
            yield* ensureHouseholdProvenance(
              connection,
              command.admission.organizationId
            );
            const plan = yield* makeService(connection, digest).read(
              command.draftId
            );
            return yield* Option.match(plan, {
              onNone: () => Effect.succeed(null),
              onSome: encodeMealPlan,
            });
          })
        ),
      rejectMealPlan: (untrustedInput: HouseholdDecideMealPlanInput) =>
        scoped(
          Effect.gen(function* rejectHouseholdMealPlan() {
            const command = yield* Schema.decodeUnknownEffect(
              HouseholdDecideMealPlanInput,
              { onExcessProperty: "error" }
            )(untrustedInput).pipe(Effect.mapError(invalidInput));
            yield* requireHouseholdCommandAdmission(
              command.admission,
              "reject_meal_plan"
            );
            const connection = yield* database;
            yield* ensureHouseholdProvenance(
              connection,
              command.admission.organizationId
            );
            const request = yield* Schema.decodeUnknownEffect(
              MealPlanDecisionRequest
            )(command.request).pipe(Effect.mapError(invalidInput));
            const plan = yield* makeService(connection, digest).reject(request);
            return yield* encodeMealPlan(plan);
          })
        ),
      swapMealPlan: (untrustedInput: HouseholdSwapMealPlanInput) =>
        scoped(
          Effect.gen(function* swapHouseholdMealPlan() {
            const command = yield* Schema.decodeUnknownEffect(
              HouseholdSwapMealPlanInput,
              { onExcessProperty: "error" }
            )(untrustedInput).pipe(Effect.mapError(invalidInput));
            yield* requireHouseholdCommandAdmission(
              command.admission,
              "swap_meal_plan"
            );
            const connection = yield* database;
            yield* ensureHouseholdProvenance(
              connection,
              command.admission.organizationId
            );
            const approvedRecipes = yield* Effect.all(
              command.approvedRecipes.map((recipe) =>
                Schema.decodeUnknownEffect(MealPlanRecipeSnapshot)(recipe).pipe(
                  Effect.mapError(invalidInput)
                )
              )
            );
            const request = yield* Schema.decodeUnknownEffect(
              ManualMealSwapRequest
            )(command.request).pipe(Effect.mapError(invalidInput));
            const plan = yield* makeService(
              connection,
              digest,
              approvedRecipes
            ).swap(request);
            return yield* encodeMealPlan(plan);
          })
        ),
    });
  }
);

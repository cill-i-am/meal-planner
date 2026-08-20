import type { HouseholdOrganizationId } from "@meal-planner/household-api";
import * as Cloudflare from "alchemy/Cloudflare";
import { Effect, Schema } from "effect";

import type { MealPlanServiceError } from "../meal-planning/meal-plan.js";
import type {
  HouseholdCreateMealPlanInput,
  HouseholdDecideMealPlanInput,
  HouseholdMealPlanWire,
  HouseholdReadMealPlanInput,
  HouseholdSwapMealPlanInput,
} from "./household-meal-plan.contract.js";
import {
  HouseholdCreateMealPlanInput as HouseholdCreateMealPlanInputSchema,
  HouseholdDecideMealPlanInput as HouseholdDecideMealPlanInputSchema,
  HouseholdReadMealPlanInput as HouseholdReadMealPlanInputSchema,
  HouseholdSwapMealPlanInput as HouseholdSwapMealPlanInputSchema,
} from "./household-meal-plan.contract.js";
import HouseholdObject from "./household-object.js";
import type {
  HouseholdAnswerRecipeReviewInput,
  HouseholdApprovedRecipeWire,
  HouseholdOpenRecipeReviewInput,
  HouseholdReadRecipeReviewInput,
  HouseholdRecipeReviewWire,
  HouseholdTransitionRecipeReviewInput,
  RecipeReviewMutationConflict,
  RecipeReviewNotFound,
  RecipeReviewOpenConflict,
  RecipeReviewTransitionRejected,
  RecipeReviewVersionConflict,
} from "./household-recipe-bank.contract.js";
import {
  HouseholdAnswerRecipeReviewInput as HouseholdAnswerRecipeReviewInputSchema,
  HouseholdOpenRecipeReviewInput as HouseholdOpenRecipeReviewInputSchema,
  HouseholdReadRecipeReviewInput as HouseholdReadRecipeReviewInputSchema,
  HouseholdTransitionRecipeReviewInput as HouseholdTransitionRecipeReviewInputSchema,
} from "./household-recipe-bank.contract.js";
import type {
  HouseholdDomainFailure,
  HouseholdEnsureInput,
  HouseholdMetadata,
} from "./household.contract.js";
import {
  HouseholdInvalidInput,
  householdObjectName,
  HouseholdEnsureInput as HouseholdEnsureInputSchema,
} from "./household.contract.js";

export interface HouseholdDomainWorkerMethods {
  readonly answerRecipeReview: (
    input: HouseholdAnswerRecipeReviewInput
  ) => Effect.Effect<
    HouseholdRecipeReviewWire,
    HouseholdRecipeReviewDomainFailure
  >;
  readonly approveMealPlan: (
    input: HouseholdDecideMealPlanInput
  ) => Effect.Effect<HouseholdMealPlanWire, HouseholdMealPlanDomainFailure>;
  readonly createMealPlan: (
    input: HouseholdCreateMealPlanInput
  ) => Effect.Effect<HouseholdMealPlanWire, HouseholdMealPlanDomainFailure>;
  readonly ensureHousehold: (
    input: HouseholdEnsureInput
  ) => Effect.Effect<HouseholdMetadata, HouseholdDomainFailure>;
  readonly listApprovedRecipes: (
    input: HouseholdEnsureInput
  ) => Effect.Effect<
    readonly HouseholdApprovedRecipeWire[],
    HouseholdDomainFailure
  >;
  readonly openRecipeReview: (
    input: HouseholdOpenRecipeReviewInput
  ) => Effect.Effect<
    HouseholdRecipeReviewWire,
    HouseholdRecipeReviewDomainFailure
  >;
  readonly readMealPlan: (
    input: HouseholdReadMealPlanInput
  ) => Effect.Effect<
    HouseholdMealPlanWire | null,
    HouseholdMealPlanDomainFailure
  >;
  readonly readRecipeReview: (
    input: HouseholdReadRecipeReviewInput
  ) => Effect.Effect<
    HouseholdRecipeReviewWire,
    HouseholdRecipeReviewDomainFailure
  >;
  readonly rejectMealPlan: (
    input: HouseholdDecideMealPlanInput
  ) => Effect.Effect<HouseholdMealPlanWire, HouseholdMealPlanDomainFailure>;
  readonly swapMealPlan: (
    input: HouseholdSwapMealPlanInput
  ) => Effect.Effect<HouseholdMealPlanWire, HouseholdMealPlanDomainFailure>;
  readonly transitionRecipeReview: (
    input: HouseholdTransitionRecipeReviewInput
  ) => Effect.Effect<
    HouseholdRecipeReviewWire,
    HouseholdRecipeReviewDomainFailure
  >;
}

export type HouseholdMealPlanDomainFailure =
  | HouseholdDomainFailure
  | MealPlanServiceError;

export type HouseholdRecipeReviewDomainFailure =
  | HouseholdDomainFailure
  | RecipeReviewMutationConflict
  | RecipeReviewNotFound
  | RecipeReviewOpenConflict
  | RecipeReviewTransitionRejected
  | RecipeReviewVersionConflict;

/** Private RPC boundary for organization-scoped household state. */
export class HouseholdDomainWorker extends Cloudflare.Worker<
  HouseholdDomainWorker,
  Cloudflare.WorkerShape & HouseholdDomainWorkerMethods
>()("HouseholdDomainWorker") {}

const HouseholdDomainWorkerRuntime = Effect.gen(function* makeDomainWorker() {
  const households = yield* HouseholdObject;
  const route = <
    A extends { readonly organizationId: HouseholdOrganizationId },
    I,
    R,
    B,
    E,
  >(
    schema: Schema.Codec<A, I, R>,
    input: A,
    invoke: (
      household: ReturnType<typeof households.getByName>,
      command: A
    ) => Effect.Effect<B, E>
  ) =>
    Schema.decodeUnknownEffect(schema)(input).pipe(
      Effect.mapError(() => HouseholdInvalidInput.make({})),
      Effect.flatMap((command) =>
        invoke(
          households.getByName(householdObjectName(command.organizationId)),
          command
        )
      )
    );
  return {
    answerRecipeReview: (input: HouseholdAnswerRecipeReviewInput) =>
      route(
        HouseholdAnswerRecipeReviewInputSchema,
        input,
        (household, command) => household.answerRecipeReview(command)
      ),
    approveMealPlan: (input: HouseholdDecideMealPlanInput) =>
      route(HouseholdDecideMealPlanInputSchema, input, (household, command) =>
        household.approveMealPlan(command)
      ),
    createMealPlan: (input: HouseholdCreateMealPlanInput) =>
      route(HouseholdCreateMealPlanInputSchema, input, (household, command) =>
        household.createMealPlan(command)
      ),
    ensureHousehold: (input: HouseholdEnsureInput) =>
      Schema.decodeUnknownEffect(HouseholdEnsureInputSchema)(input).pipe(
        Effect.mapError(() => HouseholdInvalidInput.make({})),
        Effect.flatMap((command) =>
          households
            .getByName(householdObjectName(command.organizationId))
            .ensureHousehold(command)
        )
      ),
    listApprovedRecipes: (input: HouseholdEnsureInput) =>
      Schema.decodeUnknownEffect(HouseholdEnsureInputSchema)(input).pipe(
        Effect.mapError(() => HouseholdInvalidInput.make({})),
        Effect.flatMap((command) =>
          households
            .getByName(householdObjectName(command.organizationId))
            .listApprovedRecipes(command)
        )
      ),
    openRecipeReview: (input: HouseholdOpenRecipeReviewInput) =>
      route(HouseholdOpenRecipeReviewInputSchema, input, (household, command) =>
        household.openRecipeReview(command)
      ),
    readMealPlan: (input: HouseholdReadMealPlanInput) =>
      route(HouseholdReadMealPlanInputSchema, input, (household, command) =>
        household.readMealPlan(command)
      ),
    readRecipeReview: (input: HouseholdReadRecipeReviewInput) =>
      route(HouseholdReadRecipeReviewInputSchema, input, (household, command) =>
        household.readRecipeReview(command)
      ),
    rejectMealPlan: (input: HouseholdDecideMealPlanInput) =>
      route(HouseholdDecideMealPlanInputSchema, input, (household, command) =>
        household.rejectMealPlan(command)
      ),
    swapMealPlan: (input: HouseholdSwapMealPlanInput) =>
      route(HouseholdSwapMealPlanInputSchema, input, (household, command) =>
        household.swapMealPlan(command)
      ),
    transitionRecipeReview: (input: HouseholdTransitionRecipeReviewInput) =>
      route(
        HouseholdTransitionRecipeReviewInputSchema,
        input,
        (household, command) => household.transitionRecipeReview(command)
      ),
  } satisfies HouseholdDomainWorkerMethods;
});

export default HouseholdDomainWorker.make(
  {
    main: import.meta.url,
    observability: {
      enabled: true,
      headSamplingRate: 1,
      logs: {
        enabled: true,
        headSamplingRate: 1,
        invocationLogs: false,
        persist: true,
      },
      traces: { enabled: false },
    },
    workersDev: false,
  },
  HouseholdDomainWorkerRuntime
);

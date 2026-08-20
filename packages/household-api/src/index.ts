import { Context, Layer, Schema } from "effect";
import {
  HttpApi,
  HttpApiClient,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiMiddleware,
  HttpApiSchema,
} from "effect/unstable/httpapi";

import type { HouseholdCurrentPrincipal } from "./household-principal.js";
import { HouseholdOrganizationId } from "./household-principal.js";
import type { HouseholdMealPlanCurrentPrincipal } from "./meal-plan-http.js";
import {
  HouseholdMealPlanResponse,
  HouseholdMealPlanConflictProblem,
  HouseholdMealPlanInternalProblem,
  HouseholdMealPlanInvalidRequestProblem,
  HouseholdMealPlanNotFoundProblem,
} from "./meal-plan-http.js";
import { HouseholdMealPlanSchemaErrors } from "./meal-plan-schema-errors.js";
import {
  CreateMealPlanPayload,
  DecideMealPlanPayload,
  MealPlanDraftId,
  SwapMealPlanPayload,
} from "./meal-plan.js";

export {
  HouseholdCurrentPrincipal,
  HouseholdOrganizationId,
  HouseholdPrincipal,
} from "./household-principal.js";
export {
  HouseholdMealPlanConflictProblem,
  HouseholdMealPlanCurrentPrincipal,
  HouseholdMealPlanInternalProblem,
  HouseholdMealPlanInvalidRequestProblem,
  HouseholdMealPlanNotFoundProblem,
  HouseholdMealPlanPrincipal,
  HouseholdMealPlanResponse,
  toHouseholdMealPlanResponse,
} from "./meal-plan-http.js";
export {
  CreateMealPlanPayload,
  DecideMealPlanPayload,
  ManualMealSwapRequest,
  ManualSwapAudit,
  MealPlan,
  MealPlanActorId,
  MealPlanApproved,
  MealPlanDecisionRequest,
  MealPlanDietaryFit,
  MealPlanDifficulty,
  MealPlanDraft,
  MealPlanDraftId,
  MealPlanGap,
  MealPlanInstant,
  MealPlanLeftovers,
  MealPlanMealType,
  MealPlanMutationConflict,
  MealPlanMutationId,
  MealPlanNotFound,
  MealPlanPersistenceFailure,
  MealPlanPolicy,
  MealPlanPolicyVersion,
  MealPlanProposal,
  MealPlanReason,
  MealPlanRecipeSnapshot,
  MealPlanRecipeSnapshotId,
  MealPlanRejected,
  MealPlanRequest,
  MealPlanRequestConflict,
  MealPlanRequestKey,
  MealPlanSlot,
  MealPlanSlotId,
  MealPlanSwapRejected,
  MealPlanTags,
  MealPlanTotalTimeBand,
  MealPlanTransitionRejected,
  MealPlanVersionConflict,
  PlannedMeal,
  SwapMealPlanPayload,
} from "./meal-plan.js";
export { HouseholdMealPlanSchemaErrors } from "./meal-plan-schema-errors.js";

export const HouseholdStatus = Schema.Struct({
  createdAtEpochMs: Schema.Int.pipe(
    Schema.check(Schema.isGreaterThanOrEqualTo(0))
  ),
  organizationId: HouseholdOrganizationId,
  status: Schema.Literal("ready"),
});
export type HouseholdStatus = typeof HouseholdStatus.Type;

const ProblemDetails = <const Status extends number, const Code extends string>(
  status: Status,
  code: Code
) =>
  Schema.Struct({
    code: Schema.Literal(code),
    message: Schema.String,
    status: Schema.Literal(status),
  }).pipe(
    HttpApiSchema.status(status),
    HttpApiSchema.asJson({ contentType: "application/problem+json" })
  );

export const HouseholdUnauthorizedProblem = ProblemDetails(401, "unauthorized");
export const HouseholdInternalProblem = ProblemDetails(500, "internal_error");

export class HouseholdSessionAuth extends HttpApiMiddleware.Service<
  HouseholdSessionAuth,
  {
    provides: HouseholdCurrentPrincipal | HouseholdMealPlanCurrentPrincipal;
  }
>()("HouseholdSessionAuth", { error: HouseholdUnauthorizedProblem }) {}

const HouseholdsGroup = HttpApiGroup.make("households")
  .add(
    HttpApiEndpoint.get("current", "/v1/household", {
      error: HouseholdInternalProblem,
      success: HouseholdStatus,
    })
  )
  .middleware(HouseholdSessionAuth);

export const HouseholdApi = HttpApi.make("householdApi").add(HouseholdsGroup);

const MealPlansGroup = HttpApiGroup.make("mealPlans")
  .add(
    HttpApiEndpoint.post("create", "/v1/meal-plans", {
      error: [
        HouseholdMealPlanConflictProblem,
        HouseholdMealPlanInternalProblem,
      ],
      payload: CreateMealPlanPayload,
      success: HouseholdMealPlanResponse.pipe(HttpApiSchema.status(201)),
    }),
    HttpApiEndpoint.get("read", "/v1/meal-plans/:draftId", {
      error: [
        HouseholdMealPlanNotFoundProblem,
        HouseholdMealPlanInternalProblem,
      ],
      params: { draftId: MealPlanDraftId },
      success: HouseholdMealPlanResponse,
    }),
    HttpApiEndpoint.post("swap", "/v1/meal-plans/:draftId/swaps", {
      error: [
        HouseholdMealPlanInvalidRequestProblem,
        HouseholdMealPlanNotFoundProblem,
        HouseholdMealPlanConflictProblem,
        HouseholdMealPlanInternalProblem,
      ],
      params: { draftId: MealPlanDraftId },
      payload: SwapMealPlanPayload,
      success: HouseholdMealPlanResponse,
    }),
    HttpApiEndpoint.post("approve", "/v1/meal-plans/:draftId/approve", {
      error: [
        HouseholdMealPlanNotFoundProblem,
        HouseholdMealPlanConflictProblem,
        HouseholdMealPlanInternalProblem,
      ],
      params: { draftId: MealPlanDraftId },
      payload: DecideMealPlanPayload,
      success: HouseholdMealPlanResponse,
    }),
    HttpApiEndpoint.post("reject", "/v1/meal-plans/:draftId/reject", {
      error: [
        HouseholdMealPlanNotFoundProblem,
        HouseholdMealPlanConflictProblem,
        HouseholdMealPlanInternalProblem,
      ],
      params: { draftId: MealPlanDraftId },
      payload: DecideMealPlanPayload,
      success: HouseholdMealPlanResponse,
    })
  )
  .middleware(HouseholdSessionAuth);

export const HouseholdMealPlanApi = HttpApi.make("householdMealPlanApi")
  .add(MealPlansGroup)
  .middleware(HouseholdMealPlanSchemaErrors);

export type HouseholdApiClient = HttpApiClient.ForApi<typeof HouseholdApi>;

export const HouseholdApiClient = Context.Service<HouseholdApiClient>(
  "meal-planner/HouseholdApiClient"
);

export const makeHouseholdApiClientLayer = (options: {
  readonly baseUrl: string | URL;
}) =>
  Layer.effect(
    HouseholdApiClient,
    HttpApiClient.make(HouseholdApi, { baseUrl: options.baseUrl })
  );

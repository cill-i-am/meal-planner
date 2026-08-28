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
import type { HouseholdPeopleCurrentPrincipal } from "./people-http.js";
import {
  HouseholdPeopleBootstrapConflictProblem,
  HouseholdPeopleLifecycleConflictProblem,
  HouseholdPeopleMutationCollisionProblem,
  HouseholdPeopleStaleVersionProblem,
  HouseholdPeopleNotFoundProblem,
  HouseholdPeopleUnavailableProblem,
} from "./people-http.js";
import { HouseholdPeopleSchemaErrors } from "./people-schema-errors.js";
import {
  BootstrapHouseholdCreatorPayload,
  CreateHouseholdPersonPayload,
  HouseholdPeopleRoster,
  HouseholdPerson,
  HouseholdPersonId,
  ListHouseholdPeopleUrlParams,
  TransitionHouseholdPersonPayload,
} from "./people.js";

export {
  BootstrapHouseholdCreatorPayload,
  CreateHouseholdPersonPayload,
  HouseholdCreatorBootstrapConflict,
  HouseholdPeopleRoster,
  HouseholdPeopleUnavailable,
  HouseholdPerson,
  HouseholdPersonDisplayName,
  HouseholdPersonId,
  HouseholdPersonKind,
  HouseholdPersonLifecycle,
  HouseholdPersonLifecycleConflict,
  HouseholdPersonMutationCollision,
  HouseholdPersonMutationId,
  HouseholdPersonNotFound,
  HouseholdPersonStaleVersion,
  HouseholdPersonVersion,
  ListHouseholdPeopleUrlParams,
  TransitionHouseholdPersonPayload,
} from "./people.js";
export type { HouseholdPeopleFailure } from "./people.js";
export {
  HouseholdPeopleBootstrapConflictProblem,
  HouseholdPeopleCurrentPrincipal,
  HouseholdPeopleInvalidRequestProblem,
  HouseholdPeopleLifecycleConflictProblem,
  HouseholdPeopleMutationCollisionProblem,
  HouseholdPeopleNotFoundProblem,
  HouseholdPeoplePrincipal,
  HouseholdPeopleStaleVersionProblem,
  HouseholdPeopleUnavailableProblem,
} from "./people-http.js";
export { HouseholdPeopleSchemaErrors } from "./people-schema-errors.js";

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
    provides:
      | HouseholdCurrentPrincipal
      | HouseholdMealPlanCurrentPrincipal
      | HouseholdPeopleCurrentPrincipal;
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

const PeopleGroup = HttpApiGroup.make("people")
  .add(
    HttpApiEndpoint.post(
      "bootstrapCreator",
      "/v1/household/people/bootstrap-creator",
      {
        error: [
          HouseholdPeopleBootstrapConflictProblem,
          HouseholdPeopleMutationCollisionProblem,
          HouseholdPeopleUnavailableProblem,
        ],
        payload: BootstrapHouseholdCreatorPayload,
        success: HouseholdPerson,
      }
    ),
    HttpApiEndpoint.get("list", "/v1/household/people", {
      error: HouseholdPeopleUnavailableProblem,
      query: ListHouseholdPeopleUrlParams,
      success: HouseholdPeopleRoster,
    }),
    HttpApiEndpoint.get("get", "/v1/household/people/:personId", {
      error: [
        HouseholdPeopleNotFoundProblem,
        HouseholdPeopleUnavailableProblem,
      ],
      params: { personId: HouseholdPersonId },
      success: HouseholdPerson,
    }),
    HttpApiEndpoint.post("create", "/v1/household/people", {
      error: [
        HouseholdPeopleMutationCollisionProblem,
        HouseholdPeopleUnavailableProblem,
      ],
      payload: CreateHouseholdPersonPayload,
      success: HouseholdPerson.pipe(HttpApiSchema.status(201)),
    }),
    HttpApiEndpoint.post("archive", "/v1/household/people/:personId/archive", {
      error: [
        HouseholdPeopleNotFoundProblem,
        HouseholdPeopleLifecycleConflictProblem,
        HouseholdPeopleMutationCollisionProblem,
        HouseholdPeopleStaleVersionProblem,
        HouseholdPeopleUnavailableProblem,
      ],
      params: { personId: HouseholdPersonId },
      payload: TransitionHouseholdPersonPayload,
      success: HouseholdPerson,
    }),
    HttpApiEndpoint.post("restore", "/v1/household/people/:personId/restore", {
      error: [
        HouseholdPeopleNotFoundProblem,
        HouseholdPeopleLifecycleConflictProblem,
        HouseholdPeopleMutationCollisionProblem,
        HouseholdPeopleStaleVersionProblem,
        HouseholdPeopleUnavailableProblem,
      ],
      params: { personId: HouseholdPersonId },
      payload: TransitionHouseholdPersonPayload,
      success: HouseholdPerson,
    })
  )
  .middleware(HouseholdSessionAuth);

/** Authenticated public household people API. */
export const HouseholdPeopleApi = HttpApi.make("householdPeopleApi")
  .add(PeopleGroup)
  .middleware(HouseholdPeopleSchemaErrors);

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

/** Generated client for the authenticated household people API. */
export type HouseholdPeopleApiClient = HttpApiClient.ForApi<
  typeof HouseholdPeopleApi
>;

/** Injectable generated household people client. */
export const HouseholdPeopleApiClient =
  Context.Service<HouseholdPeopleApiClient>(
    "meal-planner/HouseholdPeopleApiClient"
  );

/** Construct a generated household people client layer. */
export const makeHouseholdPeopleApiClientLayer = (options: {
  readonly baseUrl: string | URL;
}) =>
  Layer.effect(
    HouseholdPeopleApiClient,
    HttpApiClient.make(HouseholdPeopleApi, { baseUrl: options.baseUrl })
  );

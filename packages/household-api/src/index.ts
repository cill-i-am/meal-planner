import { Context, Layer, Schema } from "effect";
import { HttpClient, HttpClientRequest } from "effect/http";
import {
  HttpApi,
  HttpApiClient,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiMiddleware,
  HttpApiSchema,
} from "effect/http-api";

import type { HouseholdCurrentPrincipal } from "./household-principal.js";
import { HouseholdOrganizationId } from "./household-principal.js";
import { HouseholdPlanningContentGroup } from "./meal-content-http.js";
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
  MealPlanId,
  MealPlanSummary,
  ChangeMealPlanPayload,
} from "./meal-plan.js";
import type { HouseholdPeopleCurrentPrincipal } from "./people-http.js";
import {
  HouseholdPeopleBootstrapConflictProblem,
  HouseholdPeopleAssociationConflictProblem,
  HouseholdPeopleAssociationStaleProblem,
  HouseholdPeopleControlPlaneNotFoundProblem,
  HouseholdPeopleControlPlaneUnavailableProblem,
  HouseholdInvitationRejectedProblem,
  HouseholdPeopleCreatorRequiredProblem,
  HouseholdPeopleDepartureConflictProblem,
  HouseholdPeopleLifecycleConflictProblem,
  HouseholdPeopleMutationCollisionProblem,
  HouseholdPeopleStaleVersionProblem,
  HouseholdPeopleNotFoundProblem,
  HouseholdPeopleOrganizerRequiredProblem,
  HouseholdPeopleUnavailableProblem,
} from "./people-http.js";
import { HouseholdPeopleSchemaErrors } from "./people-schema-errors.js";
import {
  BootstrapHouseholdCreatorPayload,
  AssociateHouseholdAdultInvitationPayload,
  CompleteHouseholdAdultLinkPayload,
  CancelHouseholdAdultDeparturePayload,
  CreateHouseholdPersonPayload,
  RenameHouseholdPersonPayload,
  DepartHouseholdAdultPayload,
  HouseholdAdultInvitationResult,
  HouseholdMemberDepartureOperation,
  HouseholdMemberDepartureOperationId,
  HouseholdPeopleRoster,
  HouseholdPerson,
  HouseholdPersonId,
  HouseholdPersonMutationId,
  InviteHouseholdAdultPayload,
  ListHouseholdPeopleUrlParams,
  RepairHouseholdAdultLinkPayload,
  RetryHouseholdAdultDeparturePayload,
  ReturnHouseholdAdultPayload,
  TransitionHouseholdPersonPayload,
} from "./people.js";
import { ProblemDetails } from "./problem-details.js";
import {
  HouseholdProfileErrors,
  ListProfileVersionsQuery,
  MutatePersonProfilePayload,
  PersonProfile,
  ProfileAuditPage,
  ProfileVersionPage,
} from "./profiles.js";

export {
  SavedRecipeSummary,
  SavedRecipePage,
  SavedRecipePageQuery,
  PlanningContentId,
  PlanningContentMutationId,
  PlanningContentVersion,
  PlanningOptionVersion,
  PlanningDate,
  MealOccasionId,
  Weekday,
  Location,
  SubstitutionPolicy,
  QuantityUnit,
  KnownQuantity,
  UnresolvedQuantity,
  Quantity,
  PlanningOptionRef,
  FoodComponent,
  PreparationProfile,
  PreparationTime,
  MealOptionCover,
  MealOption,
  ManagedOccasion,
  Availability,
  CookingCapacity,
  RoutineChoice,
  Routine,
  OneOffRoutine,
  Fallback,
  SuitabilityReview,
  SuitabilityReviewWrite,
  PreparedPortion,
  PreparedPortionWrite,
  ConfirmPreparedCarryOver,
  PlanningContentSnapshot,
  PlanningContentCommand,
  MutatePlanningContentPayload,
  PlanningContentRejected,
} from "./meal-content.js";

export {
  FoodPreference,
  HardConstraint,
  InterviewProfileOutcome,
  HouseholdProfileRejected,
  HouseholdProfileProblem,
  ListProfileVersionsQuery,
  MutatePersonProfilePayload,
  PersonProfile,
  ProfileAudit,
  ProfileCommand,
  ProfileFact,
  ProfileFactId,
  ProfileFactStanding,
  ProfileFactValue,
  ProfileLabel,
  ProfileVersion,
  ProfileVersionPage,
} from "./profiles.js";

export {
  AssociateAdultInvitationPayload,
  AssociateHouseholdAdultInvitationPayload,
  BootstrapHouseholdCreatorPayload,
  CancelMemberDeparturePayload,
  CancelHouseholdAdultDeparturePayload,
  CompleteAcceptedAdultLinkPayload,
  CompleteHouseholdAdultLinkPayload,
  CreateHouseholdPersonPayload,
  InvitationRejectionReason,
  RenameHouseholdPersonPayload,
  DepartHouseholdAdultPayload,
  HouseholdAdultInvitationResult,
  HouseholdAssociationStaleVersion,
  HouseholdAssociationVersion,
  HouseholdCreatorBootstrapConflict,
  HouseholdCreatorSlot,
  HouseholdMemberDepartureConflict,
  HouseholdMemberDepartureInProgress,
  HouseholdMemberDepartureOperation,
  HouseholdMemberDepartureOperationId,
  HouseholdMemberDepartureStart,
  HouseholdMemberDepartureState,
  HouseholdPeopleRoster,
  HouseholdPeopleOperationReason,
  HouseholdPeopleUnavailable,
  HouseholdInvitationDigest,
  HouseholdInvitationRequestDigest,
  HouseholdPerson,
  HouseholdPersonAssociationConflict,
  HouseholdPersonAssociationState,
  HouseholdPersonDisplayName,
  HouseholdPersonId,
  HouseholdPersonKind,
  HouseholdPersonLifecycle,
  HouseholdPersonLifecycleConflict,
  HouseholdPersonLinkId,
  HouseholdPersonMutationCollision,
  HouseholdPersonMutationId,
  HouseholdPersonNotFound,
  HouseholdPersonStaleVersion,
  HouseholdPersonVersion,
  InviteHouseholdAdultPayload,
  ListHouseholdPeopleUrlParams,
  PrepareMemberDeparturePayload,
  RepairAdultAccountLinkPayload,
  RepairHouseholdAdultLinkPayload,
  RestoreReturningAdultLinkPayload,
  ReturnHouseholdAdultPayload,
  RetryMemberDeparturePayload,
  RetryHouseholdAdultDeparturePayload,
  TransitionHouseholdPersonPayload,
} from "./people.js";
export {
  AuthAccountId,
  AuthVerificationId,
  EmailAddress,
  InvitationId,
  MemberId,
  UserId,
} from "./auth-values.js";
export type { HouseholdPeopleFailure } from "./people.js";
export {
  HouseholdPeopleBootstrapConflictProblem,
  HouseholdPeopleAssociationConflictProblem,
  HouseholdPeopleAssociationStaleProblem,
  HouseholdPeopleControlPlaneNotFoundProblem,
  HouseholdPeopleControlPlaneUnavailableProblem,
  HouseholdInvitationRejectedProblem,
  HouseholdPeopleCreatorRequiredProblem,
  HouseholdPeopleDepartureConflictProblem,
  HouseholdPeopleCurrentPrincipal,
  HouseholdPeopleInvalidRequestProblem,
  HouseholdPeopleLifecycleConflictProblem,
  HouseholdPeopleMutationCollisionProblem,
  HouseholdPeopleNotFoundProblem,
  HouseholdPeopleOrganizerRequiredProblem,
  HouseholdPeoplePrincipal,
  HouseholdPeopleAuditActorId,
  HouseholdPersonLinkageSubject,
  HouseholdCreatorAuthority,
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
  HouseholdMealPlanConflictReason,
  HouseholdMealPlanCurrentPrincipal,
  HouseholdMealPlanInternalProblem,
  HouseholdMealPlanInvalidRequestProblem,
  HouseholdMealPlanNotFoundProblem,
  HouseholdMealPlanPrincipal,
  HouseholdMealPlanResponse,
  toHouseholdMealPlanResponse,
} from "./meal-plan-http.js";
export {
  MealPlanDate,
  MealPlanOccasion,
  MealPlanWeeks,
  MealPlanRequestKey,
  MealPlanId,
  MealPlanMutationId,
  MealPlanActorId,
  MealPlanInstant,
  MealPlanRequest,
  CreateMealPlanPayload,
  MealPlanRequirementKey,
  MealPlanOptionRef,
  MealPlanQuantity,
  MealPlanResolution,
  MealPlanCoverage,
  MealPlanCookOutput,
  MealPlanCookEvent,
  MealPlanPersonPin,
  MealPlanRoutinePin,
  MealPlanPins,
  MealPlanVersion,
  MealPlanAudit,
  MealPlanDraft,
  MealPlanApproved,
  MealPlanProposedRevision,
  MealPlan,
  MealPlanSummary,
  toMealPlanSummary,
  MealPlanChange,
  ChangeMealPlanPayload,
  DecideMealPlanPayload,
  MealPlanRequestConflict,
  MealPlanNotFound,
  MealPlanVersionConflict,
  MealPlanTransitionRejected,
  MealPlanMutationConflict,
  MealPlanRuleViolation,
  MealPlanPersistenceFailure,
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

export const HouseholdApi = HttpApi.make("householdApi")
  .annotate(HttpApi.PayloadParseOptions, { onExcessProperty: "error" })
  .annotate(HttpApi.QueryParseOptions, { onExcessProperty: "error" })
  .add(HouseholdsGroup);

const MealPlanMutationErrors = [
  HouseholdMealPlanInvalidRequestProblem,
  HouseholdMealPlanNotFoundProblem,
  HouseholdMealPlanConflictProblem,
  HouseholdMealPlanInternalProblem,
] as const;

const MealPlansGroup = HttpApiGroup.make("mealPlans")
  .add(
    HttpApiEndpoint.get("list", "/v1/meal-plans", {
      error: HouseholdMealPlanInternalProblem,
      success: Schema.Array(MealPlanSummary),
    }),
    HttpApiEndpoint.post("create", "/v1/meal-plans", {
      error: MealPlanMutationErrors,
      payload: CreateMealPlanPayload,
      success: HouseholdMealPlanResponse.pipe(HttpApiSchema.status(201)),
    }),
    HttpApiEndpoint.get("read", "/v1/meal-plans/:planId", {
      error: [
        HouseholdMealPlanNotFoundProblem,
        HouseholdMealPlanInternalProblem,
      ],
      params: { planId: MealPlanId },
      success: HouseholdMealPlanResponse,
    }),
    HttpApiEndpoint.post("change", "/v1/meal-plans/:planId/changes", {
      error: MealPlanMutationErrors,
      params: { planId: MealPlanId },
      payload: ChangeMealPlanPayload,
      success: HouseholdMealPlanResponse,
    }),
    HttpApiEndpoint.post("approve", "/v1/meal-plans/:planId/approve", {
      error: MealPlanMutationErrors,
      params: { planId: MealPlanId },
      payload: DecideMealPlanPayload,
      success: HouseholdMealPlanResponse,
    }),
    HttpApiEndpoint.post(
      "proposeRevision",
      "/v1/meal-plans/:planId/propose-revision",
      {
        error: MealPlanMutationErrors,
        params: { planId: MealPlanId },
        payload: DecideMealPlanPayload,
        success: HouseholdMealPlanResponse,
      }
    ),
    HttpApiEndpoint.post(
      "acceptRevision",
      "/v1/meal-plans/:planId/accept-revision",
      {
        error: MealPlanMutationErrors,
        params: { planId: MealPlanId },
        payload: DecideMealPlanPayload,
        success: HouseholdMealPlanResponse,
      }
    ),
    HttpApiEndpoint.post(
      "rejectRevision",
      "/v1/meal-plans/:planId/reject-revision",
      {
        error: MealPlanMutationErrors,
        params: { planId: MealPlanId },
        payload: DecideMealPlanPayload,
        success: HouseholdMealPlanResponse,
      }
    )
  )
  .middleware(HouseholdSessionAuth);

export const HouseholdMealPlanApi = HttpApi.make("householdMealPlanApi")
  .annotate(HttpApi.PayloadParseOptions, { onExcessProperty: "error" })
  .annotate(HttpApi.QueryParseOptions, { onExcessProperty: "error" })
  .add(MealPlansGroup)
  .middleware(HouseholdMealPlanSchemaErrors);

export const AuthenticatedHouseholdPlanningContentApi = HttpApi.make(
  "householdPlanningContentApi"
)
  .annotate(HttpApi.PayloadParseOptions, { onExcessProperty: "error" })
  .annotate(HttpApi.QueryParseOptions, { onExcessProperty: "error" })
  .add(HouseholdPlanningContentGroup.middleware(HouseholdSessionAuth));

const PeopleGroup = HttpApiGroup.make("people")
  .add(
    HttpApiEndpoint.get(
      "getProfileVersion",
      "/v1/families/:familyId/people/:personId/profile/versions/:version",
      {
        error: HouseholdProfileErrors,
        params: {
          familyId: HouseholdOrganizationId,
          personId: HouseholdPersonId,
          version: Schema.NumberFromString.pipe(
            Schema.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))
          ),
        },
        success: PersonProfile,
      }
    ),
    HttpApiEndpoint.get(
      "listProfileAudit",
      "/v1/families/:familyId/people/:personId/profile/audit",
      {
        error: HouseholdProfileErrors,
        params: {
          familyId: HouseholdOrganizationId,
          personId: HouseholdPersonId,
        },
        query: ListProfileVersionsQuery,
        success: ProfileAuditPage,
      }
    ),
    HttpApiEndpoint.get(
      "getProfile",
      "/v1/families/:familyId/people/:personId/profile",
      {
        error: HouseholdProfileErrors,
        params: {
          familyId: HouseholdOrganizationId,
          personId: HouseholdPersonId,
        },
        success: PersonProfile,
      }
    ),
    HttpApiEndpoint.get(
      "listProfileVersions",
      "/v1/families/:familyId/people/:personId/profile/versions",
      {
        error: HouseholdProfileErrors,
        params: {
          familyId: HouseholdOrganizationId,
          personId: HouseholdPersonId,
        },
        query: ListProfileVersionsQuery,
        success: ProfileVersionPage,
      }
    ),
    HttpApiEndpoint.post(
      "mutateProfile",
      "/v1/families/:familyId/people/:personId/profile",
      {
        error: HouseholdProfileErrors,
        params: {
          familyId: HouseholdOrganizationId,
          personId: HouseholdPersonId,
        },
        payload: MutatePersonProfilePayload,
        success: PersonProfile,
      }
    ),
    HttpApiEndpoint.post(
      "bootstrapCreator",
      "/v1/families/:familyId/people/bootstrap-creator",
      {
        error: [
          HouseholdPeopleBootstrapConflictProblem,
          HouseholdPeopleCreatorRequiredProblem,
          HouseholdPeopleMutationCollisionProblem,
          HouseholdPeopleUnavailableProblem,
        ],
        params: { familyId: HouseholdOrganizationId },
        payload: BootstrapHouseholdCreatorPayload,
        success: HouseholdPerson,
      }
    ),
    HttpApiEndpoint.get("list", "/v1/families/:familyId/people", {
      error: HouseholdPeopleUnavailableProblem,
      params: { familyId: HouseholdOrganizationId },
      query: ListHouseholdPeopleUrlParams,
      success: HouseholdPeopleRoster,
    }),
    HttpApiEndpoint.get("get", "/v1/families/:familyId/people/:personId", {
      error: [
        HouseholdPeopleNotFoundProblem,
        HouseholdPeopleUnavailableProblem,
      ],
      params: {
        familyId: HouseholdOrganizationId,
        personId: HouseholdPersonId,
      },
      success: HouseholdPerson,
    }),
    HttpApiEndpoint.post("create", "/v1/families/:familyId/people", {
      error: [
        HouseholdPeopleMutationCollisionProblem,
        HouseholdPeopleUnavailableProblem,
      ],
      params: { familyId: HouseholdOrganizationId },
      payload: CreateHouseholdPersonPayload,
      success: HouseholdPerson.pipe(HttpApiSchema.status(201)),
    }),
    HttpApiEndpoint.patch("rename", "/v1/families/:familyId/people/:personId", {
      error: [
        HouseholdPeopleNotFoundProblem,
        HouseholdPeopleLifecycleConflictProblem,
        HouseholdPeopleMutationCollisionProblem,
        HouseholdPeopleStaleVersionProblem,
        HouseholdPeopleUnavailableProblem,
      ],
      params: {
        familyId: HouseholdOrganizationId,
        personId: HouseholdPersonId,
      },
      payload: RenameHouseholdPersonPayload,
      success: HouseholdPerson,
    }),
    HttpApiEndpoint.delete(
      "remove",
      "/v1/families/:familyId/people/:personId",
      {
        error: [
          HouseholdPeopleNotFoundProblem,
          HouseholdPeopleLifecycleConflictProblem,
          HouseholdPeopleMutationCollisionProblem,
          HouseholdPeopleStaleVersionProblem,
          HouseholdPeopleUnavailableProblem,
          HouseholdPeopleOrganizerRequiredProblem,
          HouseholdPeopleAssociationConflictProblem,
          HouseholdPeopleAssociationStaleProblem,
          HouseholdPeopleControlPlaneNotFoundProblem,
          HouseholdPeopleControlPlaneUnavailableProblem,
          HouseholdPeopleDepartureConflictProblem,
        ],
        params: {
          familyId: HouseholdOrganizationId,
          personId: HouseholdPersonId,
        },
        payload: TransitionHouseholdPersonPayload,
        success: HouseholdPerson,
      }
    ),
    HttpApiEndpoint.post(
      "archive",
      "/v1/families/:familyId/people/:personId/archive",
      {
        error: [
          HouseholdPeopleNotFoundProblem,
          HouseholdPeopleLifecycleConflictProblem,
          HouseholdPeopleMutationCollisionProblem,
          HouseholdPeopleStaleVersionProblem,
          HouseholdPeopleUnavailableProblem,
        ],
        params: {
          familyId: HouseholdOrganizationId,
          personId: HouseholdPersonId,
        },
        payload: TransitionHouseholdPersonPayload,
        success: HouseholdPerson,
      }
    ),
    HttpApiEndpoint.post(
      "restore",
      "/v1/families/:familyId/people/:personId/restore",
      {
        error: [
          HouseholdPeopleNotFoundProblem,
          HouseholdPeopleLifecycleConflictProblem,
          HouseholdPeopleMutationCollisionProblem,
          HouseholdPeopleStaleVersionProblem,
          HouseholdPeopleUnavailableProblem,
        ],
        params: {
          familyId: HouseholdOrganizationId,
          personId: HouseholdPersonId,
        },
        payload: TransitionHouseholdPersonPayload,
        success: HouseholdPerson,
      }
    ),
    HttpApiEndpoint.post(
      "inviteAdult",
      "/v1/families/:familyId/people/invitations",
      {
        error: [
          HouseholdPeopleAssociationConflictProblem,
          HouseholdPeopleControlPlaneUnavailableProblem,
          HouseholdInvitationRejectedProblem,
          HouseholdPeopleMutationCollisionProblem,
          HouseholdPeopleNotFoundProblem,
          HouseholdPeopleOrganizerRequiredProblem,
          HouseholdPeopleUnavailableProblem,
        ],
        params: { familyId: HouseholdOrganizationId },
        payload: InviteHouseholdAdultPayload,
        success: HouseholdAdultInvitationResult.pipe(HttpApiSchema.status(201)),
      }
    ),
    HttpApiEndpoint.post(
      "associateInvitation",
      "/v1/families/:familyId/people/invitations/associate",
      {
        error: [
          HouseholdPeopleAssociationConflictProblem,
          HouseholdPeopleControlPlaneNotFoundProblem,
          HouseholdPeopleMutationCollisionProblem,
          HouseholdPeopleNotFoundProblem,
          HouseholdPeopleOrganizerRequiredProblem,
          HouseholdPeopleUnavailableProblem,
        ],
        params: { familyId: HouseholdOrganizationId },
        payload: AssociateHouseholdAdultInvitationPayload,
        success: HouseholdPerson,
      }
    ),
    HttpApiEndpoint.post(
      "completeAdultLink",
      "/v1/families/:familyId/people/links/complete",
      {
        error: [
          HouseholdPeopleAssociationConflictProblem,
          HouseholdPeopleControlPlaneNotFoundProblem,
          HouseholdPeopleMutationCollisionProblem,
          HouseholdPeopleUnavailableProblem,
        ],
        params: { familyId: HouseholdOrganizationId },
        payload: CompleteHouseholdAdultLinkPayload,
        success: HouseholdPerson,
      }
    ),
    HttpApiEndpoint.post(
      "repairAdultLink",
      "/v1/families/:familyId/people/links/repair",
      {
        error: [
          HouseholdPeopleAssociationConflictProblem,
          HouseholdPeopleControlPlaneNotFoundProblem,
          HouseholdPeopleMutationCollisionProblem,
          HouseholdPeopleNotFoundProblem,
          HouseholdPeopleOrganizerRequiredProblem,
          HouseholdPeopleStaleVersionProblem,
          HouseholdPeopleUnavailableProblem,
        ],
        params: { familyId: HouseholdOrganizationId },
        payload: RepairHouseholdAdultLinkPayload,
        success: HouseholdPerson,
      }
    ),
    HttpApiEndpoint.post(
      "departAdult",
      "/v1/families/:familyId/people/departures",
      {
        error: [
          HouseholdPeopleAssociationStaleProblem,
          HouseholdPeopleControlPlaneNotFoundProblem,
          HouseholdPeopleControlPlaneUnavailableProblem,
          HouseholdInvitationRejectedProblem,
          HouseholdPeopleDepartureConflictProblem,
          HouseholdPeopleMutationCollisionProblem,
          HouseholdPeopleNotFoundProblem,
          HouseholdPeopleOrganizerRequiredProblem,
          HouseholdPeopleStaleVersionProblem,
          HouseholdPeopleUnavailableProblem,
        ],
        params: { familyId: HouseholdOrganizationId },
        payload: DepartHouseholdAdultPayload,
        success: HouseholdMemberDepartureOperation.pipe(
          HttpApiSchema.status(202)
        ),
      }
    ),
    HttpApiEndpoint.get(
      "getDepartureByMutation",
      "/v1/families/:familyId/people/departures/by-mutation/:mutationId",
      {
        error: [
          HouseholdPeopleNotFoundProblem,
          HouseholdPeopleUnavailableProblem,
        ],
        params: {
          familyId: HouseholdOrganizationId,
          mutationId: HouseholdPersonMutationId,
        },
        success: HouseholdMemberDepartureOperation,
      }
    ),
    HttpApiEndpoint.get(
      "getDeparture",
      "/v1/families/:familyId/people/departures/:operationId",
      {
        error: [
          HouseholdPeopleNotFoundProblem,
          HouseholdPeopleUnavailableProblem,
        ],
        params: {
          familyId: HouseholdOrganizationId,
          operationId: HouseholdMemberDepartureOperationId,
        },
        success: HouseholdMemberDepartureOperation,
      }
    ),
    HttpApiEndpoint.post(
      "cancelDeparture",
      "/v1/families/:familyId/people/departures/:operationId/cancel",
      {
        error: [
          HouseholdPeopleDepartureConflictProblem,
          HouseholdPeopleMutationCollisionProblem,
          HouseholdPeopleNotFoundProblem,
          HouseholdPeopleUnavailableProblem,
        ],
        params: {
          familyId: HouseholdOrganizationId,
          operationId: HouseholdMemberDepartureOperationId,
        },
        payload: CancelHouseholdAdultDeparturePayload,
        success: HouseholdMemberDepartureOperation,
      }
    ),
    HttpApiEndpoint.post(
      "retryDeparture",
      "/v1/families/:familyId/people/departures/:operationId/retry",
      {
        error: [
          HouseholdPeopleAssociationStaleProblem,
          HouseholdPeopleControlPlaneNotFoundProblem,
          HouseholdPeopleControlPlaneUnavailableProblem,
          HouseholdInvitationRejectedProblem,
          HouseholdPeopleDepartureConflictProblem,
          HouseholdPeopleMutationCollisionProblem,
          HouseholdPeopleNotFoundProblem,
          HouseholdPeopleOrganizerRequiredProblem,
          HouseholdPeopleUnavailableProblem,
        ],
        params: {
          familyId: HouseholdOrganizationId,
          operationId: HouseholdMemberDepartureOperationId,
        },
        payload: RetryHouseholdAdultDeparturePayload,
        success: HouseholdMemberDepartureOperation.pipe(
          HttpApiSchema.status(202)
        ),
      }
    ),
    HttpApiEndpoint.post(
      "returnAdult",
      "/v1/families/:familyId/people/return",
      {
        error: [
          HouseholdPeopleAssociationConflictProblem,
          HouseholdPeopleControlPlaneNotFoundProblem,
          HouseholdPeopleMutationCollisionProblem,
          HouseholdPeopleNotFoundProblem,
          HouseholdPeopleStaleVersionProblem,
          HouseholdPeopleUnavailableProblem,
        ],
        params: { familyId: HouseholdOrganizationId },
        payload: ReturnHouseholdAdultPayload,
        success: HouseholdPerson,
      }
    )
  )
  .middleware(HouseholdSessionAuth);

/** Authenticated public household people API. */
export const HouseholdPeopleApi = HttpApi.make("householdPeopleApi")
  .annotate(HttpApi.PayloadParseOptions, { onExcessProperty: "error" })
  .annotate(HttpApi.QueryParseOptions, { onExcessProperty: "error" })
  .add(PeopleGroup)
  .middleware(HouseholdPeopleSchemaErrors);

export type HouseholdApiClient = HttpApiClient.ForApi<typeof HouseholdApi>;

export const HouseholdApiClient = Context.Service<HouseholdApiClient>(
  "meal-planner/HouseholdApiClient"
);

export const makeHouseholdApiClientLayer = (options: {
  readonly baseUrl: string | URL;
  readonly headers?: Readonly<Record<string, string>> | undefined;
}) =>
  Layer.effect(
    HouseholdApiClient,
    HttpApiClient.make(HouseholdApi, {
      baseUrl: options.baseUrl,
      transformClient: (client) =>
        HttpClient.mapRequest(
          client,
          HttpClientRequest.setHeaders(options.headers ?? {})
        ),
    })
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
  readonly headers?: Readonly<Record<string, string>> | undefined;
}) =>
  Layer.effect(
    HouseholdPeopleApiClient,
    HttpApiClient.make(HouseholdPeopleApi, {
      baseUrl: options.baseUrl,
      transformClient: (client) =>
        HttpClient.mapRequest(
          client,
          HttpClientRequest.setHeaders(options.headers ?? {})
        ),
    })
  );

export { InvitationView } from "./invitation-view.js";

export {
  HouseholdPlanningContentApi,
  HouseholdPlanningContentApiClient,
  HouseholdPlanningContentGroup,
  HouseholdPlanningContentInvalidProblem,
  HouseholdPlanningContentConflictProblem,
  HouseholdPlanningContentUnavailableProblem,
  makeHouseholdPlanningContentApiClientLayer,
} from "./meal-content-http.js";

export type HouseholdMealPlanApiClient = HttpApiClient.ForApi<
  typeof HouseholdMealPlanApi
>;
export const HouseholdMealPlanApiClient =
  Context.Service<HouseholdMealPlanApiClient>(
    "meal-planner/HouseholdMealPlanApiClient"
  );
export const makeHouseholdMealPlanApiClientLayer = (options: {
  readonly baseUrl: string | URL;
  readonly headers?: Readonly<Record<string, string>> | undefined;
}) =>
  Layer.effect(
    HouseholdMealPlanApiClient,
    HttpApiClient.make(HouseholdMealPlanApi, {
      baseUrl: options.baseUrl,
      transformClient: (client) =>
        HttpClient.mapRequest(
          client,
          HttpClientRequest.setHeaders(options.headers ?? {})
        ),
    })
  );

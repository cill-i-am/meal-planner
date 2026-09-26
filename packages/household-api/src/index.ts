import { Context, Layer, Schema } from "effect";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";
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
import {
  CreatedSetupFamily,
  CreateSetupFamilyRequest,
  SetupFamilyUnauthorized,
  SetupFamilyForbidden,
  SetupFamilyInvalidRequest,
  SetupFamilyConflict,
  SetupFamilyRateLimited,
  SetupFamilyUnavailable,
} from "./onboarding.js";
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
import { SetupFamilySchemaErrors } from "./setup-family-schema-errors.js";

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
  MealPlanDraft,
  MealPlanDraftId,
  MealPlanGap,
  MealPlanInstant,
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
    HttpApiEndpoint.get(
      "getProfileVersion",
      "/v1/household/people/:personId/profile/versions/:version",
      {
        error: HouseholdProfileErrors,
        params: {
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
      "/v1/household/people/:personId/profile/audit",
      {
        error: HouseholdProfileErrors,
        params: { personId: HouseholdPersonId },
        query: ListProfileVersionsQuery,
        success: ProfileAuditPage,
      }
    ),
    HttpApiEndpoint.get(
      "getProfile",
      "/v1/household/people/:personId/profile",
      {
        error: HouseholdProfileErrors,
        params: { personId: HouseholdPersonId },
        success: PersonProfile,
      }
    ),
    HttpApiEndpoint.get(
      "listProfileVersions",
      "/v1/household/people/:personId/profile/versions",
      {
        error: HouseholdProfileErrors,
        params: { personId: HouseholdPersonId },
        query: ListProfileVersionsQuery,
        success: ProfileVersionPage,
      }
    ),
    HttpApiEndpoint.post(
      "mutateProfile",
      "/v1/household/people/:personId/profile",
      {
        error: HouseholdProfileErrors,
        params: { personId: HouseholdPersonId },
        payload: MutatePersonProfilePayload,
        success: PersonProfile,
      }
    ),
    HttpApiEndpoint.post(
      "bootstrapCreator",
      "/v1/household/people/bootstrap-creator",
      {
        error: [
          HouseholdPeopleBootstrapConflictProblem,
          HouseholdPeopleCreatorRequiredProblem,
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
    HttpApiEndpoint.post("rename", "/v1/household/people/:personId/rename", {
      error: [
        HouseholdPeopleNotFoundProblem,
        HouseholdPeopleLifecycleConflictProblem,
        HouseholdPeopleMutationCollisionProblem,
        HouseholdPeopleStaleVersionProblem,
        HouseholdPeopleUnavailableProblem,
      ],
      params: { personId: HouseholdPersonId },
      payload: RenameHouseholdPersonPayload,
      success: HouseholdPerson,
    }),
    HttpApiEndpoint.post("remove", "/v1/household/people/:personId/remove", {
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
      params: { personId: HouseholdPersonId },
      payload: TransitionHouseholdPersonPayload,
      success: HouseholdPerson,
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
    }),
    HttpApiEndpoint.post("inviteAdult", "/v1/household/people/invitations", {
      error: [
        HouseholdPeopleAssociationConflictProblem,
        HouseholdPeopleControlPlaneUnavailableProblem,
        HouseholdInvitationRejectedProblem,
        HouseholdPeopleMutationCollisionProblem,
        HouseholdPeopleNotFoundProblem,
        HouseholdPeopleOrganizerRequiredProblem,
        HouseholdPeopleUnavailableProblem,
      ],
      payload: InviteHouseholdAdultPayload,
      success: HouseholdAdultInvitationResult.pipe(HttpApiSchema.status(201)),
    }),
    HttpApiEndpoint.post(
      "associateInvitation",
      "/v1/household/people/invitations/associate",
      {
        error: [
          HouseholdPeopleAssociationConflictProblem,
          HouseholdPeopleControlPlaneNotFoundProblem,
          HouseholdPeopleMutationCollisionProblem,
          HouseholdPeopleNotFoundProblem,
          HouseholdPeopleOrganizerRequiredProblem,
          HouseholdPeopleUnavailableProblem,
        ],
        payload: AssociateHouseholdAdultInvitationPayload,
        success: HouseholdPerson,
      }
    ),
    HttpApiEndpoint.post(
      "completeAdultLink",
      "/v1/household/people/links/complete",
      {
        error: [
          HouseholdPeopleAssociationConflictProblem,
          HouseholdPeopleControlPlaneNotFoundProblem,
          HouseholdPeopleMutationCollisionProblem,
          HouseholdPeopleUnavailableProblem,
        ],
        payload: CompleteHouseholdAdultLinkPayload,
        success: HouseholdPerson,
      }
    ),
    HttpApiEndpoint.post(
      "repairAdultLink",
      "/v1/household/people/links/repair",
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
        payload: RepairHouseholdAdultLinkPayload,
        success: HouseholdPerson,
      }
    ),
    HttpApiEndpoint.post("departAdult", "/v1/household/people/departures", {
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
      payload: DepartHouseholdAdultPayload,
      success: HouseholdMemberDepartureOperation.pipe(
        HttpApiSchema.status(202)
      ),
    }),
    HttpApiEndpoint.get(
      "getDepartureByMutation",
      "/v1/household/people/departures/by-mutation/:mutationId",
      {
        error: [
          HouseholdPeopleNotFoundProblem,
          HouseholdPeopleUnavailableProblem,
        ],
        params: { mutationId: HouseholdPersonMutationId },
        success: HouseholdMemberDepartureOperation,
      }
    ),
    HttpApiEndpoint.get(
      "getDeparture",
      "/v1/household/people/departures/:operationId",
      {
        error: [
          HouseholdPeopleNotFoundProblem,
          HouseholdPeopleUnavailableProblem,
        ],
        params: { operationId: HouseholdMemberDepartureOperationId },
        success: HouseholdMemberDepartureOperation,
      }
    ),
    HttpApiEndpoint.post(
      "cancelDeparture",
      "/v1/household/people/departures/:operationId/cancel",
      {
        error: [
          HouseholdPeopleDepartureConflictProblem,
          HouseholdPeopleMutationCollisionProblem,
          HouseholdPeopleNotFoundProblem,
          HouseholdPeopleUnavailableProblem,
        ],
        params: { operationId: HouseholdMemberDepartureOperationId },
        payload: CancelHouseholdAdultDeparturePayload,
        success: HouseholdMemberDepartureOperation,
      }
    ),
    HttpApiEndpoint.post(
      "retryDeparture",
      "/v1/household/people/departures/:operationId/retry",
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
        params: { operationId: HouseholdMemberDepartureOperationId },
        payload: RetryHouseholdAdultDeparturePayload,
        success: HouseholdMemberDepartureOperation.pipe(
          HttpApiSchema.status(202)
        ),
      }
    ),
    HttpApiEndpoint.post("returnAdult", "/v1/household/people/return", {
      error: [
        HouseholdPeopleAssociationConflictProblem,
        HouseholdPeopleControlPlaneNotFoundProblem,
        HouseholdPeopleMutationCollisionProblem,
        HouseholdPeopleNotFoundProblem,
        HouseholdPeopleStaleVersionProblem,
        HouseholdPeopleUnavailableProblem,
      ],
      payload: ReturnHouseholdAdultPayload,
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
export {
  CreatedSetupFamily,
  SetupFamilyUnauthorized,
  SetupFamilyForbidden,
  SetupFamilyInvalidRequest,
  SetupFamilyConflict,
  SetupFamilyRateLimited,
  SetupFamilyUnavailable,
  CreateSetupFamilyRequest,
  FamilyName,
  initialSetupProgress,
  PersonCreation,
  PersonDraft,
  SetupCheckpoint,
  SetupProgress,
  canReplaceSetupProgress,
  sameSetupProgress,
  SetupProgressVersion,
  SetupRosterCommand,
  SetupRosterReturn,
  setupProgressField,
  setupPendingCommandId,
  setupProgressVersionField,
} from "./onboarding.js";

const SetupFamilyGroup = HttpApiGroup.make("setupFamily").add(
  HttpApiEndpoint.post("create", "/v1/setup/family", {
    error: [
      SetupFamilyUnauthorized,
      SetupFamilyForbidden,
      SetupFamilyInvalidRequest,
      SetupFamilyConflict,
      SetupFamilyRateLimited,
      SetupFamilyUnavailable,
    ],
    payload: CreateSetupFamilyRequest,
    success: CreatedSetupFamily.pipe(HttpApiSchema.status(201)),
  })
);
export const SetupFamilyApi = HttpApi.make("setupFamilyApi")
  .add(SetupFamilyGroup)
  .middleware(SetupFamilySchemaErrors);
export { SetupFamilySchemaErrors } from "./setup-family-schema-errors.js";
export type SetupFamilyApiClient = HttpApiClient.ForApi<typeof SetupFamilyApi>;
export const SetupFamilyApiClient = Context.Service<SetupFamilyApiClient>(
  "meal-planner/SetupFamilyApiClient"
);
export const makeSetupFamilyApiClientLayer = (options: {
  readonly baseUrl: string | URL;
  readonly headers: Readonly<Record<string, string>>;
}) =>
  Layer.effect(
    SetupFamilyApiClient,
    HttpApiClient.make(SetupFamilyApi, {
      baseUrl: options.baseUrl,
      transformClient: (client) =>
        HttpClient.mapRequest(
          client,
          HttpClientRequest.setHeaders(options.headers)
        ),
    })
  );

export { InvitationView } from "./invitation-view.js";

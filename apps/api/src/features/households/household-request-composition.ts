import {
  HouseholdProfileRejected,
  PersonProfile,
  ProfileVersion,
  ProfileVersionPage,
  HouseholdAdultInvitationResult,
  HouseholdMemberDepartureOperation,
  HouseholdMemberDepartureStart,
  HouseholdPeopleUnavailable,
  HouseholdPeopleOperationReason,
  HouseholdPerson,
  HouseholdPersonAssociationConflict,
  HouseholdPersonMutationCollision,
  MealPlan,
  MealPlanSummary,
  MealPlanNotFound,
  MealPlanPersistenceFailure,
  MealPlanRequest,
  PlanningContentSnapshot,
  SavedRecipePage,
  PlanningContentRejected,
  ChangeMealPlanPayload,
  DecideMealPlanPayload,
  MutatePlanningContentPayload,
  SavedRecipePageQuery,
} from "@meal-planner/household-api";
import type {
  AssociateAdultInvitationPayload,
  EmailAddress,
  InvitationId,
  MemberId,
  UserId,
  HouseholdPeopleFailure,
  HouseholdPeoplePrincipal,
  InviteHouseholdAdultPayload,
  MealPlanId,
  HouseholdOrganizationId,
} from "@meal-planner/household-api";
import { Clock, Effect, Layer, Schema } from "effect";
import * as HttpRouter from "effect/unstable/http/HttpRouter";

import { JsonHttpPlatformServices } from "../../infrastructure/json-http-platform.js";
import type { AuthenticatedOrganizationResolver } from "../auth/auth.principal.js";
import { AuthenticatedOrganizationResolver as AuthenticatedOrganizationResolverService } from "../auth/auth.principal.js";
import type { HouseholdDomainWorkerMethods } from "./household-domain-worker.js";
import type {
  HouseholdChangeMealPlanInput,
  HouseholdCreateMealPlanInput,
  HouseholdDecideMealPlanInput,
  HouseholdListSavedRecipesInput,
  HouseholdMealPlanWire,
  HouseholdMealPlanSummaryListWire,
  HouseholdMutatePlanningContentInput,
  HouseholdPlanningContentWire,
  HouseholdReadPlanningContentInput,
  HouseholdReadMealPlanInput,
  HouseholdSavedRecipePageWire,
} from "./household-meal-plan.contract.js";
import type {
  HouseholdDomainFailure,
  HouseholdEnsureInput,
  HouseholdMetadata,
} from "./household.contract.js";
import { HouseholdInvalidInput } from "./household.contract.js";
import type {
  HouseholdDomainGateway,
  HouseholdMealPlanGateway,
  HouseholdPlanningContentGateway,
  HouseholdPeopleGateway,
  HouseholdMealPlanFailure,
} from "./household.gateway.js";
import {
  HouseholdDomainGateway as HouseholdDomainGatewayService,
  HouseholdMealPlanGateway as HouseholdMealPlanGatewayService,
  HouseholdPlanningContentGateway as HouseholdPlanningContentGatewayService,
  HouseholdPeopleGateway as HouseholdPeopleGatewayService,
  HouseholdPeopleOrganizerRequired,
} from "./household.gateway.js";
import {
  HouseholdHttpApiLayer,
  HouseholdMealPlanHttpApiLayer,
  HouseholdPlanningContentHttpApiLayer,
  HouseholdPeopleHttpApiLayer,
} from "./household.http.js";
import {
  HouseholdPersonRemovalPlan,
  HouseholdPeoplePrivateRoster,
} from "./people/household-people.contract.js";
import type {
  HouseholdAssociateAdultInvitationInput,
  HouseholdBootstrapCreatorPersonInput,
  HouseholdCancelMemberDepartureInput,
  HouseholdCompleteAcceptedAdultLinkInput,
  HouseholdCreatePersonInput,
  HouseholdPreparePersonRemovalInput,
  HouseholdRenamePersonInput,
  HouseholdGetMemberDepartureByMutationInput,
  HouseholdGetMemberDepartureInput,
  HouseholdGetPersonInput,
  HouseholdListPeopleInput,
  HouseholdPrepareMemberDepartureInput,
  HouseholdRepairAdultAccountLinkInput,
  HouseholdRestoreReturningAdultLinkInput,
  HouseholdRetryMemberDepartureInput,
  HouseholdStartMemberDepartureInput,
  HouseholdTransitionPersonInput,
} from "./people/household-people.contract.js";
import type {
  HouseholdPeopleControlPlane,
  HouseholdControlPlaneInvitation,
} from "./people/household-people.control-plane.js";
import {
  deriveHouseholdRemovalMutationId,
  deriveHouseholdInvitationDigest,
  deriveHouseholdInvitationId,
  deriveHouseholdPeopleAuditActorId,
  deriveHouseholdInvitationRequestDigest,
  deriveHouseholdPersonLinkageSubject,
} from "./people/household-people.identity.js";
import type { MemberDepartureWorkflowStarter } from "./people/member-departure.js";
import {
  makeHouseholdMemberAdmission,
  makeHouseholdPeopleAdmission,
  makeHouseholdPeopleCreatorAdmission,
} from "./rpc/command-envelope.js";

interface HouseholdDomainPort {
  readonly ensureHousehold: (
    input: HouseholdEnsureInput
  ) => Effect.Effect<HouseholdMetadata, HouseholdDomainFailure>;
}

type MealPlanDomainFailure =
  | HouseholdDomainFailure
  | HouseholdMealPlanFailure
  | PlanningContentRejected;

interface HouseholdMealPlanDomainPort {
  readonly createMealPlan: (
    input: HouseholdCreateMealPlanInput
  ) => Effect.Effect<HouseholdMealPlanWire, MealPlanDomainFailure>;
  readonly readMealPlan: (
    input: HouseholdReadMealPlanInput
  ) => Effect.Effect<HouseholdMealPlanWire | null, MealPlanDomainFailure>;
  readonly listMealPlans: (
    input: HouseholdReadPlanningContentInput
  ) => Effect.Effect<HouseholdMealPlanSummaryListWire, MealPlanDomainFailure>;
  readonly changeMealPlan: (
    input: HouseholdChangeMealPlanInput
  ) => Effect.Effect<HouseholdMealPlanWire, MealPlanDomainFailure>;
  readonly approveMealPlan: (
    input: HouseholdDecideMealPlanInput
  ) => Effect.Effect<HouseholdMealPlanWire, MealPlanDomainFailure>;
  readonly proposeMealPlanRevision: (
    input: HouseholdDecideMealPlanInput
  ) => Effect.Effect<HouseholdMealPlanWire, MealPlanDomainFailure>;
  readonly acceptMealPlanRevision: (
    input: HouseholdDecideMealPlanInput
  ) => Effect.Effect<HouseholdMealPlanWire, MealPlanDomainFailure>;
  readonly rejectMealPlanRevision: (
    input: HouseholdDecideMealPlanInput
  ) => Effect.Effect<HouseholdMealPlanWire, MealPlanDomainFailure>;
  readonly readPlanningContent: (
    input: HouseholdReadPlanningContentInput
  ) => Effect.Effect<HouseholdPlanningContentWire, MealPlanDomainFailure>;
  readonly mutatePlanningContent: (
    input: HouseholdMutatePlanningContentInput
  ) => Effect.Effect<HouseholdPlanningContentWire, MealPlanDomainFailure>;
  readonly listSavedRecipes: (
    input: HouseholdListSavedRecipesInput
  ) => Effect.Effect<HouseholdSavedRecipePageWire, MealPlanDomainFailure>;
}

interface HouseholdPeopleDomainPort {
  readonly readPersonProfile: HouseholdDomainWorkerMethods["readPersonProfile"];
  readonly listProfileVersions: HouseholdDomainWorkerMethods["listProfileVersions"];
  readonly mutatePersonProfile: HouseholdDomainWorkerMethods["mutatePersonProfile"];
  readonly associateAdultInvitation: (
    input: HouseholdAssociateAdultInvitationInput
  ) => Effect.Effect<object, HouseholdDomainFailure | HouseholdPeopleFailure>;
  readonly archiveHouseholdPerson: (
    input: HouseholdTransitionPersonInput
  ) => Effect.Effect<object, HouseholdDomainFailure | HouseholdPeopleFailure>;
  readonly bootstrapCreatorPerson: (
    input: HouseholdBootstrapCreatorPersonInput
  ) => Effect.Effect<object, HouseholdDomainFailure | HouseholdPeopleFailure>;
  readonly cancelMemberDeparture: (
    input: HouseholdCancelMemberDepartureInput
  ) => Effect.Effect<object, HouseholdDomainFailure | HouseholdPeopleFailure>;
  readonly completeAcceptedAdultLink: (
    input: HouseholdCompleteAcceptedAdultLinkInput
  ) => Effect.Effect<object, HouseholdDomainFailure | HouseholdPeopleFailure>;
  readonly preparePersonRemoval: (
    input: HouseholdPreparePersonRemovalInput
  ) => Effect.Effect<object, HouseholdDomainFailure | HouseholdPeopleFailure>;
  readonly renameHouseholdPerson: (
    input: HouseholdRenamePersonInput
  ) => Effect.Effect<object, HouseholdDomainFailure | HouseholdPeopleFailure>;
  readonly createHouseholdPerson: (
    input: HouseholdCreatePersonInput
  ) => Effect.Effect<object, HouseholdDomainFailure | HouseholdPeopleFailure>;
  readonly getHouseholdPerson: (
    input: HouseholdGetPersonInput
  ) => Effect.Effect<object, HouseholdDomainFailure | HouseholdPeopleFailure>;
  readonly getMemberDeparture: (
    input: HouseholdGetMemberDepartureInput
  ) => Effect.Effect<object, HouseholdDomainFailure | HouseholdPeopleFailure>;
  readonly getMemberDepartureByMutation: (
    input: HouseholdGetMemberDepartureByMutationInput
  ) => Effect.Effect<object, HouseholdDomainFailure | HouseholdPeopleFailure>;
  readonly listHouseholdPeople: (
    input: HouseholdListPeopleInput
  ) => Effect.Effect<object, HouseholdDomainFailure | HouseholdPeopleFailure>;
  readonly restoreHouseholdPerson: (
    input: HouseholdTransitionPersonInput
  ) => Effect.Effect<object, HouseholdDomainFailure | HouseholdPeopleFailure>;
  readonly prepareMemberDeparture: (
    input: HouseholdPrepareMemberDepartureInput
  ) => Effect.Effect<object, HouseholdDomainFailure | HouseholdPeopleFailure>;
  readonly repairAdultAccountLink: (
    input: HouseholdRepairAdultAccountLinkInput
  ) => Effect.Effect<object, HouseholdDomainFailure | HouseholdPeopleFailure>;
  readonly restoreReturningAdultLink: (
    input: HouseholdRestoreReturningAdultLinkInput
  ) => Effect.Effect<object, HouseholdDomainFailure | HouseholdPeopleFailure>;
  readonly retryMemberDeparture: (
    input: HouseholdRetryMemberDepartureInput
  ) => Effect.Effect<object, HouseholdDomainFailure | HouseholdPeopleFailure>;
  readonly startMemberDeparture: (
    input: HouseholdStartMemberDepartureInput
  ) => Effect.Effect<object, HouseholdDomainFailure | HouseholdPeopleFailure>;
}

type PeoplePrincipal = Parameters<
  HouseholdPeopleGateway["list"]
>[0]["principal"];

const memberAdmission = (principal: PeoplePrincipal) =>
  makeHouseholdPeopleAdmission(principal).pipe(
    Effect.mapError(() => HouseholdPeopleUnavailable.make({}))
  );

const creatorAdmission = (principal: PeoplePrincipal) =>
  principal.creatorAuthority === null
    ? Effect.fail(new HouseholdPeopleOrganizerRequired())
    : makeHouseholdPeopleCreatorAdmission({
        ...principal,
        creatorAuthority: principal.creatorAuthority,
      }).pipe(Effect.mapError(() => HouseholdPeopleUnavailable.make({})));

const decodePerson = (wire: object) =>
  Schema.decodeUnknownEffect(HouseholdPerson)(wire).pipe(
    Effect.mapError(() => HouseholdPeopleUnavailable.make({}))
  );

const decodeDeparture = (wire: object) =>
  Schema.decodeUnknownEffect(HouseholdMemberDepartureOperation)(wire).pipe(
    Effect.mapError(() => HouseholdPeopleUnavailable.make({}))
  );

const decodeDepartureStart = (wire: object) =>
  Schema.decodeUnknownEffect(HouseholdMemberDepartureStart)(wire).pipe(
    Effect.mapError(() => HouseholdPeopleUnavailable.make({}))
  );

const invitationDigest = (
  organizationId: Parameters<
    HouseholdPeopleControlPlane["listMemberUserIds"]
  >[0],
  invitationId: InvitationId
) =>
  deriveHouseholdInvitationDigest(organizationId, invitationId).pipe(
    Effect.mapError(() => HouseholdPeopleUnavailable.make({}))
  );

const invitationIntent = (
  organizationId: HouseholdOrganizationId,
  input: {
    readonly email: EmailAddress;
    readonly mutationId: Parameters<typeof deriveHouseholdInvitationId>[1];
  }
) =>
  Effect.gen(function* deriveInvitationIntent() {
    const invitationId = yield* deriveHouseholdInvitationId(
      organizationId,
      input.mutationId
    );
    const [digest, requestDigest] = yield* Effect.all([
      deriveHouseholdInvitationDigest(organizationId, invitationId),
      deriveHouseholdInvitationRequestDigest(organizationId, {
        email: input.email,
        invitationId,
      }),
    ]);
    return { digest, invitationId, requestDigest } as const;
  }).pipe(Effect.mapError(() => HouseholdPeopleUnavailable.make({})));

const verifyInvitationBinding = (
  principal: HouseholdPeoplePrincipal,
  payload: Pick<InviteHouseholdAdultPayload, "email" | "personId">,
  invitation: HouseholdControlPlaneInvitation
) =>
  Effect.gen(function* validateInvitationIdentity() {
    const invitationActor = yield* deriveHouseholdPeopleAuditActorId(
      principal.organizationId,
      invitation.inviterId
    ).pipe(Effect.mapError(() => HouseholdPeopleUnavailable.make({})));
    if (
      invitation.email.toLowerCase() !== payload.email.toLowerCase() ||
      invitation.householdPersonId !== payload.personId ||
      invitationActor !== principal.actorId
    ) {
      return yield* Effect.fail(HouseholdPersonMutationCollision.make({}));
    }
  });

const linkageSubject = (
  organizationId: Parameters<
    HouseholdPeopleControlPlane["listMemberUserIds"]
  >[0],
  userId: UserId
) =>
  deriveHouseholdPersonLinkageSubject(organizationId, userId).pipe(
    Effect.mapError(() => HouseholdPeopleUnavailable.make({}))
  );

/** Capture the authenticated Better Auth invitation recipient at acceptance time. */
export const makeHouseholdInvitationRecipientVerifier =
  (
    domain: Pick<
      HouseholdDomainWorkerMethods,
      "confirmAdultInvitationRecipient"
    >
  ) =>
  (input: {
    readonly invitationId: InvitationId;
    readonly organizationId: HouseholdOrganizationId;
    readonly userId: UserId;
  }): Promise<void> =>
    Effect.runPromise(
      Effect.gen(function* verifyInvitationRecipient() {
        const { organizationId } = input;
        const acceptedInvitationDigest = yield* deriveHouseholdInvitationDigest(
          organizationId,
          input.invitationId
        );
        const recipientLinkageSubject =
          yield* deriveHouseholdPersonLinkageSubject(
            organizationId,
            input.userId
          );
        yield* domain.confirmAdultInvitationRecipient({
          admission: {
            actor: {
              _tag: "System",
              purpose: "person_invitation_acceptance",
            },
            organizationId,
          },
          invitationDigest: acceptedInvitationDigest,
          linkageSubject: recipientLinkageSubject,
        });
      })
    );

const persistenceFailure = (operation: "create" | "read" | "save") =>
  MealPlanPersistenceFailure.make({ operation });

const mapPlanFailure = (
  error: MealPlanDomainFailure,
  operation: "create" | "read" | "save"
): HouseholdMealPlanFailure => {
  switch (error._tag) {
    case "MealPlanMutationConflict":
    case "MealPlanNotFound":
    case "MealPlanPersistenceFailure":
    case "MealPlanRequestConflict":
    case "MealPlanRuleViolation":
    case "MealPlanTransitionRejected":
    case "MealPlanVersionConflict": {
      return error;
    }
    default: {
      return persistenceFailure(operation);
    }
  }
};

const decodeMealPlan = (wire: HouseholdMealPlanWire) =>
  Schema.decodeUnknownEffect(MealPlan)(wire).pipe(
    Effect.mapError(() => persistenceFailure("read"))
  );

const mapPeopleFailure = (
  error: HouseholdDomainFailure | HouseholdPeopleFailure
): HouseholdPeopleFailure => {
  if (Schema.is(HouseholdPeopleUnavailable)(error)) {
    return error;
  }
  switch (error._tag) {
    case "HouseholdCreatorBootstrapConflict":
    case "HouseholdAssociationStaleVersion":
    case "HouseholdMemberDepartureConflict":
    case "HouseholdMemberDepartureInProgress":
    case "HouseholdPersonLifecycleConflict":
    case "HouseholdPersonMutationCollision":
    case "HouseholdPersonNotFound":
    case "HouseholdPersonAssociationConflict":
    case "HouseholdPersonStaleVersion": {
      return error;
    }
    default: {
      return HouseholdPeopleUnavailable.make({});
    }
  }
};

/** Adapt admitted people operations to the private household Worker. */
const profileFailure = () =>
  new HouseholdProfileRejected({ reason: "profile_unavailable" });

export const makeHouseholdPeopleGateway = (options: {
  readonly controlPlane: HouseholdPeopleControlPlane;
  readonly departureWorkflow: MemberDepartureWorkflowStarter;
  readonly domain: HouseholdPeopleDomainPort;
  readonly sendInvitationEmail: (input: {
    readonly email: EmailAddress;
    readonly invitationId: InvitationId;
    readonly inviterId: UserId;
    readonly organizationId: HouseholdOrganizationId;
  }) => Effect.Effect<void, HouseholdPeopleUnavailable>;
}): HouseholdPeopleGateway => {
  const call = <A, R>(
    admission: Effect.Effect<R, unknown>,
    invoke: (
      admission: R
    ) => Effect.Effect<object, HouseholdDomainFailure | HouseholdPeopleFailure>,
    schema: Schema.Codec<A, unknown, never>
  ) =>
    admission.pipe(
      Effect.mapError(() => HouseholdPeopleUnavailable.make({})),
      Effect.flatMap(invoke),
      Effect.mapError(mapPeopleFailure),
      Effect.flatMap((wire) =>
        Schema.decodeUnknownEffect(schema)(wire).pipe(
          Effect.mapError(() => HouseholdPeopleUnavailable.make({}))
        )
      )
    );

  const callerAdmission = (
    principal: Parameters<HouseholdPeopleGateway["list"]>[0]["principal"]
  ) =>
    principal.creatorAuthority === null
      ? memberAdmission(principal)
      : makeHouseholdPeopleCreatorAdmission({
          ...principal,
          creatorAuthority: principal.creatorAuthority,
        }).pipe(Effect.mapError(() => HouseholdPeopleUnavailable.make({})));

  const runDepartureAttempt = (input: {
    readonly headers: Headers;
    readonly memberId: MemberId | null;
    readonly memberIsPresent: boolean;
    readonly operation: typeof HouseholdMemberDepartureOperation.Type;
    readonly self: boolean;
    readonly attemptClaimed: boolean;
    readonly organizationId: Parameters<
      HouseholdPeopleControlPlane["listMemberUserIds"]
    >[0];
  }) =>
    Effect.gen(function* coordinateDepartureAttempt() {
      const workflowInput = {
        claimedOperationVersion: input.operation.version,
        executionGeneration: input.operation.executionGeneration,
        operationId: input.operation.operationId,
        organizationId: input.organizationId,
      };
      yield* options.departureWorkflow.ensureStarted(workflowInput);
      if (!input.attemptClaimed) {
        return input.operation;
      }
      if (input.memberIsPresent && input.memberId !== null) {
        const removal = options.controlPlane
          .removeMember({
            headers: input.headers,
            memberId: input.memberId,
            organizationId: input.organizationId,
            self: input.self,
          })
          .pipe(
            Effect.timeoutOrElse({
              duration: "30 seconds",
              orElse: () => Effect.fail(HouseholdPeopleUnavailable.make({})),
            })
          );
        yield* removal.pipe(
          Effect.tapError(() =>
            options.departureWorkflow
              .signalRemovalOutcome(workflowInput, "unknown")
              .pipe(Effect.ignore)
          )
        );
      }
      yield* options.departureWorkflow.signalRemovalOutcome(
        workflowInput,
        "returned_success"
      );
      return input.operation;
    });

  const mapProfileFailure = (
    error: HouseholdDomainFailure | HouseholdProfileRejected
  ) => (error._tag === "HouseholdProfileRejected" ? error : profileFailure());
  return {
    archive: ({ payload, personId, principal }) =>
      call(
        makeHouseholdPeopleAdmission(principal),
        (admission) =>
          options.domain.archiveHouseholdPerson({
            admission,
            payload,
            personId,
          }),
        HouseholdPerson
      ),
    associateInvitation: ({ payload, principal }) =>
      Effect.gen(function* associateAdultInvitation() {
        const admission = yield* creatorAdmission(principal);
        const intent = yield* invitationIntent(
          principal.organizationId,
          payload
        );
        const invitation = yield* options.controlPlane.getInvitation({
          invitationId: intent.invitationId,
          organizationId: principal.organizationId,
        });
        yield* verifyInvitationBinding(principal, payload, invitation);
        if (
          invitation.status !== "pending" &&
          invitation.status !== "accepted"
        ) {
          return yield* Effect.fail(
            HouseholdPersonAssociationConflict.make({})
          );
        }
        const wire = yield* options.domain
          .associateAdultInvitation({
            admission,
            payload: {
              invitationDigest: intent.digest,
              invitationRequestDigest: intent.requestDigest,
              mutationId: payload.mutationId,
              personId: payload.personId,
            },
          })
          .pipe(Effect.mapError(mapPeopleFailure));
        return yield* decodePerson(wire);
      }),
    bootstrapCreator: ({ payload, principal }) =>
      principal.creatorAuthority === null
        ? Effect.fail(HouseholdPeopleUnavailable.make({}))
        : call(
            makeHouseholdPeopleCreatorAdmission({
              ...principal,
              creatorAuthority: principal.creatorAuthority,
            }),
            (admission) =>
              options.domain.bootstrapCreatorPerson({ admission, payload }),
            HouseholdPerson
          ),
    cancelDeparture: ({ operationId, payload, principal }) =>
      Effect.gen(function* cancelMemberDeparture() {
        const admission = yield* callerAdmission(principal);
        const wire = yield* options.domain
          .cancelMemberDeparture({ admission, operationId, payload })
          .pipe(Effect.mapError(mapPeopleFailure));
        return yield* decodeDeparture(wire);
      }),
    completeAdultLink: ({ payload, principal }) =>
      Effect.gen(function* completeAcceptedAdultLink() {
        const invitation = yield* options.controlPlane.getInvitation({
          invitationId: payload.invitationId,
          organizationId: principal.organizationId,
        });
        if (invitation.status !== "accepted") {
          return yield* Effect.fail(
            HouseholdPersonAssociationConflict.make({})
          );
        }
        const digest = yield* invitationDigest(
          principal.organizationId,
          invitation.id
        );
        const admission = yield* memberAdmission(principal);
        const wire = yield* options.domain
          .completeAcceptedAdultLink({
            admission,
            payload: {
              invitationDigest: digest,
              mutationId: payload.mutationId,
            },
          })
          .pipe(Effect.mapError(mapPeopleFailure));
        return yield* decodePerson(wire);
      }),
    create: ({ payload, principal }) =>
      call(
        makeHouseholdPeopleAdmission(principal),
        (admission) =>
          options.domain.createHouseholdPerson({ admission, payload }),
        HouseholdPerson
      ),
    departAdult: ({ headers, payload, principal }) =>
      Effect.gen(function* departAdult() {
        const member = yield* options.controlPlane.getMember({
          memberId: payload.memberId,
          organizationId: principal.organizationId,
        });
        const targetLinkageSubject = yield* linkageSubject(
          principal.organizationId,
          member.userId
        );
        if (
          principal.creatorAuthority === null &&
          targetLinkageSubject !== principal.linkageSubject
        ) {
          return yield* Effect.fail(new HouseholdPeopleOrganizerRequired());
        }
        const admission =
          principal.creatorAuthority === null
            ? yield* memberAdmission(principal)
            : yield* creatorAdmission(principal);
        const preparedWire = yield* options.domain
          .prepareMemberDeparture({
            admission,
            payload: {
              expectedLinkVersion: payload.expectedLinkVersion,
              expectedPersonVersion: payload.expectedPersonVersion,
              mutationId: payload.mutationId,
              personId: payload.personId,
              reason: payload.reason,
            },
            targetLinkageSubject,
          })
          .pipe(Effect.mapError(mapPeopleFailure));
        const prepared = yield* decodeDeparture(preparedWire);
        const startedWire = yield* options.domain
          .startMemberDeparture({
            admission,
            expectedOperationVersion: prepared.version,
            operationId: prepared.operationId,
          })
          .pipe(Effect.mapError(mapPeopleFailure));
        const started = yield* decodeDepartureStart(startedWire);
        return yield* runDepartureAttempt({
          attemptClaimed: started.attemptClaimed,
          headers,
          memberId: member.id,
          memberIsPresent: true,
          operation: started.operation,
          organizationId: principal.organizationId,
          self: targetLinkageSubject === principal.linkageSubject,
        });
      }),
    get: ({ personId, principal }) =>
      call(
        makeHouseholdPeopleAdmission(principal),
        (admission) =>
          options.domain.getHouseholdPerson({ admission, personId }),
        HouseholdPerson
      ),
    getDeparture: ({ operationId, principal }) =>
      Effect.gen(function* getMemberDeparture() {
        const admission = yield* callerAdmission(principal);
        const wire = yield* options.domain
          .getMemberDeparture({ admission, operationId })
          .pipe(Effect.mapError(mapPeopleFailure));
        return yield* decodeDeparture(wire);
      }),
    getDepartureByMutation: ({ mutationId, principal }) =>
      Effect.gen(function* getMemberDepartureByMutation() {
        const admission = yield* callerAdmission(principal);
        const wire = yield* options.domain
          .getMemberDepartureByMutation({ admission, mutationId })
          .pipe(Effect.mapError(mapPeopleFailure));
        return yield* decodeDeparture(wire);
      }),
    getProfile: ({ personId, principal, version }) =>
      makeHouseholdPeopleAdmission(principal).pipe(
        Effect.mapError(profileFailure),
        Effect.flatMap((admission) =>
          options.domain
            .readPersonProfile({
              admission,
              personId,
              version:
                version === undefined ? null : ProfileVersion.make(version),
            })
            .pipe(Effect.mapError(mapProfileFailure))
        ),
        Effect.flatMap((wire) =>
          Schema.decodeUnknownEffect(PersonProfile)(wire).pipe(
            Effect.mapError(profileFailure)
          )
        )
      ),
    inviteAdult: ({ headers, payload, principal }) =>
      Effect.gen(function* inviteAdult() {
        const admission = yield* creatorAdmission(principal);
        const intent = yield* invitationIntent(
          principal.organizationId,
          payload
        );
        const target = yield* call(
          makeHouseholdPeopleAdmission(principal),
          (personAdmission) =>
            options.domain.getHouseholdPerson({
              admission: personAdmission,
              personId: payload.personId,
            }),
          HouseholdPerson
        );
        if (
          target.kind !== "adult" ||
          (target.lifecycle !== "active" &&
            target.associationState !== "detached") ||
          target.associationState === "departure_pending"
        ) {
          return yield* Effect.fail(
            HouseholdPersonAssociationConflict.make({})
          );
        }
        let replacedInvitationDigest: (typeof intent)["digest"] | undefined;
        let replayingAssociation = false;
        if (target.associationState === "invitation_pending") {
          const { pendingInvitations } = yield* call(
            makeHouseholdPeopleAdmission(principal),
            (personAdmission) =>
              options.domain.listHouseholdPeople({
                admission: personAdmission,
                query: { includeArchived: "false" },
              }),
            HouseholdPeoplePrivateRoster
          );
          const binding = pendingInvitations.find(
            (pending) => pending.personId === payload.personId
          );
          if (binding === undefined) {
            return yield* Effect.fail(
              HouseholdPersonAssociationConflict.make({})
            );
          }
          if (binding.invitationDigest === intent.digest) {
            replayingAssociation = true;
          } else {
            const states = yield* options.controlPlane
              .listInvitationStates(principal.organizationId)
              .pipe(Effect.mapError(() => HouseholdPeopleUnavailable.make({})));
            const records = yield* Effect.all(
              states.map((state) =>
                invitationDigest(principal.organizationId, state.id).pipe(
                  Effect.map((digest) => ({ ...state, digest }))
                )
              )
            );
            const prior = records.find(
              (record) => record.digest === binding.invitationDigest
            );
            const now = yield* Clock.currentTimeMillis;
            if (
              prior === undefined ||
              (prior.status !== "rejected" &&
                prior.status !== "canceled" &&
                !(
                  prior.status === "pending" && prior.expiresAt.getTime() <= now
                ))
            ) {
              return yield* Effect.fail(
                HouseholdPersonAssociationConflict.make({})
              );
            }
            replacedInvitationDigest = binding.invitationDigest;
          }
        }
        const invitation = yield* options.controlPlane
          .getInvitation({
            invitationId: intent.invitationId,
            organizationId: principal.organizationId,
          })
          .pipe(
            Effect.catchTag("HouseholdPeopleControlPlaneNotFound", () =>
              Effect.gen(function* createEligibleInvitation() {
                if (
                  target.associationState === "linked" ||
                  (target.associationState === "invitation_pending" &&
                    replacedInvitationDigest === undefined)
                ) {
                  return yield* Effect.fail(
                    HouseholdPersonAssociationConflict.make({})
                  );
                }
                return yield* options.controlPlane.createInvitation({
                  email: payload.email,
                  headers,
                  invitationId: intent.invitationId,
                  organizationId: principal.organizationId,
                  personId: payload.personId,
                });
              })
            )
          );
        yield* verifyInvitationBinding(principal, payload, invitation);
        if (
          invitation.id !== intent.invitationId ||
          (invitation.status !== "pending" &&
            invitation.status !== "accepted" &&
            !replayingAssociation)
        ) {
          return yield* Effect.fail(
            HouseholdPersonAssociationConflict.make({})
          );
        }
        // Resolve the control-plane result first. A definitive rejection leaves the
        // existing person unlinked, so a corrected email can use that same person.
        // Acceptance is gated by recipient proof until association succeeds.
        let associationPayload: AssociateAdultInvitationPayload = {
          invitationDigest: intent.digest,
          invitationRequestDigest: intent.requestDigest,
          mutationId: payload.mutationId,
          personId: payload.personId,
        };
        if (replacedInvitationDigest !== undefined) {
          associationPayload = {
            ...associationPayload,
            replacedInvitationDigest,
          };
        }
        const wire = yield* options.domain
          .associateAdultInvitation({
            admission,
            payload: associationPayload,
          })
          .pipe(Effect.mapError(mapPeopleFailure));
        const person = yield* decodePerson(wire);
        // Only a linked person can receive a usable invitation. A repeated
        // command may resend the same invitation after an uncertain response.
        if (invitation.status === "pending") {
          yield* options.sendInvitationEmail({
            email: invitation.email,
            invitationId: invitation.id,
            inviterId: invitation.inviterId,
            organizationId: principal.organizationId,
          });
        }
        return yield* Schema.decodeUnknownEffect(
          HouseholdAdultInvitationResult
        )({
          association: "associated",
          invitationId: invitation.id,
          person,
        }).pipe(Effect.mapError(() => HouseholdPeopleUnavailable.make({})));
      }),
    list: ({ includeArchived, principal }) =>
      Effect.gen(function* listPeople() {
        const { roster, pendingInvitations } = yield* call(
          makeHouseholdPeopleAdmission(principal),
          (admission) =>
            options.domain.listHouseholdPeople({
              admission,
              query: { includeArchived: includeArchived ? "true" : "false" },
            }),
          HouseholdPeoplePrivateRoster
        );
        const invitations = yield* options.controlPlane
          .listInvitationStates(principal.organizationId)
          .pipe(Effect.mapError(() => HouseholdPeopleUnavailable.make({})));
        const records = yield* Effect.all(
          invitations.map((invitation) =>
            invitationDigest(principal.organizationId, invitation.id).pipe(
              Effect.map((digest) => ({ ...invitation, digest }))
            )
          )
        );
        const now = yield* Clock.currentTimeMillis;
        const people = roster.people.map((person) => {
          const binding = pendingInvitations.find(
            (pending) => pending.personId === person.id
          );
          const record =
            binding &&
            records.find(
              (invitation) => invitation.digest === binding.invitationDigest
            );
          if (
            !record ||
            person.associationState !== "invitation_pending" ||
            record.status === "accepted" ||
            (record.status === "pending" && record.expiresAt.getTime() > now)
          ) {
            return person;
          }
          return {
            ...person,
            associationState:
              record.status === "rejected"
                ? ("invitation_declined" as const)
                : ("invitation_unavailable" as const),
          };
        });
        return {
          creatorSlot: roster.creatorSlot,
          currentPersonId: roster.currentPersonId,
          people,
        };
      }),
    listProfileVersions: ({ beforeVersion, personId, principal }) =>
      makeHouseholdPeopleAdmission(principal).pipe(
        Effect.mapError(profileFailure),
        Effect.flatMap((admission) =>
          options.domain
            .listProfileVersions({
              admission,
              beforeVersion:
                beforeVersion === null
                  ? null
                  : ProfileVersion.make(beforeVersion),
              personId,
            })
            .pipe(Effect.mapError(mapProfileFailure))
        ),
        Effect.flatMap((wire) =>
          Schema.decodeUnknownEffect(ProfileVersionPage)(wire).pipe(
            Effect.mapError(profileFailure)
          )
        )
      ),
    mutateProfile: ({ payload, personId, principal }) =>
      makeHouseholdPeopleAdmission(principal).pipe(
        Effect.mapError(profileFailure),
        Effect.flatMap((admission) =>
          options.domain
            .mutatePersonProfile({ admission, payload, personId })
            .pipe(Effect.mapError(mapProfileFailure))
        ),
        Effect.flatMap((wire) =>
          Schema.decodeUnknownEffect(PersonProfile)(wire).pipe(
            Effect.mapError(profileFailure)
          )
        )
      ),
    remove: ({ headers, payload, personId, principal }) =>
      Effect.gen(function* removePerson() {
        const ownerAdmission = yield* creatorAdmission(principal);
        const plan = yield* call(
          Effect.succeed(ownerAdmission),
          (admission) =>
            options.domain.preparePersonRemoval({
              admission,
              payload,
              personId,
            }),
          HouseholdPersonRemovalPlan
        );
        if (plan.completedPerson !== null) {
          return plan.completedPerson;
        }
        const mutationId = yield* deriveHouseholdRemovalMutationId(
          principal.organizationId,
          payload.mutationId,
          "apply"
        ).pipe(Effect.mapError(() => HouseholdPeopleUnavailable.make({})));
        if (plan.action._tag !== "depart") {
          const cancelledInvitationDigest =
            plan.action._tag === "cancel_invitation"
              ? plan.action.invitationDigest
              : undefined;
          if (cancelledInvitationDigest !== undefined) {
            const invitations =
              yield* options.controlPlane.listInvitationStates(
                principal.organizationId
              );
            const candidates = yield* Effect.forEach(
              invitations,
              (invitation) =>
                invitationDigest(principal.organizationId, invitation.id).pipe(
                  Effect.map((digest) => ({ digest, invitation }))
                ),
              { concurrency: 8 }
            );
            const target = candidates.find(
              (candidate) => candidate.digest === cancelledInvitationDigest
            );
            if (target === undefined) {
              return yield* Effect.fail(
                HouseholdPersonAssociationConflict.make({})
              );
            }
            yield* options.controlPlane.cancelInvitation({
              headers,
              invitationId: target.invitation.id,
              mutationId: payload.mutationId,
              organizationId: principal.organizationId,
              personId,
            });
          }
          let archiveInput: HouseholdTransitionPersonInput = {
            admission: ownerAdmission,
            payload: { expectedVersion: payload.expectedVersion, mutationId },
            personId,
          };
          if (cancelledInvitationDigest !== undefined) {
            archiveInput = { ...archiveInput, cancelledInvitationDigest };
          }
          return yield* call(
            Effect.succeed(ownerAdmission),
            () => options.domain.archiveHouseholdPerson(archiveInput),
            HouseholdPerson
          );
        }
        const targetLinkageSubject = plan.action.linkageSubject;
        const expectedLinkVersion = plan.action.linkVersion;
        const prepared = yield* call(
          Effect.succeed(ownerAdmission),
          (admission) =>
            options.domain.prepareMemberDeparture({
              admission,
              payload: {
                expectedLinkVersion,
                expectedPersonVersion: payload.expectedVersion,
                mutationId,
                personId,
                reason: HouseholdPeopleOperationReason.make(
                  "Removed from the family roster"
                ),
              },
              removalMutationId: payload.mutationId,
              targetLinkageSubject,
            }),
          HouseholdMemberDepartureOperation
        );
        let current = yield* call(
          Effect.succeed(ownerAdmission),
          (admission) =>
            options.domain.getMemberDeparture({
              admission,
              operationId: prepared.operationId,
            }),
          HouseholdMemberDepartureOperation
        );
        if (current.state === "cancelled") {
          return yield* Effect.fail(
            HouseholdPersonAssociationConflict.make({})
          );
        }
        if (current.state !== "completed") {
          const members = yield* options.controlPlane.listMembers(
            principal.organizationId
          );
          const candidates = yield* Effect.forEach(
            members,
            (member) =>
              linkageSubject(principal.organizationId, member.userId).pipe(
                Effect.map((subject) => ({ member, subject }))
              ),
            { concurrency: 8 }
          );
          const member = candidates.find(
            (candidate) => candidate.subject === targetLinkageSubject
          )?.member;
          if (current.state === "prepared") {
            const started = yield* call(
              Effect.succeed(ownerAdmission),
              (admission) =>
                options.domain.startMemberDeparture({
                  admission,
                  expectedOperationVersion: current.version,
                  operationId: current.operationId,
                }),
              HouseholdMemberDepartureStart
            );
            yield* runDepartureAttempt({
              attemptClaimed: started.attemptClaimed,
              headers,
              memberId: member?.id ?? null,
              memberIsPresent: member !== undefined,
              operation: started.operation,
              organizationId: principal.organizationId,
              self: false,
            });
          } else if (
            current.state === "revocation_repair_required" ||
            current.state === "finalization_repair_required"
          ) {
            yield* options.departureWorkflow.confirmTerminal({
              claimedOperationVersion: current.version,
              executionGeneration: current.executionGeneration,
              operationId: current.operationId,
              organizationId: principal.organizationId,
            });
            const retryMutationId = yield* deriveHouseholdRemovalMutationId(
              principal.organizationId,
              payload.mutationId,
              `retry-${current.version}`
            ).pipe(Effect.mapError(() => HouseholdPeopleUnavailable.make({})));
            const started = yield* call(
              Effect.succeed(ownerAdmission),
              (admission) =>
                options.domain.retryMemberDeparture({
                  admission,
                  operationId: current.operationId,
                  payload: {
                    expectedOperationVersion: current.version,
                    mutationId: retryMutationId,
                    reason: HouseholdPeopleOperationReason.make(
                      "Retry family roster removal"
                    ),
                  },
                  targetLinkageSubject: member ? targetLinkageSubject : null,
                }),
              HouseholdMemberDepartureStart
            );
            yield* runDepartureAttempt({
              attemptClaimed: started.attemptClaimed,
              headers,
              memberId: member?.id ?? null,
              memberIsPresent: member !== undefined,
              operation: started.operation,
              organizationId: principal.organizationId,
              self: false,
            });
          } else {
            yield* options.departureWorkflow.ensureStarted({
              claimedOperationVersion: current.version,
              executionGeneration: current.executionGeneration,
              operationId: current.operationId,
              organizationId: principal.organizationId,
            });
          }
          current = yield* call(
            Effect.succeed(ownerAdmission),
            (admission) =>
              options.domain.getMemberDeparture({
                admission,
                operationId: current.operationId,
              }),
            HouseholdMemberDepartureOperation
          );
          if (current.state !== "completed") {
            return yield* Effect.fail(HouseholdPeopleUnavailable.make({}));
          }
        }
        const completed = yield* call(
          Effect.succeed(ownerAdmission),
          (admission) =>
            options.domain.preparePersonRemoval({
              admission,
              payload,
              personId,
            }),
          HouseholdPersonRemovalPlan
        );
        if (completed.completedPerson === null) {
          return yield* Effect.fail(HouseholdPeopleUnavailable.make({}));
        }
        return completed.completedPerson;
      }),
    rename: ({ payload, personId, principal }) =>
      call(
        makeHouseholdPeopleAdmission(principal),
        (admission) =>
          options.domain.renameHouseholdPerson({
            admission,
            payload,
            personId,
          }),
        HouseholdPerson
      ),
    repairAdultLink: ({ payload, principal }) =>
      Effect.gen(function* repairAdultAccountLink() {
        const admission = yield* creatorAdmission(principal);
        const member = yield* options.controlPlane.getMember({
          memberId: payload.memberId,
          organizationId: principal.organizationId,
        });
        const targetLinkageSubject = yield* linkageSubject(
          principal.organizationId,
          member.userId
        );
        const wire = yield* options.domain
          .repairAdultAccountLink({
            admission,
            payload: {
              expectedPersonVersion: payload.expectedPersonVersion,
              mutationId: payload.mutationId,
              personId: payload.personId,
              reason: payload.reason,
            },
            targetLinkageSubject,
          })
          .pipe(Effect.mapError(mapPeopleFailure));
        return yield* decodePerson(wire);
      }),
    restore: ({ payload, personId, principal }) =>
      call(
        makeHouseholdPeopleAdmission(principal),
        (admission) =>
          options.domain.restoreHouseholdPerson({
            admission,
            payload,
            personId,
          }),
        HouseholdPerson
      ),
    retryDeparture: ({ headers, operationId, payload, principal }) =>
      Effect.gen(function* retryMemberDeparture() {
        const admission =
          principal.creatorAuthority === null
            ? yield* memberAdmission(principal)
            : yield* creatorAdmission(principal);
        const currentWire = yield* options.domain
          .getMemberDeparture({ admission, operationId })
          .pipe(Effect.mapError(mapPeopleFailure));
        const current = yield* decodeDeparture(currentWire);
        yield* options.departureWorkflow.confirmTerminal({
          claimedOperationVersion: current.version,
          executionGeneration: current.executionGeneration,
          operationId,
          organizationId: principal.organizationId,
        });
        const member = yield* options.controlPlane
          .getMember({
            memberId: payload.memberId,
            organizationId: principal.organizationId,
          })
          .pipe(
            Effect.map((value) => ({ present: true as const, value })),
            Effect.catchTag("HouseholdPeopleControlPlaneNotFound", () =>
              Effect.succeed({ present: false as const, value: null })
            )
          );
        const targetLinkageSubject = member.present
          ? yield* linkageSubject(principal.organizationId, member.value.userId)
          : null;
        const wire = yield* options.domain
          .retryMemberDeparture({
            admission,
            operationId,
            payload: {
              expectedOperationVersion: payload.expectedOperationVersion,
              mutationId: payload.mutationId,
              reason: payload.reason,
            },
            targetLinkageSubject,
          })
          .pipe(Effect.mapError(mapPeopleFailure));
        const started = yield* decodeDepartureStart(wire);
        return yield* runDepartureAttempt({
          attemptClaimed: started.attemptClaimed,
          headers,
          memberId: member.present ? member.value.id : payload.memberId,
          memberIsPresent: member.present,
          operation: started.operation,
          organizationId: principal.organizationId,
          self:
            member.present && targetLinkageSubject === principal.linkageSubject,
        });
      }),
    returnAdult: ({ payload, principal }) =>
      Effect.gen(function* restoreReturningAdultLink() {
        const invitation = yield* options.controlPlane.getInvitation({
          invitationId: payload.invitationId,
          organizationId: principal.organizationId,
        });
        if (invitation.status !== "accepted") {
          return yield* Effect.fail(
            HouseholdPersonAssociationConflict.make({})
          );
        }
        const digest = yield* invitationDigest(
          principal.organizationId,
          invitation.id
        );
        const admission = yield* memberAdmission(principal);
        const wire = yield* options.domain
          .restoreReturningAdultLink({
            admission,
            payload: {
              expectedPersonVersion: payload.expectedPersonVersion,
              invitationDigest: digest,
              mutationId: payload.mutationId,
              personId: payload.personId,
            },
          })
          .pipe(Effect.mapError(mapPeopleFailure));
        return yield* decodePerson(wire);
      }),
  };
};

/** Adapt authenticated household operations to admitted private RPC commands. */
export const makeHouseholdMealPlanGateway = (options: {
  readonly domain: HouseholdMealPlanDomainPort;
}): HouseholdMealPlanGateway => {
  const admissionFor = (principal: HouseholdPeoplePrincipal) =>
    makeHouseholdPeopleAdmission(principal).pipe(
      Effect.mapError(() => persistenceFailure("read"))
    );
  const decision = (
    method:
      | "approveMealPlan"
      | "proposeMealPlanRevision"
      | "acceptMealPlanRevision"
      | "rejectMealPlanRevision",
    input: {
      readonly planId: MealPlanId;
      readonly payload: DecideMealPlanPayload;
      readonly principal: HouseholdPeoplePrincipal;
    }
  ) =>
    Effect.gen(function* decideMealPlan() {
      const admission = yield* admissionFor(input.principal);
      const wire = yield* options.domain[method]({
        admission,
        payload: Schema.encodeSync(DecideMealPlanPayload)(input.payload),
        planId: input.planId,
      }).pipe(Effect.mapError((error) => mapPlanFailure(error, "save")));
      return yield* decodeMealPlan(wire);
    });
  return {
    acceptRevision: (input) => decision("acceptMealPlanRevision", input),
    approve: (input) => decision("approveMealPlan", input),
    change: ({ planId, payload, principal }) =>
      Effect.gen(function* changeMealPlan() {
        const admission = yield* admissionFor(principal);
        const wire = yield* options.domain
          .changeMealPlan({
            admission,
            payload: Schema.encodeSync(ChangeMealPlanPayload)(payload),
            planId,
          })
          .pipe(Effect.mapError((error) => mapPlanFailure(error, "save")));
        return yield* decodeMealPlan(wire);
      }),
    create: ({ payload, principal }) =>
      Effect.gen(function* createMealPlan() {
        const admission = yield* admissionFor(principal);
        const wire = yield* options.domain
          .createMealPlan({
            admission,
            request: Schema.encodeSync(MealPlanRequest)(payload),
          })
          .pipe(Effect.mapError((error) => mapPlanFailure(error, "create")));
        return yield* decodeMealPlan(wire);
      }),
    list: ({ principal }) =>
      Effect.gen(function* listMealPlans() {
        const admission = yield* admissionFor(principal);
        const wire = yield* options.domain
          .listMealPlans({ admission })
          .pipe(Effect.mapError((error) => mapPlanFailure(error, "read")));
        return yield* Schema.decodeUnknownEffect(Schema.Array(MealPlanSummary))(
          wire
        ).pipe(Effect.mapError(() => persistenceFailure("read")));
      }),
    proposeRevision: (input) => decision("proposeMealPlanRevision", input),
    read: ({ planId, principal }) =>
      Effect.gen(function* readMealPlan() {
        const admission = yield* admissionFor(principal);
        const wire = yield* options.domain
          .readMealPlan({ admission, planId })
          .pipe(Effect.mapError((error) => mapPlanFailure(error, "read")));
        if (wire === null) {
          return yield* Effect.fail(MealPlanNotFound.make({ planId }));
        }
        return yield* decodeMealPlan(wire);
      }),
    rejectRevision: (input) => decision("rejectMealPlanRevision", input),
  };
};

const planningContentAdmissionFor = (principal: HouseholdPeoplePrincipal) =>
  makeHouseholdPeopleAdmission(principal).pipe(
    Effect.mapError(() =>
      PlanningContentRejected.make({ reason: "unavailable" })
    )
  );
const planningContentFailure = (
  error: MealPlanDomainFailure
): PlanningContentRejected =>
  error._tag === "PlanningContentRejected"
    ? error
    : PlanningContentRejected.make({ reason: "unavailable" });

export const makeHouseholdPlanningContentGateway = (options: {
  readonly domain: HouseholdMealPlanDomainPort;
}): HouseholdPlanningContentGateway => ({
  listSavedRecipes: ({ principal, query }) =>
    Effect.gen(function* listSavedRecipes() {
      const admission = yield* planningContentAdmissionFor(principal);
      const wire = yield* options.domain
        .listSavedRecipes({
          admission,
          query: Schema.encodeSync(SavedRecipePageQuery)(query),
        })
        .pipe(Effect.mapError(planningContentFailure));
      return yield* Schema.decodeUnknownEffect(SavedRecipePage)(wire).pipe(
        Effect.mapError(() =>
          PlanningContentRejected.make({ reason: "unavailable" })
        )
      );
    }),
  mutate: ({ principal, payload }) =>
    Effect.gen(function* mutatePlanningContent() {
      const admission = yield* planningContentAdmissionFor(principal);
      const wire = yield* options.domain
        .mutatePlanningContent({
          admission,
          payload: Schema.encodeSync(MutatePlanningContentPayload)(payload),
        })
        .pipe(Effect.mapError(planningContentFailure));
      return yield* Schema.decodeUnknownEffect(PlanningContentSnapshot)(
        wire
      ).pipe(
        Effect.mapError(() =>
          PlanningContentRejected.make({ reason: "unavailable" })
        )
      );
    }),
  read: (principal) =>
    Effect.gen(function* readPlanningContent() {
      const admission = yield* planningContentAdmissionFor(principal);
      const wire = yield* options.domain
        .readPlanningContent({ admission })
        .pipe(Effect.mapError(planningContentFailure));
      return yield* Schema.decodeUnknownEffect(PlanningContentSnapshot)(
        wire
      ).pipe(
        Effect.mapError(() =>
          PlanningContentRejected.make({ reason: "unavailable" })
        )
      );
    }),
});

/** Adapt the private service binding to the application gateway. */
export const makeHouseholdDomainGateway = (
  domain: HouseholdDomainPort
): HouseholdDomainGateway => ({
  ensure: (principal) =>
    makeHouseholdMemberAdmission(principal).pipe(
      Effect.mapError(() => HouseholdInvalidInput.make({})),
      Effect.flatMap((admission) => domain.ensureHousehold({ admission })),
      Effect.map((metadata) => ({ ...metadata, status: "ready" as const }))
    ),
});

/**
 * Production household request composition shared by the API Worker and its
 * provider-free host proof. Authentication and membership resolution are
 * installed before the private-domain gateway can be reached.
 */
export const makeHouseholdRequestLayer = (options: {
  readonly gateway: HouseholdDomainGateway;
  readonly resolver: AuthenticatedOrganizationResolver;
}) => {
  const requestServices = Layer.mergeAll(
    Layer.succeed(AuthenticatedOrganizationResolverService, options.resolver),
    Layer.succeed(HouseholdDomainGatewayService, options.gateway)
  );
  return HouseholdHttpApiLayer.pipe(
    Layer.provide(JsonHttpPlatformServices),
    Layer.provide(requestServices),
    HttpRouter.provideRequest(requestServices)
  );
};

/** Mount the authenticated meal-plan surface over the admitted application gateway. */
export const makeHouseholdMealPlanRequestLayer = (options: {
  readonly gateway: HouseholdMealPlanGateway;
  readonly resolver: AuthenticatedOrganizationResolver;
}) => {
  const requestServices = Layer.mergeAll(
    Layer.succeed(AuthenticatedOrganizationResolverService, options.resolver),
    Layer.succeed(HouseholdMealPlanGatewayService, options.gateway)
  );
  return HouseholdMealPlanHttpApiLayer.pipe(
    Layer.provide(JsonHttpPlatformServices),
    Layer.provide(requestServices),
    HttpRouter.provideRequest(requestServices)
  );
};

/** Mount authenticated planning content over the same household domain binding. */
export const makeHouseholdPlanningContentRequestLayer = (options: {
  readonly gateway: HouseholdPlanningContentGateway;
  readonly resolver: AuthenticatedOrganizationResolver;
}) => {
  const requestServices = Layer.mergeAll(
    Layer.succeed(AuthenticatedOrganizationResolverService, options.resolver),
    Layer.succeed(HouseholdPlanningContentGatewayService, options.gateway)
  );
  return HouseholdPlanningContentHttpApiLayer.pipe(
    Layer.provide(JsonHttpPlatformServices),
    Layer.provide(requestServices),
    HttpRouter.provideRequest(requestServices)
  );
};

/** Mount the authenticated household people surface over its admitted gateway. */
export const makeHouseholdPeopleRequestLayer = (options: {
  readonly gateway: HouseholdPeopleGateway;
  readonly resolver: AuthenticatedOrganizationResolver;
}) => {
  const requestServices = Layer.mergeAll(
    Layer.succeed(AuthenticatedOrganizationResolverService, options.resolver),
    Layer.succeed(HouseholdPeopleGatewayService, options.gateway)
  );
  return HouseholdPeopleHttpApiLayer.pipe(
    Layer.provide(JsonHttpPlatformServices),
    Layer.provide(requestServices),
    HttpRouter.provideRequest(requestServices)
  );
};

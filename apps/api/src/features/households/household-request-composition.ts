import {
  HouseholdAdultInvitationResult,
  HouseholdMemberDepartureOperation,
  HouseholdMemberDepartureStart,
  HouseholdPeopleRoster,
  HouseholdPeopleUnavailable,
  HouseholdPerson,
  HouseholdPersonAssociationConflict,
  MealPlan,
  MealPlanNotFound,
  MealPlanPersistenceFailure,
  MealPlanPolicy,
  MealPlanRequest,
} from "@meal-planner/household-api";
import type {
  HouseholdPeopleFailure,
  MealPlanMutationConflict,
  MealPlanRequestConflict,
  MealPlanSwapRejected,
  MealPlanTransitionRejected,
  MealPlanVersionConflict,
} from "@meal-planner/household-api";
import { Effect, Layer, Schema } from "effect";
import * as HttpRouter from "effect/unstable/http/HttpRouter";

import type { AuthenticatedOrganizationResolver } from "../auth/auth.principal.js";
import { AuthenticatedOrganizationResolver as AuthenticatedOrganizationResolverService } from "../auth/auth.principal.js";
import { RecipeImportHttpPlatformServices } from "../imports/import-intent-api.http.js";
import type {
  HouseholdCreateMealPlanFromRecipeBankInput,
  HouseholdDecideMealPlanInput,
  HouseholdMealPlanWire,
  HouseholdReadMealPlanInput,
  HouseholdSwapMealPlanFromRecipeBankInput,
} from "./household-meal-plan.contract.js";
import {
  HouseholdManualMealSwapCommand,
  HouseholdMealPlanDecisionCommand,
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
  HouseholdPeopleGateway,
  MealPlanCreateFailure,
  MealPlanDecisionFailure,
  MealPlanReadFailure,
  MealPlanSwapFailure,
} from "./household.gateway.js";
import {
  HouseholdDomainGateway as HouseholdDomainGatewayService,
  HouseholdMealPlanGateway as HouseholdMealPlanGatewayService,
  HouseholdPeopleGateway as HouseholdPeopleGatewayService,
  HouseholdPeopleOrganizerRequired,
} from "./household.gateway.js";
import {
  makeHouseholdHttpApiLayer,
  makeHouseholdMealPlanHttpApiLayer,
  makeHouseholdPeopleHttpApiLayer,
} from "./household.http.js";
import type {
  HouseholdAssociateAdultInvitationInput,
  HouseholdBootstrapCreatorPersonInput,
  HouseholdCancelMemberDepartureInput,
  HouseholdCompleteAcceptedAdultLinkInput,
  HouseholdCreatePersonInput,
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
import type { HouseholdPeopleControlPlane } from "./people/household-people.control-plane.js";
import {
  deriveHouseholdInvitationDigest,
  deriveHouseholdPersonLinkageSubject,
} from "./people/household-people.identity.js";
import type { MemberDepartureWorkflowStarter } from "./people/member-departure.js";
import type { HouseholdRecipeImportFailure } from "./recipe-import/household-recipe-import.contract.js";
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
  | MealPlanMutationConflict
  | MealPlanNotFound
  | MealPlanPersistenceFailure
  | MealPlanRequestConflict
  | MealPlanSwapRejected
  | MealPlanTransitionRejected
  | MealPlanVersionConflict
  | HouseholdRecipeImportFailure;

interface HouseholdMealPlanDomainPort {
  readonly approveMealPlan: (
    input: HouseholdDecideMealPlanInput
  ) => Effect.Effect<HouseholdMealPlanWire, MealPlanDomainFailure>;
  readonly createMealPlanFromRecipeBank: (
    input: HouseholdCreateMealPlanFromRecipeBankInput
  ) => Effect.Effect<HouseholdMealPlanWire, MealPlanDomainFailure>;
  readonly readMealPlan: (
    input: HouseholdReadMealPlanInput
  ) => Effect.Effect<HouseholdMealPlanWire | null, MealPlanDomainFailure>;
  readonly rejectMealPlan: (
    input: HouseholdDecideMealPlanInput
  ) => Effect.Effect<HouseholdMealPlanWire, MealPlanDomainFailure>;
  readonly swapMealPlanFromRecipeBank: (
    input: HouseholdSwapMealPlanFromRecipeBankInput
  ) => Effect.Effect<HouseholdMealPlanWire, MealPlanDomainFailure>;
}

interface HouseholdPeopleDomainPort {
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
  readonly createHouseholdPerson: (
    input: HouseholdCreatePersonInput
  ) => Effect.Effect<object, HouseholdDomainFailure | HouseholdPeopleFailure>;
  readonly getHouseholdPerson: (
    input: HouseholdGetPersonInput
  ) => Effect.Effect<object, HouseholdDomainFailure | HouseholdPeopleFailure>;
  readonly getMemberDeparture: (
    input: HouseholdGetMemberDepartureInput
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
  invitationId: string
) =>
  deriveHouseholdInvitationDigest(organizationId, invitationId).pipe(
    Effect.mapError(() => HouseholdPeopleUnavailable.make({}))
  );

const linkageSubject = (
  organizationId: Parameters<
    HouseholdPeopleControlPlane["listMemberUserIds"]
  >[0],
  userId: string
) =>
  deriveHouseholdPersonLinkageSubject(organizationId, userId).pipe(
    Effect.mapError(() => HouseholdPeopleUnavailable.make({}))
  );

const persistenceFailure = (operation: "create" | "read" | "save") =>
  MealPlanPersistenceFailure.make({ operation });

const mapCreateFailure = (
  error: MealPlanDomainFailure
): MealPlanCreateFailure =>
  error._tag === "MealPlanRequestConflict" ||
  error._tag === "MealPlanPersistenceFailure"
    ? error
    : persistenceFailure("create");

const mapReadFailure = (error: MealPlanDomainFailure): MealPlanReadFailure =>
  error._tag === "MealPlanNotFound" ||
  error._tag === "MealPlanPersistenceFailure"
    ? error
    : persistenceFailure("read");

const mapDecisionFailure = (
  error: MealPlanDomainFailure
): MealPlanDecisionFailure => {
  switch (error._tag) {
    case "MealPlanMutationConflict":
    case "MealPlanNotFound":
    case "MealPlanPersistenceFailure":
    case "MealPlanTransitionRejected":
    case "MealPlanVersionConflict": {
      return error;
    }
    default: {
      return persistenceFailure("save");
    }
  }
};

const mapSwapFailure = (error: MealPlanDomainFailure): MealPlanSwapFailure =>
  error._tag === "MealPlanSwapRejected" ? error : mapDecisionFailure(error);

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
export const makeHouseholdPeopleGateway = (options: {
  readonly controlPlane: HouseholdPeopleControlPlane;
  readonly departureWorkflow: MemberDepartureWorkflowStarter;
  readonly domain: HouseholdPeopleDomainPort;
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
    readonly memberId: string;
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
      if (input.memberIsPresent) {
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
        const invitation = yield* options.controlPlane.getInvitation({
          invitationId: payload.invitationId,
          organizationId: principal.organizationId,
        });
        if (
          invitation.status !== "pending" &&
          invitation.status !== "accepted"
        ) {
          return yield* Effect.fail(
            HouseholdPersonAssociationConflict.make({})
          );
        }
        const digest = yield* invitationDigest(
          principal.organizationId,
          invitation.id
        );
        const wire = yield* options.domain
          .associateAdultInvitation({
            admission,
            payload: {
              invitationDigest: digest,
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
        const member = yield* options.controlPlane.getAcceptedInvitationMember({
          invitationId: payload.invitationId,
          organizationId: principal.organizationId,
        });
        const targetLinkageSubject = yield* linkageSubject(
          principal.organizationId,
          member.userId
        );
        if (targetLinkageSubject !== principal.linkageSubject) {
          return yield* Effect.fail(
            HouseholdPersonAssociationConflict.make({})
          );
        }
        const digest = yield* invitationDigest(
          principal.organizationId,
          member.invitationId
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
    inviteAdult: ({ headers, payload, principal }) =>
      Effect.gen(function* inviteAdult() {
        const admission = yield* creatorAdmission(principal);
        const invitation = yield* options.controlPlane.createInvitation({
          email: payload.email,
          headers,
          organizationId: principal.organizationId,
        });
        const digest = yield* invitationDigest(
          principal.organizationId,
          invitation.id
        );
        const person = yield* options.domain
          .associateAdultInvitation({
            admission,
            payload: {
              invitationDigest: digest,
              mutationId: payload.mutationId,
              personId: payload.personId,
            },
          })
          .pipe(
            Effect.mapError(mapPeopleFailure),
            Effect.flatMap(decodePerson),
            Effect.option
          );
        return yield* Schema.decodeUnknownEffect(
          HouseholdAdultInvitationResult
        )(
          person._tag === "Some"
            ? {
                association: "associated",
                invitationId: invitation.id,
                person: person.value,
              }
            : {
                association: "association_required",
                invitationId: invitation.id,
                person: null,
              }
        ).pipe(Effect.mapError(() => HouseholdPeopleUnavailable.make({})));
      }),
    list: ({ includeArchived, principal }) =>
      call(
        makeHouseholdPeopleAdmission(principal),
        (admission) =>
          options.domain.listHouseholdPeople({
            admission,
            query: { includeArchived: includeArchived ? "true" : "false" },
          }),
        HouseholdPeopleRoster
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
        const member = yield* options.controlPlane.getAcceptedInvitationMember({
          invitationId: payload.invitationId,
          organizationId: principal.organizationId,
        });
        const targetLinkageSubject = yield* linkageSubject(
          principal.organizationId,
          member.userId
        );
        if (targetLinkageSubject !== principal.linkageSubject) {
          return yield* Effect.fail(
            HouseholdPersonAssociationConflict.make({})
          );
        }
        const digest = yield* invitationDigest(
          principal.organizationId,
          member.invitationId
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

/**
 * Adapt admitted household operations to the private household worker.
 * Recipe selection and hydration stay inside the household authority.
 */
export const makeHouseholdMealPlanGateway = (options: {
  readonly domain: HouseholdMealPlanDomainPort;
}): HouseholdMealPlanGateway => ({
  approve: ({ draftId, payload, principal }) =>
    Effect.gen(function* approveHouseholdMealPlan() {
      const admission = yield* makeHouseholdMemberAdmission(principal).pipe(
        Effect.mapError(() => persistenceFailure("save"))
      );
      const request = yield* Schema.encodeEffect(
        HouseholdMealPlanDecisionCommand
      )({
        ...payload,
        draftId,
      }).pipe(Effect.mapError(() => persistenceFailure("save")));
      const wire = yield* options.domain
        .approveMealPlan({
          admission,
          request,
        })
        .pipe(Effect.mapError(mapDecisionFailure));
      return yield* decodeMealPlan(wire);
    }),
  create: ({ payload, principal }) =>
    Effect.gen(function* createHouseholdMealPlan() {
      const admission = yield* makeHouseholdMemberAdmission(principal).pipe(
        Effect.mapError(() => persistenceFailure("create"))
      );
      const [policy, request] = yield* Effect.all([
        Schema.encodeEffect(MealPlanPolicy)(payload.policy).pipe(
          Effect.mapError(() => persistenceFailure("create"))
        ),
        Schema.encodeEffect(MealPlanRequest)(payload.request).pipe(
          Effect.mapError(() => persistenceFailure("create"))
        ),
      ]);
      const wire = yield* options.domain
        .createMealPlanFromRecipeBank({
          admission,
          policy,
          request,
        })
        .pipe(Effect.mapError(mapCreateFailure));
      return yield* decodeMealPlan(wire).pipe(
        Effect.mapError(() => persistenceFailure("create"))
      );
    }),
  read: ({ draftId, principal }) =>
    Effect.gen(function* readHouseholdMealPlan() {
      const admission = yield* makeHouseholdMemberAdmission(principal).pipe(
        Effect.mapError(() => persistenceFailure("read"))
      );
      const wire = yield* options.domain
        .readMealPlan({
          admission,
          draftId,
        })
        .pipe(Effect.mapError(mapReadFailure));
      if (wire === null) {
        return yield* Effect.fail(MealPlanNotFound.make({ draftId }));
      }
      return yield* decodeMealPlan(wire);
    }),
  reject: ({ draftId, payload, principal }) =>
    Effect.gen(function* rejectHouseholdMealPlan() {
      const admission = yield* makeHouseholdMemberAdmission(principal).pipe(
        Effect.mapError(() => persistenceFailure("save"))
      );
      const request = yield* Schema.encodeEffect(
        HouseholdMealPlanDecisionCommand
      )({
        ...payload,
        draftId,
      }).pipe(Effect.mapError(() => persistenceFailure("save")));
      const wire = yield* options.domain
        .rejectMealPlan({
          admission,
          request,
        })
        .pipe(Effect.mapError(mapDecisionFailure));
      return yield* decodeMealPlan(wire);
    }),
  swap: ({ draftId, payload, principal }) =>
    Effect.gen(function* swapHouseholdMealPlan() {
      const admission = yield* makeHouseholdMemberAdmission(principal).pipe(
        Effect.mapError(() => persistenceFailure("save"))
      );
      const request = yield* Schema.encodeEffect(
        HouseholdManualMealSwapCommand
      )({
        ...payload,
        draftId,
      }).pipe(Effect.mapError(() => persistenceFailure("save")));
      const wire = yield* options.domain
        .swapMealPlanFromRecipeBank({
          admission,
          request,
        })
        .pipe(Effect.mapError(mapSwapFailure));
      return yield* decodeMealPlan(wire);
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
  return makeHouseholdHttpApiLayer().pipe(
    Layer.provide(RecipeImportHttpPlatformServices),
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
  return makeHouseholdMealPlanHttpApiLayer().pipe(
    Layer.provide(RecipeImportHttpPlatformServices),
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
  return makeHouseholdPeopleHttpApiLayer().pipe(
    Layer.provide(RecipeImportHttpPlatformServices),
    Layer.provide(requestServices),
    HttpRouter.provideRequest(requestServices)
  );
};

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
  HouseholdOrganizationId,
} from "@meal-planner/household-api";
import { Clock, Effect, Schema } from "effect";

import type { HouseholdDomainWorkerMethods } from "../household-domain-worker.js";
import type { HouseholdDomainFailure } from "../household.contract.js";
import type { HouseholdPeopleGateway } from "../household.gateway.js";
import { HouseholdPeopleOrganizerRequired } from "../household.gateway.js";
import {
  makeHouseholdPeopleAdmission,
  makeHouseholdPeopleCreatorAdmission,
} from "../rpc/command-envelope.js";
import {
  HouseholdPersonRemovalPlan,
  HouseholdPeoplePrivateRoster,
} from "./household-people.contract.js";
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
} from "./household-people.contract.js";
import type {
  HouseholdPeopleControlPlane,
  HouseholdControlPlaneInvitation,
} from "./household-people.control-plane.js";
import {
  deriveHouseholdRemovalMutationId,
  deriveHouseholdInvitationDigest,
  deriveHouseholdInvitationId,
  deriveHouseholdPeopleAuditActorId,
  deriveHouseholdInvitationRequestDigest,
  deriveHouseholdPersonLinkageSubject,
} from "./household-people.identity.js";
import type { MemberDepartureWorkflowStarter } from "./member-departure.js";

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
export const makeHouseholdInvitationRecipientVerifier = (
  domain: Pick<HouseholdDomainWorkerMethods, "confirmAdultInvitationRecipient">
) =>
  Effect.gen(function* makeInvitationRecipientVerifier() {
    const requestContext = yield* Effect.context<never>();
    return (input: {
      readonly invitationId: InvitationId;
      readonly organizationId: HouseholdOrganizationId;
      readonly userId: UserId;
    }) => {
      const checkedResult: Promise<void> = Effect.runPromise(
        Effect.gen(function* verifyInvitationRecipient() {
          const { organizationId } = input;
          const acceptedInvitationDigest =
            yield* deriveHouseholdInvitationDigest(
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
        }).pipe(Effect.provideContext(requestContext))
      );
      return checkedResult;
    };
  });

const mapPeopleFailure = (
  error: HouseholdDomainFailure | HouseholdPeopleFailure
) => {
  if (Schema.is(HouseholdPeopleUnavailable)(error)) {
    const checkedResult: HouseholdPeopleFailure = error;
    return checkedResult;
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
      const checkedResult: HouseholdPeopleFailure = error;
      return checkedResult;
    }
    default: {
      const checkedResult: HouseholdPeopleFailure =
        HouseholdPeopleUnavailable.make({});
      return checkedResult;
    }
  }
};

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
}) => {
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
  {
    const checkedResult: HouseholdPeopleGateway = {
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
                .pipe(
                  Effect.mapError(() => HouseholdPeopleUnavailable.make({}))
                );
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
                    prior.status === "pending" &&
                    prior.expiresAt.getTime() <= now
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
                  invitationDigest(
                    principal.organizationId,
                    invitation.id
                  ).pipe(Effect.map((digest) => ({ digest, invitation }))),
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
              ).pipe(
                Effect.mapError(() => HouseholdPeopleUnavailable.make({}))
              );
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
            ? yield* linkageSubject(
                principal.organizationId,
                member.value.userId
              )
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
              member.present &&
              targetLinkageSubject === principal.linkageSubject,
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
    return checkedResult;
  }
};

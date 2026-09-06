import {
  HouseholdAssociationVersion,
  HouseholdAssociationStaleVersion,
  HouseholdCreatorBootstrapConflict,
  HouseholdMemberDepartureConflict,
  HouseholdMemberDepartureInProgress,
  HouseholdMemberDepartureOperation,
  HouseholdMemberDepartureOperationId,
  HouseholdMemberDepartureStart,
  HouseholdPeopleRoster,
  HouseholdPeopleUnavailable,
  HouseholdPerson,
  HouseholdPersonAssociationConflict,
  HouseholdPersonId,
  HouseholdPersonLinkageSubject,
  HouseholdPersonLifecycleConflict,
  HouseholdPersonMutationCollision,
  HouseholdPersonNotFound,
  HouseholdPersonStaleVersion,
} from "@meal-planner/household-api";
import type {
  AssociateAdultInvitationPayload,
  BootstrapHouseholdCreatorPayload,
  CancelMemberDeparturePayload,
  CompleteAcceptedAdultLinkPayload,
  CreateHouseholdPersonPayload,
  HouseholdPeopleAuditActorId,
  HouseholdPeopleFailure,
  HouseholdInvitationDigest,
  HouseholdPersonAssociationState,
  PrepareMemberDeparturePayload,
  RepairAdultAccountLinkPayload,
  RestoreReturningAdultLinkPayload,
  RetryMemberDeparturePayload,
  TransitionHouseholdPersonPayload,
} from "@meal-planner/household-api";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { EffectSQLiteDoDatabase } from "drizzle-orm/effect-sqlite-do";
import { Effect, Schema } from "effect";

import {
  householdCreatorAssociationSingletonKey,
  householdMemberDepartureOperations,
  householdPeople,
  householdPersonAccountLinks,
  householdPersonAudits,
  householdPersonCreatorAssociations,
  householdPersonInvitationAssociations,
  householdPersonMutationReceipts,
} from "../household.database-schema.js";
import type {
  HouseholdCanonicalEncodingService,
  HouseholdDigestService,
  HouseholdIdentityGeneratorService,
} from "../shared-kernel/authority-services.js";
import type { HouseholdMemberDepartureSystemState } from "./household-people.contract.js";

type Person = typeof HouseholdPerson.Type;
type Departure = typeof HouseholdMemberDepartureOperation.Type;
type Failure = HouseholdPeopleFailure;

const PersistedPerson = Schema.fromJsonString(HouseholdPerson);
const encodePerson = Schema.encodeSync(PersistedPerson);
const PersistedDeparture = Schema.fromJsonString(
  HouseholdMemberDepartureOperation
);
const encodeDeparture = Schema.encodeSync(PersistedDeparture);
const PersistedDepartureStart = Schema.fromJsonString(
  HouseholdMemberDepartureStart
);
const encodeDepartureStart = Schema.encodeSync(PersistedDepartureStart);
const initialAssociationVersion = Schema.decodeUnknownSync(
  HouseholdAssociationVersion
)(1);

const unavailable = () => HouseholdPeopleUnavailable.make({});

const queryFailure = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.mapError(unavailable));

const decodePerson = (value: string) =>
  Schema.decodeUnknownEffect(PersistedPerson)(value).pipe(
    Effect.mapError(unavailable)
  );

const decodeDeparture = (value: string) =>
  Schema.decodeUnknownEffect(PersistedDeparture)(value).pipe(
    Effect.mapError(unavailable)
  );

const decodeDepartureStart = (value: string) =>
  Schema.decodeUnknownEffect(PersistedDepartureStart)(value).pipe(
    Effect.mapError(unavailable)
  );

const projectPerson = (
  row: typeof householdPeople.$inferSelect,
  currentPersonId: string | null,
  association: {
    readonly state: HouseholdPersonAssociationState;
    readonly version: HouseholdAssociationVersion | null;
  }
) =>
  Schema.decodeUnknownEffect(HouseholdPerson)({
    associationState: association.state,
    associationVersion: association.version,
    createdAtEpochMs: row.createdAtEpochMs,
    displayName: row.displayName,
    id: row.personId,
    isCurrentAdult: row.personId === currentPersonId,
    kind: row.kind,
    lifecycle: row.lifecycle,
    updatedAtEpochMs: row.updatedAtEpochMs,
    version: row.version,
  }).pipe(Effect.mapError(unavailable));

const projectDeparture = (
  row: typeof householdMemberDepartureOperations.$inferSelect
) =>
  Schema.decodeUnknownEffect(HouseholdMemberDepartureOperation)({
    canRetry:
      row.state === "revocation_repair_required" ||
      row.state === "finalization_repair_required",
    executionGeneration: row.executionGeneration,
    lastAttemptAtEpochMs: row.lastAttemptAtEpochMs,
    operationId: row.operationId,
    personId: row.personId,
    state: row.state,
    version: row.version,
  }).pipe(Effect.mapError(unavailable));

export interface HouseholdPeopleRepository {
  readonly associateAdultInvitation: (input: {
    readonly actorId: HouseholdPeopleAuditActorId;
    readonly linkageSubject: HouseholdPersonLinkageSubject;
    readonly now: number;
    readonly payload: AssociateAdultInvitationPayload;
  }) => Effect.Effect<Person, Failure>;
  readonly archive: (input: {
    readonly actorId: HouseholdPeopleAuditActorId;
    readonly linkageSubject: HouseholdPersonLinkageSubject;
    readonly now: number;
    readonly payload: TransitionHouseholdPersonPayload;
    readonly personId: typeof HouseholdPersonId.Type;
  }) => Effect.Effect<Person, Failure>;
  readonly bootstrapCreator: (input: {
    readonly actorId: HouseholdPeopleAuditActorId;
    readonly linkageSubject: HouseholdPersonLinkageSubject;
    readonly now: number;
    readonly payload: BootstrapHouseholdCreatorPayload;
  }) => Effect.Effect<Person, Failure>;
  readonly create: (input: {
    readonly actorId: HouseholdPeopleAuditActorId;
    readonly linkageSubject: HouseholdPersonLinkageSubject;
    readonly now: number;
    readonly payload: CreateHouseholdPersonPayload;
  }) => Effect.Effect<Person, Failure>;
  readonly completeAcceptedAdultLink: (input: {
    readonly actorId: HouseholdPeopleAuditActorId;
    readonly linkageSubject: HouseholdPersonLinkageSubject;
    readonly now: number;
    readonly payload: CompleteAcceptedAdultLinkPayload;
  }) => Effect.Effect<Person, Failure>;
  readonly confirmAdultInvitationRecipient: (input: {
    readonly invitationDigest: HouseholdInvitationDigest;
    readonly linkageSubject: HouseholdPersonLinkageSubject;
  }) => Effect.Effect<void, Failure>;
  readonly cancelMemberDeparture: (input: {
    readonly actorId: HouseholdPeopleAuditActorId;
    readonly callerIsOwner: boolean;
    readonly callerLinkageSubject: HouseholdPersonLinkageSubject;
    readonly now: number;
    readonly operationId: typeof HouseholdMemberDepartureOperationId.Type;
    readonly payload: CancelMemberDeparturePayload;
  }) => Effect.Effect<Departure, Failure>;
  readonly confirmMemberAccessRevoked: (input: {
    readonly expectedOperationVersion: number;
    readonly now: number;
    readonly operationId: typeof HouseholdMemberDepartureOperationId.Type;
  }) => Effect.Effect<Departure, Failure>;
  readonly finalizeMemberDeparture: (input: {
    readonly expectedOperationVersion: number;
    readonly now: number;
    readonly operationId: typeof HouseholdMemberDepartureOperationId.Type;
  }) => Effect.Effect<Departure, Failure>;
  readonly get: (input: {
    readonly actorId: HouseholdPeopleAuditActorId;
    readonly linkageSubject: HouseholdPersonLinkageSubject;
    readonly personId: typeof HouseholdPersonId.Type;
  }) => Effect.Effect<Person, Failure>;
  readonly list: (input: {
    readonly actorId: HouseholdPeopleAuditActorId;
    readonly linkageSubject: HouseholdPersonLinkageSubject;
    readonly includeArchived: boolean;
  }) => Effect.Effect<typeof HouseholdPeopleRoster.Type, Failure>;
  readonly getMemberDeparture: (input: {
    readonly callerIsOwner: boolean;
    readonly callerLinkageSubject: HouseholdPersonLinkageSubject;
    readonly operationId: typeof HouseholdMemberDepartureOperationId.Type;
  }) => Effect.Effect<Departure, Failure>;
  readonly getMemberDepartureByMutation: (input: {
    readonly callerIsOwner: boolean;
    readonly callerLinkageSubject: HouseholdPersonLinkageSubject;
    readonly mutationId: string;
  }) => Effect.Effect<Departure, Failure>;
  readonly getMemberDepartureSystem: (input: {
    readonly operationId: typeof HouseholdMemberDepartureOperationId.Type;
  }) => Effect.Effect<HouseholdMemberDepartureSystemState, Failure>;
  readonly markMemberDepartureRepairRequired: (input: {
    readonly expectedOperationVersion: number;
    readonly now: number;
    readonly operationId: typeof HouseholdMemberDepartureOperationId.Type;
    readonly phase: "finalization" | "revocation";
  }) => Effect.Effect<Departure, Failure>;
  readonly prepareMemberDeparture: (input: {
    readonly actorId: HouseholdPeopleAuditActorId;
    readonly callerIsOwner: boolean;
    readonly callerLinkageSubject: HouseholdPersonLinkageSubject;
    readonly now: number;
    readonly payload: PrepareMemberDeparturePayload;
    readonly targetLinkageSubject: HouseholdPersonLinkageSubject;
  }) => Effect.Effect<Departure, Failure>;
  readonly repairAdultAccountLink: (input: {
    readonly actorId: HouseholdPeopleAuditActorId;
    readonly linkageSubject: HouseholdPersonLinkageSubject;
    readonly now: number;
    readonly payload: RepairAdultAccountLinkPayload;
    readonly targetLinkageSubject: HouseholdPersonLinkageSubject;
  }) => Effect.Effect<Person, Failure>;
  readonly restore: (input: {
    readonly actorId: HouseholdPeopleAuditActorId;
    readonly linkageSubject: HouseholdPersonLinkageSubject;
    readonly now: number;
    readonly payload: TransitionHouseholdPersonPayload;
    readonly personId: typeof HouseholdPersonId.Type;
  }) => Effect.Effect<Person, Failure>;
  readonly restoreReturningAdultLink: (input: {
    readonly actorId: HouseholdPeopleAuditActorId;
    readonly linkageSubject: HouseholdPersonLinkageSubject;
    readonly now: number;
    readonly payload: RestoreReturningAdultLinkPayload;
  }) => Effect.Effect<Person, Failure>;
  readonly retryMemberDeparture: (input: {
    readonly actorId: HouseholdPeopleAuditActorId;
    readonly callerIsOwner: boolean;
    readonly callerLinkageSubject: HouseholdPersonLinkageSubject;
    readonly now: number;
    readonly operationId: typeof HouseholdMemberDepartureOperationId.Type;
    readonly payload: RetryMemberDeparturePayload;
    readonly targetLinkageSubject: HouseholdPersonLinkageSubject | null;
  }) => Effect.Effect<typeof HouseholdMemberDepartureStart.Type, Failure>;
  readonly startMemberDeparture: (input: {
    readonly callerIsOwner: boolean;
    readonly callerLinkageSubject: HouseholdPersonLinkageSubject;
    readonly expectedOperationVersion: number;
    readonly now: number;
    readonly operationId: typeof HouseholdMemberDepartureOperationId.Type;
  }) => Effect.Effect<typeof HouseholdMemberDepartureStart.Type, Failure>;
}

export const makeHouseholdPeopleRepository = (
  database: EffectSQLiteDoDatabase,
  services: {
    readonly canonical: HouseholdCanonicalEncodingService;
    readonly digest: HouseholdDigestService;
    readonly identity: HouseholdIdentityGeneratorService;
  }
): HouseholdPeopleRepository => {
  const intentDigest = (intent: Schema.Json) =>
    services.canonical
      .encode(intent)
      .pipe(
        Effect.flatMap(services.digest.sha256),
        Effect.mapError(unavailable)
      );

  const creatorAssociation = () =>
    database
      .select({
        linkageSubject: householdPersonCreatorAssociations.linkageSubject,
        personId: householdPersonCreatorAssociations.personId,
      })
      .from(householdPersonCreatorAssociations)
      .where(
        eq(
          householdPersonCreatorAssociations.singletonKey,
          householdCreatorAssociationSingletonKey
        )
      )
      .limit(1)
      .pipe(
        queryFailure,
        Effect.map(([row]) => row)
      );

  const currentPersonId = (linkageSubject: HouseholdPersonLinkageSubject) =>
    database
      .select({ personId: householdPersonAccountLinks.personId })
      .from(householdPersonAccountLinks)
      .where(
        and(
          eq(householdPersonAccountLinks.linkageSubject, linkageSubject),
          eq(householdPersonAccountLinks.state, "linked")
        )
      )
      .limit(1)
      .pipe(
        queryFailure,
        Effect.map(([link]) => link?.personId ?? null)
      );

  const personAssociation = (
    connection: EffectSQLiteDoDatabase,
    personId: string
  ) =>
    Effect.gen(function* readPersonAssociation() {
      const [link] = yield* connection
        .select({
          state: householdPersonAccountLinks.state,
          version: householdPersonAccountLinks.version,
        })
        .from(householdPersonAccountLinks)
        .where(
          and(
            eq(householdPersonAccountLinks.personId, personId),
            inArray(householdPersonAccountLinks.state, [
              "linked",
              "departure_pending",
            ])
          )
        )
        .limit(1)
        .pipe(queryFailure);
      if (link !== undefined) {
        return {
          state: link.state,
          version: yield* Schema.decodeUnknownEffect(
            HouseholdAssociationVersion
          )(link.version).pipe(Effect.mapError(unavailable)),
        };
      }
      const [invitation] = yield* connection
        .select({
          state: householdPersonInvitationAssociations.state,
          version: householdPersonInvitationAssociations.version,
        })
        .from(householdPersonInvitationAssociations)
        .where(
          and(
            eq(householdPersonInvitationAssociations.personId, personId),
            eq(householdPersonInvitationAssociations.state, "pending")
          )
        )
        .limit(1)
        .pipe(queryFailure);
      if (invitation !== undefined) {
        return {
          state: "invitation_pending" as const,
          version: yield* Schema.decodeUnknownEffect(
            HouseholdAssociationVersion
          )(invitation.version).pipe(Effect.mapError(unavailable)),
        };
      }
      const [detached] = yield* connection
        .select({ version: householdPersonAccountLinks.version })
        .from(householdPersonAccountLinks)
        .where(
          and(
            eq(householdPersonAccountLinks.personId, personId),
            eq(householdPersonAccountLinks.state, "detached")
          )
        )
        .limit(1)
        .pipe(queryFailure);
      return detached === undefined
        ? { state: "unlinked" as const, version: null }
        : {
            state: "detached" as const,
            version: yield* Schema.decodeUnknownEffect(
              HouseholdAssociationVersion
            )(detached.version).pipe(Effect.mapError(unavailable)),
          };
    });

  const activeLinkForPerson = (
    connection: EffectSQLiteDoDatabase,
    personId: string
  ) =>
    connection
      .select()
      .from(householdPersonAccountLinks)
      .where(
        and(
          eq(householdPersonAccountLinks.personId, personId),
          inArray(householdPersonAccountLinks.state, [
            "linked",
            "departure_pending",
          ])
        )
      )
      .limit(1)
      .pipe(
        queryFailure,
        Effect.map(([row]) => row)
      );

  const activeLinkForSubject = (
    connection: EffectSQLiteDoDatabase,
    linkageSubject: HouseholdPersonLinkageSubject
  ) =>
    connection
      .select()
      .from(householdPersonAccountLinks)
      .where(
        and(
          eq(householdPersonAccountLinks.linkageSubject, linkageSubject),
          inArray(householdPersonAccountLinks.state, [
            "linked",
            "departure_pending",
          ])
        )
      )
      .limit(1)
      .pipe(
        queryFailure,
        Effect.map(([row]) => row)
      );

  const activeDepartureForPerson = (
    connection: EffectSQLiteDoDatabase,
    personId: string
  ) =>
    connection
      .select()
      .from(householdMemberDepartureOperations)
      .where(
        and(
          eq(householdMemberDepartureOperations.personId, personId),
          inArray(householdMemberDepartureOperations.state, [
            "prepared",
            "revoking_access",
            "revocation_repair_required",
            "access_revoked",
            "finalization_repair_required",
          ])
        )
      )
      .limit(1)
      .pipe(
        queryFailure,
        Effect.map(([row]) => row)
      );

  const replayPersonMutation = (
    connection: EffectSQLiteDoDatabase,
    mutationId: string,
    digest: string
  ) =>
    Effect.gen(function* replayPersonMutationReceipt() {
      const [receipt] = yield* connection
        .select()
        .from(householdPersonMutationReceipts)
        .where(eq(householdPersonMutationReceipts.mutationId, mutationId))
        .limit(1)
        .pipe(queryFailure);
      if (receipt === undefined) {
        return null;
      }
      return receipt.intentDigest === digest
        ? yield* decodePerson(receipt.resultJson)
        : yield* Effect.fail(HouseholdPersonMutationCollision.make({}));
    });

  const replayDepartureMutation = (
    connection: EffectSQLiteDoDatabase,
    mutationId: string,
    digest: string
  ) =>
    Effect.gen(function* replayDepartureMutationReceipt() {
      const [receipt] = yield* connection
        .select()
        .from(householdPersonMutationReceipts)
        .where(eq(householdPersonMutationReceipts.mutationId, mutationId))
        .limit(1)
        .pipe(queryFailure);
      if (receipt === undefined) {
        return null;
      }
      return receipt.intentDigest === digest
        ? yield* decodeDeparture(receipt.resultJson)
        : yield* Effect.fail(HouseholdPersonMutationCollision.make({}));
    });

  const replayDepartureStartMutation = (
    connection: EffectSQLiteDoDatabase,
    mutationId: string,
    digest: string
  ) =>
    Effect.gen(function* replayDepartureStartMutationReceipt() {
      const [receipt] = yield* connection
        .select()
        .from(householdPersonMutationReceipts)
        .where(eq(householdPersonMutationReceipts.mutationId, mutationId))
        .limit(1)
        .pipe(queryFailure);
      if (receipt === undefined) {
        return null;
      }
      return receipt.intentDigest === digest
        ? yield* decodeDepartureStart(receipt.resultJson)
        : yield* Effect.fail(HouseholdPersonMutationCollision.make({}));
    });

  const storeMutationReceipt = (
    connection: EffectSQLiteDoDatabase,
    input: {
      readonly digest: string;
      readonly mutationId: string;
      readonly resultJson: string;
    }
  ) =>
    connection
      .insert(householdPersonMutationReceipts)
      .values({
        intentDigest: input.digest,
        mutationId: input.mutationId,
        resultJson: input.resultJson,
      })
      .pipe(queryFailure, Effect.asVoid);

  const readDepartureRow = (
    connection: EffectSQLiteDoDatabase,
    operationId: typeof HouseholdMemberDepartureOperationId.Type
  ) =>
    connection
      .select()
      .from(householdMemberDepartureOperations)
      .where(eq(householdMemberDepartureOperations.operationId, operationId))
      .limit(1)
      .pipe(
        queryFailure,
        Effect.map(([row]) => row)
      );

  const requireDepartureCaller = (
    connection: EffectSQLiteDoDatabase,
    input: {
      readonly callerIsOwner: boolean;
      readonly callerLinkageSubject: HouseholdPersonLinkageSubject;
      readonly row: typeof householdMemberDepartureOperations.$inferSelect;
    }
  ) =>
    Effect.gen(function* requireAuthorizedDepartureCaller() {
      if (input.callerIsOwner) {
        return;
      }
      const [link] = yield* connection
        .select({ linkageSubject: householdPersonAccountLinks.linkageSubject })
        .from(householdPersonAccountLinks)
        .where(eq(householdPersonAccountLinks.linkId, input.row.linkId))
        .limit(1)
        .pipe(queryFailure);
      if (link?.linkageSubject !== input.callerLinkageSubject) {
        return yield* Effect.fail(HouseholdPersonAssociationConflict.make({}));
      }
    });

  const createPerson = (input: {
    readonly actorId: HouseholdPeopleAuditActorId;
    readonly command: "bootstrap_creator" | "create";
    readonly displayName: string;
    readonly kind: "adult" | "dependant";
    readonly linkageSubject: HouseholdPersonLinkageSubject;
    readonly mutationId: string;
    readonly now: number;
  }) =>
    Effect.gen(function* createPersonTransaction() {
      const digest = yield* intentDigest({
        actorId: input.actorId,
        command: input.command,
        displayName: input.displayName,
        kind: input.kind,
        linkageSubject: input.linkageSubject,
      });
      return yield* database.transaction((transaction) =>
        Effect.gen(function* persistPerson() {
          const [receipt] = yield* transaction
            .select()
            .from(householdPersonMutationReceipts)
            .where(
              eq(householdPersonMutationReceipts.mutationId, input.mutationId)
            )
            .limit(1)
            .pipe(queryFailure);
          if (receipt !== undefined) {
            return receipt.intentDigest === digest
              ? yield* decodePerson(receipt.resultJson)
              : yield* Effect.fail(HouseholdPersonMutationCollision.make({}));
          }
          if (input.command === "bootstrap_creator") {
            const [association] = yield* transaction
              .select({
                singletonKey: householdPersonCreatorAssociations.singletonKey,
              })
              .from(householdPersonCreatorAssociations)
              .limit(1)
              .pipe(queryFailure);
            if (association !== undefined) {
              return yield* Effect.fail(
                HouseholdCreatorBootstrapConflict.make({})
              );
            }
          }
          const uuid = yield* services.identity
            .generate()
            .pipe(Effect.mapError(unavailable));
          const personId = yield* Schema.decodeUnknownEffect(HouseholdPersonId)(
            `person_${uuid}`
          ).pipe(Effect.mapError(unavailable));
          const person = yield* Schema.decodeUnknownEffect(HouseholdPerson)({
            associationState:
              input.command === "bootstrap_creator" ? "linked" : "unlinked",
            associationVersion:
              input.command === "bootstrap_creator" ? 1 : null,
            createdAtEpochMs: input.now,
            displayName: input.displayName,
            id: personId,
            isCurrentAdult: input.command === "bootstrap_creator",
            kind: input.kind,
            lifecycle: "active",
            updatedAtEpochMs: input.now,
            version: 1,
          }).pipe(Effect.mapError(unavailable));
          const resultJson = encodePerson(person);
          if (input.command === "bootstrap_creator") {
            const linkUuid = yield* services.identity
              .generate()
              .pipe(Effect.mapError(unavailable));
            const [association] = yield* transaction
              .insert(householdPersonCreatorAssociations)
              .values({
                createdAtEpochMs: input.now,
                linkageSubject: input.linkageSubject,
                personId,
                singletonKey: householdCreatorAssociationSingletonKey,
              })
              .onConflictDoNothing()
              .returning({
                singletonKey: householdPersonCreatorAssociations.singletonKey,
              })
              .pipe(queryFailure);
            if (association === undefined) {
              return yield* Effect.fail(
                HouseholdCreatorBootstrapConflict.make({})
              );
            }
            yield* transaction
              .insert(householdPersonAccountLinks)
              .values({
                createdAtEpochMs: input.now,
                linkId: `link_${linkUuid}`,
                linkageSubject: input.linkageSubject,
                personId,
                state: "linked",
                updatedAtEpochMs: input.now,
                version: 1,
              })
              .pipe(queryFailure);
          }
          yield* transaction
            .insert(householdPeople)
            .values({
              createdAtEpochMs: input.now,
              displayName: input.displayName,
              kind: input.kind,
              lifecycle: "active",
              personId,
              updatedAtEpochMs: input.now,
              version: 1,
            })
            .pipe(queryFailure);
          yield* transaction
            .insert(householdPersonAudits)
            .values({
              actorId: input.actorId,
              atEpochMs: input.now,
              command: input.command,
              nextLifecycle: "active",
              nextVersion: 1,
              personId,
              previousLifecycle: null,
            })
            .pipe(queryFailure);
          yield* transaction
            .insert(householdPersonMutationReceipts)
            .values({
              intentDigest: digest,
              mutationId: input.mutationId,
              resultJson,
            })
            .pipe(queryFailure);
          return person;
        })
      );
    }).pipe(Effect.catchTag("SqlError", () => Effect.fail(unavailable())));

  const transition = (input: {
    readonly actorId: HouseholdPeopleAuditActorId;
    readonly command: "archive" | "restore";
    readonly linkageSubject: HouseholdPersonLinkageSubject;
    readonly nextLifecycle: "active" | "archived";
    readonly now: number;
    readonly payload: TransitionHouseholdPersonPayload;
    readonly personId: typeof HouseholdPersonId.Type;
    readonly previousLifecycle: "active" | "archived";
  }) =>
    Effect.gen(function* transitionPerson() {
      const digest = yield* intentDigest({
        actorId: input.actorId,
        command: input.command,
        expectedVersion: input.payload.expectedVersion,
        personId: input.personId,
      });
      return yield* database.transaction((transaction) =>
        Effect.gen(function* persistTransition() {
          const [receipt] = yield* transaction
            .select()
            .from(householdPersonMutationReceipts)
            .where(
              eq(
                householdPersonMutationReceipts.mutationId,
                input.payload.mutationId
              )
            )
            .limit(1)
            .pipe(queryFailure);
          if (receipt !== undefined) {
            return receipt.intentDigest === digest
              ? yield* decodePerson(receipt.resultJson)
              : yield* Effect.fail(HouseholdPersonMutationCollision.make({}));
          }
          const [row] = yield* transaction
            .select()
            .from(householdPeople)
            .where(eq(householdPeople.personId, input.personId))
            .limit(1)
            .pipe(queryFailure);
          if (row === undefined) {
            return yield* Effect.fail(HouseholdPersonNotFound.make({}));
          }
          if (row.version !== input.payload.expectedVersion) {
            return yield* Effect.fail(HouseholdPersonStaleVersion.make({}));
          }
          if (row.lifecycle !== input.previousLifecycle) {
            return yield* Effect.fail(
              HouseholdPersonLifecycleConflict.make({})
            );
          }
          const association = yield* personAssociation(
            transaction,
            input.personId
          );
          if (
            input.command === "archive" &&
            association.state !== "unlinked" &&
            association.state !== "detached"
          ) {
            return yield* Effect.fail(
              HouseholdPersonAssociationConflict.make({})
            );
          }
          const linkedPersonId = yield* transaction
            .select({ personId: householdPersonAccountLinks.personId })
            .from(householdPersonAccountLinks)
            .where(
              and(
                eq(
                  householdPersonAccountLinks.linkageSubject,
                  input.linkageSubject
                ),
                eq(householdPersonAccountLinks.state, "linked")
              )
            )
            .limit(1)
            .pipe(queryFailure);
          const person = yield* projectPerson(
            {
              ...row,
              lifecycle: input.nextLifecycle,
              updatedAtEpochMs: input.now,
              version: row.version + 1,
            },
            linkedPersonId[0]?.personId ?? null,
            association
          );
          const resultJson = encodePerson(person);
          const updated = yield* transaction
            .update(householdPeople)
            .set({
              lifecycle: input.nextLifecycle,
              updatedAtEpochMs: input.now,
              version: row.version + 1,
            })
            .where(
              and(
                eq(householdPeople.personId, input.personId),
                eq(householdPeople.version, input.payload.expectedVersion),
                eq(householdPeople.lifecycle, input.previousLifecycle)
              )
            )
            .returning({ personId: householdPeople.personId })
            .pipe(queryFailure);
          if (updated.length !== 1) {
            return yield* Effect.fail(HouseholdPersonStaleVersion.make({}));
          }
          yield* transaction
            .insert(householdPersonAudits)
            .values({
              actorId: input.actorId,
              atEpochMs: input.now,
              command: input.command,
              nextLifecycle: input.nextLifecycle,
              nextVersion: row.version + 1,
              personId: input.personId,
              previousLifecycle: input.previousLifecycle,
            })
            .pipe(queryFailure);
          yield* transaction
            .insert(householdPersonMutationReceipts)
            .values({
              intentDigest: digest,
              mutationId: input.payload.mutationId,
              resultJson,
            })
            .pipe(queryFailure);
          return person;
        })
      );
    }).pipe(Effect.catchTag("SqlError", () => Effect.fail(unavailable())));

  const associateAdultInvitation = (input: {
    readonly actorId: HouseholdPeopleAuditActorId;
    readonly linkageSubject: HouseholdPersonLinkageSubject;
    readonly now: number;
    readonly payload: AssociateAdultInvitationPayload;
  }) =>
    Effect.gen(function* associateAdultInvitationCommand() {
      const digest = yield* intentDigest({
        actorId: input.actorId,
        command: "associate_invitation",
        invitationDigest: input.payload.invitationDigest,
        invitationRequestDigest: input.payload.invitationRequestDigest,
        personId: input.payload.personId,
      });
      return yield* database.transaction((transaction) =>
        Effect.gen(function* persistInvitationAssociation() {
          const [receipt] = yield* transaction
            .select()
            .from(householdPersonMutationReceipts)
            .where(
              eq(
                householdPersonMutationReceipts.mutationId,
                input.payload.mutationId
              )
            )
            .limit(1)
            .pipe(queryFailure);
          if (receipt !== undefined) {
            return receipt.intentDigest === digest
              ? yield* decodePerson(receipt.resultJson)
              : yield* Effect.fail(HouseholdPersonMutationCollision.make({}));
          }
          const [row] = yield* transaction
            .select()
            .from(householdPeople)
            .where(eq(householdPeople.personId, input.payload.personId))
            .limit(1)
            .pipe(queryFailure);
          if (row === undefined) {
            return yield* Effect.fail(HouseholdPersonNotFound.make({}));
          }
          if (row.kind !== "adult") {
            return yield* Effect.fail(
              HouseholdPersonAssociationConflict.make({})
            );
          }
          const [existingLink] = yield* transaction
            .select({ linkId: householdPersonAccountLinks.linkId })
            .from(householdPersonAccountLinks)
            .where(
              and(
                eq(householdPersonAccountLinks.personId, row.personId),
                inArray(householdPersonAccountLinks.state, [
                  "linked",
                  "departure_pending",
                ])
              )
            )
            .limit(1)
            .pipe(queryFailure);
          const [existingInvitation] = yield* transaction
            .select({
              invitationDigest:
                householdPersonInvitationAssociations.invitationDigest,
            })
            .from(householdPersonInvitationAssociations)
            .where(
              and(
                eq(
                  householdPersonInvitationAssociations.personId,
                  row.personId
                ),
                eq(householdPersonInvitationAssociations.state, "pending")
              )
            )
            .limit(1)
            .pipe(queryFailure);
          if (existingLink !== undefined || existingInvitation !== undefined) {
            return yield* Effect.fail(
              HouseholdPersonAssociationConflict.make({})
            );
          }
          const inserted = yield* transaction
            .insert(householdPersonInvitationAssociations)
            .values({
              associatedAtEpochMs: input.now,
              consumedAtEpochMs: null,
              invitationDigest: input.payload.invitationDigest,
              personId: row.personId,
              state: "pending",
              version: 1,
            })
            .onConflictDoNothing()
            .returning({
              personId: householdPersonInvitationAssociations.personId,
            })
            .pipe(queryFailure);
          if (inserted.length !== 1) {
            return yield* Effect.fail(
              HouseholdPersonAssociationConflict.make({})
            );
          }
          const [current] = yield* transaction
            .select({ personId: householdPersonAccountLinks.personId })
            .from(householdPersonAccountLinks)
            .where(
              and(
                eq(
                  householdPersonAccountLinks.linkageSubject,
                  input.linkageSubject
                ),
                eq(householdPersonAccountLinks.state, "linked")
              )
            )
            .limit(1)
            .pipe(queryFailure);
          const nextRow = {
            ...row,
            updatedAtEpochMs: input.now,
            version: row.version + 1,
          };
          const person = yield* projectPerson(
            nextRow,
            current?.personId ?? null,
            { state: "invitation_pending", version: initialAssociationVersion }
          );
          yield* transaction
            .update(householdPeople)
            .set({
              updatedAtEpochMs: input.now,
              version: nextRow.version,
            })
            .where(
              and(
                eq(householdPeople.personId, row.personId),
                eq(householdPeople.version, row.version)
              )
            )
            .pipe(queryFailure);
          yield* transaction
            .insert(householdPersonAudits)
            .values({
              actorId: input.actorId,
              atEpochMs: input.now,
              command: "associate_invitation",
              nextLifecycle: row.lifecycle,
              nextVersion: nextRow.version,
              personId: row.personId,
              previousLifecycle: row.lifecycle,
            })
            .pipe(queryFailure);
          yield* transaction
            .insert(householdPersonMutationReceipts)
            .values({
              intentDigest: digest,
              mutationId: input.payload.mutationId,
              resultJson: encodePerson(person),
            })
            .pipe(queryFailure);
          return person;
        })
      );
    }).pipe(Effect.catchTag("SqlError", () => Effect.fail(unavailable())));

  const completeAcceptedAdultLink = (input: {
    readonly actorId: HouseholdPeopleAuditActorId;
    readonly linkageSubject: HouseholdPersonLinkageSubject;
    readonly now: number;
    readonly payload: CompleteAcceptedAdultLinkPayload;
  }) =>
    Effect.gen(function* completeAcceptedAdultLinkCommand() {
      const digest = yield* intentDigest({
        actorId: input.actorId,
        command: "complete_link",
        invitationDigest: input.payload.invitationDigest,
        linkageSubject: input.linkageSubject,
      });
      return yield* database.transaction((transaction) =>
        Effect.gen(function* persistAcceptedAdultLink() {
          const [receipt] = yield* transaction
            .select()
            .from(householdPersonMutationReceipts)
            .where(
              eq(
                householdPersonMutationReceipts.mutationId,
                input.payload.mutationId
              )
            )
            .limit(1)
            .pipe(queryFailure);
          if (receipt !== undefined) {
            return receipt.intentDigest === digest
              ? yield* decodePerson(receipt.resultJson)
              : yield* Effect.fail(HouseholdPersonMutationCollision.make({}));
          }
          const [association] = yield* transaction
            .select()
            .from(householdPersonInvitationAssociations)
            .where(
              and(
                eq(
                  householdPersonInvitationAssociations.invitationDigest,
                  input.payload.invitationDigest
                ),
                eq(householdPersonInvitationAssociations.state, "pending")
              )
            )
            .limit(1)
            .pipe(queryFailure);
          if (association === undefined) {
            return yield* Effect.fail(
              HouseholdPersonAssociationConflict.make({})
            );
          }
          if (association.recipientLinkageSubject !== input.linkageSubject) {
            return yield* Effect.fail(
              HouseholdPersonAssociationConflict.make({})
            );
          }
          const [row] = yield* transaction
            .select()
            .from(householdPeople)
            .where(eq(householdPeople.personId, association.personId))
            .limit(1)
            .pipe(queryFailure);
          if (
            row === undefined ||
            row.kind !== "adult" ||
            row.lifecycle !== "active"
          ) {
            return yield* Effect.fail(
              HouseholdPersonAssociationConflict.make({})
            );
          }
          const [existingSubjectLink] = yield* transaction
            .select({ linkId: householdPersonAccountLinks.linkId })
            .from(householdPersonAccountLinks)
            .where(
              and(
                eq(
                  householdPersonAccountLinks.linkageSubject,
                  input.linkageSubject
                ),
                inArray(householdPersonAccountLinks.state, [
                  "linked",
                  "departure_pending",
                ])
              )
            )
            .limit(1)
            .pipe(queryFailure);
          const [existingPersonLink] = yield* transaction
            .select({ linkId: householdPersonAccountLinks.linkId })
            .from(householdPersonAccountLinks)
            .where(
              and(
                eq(householdPersonAccountLinks.personId, row.personId),
                inArray(householdPersonAccountLinks.state, [
                  "linked",
                  "departure_pending",
                ])
              )
            )
            .limit(1)
            .pipe(queryFailure);
          if (
            existingSubjectLink !== undefined ||
            existingPersonLink !== undefined
          ) {
            return yield* Effect.fail(
              HouseholdPersonAssociationConflict.make({})
            );
          }
          const linkUuid = yield* services.identity
            .generate()
            .pipe(Effect.mapError(unavailable));
          const inserted = yield* transaction
            .insert(householdPersonAccountLinks)
            .values({
              createdAtEpochMs: input.now,
              linkId: `link_${linkUuid}`,
              linkageSubject: input.linkageSubject,
              personId: row.personId,
              state: "linked",
              updatedAtEpochMs: input.now,
              version: 1,
            })
            .onConflictDoNothing()
            .returning({ linkId: householdPersonAccountLinks.linkId })
            .pipe(queryFailure);
          if (inserted.length !== 1) {
            return yield* Effect.fail(
              HouseholdPersonAssociationConflict.make({})
            );
          }
          const consumed = yield* transaction
            .update(householdPersonInvitationAssociations)
            .set({
              consumedAtEpochMs: input.now,
              state: "consumed",
              version: association.version + 1,
            })
            .where(
              and(
                eq(
                  householdPersonInvitationAssociations.invitationDigest,
                  association.invitationDigest
                ),
                eq(householdPersonInvitationAssociations.state, "pending"),
                eq(
                  householdPersonInvitationAssociations.version,
                  association.version
                )
              )
            )
            .returning({
              invitationDigest:
                householdPersonInvitationAssociations.invitationDigest,
            })
            .pipe(queryFailure);
          if (consumed.length !== 1) {
            return yield* Effect.fail(
              HouseholdPersonAssociationConflict.make({})
            );
          }
          const nextRow = {
            ...row,
            updatedAtEpochMs: input.now,
            version: row.version + 1,
          };
          const person = yield* projectPerson(nextRow, row.personId, {
            state: "linked",
            version: initialAssociationVersion,
          });
          yield* transaction
            .update(householdPeople)
            .set({
              updatedAtEpochMs: input.now,
              version: nextRow.version,
            })
            .where(
              and(
                eq(householdPeople.personId, row.personId),
                eq(householdPeople.version, row.version)
              )
            )
            .pipe(queryFailure);
          yield* transaction
            .insert(householdPersonAudits)
            .values({
              actorId: input.actorId,
              atEpochMs: input.now,
              command: "complete_link",
              nextLifecycle: row.lifecycle,
              nextVersion: nextRow.version,
              personId: row.personId,
              previousLifecycle: row.lifecycle,
            })
            .pipe(queryFailure);
          yield* transaction
            .insert(householdPersonMutationReceipts)
            .values({
              intentDigest: digest,
              mutationId: input.payload.mutationId,
              resultJson: encodePerson(person),
            })
            .pipe(queryFailure);
          return person;
        })
      );
    }).pipe(Effect.catchTag("SqlError", () => Effect.fail(unavailable())));

  const repairAdultAccountLink = (input: {
    readonly actorId: HouseholdPeopleAuditActorId;
    readonly linkageSubject: HouseholdPersonLinkageSubject;
    readonly now: number;
    readonly payload: RepairAdultAccountLinkPayload;
    readonly targetLinkageSubject: HouseholdPersonLinkageSubject;
  }) =>
    Effect.gen(function* repairAdultAccountLinkCommand() {
      const digest = yield* intentDigest({
        actorId: input.actorId,
        command: "repair_link",
        expectedPersonVersion: input.payload.expectedPersonVersion,
        personId: input.payload.personId,
        reason: input.payload.reason,
        targetLinkageSubject: input.targetLinkageSubject,
      });
      return yield* database.transaction((transaction) =>
        Effect.gen(function* persistAdultAccountLinkRepair() {
          const replay = yield* replayPersonMutation(
            transaction,
            input.payload.mutationId,
            digest
          );
          if (replay !== null) {
            return replay;
          }
          const [person] = yield* transaction
            .select()
            .from(householdPeople)
            .where(eq(householdPeople.personId, input.payload.personId))
            .limit(1)
            .pipe(queryFailure);
          if (person === undefined) {
            return yield* Effect.fail(HouseholdPersonNotFound.make({}));
          }
          if (person.version !== input.payload.expectedPersonVersion) {
            return yield* Effect.fail(HouseholdPersonStaleVersion.make({}));
          }
          if (person.kind !== "adult" || person.lifecycle !== "active") {
            return yield* Effect.fail(
              HouseholdPersonAssociationConflict.make({})
            );
          }
          if (
            (yield* activeDepartureForPerson(transaction, person.personId)) !==
            undefined
          ) {
            return yield* Effect.fail(
              HouseholdMemberDepartureInProgress.make({})
            );
          }
          const subjectLink = yield* activeLinkForSubject(
            transaction,
            input.targetLinkageSubject
          );
          const personLink = yield* activeLinkForPerson(
            transaction,
            person.personId
          );
          if (
            subjectLink?.state === "departure_pending" ||
            personLink?.state === "departure_pending" ||
            (subjectLink?.personId === person.personId &&
              personLink?.linkId === subjectLink.linkId)
          ) {
            return yield* Effect.fail(
              HouseholdPersonAssociationConflict.make({})
            );
          }
          const detachedLinks = [subjectLink, personLink]
            .filter(
              (
                link
              ): link is NonNullable<typeof subjectLink | typeof personLink> =>
                link !== undefined
            )
            .filter(
              (link, index, links) =>
                links.findIndex(
                  (candidate) => candidate.linkId === link.linkId
                ) === index
            );
          if (detachedLinks.length > 0) {
            yield* Effect.all(
              detachedLinks.map((link) =>
                transaction
                  .update(householdPersonAccountLinks)
                  .set({
                    state: "detached",
                    updatedAtEpochMs: input.now,
                    version: link.version + 1,
                  })
                  .where(
                    and(
                      eq(householdPersonAccountLinks.linkId, link.linkId),
                      eq(householdPersonAccountLinks.version, link.version)
                    )
                  )
                  .pipe(queryFailure, Effect.asVoid)
              )
            );
          }
          const linkUuid = yield* services.identity
            .generate()
            .pipe(Effect.mapError(unavailable));
          yield* transaction
            .insert(householdPersonAccountLinks)
            .values({
              createdAtEpochMs: input.now,
              linkId: `link_${linkUuid}`,
              linkageSubject: input.targetLinkageSubject,
              personId: person.personId,
              state: "linked",
              updatedAtEpochMs: input.now,
              version: 1,
            })
            .pipe(queryFailure);
          const nextVersion = person.version + 1;
          yield* transaction
            .update(householdPeople)
            .set({ updatedAtEpochMs: input.now, version: nextVersion })
            .where(
              and(
                eq(householdPeople.personId, person.personId),
                eq(householdPeople.version, person.version)
              )
            )
            .pipe(queryFailure);
          const actorLink =
            input.linkageSubject === input.targetLinkageSubject
              ? { personId: person.personId }
              : yield* activeLinkForSubject(transaction, input.linkageSubject);
          const result = yield* projectPerson(
            { ...person, updatedAtEpochMs: input.now, version: nextVersion },
            actorLink?.personId ?? null,
            { state: "linked", version: initialAssociationVersion }
          );
          yield* transaction
            .insert(householdPersonAudits)
            .values({
              actorId: input.actorId,
              atEpochMs: input.now,
              command: "repair_link",
              nextAssociationState: "linked",
              nextLifecycle: person.lifecycle,
              nextVersion,
              personId: person.personId,
              previousAssociationState:
                personLink === undefined ? "unlinked" : personLink.state,
              previousLifecycle: person.lifecycle,
            })
            .pipe(queryFailure);
          yield* storeMutationReceipt(transaction, {
            digest,
            mutationId: input.payload.mutationId,
            resultJson: encodePerson(result),
          });
          return result;
        })
      );
    }).pipe(Effect.catchTag("SqlError", () => Effect.fail(unavailable())));

  const prepareMemberDeparture = (input: {
    readonly actorId: HouseholdPeopleAuditActorId;
    readonly callerIsOwner: boolean;
    readonly callerLinkageSubject: HouseholdPersonLinkageSubject;
    readonly now: number;
    readonly payload: PrepareMemberDeparturePayload;
    readonly targetLinkageSubject: HouseholdPersonLinkageSubject;
  }) =>
    Effect.gen(function* prepareMemberDepartureCommand() {
      if (
        !input.callerIsOwner &&
        input.callerLinkageSubject !== input.targetLinkageSubject
      ) {
        return yield* Effect.fail(HouseholdPersonAssociationConflict.make({}));
      }
      const digest = yield* intentDigest({
        actorId: input.actorId,
        command: "prepare_departure",
        expectedLinkVersion: input.payload.expectedLinkVersion,
        expectedPersonVersion: input.payload.expectedPersonVersion,
        personId: input.payload.personId,
        reason: input.payload.reason,
        targetLinkageSubject: input.targetLinkageSubject,
      });
      return yield* database.transaction((transaction) =>
        Effect.gen(function* persistPreparedMemberDeparture() {
          const replay = yield* replayDepartureMutation(
            transaction,
            input.payload.mutationId,
            digest
          );
          if (replay !== null) {
            return replay;
          }
          const [person] = yield* transaction
            .select()
            .from(householdPeople)
            .where(eq(householdPeople.personId, input.payload.personId))
            .limit(1)
            .pipe(queryFailure);
          if (person === undefined) {
            return yield* Effect.fail(HouseholdPersonNotFound.make({}));
          }
          if (person.version !== input.payload.expectedPersonVersion) {
            return yield* Effect.fail(HouseholdPersonStaleVersion.make({}));
          }
          const link = yield* activeLinkForSubject(
            transaction,
            input.targetLinkageSubject
          );
          if (
            link === undefined ||
            link.personId !== person.personId ||
            link.state !== "linked"
          ) {
            return yield* Effect.fail(
              HouseholdPersonAssociationConflict.make({})
            );
          }
          if (link.version !== input.payload.expectedLinkVersion) {
            return yield* Effect.fail(
              HouseholdAssociationStaleVersion.make({})
            );
          }
          if (
            (yield* activeDepartureForPerson(transaction, person.personId)) !==
            undefined
          ) {
            return yield* Effect.fail(
              HouseholdMemberDepartureInProgress.make({})
            );
          }
          const operationUuid = yield* services.identity
            .generate()
            .pipe(Effect.mapError(unavailable));
          const operationId = yield* Schema.decodeUnknownEffect(
            HouseholdMemberDepartureOperationId
          )(`departure_${operationUuid}`).pipe(Effect.mapError(unavailable));
          const operationRow = {
            actorId: input.actorId,
            createdAtEpochMs: input.now,
            executionGeneration: 1,
            lastAttemptAtEpochMs: null,
            linkId: link.linkId,
            operationId,
            personId: person.personId,
            preparationMutationId: input.payload.mutationId,
            reason: input.payload.reason,
            state: "prepared" as const,
            updatedAtEpochMs: input.now,
            version: 1,
          };
          const operation = yield* projectDeparture(operationRow);
          yield* transaction
            .update(householdPersonAccountLinks)
            .set({
              state: "departure_pending",
              updatedAtEpochMs: input.now,
              version: link.version + 1,
            })
            .where(
              and(
                eq(householdPersonAccountLinks.linkId, link.linkId),
                eq(householdPersonAccountLinks.version, link.version),
                eq(householdPersonAccountLinks.state, "linked")
              )
            )
            .pipe(queryFailure);
          yield* transaction
            .update(householdPeople)
            .set({
              updatedAtEpochMs: input.now,
              version: person.version + 1,
            })
            .where(
              and(
                eq(householdPeople.personId, person.personId),
                eq(householdPeople.version, person.version)
              )
            )
            .pipe(queryFailure);
          yield* transaction
            .insert(householdMemberDepartureOperations)
            .values(operationRow)
            .pipe(queryFailure);
          yield* transaction
            .insert(householdPersonAudits)
            .values({
              actorId: input.actorId,
              atEpochMs: input.now,
              command: "prepare_departure",
              nextAssociationState: "departure_pending",
              nextLifecycle: person.lifecycle,
              nextVersion: person.version + 1,
              operationId,
              personId: person.personId,
              previousAssociationState: "linked",
              previousLifecycle: person.lifecycle,
            })
            .pipe(queryFailure);
          yield* storeMutationReceipt(transaction, {
            digest,
            mutationId: input.payload.mutationId,
            resultJson: encodeDeparture(operation),
          });
          return operation;
        })
      );
    }).pipe(Effect.catchTag("SqlError", () => Effect.fail(unavailable())));

  const getMemberDeparture = (input: {
    readonly callerIsOwner: boolean;
    readonly callerLinkageSubject: HouseholdPersonLinkageSubject;
    readonly operationId: typeof HouseholdMemberDepartureOperationId.Type;
  }) =>
    Effect.gen(function* getMemberDepartureQuery() {
      const row = yield* readDepartureRow(database, input.operationId);
      if (row === undefined) {
        return yield* Effect.fail(HouseholdPersonNotFound.make({}));
      }
      yield* requireDepartureCaller(database, { ...input, row });
      return yield* projectDeparture(row);
    });

  const getMemberDepartureByMutation = (input: {
    readonly callerIsOwner: boolean;
    readonly callerLinkageSubject: HouseholdPersonLinkageSubject;
    readonly mutationId: string;
  }) =>
    Effect.gen(function* getMemberDepartureByMutationQuery() {
      const [row] = yield* database
        .select()
        .from(householdMemberDepartureOperations)
        .where(
          eq(
            householdMemberDepartureOperations.preparationMutationId,
            input.mutationId
          )
        )
        .limit(1)
        .pipe(queryFailure);
      if (row === undefined) {
        return yield* Effect.fail(HouseholdPersonNotFound.make({}));
      }
      yield* requireDepartureCaller(database, { ...input, row });
      return yield* projectDeparture(row);
    });

  const getMemberDepartureSystem = (input: {
    readonly operationId: typeof HouseholdMemberDepartureOperationId.Type;
  }) =>
    Effect.gen(function* getMemberDepartureSystemQuery() {
      const row = yield* readDepartureRow(database, input.operationId);
      if (row === undefined) {
        return yield* Effect.fail(HouseholdPersonNotFound.make({}));
      }
      const [link] = yield* database
        .select({ linkageSubject: householdPersonAccountLinks.linkageSubject })
        .from(householdPersonAccountLinks)
        .where(eq(householdPersonAccountLinks.linkId, row.linkId))
        .limit(1)
        .pipe(queryFailure);
      if (link === undefined) {
        return yield* Effect.fail(HouseholdPeopleUnavailable.make({}));
      }
      return {
        operation: yield* projectDeparture(row),
        targetLinkageSubject: Schema.decodeUnknownSync(
          HouseholdPersonLinkageSubject
        )(link.linkageSubject),
      };
    });

  const startMemberDeparture = (input: {
    readonly callerIsOwner: boolean;
    readonly callerLinkageSubject: HouseholdPersonLinkageSubject;
    readonly expectedOperationVersion: number;
    readonly now: number;
    readonly operationId: typeof HouseholdMemberDepartureOperationId.Type;
  }) =>
    database
      .transaction((transaction) =>
        Effect.gen(function* persistMemberDepartureStart() {
          const row = yield* readDepartureRow(transaction, input.operationId);
          if (row === undefined) {
            return yield* Effect.fail(HouseholdPersonNotFound.make({}));
          }
          yield* requireDepartureCaller(transaction, { ...input, row });
          if (
            row.state === "revoking_access" &&
            row.version === input.expectedOperationVersion + 1
          ) {
            return yield* Schema.decodeUnknownEffect(
              HouseholdMemberDepartureStart
            )({
              attemptClaimed: false,
              operation: yield* projectDeparture(row),
            }).pipe(Effect.mapError(unavailable));
          }
          if (row.version !== input.expectedOperationVersion) {
            return yield* Effect.fail(
              HouseholdAssociationStaleVersion.make({})
            );
          }
          if (row.state !== "prepared") {
            return yield* Effect.fail(
              HouseholdMemberDepartureConflict.make({})
            );
          }
          const nextRow = {
            ...row,
            lastAttemptAtEpochMs: input.now,
            state: "revoking_access" as const,
            updatedAtEpochMs: input.now,
            version: row.version + 1,
          };
          const updated = yield* transaction
            .update(householdMemberDepartureOperations)
            .set(nextRow)
            .where(
              and(
                eq(
                  householdMemberDepartureOperations.operationId,
                  row.operationId
                ),
                eq(householdMemberDepartureOperations.version, row.version),
                eq(householdMemberDepartureOperations.state, "prepared")
              )
            )
            .returning({
              operationId: householdMemberDepartureOperations.operationId,
            })
            .pipe(queryFailure);
          if (updated.length !== 1) {
            return yield* Effect.fail(
              HouseholdAssociationStaleVersion.make({})
            );
          }
          const operation = yield* projectDeparture(nextRow);
          yield* transaction
            .insert(householdPersonAudits)
            .values({
              actorId: row.actorId,
              atEpochMs: input.now,
              command: "start_departure",
              nextAssociationState: "departure_pending",
              nextLifecycle: "active",
              nextVersion: nextRow.version,
              operationId: row.operationId,
              personId: row.personId,
              previousAssociationState: "departure_pending",
              previousLifecycle: "active",
            })
            .pipe(queryFailure);
          return yield* Schema.decodeUnknownEffect(
            HouseholdMemberDepartureStart
          )({ attemptClaimed: true, operation }).pipe(
            Effect.mapError(unavailable)
          );
        })
      )
      .pipe(Effect.catchTag("SqlError", () => Effect.fail(unavailable())));

  const confirmMemberAccessRevoked = (input: {
    readonly expectedOperationVersion: number;
    readonly now: number;
    readonly operationId: typeof HouseholdMemberDepartureOperationId.Type;
  }) =>
    database
      .transaction((transaction) =>
        Effect.gen(function* persistConfirmedMemberAccessRevoked() {
          const row = yield* readDepartureRow(transaction, input.operationId);
          if (row === undefined) {
            return yield* Effect.fail(HouseholdPersonNotFound.make({}));
          }
          if (
            row.state === "access_revoked" &&
            row.version === input.expectedOperationVersion + 1
          ) {
            return yield* projectDeparture(row);
          }
          if (row.version !== input.expectedOperationVersion) {
            return yield* Effect.fail(
              HouseholdAssociationStaleVersion.make({})
            );
          }
          if (row.state !== "revoking_access") {
            return yield* Effect.fail(
              HouseholdMemberDepartureConflict.make({})
            );
          }
          const nextRow = {
            ...row,
            state: "access_revoked" as const,
            updatedAtEpochMs: input.now,
            version: row.version + 1,
          };
          yield* transaction
            .update(householdMemberDepartureOperations)
            .set(nextRow)
            .where(
              and(
                eq(
                  householdMemberDepartureOperations.operationId,
                  row.operationId
                ),
                eq(householdMemberDepartureOperations.version, row.version),
                eq(householdMemberDepartureOperations.state, "revoking_access")
              )
            )
            .pipe(queryFailure);
          yield* transaction
            .insert(householdPersonAudits)
            .values({
              actorId: row.actorId,
              atEpochMs: input.now,
              command: "confirm_access_revoked",
              nextAssociationState: "departure_pending",
              nextLifecycle: "active",
              nextVersion: nextRow.version,
              operationId: row.operationId,
              personId: row.personId,
              previousAssociationState: "departure_pending",
              previousLifecycle: "active",
            })
            .pipe(queryFailure);
          return yield* projectDeparture(nextRow);
        })
      )
      .pipe(Effect.catchTag("SqlError", () => Effect.fail(unavailable())));

  const markMemberDepartureRepairRequired = (input: {
    readonly expectedOperationVersion: number;
    readonly now: number;
    readonly operationId: typeof HouseholdMemberDepartureOperationId.Type;
    readonly phase: "finalization" | "revocation";
  }) =>
    database
      .transaction((transaction) =>
        Effect.gen(function* persistMemberDepartureRepairRequired() {
          const row = yield* readDepartureRow(transaction, input.operationId);
          if (row === undefined) {
            return yield* Effect.fail(HouseholdPersonNotFound.make({}));
          }
          const expectedState =
            input.phase === "revocation" ? "revoking_access" : "access_revoked";
          const nextState:
            | "finalization_repair_required"
            | "revocation_repair_required" =
            input.phase === "revocation"
              ? "revocation_repair_required"
              : "finalization_repair_required";
          if (
            row.state === nextState &&
            row.version === input.expectedOperationVersion + 1
          ) {
            return yield* projectDeparture(row);
          }
          if (row.version !== input.expectedOperationVersion) {
            return yield* Effect.fail(
              HouseholdAssociationStaleVersion.make({})
            );
          }
          if (row.state !== expectedState) {
            return yield* Effect.fail(
              HouseholdMemberDepartureConflict.make({})
            );
          }
          const nextRow = {
            ...row,
            state: nextState,
            updatedAtEpochMs: input.now,
            version: row.version + 1,
          };
          yield* transaction
            .update(householdMemberDepartureOperations)
            .set(nextRow)
            .where(
              and(
                eq(
                  householdMemberDepartureOperations.operationId,
                  row.operationId
                ),
                eq(householdMemberDepartureOperations.version, row.version),
                eq(householdMemberDepartureOperations.state, expectedState)
              )
            )
            .pipe(queryFailure);
          yield* transaction
            .insert(householdPersonAudits)
            .values({
              actorId: row.actorId,
              atEpochMs: input.now,
              command: "repair_departure",
              nextAssociationState: "departure_pending",
              nextLifecycle: "active",
              nextVersion: nextRow.version,
              operationId: row.operationId,
              personId: row.personId,
              previousAssociationState: "departure_pending",
              previousLifecycle: "active",
            })
            .pipe(queryFailure);
          return yield* projectDeparture(nextRow);
        })
      )
      .pipe(Effect.catchTag("SqlError", () => Effect.fail(unavailable())));

  const cancelMemberDeparture = (input: {
    readonly actorId: HouseholdPeopleAuditActorId;
    readonly callerIsOwner: boolean;
    readonly callerLinkageSubject: HouseholdPersonLinkageSubject;
    readonly now: number;
    readonly operationId: typeof HouseholdMemberDepartureOperationId.Type;
    readonly payload: CancelMemberDeparturePayload;
  }) =>
    Effect.gen(function* cancelMemberDepartureCommand() {
      const digest = yield* intentDigest({
        actorId: input.actorId,
        command: "cancel_departure",
        expectedOperationVersion: input.payload.expectedOperationVersion,
        operationId: input.operationId,
      });
      return yield* database.transaction((transaction) =>
        Effect.gen(function* persistCancelledMemberDeparture() {
          const row = yield* readDepartureRow(transaction, input.operationId);
          if (row === undefined) {
            return yield* Effect.fail(HouseholdPersonNotFound.make({}));
          }
          yield* requireDepartureCaller(transaction, { ...input, row });
          const replay = yield* replayDepartureMutation(
            transaction,
            input.payload.mutationId,
            digest
          );
          if (replay !== null) {
            return replay;
          }
          if (row.version !== input.payload.expectedOperationVersion) {
            return yield* Effect.fail(
              HouseholdAssociationStaleVersion.make({})
            );
          }
          if (row.state !== "prepared") {
            return yield* Effect.fail(
              HouseholdMemberDepartureConflict.make({})
            );
          }
          const [person] = yield* transaction
            .select()
            .from(householdPeople)
            .where(eq(householdPeople.personId, row.personId))
            .limit(1)
            .pipe(queryFailure);
          const [link] = yield* transaction
            .select()
            .from(householdPersonAccountLinks)
            .where(eq(householdPersonAccountLinks.linkId, row.linkId))
            .limit(1)
            .pipe(queryFailure);
          if (
            person === undefined ||
            link === undefined ||
            link.state !== "departure_pending"
          ) {
            return yield* Effect.fail(
              HouseholdMemberDepartureConflict.make({})
            );
          }
          const nextRow = {
            ...row,
            state: "cancelled" as const,
            updatedAtEpochMs: input.now,
            version: row.version + 1,
          };
          yield* transaction
            .update(householdPersonAccountLinks)
            .set({
              state: "linked",
              updatedAtEpochMs: input.now,
              version: link.version + 1,
            })
            .where(eq(householdPersonAccountLinks.linkId, link.linkId))
            .pipe(queryFailure);
          yield* transaction
            .update(householdPeople)
            .set({
              updatedAtEpochMs: input.now,
              version: person.version + 1,
            })
            .where(eq(householdPeople.personId, person.personId))
            .pipe(queryFailure);
          yield* transaction
            .update(householdMemberDepartureOperations)
            .set(nextRow)
            .where(
              and(
                eq(
                  householdMemberDepartureOperations.operationId,
                  row.operationId
                ),
                eq(householdMemberDepartureOperations.version, row.version),
                eq(householdMemberDepartureOperations.state, "prepared")
              )
            )
            .pipe(queryFailure);
          const operation = yield* projectDeparture(nextRow);
          yield* transaction
            .insert(householdPersonAudits)
            .values({
              actorId: input.actorId,
              atEpochMs: input.now,
              command: "cancel_departure",
              nextAssociationState: "linked",
              nextLifecycle: person.lifecycle,
              nextVersion: person.version + 1,
              operationId: row.operationId,
              personId: person.personId,
              previousAssociationState: "departure_pending",
              previousLifecycle: person.lifecycle,
            })
            .pipe(queryFailure);
          yield* storeMutationReceipt(transaction, {
            digest,
            mutationId: input.payload.mutationId,
            resultJson: encodeDeparture(operation),
          });
          return operation;
        })
      );
    }).pipe(Effect.catchTag("SqlError", () => Effect.fail(unavailable())));

  const retryMemberDeparture = (input: {
    readonly actorId: HouseholdPeopleAuditActorId;
    readonly callerIsOwner: boolean;
    readonly callerLinkageSubject: HouseholdPersonLinkageSubject;
    readonly now: number;
    readonly operationId: typeof HouseholdMemberDepartureOperationId.Type;
    readonly payload: RetryMemberDeparturePayload;
    readonly targetLinkageSubject: HouseholdPersonLinkageSubject | null;
  }) =>
    Effect.gen(function* retryMemberDepartureCommand() {
      const digest = yield* intentDigest({
        actorId: input.actorId,
        command: "retry_departure",
        expectedOperationVersion: input.payload.expectedOperationVersion,
        operationId: input.operationId,
        reason: input.payload.reason,
      });
      return yield* database.transaction((transaction) =>
        Effect.gen(function* persistMemberDepartureRetry() {
          const row = yield* readDepartureRow(transaction, input.operationId);
          if (row === undefined) {
            return yield* Effect.fail(HouseholdPersonNotFound.make({}));
          }
          yield* requireDepartureCaller(transaction, { ...input, row });
          const [targetLink] = yield* transaction
            .select({
              linkageSubject: householdPersonAccountLinks.linkageSubject,
            })
            .from(householdPersonAccountLinks)
            .where(eq(householdPersonAccountLinks.linkId, row.linkId))
            .limit(1)
            .pipe(queryFailure);
          if (
            targetLink === undefined ||
            (input.targetLinkageSubject !== null &&
              targetLink.linkageSubject !== input.targetLinkageSubject)
          ) {
            return yield* Effect.fail(
              HouseholdPersonAssociationConflict.make({})
            );
          }
          const replay = yield* replayDepartureStartMutation(
            transaction,
            input.payload.mutationId,
            digest
          );
          if (replay !== null) {
            return replay;
          }
          if (row.version !== input.payload.expectedOperationVersion) {
            return yield* Effect.fail(
              HouseholdAssociationStaleVersion.make({})
            );
          }
          if (
            row.state !== "revocation_repair_required" &&
            row.state !== "finalization_repair_required"
          ) {
            return yield* Effect.fail(
              HouseholdMemberDepartureConflict.make({})
            );
          }
          const isRevocation = row.state === "revocation_repair_required";
          const nextRow = {
            ...row,
            executionGeneration: row.executionGeneration + 1,
            lastAttemptAtEpochMs: isRevocation
              ? input.now
              : row.lastAttemptAtEpochMs,
            state: isRevocation
              ? ("revoking_access" as const)
              : ("access_revoked" as const),
            updatedAtEpochMs: input.now,
            version: row.version + 1,
          };
          yield* transaction
            .update(householdMemberDepartureOperations)
            .set(nextRow)
            .where(
              and(
                eq(
                  householdMemberDepartureOperations.operationId,
                  row.operationId
                ),
                eq(householdMemberDepartureOperations.version, row.version),
                eq(householdMemberDepartureOperations.state, row.state)
              )
            )
            .pipe(queryFailure);
          const result = yield* Schema.decodeUnknownEffect(
            HouseholdMemberDepartureStart
          )({
            attemptClaimed: isRevocation,
            operation: yield* projectDeparture(nextRow),
          }).pipe(Effect.mapError(unavailable));
          yield* transaction
            .insert(householdPersonAudits)
            .values({
              actorId: input.actorId,
              atEpochMs: input.now,
              command: "retry_departure",
              nextAssociationState: "departure_pending",
              nextLifecycle: "active",
              nextVersion: nextRow.version,
              operationId: row.operationId,
              personId: row.personId,
              previousAssociationState: "departure_pending",
              previousLifecycle: "active",
            })
            .pipe(queryFailure);
          yield* storeMutationReceipt(transaction, {
            digest,
            mutationId: input.payload.mutationId,
            resultJson: encodeDepartureStart(result),
          });
          return result;
        })
      );
    }).pipe(Effect.catchTag("SqlError", () => Effect.fail(unavailable())));

  const finalizeMemberDeparture = (input: {
    readonly expectedOperationVersion: number;
    readonly now: number;
    readonly operationId: typeof HouseholdMemberDepartureOperationId.Type;
  }) =>
    database
      .transaction((transaction) =>
        Effect.gen(function* persistFinalizedMemberDeparture() {
          const row = yield* readDepartureRow(transaction, input.operationId);
          if (row === undefined) {
            return yield* Effect.fail(HouseholdPersonNotFound.make({}));
          }
          if (
            row.state === "completed" &&
            row.version === input.expectedOperationVersion + 1
          ) {
            return yield* projectDeparture(row);
          }
          if (row.version !== input.expectedOperationVersion) {
            return yield* Effect.fail(
              HouseholdAssociationStaleVersion.make({})
            );
          }
          if (row.state !== "access_revoked") {
            return yield* Effect.fail(
              HouseholdMemberDepartureConflict.make({})
            );
          }
          const [person] = yield* transaction
            .select()
            .from(householdPeople)
            .where(eq(householdPeople.personId, row.personId))
            .limit(1)
            .pipe(queryFailure);
          const [link] = yield* transaction
            .select()
            .from(householdPersonAccountLinks)
            .where(eq(householdPersonAccountLinks.linkId, row.linkId))
            .limit(1)
            .pipe(queryFailure);
          if (
            person === undefined ||
            link === undefined ||
            link.state !== "departure_pending"
          ) {
            return yield* Effect.fail(
              HouseholdMemberDepartureConflict.make({})
            );
          }
          const nextRow = {
            ...row,
            state: "completed" as const,
            updatedAtEpochMs: input.now,
            version: row.version + 1,
          };
          yield* transaction
            .update(householdPersonAccountLinks)
            .set({
              state: "detached",
              updatedAtEpochMs: input.now,
              version: link.version + 1,
            })
            .where(eq(householdPersonAccountLinks.linkId, link.linkId))
            .pipe(queryFailure);
          yield* transaction
            .update(householdPeople)
            .set({
              lifecycle: "archived",
              updatedAtEpochMs: input.now,
              version: person.version + 1,
            })
            .where(eq(householdPeople.personId, person.personId))
            .pipe(queryFailure);
          yield* transaction
            .update(householdMemberDepartureOperations)
            .set(nextRow)
            .where(
              and(
                eq(
                  householdMemberDepartureOperations.operationId,
                  row.operationId
                ),
                eq(householdMemberDepartureOperations.version, row.version),
                eq(householdMemberDepartureOperations.state, "access_revoked")
              )
            )
            .pipe(queryFailure);
          yield* transaction
            .insert(householdPersonAudits)
            .values({
              actorId: row.actorId,
              atEpochMs: input.now,
              command: "finalize_departure",
              nextAssociationState: "detached",
              nextLifecycle: "archived",
              nextVersion: person.version + 1,
              operationId: row.operationId,
              personId: row.personId,
              previousAssociationState: "departure_pending",
              previousLifecycle: person.lifecycle,
            })
            .pipe(queryFailure);
          return yield* projectDeparture(nextRow);
        })
      )
      .pipe(Effect.catchTag("SqlError", () => Effect.fail(unavailable())));

  const restoreReturningAdultLink = (input: {
    readonly actorId: HouseholdPeopleAuditActorId;
    readonly linkageSubject: HouseholdPersonLinkageSubject;
    readonly now: number;
    readonly payload: RestoreReturningAdultLinkPayload;
  }) =>
    Effect.gen(function* restoreReturningAdultLinkCommand() {
      const digest = yield* intentDigest({
        actorId: input.actorId,
        command: "restore_returning_link",
        expectedPersonVersion: input.payload.expectedPersonVersion,
        invitationDigest: input.payload.invitationDigest,
        linkageSubject: input.linkageSubject,
        personId: input.payload.personId,
      });
      return yield* database.transaction((transaction) =>
        Effect.gen(function* persistReturningAdultLink() {
          const replay = yield* replayPersonMutation(
            transaction,
            input.payload.mutationId,
            digest
          );
          if (replay !== null) {
            return replay;
          }
          const [association] = yield* transaction
            .select()
            .from(householdPersonInvitationAssociations)
            .where(
              and(
                eq(
                  householdPersonInvitationAssociations.invitationDigest,
                  input.payload.invitationDigest
                ),
                eq(
                  householdPersonInvitationAssociations.personId,
                  input.payload.personId
                ),
                eq(householdPersonInvitationAssociations.state, "pending")
              )
            )
            .limit(1)
            .pipe(queryFailure);
          const [person] = yield* transaction
            .select()
            .from(householdPeople)
            .where(eq(householdPeople.personId, input.payload.personId))
            .limit(1)
            .pipe(queryFailure);
          if (person === undefined) {
            return yield* Effect.fail(HouseholdPersonNotFound.make({}));
          }
          if (person.version !== input.payload.expectedPersonVersion) {
            return yield* Effect.fail(HouseholdPersonStaleVersion.make({}));
          }
          if (
            association === undefined ||
            association.recipientLinkageSubject !== input.linkageSubject ||
            person.kind !== "adult" ||
            person.lifecycle !== "archived" ||
            (yield* activeLinkForPerson(transaction, person.personId)) !==
              undefined ||
            (yield* activeLinkForSubject(transaction, input.linkageSubject)) !==
              undefined ||
            (yield* activeDepartureForPerson(transaction, person.personId)) !==
              undefined
          ) {
            return yield* Effect.fail(
              HouseholdPersonAssociationConflict.make({})
            );
          }
          const linkUuid = yield* services.identity
            .generate()
            .pipe(Effect.mapError(unavailable));
          const linkInserted = yield* transaction
            .insert(householdPersonAccountLinks)
            .values({
              createdAtEpochMs: input.now,
              linkId: `link_${linkUuid}`,
              linkageSubject: input.linkageSubject,
              personId: person.personId,
              state: "linked",
              updatedAtEpochMs: input.now,
              version: 1,
            })
            .onConflictDoNothing()
            .returning({ linkId: householdPersonAccountLinks.linkId })
            .pipe(queryFailure);
          if (linkInserted.length !== 1) {
            return yield* Effect.fail(
              HouseholdPersonAssociationConflict.make({})
            );
          }
          const consumed = yield* transaction
            .update(householdPersonInvitationAssociations)
            .set({
              consumedAtEpochMs: input.now,
              state: "consumed",
              version: association.version + 1,
            })
            .where(
              and(
                eq(
                  householdPersonInvitationAssociations.invitationDigest,
                  association.invitationDigest
                ),
                eq(householdPersonInvitationAssociations.state, "pending"),
                eq(
                  householdPersonInvitationAssociations.version,
                  association.version
                )
              )
            )
            .returning({
              invitationDigest:
                householdPersonInvitationAssociations.invitationDigest,
            })
            .pipe(queryFailure);
          if (consumed.length !== 1) {
            return yield* Effect.fail(
              HouseholdPersonAssociationConflict.make({})
            );
          }
          const nextVersion = person.version + 1;
          const personUpdated = yield* transaction
            .update(householdPeople)
            .set({
              lifecycle: "active",
              updatedAtEpochMs: input.now,
              version: nextVersion,
            })
            .where(
              and(
                eq(householdPeople.personId, person.personId),
                eq(householdPeople.lifecycle, "archived"),
                eq(householdPeople.version, person.version)
              )
            )
            .returning({ personId: householdPeople.personId })
            .pipe(queryFailure);
          if (personUpdated.length !== 1) {
            return yield* Effect.fail(HouseholdPersonStaleVersion.make({}));
          }
          const result = yield* projectPerson(
            {
              ...person,
              lifecycle: "active",
              updatedAtEpochMs: input.now,
              version: nextVersion,
            },
            person.personId,
            { state: "linked", version: initialAssociationVersion }
          );
          yield* transaction
            .insert(householdPersonAudits)
            .values({
              actorId: input.actorId,
              atEpochMs: input.now,
              command: "restore_returning_link",
              nextAssociationState: "linked",
              nextLifecycle: "active",
              nextVersion,
              personId: person.personId,
              previousAssociationState: "invitation_pending",
              previousLifecycle: "archived",
            })
            .pipe(queryFailure);
          yield* storeMutationReceipt(transaction, {
            digest,
            mutationId: input.payload.mutationId,
            resultJson: encodePerson(result),
          });
          return result;
        })
      );
    }).pipe(Effect.catchTag("SqlError", () => Effect.fail(unavailable())));

  return {
    archive: (input) =>
      transition({
        ...input,
        command: "archive",
        nextLifecycle: "archived",
        previousLifecycle: "active",
      }),
    associateAdultInvitation,
    bootstrapCreator: (input) =>
      createPerson({
        ...input,
        command: "bootstrap_creator",
        displayName: input.payload.displayName,
        kind: "adult",
        mutationId: input.payload.mutationId,
      }),
    cancelMemberDeparture,
    completeAcceptedAdultLink,
    confirmAdultInvitationRecipient: (input) =>
      database
        .transaction((transaction) =>
          Effect.gen(function* confirmInvitationRecipient() {
            const [association] = yield* transaction
              .select({
                recipientLinkageSubject:
                  householdPersonInvitationAssociations.recipientLinkageSubject,
                state: householdPersonInvitationAssociations.state,
                version: householdPersonInvitationAssociations.version,
              })
              .from(householdPersonInvitationAssociations)
              .where(
                eq(
                  householdPersonInvitationAssociations.invitationDigest,
                  input.invitationDigest
                )
              )
              .limit(1)
              .pipe(queryFailure);
            if (association === undefined || association.state !== "pending") {
              return yield* Effect.fail(
                HouseholdPersonAssociationConflict.make({})
              );
            }
            if (association.recipientLinkageSubject !== null) {
              return association.recipientLinkageSubject ===
                input.linkageSubject
                ? undefined
                : yield* Effect.fail(
                    HouseholdPersonAssociationConflict.make({})
                  );
            }
            const updated = yield* transaction
              .update(householdPersonInvitationAssociations)
              .set({
                recipientLinkageSubject: input.linkageSubject,
                version: association.version + 1,
              })
              .where(
                and(
                  eq(
                    householdPersonInvitationAssociations.invitationDigest,
                    input.invitationDigest
                  ),
                  eq(
                    householdPersonInvitationAssociations.version,
                    association.version
                  )
                )
              )
              .returning({
                invitationDigest:
                  householdPersonInvitationAssociations.invitationDigest,
              })
              .pipe(queryFailure);
            if (updated.length !== 1) {
              return yield* Effect.fail(
                HouseholdPersonAssociationConflict.make({})
              );
            }
          })
        )
        .pipe(Effect.catchTag("SqlError", () => Effect.fail(unavailable()))),
    confirmMemberAccessRevoked,
    create: (input) =>
      createPerson({
        ...input,
        command: "create",
        displayName: input.payload.displayName,
        kind: input.payload.kind,
        mutationId: input.payload.mutationId,
      }),
    finalizeMemberDeparture,
    get: (input) =>
      Effect.gen(function* getPerson() {
        const linked = yield* currentPersonId(input.linkageSubject);
        const [row] = yield* database
          .select()
          .from(householdPeople)
          .where(eq(householdPeople.personId, input.personId))
          .limit(1)
          .pipe(queryFailure);
        return row === undefined
          ? yield* Effect.fail(HouseholdPersonNotFound.make({}))
          : yield* projectPerson(
              row,
              linked,
              yield* personAssociation(database, row.personId)
            );
      }),
    getMemberDeparture,
    getMemberDepartureByMutation,
    getMemberDepartureSystem,
    list: (input) =>
      Effect.gen(function* listPeople() {
        const association = yield* creatorAssociation();
        const linked = yield* currentPersonId(input.linkageSubject);
        const rows = yield* (
          input.includeArchived
            ? database
                .select()
                .from(householdPeople)
                .orderBy(
                  asc(householdPeople.createdAtEpochMs),
                  asc(householdPeople.personId)
                )
            : database
                .select()
                .from(householdPeople)
                .where(eq(householdPeople.lifecycle, "active"))
                .orderBy(
                  asc(householdPeople.createdAtEpochMs),
                  asc(householdPeople.personId)
                )
        ).pipe(queryFailure);
        const people = yield* Effect.all(
          rows.map((row) =>
            personAssociation(database, row.personId).pipe(
              Effect.flatMap((personAssociationState) =>
                projectPerson(row, linked, personAssociationState)
              )
            )
          )
        );
        return yield* Schema.decodeUnknownEffect(HouseholdPeopleRoster)({
          creatorSlot: association === undefined ? "available" : "occupied",
          currentPersonId: linked,
          people,
        }).pipe(Effect.mapError(unavailable));
      }),
    markMemberDepartureRepairRequired,
    prepareMemberDeparture,
    repairAdultAccountLink,
    restore: (input) =>
      transition({
        ...input,
        command: "restore",
        nextLifecycle: "active",
        previousLifecycle: "archived",
      }),
    restoreReturningAdultLink,
    retryMemberDeparture,
    startMemberDeparture,
  };
};

/** Receipt presence permits safe command replay; the command still checks its original intent digest. */
export const hasHouseholdPersonMutationReceipt = (
  database: EffectSQLiteDoDatabase,
  mutationId: string
) =>
  database
    .select({ mutationId: householdPersonMutationReceipts.mutationId })
    .from(householdPersonMutationReceipts)
    .where(eq(householdPersonMutationReceipts.mutationId, mutationId))
    .limit(1)
    .pipe(
      queryFailure,
      Effect.map((rows) => rows.length === 1)
    );

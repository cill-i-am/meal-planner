import {
  HouseholdCreatorBootstrapConflict,
  HouseholdPeopleRoster,
  HouseholdPeopleUnavailable,
  HouseholdPerson,
  HouseholdPersonId,
  HouseholdPersonLifecycleConflict,
  HouseholdPersonMutationCollision,
  HouseholdPersonNotFound,
  HouseholdPersonStaleVersion,
} from "@meal-planner/household-api";
import type {
  BootstrapHouseholdCreatorPayload,
  CreateHouseholdPersonPayload,
  HouseholdPeopleAuditActorId,
  HouseholdPeopleFailure,
  HouseholdPersonLinkageSubject,
  TransitionHouseholdPersonPayload,
} from "@meal-planner/household-api";
import { and, asc, eq } from "drizzle-orm";
import type { EffectSQLiteDoDatabase } from "drizzle-orm/effect-sqlite-do";
import { Effect, Schema } from "effect";

import {
  householdPeople,
  householdPersonAudits,
  householdPersonCreatorAssociations,
  householdPersonMutationReceipts,
} from "../household.database-schema.js";
import type {
  HouseholdCanonicalEncodingService,
  HouseholdDigestService,
  HouseholdIdentityGeneratorService,
} from "../shared-kernel/authority-services.js";

type Person = typeof HouseholdPerson.Type;
type Failure = HouseholdPeopleFailure;

const PersistedPerson = Schema.fromJsonString(HouseholdPerson);
const encodePerson = Schema.encodeSync(PersistedPerson);

const unavailable = () => HouseholdPeopleUnavailable.make({});

const queryFailure = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.mapError(unavailable));

const decodePerson = (value: string) =>
  Schema.decodeUnknownEffect(PersistedPerson)(value).pipe(
    Effect.mapError(unavailable)
  );

const projectPerson = (
  row: typeof householdPeople.$inferSelect,
  currentPersonId: string | null
) =>
  Schema.decodeUnknownEffect(HouseholdPerson)({
    createdAtEpochMs: row.createdAtEpochMs,
    displayName: row.displayName,
    id: row.personId,
    isCurrentAdult: row.personId === currentPersonId,
    kind: row.kind,
    lifecycle: row.lifecycle,
    updatedAtEpochMs: row.updatedAtEpochMs,
    version: row.version,
  }).pipe(Effect.mapError(unavailable));

export interface HouseholdPeopleRepository {
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
  readonly restore: (input: {
    readonly actorId: HouseholdPeopleAuditActorId;
    readonly linkageSubject: HouseholdPersonLinkageSubject;
    readonly now: number;
    readonly payload: TransitionHouseholdPersonPayload;
    readonly personId: typeof HouseholdPersonId.Type;
  }) => Effect.Effect<Person, Failure>;
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

  const currentPersonId = (linkageSubject: HouseholdPersonLinkageSubject) =>
    database
      .select({ personId: householdPersonCreatorAssociations.personId })
      .from(householdPersonCreatorAssociations)
      .where(
        eq(householdPersonCreatorAssociations.linkageSubject, linkageSubject)
      )
      .limit(1)
      .pipe(
        queryFailure,
        Effect.map(([row]) => row?.personId ?? null)
      );

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
      const uuid = yield* services.identity
        .generate()
        .pipe(Effect.mapError(unavailable));
      const personId = yield* Schema.decodeUnknownEffect(HouseholdPersonId)(
        `person_${uuid}`
      ).pipe(Effect.mapError(unavailable));
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
              .select()
              .from(householdPersonCreatorAssociations)
              .where(
                eq(
                  householdPersonCreatorAssociations.linkageSubject,
                  input.linkageSubject
                )
              )
              .limit(1)
              .pipe(queryFailure);
            if (association !== undefined) {
              return yield* Effect.fail(
                HouseholdCreatorBootstrapConflict.make({})
              );
            }
          }
          const person = yield* Schema.decodeUnknownEffect(HouseholdPerson)({
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
          if (input.command === "bootstrap_creator") {
            yield* transaction
              .insert(householdPersonCreatorAssociations)
              .values({
                createdAtEpochMs: input.now,
                linkageSubject: input.linkageSubject,
                personId,
              })
              .pipe(queryFailure);
          }
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
          const linkedPersonId = yield* transaction
            .select({ personId: householdPersonCreatorAssociations.personId })
            .from(householdPersonCreatorAssociations)
            .where(
              eq(
                householdPersonCreatorAssociations.linkageSubject,
                input.linkageSubject
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
            linkedPersonId[0]?.personId ?? null
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

  return {
    archive: (input) =>
      transition({
        ...input,
        command: "archive",
        nextLifecycle: "archived",
        previousLifecycle: "active",
      }),
    bootstrapCreator: (input) =>
      createPerson({
        ...input,
        command: "bootstrap_creator",
        displayName: input.payload.displayName,
        kind: "adult",
        mutationId: input.payload.mutationId,
      }),
    create: (input) =>
      createPerson({
        ...input,
        command: "create",
        displayName: input.payload.displayName,
        kind: input.payload.kind,
        mutationId: input.payload.mutationId,
      }),
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
          : yield* projectPerson(row, linked);
      }),
    list: (input) =>
      Effect.gen(function* listPeople() {
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
          rows.map((row) => projectPerson(row, linked))
        );
        return yield* Schema.decodeUnknownEffect(HouseholdPeopleRoster)({
          currentPersonId: linked,
          people,
        }).pipe(Effect.mapError(unavailable));
      }),
    restore: (input) =>
      transition({
        ...input,
        command: "restore",
        nextLifecycle: "active",
        previousLifecycle: "archived",
      }),
  };
};

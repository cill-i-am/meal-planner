import {
  InterviewProfileOutcome,
  HouseholdProfileRejected,
  HouseholdPersonId,
  PersonProfile,
  ProfileFactId,
  ProfileVersion,
} from "@meal-planner/household-api";
import type {
  HouseholdPeoplePrincipal,
  MutatePersonProfilePayload,
  ProfileVersionPage,
} from "@meal-planner/household-api";
import { and, desc, eq, lt } from "drizzle-orm";
import type { EffectSQLiteDoDatabase } from "drizzle-orm/effect-sqlite-do";
import { Effect, Schema } from "effect";

import {
  householdPeople,
  householdPersonAccountLinks,
  householdProfileVersions,
  householdInterviewProfileReceipts,
} from "../household.database-schema.js";
import type {
  HouseholdCanonicalEncodingService,
  HouseholdDigestService,
  HouseholdIdentityGeneratorService,
} from "../shared-kernel/authority-services.js";
import { applyProfileCommand } from "./household-profile.transitions.js";

type Failure = HouseholdProfileRejected;
type Actor = Pick<HouseholdPeoplePrincipal, "actorId" | "linkageSubject">;
type Reader = Pick<EffectSQLiteDoDatabase, "select">;
const reject = (reason: Failure["reason"]) =>
  new HouseholdProfileRejected({ reason });
const unavailable = () => reject("profile_unavailable");
const decodeSnapshot = Schema.decodeUnknownEffect(
  Schema.fromJsonString(PersonProfile)
);
const encodeSnapshot = Schema.encodeSync(Schema.fromJsonString(PersonProfile));

const activeAdult = (database: Reader, actor: Actor) =>
  Effect.gen(function* activeAdultEffect() {
    const [person] = yield* database
      .select({
        id: householdPeople.personId,
      })
      .from(householdPersonAccountLinks)
      .innerJoin(
        householdPeople,
        eq(householdPeople.personId, householdPersonAccountLinks.personId)
      )
      .where(
        and(
          eq(householdPersonAccountLinks.linkageSubject, actor.linkageSubject),
          eq(householdPersonAccountLinks.state, "linked"),
          eq(householdPeople.kind, "adult"),
          eq(householdPeople.lifecycle, "active")
        )
      )
      .limit(1)
      .pipe(Effect.mapError(unavailable));
    if (person === undefined) {
      return yield* Effect.fail(reject("adult_required"));
    }
    return yield* Schema.decodeUnknownEffect(HouseholdPersonId)(person.id).pipe(
      Effect.mapError(unavailable)
    );
  });

const targetPerson = (database: Reader, personId: HouseholdPersonId) =>
  Effect.gen(function* targetPersonEffect() {
    const [person] = yield* database
      .select()
      .from(householdPeople)
      .where(eq(householdPeople.personId, personId))
      .limit(1)
      .pipe(Effect.mapError(unavailable));
    if (person === undefined) {
      return yield* Effect.fail(reject("person_not_found"));
    }
    return person;
  });

const current = (database: Reader, personId: HouseholdPersonId) =>
  Effect.gen(function* currentEffect() {
    const [row] = yield* database
      .select()
      .from(householdProfileVersions)
      .where(eq(householdProfileVersions.personId, personId))
      .orderBy(desc(householdProfileVersions.version))
      .limit(1)
      .pipe(Effect.mapError(unavailable));
    return row === undefined
      ? { audit: null, facts: [], personId, version: ProfileVersion.make(0) }
      : yield* decodeSnapshot(row.snapshotJson).pipe(
          Effect.mapError(unavailable)
        );
  });

interface MutationInput {
  readonly actor: Actor;
  readonly personId: HouseholdPersonId;
  readonly payload: MutatePersonProfilePayload;
  readonly now: number;
}

export const makeHouseholdProfileRepository = (
  database: EffectSQLiteDoDatabase,
  services: {
    readonly canonical: HouseholdCanonicalEncodingService;
    readonly digest: HouseholdDigestService;
    readonly identity: HouseholdIdentityGeneratorService;
  }
) => {
  const get = (input: {
    readonly actor: Actor;
    readonly personId: HouseholdPersonId;
    readonly version: ProfileVersion | null;
  }) =>
    database
      .transaction((transaction) =>
        Effect.gen(function* getEffect() {
          yield* activeAdult(transaction, input.actor);
          yield* targetPerson(transaction, input.personId);
          if (input.version !== null) {
            if (input.version === 0) {
              return {
                audit: null,
                facts: [],
                personId: input.personId,
                version: input.version,
              };
            }
            const [row] = yield* transaction
              .select()
              .from(householdProfileVersions)
              .where(
                and(
                  eq(householdProfileVersions.personId, input.personId),
                  eq(householdProfileVersions.version, input.version)
                )
              )
              .limit(1)
              .pipe(Effect.mapError(unavailable));
            if (row === undefined) {
              return yield* Effect.fail(reject("fact_not_found"));
            }
            return yield* decodeSnapshot(row.snapshotJson).pipe(
              Effect.mapError(unavailable)
            );
          }
          return yield* current(transaction, input.personId);
        })
      )
      .pipe(Effect.catchTag("SqlError", () => Effect.fail(unavailable())));

  const listVersions = (input: {
    readonly actor: Actor;
    readonly personId: HouseholdPersonId;
    readonly beforeVersion: number | null;
  }): Effect.Effect<ProfileVersionPage, Failure> =>
    database
      .transaction((transaction) =>
        Effect.gen(function* listVersionsEffect() {
          yield* activeAdult(transaction, input.actor);
          yield* targetPerson(transaction, input.personId);
          const rows = yield* transaction
            .select()
            .from(householdProfileVersions)
            .where(
              and(
                eq(householdProfileVersions.personId, input.personId),
                input.beforeVersion === null
                  ? undefined
                  : lt(householdProfileVersions.version, input.beforeVersion)
              )
            )
            .orderBy(desc(householdProfileVersions.version))
            .limit(21)
            .pipe(Effect.mapError(unavailable));
          const versions = yield* Effect.forEach(rows.slice(0, 20), (row) =>
            decodeSnapshot(row.snapshotJson).pipe(Effect.mapError(unavailable))
          );
          const last = versions.at(-1);
          return {
            nextBeforeVersion:
              rows.length > 20 && last !== undefined ? last.version : null,
            versions,
          };
        })
      )
      .pipe(Effect.catchTag("SqlError", () => Effect.fail(unavailable())));

  type Transaction = Parameters<
    Parameters<EffectSQLiteDoDatabase["transaction"]>[0]
  >[0];
  const commit = (
    transaction: Transaction,
    input: MutationInput,
    digest: string,
    source: "manual_ui" | "interview"
  ) =>
    Effect.gen(function* commitProfileVersion() {
      const actorPersonId = yield* activeAdult(transaction, input.actor);
      if (source === "interview" && actorPersonId !== input.personId) {
        return yield* Effect.fail(reject("self_required"));
      }
      const person = yield* targetPerson(transaction, input.personId);
      const [receipt] = yield* transaction
        .select()
        .from(householdProfileVersions)
        .where(
          eq(householdProfileVersions.mutationId, input.payload.mutationId)
        )
        .limit(1)
        .pipe(Effect.mapError(unavailable));
      if (receipt !== undefined) {
        if (receipt.intentDigest !== digest) {
          return yield* Effect.fail(reject("mutation_collision"));
        }
        return yield* decodeSnapshot(receipt.snapshotJson).pipe(
          Effect.mapError(unavailable)
        );
      }
      if (person.lifecycle !== "active") {
        return yield* Effect.fail(reject("person_archived"));
      }
      const previous = yield* current(transaction, input.personId);
      if (previous.version !== input.payload.expectedProfileVersion) {
        return yield* Effect.fail(reject("stale_version"));
      }
      const version = ProfileVersion.make(previous.version + 1);
      const { command } = input.payload;
      const uuid = yield* services.identity
        .generate()
        .pipe(Effect.mapError(unavailable));
      const facts = yield* applyProfileCommand(previous.facts, command, {
        actorId: input.actor.actorId,
        actorPersonId,
        factId: ProfileFactId.make(`fact_${uuid}`),
        now: input.now,
        personId: input.personId,
        personKind: person.kind,
        source,
        version,
      });
      const result = yield* Schema.decodeUnknownEffect(PersonProfile)({
        audit: {
          actorId: input.actor.actorId,
          actorPersonId,
          after:
            facts.find((fact) => fact.updatedInVersion === version) ?? null,
          atEpochMs: input.now,
          before:
            "factId" in command
              ? (previous.facts.find((fact) => fact.id === command.factId) ??
                null)
              : null,
          command,
          nextVersion: version,
          previousVersion: previous.version,
          source,
        },
        facts,
        personId: input.personId,
        version,
      }).pipe(Effect.mapError(unavailable));
      yield* transaction
        .insert(householdProfileVersions)
        .values({
          intentDigest: digest,
          mutationId: input.payload.mutationId,
          personId: input.personId,
          snapshotJson: encodeSnapshot(result),
          version,
        })
        .pipe(Effect.mapError(unavailable));
      return result;
    });
  const intentDigest = (
    input: MutationInput,
    source: "manual_ui" | "interview"
  ) => {
    const intent = {
      actor: input.actor,
      payload: input.payload,
      personId: input.personId,
    };
    return services.canonical
      .encode(source === "interview" ? { ...intent, source } : intent)
      .pipe(
        Effect.flatMap((canonical) => services.digest.sha256(canonical)),
        Effect.mapError(unavailable)
      );
  };

  const mutate = (
    input: MutationInput
  ): Effect.Effect<PersonProfile, Failure> =>
    Effect.gen(function* mutateEffect() {
      const digest = yield* intentDigest(input, "manual_ui");
      return yield* database
        .transaction((transaction) =>
          Effect.gen(function* manualMutation() {
            const [interviewReceipt] = yield* transaction
              .select()
              .from(householdInterviewProfileReceipts)
              .where(
                eq(
                  householdInterviewProfileReceipts.mutationId,
                  input.payload.mutationId
                )
              )
              .limit(1)
              .pipe(Effect.mapError(unavailable));
            if (interviewReceipt !== undefined) {
              return yield* Effect.fail(reject("mutation_collision"));
            }
            return yield* commit(transaction, input, digest, "manual_ui");
          })
        )
        .pipe(Effect.catchTag("SqlError", () => Effect.fail(unavailable())));
    });

  const mutateInterview = (
    input: MutationInput
  ): Effect.Effect<InterviewProfileOutcome, Failure> =>
    Effect.gen(function* interviewMutation() {
      const digest = yield* intentDigest(input, "interview");
      return yield* database
        .transaction((transaction) =>
          Effect.gen(function* sealInterviewOutcome() {
            const [receipt] = yield* transaction
              .select()
              .from(householdInterviewProfileReceipts)
              .where(
                eq(
                  householdInterviewProfileReceipts.mutationId,
                  input.payload.mutationId
                )
              )
              .limit(1)
              .pipe(Effect.mapError(unavailable));
            if (receipt !== undefined) {
              const actorPersonId = yield* activeAdult(
                transaction,
                input.actor
              );
              if (actorPersonId !== input.personId) {
                return yield* Effect.fail(reject("self_required"));
              }
              if (receipt.intentDigest !== digest) {
                return {
                  reason: "mutation_collision" as const,
                  type: "rejected" as const,
                };
              }
              return yield* Schema.decodeUnknownEffect(
                Schema.fromJsonString(InterviewProfileOutcome)
              )(receipt.outcomeJson).pipe(Effect.mapError(unavailable));
            }
            // An existing version already seals this mutation ID. A collision must not
            // reserve a second receipt that shadows the original manual command.
            const [versionReceipt] = yield* transaction
              .select()
              .from(householdProfileVersions)
              .where(
                eq(
                  householdProfileVersions.mutationId,
                  input.payload.mutationId
                )
              )
              .limit(1)
              .pipe(Effect.mapError(unavailable));
            if (versionReceipt !== undefined) {
              const actorPersonId = yield* activeAdult(
                transaction,
                input.actor
              );
              if (actorPersonId !== input.personId) {
                return yield* Effect.fail(reject("self_required"));
              }
              if (versionReceipt.intentDigest !== digest) {
                return {
                  reason: "mutation_collision" as const,
                  type: "rejected" as const,
                };
              }
              const profile = yield* decodeSnapshot(
                versionReceipt.snapshotJson
              ).pipe(Effect.mapError(unavailable));
              return {
                profileVersion: profile.version,
                type: "committed" as const,
              };
            }
            const outcome = yield* commit(
              transaction,
              input,
              digest,
              "interview"
            ).pipe(
              Effect.map((profile): InterviewProfileOutcome => ({
                profileVersion: profile.version,
                type: "committed",
              })),
              Effect.catchTag("HouseholdProfileRejected", (failure) =>
                failure.reason === "profile_unavailable"
                  ? Effect.fail(failure)
                  : Effect.succeed<InterviewProfileOutcome>({
                      reason: failure.reason,
                      type: "rejected",
                    })
              )
            );
            yield* transaction
              .insert(householdInterviewProfileReceipts)
              .values({
                intentDigest: digest,
                mutationId: input.payload.mutationId,
                outcomeJson: Schema.encodeSync(
                  Schema.fromJsonString(InterviewProfileOutcome)
                )(outcome),
              })
              .pipe(Effect.mapError(unavailable));
            return outcome;
          })
        )
        .pipe(Effect.catchTag("SqlError", () => Effect.fail(unavailable())));
    });
  return { get, listVersions, mutate, mutateInterview };
};

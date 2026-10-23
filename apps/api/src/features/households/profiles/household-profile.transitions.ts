import { HouseholdProfileRejected } from "@meal-planner/household-api";
import type {
  HouseholdPeopleAuditActorId,
  HouseholdPersonId,
  ProfileCommand,
  RecordedProfileCommand,
  ProfileFact,
  ProfileFactId,
  ProfileFactStanding,
  ProfileFactValue,
  ProfileVersion,
} from "@meal-planner/household-api";
import { Effect } from "effect";

interface ProfileChangeContext {
  readonly actorId: HouseholdPeopleAuditActorId;
  readonly actorPersonId: HouseholdPersonId;
  readonly factId: ProfileFactId;
  readonly now: number;
  readonly personId: HouseholdPersonId;
  readonly personKind: "adult" | "dependant";
  readonly version: ProfileVersion;
  readonly source: ProfileFact["source"];
}

const reject = (reason: HouseholdProfileRejected["reason"]) =>
  Effect.fail(new HouseholdProfileRejected({ reason }));
const changeStanding = (
  context: Pick<
    ProfileChangeContext,
    "actorPersonId" | "personId" | "personKind"
  >
): ProfileFactStanding => {
  if (context.actorPersonId === context.personId) {
    return { _tag: "confirmed", basis: "self" };
  }
  return context.personKind === "dependant"
    ? { _tag: "confirmed", basis: "household_adult" }
    : { _tag: "provisional" };
};

/** Freeze durable intent; interview commands remain self-scoped across admission changes. */
export const recordProfileCommand = (
  command: ProfileCommand,
  context: Pick<
    ProfileChangeContext,
    "actorPersonId" | "personId" | "personKind" | "source"
  >
): Effect.Effect<RecordedProfileCommand, HouseholdProfileRejected> => {
  const standing: ProfileFactStanding =
    context.source === "interview"
      ? { _tag: "confirmed", basis: "self" }
      : changeStanding(context);
  switch (command._tag) {
    case "AddProfileFact": {
      if (standing._tag === "provisional") {
        return command.fact._tag === "NoKnownHardConstraints"
          ? reject("safety_confirmation_required")
          : Effect.succeed({
              _tag: "AddProvisionalProfileFact",
              fact: command.fact,
            });
      }
      return Effect.succeed({
        _tag: "AddConfirmedProfileFact",
        basis: standing.basis,
        fact: command.fact,
      });
    }
    case "ConfirmProfileFact": {
      return standing._tag === "provisional"
        ? reject("self_required")
        : Effect.succeed({ ...command, basis: standing.basis });
    }
    case "ConfirmHardConstraintReduction": {
      return standing._tag === "provisional"
        ? reject("self_required")
        : Effect.succeed(command);
    }
    case "ReplaceOrdinaryProfileFact":
    case "RemoveOrdinaryProfileFact": {
      return Effect.succeed(command);
    }
    default: {
      return Effect.die(command satisfies never);
    }
  }
};
const updateFact = (
  fact: ProfileFact,
  context: ProfileChangeContext
): ProfileFact => ({
  ...fact,
  source: context.source,
  updatedAtEpochMs: context.now,
  updatedBy: context.actorId,
  updatedInVersion: context.version,
});

const key = (value: ProfileFactValue): string => {
  if (value._tag === "NoKnownHardConstraints") {
    return value._tag;
  }
  const label = value.label.toLocaleLowerCase("en").replaceAll(/\s+/gu, " ");
  return value._tag === "FoodPreference"
    ? `${value._tag}:${value.targetKind}:${label}`
    : `${value._tag}:${value.category}:${label}`;
};

const validateFacts = (facts: readonly ProfileFact[]) => {
  const identities = facts.map((fact) => key(fact.value));
  if (new Set(identities).size !== identities.length) {
    return reject("fact_conflict");
  }
  if (
    facts.some((fact) => fact.value._tag === "NoKnownHardConstraints") &&
    facts.some((fact) => fact.value._tag === "HardConstraint")
  ) {
    return reject("fact_conflict");
  }
  return Effect.succeed(facts);
};

const addFact = (
  facts: readonly ProfileFact[],
  command: Extract<
    RecordedProfileCommand,
    { _tag: "AddProvisionalProfileFact" | "AddConfirmedProfileFact" }
  >,
  context: ProfileChangeContext
) =>
  Effect.gen(function* addFactEffect() {
    if (
      command._tag === "AddProvisionalProfileFact" &&
      command.fact._tag === "NoKnownHardConstraints"
    ) {
      return yield* reject("safety_confirmation_required");
    }
    const standing: ProfileFactStanding =
      command._tag === "AddProvisionalProfileFact"
        ? { _tag: "provisional" }
        : changeStanding(context);
    return yield* validateFacts([
      ...facts,
      {
        createdAtEpochMs: context.now,
        createdBy: context.actorId,
        createdInVersion: context.version,
        id: context.factId,
        source: context.source,
        standing,
        updatedAtEpochMs: context.now,
        updatedBy: context.actorId,
        updatedInVersion: context.version,
        value: command.fact,
      },
    ]);
  });

const replaceFact = (
  facts: readonly ProfileFact[],
  fact: ProfileFact,
  replacement: ProfileFactValue | null,
  context: ProfileChangeContext
) =>
  validateFacts(
    replacement === null
      ? facts.filter((candidate) => candidate.id !== fact.id)
      : facts.map((candidate) =>
          candidate.id === fact.id
            ? updateFact(
                {
                  ...fact,
                  standing: changeStanding(context),
                  value: replacement,
                },
                context
              )
            : candidate
        )
  );

/** Pure household profile policy; transaction and identity allocation stay with its writer. */
export const applyProfileCommand = (
  facts: readonly ProfileFact[],
  command: RecordedProfileCommand,
  context: ProfileChangeContext
): Effect.Effect<readonly ProfileFact[], HouseholdProfileRejected> =>
  Effect.gen(function* applyProfileCommandEffect() {
    if (
      command._tag === "AddProvisionalProfileFact" ||
      command._tag === "AddConfirmedProfileFact"
    ) {
      return yield* addFact(facts, command, context);
    }
    const fact = facts.find((candidate) => candidate.id === command.factId);
    if (fact === undefined) {
      return yield* reject("fact_not_found");
    }
    switch (command._tag) {
      case "ConfirmProfileFact": {
        const standing = changeStanding(context);
        if (standing._tag === "provisional") {
          return yield* reject("self_required");
        }
        if (
          fact.standing._tag === "confirmed" &&
          fact.standing.basis === "self" &&
          standing.basis !== "self"
        ) {
          return yield* reject("fact_conflict");
        }
        return facts.map((candidate) =>
          candidate.id === fact.id
            ? updateFact({ ...fact, standing }, context)
            : candidate
        );
      }
      case "ConfirmHardConstraintReduction": {
        if (changeStanding(context)._tag === "provisional") {
          return yield* reject("self_required");
        }
        if (fact.value._tag === "FoodPreference") {
          return yield* reject("fact_conflict");
        }
        return yield* replaceFact(facts, fact, command.replacement, context);
      }
      case "RemoveOrdinaryProfileFact": {
        if (fact.value._tag !== "FoodPreference") {
          return yield* reject("safety_confirmation_required");
        }
        return yield* replaceFact(facts, fact, null, context);
      }
      case "ReplaceOrdinaryProfileFact": {
        if (fact.value._tag !== "FoodPreference") {
          return yield* reject("safety_confirmation_required");
        }
        return yield* replaceFact(facts, fact, command.fact, context);
      }
      default: {
        return yield* Effect.die(command satisfies never);
      }
    }
  });

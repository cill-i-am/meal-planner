import { HouseholdProfileRejected } from "@meal-planner/household-api";
import type {
  HouseholdPeopleAuditActorId,
  HouseholdPersonId,
  ProfileCommand,
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
}

const reject = (reason: HouseholdProfileRejected["reason"]) =>
  Effect.fail(new HouseholdProfileRejected({ reason }));
const confirmedStanding = (
  basis: "self" | "household_adult",
  context: ProfileChangeContext
): Effect.Effect<ProfileFactStanding, HouseholdProfileRejected> =>
  (
    basis === "self"
      ? context.actorPersonId !== context.personId
      : context.personKind !== "dependant"
  )
    ? reject("self_required")
    : Effect.succeed({ _tag: "confirmed", basis });

const changeStanding = (
  context: ProfileChangeContext
): ProfileFactStanding => ({
  _tag: "confirmed",
  basis:
    context.actorPersonId === context.personId ? "self" : "household_adult",
});
const updateFact = (
  fact: ProfileFact,
  context: ProfileChangeContext
): ProfileFact => ({
  ...fact,
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
    ProfileCommand,
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
        : yield* confirmedStanding(command.basis, context);
    return yield* validateFacts([
      ...facts,
      {
        createdAtEpochMs: context.now,
        createdBy: context.actorId,
        createdInVersion: context.version,
        id: context.factId,
        source: "manual_ui",
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
  command: ProfileCommand,
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
        const standing = yield* confirmedStanding(command.basis, context);
        if (
          fact.standing._tag === "confirmed" &&
          fact.standing.basis === "self" &&
          command.basis !== "self"
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

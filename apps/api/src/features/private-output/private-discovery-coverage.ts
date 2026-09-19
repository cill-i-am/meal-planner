import { HardConstraint } from "@meal-planner/household-api";
import type { ProfileFact } from "@meal-planner/household-api";
import { Data, Schema } from "effect";

import {
  assertCurrentParticipantEvidence,
  PrivateDiscoveryEvidence,
} from "./private-discovery-needs.js";
import type { PrivateDiscoveryEvidenceMessage } from "./private-discovery-needs.js";

const text = (maximum: number) =>
  Schema.String.pipe(
    Schema.check(
      Schema.isMinLength(1),
      Schema.isMaxLength(maximum),
      Schema.isTrimmed()
    )
  );
const strict = { parseOptions: { onExcessProperty: "error" as const } };
const RevisitEvidence = Schema.NullOr(PrivateDiscoveryEvidence);

export const FoodRestrictionsAnswer = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal("NoKnownHardConstraints") }),
  Schema.Struct({
    _tag: Schema.Literal("Restrictions"),
    restrictions: Schema.Array(HardConstraint).pipe(
      Schema.check(Schema.isMinLength(1), Schema.isMaxLength(10))
    ),
  }),
]).pipe(Schema.annotate({ ...strict, identifier: "FoodRestrictionsAnswer" }));
export const UsualMealsAnswer = Schema.Struct({
  description: text(600),
}).pipe(Schema.annotate({ ...strict, identifier: "UsualMealsAnswer" }));

const topicState = <S extends Schema.Constraint>(value: S) =>
  Schema.Union([
    Schema.Struct({ _tag: Schema.Literal("Unanswered") }),
    Schema.Struct({
      _tag: Schema.Literal("Answered"),
      evidence: PrivateDiscoveryEvidence,
      reopenedBy: RevisitEvidence,
      value,
    }),
    Schema.Struct({
      _tag: Schema.Literal("NoInformation"),
      evidence: PrivateDiscoveryEvidence,
      reopenedBy: RevisitEvidence,
    }),
    Schema.Struct({
      _tag: Schema.Literal("Declined"),
      evidence: PrivateDiscoveryEvidence,
    }),
  ]).pipe(Schema.annotate(strict));
const topicUpdate = <S extends Schema.Constraint>(value: S) =>
  Schema.NullOr(
    Schema.Union([
      Schema.Struct({
        _tag: Schema.Literal("RecordAnswer"),
        evidence: PrivateDiscoveryEvidence,
        revisit: RevisitEvidence,
        value,
      }),
      Schema.Struct({
        _tag: Schema.Literal("RecordNoInformation"),
        evidence: PrivateDiscoveryEvidence,
        revisit: RevisitEvidence,
      }),
      Schema.Struct({
        _tag: Schema.Literal("RecordDecline"),
        evidence: PrivateDiscoveryEvidence,
      }),
    ]).pipe(Schema.annotate(strict))
  );

/** Fixed topics exist before the model runs; the model cannot create or remove them. */
export const PrivateDiscoveryCoverage = Schema.Struct({
  foodRestrictions: topicState(FoodRestrictionsAnswer),
  usualMeals: topicState(UsualMealsAnswer),
}).pipe(Schema.annotate(strict));
export type PrivateDiscoveryCoverage = typeof PrivateDiscoveryCoverage.Type;

/** Every key is required. Null preserves the complete stored state. */
export const PrivateDiscoveryCoverageUpdates = Schema.Struct({
  foodRestrictions: topicUpdate(FoodRestrictionsAnswer),
  usualMeals: topicUpdate(UsualMealsAnswer),
}).pipe(Schema.annotate(strict));
export type PrivateDiscoveryCoverageUpdates =
  typeof PrivateDiscoveryCoverageUpdates.Type;
export type PrivateDiscoveryTopic = keyof PrivateDiscoveryCoverage;

export const emptyPrivateDiscoveryCoverage = (): PrivateDiscoveryCoverage => ({
  foodRestrictions: { _tag: "Unanswered" },
  usualMeals: { _tag: "Unanswered" },
});
export const emptyPrivateDiscoveryCoverageUpdates =
  (): PrivateDiscoveryCoverageUpdates => ({
    foodRestrictions: null,
    usualMeals: null,
  });

export class PrivateDiscoveryCoverageFailure extends Data.TaggedError(
  "PrivateDiscoveryCoverageFailure"
)<{ readonly stage: "coverage_updates" }> {}

type TopicState<T> = ReturnType<typeof topicState<Schema.Codec<T>>>["Type"];
type TopicUpdate<T> = ReturnType<typeof topicUpdate<Schema.Codec<T>>>["Type"];

const applyTopicUpdate = <T>(
  previous: TopicState<T>,
  update: TopicUpdate<T>,
  participant: PrivateDiscoveryEvidenceMessage
): TopicState<T> => {
  if (update === null) {
    return previous;
  }
  assertCurrentParticipantEvidence(update.evidence, participant);
  if (update._tag === "RecordDecline") {
    return { _tag: "Declined", evidence: update.evidence };
  }
  const wasDeclined = previous._tag === "Declined";
  if (wasDeclined !== (update.revisit !== null)) {
    throw new PrivateDiscoveryCoverageFailure({ stage: "coverage_updates" });
  }
  if (update.revisit !== null) {
    assertCurrentParticipantEvidence(update.revisit, participant);
  }
  const reopenedBy =
    update.revisit ??
    (previous._tag === "Answered" || previous._tag === "NoInformation"
      ? previous.reopenedBy
      : null);
  return update._tag === "RecordAnswer"
    ? {
        _tag: "Answered",
        evidence: update.evidence,
        reopenedBy,
        value: update.value,
      }
    : { _tag: "NoInformation", evidence: update.evidence, reopenedBy };
};

/** Provenance and legal transitions are enforced before any private state is written. */
export const applyPrivateDiscoveryCoverageUpdates = (
  current: PrivateDiscoveryCoverage,
  updates: PrivateDiscoveryCoverageUpdates,
  participant: PrivateDiscoveryEvidenceMessage
): PrivateDiscoveryCoverage => ({
  foodRestrictions: applyTopicUpdate(
    current.foodRestrictions,
    updates.foodRestrictions,
    participant
  ),
  usualMeals: applyTopicUpdate(
    current.usualMeals,
    updates.usualMeals,
    participant
  ),
});

export const privateDiscoveryTopicQuestion = (topic: PrivateDiscoveryTopic) => {
  switch (topic) {
    case "foodRestrictions": {
      return "Do you have any food allergies, intolerances or dietary restrictions?";
    }
    case "usualMeals": {
      return "What do you usually eat on a typical day?";
    }
    default: {
      return topic satisfies never;
    }
  }
};

/** Saved own-profile safety facts satisfy discovery coverage, never the reverse. */
export const profileAddressesFoodRestrictions = (
  facts: readonly Pick<ProfileFact, "value" | "standing">[]
): boolean =>
  facts.some(
    ({ value, standing }) =>
      standing._tag === "confirmed" &&
      (value._tag === "HardConstraint" ||
        value._tag === "NoKnownHardConstraints")
  );

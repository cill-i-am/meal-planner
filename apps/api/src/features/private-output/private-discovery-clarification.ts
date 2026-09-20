import { ProfileFactId } from "@meal-planner/household-api";
import type { ProfileFactValue } from "@meal-planner/household-api";
import { Data, Schema } from "effect";

import type { PrivateDiscoveryCoverage } from "./private-discovery-coverage.js";
import {
  assertCurrentParticipantEvidence,
  PrivateDiscoveryEvidence,
} from "./private-discovery-needs.js";
import type { PrivateDiscoveryEvidenceMessage } from "./private-discovery-needs.js";

const strict = { parseOptions: { onExcessProperty: "error" as const } };
const OptionalEvidence = Schema.NullOr(PrivateDiscoveryEvidence);
const Request = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal("ProfileTarget") }),
  Schema.Struct({
    _tag: Schema.Literals(["ProfileEffect", "SafetyMeaning", "SafetyHandling"]),
    factId: Schema.NullOr(ProfileFactId),
  }),
]).pipe(
  Schema.annotate({
    ...strict,
    identifier: "PrivateDiscoveryClarificationRequest",
  })
);
const retained = {
  evidence: PrivateDiscoveryEvidence,
  reopenedBy: OptionalEvidence,
  request: Request,
  safetyReopenedBy: OptionalEvidence,
};
export const PrivateDiscoveryClarification = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal("None") }),
  Schema.Struct({
    _tag: Schema.Literals([
      "Pending",
      "Answered",
      "NoInformation",
      "Declined",
      "TargetUnavailable",
    ]),
    ...retained,
  }),
]).pipe(Schema.annotate(strict));
export type PrivateDiscoveryClarification =
  typeof PrivateDiscoveryClarification.Type;
export const PrivateDiscoveryClarificationUpdate = Schema.NullOr(
  Schema.Union([
    Schema.Struct({
      _tag: Schema.Literal("Request"),
      evidence: PrivateDiscoveryEvidence,
      request: Request,
      revisit: OptionalEvidence,
      safetyRevisit: OptionalEvidence,
    }),
    Schema.Struct({
      _tag: Schema.Literals(["RecordAnswer", "RecordNoInformation"]),
      evidence: PrivateDiscoveryEvidence,
      revisit: OptionalEvidence,
    }),
    Schema.Struct({
      _tag: Schema.Literal("RecordDecline"),
      evidence: PrivateDiscoveryEvidence,
    }),
  ]).pipe(Schema.annotate(strict))
);
export class PrivateDiscoveryClarificationFailure extends Data.TaggedError(
  "PrivateDiscoveryClarificationFailure"
)<{
  readonly stage: "clarification_target" | "clarification_updates";
}> {}
type ProfileFacts = readonly {
  readonly id: typeof ProfileFactId.Type;
  readonly value: ProfileFactValue;
}[];
const isSafety = (
  request: typeof Request.Type,
  facts: ProfileFacts
): boolean => {
  if (request._tag === "ProfileTarget") {
    return false;
  }
  const fact =
    request.factId === null
      ? undefined
      : facts.find(({ id }) => id === request.factId);
  if (request.factId !== null && fact === undefined) {
    throw new PrivateDiscoveryClarificationFailure({
      stage: "clarification_target",
    });
  }
  return (
    request._tag === "SafetyMeaning" ||
    request._tag === "SafetyHandling" ||
    (fact !== undefined && fact.value._tag !== "FoodPreference")
  );
};
const requireRevisit = (
  required: boolean,
  supplied: typeof OptionalEvidence.Type,
  participant: PrivateDiscoveryEvidenceMessage
) => {
  if (required !== (supplied !== null)) {
    throw new PrivateDiscoveryClarificationFailure({
      stage: "clarification_updates",
    });
  }
  if (supplied !== null) {
    assertCurrentParticipantEvidence(supplied, participant);
  }
};

const applyClarificationUpdate = (
  previous: PrivateDiscoveryClarification,
  update: typeof PrivateDiscoveryClarificationUpdate.Type,
  participant: PrivateDiscoveryEvidenceMessage,
  facts: ProfileFacts,
  coverage: PrivateDiscoveryCoverage
): PrivateDiscoveryClarification => {
  let next = previous;
  if (update !== null) {
    assertCurrentParticipantEvidence(update.evidence, participant);
    if (update._tag === "Request") {
      if (
        previous._tag === "Pending" &&
        JSON.stringify(previous.request) !== JSON.stringify(update.request)
      ) {
        throw new PrivateDiscoveryClarificationFailure({
          stage: "clarification_updates",
        });
      }
      requireRevisit(previous._tag === "Declined", update.revisit, participant);
      requireRevisit(
        isSafety(update.request, facts) &&
          coverage.foodRestrictions._tag === "Declined",
        update.safetyRevisit,
        participant
      );
      next = {
        _tag: "Pending",
        evidence: update.evidence,
        reopenedBy:
          update.revisit ??
          (previous._tag === "None" ? null : previous.reopenedBy),
        request: update.request,
        safetyReopenedBy:
          update.safetyRevisit ??
          (previous._tag === "None" ? null : previous.safetyReopenedBy),
      };
    } else {
      if (previous._tag === "None" || previous._tag === "TargetUnavailable") {
        throw new PrivateDiscoveryClarificationFailure({
          stage: "clarification_updates",
        });
      }
      if (update._tag === "RecordDecline") {
        next = { ...previous, _tag: "Declined", evidence: update.evidence };
      } else {
        requireRevisit(
          previous._tag === "Declined",
          update.revisit,
          participant
        );
        next = {
          ...previous,
          _tag: update._tag === "RecordAnswer" ? "Answered" : "NoInformation",
          evidence: update.evidence,
          reopenedBy: update.revisit ?? previous.reopenedBy,
        };
      }
    }
  }
  return next;
};

/** Closed clarification intents cannot select an arbitrary question or reopen a refused safety topic. */
export const applyPrivateDiscoveryClarification = (
  current: PrivateDiscoveryClarification,
  update: typeof PrivateDiscoveryClarificationUpdate.Type,
  participant: PrivateDiscoveryEvidenceMessage,
  facts: ProfileFacts,
  coverage: PrivateDiscoveryCoverage,
  safetyDeclinedThisTurn: boolean
): PrivateDiscoveryClarification => {
  const pendingTarget =
    current._tag === "Pending" && current.request._tag !== "ProfileTarget"
      ? current.request.factId
      : null;
  const previous: PrivateDiscoveryClarification =
    current._tag === "Pending" &&
    pendingTarget !== null &&
    !facts.some(({ id }) => id === pendingTarget)
      ? { ...current, _tag: "TargetUnavailable" }
      : current;
  const next = applyClarificationUpdate(
    previous,
    update,
    participant,
    facts,
    coverage
  );
  if (
    safetyDeclinedThisTurn &&
    coverage.foodRestrictions._tag === "Declined" &&
    next._tag === "Pending" &&
    isSafety(next.request, facts) &&
    !(update?._tag === "Request" && update.safetyRevisit !== null)
  ) {
    return {
      ...next,
      _tag: "Declined",
      evidence: coverage.foodRestrictions.evidence,
    };
  }
  return next;
};

/** Every visible clarification question comes from this finite application policy. */
export const privateDiscoveryClarificationQuestion = (
  state: PrivateDiscoveryClarification
): string | null => {
  if (state._tag !== "Pending") {
    return null;
  }
  switch (state.request._tag) {
    case "ProfileTarget": {
      return "Does that describe your own food needs, or someone else's?";
    }
    case "ProfileEffect": {
      return "Do you want to add this to your profile, replace an existing fact, or remove a fact?";
    }
    case "SafetyMeaning": {
      return "Is that a preference, or a restriction your meals need to follow?";
    }
    case "SafetyHandling": {
      return "Should meals exclude that food, or do they need a particular adaptation?";
    }
    default: {
      return state.request satisfies never;
    }
  }
};

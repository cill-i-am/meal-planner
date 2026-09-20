import type { ProfileFact } from "@meal-planner/household-api";
import type { PrivateDiscoveryScope } from "@meal-planner/private-interview-api";
import { Data, Schema } from "effect";

import {
  applyPrivateDiscoveryClarification,
  PrivateDiscoveryClarification,
  PrivateDiscoveryClarificationUpdate,
  privateDiscoveryClarificationQuestion,
} from "./private-discovery-clarification.js";
import {
  applyPrivateDiscoveryCoverageUpdates,
  emptyPrivateDiscoveryCoverage,
  emptyPrivateDiscoveryCoverageUpdates,
  PrivateDiscoveryCoverage,
  PrivateDiscoveryCoverageUpdates,
  privateDiscoveryTopicQuestion,
  profileAddressesFoodRestrictions,
} from "./private-discovery-coverage.js";
import type { PrivateDiscoveryTopic } from "./private-discovery-coverage.js";
import { renderPrivateDiscoveryMessage } from "./private-discovery-message.js";
import type { PrivateDiscoveryReviewedProposal } from "./private-discovery-message.js";
import {
  applyMealFallbackNeedUpdates,
  assertCurrentParticipantEvidence,
  MealFallbackNeeds,
  MealFallbackNeedUpdates,
  PrivateDiscoveryEvidence,
  selectMealFallbackQuestion,
} from "./private-discovery-needs.js";
import type { PrivateDiscoveryEvidenceMessage } from "./private-discovery-needs.js";

export const PRIVATE_DISCOVERY_CONTINUITY_BYTES = 8192;
export const PRIVATE_DISCOVERY_CONTINUITY_NOTE_LIMIT = 12;
export const PRIVATE_DISCOVERY_CONTINUITY_UPDATE_LIMIT = 6;
export const PRIVATE_DISCOVERY_REPLY_LENGTH = 2000;

const NoteKey = Schema.String.pipe(
  Schema.check(Schema.isMinLength(1), Schema.isMaxLength(32))
);
export const PrivateDiscoveryContinuityNote = Schema.Struct({
  detail: Schema.String.pipe(
    Schema.check(
      Schema.isMinLength(1),
      Schema.isMaxLength(200),
      Schema.isTrimmed()
    )
  ),
  key: NoteKey,
  subject: Schema.String.pipe(
    Schema.check(
      Schema.isMinLength(1),
      Schema.isMaxLength(120),
      Schema.isTrimmed()
    )
  ),
}).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));
const continuityBytes = (continuity: typeof ContinuityState.Type) =>
  new TextEncoder().encode(JSON.stringify(continuity)).byteLength;

/** Bounded private continuity, with no household authority. */
const PrivateDiscoveryNotes = Schema.Array(PrivateDiscoveryContinuityNote).pipe(
  Schema.check(
    Schema.isMaxLength(PRIVATE_DISCOVERY_CONTINUITY_NOTE_LIMIT),
    Schema.makeFilter(
      (notes) => new Set(notes.map((note) => note.key)).size === notes.length,
      { message: "Continuity note keys must be unique" }
    )
  ),
  Schema.annotate({ parseOptions: { onExcessProperty: "error" } })
);
const ContinuityState = Schema.Struct({
  clarification: PrivateDiscoveryClarification,
  coverage: PrivateDiscoveryCoverage,
  mealFallbackNeeds: MealFallbackNeeds,
  notes: PrivateDiscoveryNotes,
});
export const PrivateDiscoveryContinuity = ContinuityState.pipe(
  Schema.check(
    Schema.makeFilter(
      (continuity) =>
        continuityBytes(continuity) <= PRIVATE_DISCOVERY_CONTINUITY_BYTES,
      { message: "Continuity exceeds its serialized byte limit" }
    )
  ),
  Schema.annotate({ parseOptions: { onExcessProperty: "error" } })
);
export type PrivateDiscoveryContinuity = typeof PrivateDiscoveryContinuity.Type;
export const PrivateDiscoveryContinuityJson = Schema.fromJsonString(
  PrivateDiscoveryContinuity
);

export const PrivateDiscoveryContinuityUpdates = Schema.Struct({
  clarification: PrivateDiscoveryClarificationUpdate,
  coverage: PrivateDiscoveryCoverageUpdates,
  mealFallbackNeeds: MealFallbackNeedUpdates,
  notes: Schema.Array(PrivateDiscoveryContinuityNote).pipe(
    Schema.check(Schema.isMaxLength(PRIVATE_DISCOVERY_CONTINUITY_UPDATE_LIMIT))
  ),
}).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));
export const emptyPrivateDiscoveryContinuity =
  (): PrivateDiscoveryContinuity => ({
    clarification: { _tag: "None" },
    coverage: emptyPrivateDiscoveryCoverage(),
    mealFallbackNeeds: [],
    notes: [],
  });
export const emptyPrivateDiscoveryContinuityUpdates =
  (): typeof PrivateDiscoveryContinuityUpdates.Type => ({
    clarification: null,
    coverage: emptyPrivateDiscoveryCoverageUpdates(),
    mealFallbackNeeds: { declarations: [], updates: [] },
    notes: [],
  });
export const PrivateDiscoveryReply = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal("Continue") }),
  Schema.Struct({
    _tag: Schema.Literal("Stop"),
    evidence: PrivateDiscoveryEvidence,
  }),
]).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));

export type PrivateDiscoveryReplyDecision =
  | {
      readonly _tag: "Ask";
      readonly question: string;
      readonly source:
        | {
            readonly _tag: "MealFallbackNeed";
            readonly needId: string;
            readonly fields: readonly (
              | "reason"
              | "acceptableOption"
              | "extraPreparation"
            )[];
          }
        | { readonly _tag: "ProfileClarification" }
        | {
            readonly _tag: "RequiredTopic";
            readonly topic: PrivateDiscoveryTopic;
          };
    }
  | { readonly _tag: "Review" }
  | { readonly _tag: "Stop" };

export class PrivateDiscoveryContinuationFailure extends Data.TaggedError(
  "PrivateDiscoveryContinuationFailure"
)<{
  readonly stage:
    | "continuity_updates"
    | "continuity_limit"
    | "reply_decision"
    | "reply_limit";
}> {}

interface DiscoveryPolicy {
  readonly scope: PrivateDiscoveryScope;
  readonly profileFacts: readonly Pick<
    ProfileFact,
    "id" | "value" | "standing"
  >[];
}
const selectDiscoveryQuestion = (
  continuity: PrivateDiscoveryContinuity,
  policy: DiscoveryPolicy
): PrivateDiscoveryReplyDecision => {
  const fallbackQuestion = selectMealFallbackQuestion(
    continuity.mealFallbackNeeds
  );
  const clarificationQuestion = privateDiscoveryClarificationQuestion(
    continuity.clarification
  );
  let decision: PrivateDiscoveryReplyDecision;
  if (clarificationQuestion !== null) {
    decision = {
      _tag: "Ask",
      question: clarificationQuestion,
      source: { _tag: "ProfileClarification" },
    };
  } else if (
    policy.scope === "InitialDiscovery" &&
    continuity.coverage.foodRestrictions._tag === "Unanswered" &&
    !profileAddressesFoodRestrictions(policy.profileFacts)
  ) {
    decision = {
      _tag: "Ask",
      question: privateDiscoveryTopicQuestion("foodRestrictions"),
      source: { _tag: "RequiredTopic", topic: "foodRestrictions" },
    };
  } else if (fallbackQuestion !== null) {
    decision = {
      _tag: "Ask",
      question: fallbackQuestion.question,
      source: {
        _tag: "MealFallbackNeed",
        fields: fallbackQuestion.fields,
        needId: fallbackQuestion.needId,
      },
    };
  } else if (
    policy.scope === "InitialDiscovery" &&
    continuity.coverage.usualMeals._tag === "Unanswered"
  ) {
    decision = {
      _tag: "Ask",
      question: privateDiscoveryTopicQuestion("usualMeals"),
      source: { _tag: "RequiredTopic", topic: "usualMeals" },
    };
  } else {
    decision = { _tag: "Review" };
  }

  return decision;
};

/** Complete updates add or replace by key; omitted notes retain their order. */
export const applyPrivateDiscoveryContinuation = (
  current: PrivateDiscoveryContinuity,
  updates: typeof PrivateDiscoveryContinuityUpdates.Type,
  reply: typeof PrivateDiscoveryReply.Type,
  participant: PrivateDiscoveryEvidenceMessage,
  proposals: readonly PrivateDiscoveryReviewedProposal[],
  policy: DiscoveryPolicy
): {
  readonly continuity: PrivateDiscoveryContinuity;
  readonly decision: PrivateDiscoveryReplyDecision;
  readonly message: string;
} => {
  if (updates.notes.length > PRIVATE_DISCOVERY_CONTINUITY_UPDATE_LIMIT) {
    throw new PrivateDiscoveryContinuationFailure({
      stage: "continuity_updates",
    });
  }
  if (reply._tag === "Stop") {
    assertCurrentParticipantEvidence(reply.evidence, participant);
    if (
      proposals.length !== 0 ||
      updates.clarification !== null ||
      updates.coverage.foodRestrictions !== null ||
      updates.coverage.usualMeals !== null ||
      updates.notes.length !== 0 ||
      updates.mealFallbackNeeds.declarations.length !== 0 ||
      updates.mealFallbackNeeds.updates.length !== 0
    ) {
      throw new PrivateDiscoveryContinuationFailure({
        stage: "reply_decision",
      });
    }
    return {
      continuity: current,
      decision: { _tag: "Stop" },
      message: renderPrivateDiscoveryMessage(
        current,
        current,
        { _tag: "Stop" },
        proposals
      ),
    };
  }
  const notes = new Map(current.notes.map((note) => [note.key, note]));
  const changed = new Set<string>();
  for (const update of updates.notes) {
    if (changed.has(update.key)) {
      throw new PrivateDiscoveryContinuationFailure({
        stage: "continuity_updates",
      });
    }
    changed.add(update.key);
    notes.set(update.key, update);
  }
  const coverage = applyPrivateDiscoveryCoverageUpdates(
    current.coverage,
    updates.coverage,
    participant
  );
  const continuity = {
    clarification: applyPrivateDiscoveryClarification(
      current.clarification,
      updates.clarification,
      participant,
      policy.profileFacts,
      coverage,
      updates.coverage.foodRestrictions?._tag === "RecordDecline"
    ),
    coverage,
    mealFallbackNeeds: applyMealFallbackNeedUpdates(
      current.mealFallbackNeeds,
      updates.mealFallbackNeeds,
      participant
    ),
    notes: [...notes.values()],
  };
  if (
    continuity.notes.length > PRIVATE_DISCOVERY_CONTINUITY_NOTE_LIMIT ||
    continuityBytes(continuity) > PRIVATE_DISCOVERY_CONTINUITY_BYTES
  ) {
    throw new PrivateDiscoveryContinuationFailure({
      stage: "continuity_limit",
    });
  }
  const decision = selectDiscoveryQuestion(continuity, policy);
  const message = renderPrivateDiscoveryMessage(
    current,
    continuity,
    decision,
    proposals
  );
  if (message.length > PRIVATE_DISCOVERY_REPLY_LENGTH) {
    throw new PrivateDiscoveryContinuationFailure({ stage: "reply_limit" });
  }
  return { continuity, decision, message };
};

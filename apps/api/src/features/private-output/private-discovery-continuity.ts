import { Data, Schema } from "effect";

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
const NoteState = Schema.Literals([
  "circumstance",
  "unresolved",
  "answered",
  "no_information",
  "declined",
  "withdrawn",
]);
const NoteDetail = Schema.String.pipe(Schema.check(Schema.isMaxLength(200)));
export const PrivateDiscoveryContinuityNote = Schema.Struct({
  detail: NoteDetail,
  key: NoteKey,
  state: NoteState,
  subject: Schema.String.pipe(
    Schema.check(Schema.isMinLength(1), Schema.isMaxLength(120))
  ),
});
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
  mealFallbackNeeds: MealFallbackNeedUpdates,
  notes: Schema.Array(PrivateDiscoveryContinuityNote).pipe(
    Schema.check(Schema.isMaxLength(PRIVATE_DISCOVERY_CONTINUITY_UPDATE_LIMIT))
  ),
}).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));
export const emptyPrivateDiscoveryContinuity =
  (): PrivateDiscoveryContinuity => ({
    mealFallbackNeeds: [],
    notes: [],
  });
export const emptyPrivateDiscoveryContinuityUpdates =
  (): typeof PrivateDiscoveryContinuityUpdates.Type => ({
    mealFallbackNeeds: { declarations: [], updates: [] },
    notes: [],
  });
const ReplyText = Schema.String.pipe(
  Schema.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(PRIVATE_DISCOVERY_REPLY_LENGTH)
  )
);
export const PrivateDiscoveryReply = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal("Continue"),
    followUp: Schema.NullOr(
      Schema.Struct({ question: ReplyText, topicKey: NoteKey })
    ),
    text: ReplyText,
  }),
  Schema.Struct({
    _tag: Schema.Literal("Stop"),
    evidence: PrivateDiscoveryEvidence,
    text: ReplyText,
  }),
]);

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
        | { readonly _tag: "Note"; readonly key: string };
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

/** Complete updates add or replace by key; omitted notes retain their order. */
export const applyPrivateDiscoveryContinuation = (
  current: PrivateDiscoveryContinuity,
  updates: typeof PrivateDiscoveryContinuityUpdates.Type,
  reply: typeof PrivateDiscoveryReply.Type,
  participant: PrivateDiscoveryEvidenceMessage
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
      updates.notes.length !== 0 ||
      updates.mealFallbackNeeds.declarations.length !== 0 ||
      updates.mealFallbackNeeds.updates.length !== 0
    ) {
      throw new PrivateDiscoveryContinuationFailure({
        stage: "reply_decision",
      });
    }
    if (reply.text.length > PRIVATE_DISCOVERY_REPLY_LENGTH) {
      throw new PrivateDiscoveryContinuationFailure({ stage: "reply_limit" });
    }
    return {
      continuity: current,
      decision: { _tag: "Stop" },
      message: reply.text,
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
  const continuity = {
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
  if (
    reply.followUp !== null &&
    notes.get(reply.followUp.topicKey)?.state !== "unresolved"
  ) {
    throw new PrivateDiscoveryContinuationFailure({ stage: "reply_decision" });
  }
  const fallbackQuestion = selectMealFallbackQuestion(
    continuity.mealFallbackNeeds
  );
  let decision: PrivateDiscoveryReplyDecision;
  if (fallbackQuestion !== null) {
    decision = {
      _tag: "Ask",
      question: fallbackQuestion.question,
      source: {
        _tag: "MealFallbackNeed",
        fields: fallbackQuestion.fields,
        needId: fallbackQuestion.needId,
      },
    };
  } else if (reply.followUp === null) {
    if (continuity.notes.some((note) => note.state === "unresolved")) {
      throw new PrivateDiscoveryContinuationFailure({
        stage: "reply_decision",
      });
    }
    decision = { _tag: "Review" };
  } else {
    decision = {
      _tag: "Ask",
      question: reply.followUp.question,
      source: { _tag: "Note", key: reply.followUp.topicKey },
    };
  }
  const message =
    decision._tag === "Ask"
      ? `${reply.text}\n\n${decision.question}`
      : reply.text;
  if (message.length > PRIVATE_DISCOVERY_REPLY_LENGTH) {
    throw new PrivateDiscoveryContinuationFailure({ stage: "reply_limit" });
  }
  return { continuity, decision, message };
};

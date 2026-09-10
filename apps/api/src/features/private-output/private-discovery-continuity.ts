import { Data, Schema } from "effect";

export const PRIVATE_DISCOVERY_CONTINUITY_BYTES = 4096;
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
const continuityBytes = (
  notes: readonly (typeof PrivateDiscoveryContinuityNote.Type)[]
) => new TextEncoder().encode(JSON.stringify(notes)).byteLength;

/** Bounded private continuity, with no household authority. */
export const PrivateDiscoveryContinuity = Schema.Array(
  PrivateDiscoveryContinuityNote
).pipe(
  Schema.check(
    Schema.isMaxLength(PRIVATE_DISCOVERY_CONTINUITY_NOTE_LIMIT),
    Schema.makeFilter(
      (notes) => new Set(notes.map((note) => note.key)).size === notes.length,
      { message: "Continuity note keys must be unique" }
    ),
    Schema.makeFilter(
      (notes) => continuityBytes(notes) <= PRIVATE_DISCOVERY_CONTINUITY_BYTES,
      { message: "Continuity exceeds its serialized byte limit" }
    )
  ),
  Schema.annotate({ parseOptions: { onExcessProperty: "error" } })
);
export type PrivateDiscoveryContinuity = typeof PrivateDiscoveryContinuity.Type;
export const PrivateDiscoveryContinuityJson = Schema.fromJsonString(
  PrivateDiscoveryContinuity
);

export const PrivateDiscoveryContinuityUpdates = Schema.Array(
  PrivateDiscoveryContinuityNote
).pipe(
  Schema.check(Schema.isMaxLength(PRIVATE_DISCOVERY_CONTINUITY_UPDATE_LIMIT)),
  Schema.annotate({ parseOptions: { onExcessProperty: "error" } })
);
const ReplyText = Schema.String.pipe(
  Schema.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(PRIVATE_DISCOVERY_REPLY_LENGTH)
  )
);
export const PrivateDiscoveryReply = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal("Ask"),
    question: ReplyText,
    text: ReplyText,
    topicKey: NoteKey,
  }),
  Schema.Struct({
    _tag: Schema.Literal("Review"),
    reason: Schema.Literal("no_relevant_open_topic"),
    text: ReplyText,
  }),
  Schema.Struct({
    _tag: Schema.Literal("Stop"),
    reason: Schema.Literal("participant_requested_stop"),
    text: ReplyText,
  }),
]);

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
  reply: typeof PrivateDiscoveryReply.Type
): {
  readonly continuity: PrivateDiscoveryContinuity;
  readonly message: string;
} => {
  if (updates.length > PRIVATE_DISCOVERY_CONTINUITY_UPDATE_LIMIT) {
    throw new PrivateDiscoveryContinuationFailure({
      stage: "continuity_updates",
    });
  }
  const notes = new Map(current.map((note) => [note.key, note]));
  const changed = new Set<string>();
  for (const update of updates) {
    if (changed.has(update.key)) {
      throw new PrivateDiscoveryContinuationFailure({
        stage: "continuity_updates",
      });
    }
    changed.add(update.key);
    notes.set(update.key, update);
  }
  const continuity = [...notes.values()];
  if (
    continuity.length > PRIVATE_DISCOVERY_CONTINUITY_NOTE_LIMIT ||
    continuityBytes(continuity) > PRIVATE_DISCOVERY_CONTINUITY_BYTES
  ) {
    throw new PrivateDiscoveryContinuationFailure({
      stage: "continuity_limit",
    });
  }
  let message: string;
  switch (reply._tag) {
    case "Ask": {
      if (notes.get(reply.topicKey)?.state !== "unresolved") {
        throw new PrivateDiscoveryContinuationFailure({
          stage: "reply_decision",
        });
      }
      message = `${reply.text}\n\n${reply.question}`;
      break;
    }
    case "Review": {
      if (continuity.some((note) => note.state === "unresolved")) {
        throw new PrivateDiscoveryContinuationFailure({
          stage: "reply_decision",
        });
      }
      message = reply.text;
      break;
    }
    case "Stop": {
      message = reply.text;
      break;
    }
    default: {
      return reply satisfies never;
    }
  }
  if (message.length > PRIVATE_DISCOVERY_REPLY_LENGTH) {
    throw new PrivateDiscoveryContinuationFailure({ stage: "reply_limit" });
  }
  return { continuity, message };
};

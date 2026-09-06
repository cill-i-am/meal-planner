import { Schema } from "effect";

export const MAX_PRIVATE_FRAME_BYTES = 32_768;
export const MAX_MESSAGE_LENGTH = 4000;
export const MAX_PAGE_SIZE = 25;
const Id = Schema.String.pipe(Schema.check(Schema.isUUID()));
const Ordinal = Schema.Number.pipe(
  Schema.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))
);
const PageSize = Schema.Number.pipe(
  Schema.check(
    Schema.isInt(),
    Schema.isBetween({ maximum: MAX_PAGE_SIZE, minimum: 1 })
  )
);
const Text = Schema.String.pipe(
  Schema.check(Schema.isMinLength(1), Schema.isMaxLength(MAX_MESSAGE_LENGTH))
);
export const StartSession = Schema.Struct({
  mutationId: Id,
  type: Schema.Literal("StartSession"),
});
export const ListSessions = Schema.Struct({
  afterOrdinal: Ordinal,
  limit: PageSize,
  requestId: Id,
  type: Schema.Literal("ListSessions"),
});
export const DirectoryCommand = Schema.Union([StartSession, ListSessions]);
export type DirectoryCommand = typeof DirectoryCommand.Type;
export const AppendParticipantMessage = Schema.Struct({
  expectedVersion: Ordinal,
  mutationId: Id,
  text: Text,
  type: Schema.Literal("AppendParticipantMessage"),
});
export const CompleteSession = Schema.Struct({
  expectedVersion: Ordinal,
  mutationId: Id,
  type: Schema.Literal("CompleteSession"),
});
export const ReadHistory = Schema.Struct({
  afterOrdinal: Ordinal,
  limit: PageSize,
  requestId: Id,
  type: Schema.Literal("ReadHistory"),
});
export const SessionCommand = Schema.Union([
  AppendParticipantMessage,
  CompleteSession,
  ReadHistory,
]);
export type SessionCommand = typeof SessionCommand.Type;
export const SessionState = Schema.Struct({
  status: Schema.Literals(["open", "completed"]),
  version: Ordinal,
});
export const Reservation = Schema.Struct({
  createdAt: Schema.Number,
  ordinal: Ordinal,
  sessionReference: Id,
});
export const Message = Schema.Struct({
  createdAt: Schema.Number,
  id: Id,
  ordinal: Ordinal,
  role: Schema.Literals(["participant", "assistant"]),
  text: Text,
});
export const Rejected = Schema.Struct({
  commandId: Id,
  reason: Schema.Literals([
    "mutation_collision",
    "version_conflict",
    "session_completed",
  ]),
  state: Schema.NullOr(SessionState),
  type: Schema.Literal("Rejected"),
});
export const DirectoryFrame = Schema.Union([
  Schema.Struct({
    bindingKey: Schema.String,
    type: Schema.Literal("DirectoryReady"),
  }),
  Schema.Struct({
    mutationId: Id,
    reservation: Reservation,
    type: Schema.Literal("SessionStarted"),
  }),
  Schema.Struct({
    hasMore: Schema.Boolean,
    requestId: Id,
    reservations: Schema.Array(Reservation),
    type: Schema.Literal("SessionsListed"),
  }),
  Rejected,
]);
export type DirectoryFrame = typeof DirectoryFrame.Type;
export const SessionFrame = Schema.Union([
  Schema.Struct({
    bindingKey: Schema.String,
    sessionReference: Id,
    state: SessionState,
    type: Schema.Literal("SessionReady"),
  }),
  Schema.Struct({
    message: Message,
    mutationId: Id,
    state: SessionState,
    type: Schema.Literal("MessageAppended"),
  }),
  Schema.Struct({
    mutationId: Id,
    state: SessionState,
    type: Schema.Literal("SessionCompleted"),
  }),
  Schema.Struct({
    hasMore: Schema.Boolean,
    messages: Schema.Array(Message),
    requestId: Id,
    state: SessionState,
    type: Schema.Literal("HistoryRead"),
  }),
  Rejected,
]);
export type SessionFrame = typeof SessionFrame.Type;

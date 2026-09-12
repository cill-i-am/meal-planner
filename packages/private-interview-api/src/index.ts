import {
  InterviewProfileOutcome as ConfirmationOutcome,
  FoodPreference,
  ProfileFactId,
  ProfileFactValue,
  ProfileVersion,
} from "@meal-planner/household-api";
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

/** A private proposal has no actor, target person, confirmation basis, or source. */
export const ProfileCardChange = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal("AddConfirmedProfileFact"),
    fact: ProfileFactValue,
  }),
  Schema.Struct({
    _tag: Schema.Literal("ConfirmProfileFact"),
    factId: ProfileFactId,
  }),
  Schema.Struct({
    _tag: Schema.Literal("ReplaceOrdinaryProfileFact"),
    fact: FoodPreference,
    factId: ProfileFactId,
  }),
  Schema.Struct({
    _tag: Schema.Literal("RemoveOrdinaryProfileFact"),
    factId: ProfileFactId,
  }),
  Schema.Struct({
    _tag: Schema.Literal("ConfirmHardConstraintReduction"),
    factId: ProfileFactId,
    replacement: Schema.NullOr(ProfileFactValue),
  }),
]).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));
export type ProfileCardChange = typeof ProfileCardChange.Type;
export { InterviewProfileOutcome as ConfirmationOutcome } from "@meal-planner/household-api";
export const ProfileCard = Schema.Struct({
  change: ProfileCardChange,
  expectedProfileVersion: ProfileVersion,
  id: Id,
  ordinal: Ordinal,
  outcome: Schema.NullOr(ConfirmationOutcome),
  reviewedFact: Schema.NullOr(ProfileFactValue),
  revision: Ordinal,
  status: Schema.Literals([
    "proposed",
    "rejected",
    "pending",
    "confirmed",
    "conflict",
  ]),
});
export type ProfileCard = typeof ProfileCard.Type;
export const ReadCards = Schema.Struct({
  afterOrdinal: Ordinal,
  limit: PageSize,
  requestId: Id,
  type: Schema.Literal("ReadCards"),
});
export const ReviseProfileCard = Schema.Struct({
  cardId: Id,
  cardRevision: Ordinal,
  change: ProfileCardChange,
  expectedProfileVersion: ProfileVersion,
  expectedVersion: Ordinal,
  mutationId: Id,
  reviewedFact: Schema.NullOr(ProfileFactValue),
  type: Schema.Literal("ReviseProfileCard"),
});
export const RejectProfileCard = Schema.Struct({
  cardId: Id,
  cardRevision: Ordinal,
  expectedVersion: Ordinal,
  mutationId: Id,
  type: Schema.Literal("RejectProfileCard"),
});
export const ConfirmProfileCard = Schema.Struct({
  cardId: Id,
  cardRevision: Ordinal,
  expectedVersion: Ordinal,
  mutationId: Id,
  safetyConfirmation: Schema.NullOr(
    Schema.Literal("I confirm this safety constraint change")
  ),
  type: Schema.Literal("ConfirmProfileCard"),
});

export const AssistantTurn = Schema.Struct({
  failure: Schema.NullOr(
    Schema.Literals([
      "not_configured",
      "provider_unavailable",
      "invalid_output",
      "refused",
      "context_limit",
      "outcome_unknown",
      "connection_lost",
      "runtime_restarted",
    ])
  ),
  id: Id,
  sourceMessageId: Id,
  status: Schema.Literals([
    "queued",
    "running",
    "succeeded",
    "failed",
    "interrupted",
    "cancelled",
  ]),
});
export type AssistantTurn = typeof AssistantTurn.Type;
export const ReadAssistantTurn = Schema.Struct({
  requestId: Id,
  type: Schema.Literal("ReadAssistantTurn"),
});
export const CancelAssistantTurn = Schema.Struct({
  expectedVersion: Ordinal,
  mutationId: Id,
  turnId: Id,
  type: Schema.Literal("CancelAssistantTurn"),
});
export const RetryAssistantTurn = Schema.Struct({
  expectedVersion: Ordinal,
  mutationId: Id,
  turnId: Id,
  type: Schema.Literal("RetryAssistantTurn"),
});

export const SessionCommand = Schema.Union([
  ReadAssistantTurn,
  CancelAssistantTurn,
  RetryAssistantTurn,
  AppendParticipantMessage,
  CompleteSession,
  ReadHistory,
  ReadCards,
  ReviseProfileCard,
  RejectProfileCard,
  ConfirmProfileCard,
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
    "confirmation_pending",
    "card_not_found",
    "card_conflict",
    "safety_confirmation_required",
    "assistant_turn_pending",
    "assistant_turn_conflict",
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
    requestId: Id,
    state: SessionState,
    turn: Schema.NullOr(AssistantTurn),
    type: Schema.Literal("AssistantTurnRead"),
  }),
  Schema.Struct({
    mutationId: Id,
    state: SessionState,
    turn: AssistantTurn,
    type: Schema.Literal("AssistantTurnChanged"),
  }),
  Schema.Struct({
    state: SessionState,
    turn: AssistantTurn,
    type: Schema.Literal("AssistantTurnUpdated"),
  }),
  Schema.Struct({
    cards: Schema.Array(ProfileCard),
    hasMore: Schema.Boolean,
    pendingConfirmation: Schema.NullOr(Id),
    requestId: Id,
    state: SessionState,
    type: Schema.Literal("CardsRead"),
  }),
  Schema.Struct({
    card: ProfileCard,
    mutationId: Id,
    state: SessionState,
    type: Schema.Literal("CardUpdated"),
  }),
  Schema.Struct({
    card: ProfileCard,
    mutationId: Id,
    state: SessionState,
    type: Schema.Literal("ConfirmationPending"),
  }),
  Schema.Struct({
    card: ProfileCard,
    mutationId: Id,
    outcome: ConfirmationOutcome,
    state: SessionState,
    type: Schema.Literal("ConfirmationSettled"),
  }),
  Schema.Struct({
    assistantTurn: Schema.NullOr(AssistantTurn),
    bindingKey: Schema.String,
    generation: Id,
    pendingConfirmation: Schema.NullOr(Id),
    sessionReference: Id,
    state: SessionState,
    type: Schema.Literal("SessionReady"),
  }),
  Schema.Struct({
    assistantTurn: AssistantTurn,
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

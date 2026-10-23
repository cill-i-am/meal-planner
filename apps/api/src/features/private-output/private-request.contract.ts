import { PersonProfile } from "@meal-planner/household-api";
import {
  AssistantTurnId,
  DirectoryCommand,
  ListSessions,
  ParticipantMessageText,
  SessionCommand,
  SessionState,
} from "@meal-planner/private-interview-api";
import { Schema } from "effect";

import {
  Generation,
  PrivateParticipantBinding,
  PrivateSessionBinding,
} from "./private-output.contract.js";

export const PrivateDirectoryRequest = Schema.Struct({
  ...Generation.fields,
  binding: PrivateParticipantBinding,
  command: DirectoryCommand,
});
export const PrivateSessionRequest = Schema.Struct({
  ...Generation.fields,
  binding: PrivateSessionBinding,
  command: SessionCommand,
});
export const PrivateRequestRead = Schema.Struct({
  afterCardOrdinal: ListSessions.fields.afterOrdinal,
  afterMessageOrdinal: ListSessions.fields.afterOrdinal,
  limit: ListSessions.fields.limit,
});
export const PrivateSessionRead = Schema.Struct({
  ...Generation.fields,
  ...PrivateRequestRead.fields,
  binding: PrivateSessionBinding,
});
export const PrivateRequestTurn = Schema.Struct({
  ...Generation.fields,
  binding: PrivateSessionBinding,
  expectedVersion: SessionState.fields.version,
  profile: PersonProfile,
  text: ParticipantMessageText,
  turnId: AssistantTurnId,
});
export const PrivateRequestCancel = Schema.Struct({
  ...Generation.fields,
  binding: PrivateSessionBinding,
  turnId: AssistantTurnId,
});

import {
  ConversationConflict,
  ConversationForbidden,
  ConversationInvalid,
  ConversationTurnRequest,
  ConversationUnauthorized,
  ConversationUnavailable,
  ConversationView,
} from "@meal-planner/agent-conversations-api";
import { HouseholdOrganizationId } from "@meal-planner/household-api";
import {
  AssistantTurn,
  AssistantTurnId,
  DirectoryFrame,
  ParticipantMessageText,
  PrivateRequestSessionSnapshot,
  SessionCommand,
  SessionFrame,
  StartSession,
} from "@meal-planner/private-interview-api";
import { Schema } from "effect";
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/http-api";

const Id = Schema.String.check(Schema.isUUID());
const Ordinal = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const QueryOrdinal = Schema.NumberFromString.pipe(
  Schema.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))
);
const QueryPageSize = Schema.NumberFromString.pipe(
  Schema.check(Schema.isInt(), Schema.isBetween({ maximum: 25, minimum: 1 }))
);
const Session = { sessionReference: Id };
const errors = [
  ConversationUnauthorized,
  ConversationForbidden,
  ConversationConflict,
  ConversationUnavailable,
  ConversationInvalid,
];

/** The same command receipts as the browser, excluding connection metadata. */
export const PrivateCommandResult = Schema.Union([
  SessionFrame.members[1],
  SessionFrame.members[2],
  SessionFrame.members[3],
  SessionFrame.members[4],
  SessionFrame.members[6],
  SessionFrame.members[7],
]);
export const PrivateStartTurn = Schema.Struct({
  expectedVersion: Ordinal,
  text: ParticipantMessageText,
  turnId: AssistantTurnId,
}).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));

/** Agent-friendly requests reuse native conversations, versions and receipts. */
export const ProductConversationsApi = HttpApi.make("productConversationsApi")
  .add(
    HttpApiGroup.make("conversationTurns").add(
      HttpApiEndpoint.post("setup", "/v1/agent-conversations/setup/turns", {
        error: errors,
        payload: ConversationTurnRequest,
        success: ConversationView,
      }),
      HttpApiEndpoint.post(
        "family",
        "/v1/families/:familyId/agent-conversation/turns",
        {
          error: errors,
          params: { familyId: HouseholdOrganizationId },
          payload: ConversationTurnRequest,
          success: ConversationView,
        }
      )
    )
  )
  .add(
    HttpApiGroup.make("privateInterviews").add(
      HttpApiEndpoint.get("list", "/v1/private-interviews", {
        error: errors,
        query: {
          afterOrdinal: Schema.optionalKey(QueryOrdinal),
          limit: Schema.optionalKey(QueryPageSize),
        },
        success: DirectoryFrame.members[2],
      }),
      HttpApiEndpoint.post("start", "/v1/private-interviews", {
        error: errors,
        payload: StartSession,
        success: Schema.Union([
          DirectoryFrame.members[1],
          DirectoryFrame.members[3],
        ]),
      }),
      HttpApiEndpoint.get("read", "/v1/private-interviews/:sessionReference", {
        error: errors,
        params: Session,
        query: {
          afterCardOrdinal: Schema.optionalKey(QueryOrdinal),
          afterMessageOrdinal: Schema.optionalKey(QueryOrdinal),
          limit: Schema.optionalKey(QueryPageSize),
        },
        success: PrivateRequestSessionSnapshot,
      }),
      HttpApiEndpoint.post(
        "command",
        "/v1/private-interviews/:sessionReference/commands",
        {
          error: errors,
          params: Session,
          payload: SessionCommand,
          success: PrivateCommandResult,
        }
      ),
      HttpApiEndpoint.post(
        "startTurn",
        "/v1/private-interviews/:sessionReference/turns",
        {
          error: errors,
          params: Session,
          payload: PrivateStartTurn,
          success: AssistantTurn,
        }
      ),
      HttpApiEndpoint.post(
        "cancelTurn",
        "/v1/private-interviews/:sessionReference/turns/:turnId/cancel",
        {
          error: errors,
          params: { ...Session, turnId: AssistantTurnId },
          success: AssistantTurn,
        }
      ),
      HttpApiEndpoint.post(
        "continueConfirmation",
        "/v1/private-interviews/:sessionReference/confirmations/:mutationId/continue",
        {
          error: errors,
          params: { ...Session, mutationId: Id },
          success: PrivateRequestSessionSnapshot,
        }
      )
    )
  );

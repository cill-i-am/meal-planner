import { FamilyName } from "@meal-planner/families";
import {
  Availability,
  CookingCapacity,
  Fallback,
  HouseholdOrganizationId,
  HouseholdPersonDisplayName,
  HouseholdPersonId,
  HouseholdPersonKind,
  ManagedOccasion,
  MealOption,
  MealOccasionId,
  MealPlanChange,
  MealPlanId,
  MealPlanQuantity,
  MealPlanResolution,
  PlanningOptionRef,
  PlanningContentVersion,
  ProfileFactId,
  ProfileFactValue,
  ProfileVersion,
  RoutineChoice,
  Weekday,
} from "@meal-planner/household-api";
import { RecipeId } from "@meal-planner/recipe-import-api";
import { Context, Layer, Schema } from "effect";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";
import {
  HttpApi,
  HttpApiClient,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiMiddleware,
  HttpApiSchema,
} from "effect/unstable/httpapi";

const Id = Schema.String.pipe(Schema.check(Schema.isUUID()));
const MessageText = Schema.Trim.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(2000)
);
const Explanation = Schema.Trim.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(600)
);
const Revision = Schema.Int.pipe(
  Schema.check(Schema.isGreaterThanOrEqualTo(1))
);
const BlockStatus = Schema.Literals([
  "proposed",
  "pending",
  "accepted",
  "answered",
  "dismissed",
]);
export const FoodTopic = Schema.Literals([
  "pasta",
  "rice_bowls",
  "pizza",
  "tacos",
  "fish",
]);
export type FoodTopic = typeof FoodTopic.Type;
export const FoodAnswer = Schema.Literals(["yes", "change", "no", "unsure"]);
export type FoodAnswer = typeof FoodAnswer.Type;

export const ConversationId = Id.pipe(Schema.brand("ConversationId"));
export type ConversationId = typeof ConversationId.Type;
/** TanStack Chat supplies an opaque run ID (currently run-<time>-<suffix>). */
export const ConversationTurnId = Schema.String.pipe(
  Schema.check(
    Schema.isMinLength(8),
    Schema.isMaxLength(96),
    Schema.isPattern(/^[A-Za-z\d_-]+$/u)
  ),
  Schema.brand("ConversationTurnId")
);
export type ConversationTurnId = typeof ConversationTurnId.Type;
export const ConversationBlockId = Id.pipe(Schema.brand("ConversationBlockId"));
export type ConversationBlockId = typeof ConversationBlockId.Type;
export const ConversationActionId = Id.pipe(
  Schema.brand("ConversationActionId")
);
export type ConversationActionId = typeof ConversationActionId.Type;

/** Conversation visibility is fixed on first admission and cannot be promoted. */
export const ConversationScope = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal("AccountPrivateSetup") }),
  Schema.Struct({
    _tag: Schema.Literal("FamilyShared"),
    familyId: HouseholdOrganizationId,
  }),
]).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));
export type ConversationScope = typeof ConversationScope.Type;

export const ProposedPerson = Schema.Struct({
  displayName: HouseholdPersonDisplayName,
  draftId: Id,
  kind: HouseholdPersonKind,
});
export type ProposedPerson = typeof ProposedPerson.Type;

const QuestionBlock = Schema.Struct({
  _tag: Schema.Literal("Question"),
  foodTopic: Schema.NullOr(FoodTopic),
  id: ConversationBlockId,
  prompt: MessageText,
  revision: Revision,
  status: BlockStatus,
  targetPersonId: Schema.NullOr(HouseholdPersonId),
  turnId: ConversationTurnId,
});
const RosterProposalBlock = Schema.Struct({
  _tag: Schema.Literal("RosterProposal"),
  creatorName: HouseholdPersonDisplayName,
  familyName: FamilyName,
  id: ConversationBlockId,
  people: Schema.Array(ProposedPerson).pipe(
    Schema.check(Schema.isMaxLength(20))
  ),
  revision: Revision,
  status: BlockStatus,
  turnId: ConversationTurnId,
});
const PersonFactProposalBlock = Schema.Struct({
  _tag: Schema.Literal("PersonFactProposal"),
  change: Schema.Union([
    Schema.Struct({ _tag: Schema.Literal("Add"), fact: ProfileFactValue }),
    Schema.Struct({ _tag: Schema.Literal("Confirm"), factId: ProfileFactId }),
    Schema.Struct({
      _tag: Schema.Literal("Replace"),
      fact: ProfileFactValue,
      factId: ProfileFactId,
    }),
    Schema.Struct({ _tag: Schema.Literal("Remove"), factId: ProfileFactId }),
  ]),
  explanation: Explanation,
  id: ConversationBlockId,
  personId: HouseholdPersonId,
  profileVersion: ProfileVersion,
  requiresSafetyConfirmation: Schema.Boolean,
  reviewedBefore: Schema.NullOr(ProfileFactValue),
  revision: Revision,
  status: BlockStatus,
  turnId: ConversationTurnId,
});
const RoutineProposalBlock = Schema.Struct({
  _tag: Schema.Literal("RoutineProposal"),
  expectedContentVersion: PlanningContentVersion,
  explanation: Explanation,
  id: ConversationBlockId,
  revision: Revision,
  routine: Schema.Struct({
    choice: RoutineChoice,
    occasionId: MealOccasionId,
    scope: Schema.Union([
      Schema.Struct({ _tag: Schema.Literal("Household") }),
      Schema.Struct({
        _tag: Schema.Literal("Person"),
        personId: HouseholdPersonId,
      }),
    ]),
    state: Schema.Literals(["active", "paused"]),
    weekdays: Schema.NonEmptyArray(Weekday),
  }),
  status: BlockStatus,
  turnId: ConversationTurnId,
});
/** Only ordinary planning setup writes may be proposed by the model. */
export const PlanningSetupCommand = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal("SetPersonManagedOccasions"),
    entries: Schema.Array(ManagedOccasion),
    personId: HouseholdPersonId,
  }),
  Schema.Struct({
    _tag: Schema.Literal("SetPersonAvailability"),
    entries: Schema.Array(Availability),
    personId: HouseholdPersonId,
  }),
  Schema.Struct({
    _tag: Schema.Literal("SetCookingCapacity"),
    value: CookingCapacity,
  }),
  Schema.Struct({ _tag: Schema.Literal("PutOption"), value: MealOption }),
  Schema.Struct({ _tag: Schema.Literal("PutFallback"), value: Fallback }),
]);
export type PlanningSetupCommand = typeof PlanningSetupCommand.Type;

const NewManagedOccasion = Schema.Struct({
  label: ManagedOccasion.fields.label,
  occasionId: Schema.NullOr(MealOccasionId),
  state: ManagedOccasion.fields.state,
  weekdays: ManagedOccasion.fields.weekdays,
});
const NewAssembledOption = MealOption.members[1].mapFields(
  ({ optionId: _optionId, optionVersion: _optionVersion, ...fields }) => fields
);
const NewPackagedOption = MealOption.members[2].mapFields(
  ({ optionId: _optionId, optionVersion: _optionVersion, ...fields }) => fields
);
const NewExternalOption = MealOption.members[3].mapFields(
  ({ optionId: _optionId, optionVersion: _optionVersion, ...fields }) => fields
);
const NewFallback = Fallback.mapFields(
  ({ id: _id, version: _version, ...fields }) => fields
);
export const PlanningSetupModelCommand = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal("SetPersonManagedOccasions"),
    entries: Schema.Array(NewManagedOccasion),
    personId: HouseholdPersonId,
  }),
  PlanningSetupCommand.members[1],
  PlanningSetupCommand.members[2],
  Schema.Struct({
    _tag: Schema.Literal("PutOption"),
    value: Schema.Union([
      NewAssembledOption,
      NewPackagedOption,
      NewExternalOption,
    ]),
  }),
  Schema.Struct({ _tag: Schema.Literal("PutFallback"), value: NewFallback }),
]);
export type PlanningSetupModelCommand = typeof PlanningSetupModelCommand.Type;

/** Full replacement is materialized from compact rows inside the Agent. */
export const AgentPlanChange = Schema.Union([
  MealPlanChange.members[2],
  MealPlanChange.members[3],
  MealPlanChange.members[4],
  MealPlanChange.members[5],
]);
export type AgentPlanChange = typeof AgentPlanChange.Type;

const ScheduleWeekIndex = Schema.Int.pipe(
  Schema.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(11))
);
const ScheduleBatchCount = Schema.Int.pipe(
  Schema.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(16))
);
const ScheduleRowKey = Schema.String.pipe(
  Schema.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(64),
    Schema.isPattern(/^[A-Za-z\d_-]+$/u)
  )
);
/** Rows apply to the exact cross product of admitted requirements they name. */
export const PlanScheduleRow = Schema.Struct({
  key: ScheduleRowKey,
  resolution: Schema.Union([
    Schema.Struct({
      _tag: Schema.Literal("MealOption"),
      batchCount: Schema.NullOr(ScheduleBatchCount),
      option: PlanningOptionRef,
      preparedOutput: Schema.NullOr(MealPlanQuantity),
    }),
    Schema.Struct({
      _tag: Schema.Literal("Prepared"),
      outputId: Schema.String.pipe(
        Schema.check(Schema.isNonEmpty(), Schema.isMaxLength(128))
      ),
    }),
    Schema.Struct({
      _tag: Schema.Literal("PreparedFromCook"),
      daysBefore: Schema.Int.pipe(
        Schema.check(
          Schema.isGreaterThanOrEqualTo(1),
          Schema.isLessThanOrEqualTo(6)
        )
      ),
      sourceRowKey: ScheduleRowKey,
    }),
    Schema.Struct({
      _tag: Schema.Literal("External"),
      description: MealPlanResolution.members[2].fields.description,
    }),
    Schema.Struct({ _tag: Schema.Literal("Skip") }),
    Schema.Struct({ _tag: Schema.Literal("Flexible") }),
    Schema.Struct({
      _tag: Schema.Literal("Gap"),
      reason: MealPlanResolution.members[5].fields.reason,
    }),
  ]),
  targets: Schema.NonEmptyArray(
    Schema.Struct({
      occasionId: MealOccasionId,
      personId: HouseholdPersonId,
      quantity: Schema.NullOr(MealPlanQuantity),
    })
  ).pipe(Schema.check(Schema.isMaxLength(32))),
  weekIndices: Schema.NullOr(
    Schema.NonEmptyArray(ScheduleWeekIndex).pipe(
      Schema.check(Schema.isMaxLength(12))
    )
  ),
  weekdays: Schema.NonEmptyArray(Weekday).pipe(
    Schema.check(Schema.isMaxLength(7))
  ),
});
export type PlanScheduleRow = typeof PlanScheduleRow.Type;

export const PlanScheduleProposal = Schema.Struct({
  _tag: Schema.Literal("PlanScheduleProposal"),
  expectedRevision: Schema.Int.pipe(
    Schema.check(Schema.isGreaterThanOrEqualTo(0))
  ),
  explanation: Explanation,
  planId: MealPlanId,
  rows: Schema.NonEmptyArray(PlanScheduleRow).pipe(
    Schema.check(Schema.isMaxLength(64))
  ),
});
export type PlanScheduleProposal = typeof PlanScheduleProposal.Type;

const PlanningContentProposalBlock = Schema.Struct({
  _tag: Schema.Literal("PlanningContentProposal"),
  command: PlanningSetupCommand,
  expectedContentVersion: PlanningContentVersion,
  explanation: Explanation,
  id: ConversationBlockId,
  revision: Revision,
  status: BlockStatus,
  turnId: ConversationTurnId,
});
const PlanChangeProposalBlock = Schema.Struct({
  _tag: Schema.Literal("PlanChangeProposal"),
  change: MealPlanChange,
  expectedRevision: Schema.Int.pipe(
    Schema.check(Schema.isGreaterThanOrEqualTo(0))
  ),
  explanation: Explanation,
  id: ConversationBlockId,
  planId: MealPlanId,
  revision: Revision,
  status: BlockStatus,
  turnId: ConversationTurnId,
});
const RecipeDetailsBlock = Schema.Struct({
  _tag: Schema.Literal("RecipeDetails"),
  id: ConversationBlockId,
  recipeId: RecipeId,
  revision: Revision,
  status: BlockStatus,
  turnId: ConversationTurnId,
});

/** Closed presentation vocabulary; canonical domain state is read separately. */
export const ConversationBlock = Schema.Union([
  QuestionBlock,
  RosterProposalBlock,
  PersonFactProposalBlock,
  RoutineProposalBlock,
  PlanningContentProposalBlock,
  PlanChangeProposalBlock,
  RecipeDetailsBlock,
]).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));
export type ConversationBlock = typeof ConversationBlock.Type;

/** Model output has no IDs, versions of generated blocks, or write authority. */
export const ConversationModelBlock = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal("Question"),
    foodTopic: Schema.NullOr(FoodTopic),
    prompt: MessageText,
    targetPersonId: Schema.NullOr(HouseholdPersonId),
  }),
  Schema.Struct({
    _tag: Schema.Literal("RosterProposal"),
    creatorName: HouseholdPersonDisplayName,
    familyName: FamilyName,
    people: Schema.Array(
      Schema.Struct({
        displayName: HouseholdPersonDisplayName,
        kind: HouseholdPersonKind,
      })
    ).pipe(Schema.check(Schema.isMaxLength(20))),
  }),
  Schema.Struct({
    _tag: Schema.Literal("PersonFactProposal"),
    change: PersonFactProposalBlock.fields.change,
    explanation: Explanation,
    personId: HouseholdPersonId,
    profileVersion: ProfileVersion,
  }),
  Schema.Struct({
    _tag: Schema.Literal("RoutineProposal"),
    expectedContentVersion: PlanningContentVersion,
    explanation: Explanation,
    routine: RoutineProposalBlock.fields.routine,
  }),
  Schema.Struct({
    _tag: Schema.Literal("PlanningContentProposal"),
    command: PlanningSetupModelCommand,
    expectedContentVersion: PlanningContentVersion,
    explanation: Explanation,
  }),
  Schema.Struct({
    _tag: Schema.Literal("PlanChangeProposal"),
    change: AgentPlanChange,
    expectedRevision: PlanChangeProposalBlock.fields.expectedRevision,
    explanation: Explanation,
    planId: MealPlanId,
  }),
  PlanScheduleProposal,
  Schema.Struct({
    _tag: Schema.Literal("RecipeDetails"),
    recipeId: RecipeId,
  }),
]).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));
export type ConversationModelBlock = typeof ConversationModelBlock.Type;

export const SubmitConversationTurn = Schema.Struct({
  blocks: Schema.Array(ConversationModelBlock).pipe(
    Schema.check(Schema.isMaxLength(4))
  ),
  reply: MessageText,
}).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));
export type SubmitConversationTurn = typeof SubmitConversationTurn.Type;

export const ConversationMessage = Schema.Struct({
  id: Id,
  ordinal: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(1))),
  role: Schema.Literals(["adult", "assistant"]),
  text: MessageText,
  turnId: Schema.NullOr(ConversationTurnId),
});
export type ConversationMessage = typeof ConversationMessage.Type;

export const ConversationTurnState = Schema.Struct({
  failure: Schema.NullOr(
    Schema.Literals([
      "not_configured",
      "provider_unavailable",
      "invalid_output",
      "context_limit",
      "outcome_unknown",
      "runtime_interrupted",
    ])
  ),
  id: ConversationTurnId,
  status: Schema.Literals(["running", "succeeded", "failed", "interrupted"]),
});
export type ConversationTurnState = typeof ConversationTurnState.Type;

export const ReviewedRoster = Schema.Struct({
  creatorName: HouseholdPersonDisplayName,
  familyName: FamilyName,
  people: Schema.Array(ProposedPerson).pipe(
    Schema.check(Schema.isMaxLength(20))
  ),
}).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));
export type ReviewedRoster = typeof ReviewedRoster.Type;

const ActionFields = {
  actionId: ConversationActionId,
  blockId: ConversationBlockId,
  expectedRevision: Revision,
};
export const ConversationAction = Schema.Union([
  Schema.Struct({ ...ActionFields, decision: Schema.Literal("dismiss") }),
  Schema.Struct({
    ...ActionFields,
    decision: Schema.Literal("accept"),
    reviewedRoster: Schema.NullOr(ReviewedRoster),
    safetyConfirmation: Schema.NullOr(
      Schema.Literal("I confirm this safety constraint change")
    ),
  }),
]).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));
export type ConversationAction = typeof ConversationAction.Type;

export const ConversationActionState = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal("Pending"),
    actionId: ConversationActionId,
  }),
  Schema.Struct({
    _tag: Schema.Literal("Committed"),
    actionId: ConversationActionId,
    familyId: Schema.NullOr(HouseholdOrganizationId),
  }),
  Schema.Struct({
    _tag: Schema.Literal("Unknown"),
    actionId: ConversationActionId,
    familyId: Schema.NullOr(HouseholdOrganizationId),
  }),
  Schema.Struct({
    _tag: Schema.Literal("Rejected"),
    actionId: ConversationActionId,
    reason: Schema.Literals([
      "stale_review",
      "not_actionable",
      "permission_denied",
    ]),
  }),
]);
export type ConversationActionState = typeof ConversationActionState.Type;

export const ConversationActionView = Schema.Struct({
  action: ConversationAction,
  state: ConversationActionState,
});
export type ConversationActionView = typeof ConversationActionView.Type;

export const ConversationView = Schema.Struct({
  actions: Schema.Array(ConversationActionView),
  blocks: Schema.Array(ConversationBlock),
  id: ConversationId,
  messages: Schema.Array(ConversationMessage),
  scope: ConversationScope,
  turns: Schema.Array(ConversationTurnState),
  version: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0))),
});
export type ConversationView = typeof ConversationView.Type;

export const ConversationChatMetadata = Schema.Struct({
  answerToBlockId: Schema.NullOr(ConversationBlockId),
  expectedVersion: ConversationView.fields.version,
  focusPersonId: Schema.NullOr(HouseholdPersonId),
  foodAnswer: Schema.NullOr(FoodAnswer),
  planId: Schema.NullOr(MealPlanId),
}).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));
export type ConversationChatMetadata = typeof ConversationChatMetadata.Type;

/** The dedicated SSE bridge accepts this closed body; the host injects authority. */
export const ConversationTurnRequest = Schema.Struct({
  answerToBlockId: Schema.NullOr(ConversationBlockId),
  expectedVersion: ConversationView.fields.version,
  focusPersonId: Schema.NullOr(HouseholdPersonId),
  foodAnswer: Schema.NullOr(FoodAnswer),
  planId: Schema.NullOr(MealPlanId),
  text: MessageText,
  turnId: ConversationTurnId,
}).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));
export type ConversationTurnRequest = typeof ConversationTurnRequest.Type;

const problemDetails = <const Status extends number, const Code extends string>(
  status: Status,
  code: Code
) =>
  Schema.Struct({
    code: Schema.Literal(code),
    message: Schema.String,
    status: Schema.Literal(status),
  }).pipe(
    HttpApiSchema.status(status),
    HttpApiSchema.asJson({ contentType: "application/problem+json" })
  );
export const ConversationUnauthorized = problemDetails(401, "unauthorized");
export const ConversationForbidden = problemDetails(
  403,
  "conversation_forbidden"
);
export const ConversationConflict = problemDetails(
  409,
  "conversation_conflict"
);
export const ConversationUnavailable = problemDetails(
  503,
  "conversation_unavailable"
);
export const ConversationInvalid = problemDetails(400, "conversation_invalid");

/** Parse failures at the shared HTTP boundary are explicit client errors. */
export class ConversationSchemaErrors extends HttpApiMiddleware.Service<ConversationSchemaErrors>()(
  "ConversationSchemaErrors",
  { error: ConversationInvalid }
) {}

const conversationErrors = [
  ConversationUnauthorized,
  ConversationForbidden,
  ConversationConflict,
  ConversationUnavailable,
  ConversationInvalid,
];

/** Ordinary reads and reviewed actions use the generated Effect client. */
export const AgentConversationsApi = HttpApi.make("agentConversationsApi")
  .add(
    HttpApiGroup.make("agentConversations").add(
      HttpApiEndpoint.get("setup", "/v1/agent-conversations/setup", {
        error: conversationErrors,
        success: ConversationView,
      }),
      HttpApiEndpoint.post(
        "setupAction",
        "/v1/agent-conversations/setup/actions",
        {
          error: conversationErrors,
          payload: ConversationAction,
          success: ConversationActionState,
        }
      ),
      HttpApiEndpoint.get(
        "family",
        "/v1/families/:familyId/agent-conversation",
        {
          error: conversationErrors,
          params: { familyId: HouseholdOrganizationId },
          success: ConversationView,
        }
      ),
      HttpApiEndpoint.post(
        "familyAction",
        "/v1/families/:familyId/agent-conversation/actions",
        {
          error: conversationErrors,
          params: { familyId: HouseholdOrganizationId },
          payload: ConversationAction,
          success: ConversationActionState,
        }
      )
    )
  )
  .middleware(ConversationSchemaErrors);
export type AgentConversationsApiClient = HttpApiClient.ForApi<
  typeof AgentConversationsApi
>;
export const AgentConversationsApiClient =
  Context.Service<AgentConversationsApiClient>(
    "meal-planner/AgentConversationsApiClient"
  );
export const makeAgentConversationsApiClientLayer = (options: {
  readonly baseUrl: string;
  readonly headers: Readonly<Record<string, string>>;
}) =>
  Layer.effect(
    AgentConversationsApiClient,
    HttpApiClient.make(AgentConversationsApi, {
      baseUrl: options.baseUrl,
      transformClient: (client) =>
        client.pipe(
          HttpClient.mapRequest((request) =>
            request.pipe(HttpClientRequest.setHeaders(options.headers))
          )
        ),
    })
  );

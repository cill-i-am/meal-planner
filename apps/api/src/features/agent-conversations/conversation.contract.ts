import {
  ConversationChatMetadata,
  ConversationBlock,
  ConversationScope,
  ConversationTurnId,
} from "@meal-planner/agent-conversations-api";
import { Family } from "@meal-planner/families";
import {
  HouseholdMealPlanResponse,
  HouseholdPerson,
  HouseholdPersonId,
  MealOccasionId,
  MealPlanId,
  MealPlanQuantity,
  MealPlanRequest,
  MealPlanResolution,
  PersonProfile,
  PlanningContentSnapshot,
  PlanningOptionRef,
  Weekday,
} from "@meal-planner/household-api";
import { Schema } from "effect";

const OpaqueAccountKey = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[a-f\d]{64}$/u))
);

/** The API host derives this from Better Auth and current family membership. */
export const ConversationAccess = Schema.Struct({
  accountKey: OpaqueAccountKey,
  scope: ConversationScope,
}).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));
export type ConversationAccess = typeof ConversationAccess.Type;

export const ConversationCanonicalContext = Schema.Struct({
  family: Schema.NullOr(Family),
  people: Schema.Array(HouseholdPerson),
  plan: Schema.NullOr(HouseholdMealPlanResponse),
  planningContent: Schema.NullOr(PlanningContentSnapshot),
  profiles: Schema.Array(PersonProfile),
  setupAccountDisplayName: Schema.NullOr(Schema.String),
}).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));
export type ConversationCanonicalContext =
  typeof ConversationCanonicalContext.Type;

const ModelCoverageChoice = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal("MealOption"),
    option: PlanningOptionRef,
    quantity: Schema.NullOr(MealPlanQuantity),
  }),
  Schema.Struct({
    _tag: Schema.Literal("Prepared"),
    outputId: MealPlanResolution.members[1].fields.outputId,
    quantity: MealPlanQuantity,
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
]);
const ModelPlanCoverageRow = Schema.Struct({
  choice: ModelCoverageChoice,
  occasionId: MealOccasionId,
  personId: HouseholdPersonId,
  weekIndices: Schema.Array(
    Schema.Int.pipe(
      Schema.check(
        Schema.isGreaterThanOrEqualTo(0),
        Schema.isLessThanOrEqualTo(11)
      )
    )
  ),
  weekday: Weekday,
});
const ConversationModelPlan = Schema.Struct({
  currentChoices: Schema.Array(ModelPlanCoverageRow).pipe(
    Schema.check(Schema.isMaxLength(128))
  ),
  omittedCoverageCount: Schema.Int.pipe(
    Schema.check(Schema.isGreaterThanOrEqualTo(0))
  ),
  planId: MealPlanId,
  request: MealPlanRequest,
  revision: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0))),
  state: Schema.Literals(["Draft", "Approved", "ProposedRevision"]),
  totalCoverage: Schema.Int.pipe(
    Schema.check(Schema.isGreaterThanOrEqualTo(0))
  ),
});
/** A bounded model view; the Agent retains the full canonical snapshot. */
export const ConversationModelContext = Schema.Struct({
  family: Schema.NullOr(Family),
  people: Schema.Array(HouseholdPerson),
  plan: Schema.NullOr(ConversationModelPlan),
  planningContent: Schema.NullOr(PlanningContentSnapshot),
  profiles: Schema.Array(PersonProfile),
  setupAccountDisplayName: Schema.NullOr(Schema.String),
  setupRoster: Schema.NullOr(ConversationBlock.members[1]),
});
export type ConversationModelContext = typeof ConversationModelContext.Type;

/** Only the API host may attach fresh canonical context to a native chat turn. */
export const ConversationChatInput = Schema.Struct({
  access: ConversationAccess,
  context: ConversationCanonicalContext,
  focusPersonId: Schema.NullOr(HouseholdPersonId),
  metadata: ConversationChatMetadata,
  planId: Schema.NullOr(MealPlanId),
  text: Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(2000)),
  turnId: ConversationTurnId,
}).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));
export type ConversationChatInput = typeof ConversationChatInput.Type;

export const WorkersAIConversationModelConfig = Schema.Struct({
  gatewayId: Schema.NullOr(
    Schema.String.pipe(
      Schema.check(Schema.isNonEmpty(), Schema.isMaxLength(64))
    )
  ),
  maxOutputTokens: Schema.Int.pipe(
    Schema.check(Schema.isBetween({ maximum: 65_536, minimum: 1 }))
  ),
  model: Schema.Literals([
    "@cf/openai/gpt-oss-120b",
    "@cf/moonshotai/kimi-k2.6",
  ]),
  timeoutMs: Schema.Int.pipe(
    Schema.check(Schema.isBetween({ maximum: 900_000, minimum: 1000 }))
  ),
}).pipe(
  Schema.check(
    Schema.makeFilter(
      (value) =>
        value.model === "@cf/moonshotai/kimi-k2.6" ||
        (value.maxOutputTokens <= 4096 && value.timeoutMs <= 120_000),
      { expected: "limits supported by the configured model" }
    )
  ),
  Schema.annotate({ parseOptions: { onExcessProperty: "error" } })
);
export type WorkersAIConversationModelConfig =
  typeof WorkersAIConversationModelConfig.Type;

export const CloudflareResponsesConversationModelConfig = Schema.Struct({
  gatewayId: Schema.String.pipe(
    Schema.check(Schema.isNonEmpty(), Schema.isMaxLength(64))
  ),
  maxOutputTokens: Schema.Int.pipe(
    Schema.check(Schema.isBetween({ maximum: 16_384, minimum: 1 }))
  ),
  model: Schema.Literal("openai/gpt-6-luna"),
  provider: Schema.Literal("cloudflare-responses"),
  timeoutMs: Schema.Int.pipe(
    Schema.check(Schema.isBetween({ maximum: 300_000, minimum: 1000 }))
  ),
}).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));
export type CloudflareResponsesConversationModelConfig =
  typeof CloudflareResponsesConversationModelConfig.Type;

export const ConversationModelConfig = Schema.Union([
  WorkersAIConversationModelConfig,
  CloudflareResponsesConversationModelConfig,
]);
export type ConversationModelConfig = typeof ConversationModelConfig.Type;

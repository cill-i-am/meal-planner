import { MealPlanRecipeSnapshot } from "@meal-planner/household-api";
import {
  ActiveRecipeImportAction,
  AnswerReviewRecipeActionRequest,
  CanonicalTikTokUrl,
  CancelRecipeImportIntentRequest,
  ConfirmRecipeImportActionRequest,
  IdempotencyKey,
  Recipe,
  RecipeImportAction,
  RecipeImportActionId,
  RecipeImportIntent,
  RecipeImportIntentId,
  RecipeImportTimeline,
  RecipeReviewActionView,
  RecoveryGuidance,
  StablePublicErrorCode,
  StepProgress,
} from "@meal-planner/recipe-import-api";
import { Schema } from "effect";

import { ImportTraceContext } from "../../imports/import-observability.js";
import { HouseholdDispatchId } from "../foundation/import-workflow-admission.contract.js";
import {
  HouseholdMemberAdmission,
  HouseholdSystemAdmission,
} from "../rpc/command-envelope.js";
import { ImportWorkflowIdentity } from "../shared-kernel/workflow-identity.js";

export { HouseholdImportWorkflowDispatchView as HouseholdRecordRecipeImportDispatchResult } from "../foundation/import-workflow-admission.contract.js";

const Sha256Hex = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[a-f\d]{64}$/u))
);
const PositiveSafeInteger = Schema.Int.pipe(
  Schema.check(
    Schema.isGreaterThanOrEqualTo(1),
    Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER)
  )
);

export const HouseholdImportMutationId = Sha256Hex.pipe(
  Schema.brand("HouseholdImportMutationId")
);
export type HouseholdImportMutationId = typeof HouseholdImportMutationId.Type;

export const HouseholdAdmitRecipeImportInput = Schema.Struct({
  admission: HouseholdMemberAdmission,
  idempotencyKey: IdempotencyKey,
  source: Schema.Struct({
    kind: Schema.Literal("tiktok"),
    url: Schema.String.pipe(
      Schema.check(
        Schema.isTrimmed(),
        Schema.isNonEmpty(),
        Schema.isMaxLength(2048)
      )
    ),
  }),
}).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));
export type HouseholdAdmitRecipeImportInput =
  typeof HouseholdAdmitRecipeImportInput.Type;

export const HouseholdAdmitRecipeImportResult = Schema.Struct({
  dispatchId: Schema.String.pipe(
    Schema.check(
      Schema.isTrimmed(),
      Schema.isNonEmpty(),
      Schema.isMaxLength(128)
    )
  ),
  intent: RecipeImportIntent,
  workflowIdentity: Schema.String.pipe(
    Schema.check(Schema.isPattern(/^import-acquisition:v1:[a-f\d]{64}$/u))
  ),
});
export type HouseholdAdmitRecipeImportResult =
  typeof HouseholdAdmitRecipeImportResult.Type;

export const HouseholdRecordRecipeImportDispatchInput = Schema.Struct({
  admission: HouseholdSystemAdmission,
  dispatchId: HouseholdDispatchId,
  originalTrace: ImportTraceContext,
  outcome: Schema.Literals(["started", "unavailable"]),
  workflowIdentity: ImportWorkflowIdentity,
}).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));
export type HouseholdRecordRecipeImportDispatchInput =
  typeof HouseholdRecordRecipeImportDispatchInput.Type;

export const HouseholdResolveRecipeImportSourceInput = Schema.Struct({
  admission: HouseholdSystemAdmission,
  canonicalSourceId: Schema.String.pipe(
    Schema.check(
      Schema.isTrimmed(),
      Schema.isNonEmpty(),
      Schema.isMaxLength(512)
    )
  ),
  canonicalUrl: CanonicalTikTokUrl,
  expectedGeneration: PositiveSafeInteger,
  intentId: RecipeImportIntentId,
  mutationId: HouseholdImportMutationId,
  sourceKind: Schema.Literals(["video", "carousel"]),
}).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));
export type HouseholdResolveRecipeImportSourceInput =
  typeof HouseholdResolveRecipeImportSourceInput.Type;

export const HouseholdCommitRecipeImportDraftInput = Schema.Struct({
  admission: HouseholdSystemAdmission,
  evidenceFingerprint: Sha256Hex,
  expectedGeneration: PositiveSafeInteger,
  extractionFingerprint: Sha256Hex,
  intentId: RecipeImportIntentId,
  mutationId: HouseholdImportMutationId,
  review: RecipeReviewActionView,
}).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));
export type HouseholdCommitRecipeImportDraftInput =
  typeof HouseholdCommitRecipeImportDraftInput.Type;

export const HouseholdRecipeImportLifecycleTransition = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal("AdvanceStage"),
    stage: Schema.Literals([
      "analyzing_evidence",
      "extracting_recipe",
      "grounding_recipe",
      "preparing_review",
    ]),
  }),
  Schema.Struct({
    _tag: Schema.Literal("AdvanceComponent"),
    component: Schema.Literals(["speech", "visuals"]),
    progress: StepProgress,
  }),
  Schema.Struct({
    _tag: Schema.Literal("SetActivity"),
    activity: Schema.Literals(["working", "retrying"]),
    attempt: PositiveSafeInteger,
    boundary: Schema.Literals([
      "acquisition",
      "speech",
      "visual",
      "recipe",
      "executor",
    ]),
  }),
  Schema.Struct({
    _tag: Schema.Literal("Fail"),
    attemptIdentity: Schema.String.pipe(
      Schema.check(
        Schema.isTrimmed(),
        Schema.isNonEmpty(),
        Schema.isMaxLength(256)
      )
    ),
    boundary: Schema.Literals([
      "acquisition",
      "speech",
      "visual",
      "recipe",
      "executor",
    ]),
    code: StablePublicErrorCode,
    message: Schema.String.pipe(
      Schema.check(
        Schema.isTrimmed(),
        Schema.isNonEmpty(),
        Schema.isMaxLength(4096)
      )
    ),
    recovery: RecoveryGuidance,
  }),
]);
export type HouseholdRecipeImportLifecycleTransition =
  typeof HouseholdRecipeImportLifecycleTransition.Type;

export const HouseholdTransitionRecipeImportLifecycleInput = Schema.Struct({
  admission: HouseholdSystemAdmission,
  expectedGeneration: PositiveSafeInteger,
  intentId: RecipeImportIntentId,
  transition: HouseholdRecipeImportLifecycleTransition,
}).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));
export type HouseholdTransitionRecipeImportLifecycleInput =
  typeof HouseholdTransitionRecipeImportLifecycleInput.Type;

export const HouseholdReadRecipeImportExecutionInput = Schema.Struct({
  admission: HouseholdSystemAdmission,
  expectedGeneration: PositiveSafeInteger,
  intentId: RecipeImportIntentId,
}).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));
export type HouseholdReadRecipeImportExecutionInput =
  typeof HouseholdReadRecipeImportExecutionInput.Type;

export const HouseholdRecipeImportExecutionView = Schema.Struct({
  acquisitionAttemptGeneration: Schema.NullOr(PositiveSafeInteger),
  canonicalSourceId:
    HouseholdResolveRecipeImportSourceInput.fields.canonicalSourceId,
  executionGeneration: PositiveSafeInteger,
  intentId: RecipeImportIntentId,
  originalTrace: ImportTraceContext,
  sourceKind: HouseholdResolveRecipeImportSourceInput.fields.sourceKind,
  submittedSourceUrl: Schema.String.pipe(
    Schema.check(
      Schema.isTrimmed(),
      Schema.isNonEmpty(),
      Schema.isMaxLength(2048)
    )
  ),
  workflowIdentity: ImportWorkflowIdentity,
});
export type HouseholdRecipeImportExecutionView =
  typeof HouseholdRecipeImportExecutionView.Type;

export const HouseholdAnswerRecipeImportActionInput = Schema.Struct({
  actionId: RecipeImportActionId,
  admission: HouseholdMemberAdmission,
  idempotencyKey: IdempotencyKey,
  intentId: RecipeImportIntentId,
  request: AnswerReviewRecipeActionRequest,
}).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));
export type HouseholdAnswerRecipeImportActionInput =
  typeof HouseholdAnswerRecipeImportActionInput.Type;

export const HouseholdConfirmRecipeImportActionInput = Schema.Struct({
  actionId: RecipeImportActionId,
  admission: HouseholdMemberAdmission,
  idempotencyKey: IdempotencyKey,
  intentId: RecipeImportIntentId,
  request: ConfirmRecipeImportActionRequest,
}).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));
export type HouseholdConfirmRecipeImportActionInput =
  typeof HouseholdConfirmRecipeImportActionInput.Type;

export const HouseholdCancelRecipeImportInput = Schema.Struct({
  admission: HouseholdMemberAdmission,
  idempotencyKey: IdempotencyKey,
  intentId: RecipeImportIntentId,
  request: CancelRecipeImportIntentRequest,
}).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));
export type HouseholdCancelRecipeImportInput =
  typeof HouseholdCancelRecipeImportInput.Type;

export const HouseholdReadRecipeImportInput = Schema.Struct({
  admission: HouseholdMemberAdmission,
  intentId: RecipeImportIntentId,
}).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));
export type HouseholdReadRecipeImportInput =
  typeof HouseholdReadRecipeImportInput.Type;

export const HouseholdReadRecipeImportActionInput = Schema.Struct({
  actionId: RecipeImportActionId,
  admission: HouseholdMemberAdmission,
  intentId: RecipeImportIntentId,
}).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));
export type HouseholdReadRecipeImportActionInput =
  typeof HouseholdReadRecipeImportActionInput.Type;

export const HouseholdReadRecipeInput = Schema.Struct({
  admission: HouseholdMemberAdmission,
  recipeId: Recipe.fields.id,
}).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));
export type HouseholdReadRecipeInput = typeof HouseholdReadRecipeInput.Type;

export const HouseholdRecipePageCursor = Schema.String.pipe(
  Schema.check(Schema.isUUID()),
  Schema.brand("HouseholdRecipePageCursor")
);
export const householdRecipeMaximumEncodedBytes = 500_000;
export const householdRecipePlanningPageByteLimit = 524_288;
export const HouseholdRecipePageInput = Schema.Struct({
  admission: HouseholdMemberAdmission,
  byteLimit: Schema.Int.pipe(
    Schema.check(
      Schema.isGreaterThanOrEqualTo(1024),
      Schema.isLessThanOrEqualTo(1_048_576)
    )
  ),
  cursor: Schema.NullOr(HouseholdRecipePageCursor),
  limit: Schema.Int.pipe(
    Schema.check(
      Schema.isGreaterThanOrEqualTo(1),
      Schema.isLessThanOrEqualTo(100)
    )
  ),
}).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));
export type HouseholdRecipePageInput = typeof HouseholdRecipePageInput.Type;

export const HouseholdRecipePage = Schema.Struct({
  items: Schema.Array(MealPlanRecipeSnapshot),
  nextCursor: Schema.NullOr(HouseholdRecipePageCursor),
});
export type HouseholdRecipePage = typeof HouseholdRecipePage.Type;

export const HouseholdRecipeImportIntentResult = Schema.Struct({
  intent: RecipeImportIntent,
});
export const HouseholdRecipeImportActionResult = Schema.Struct({
  action: RecipeImportAction,
});
export const HouseholdActiveRecipeImportActionResult = Schema.Struct({
  action: ActiveRecipeImportAction,
  intent: RecipeImportIntent,
});
export const HouseholdRecipeImportTimelineResult = Schema.Struct({
  timeline: RecipeImportTimeline,
});

export const HouseholdRecipeImportFailure = Schema.TaggedStruct(
  "HouseholdRecipeImportFailure",
  {
    reason: Schema.Literals([
      "action_not_found",
      "generation_conflict",
      "idempotency_conflict",
      "illegal_transition",
      "intent_not_found",
      "invalid_input",
      "persistence_unavailable",
      "recipe_not_found",
      "version_conflict",
    ]),
  }
);
export type HouseholdRecipeImportFailure =
  typeof HouseholdRecipeImportFailure.Type;

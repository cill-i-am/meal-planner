/* eslint-disable max-classes-per-file -- This shared protocol module owns its related Schema-backed middleware and client service tags. */
import { Context, Layer, Schema } from "effect";
import {
  HttpApi,
  HttpApiClient,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiMiddleware,
  HttpApiSchema,
  OpenApi,
} from "effect/unstable/httpapi";

const TrimmedNonEmptyString = Schema.String.pipe(
  Schema.check(Schema.isTrimmed(), Schema.isNonEmpty())
);
const ShortText = TrimmedNonEmptyString.pipe(
  Schema.check(Schema.isMaxLength(4096))
);
const SafeInteger = Schema.Number.pipe(
  Schema.check(
    Schema.isInt(),
    Schema.isGreaterThanOrEqualTo(0),
    Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER)
  )
);
const PublicRelativeLink = Schema.String.pipe(
  Schema.check(
    Schema.isMaxLength(512),
    Schema.isPattern(/^\/v1\/[a-z\d][a-z\d/_-]*$/u)
  ),
  Schema.brand("PublicRelativeLink")
);

export const RecipeImportIntentId = Schema.String.pipe(
  Schema.check(Schema.isUUID()),
  Schema.brand("RecipeImportIntentId")
);
export type RecipeImportIntentId = typeof RecipeImportIntentId.Type;

export const RecipeImportIntentVersion = Schema.Number.pipe(
  Schema.check(
    Schema.isInt(),
    Schema.isGreaterThanOrEqualTo(1),
    Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER)
  ),
  Schema.brand("RecipeImportIntentVersion")
);
export type RecipeImportIntentVersion = typeof RecipeImportIntentVersion.Type;

export const RecipeImportActionVersion = Schema.Number.pipe(
  Schema.check(
    Schema.isInt(),
    Schema.isGreaterThanOrEqualTo(1),
    Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER)
  ),
  Schema.brand("RecipeImportActionVersion")
);
export type RecipeImportActionVersion = typeof RecipeImportActionVersion.Type;

export const RecipeImportActionId = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[a-f\d]{64}$/u)),
  Schema.brand("RecipeImportActionId")
);
export type RecipeImportActionId = typeof RecipeImportActionId.Type;

export const IdempotencyKey = TrimmedNonEmptyString.pipe(
  Schema.check(Schema.isMaxLength(128)),
  Schema.brand("IdempotencyKey")
);
export type IdempotencyKey = typeof IdempotencyKey.Type;

export const RecipeId = Schema.String.pipe(
  Schema.check(Schema.isUUID()),
  Schema.brand("RecipeId")
);
export type RecipeId = typeof RecipeId.Type;

const RecipeImportPrincipalDigest = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[a-f\d]{64}$/u))
);
export const RecipeImportActorId = RecipeImportPrincipalDigest.pipe(
  Schema.brand("RecipeImportActorId")
);
export type RecipeImportActorId = typeof RecipeImportActorId.Type;
export const RecipeImportHouseholdScopeId = RecipeImportPrincipalDigest.pipe(
  Schema.brand("RecipeImportHouseholdScopeId")
);
export type RecipeImportHouseholdScopeId =
  typeof RecipeImportHouseholdScopeId.Type;
export const RecipeImportPrincipal = Schema.Struct({
  actorId: RecipeImportActorId,
  householdScopeId: RecipeImportHouseholdScopeId,
});
export type RecipeImportPrincipal = typeof RecipeImportPrincipal.Type;

export class RecipeImportCurrentPrincipal extends Context.Service<
  RecipeImportCurrentPrincipal,
  RecipeImportPrincipal
>()("meal-planner/RecipeImportCurrentPrincipal") {}

export const Instant = Schema.DateTimeUtcFromString.pipe(
  Schema.brand("RecipeImportInstant")
);
export type Instant = typeof Instant.Type;

export const SourceUrl = TrimmedNonEmptyString.pipe(
  Schema.check(
    Schema.isMaxLength(2048),
    Schema.makeFilter<string>(
      (value) => {
        try {
          return new URL(value).protocol === "https:";
        } catch {
          return false;
        }
      },
      { expected: "an absolute HTTPS URL" },
      true
    )
  ),
  Schema.brand("RecipeImportSourceUrl")
);
export type SourceUrl = typeof SourceUrl.Type;

export const CanonicalTikTokUrl = Schema.String.pipe(
  Schema.check(
    Schema.isMaxLength(512),
    Schema.makeFilter<string>(
      (value) => {
        try {
          const url = new URL(value);
          return (
            url.protocol === "https:" &&
            (url.hostname === "tiktok.com" ||
              url.hostname.endsWith(".tiktok.com")) &&
            url.port === "" &&
            url.username === "" &&
            url.password === "" &&
            url.search === "" &&
            url.hash === ""
          );
        } catch {
          return false;
        }
      },
      { expected: "a sanitized canonical TikTok HTTPS URL" },
      true
    )
  ),
  Schema.brand("CanonicalTikTokUrl")
);
export type CanonicalTikTokUrl = typeof CanonicalTikTokUrl.Type;

export const PendingPublicSourceSummary = Schema.Struct({
  kind: Schema.Literal("tiktok"),
  resolution: Schema.Literal("pending"),
});
export const ResolvedPublicSourceSummary = Schema.Struct({
  canonicalUrl: CanonicalTikTokUrl,
  kind: Schema.Literal("tiktok"),
  resolution: Schema.Literal("resolved"),
});
export const PublicSourceSummary = Schema.Union([
  PendingPublicSourceSummary,
  ResolvedPublicSourceSummary,
]);
export type PublicSourceSummary = typeof PublicSourceSummary.Type;

export const CreateRecipeImportIntentRequest = Schema.Struct({
  source: Schema.Struct({ kind: Schema.Literal("tiktok"), url: SourceUrl }),
}).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));
export type CreateRecipeImportIntentRequest =
  typeof CreateRecipeImportIntentRequest.Type;

export const StepProgress = Schema.Literals([
  "not_started",
  "processing",
  "completed",
  "skipped",
]);
export type StepProgress = typeof StepProgress.Type;

const ProcessingStageCommon = { startedAt: Instant };
export const ResolvingSourceStage = Schema.Struct({
  ...ProcessingStageCommon,
  type: Schema.Literal("resolving_source"),
});
export const ResolvedProcessingStage = Schema.Union([
  Schema.Struct({
    ...ProcessingStageCommon,
    sourceKind: Schema.Literals(["video", "carousel"]),
    type: Schema.Literal("acquiring_media"),
  }),
  Schema.Struct({
    ...ProcessingStageCommon,
    speech: StepProgress,
    type: Schema.Literal("analyzing_evidence"),
    visuals: StepProgress,
  }),
  ...(
    [
      "extracting_recipe",
      "grounding_recipe",
      "preparing_review",
      "finalizing_recipe",
    ] as const
  ).map((type) =>
    Schema.Struct({ ...ProcessingStageCommon, type: Schema.Literal(type) })
  ),
]);
export const ProcessingStage = Schema.Union([
  ResolvingSourceStage,
  ResolvedProcessingStage,
]);
export type ProcessingStage = typeof ProcessingStage.Type;

export const ProcessingActivity = Schema.Union([
  Schema.Struct({ type: Schema.Literal("working") }),
  Schema.Struct({
    nextAttemptAt: Schema.optionalKey(Instant),
    type: Schema.Literal("retrying"),
  }),
]);
export type ProcessingActivity = typeof ProcessingActivity.Type;

export const ReviewRecipeActionReference = Schema.Struct({
  id: RecipeImportActionId,
  link: PublicRelativeLink,
  type: Schema.Literal("review_recipe"),
});
export type ReviewRecipeActionReference =
  typeof ReviewRecipeActionReference.Type;

const IntentCommon = {
  createdAt: Instant,
  id: RecipeImportIntentId,
  intentVersion: RecipeImportIntentVersion,
  links: Schema.Struct({
    self: PublicRelativeLink,
    timeline: PublicRelativeLink,
  }),
  object: Schema.Literal("recipe_import_intent"),
  source: PublicSourceSummary,
  updatedAt: Instant,
};

export const StablePublicErrorCode = Schema.Literals([
  "source_unavailable",
  "unsupported_source",
  "invalid_media",
  "analysis_failed",
  "recipe_extraction_failed",
  "internal_error",
]);
export type StablePublicErrorCode = typeof StablePublicErrorCode.Type;

export const RecoveryGuidance = Schema.Literals([
  "create_new_intent",
  "contact_support",
  "none",
]);
export type RecoveryGuidance = typeof RecoveryGuidance.Type;

export const ProcessingRecipeImportIntent = Schema.Union([
  Schema.Struct({
    ...IntentCommon,
    activity: ProcessingActivity,
    processing: ResolvingSourceStage,
    source: PendingPublicSourceSummary,
    status: Schema.Literal("processing"),
  }),
  Schema.Struct({
    ...IntentCommon,
    activity: ProcessingActivity,
    processing: ResolvedProcessingStage,
    source: ResolvedPublicSourceSummary,
    status: Schema.Literal("processing"),
  }),
]);
export type ProcessingRecipeImportIntent =
  typeof ProcessingRecipeImportIntent.Type;

export const RequiresActionRecipeImportIntent = Schema.Struct({
  ...IntentCommon,
  action: ReviewRecipeActionReference,
  source: ResolvedPublicSourceSummary,
  status: Schema.Literal("requires_action"),
});
export type RequiresActionRecipeImportIntent =
  typeof RequiresActionRecipeImportIntent.Type;

export const SucceededRecipeImportIntent = Schema.Struct({
  ...IntentCommon,
  completedAt: Instant,
  result: Schema.Struct({ recipeId: RecipeId }),
  source: ResolvedPublicSourceSummary,
  status: Schema.Literal("succeeded"),
});
export type SucceededRecipeImportIntent =
  typeof SucceededRecipeImportIntent.Type;

export const FailedRecipeImportIntent = Schema.Struct({
  ...IntentCommon,
  error: Schema.Struct({
    code: StablePublicErrorCode,
    message: ShortText,
    recovery: RecoveryGuidance,
  }),
  failedAt: Instant,
  status: Schema.Literal("failed"),
});
export type FailedRecipeImportIntent = typeof FailedRecipeImportIntent.Type;

export const CancelledRecipeImportIntent = Schema.Struct({
  ...IntentCommon,
  cancelledAt: Instant,
  status: Schema.Literal("cancelled"),
});
export type CancelledRecipeImportIntent =
  typeof CancelledRecipeImportIntent.Type;

export const RecipeImportRedirect = Schema.Struct({
  intentId: RecipeImportIntentId,
  link: PublicRelativeLink,
});
export type RecipeImportRedirect = typeof RecipeImportRedirect.Type;

export const RedirectedRecipeImportIntent = Schema.Struct({
  ...IntentCommon,
  redirect: RecipeImportRedirect,
  redirectedAt: Instant,
  source: ResolvedPublicSourceSummary,
  status: Schema.Literal("redirected"),
});
export type RedirectedRecipeImportIntent =
  typeof RedirectedRecipeImportIntent.Type;

export const RecipeImportIntent = Schema.Union([
  ProcessingRecipeImportIntent,
  RequiresActionRecipeImportIntent,
  SucceededRecipeImportIntent,
  FailedRecipeImportIntent,
  CancelledRecipeImportIntent,
  RedirectedRecipeImportIntent,
]);
export type RecipeImportIntent = typeof RecipeImportIntent.Type;

export const RecipeEditableField = Schema.Literals([
  "author",
  "category",
  "cook_time_minutes",
  "cuisine",
  "description",
  "ingredient_lines",
  "ingredient_quantities",
  "ingredient_units",
  "instructions",
  "name",
  "nutrition",
  "prep_time_minutes",
  "temperature_celsius",
  "tools",
  "total_time_minutes",
  "yield",
]);
export type RecipeEditableField = typeof RecipeEditableField.Type;

export const RecipeReviewEditableField = Schema.Literals([
  "author",
  "category",
  "cook_time_minutes",
  "cuisine",
  "description",
  "ingredient_lines",
  "ingredient_quantities",
  "ingredient_units",
  "instructions",
  "name",
  "nutrition",
  "prep_time_minutes",
  "temperature_celsius",
  "tools",
  "total_time_minutes",
  "yield",
  "tags",
]);
export type RecipeReviewEditableField = typeof RecipeReviewEditableField.Type;

export const PlanningDietaryFit = Schema.Literals([
  "household_match",
  "needs_adaptation",
  "not_suitable",
]);
export type PlanningDietaryFit = typeof PlanningDietaryFit.Type;

export const PlanningDifficulty = Schema.Literals(["easy", "medium", "hard"]);
export type PlanningDifficulty = typeof PlanningDifficulty.Type;

export const PlanningLeftovers = Schema.Literals([
  "none",
  "one_meal",
  "two_plus_meals",
]);
export type PlanningLeftovers = typeof PlanningLeftovers.Type;

export const PlanningMealType = Schema.Literals([
  "breakfast",
  "lunch",
  "dinner",
  "snack",
  "dessert",
]);
export type PlanningMealType = typeof PlanningMealType.Type;

export const PlanningTotalTimeBand = Schema.Literals([
  "under_30_minutes",
  "30_to_60_minutes",
  "over_60_minutes",
  "unknown",
]);
export type PlanningTotalTimeBand = typeof PlanningTotalTimeBand.Type;

export const PlanningTags = Schema.Struct({
  cuisines: Schema.NonEmptyArray(TrimmedNonEmptyString).pipe(
    Schema.check(Schema.isMaxLength(8))
  ),
  dietaryFit: PlanningDietaryFit,
  difficulty: PlanningDifficulty,
  leftovers: PlanningLeftovers,
  mealTypes: Schema.NonEmptyArray(PlanningMealType).pipe(
    Schema.check(Schema.isMaxLength(5))
  ),
  totalTimeBand: PlanningTotalTimeBand,
});
export type PlanningTags = typeof PlanningTags.Type;

export const CorrectedRecipe = Schema.Struct({
  author: Schema.NullOr(ShortText),
  category: Schema.NullOr(ShortText),
  cookTimeMinutes: Schema.NullOr(SafeInteger),
  cuisine: Schema.NullOr(ShortText),
  description: Schema.NullOr(ShortText),
  ingredientLines: Schema.NullOr(Schema.NonEmptyArray(ShortText)),
  ingredientQuantities: Schema.NullOr(Schema.NonEmptyArray(ShortText)),
  ingredientUnits: Schema.NullOr(Schema.NonEmptyArray(ShortText)),
  instructions: Schema.NullOr(Schema.NonEmptyArray(ShortText)),
  name: Schema.NullOr(ShortText),
  nutrition: Schema.NullOr(ShortText),
  prepTimeMinutes: Schema.NullOr(SafeInteger),
  temperatureCelsius: Schema.NullOr(SafeInteger),
  tools: Schema.NullOr(Schema.NonEmptyArray(ShortText)),
  totalTimeMinutes: Schema.NullOr(SafeInteger),
  yield: Schema.NullOr(ShortText),
});
export type CorrectedRecipe = typeof CorrectedRecipe.Type;

const TextRecipeAnswerField = Schema.Literals([
  "author",
  "category",
  "cuisine",
  "description",
  "name",
  "nutrition",
  "yield",
]);
const IntegerRecipeAnswerField = Schema.Literals([
  "cook_time_minutes",
  "prep_time_minutes",
  "temperature_celsius",
  "total_time_minutes",
]);
const ListRecipeAnswerField = Schema.Literals([
  "ingredient_lines",
  "ingredient_quantities",
  "ingredient_units",
  "instructions",
  "tools",
]);

export const RecipeReviewAnswer = Schema.Union([
  Schema.Struct({ field: TextRecipeAnswerField, value: ShortText }),
  Schema.Struct({ field: IntegerRecipeAnswerField, value: SafeInteger }),
  Schema.Struct({
    field: ListRecipeAnswerField,
    value: Schema.NonEmptyArray(ShortText).pipe(
      Schema.check(Schema.isMaxLength(256))
    ),
  }),
  Schema.Struct({ field: Schema.Literal("tags"), value: PlanningTags }),
]);
export type RecipeReviewAnswer = typeof RecipeReviewAnswer.Type;

const UniqueRecipeReviewAnswers = Schema.NonEmptyArray(RecipeReviewAnswer).pipe(
  Schema.check(
    Schema.makeFilter<readonly RecipeReviewAnswer[]>(
      (answers) =>
        new Set(answers.map(({ field }) => field)).size === answers.length,
      { expected: "one answer per editable recipe field" },
      true
    )
  )
);

export const RecipeReviewActionView = Schema.Struct({
  answers: Schema.Array(RecipeReviewAnswer),
  blockers: Schema.Struct({
    invalidFields: Schema.Array(RecipeEditableField),
    unresolvedRequiredFields: Schema.Array(RecipeEditableField),
  }),
  editableFields: Schema.NonEmptyArray(RecipeReviewEditableField),
  recipe: CorrectedRecipe,
  tags: Schema.NullOr(PlanningTags),
});
export type RecipeReviewActionView = typeof RecipeReviewActionView.Type;

const RecipeImportActionCommon = {
  actionVersion: RecipeImportActionVersion,
  id: RecipeImportActionId,
  intentId: RecipeImportIntentId,
  object: Schema.Literal("recipe_import_action"),
  review: RecipeReviewActionView,
  type: Schema.Literal("review_recipe"),
};
export const ActiveRecipeImportAction = Schema.Struct({
  ...RecipeImportActionCommon,
  status: Schema.Literal("active"),
});
export const CompletedRecipeImportAction = Schema.Struct({
  ...RecipeImportActionCommon,
  completion: Schema.Struct({
    confirmedAt: Instant,
    type: Schema.Literal("confirmed"),
  }),
  status: Schema.Literal("completed"),
});
export const RecipeImportAction = Schema.Union([
  ActiveRecipeImportAction,
  CompletedRecipeImportAction,
]);
export type RecipeImportAction = typeof RecipeImportAction.Type;

export const AnswerReviewRecipeActionRequest = Schema.Struct({
  answers: UniqueRecipeReviewAnswers,
  expectedActionVersion: RecipeImportActionVersion,
}).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));
export type AnswerReviewRecipeActionRequest =
  typeof AnswerReviewRecipeActionRequest.Type;

export const ConfirmRecipeImportActionRequest = Schema.Struct({
  expectedActionVersion: RecipeImportActionVersion,
}).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));
export type ConfirmRecipeImportActionRequest =
  typeof ConfirmRecipeImportActionRequest.Type;

export const CancelRecipeImportIntentRequest = Schema.Struct({
  expectedIntentVersion: RecipeImportIntentVersion,
}).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));
export type CancelRecipeImportIntentRequest =
  typeof CancelRecipeImportIntentRequest.Type;

const TimelineEventCommon = {
  at: Instant,
  intentVersion: RecipeImportIntentVersion,
};
export const RecipeImportTimelineEvent = Schema.Union([
  Schema.Struct({
    ...TimelineEventCommon,
    type: Schema.Literal("intent_admitted"),
  }),
  Schema.Struct({
    ...TimelineEventCommon,
    canonicalUrl: CanonicalTikTokUrl,
    type: Schema.Literal("source_resolved"),
  }),
  Schema.Struct({
    ...TimelineEventCommon,
    redirect: RecipeImportRedirect,
    type: Schema.Literal("intent_redirected"),
  }),
  Schema.Struct({
    ...TimelineEventCommon,
    processing: ProcessingStage,
    type: Schema.Literal("processing_stage_changed"),
  }),
  Schema.Struct({
    ...TimelineEventCommon,
    nextAttemptAt: Schema.optionalKey(Instant),
    type: Schema.Literal("retrying"),
  }),
  Schema.Struct({
    ...TimelineEventCommon,
    type: Schema.Literal("recovered"),
  }),
  Schema.Struct({
    ...TimelineEventCommon,
    action: ReviewRecipeActionReference,
    type: Schema.Literal("action_available"),
  }),
  Schema.Struct({
    ...TimelineEventCommon,
    recipeId: RecipeId,
    type: Schema.Literal("intent_succeeded"),
  }),
  Schema.Struct({
    ...TimelineEventCommon,
    code: StablePublicErrorCode,
    type: Schema.Literal("intent_failed"),
  }),
  Schema.Struct({
    ...TimelineEventCommon,
    type: Schema.Literal("intent_cancelled"),
  }),
]);
export type RecipeImportTimelineEvent = typeof RecipeImportTimelineEvent.Type;

export const RecipeImportTimeline = Schema.Struct({
  data: Schema.Array(RecipeImportTimelineEvent),
  object: Schema.Literal("list"),
});
export type RecipeImportTimeline = typeof RecipeImportTimeline.Type;

export const Recipe = Schema.Struct({
  id: RecipeId,
  object: Schema.Literal("recipe"),
  recipe: CorrectedRecipe,
  tags: PlanningTags,
});
export type Recipe = typeof Recipe.Type;

const ProblemType = Schema.String.pipe(
  Schema.check(
    Schema.isPattern(/^https:\/\/meal-planner\.local\/problems\/[a-z\d-]+$/u)
  )
);
const TraceId = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[a-z\d][a-z\d._:-]{0,127}$/iu))
);
const ProblemDetailsCommon = {
  detail: ShortText,
  title: ShortText,
  traceId: Schema.optionalKey(TraceId),
  type: ProblemType,
};
const exactProblemDetails = <Status extends number, Code extends string>(
  status: Status,
  code: Code
) =>
  Schema.Struct({
    ...ProblemDetailsCommon,
    code: Schema.Literal(code),
    status: Schema.Literal(status),
  });

export const InvalidRequestProblemDetails = exactProblemDetails(
  400,
  "invalid_request"
);
export const UnauthorizedProblemDetails = exactProblemDetails(
  401,
  "unauthorized"
);
export const IntentNotFoundProblemDetails = exactProblemDetails(
  404,
  "intent_not_found"
);
export const ActionNotFoundProblemDetails = exactProblemDetails(
  404,
  "action_not_found"
);
export const RecipeNotFoundProblemDetails = exactProblemDetails(
  404,
  "recipe_not_found"
);
export const IdempotencyConflictProblemDetails = exactProblemDetails(
  409,
  "idempotency_conflict"
);
export const VersionConflictProblemDetails = exactProblemDetails(
  409,
  "version_conflict"
);
export const IllegalTransitionProblemDetails = exactProblemDetails(
  409,
  "illegal_transition"
);
export const InternalErrorProblemDetails = exactProblemDetails(
  500,
  "internal_error"
);

export const ProblemDetails = Schema.Union([
  InvalidRequestProblemDetails,
  UnauthorizedProblemDetails,
  IntentNotFoundProblemDetails,
  ActionNotFoundProblemDetails,
  RecipeNotFoundProblemDetails,
  IdempotencyConflictProblemDetails,
  VersionConflictProblemDetails,
  IllegalTransitionProblemDetails,
  InternalErrorProblemDetails,
]);
export type ProblemDetails = typeof ProblemDetails.Type;

export const IntentRedirectedProblem = Schema.Struct({
  code: Schema.Literal("intent_redirected"),
  detail: ShortText,
  intent: RedirectedRecipeImportIntent,
  redirect: RecipeImportRedirect,
  status: Schema.Literal(409),
  title: ShortText,
  traceId: Schema.optionalKey(TraceId),
  type: ProblemType,
});
export type IntentRedirectedProblem = typeof IntentRedirectedProblem.Type;

const asProblemJson = <S extends Schema.Top>(schema: S) =>
  schema.pipe(
    HttpApiSchema.asJson({ contentType: "application/problem+json" })
  );
const BadRequestProblem = asProblemJson(InvalidRequestProblemDetails).pipe(
  HttpApiSchema.status(400)
);
const UnauthorizedProblem = asProblemJson(UnauthorizedProblemDetails).pipe(
  HttpApiSchema.status(401)
);
const IntentNotFoundProblem = asProblemJson(IntentNotFoundProblemDetails).pipe(
  HttpApiSchema.status(404)
);
const ActionNotFoundProblem = asProblemJson(ActionNotFoundProblemDetails).pipe(
  HttpApiSchema.status(404)
);
const RecipeNotFoundProblem = asProblemJson(RecipeNotFoundProblemDetails).pipe(
  HttpApiSchema.status(404)
);
const CreateConflictProblem = asProblemJson(
  IdempotencyConflictProblemDetails
).pipe(HttpApiSchema.status(409));
const MutationConflictProblem = Schema.Union([
  IdempotencyConflictProblemDetails,
  VersionConflictProblemDetails,
  IllegalTransitionProblemDetails,
  IntentRedirectedProblem,
]).pipe(
  HttpApiSchema.status(409),
  HttpApiSchema.asJson({ contentType: "application/problem+json" })
);
const InternalProblem = asProblemJson(InternalErrorProblemDetails).pipe(
  HttpApiSchema.status(500)
);

export class RecipeImportSessionAuth extends HttpApiMiddleware.Service<
  RecipeImportSessionAuth,
  { provides: RecipeImportCurrentPrincipal }
>()("RecipeImportSessionAuth", {
  error: UnauthorizedProblem,
}) {}

export class RecipeImportSchemaErrors extends HttpApiMiddleware.Service<RecipeImportSchemaErrors>()(
  "RecipeImportSchemaErrors",
  { error: BadRequestProblem }
) {}

export class RecipeImportDefectBoundary extends HttpApiMiddleware.Service<RecipeImportDefectBoundary>()(
  "RecipeImportDefectBoundary"
) {}

const IdParams = { id: RecipeImportIntentId };
const ActionParams = { ...IdParams, actionId: RecipeImportActionId };
const RetryAfterHeader = Schema.Number.pipe(
  Schema.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1))
);
const CreateIntentSuccess = HttpApiSchema.WithHeaders(
  ProcessingRecipeImportIntent.pipe(HttpApiSchema.status(201)),
  {
    location: PublicRelativeLink,
    "retry-after": RetryAfterHeader,
  }
);
const IntentReadSuccess = HttpApiSchema.WithHeaders(RecipeImportIntent, {
  "retry-after": Schema.optionalKey(RetryAfterHeader),
});
const IdempotencyHeader = { "idempotency-key": IdempotencyKey };

const RecipeImportIntentsGroup = HttpApiGroup.make("recipeImportIntents")
  .add(
    HttpApiEndpoint.post("create", "/v1/recipe-import-intents", {
      error: [BadRequestProblem, CreateConflictProblem, InternalProblem],
      headers: IdempotencyHeader,
      payload: CreateRecipeImportIntentRequest,
      success: CreateIntentSuccess,
    }),
    HttpApiEndpoint.get("get", "/v1/recipe-import-intents/:id", {
      error: [IntentNotFoundProblem, InternalProblem],
      params: IdParams,
      success: IntentReadSuccess,
    }),
    HttpApiEndpoint.get(
      "getAction",
      "/v1/recipe-import-intents/:id/actions/:actionId",
      {
        error: [ActionNotFoundProblem, InternalProblem],
        params: ActionParams,
        success: RecipeImportAction,
      }
    ),
    HttpApiEndpoint.post(
      "answerAction",
      "/v1/recipe-import-intents/:id/actions/:actionId/answers",
      {
        error: [
          BadRequestProblem,
          ActionNotFoundProblem,
          MutationConflictProblem,
          InternalProblem,
        ],
        headers: IdempotencyHeader,
        params: ActionParams,
        payload: AnswerReviewRecipeActionRequest,
        success: RequiresActionRecipeImportIntent,
      }
    ),
    HttpApiEndpoint.post(
      "confirmAction",
      "/v1/recipe-import-intents/:id/actions/:actionId/confirm",
      {
        error: [
          BadRequestProblem,
          ActionNotFoundProblem,
          MutationConflictProblem,
          InternalProblem,
        ],
        headers: IdempotencyHeader,
        params: ActionParams,
        payload: ConfirmRecipeImportActionRequest,
        success: SucceededRecipeImportIntent,
      }
    ),
    HttpApiEndpoint.post("cancel", "/v1/recipe-import-intents/:id/cancel", {
      error: [
        BadRequestProblem,
        IntentNotFoundProblem,
        MutationConflictProblem,
        InternalProblem,
      ],
      headers: IdempotencyHeader,
      params: IdParams,
      payload: CancelRecipeImportIntentRequest,
      success: CancelledRecipeImportIntent,
    }),
    HttpApiEndpoint.get("timeline", "/v1/recipe-import-intents/:id/timeline", {
      error: [IntentNotFoundProblem, InternalProblem],
      params: IdParams,
      success: RecipeImportTimeline,
    })
  )
  .middleware(RecipeImportSessionAuth)
  .annotate(OpenApi.Title, "Recipe import intents");

const RecipesGroup = HttpApiGroup.make("recipes")
  .add(
    HttpApiEndpoint.get("get", "/v1/recipes/:recipeId", {
      error: [RecipeNotFoundProblem, InternalProblem],
      params: { recipeId: RecipeId },
      success: Recipe,
    })
  )
  .middleware(RecipeImportSessionAuth)
  .annotate(OpenApi.Title, "Recipes");

export const RecipeImportApi = HttpApi.make("recipeImportApi")
  .add(RecipeImportIntentsGroup, RecipesGroup)
  .middleware(RecipeImportSchemaErrors)
  .middleware(RecipeImportDefectBoundary)
  .annotateMerge(
    OpenApi.annotations({
      description:
        "Intent-oriented contract for admitting recipe imports and reading their resulting recipes.",
      title: "Meal Planner Recipe Import API",
      version: "1.0.0",
    })
  );

export type RecipeImportApiClient = HttpApiClient.ForApi<
  typeof RecipeImportApi
>;

export const RecipeImportApiClient = Context.Service<RecipeImportApiClient>(
  "meal-planner/RecipeImportApiClient"
);

export const makeRecipeImportApiClientLayer = (options: {
  readonly baseUrl: string | URL;
}) =>
  Layer.effect(
    RecipeImportApiClient,
    HttpApiClient.make(RecipeImportApi, { baseUrl: options.baseUrl })
  );

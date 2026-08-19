import {
  CanonicalTikTokUrl,
  ProcessingStage,
  RecipeId,
  RecipeImportActionId,
  RecipeImportIntentId,
  RecipeImportIntentVersion,
  RecipeImportTimelineEvent,
  StablePublicErrorCode,
} from "@meal-planner/recipe-import-api";
import type {
  ProcessingStage as ProcessingStageType,
  RecipeImportTimelineEvent as RecipeImportTimelineEventType,
} from "@meal-planner/recipe-import-api";
import { Option, Schema } from "effect";

const NullableString = Schema.NullOr(Schema.String);
const EventType = Schema.Literals([
  "intent_admitted",
  "source_resolved",
  "intent_redirected",
  "processing_stage_changed",
  "retrying",
  "recovered",
  "action_available",
  "intent_succeeded",
  "intent_failed",
  "intent_cancelled",
]);
const PublicStage = Schema.Literals([
  "resolving_source",
  "acquiring_media",
  "analyzing_evidence",
  "extracting_recipe",
  "grounding_recipe",
  "preparing_review",
  "finalizing_recipe",
]);
const StepProgress = Schema.Literals([
  "not_started",
  "processing",
  "completed",
  "skipped",
]);

export const ImportIntentHistoryRow = Schema.Struct({
  actionId: Schema.NullOr(RecipeImportActionId),
  at: Schema.String,
  eventType: EventType,
  failureCode: Schema.NullOr(StablePublicErrorCode),
  intentId: RecipeImportIntentId,
  intentVersion: RecipeImportIntentVersion,
  publicNextAttemptAt: NullableString,
  publicSourceKind: Schema.NullOr(Schema.Literals(["video", "carousel"])),
  publicSourceUrl: Schema.NullOr(CanonicalTikTokUrl),
  publicSpeech: Schema.NullOr(StepProgress),
  publicStage: Schema.NullOr(PublicStage),
  publicStageStartedAt: NullableString,
  publicVisuals: Schema.NullOr(StepProgress),
  recipeId: Schema.NullOr(RecipeId),
  redirectedToIntentId: Schema.NullOr(RecipeImportIntentId),
}).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));
export type ImportIntentHistoryRow = typeof ImportIntentHistoryRow.Type;

const required = <A>(value: A | null, field: string): A => {
  if (value === null) {
    throw new Error(`Recipe import intent history is missing ${field}`);
  }
  return value;
};

const processingStage = (row: ImportIntentHistoryRow): ProcessingStageType => {
  const startedAt = required(row.publicStageStartedAt, "stage start");
  const stage = required(row.publicStage, "stage");
  switch (stage) {
    case "resolving_source": {
      return Schema.decodeUnknownSync(ProcessingStage)({
        startedAt,
        type: "resolving_source",
      });
    }
    case "acquiring_media": {
      return Schema.decodeUnknownSync(ProcessingStage)({
        sourceKind: required(row.publicSourceKind, "source kind"),
        startedAt,
        type: "acquiring_media",
      });
    }
    case "analyzing_evidence": {
      return Schema.decodeUnknownSync(ProcessingStage)({
        speech: required(row.publicSpeech, "speech progress"),
        startedAt,
        type: "analyzing_evidence",
        visuals: required(row.publicVisuals, "visual progress"),
      });
    }
    case "extracting_recipe":
    case "finalizing_recipe":
    case "grounding_recipe":
    case "preparing_review": {
      return Schema.decodeUnknownSync(ProcessingStage)({
        startedAt,
        type: stage,
      });
    }
    default: {
      return stage satisfies never;
    }
  }
};

const decodeEvent = Schema.decodeUnknownSync(RecipeImportTimelineEvent, {
  onExcessProperty: "error",
});

export const projectImportIntentHistoryRow = (
  row: ImportIntentHistoryRow
): Option.Option<RecipeImportTimelineEventType> => {
  const common = { at: row.at, intentVersion: row.intentVersion };
  switch (row.eventType) {
    case "intent_admitted": {
      return Option.some(decodeEvent({ ...common, type: row.eventType }));
    }
    case "source_resolved": {
      return Option.some(
        decodeEvent({
          ...common,
          canonicalUrl: required(row.publicSourceUrl, "canonical URL"),
          type: row.eventType,
        })
      );
    }
    case "intent_redirected": {
      const intentId = required(
        row.redirectedToIntentId,
        "redirected intent identity"
      );
      return Option.some(
        decodeEvent({
          ...common,
          redirect: {
            intentId,
            link: `/v1/recipe-import-intents/${intentId}`,
          },
          type: row.eventType,
        })
      );
    }
    case "processing_stage_changed": {
      return Option.some(
        decodeEvent({
          ...common,
          processing: Schema.encodeSync(ProcessingStage)(processingStage(row)),
          type: row.eventType,
        })
      );
    }
    case "retrying": {
      const retrying = { ...common, type: row.eventType };
      return Option.some(
        decodeEvent(
          row.publicNextAttemptAt === null
            ? retrying
            : { ...retrying, nextAttemptAt: row.publicNextAttemptAt }
        )
      );
    }
    case "recovered":
    case "intent_cancelled": {
      return Option.some(decodeEvent({ ...common, type: row.eventType }));
    }
    case "action_available": {
      const actionId = required(row.actionId, "action identity");
      return Option.some(
        decodeEvent({
          ...common,
          action: {
            id: actionId,
            link: `/v1/recipe-import-intents/${row.intentId}/actions/${actionId}`,
            type: "review_recipe",
          },
          type: row.eventType,
        })
      );
    }
    case "intent_succeeded": {
      return Option.some(
        decodeEvent({
          ...common,
          recipeId: required(row.recipeId, "recipe identity"),
          type: row.eventType,
        })
      );
    }
    case "intent_failed": {
      return Option.some(
        decodeEvent({
          ...common,
          code: required(row.failureCode, "failure code"),
          type: row.eventType,
        })
      );
    }
    default: {
      return row.eventType satisfies never;
    }
  }
};

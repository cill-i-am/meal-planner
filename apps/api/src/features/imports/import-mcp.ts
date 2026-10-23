import { RecipeContent } from "@meal-planner/recipe-domain";
import type {
  ProcessingRecipeImportIntent,
  RecipeId,
  RecipeImportAction,
  RecipeImportActionId,
  RecipeImportActionVersion,
  RecipeImportIntent,
  RecipeImportIntentId,
  RecipeImportRedirect,
  RecipeImportTimeline,
  RecipeImportTimelineEvent,
  ReviewRecipeActionReference,
  StablePublicErrorCode,
} from "@meal-planner/recipe-import-api";
import { Schema } from "effect";

export type ImportPreparationResult =
  | {
      readonly type: "draft_ready";
      readonly intentId: RecipeImportIntentId;
      readonly action: ReviewRecipeActionReference;
    }
  | {
      readonly type: "published";
      readonly intentId: RecipeImportIntentId;
      readonly recipeId: RecipeId;
    }
  | {
      readonly type: "failed";
      readonly intentId: RecipeImportIntentId;
      readonly code: StablePublicErrorCode;
    }
  | {
      readonly type: "redirected";
      readonly intentId: RecipeImportIntentId;
      readonly redirect: RecipeImportRedirect;
    };

export type ImportPreparationProjection =
  | { readonly _tag: "Working"; readonly intent: ProcessingRecipeImportIntent }
  | {
      readonly _tag: "Completed";
      readonly completedAt: RecipeImportTimelineEvent["at"];
      readonly result: ImportPreparationResult;
      readonly isError: boolean;
    }
  | {
      readonly _tag: "Cancelled";
      readonly completedAt: RecipeImportTimelineEvent["at"];
      readonly intentId: RecipeImportIntentId;
    }
  | {
      readonly _tag: "Unavailable";
      readonly reason: "missing_history" | "inconsistent_history";
    };

const projectPreparationEvent = (
  intentId: RecipeImportIntentId,
  event: RecipeImportTimelineEvent
): Exclude<
  ImportPreparationProjection,
  { readonly _tag: "Working" | "Unavailable" }
> | null => {
  const completedAt = event.at;
  switch (event.type) {
    case "action_available": {
      return {
        _tag: "Completed",
        completedAt,
        isError: false,
        result: { action: event.action, intentId, type: "draft_ready" },
      };
    }
    case "intent_succeeded": {
      return {
        _tag: "Completed",
        completedAt,
        isError: false,
        result: { intentId, recipeId: event.recipeId, type: "published" },
      };
    }
    case "intent_failed": {
      return {
        _tag: "Completed",
        completedAt,
        isError: true,
        result: { code: event.code, intentId, type: "failed" },
      };
    }
    case "intent_redirected": {
      return {
        _tag: "Completed",
        completedAt,
        isError: false,
        result: { intentId, redirect: event.redirect, type: "redirected" },
      };
    }
    case "intent_cancelled": {
      return { _tag: "Cancelled", completedAt, intentId };
    }
    case "intent_admitted":
    case "source_resolved":
    case "processing_stage_changed":
    case "retrying":
    case "recovered": {
      return null;
    }
    default: {
      return event satisfies never;
    }
  }
};

/**
 * Preparation ends at its first terminal event, including draft review. Later
 * publication, cancellation or operator recovery must not rewrite that outcome.
 * Read the intent and its complete timeline for the same household and import;
 * mismatched snapshots fail closed so the caller can reload them.
 */
export const projectImportPreparation = (
  intent: RecipeImportIntent,
  timeline: RecipeImportTimeline
): ImportPreparationProjection => {
  if (timeline.data.length === 0) {
    return { _tag: "Unavailable", reason: "missing_history" };
  }
  if (
    timeline.data[0]?.type !== "intent_admitted" ||
    timeline.data.some((event, index) => event.intentVersion !== index + 1) ||
    timeline.data.length !== intent.intentVersion
  ) {
    return { _tag: "Unavailable", reason: "inconsistent_history" };
  }
  for (const event of timeline.data) {
    const terminal = projectPreparationEvent(intent.id, event);
    if (terminal !== null) {
      return terminal;
    }
  }
  return intent.status === "processing"
    ? { _tag: "Working", intent }
    : { _tag: "Unavailable", reason: "missing_history" };
};

const unavailableMessages = {
  inactive:
    "This review is no longer active. Read the import's current status.",
  preview_too_large:
    "The complete recipe is too large to display here. Open the recipe import in the app to review and publish it.",
  unpublishable:
    "This draft still needs corrections or planning tags. Open the recipe import in the app to finish reviewing it.",
  version_conflict:
    "The recipe changed after this review was requested. Load the current review before confirming.",
} as const;

export type PreparedRecipeReview =
  | {
      readonly _tag: "Ready";
      readonly actionId: RecipeImportActionId;
      readonly actionVersion: RecipeImportActionVersion;
      readonly intentId: RecipeImportIntentId;
      readonly message: string;
    }
  | {
      readonly _tag: "Unavailable";
      readonly message: string;
      readonly reason: keyof typeof unavailableMessages;
    };

const unavailableReview = (reason: keyof typeof unavailableMessages) =>
  ({
    _tag: "Unavailable",
    message: unavailableMessages[reason],
    reason,
  }) as const;

const isPublishableRecipe = Schema.is(RecipeContent);
const maximumPreviewBytes = 64 * 1024;

/**
 * Prepares a complete preview, never publication authority. The confirm command
 * must still enforce authorization, idempotency and this exact action version.
 * Unavailable previews must not be replaced by an implicit confirmation.
 */
export const prepareRecipeReview = (
  action: RecipeImportAction,
  expectedVersion: RecipeImportActionVersion
): PreparedRecipeReview => {
  if (action.status !== "active") {
    return unavailableReview("inactive");
  }
  if (action.actionVersion !== expectedVersion) {
    return unavailableReview("version_conflict");
  }
  const { recipe, tags } = action.review;
  if (tags === null || !isPublishableRecipe(recipe)) {
    return unavailableReview("unpublishable");
  }

  const message = `Publish this recipe to the household recipe bank? This saves the complete recipe and planning tags shown below. Declining or cancelling leaves the draft unchanged.\n\n${JSON.stringify({ recipe, tags }, null, 2)}`;
  if (new TextEncoder().encode(message).byteLength > maximumPreviewBytes) {
    return unavailableReview("preview_too_large");
  }
  return {
    _tag: "Ready",
    actionId: action.id,
    actionVersion: action.actionVersion,
    intentId: action.intentId,
    message,
  };
};

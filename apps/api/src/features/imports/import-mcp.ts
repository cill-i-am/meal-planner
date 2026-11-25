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
) => {
  const completedAt = event.at;
  switch (event.type) {
    case "action_available": {
      const checkedResult: Exclude<
        ImportPreparationProjection,
        { readonly _tag: "Working" | "Unavailable" }
      > | null = {
        _tag: "Completed",
        completedAt,
        isError: false,
        result: { action: event.action, intentId, type: "draft_ready" },
      };
      return checkedResult;
    }
    case "intent_succeeded": {
      const checkedResult: Exclude<
        ImportPreparationProjection,
        { readonly _tag: "Working" | "Unavailable" }
      > | null = {
        _tag: "Completed",
        completedAt,
        isError: false,
        result: { intentId, recipeId: event.recipeId, type: "published" },
      };
      return checkedResult;
    }
    case "intent_failed": {
      const checkedResult: Exclude<
        ImportPreparationProjection,
        { readonly _tag: "Working" | "Unavailable" }
      > | null = {
        _tag: "Completed",
        completedAt,
        isError: true,
        result: { code: event.code, intentId, type: "failed" },
      };
      return checkedResult;
    }
    case "intent_redirected": {
      const checkedResult: Exclude<
        ImportPreparationProjection,
        { readonly _tag: "Working" | "Unavailable" }
      > | null = {
        _tag: "Completed",
        completedAt,
        isError: false,
        result: { intentId, redirect: event.redirect, type: "redirected" },
      };
      return checkedResult;
    }
    case "intent_cancelled": {
      const checkedResult: Exclude<
        ImportPreparationProjection,
        { readonly _tag: "Working" | "Unavailable" }
      > | null = { _tag: "Cancelled", completedAt, intentId };
      return checkedResult;
    }
    case "intent_admitted":
    case "source_resolved":
    case "processing_stage_changed":
    case "retrying":
    case "recovered": {
      const checkedResult: Exclude<
        ImportPreparationProjection,
        { readonly _tag: "Working" | "Unavailable" }
      > | null = null;
      return checkedResult;
    }
    default: {
      const checkedResult: Exclude<
        ImportPreparationProjection,
        { readonly _tag: "Working" | "Unavailable" }
      > | null = event satisfies never;
      return checkedResult;
    }
  }
};

/**
 * Preparation ends at its first terminal event, including draft review. Later
 * publication, cancellation or operator recovery must not rewrite that outcome.
 * Read the intent before its complete timeline for the same household and
 * import. Append-only history may advance between reads and must cover the
 * earlier intent version. Terminal outcomes come from that history; ongoing
 * work retains the earlier intent unchanged, including its mutation version.
 */
export const projectImportPreparation = (
  intent: RecipeImportIntent,
  timeline: RecipeImportTimeline
) => {
  if (timeline.data.length === 0) {
    const checkedResult: ImportPreparationProjection = {
      _tag: "Unavailable",
      reason: "missing_history",
    };
    return checkedResult;
  }
  if (
    timeline.data[0]?.type !== "intent_admitted" ||
    timeline.data.some((event, index) => event.intentVersion !== index + 1) ||
    timeline.data.length < intent.intentVersion
  ) {
    const checkedResult: ImportPreparationProjection = {
      _tag: "Unavailable",
      reason: "inconsistent_history",
    };
    return checkedResult;
  }
  for (const event of timeline.data) {
    const terminal = projectPreparationEvent(intent.id, event);
    if (terminal !== null) {
      const checkedResult: ImportPreparationProjection = terminal;
      return checkedResult;
    }
  }
  {
    const checkedResult: ImportPreparationProjection =
      intent.status === "processing"
        ? { _tag: "Working", intent }
        : { _tag: "Unavailable", reason: "missing_history" };
    return checkedResult;
  }
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
) => {
  if (action.status !== "active") {
    const checkedResult: PreparedRecipeReview = unavailableReview("inactive");
    return checkedResult;
  }
  if (action.actionVersion !== expectedVersion) {
    const checkedResult: PreparedRecipeReview =
      unavailableReview("version_conflict");
    return checkedResult;
  }
  const { recipe, tags } = action.review;
  if (tags === null || !isPublishableRecipe(recipe)) {
    const checkedResult: PreparedRecipeReview =
      unavailableReview("unpublishable");
    return checkedResult;
  }

  const message = `Publish this recipe to the household recipe bank? This saves the complete recipe and planning tags shown below. Declining or cancelling leaves the draft unchanged.\n\n${JSON.stringify({ recipe, tags }, null, 2)}`;
  if (new TextEncoder().encode(message).byteLength > maximumPreviewBytes) {
    const checkedResult: PreparedRecipeReview =
      unavailableReview("preview_too_large");
    return checkedResult;
  }
  {
    const checkedResult: PreparedRecipeReview = {
      _tag: "Ready",
      actionId: action.id,
      actionVersion: action.actionVersion,
      intentId: action.intentId,
      message,
    };
    return checkedResult;
  }
};

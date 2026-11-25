import {
  RecoveryGuidance,
  StablePublicErrorCode,
} from "@meal-planner/recipe-import-api";
import { Schema } from "effect";

import type { AcquisitionTaskOutcome } from "./import-media.model.js";
import type { ProviderTaskStage } from "./import-provider-workflow-task.js";

export const PublicIntentFailure = Schema.Struct({
  code: StablePublicErrorCode,
  message: Schema.String.pipe(
    Schema.check(
      Schema.isTrimmed(),
      Schema.isNonEmpty(),
      Schema.isMaxLength(4096)
    )
  ),
  recovery: RecoveryGuidance,
});
export type PublicIntentFailure = typeof PublicIntentFailure.Type;

const sourceUnavailable = (message: string) => {
  const checkedResult: PublicIntentFailure = {
    code: "source_unavailable",
    message,
    recovery: "create_new_intent",
  };
  return checkedResult;
};

export const publicIntentFailureForAcquisitionOutcome = (
  outcome: Exclude<
    AcquisitionTaskOutcome,
    { readonly _tag: "VerifiedAcquisition" }
  >
) => {
  switch (outcome._tag) {
    case "Unavailable": {
      const checkedResult: PublicIntentFailure = sourceUnavailable(
        "The source is unavailable."
      );
      return checkedResult;
    }
    case "UnsupportedCarousel": {
      const checkedResult: PublicIntentFailure = {
        code: "unsupported_source",
        message: "This source type is not supported.",
        recovery: "create_new_intent",
      };
      return checkedResult;
    }
    case "TerminalMedia": {
      const checkedResult: PublicIntentFailure = {
        code: "invalid_media",
        message: "The source does not contain supported media.",
        recovery: "create_new_intent",
      };
      return checkedResult;
    }
    case "RetryExhausted": {
      const checkedResult: PublicIntentFailure = sourceUnavailable(
        "The source is temporarily unavailable."
      );
      return checkedResult;
    }
    default: {
      const checkedResult: PublicIntentFailure = outcome satisfies never;
      return checkedResult;
    }
  }
};

export const publicIntentFailureForProviderStage = (
  stage: ProviderTaskStage
) => {
  const checkedResult: PublicIntentFailure =
    stage === "recipe"
      ? {
          code: "recipe_extraction_failed",
          message: "A recipe could not be extracted from this source.",
          recovery: "create_new_intent",
        }
      : {
          code: "analysis_failed",
          message: "The source could not be analyzed.",
          recovery: "create_new_intent",
        };
  return checkedResult;
};

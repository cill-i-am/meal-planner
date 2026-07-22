import { Effect, Schema } from "effect";
import { HttpServerResponse } from "effect/unstable/http";

import type { RecipeReviewServiceError } from "./import-recipe-review.js";
import type {
  InvalidImportId,
  InvalidImportRequest,
  UnauthorizedImportCaller,
} from "./import.errors.js";

type PublicRecipeReviewError =
  | InvalidImportId
  | InvalidImportRequest
  | RecipeReviewServiceError
  | UnauthorizedImportCaller;

const problem = (
  status: number,
  code: string,
  message: string,
  details?: Record<string, unknown>,
  headers?: Record<string, string>
) =>
  HttpServerResponse.json(
    { error: { code, message, ...details } },
    { headers, status }
  ).pipe(Effect.orDie);

const publicErrorResponse = (error: PublicRecipeReviewError) => {
  switch (error._tag) {
    case "UnauthorizedImportCaller":
      return problem(
        401,
        "unauthorized",
        "Authentication is required.",
        undefined,
        { "www-authenticate": 'Bearer realm="meal-planner-imports"' }
      );
    case "InvalidImportId":
    case "InvalidImportRequest":
      return problem(400, "invalid_request", "The review request is invalid.");
    case "InvalidRecipeCorrection":
      return problem(
        400,
        "invalid_correction",
        "The correction value does not match its field.",
        { field: error.field }
      );
    case "RecipeReviewNotFound":
      return problem(404, "not_found", "The recipe draft was not found.");
    case "RecipeReviewVersionConflict":
      return problem(
        409,
        "version_conflict",
        "The recipe draft changed before this write was applied.",
        {
          actualVersion: error.actualVersion,
          expectedVersion: error.expectedVersion,
        }
      );
    case "RecipeReviewTransitionRejected":
      return problem(
        409,
        "transition_rejected",
        "The requested lifecycle transition is not allowed.",
        { lifecycle: error.lifecycle }
      );
    case "RecipeApprovalBlocked":
      return problem(
        422,
        "approval_blocked",
        "The draft still has unresolved or invalid required review data.",
        { blockers: error.blockers, tagsRequired: error.tagsRequired }
      );
    case "ImportPersistenceUnavailable":
      return problem(
        503,
        "persistence_unavailable",
        "Recipe review persistence is temporarily unavailable."
      );
    case "ImportPersistenceCorrupt":
      return problem(
        500,
        "internal_error",
        "The recipe review could not be processed."
      );
  }
};

export const respondRecipeReview = <
  S extends Schema.ConstraintEncoder<unknown>,
  E extends PublicRecipeReviewError,
  R,
>(
  effect: Effect.Effect<S["Type"], E, R>,
  schema: S,
  status: number
) =>
  effect.pipe(
    Effect.matchEffect({
      onFailure: publicErrorResponse,
      onSuccess: (value) =>
        HttpServerResponse.json(Schema.encodeSync(schema)(value), {
          status,
        }).pipe(Effect.orDie),
    })
  );

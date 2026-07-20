import { Effect, Schema } from "effect";
import { HttpServerResponse } from "effect/unstable/http";

import type {
  IdempotencyConflict,
  ImportNotFound,
  ImportPersistenceCorrupt,
  ImportPersistenceUnavailable,
  IncompatibleDuplicate,
  InvalidImportId,
  InvalidImportRequest,
  InvalidSource,
  SourceIdentityUnavailable,
  SourceValidationUnavailable,
  UnauthorizedImportCaller,
} from "./import.errors.js";

type PublicImportError =
  | IdempotencyConflict
  | ImportNotFound
  | ImportPersistenceCorrupt
  | ImportPersistenceUnavailable
  | IncompatibleDuplicate
  | InvalidImportId
  | InvalidImportRequest
  | InvalidSource
  | SourceIdentityUnavailable
  | SourceValidationUnavailable
  | UnauthorizedImportCaller;

const problem = (
  status: number,
  code: string,
  message: string,
  headers?: Record<string, string>
) =>
  HttpServerResponse.json(
    { error: { code, message } },
    { headers, status }
  ).pipe(Effect.orDie);

const publicErrorResponse = (error: PublicImportError) => {
  switch (error._tag) {
    case "UnauthorizedImportCaller": {
      return problem(401, "unauthorized", "Authentication is required.", {
        "www-authenticate": 'Bearer realm="meal-planner-imports"',
      });
    }
    case "InvalidImportRequest":
    case "InvalidImportId": {
      return problem(400, "invalid_request", "The import request is invalid.");
    }
    case "InvalidSource": {
      return problem(400, "invalid_source", "The source is not supported.");
    }
    case "IdempotencyConflict": {
      return problem(
        409,
        "idempotency_conflict",
        "The idempotency key was already used for another request."
      );
    }
    case "IncompatibleDuplicate": {
      return problem(
        409,
        "incompatible_duplicate",
        "The source already exists with incompatible import options."
      );
    }
    case "ImportNotFound": {
      return problem(404, "not_found", "The import was not found.");
    }
    case "SourceValidationUnavailable": {
      return problem(
        503,
        "source_validation_unavailable",
        "Source validation is temporarily unavailable."
      );
    }
    case "SourceIdentityUnavailable": {
      return problem(
        503,
        "source_resolution_unavailable",
        "Source resolution is temporarily unavailable."
      );
    }
    case "ImportPersistenceUnavailable": {
      return problem(
        503,
        "persistence_unavailable",
        "Import persistence is temporarily unavailable."
      );
    }
    case "ImportPersistenceCorrupt": {
      return problem(
        500,
        "internal_error",
        "The import could not be processed."
      );
    }
    default: {
      return problem(
        500,
        "internal_error",
        "The import could not be processed."
      );
    }
  }
};

export const respond = <
  S extends Schema.ConstraintEncoder<unknown>,
  E extends PublicImportError,
  R,
>(
  effect: Effect.Effect<S["Type"], E, R>,
  schema: S,
  status: (value: S["Type"]) => number
) =>
  effect.pipe(
    Effect.matchEffect({
      onFailure: publicErrorResponse,
      onSuccess: (value) =>
        HttpServerResponse.json(Schema.encodeSync(schema)(value), {
          status: status(value),
        }).pipe(Effect.orDie),
    })
  );

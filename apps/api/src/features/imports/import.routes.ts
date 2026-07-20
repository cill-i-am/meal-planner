import { Effect, Schema } from "effect";
import {
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/unstable/http";

import { ImportAuthorizer } from "./import.auth.js";
import {
  CreateImportRequest,
  CreateImportResponse,
  GetImportResponse,
  IdempotencyKey,
  ImportId,
} from "./import.contracts.js";
import { invalidImportId, invalidImportRequest } from "./import.errors.js";
import type {
  IdempotencyConflict,
  ImportNotFound,
  ImportPersistenceCorrupt,
  ImportPersistenceUnavailable,
  IncompatibleDuplicate,
  InvalidImportId,
  InvalidImportRequest,
  InvalidSource,
  SourceValidationUnavailable,
  UnauthorizedImportCaller,
} from "./import.errors.js";
import { ImportService } from "./import.service.js";

type PublicImportError =
  | IdempotencyConflict
  | ImportNotFound
  | ImportPersistenceCorrupt
  | ImportPersistenceUnavailable
  | IncompatibleDuplicate
  | InvalidImportId
  | InvalidImportRequest
  | InvalidSource
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

const respond = <
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

const decodeCreateRequest = HttpServerRequest.schemaBodyJson(
  CreateImportRequest
).pipe(Effect.mapError(() => invalidImportRequest()));

const decodeIdempotencyKey = (value: string | undefined) =>
  Schema.decodeUnknownEffect(IdempotencyKey)(value).pipe(
    Effect.mapError(() => invalidImportRequest())
  );

const decodeImportId = HttpRouter.schemaPathParams(
  Schema.Struct({ id: ImportId })
).pipe(Effect.mapError(() => invalidImportId()));

export const ImportRouteDefinitions = [
  HttpRouter.route("POST", "/imports", (request) =>
    Effect.gen(function* createImportRoute() {
      const authorizer = yield* ImportAuthorizer;
      yield* authorizer.authorize(request.headers["authorization"]);
      const idempotencyKey = yield* decodeIdempotencyKey(
        request.headers["idempotency-key"]
      );
      const body = yield* decodeCreateRequest;
      const service = yield* ImportService;
      return yield* service.create(body, idempotencyKey);
    }).pipe((effect) =>
      respond(effect, CreateImportResponse, (response) =>
        response.import.status.kind === "queued" ? 202 : 422
      )
    )
  ),
  HttpRouter.route("GET", "/imports/:id", (request) =>
    Effect.gen(function* getImportRoute() {
      const authorizer = yield* ImportAuthorizer;
      yield* authorizer.authorize(request.headers["authorization"]);
      const { id } = yield* decodeImportId;
      const service = yield* ImportService;
      return yield* service.get(id);
    }).pipe((effect) => respond(effect, GetImportResponse, () => 200))
  ),
] as const;

export const ImportRoutes = HttpRouter.addAll(ImportRouteDefinitions);

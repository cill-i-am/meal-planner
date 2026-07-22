import { Effect, Schema } from "effect";
import {
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/unstable/http";

import {
  CreateImportBatchRequest,
  CreateImportBatchResponse,
  GetImportBatchResponse,
  ImportBatchId,
} from "./import-batch.contracts.js";
import type {
  CreateImportBatchError,
  GetImportBatchError,
} from "./import-batch.service.js";
import { ImportBatchService } from "./import-batch.service.js";
import { ImportAuthorizer } from "./import.auth.js";
import { IdempotencyKey } from "./import.contracts.js";
import { invalidImportId, invalidImportRequest } from "./import.errors.js";
import type { UnauthorizedImportCaller } from "./import.errors.js";

const decodeCreateRequest = HttpServerRequest.schemaBodyJson(
  CreateImportBatchRequest
).pipe(Effect.mapError(() => invalidImportRequest()));

const decodeIdempotencyKey = (value: string | undefined) =>
  Schema.decodeUnknownEffect(IdempotencyKey)(value).pipe(
    Effect.mapError(() => invalidImportRequest())
  );

const decodeBatchId = HttpRouter.schemaPathParams(
  Schema.Struct({ id: ImportBatchId })
).pipe(Effect.mapError(() => invalidImportId()));

type BatchRouteError =
  | CreateImportBatchError
  | GetImportBatchError
  | ReturnType<typeof invalidImportId>
  | ReturnType<typeof invalidImportRequest>
  | UnauthorizedImportCaller;

const problem = (status: number, code: string, message: string) =>
  HttpServerResponse.json({ error: { code, message } }, { status }).pipe(
    Effect.orDie
  );

const respondError = (error: BatchRouteError) => {
  switch (error._tag) {
    case "UnauthorizedImportCaller": {
      return HttpServerResponse.json(
        {
          error: {
            code: "unauthorized",
            message: "Authentication is required.",
          },
        },
        {
          headers: {
            "www-authenticate": 'Bearer realm="meal-planner-imports"',
          },
          status: 401,
        }
      ).pipe(Effect.orDie);
    }
    case "InvalidImportRequest":
    case "InvalidImportId": {
      return problem(400, "invalid_request", "The batch request is invalid.");
    }
    case "ImportBatchIdempotencyConflict": {
      return problem(
        409,
        "idempotency_conflict",
        "The idempotency key was already used for another batch request."
      );
    }
    case "ImportBatchNotFound": {
      return problem(404, "not_found", "The import batch was not found.");
    }
    case "ImportBatchQueueUnavailable": {
      return problem(
        503,
        "queue_unavailable",
        "Import batching is temporarily unavailable."
      );
    }
  }
};

const respond = <S extends Schema.ConstraintEncoder<unknown>, R>(
  effect: Effect.Effect<S["Type"], BatchRouteError, R>,
  schema: S,
  status: (value: S["Type"]) => number
) =>
  effect.pipe(
    Effect.matchEffect({
      onFailure: respondError,
      onSuccess: (value) =>
        HttpServerResponse.json(Schema.encodeSync(schema)(value), {
          status: status(value),
        }).pipe(Effect.orDie),
    })
  );

/** Typed POST/GET route definitions for the provider-free batch seam. */
export const ImportBatchRouteDefinitions = [
  HttpRouter.route("POST", "/import-batches", (request) =>
    Effect.gen(function* createImportBatch() {
      const authorizer = yield* ImportAuthorizer;
      yield* authorizer.authorize(request.headers["authorization"]);
      const idempotencyKey = yield* decodeIdempotencyKey(
        request.headers["idempotency-key"]
      );
      const body = yield* decodeCreateRequest;
      const service = yield* ImportBatchService;
      return yield* service.create(body, idempotencyKey);
    }).pipe((effect) =>
      respond(effect, CreateImportBatchResponse, ({ batch, disposition }) =>
        disposition === "created" && batch.counts.total > 0 ? 202 : 200
      )
    )
  ),
  HttpRouter.route("GET", "/import-batches/:id", (request) =>
    Effect.gen(function* getImportBatch() {
      const authorizer = yield* ImportAuthorizer;
      yield* authorizer.authorize(request.headers["authorization"]);
      const { id } = yield* decodeBatchId;
      const service = yield* ImportBatchService;
      return yield* service.get(id);
    }).pipe((effect) => respond(effect, GetImportBatchResponse, () => 200))
  ),
] as const;

/** Router Layer for the provider-free import-batch typed API seam. */
export const ImportBatchRoutes = HttpRouter.addAll(ImportBatchRouteDefinitions);

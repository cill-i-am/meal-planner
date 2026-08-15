import { Effect, FileSystem, Schema } from "effect";
import { HttpRouter, HttpServerRequest } from "effect/unstable/http";

import { OperatorCarouselBundle } from "./import-carousel-operator.js";
import { OperatorCarouselImportService } from "./import-carousel-operator.service.js";
import { ImportAuthorizer } from "./import.auth.js";
import {
  CreateImportRequest,
  CreateImportResponse,
  GetImportResponse,
  IdempotencyKey,
  ImportId,
} from "./import.contracts.js";
import {
  invalidCarouselBundle,
  invalidImportId,
  invalidImportRequest,
} from "./import.errors.js";
import { respond } from "./import.http.js";
import { ImportService } from "./import.service.js";

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

export const MaximumOperatorCarouselRequestBytes = 8_500_000;

const decodeOperatorCarouselRequest = HttpServerRequest.schemaBodyJson(
  OperatorCarouselBundle,
  { onExcessProperty: "error" }
).pipe(
  Effect.provideService(
    HttpServerRequest.MaxBodySize,
    FileSystem.Size(MaximumOperatorCarouselRequestBytes)
  ),
  Effect.mapError(() => invalidCarouselBundle())
);

const createImportStatusCode = (response: typeof CreateImportResponse.Type) => {
  switch (response.import.status.kind) {
    case "acquired":
    case "needs_review":
    case "transcribed":
    case "visual_evidence_empty":
    case "visual_evidence_found":
    case "visual_evidence_low_confidence": {
      return 200;
    }
    case "acquiring":
    case "extracting_visual":
    case "queued":
    case "transcribing": {
      return 202;
    }
    case "failed":
    case "unsupported": {
      return 422;
    }
    default: {
      return response.import.status satisfies never;
    }
  }
};

const CoreImportRouteDefinitions = [
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
      respond(effect, CreateImportResponse, createImportStatusCode)
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

export const OperatorCarouselRouteDefinitions = [
  HttpRouter.route("POST", "/imports/operator-carousel", (request) =>
    Effect.gen(function* admitOperatorCarouselRoute() {
      const authorizer = yield* ImportAuthorizer;
      yield* authorizer.authorize(request.headers["authorization"]);
      const idempotencyKey = yield* decodeIdempotencyKey(
        request.headers["idempotency-key"]
      );
      const bundle = yield* decodeOperatorCarouselRequest;
      const service = yield* OperatorCarouselImportService;
      return yield* service.admit(bundle, idempotencyKey);
    }).pipe((effect) => respond(effect, CreateImportResponse, () => 200))
  ),
] as const;

export const ImportRouteDefinitions = [
  ...CoreImportRouteDefinitions,
  ...OperatorCarouselRouteDefinitions,
] as const;

export const ImportRoutes = HttpRouter.addAll(CoreImportRouteDefinitions);
export const OperatorCarouselRoutes = HttpRouter.addAll(
  OperatorCarouselRouteDefinitions
);

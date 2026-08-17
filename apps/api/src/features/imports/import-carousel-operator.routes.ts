import { RecipeImportIntent } from "@meal-planner/recipe-import-api";
import { Effect, FileSystem, Schema } from "effect";
import { HttpRouter, HttpServerRequest } from "effect/unstable/http";

import { AuthPrincipalResolver } from "../auth/auth.principal.js";
import { OperatorCarouselBundle } from "./import-carousel-operator.js";
import { OperatorCarouselImportService } from "./import-carousel-operator.service.js";
import { ImportPrincipal } from "./import-intent.js";
import { IdempotencyKey } from "./import.contracts.js";
import {
  invalidCarouselBundle,
  invalidImportRequest,
  unauthorizedImportCaller,
} from "./import.errors.js";
import { respond } from "./import.http.js";

const decodeIdempotencyKey = (value: string | undefined) =>
  Schema.decodeUnknownEffect(IdempotencyKey)(value).pipe(
    Effect.mapError(() => invalidImportRequest())
  );

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

/** Authenticated operator carousel seam retained beside the canonical API. */
export const OperatorCarouselRouteDefinitions = [
  HttpRouter.route("POST", "/imports/operator-carousel", (request) =>
    Effect.gen(function* admitOperatorCarouselRoute() {
      const resolver = yield* AuthPrincipalResolver;
      const apiPrincipal = yield* resolver
        .resolve(new globalThis.Headers(Object.entries(request.headers)))
        .pipe(Effect.mapError(() => unauthorizedImportCaller()));
      const principal = yield* Schema.decodeUnknownEffect(ImportPrincipal)(
        apiPrincipal
      ).pipe(Effect.orDie);
      const idempotencyKey = yield* decodeIdempotencyKey(
        request.headers["idempotency-key"]
      );
      const bundle = yield* decodeOperatorCarouselRequest;
      const service = yield* OperatorCarouselImportService;
      return yield* service.admit(principal, bundle, idempotencyKey);
    }).pipe((effect) => respond(effect, RecipeImportIntent, () => 202))
  ),
] as const;

export const OperatorCarouselRoutes = HttpRouter.addAll(
  OperatorCarouselRouteDefinitions
);

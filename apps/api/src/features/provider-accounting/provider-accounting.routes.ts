import { Effect } from "effect";
import { HttpRouter, HttpServerRequest } from "effect/unstable/http";

import { ImportSystemAuthorizer } from "../imports/import-system.auth.js";
import {
  importPersistenceCorrupt,
  importPersistenceUnavailable,
  importTransitionRejected,
  invalidImportRequest,
} from "../imports/import.errors.js";
import { respond } from "../imports/import.http.js";
import {
  ProviderAccountingRequest,
  ProviderAccountingResponse,
  ProviderAccountingService,
} from "./provider-accounting.service.js";
import type { ProviderAccountingServiceError } from "./provider-accounting.service.js";

const decodeRequest = HttpServerRequest.schemaBodyJson(
  ProviderAccountingRequest,
  { onExcessProperty: "error" }
).pipe(Effect.mapError(() => invalidImportRequest()));

const publicAccountingError = (error: ProviderAccountingServiceError) => {
  switch (error.code) {
    case "not_allowed": {
      return importTransitionRejected();
    }
    case "persistence_unavailable": {
      return importPersistenceUnavailable();
    }
    case "persistence_corrupt": {
      return importPersistenceCorrupt();
    }
    default: {
      return error.code satisfies never;
    }
  }
};

export const ProviderAccountingRouteDefinitions = [
  HttpRouter.route("POST", "/imports/operator-provider-accounting", (request) =>
    Effect.gen(function* reconcileProviderAccountingRoute() {
      const authorizer = yield* ImportSystemAuthorizer;
      yield* authorizer.authorize(request.headers["authorization"]);
      const body = yield* decodeRequest;
      const service = yield* ProviderAccountingService;
      return yield* service
        .reconcile(body)
        .pipe(Effect.mapError(publicAccountingError));
    }).pipe((effect) => respond(effect, ProviderAccountingResponse, () => 200))
  ),
] as const;

export const ProviderAccountingRoutes = HttpRouter.addAll(
  ProviderAccountingRouteDefinitions
);

import { Effect } from "effect";
import { HttpRouter, HttpServerRequest } from "effect/unstable/http";

import {
  ProviderRecoveryRequest,
  ProviderRecoveryResponse,
  ProviderRecoveryService,
} from "./import-provider-recovery.js";
import type { ProviderRecoveryError } from "./import-provider-recovery.js";
import { ImportSystemAuthorizer } from "./import-system.auth.js";
import {
  importPersistenceCorrupt,
  importPersistenceUnavailable,
  importTransitionRejected,
  invalidImportRequest,
} from "./import.errors.js";
import { respond } from "./import.http.js";

const decodeRequest = HttpServerRequest.schemaBodyJson(
  ProviderRecoveryRequest,
  {
    onExcessProperty: "error",
  }
).pipe(Effect.mapError(() => invalidImportRequest()));

const publicRecoveryError = (error: ProviderRecoveryError) => {
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

export const ProviderRecoveryRouteDefinitions = [
  HttpRouter.route("POST", "/imports/operator-provider-recovery", (request) =>
    Effect.gen(function* recoverFromHouseholdTerminalRoute() {
      const authorizer = yield* ImportSystemAuthorizer;
      yield* authorizer.authorize(request.headers["authorization"]);
      const body = yield* decodeRequest;
      const service = yield* ProviderRecoveryService;
      return yield* service
        .recover(body)
        .pipe(Effect.mapError(publicRecoveryError));
    }).pipe((effect) => respond(effect, ProviderRecoveryResponse, () => 200))
  ),
] as const;

export const ProviderRecoveryRoutes = HttpRouter.addAll(
  ProviderRecoveryRouteDefinitions
);

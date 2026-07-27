import { Effect } from "effect";
import { HttpRouter, HttpServerRequest } from "effect/unstable/http";

import {
  ProviderTerminalSettlementRequest,
  ProviderTerminalSettlementResponse,
  ProviderTerminalSettlementService,
} from "./import-provider-terminal-settlement.js";
import type { ProviderTerminalSettlementError } from "./import-provider-terminal-settlement.js";
import { ImportAuthorizer } from "./import.auth.js";
import {
  importPersistenceCorrupt,
  importPersistenceUnavailable,
  importTransitionRejected,
  invalidImportRequest,
} from "./import.errors.js";
import { respond } from "./import.http.js";

const decodeRequest = HttpServerRequest.schemaBodyJson(
  ProviderTerminalSettlementRequest,
  { onExcessProperty: "error" }
).pipe(Effect.mapError(() => invalidImportRequest()));

const publicSettlementError = (error: ProviderTerminalSettlementError) => {
  switch (error.code) {
    case "not_allowed":
    case "stage_not_allowed": {
      return importTransitionRejected();
    }
    case "persistence_unavailable": {
      return importPersistenceUnavailable();
    }
    case "persistence_corrupt": {
      return importPersistenceCorrupt();
    }
    default: {
      return importPersistenceCorrupt();
    }
  }
};

export const ProviderTerminalSettlementRouteDefinitions = [
  HttpRouter.route(
    "POST",
    "/imports/operator-provider-terminal-settlement",
    (request) =>
      Effect.gen(function* settleTerminalUnknownProviderCostRoute() {
        const authorizer = yield* ImportAuthorizer;
        yield* authorizer.authorize(request.headers["authorization"]);
        const body = yield* decodeRequest;
        const service = yield* ProviderTerminalSettlementService;
        return yield* service
          .settle(body)
          .pipe(Effect.mapError(publicSettlementError));
      }).pipe((effect) =>
        respond(effect, ProviderTerminalSettlementResponse, () => 200)
      )
  ),
] as const;

export const ProviderTerminalSettlementRoutes = HttpRouter.addAll(
  ProviderTerminalSettlementRouteDefinitions
);

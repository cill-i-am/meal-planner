import { Effect, Layer } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";

import { HealthRoutes } from "../features/health/health.routes.js";
import { TescoCatalogueRoutes } from "../features/tesco/catalogue/catalogue.routes.js";

export const AppRoutes = Layer.merge(
  TescoCatalogueRoutes,
  HttpRouter.addAll([
    ...HealthRoutes,
    HttpRouter.route(
      "*",
      "*",
      HttpServerResponse.json(
        {
          error: "NotFound",
          message: "Route not found",
        },
        { status: 404 }
      ).pipe(Effect.orDie)
    ),
  ])
);

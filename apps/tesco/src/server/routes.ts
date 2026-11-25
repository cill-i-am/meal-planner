import { Effect, Layer } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";

import { TescoCatalogueRoutes } from "../catalogue/catalogue.routes.js";
import { HealthRoutes } from "./health.routes.js";

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

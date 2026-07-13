import { HttpRouter } from "effect/unstable/http";

import { HealthRoutes } from "../features/health/health.routes.js";
import { TescoCatalogueRoutes } from "../features/tesco/catalogue/catalogue.routes.js";
import { json } from "./http/responses.js";

export const AppRoutes = HttpRouter.addAll([
  ...HealthRoutes,
  ...TescoCatalogueRoutes,
  HttpRouter.route(
    "*",
    "*",
    json(
      {
        error: "NotFound",
        message: "Route not found",
      },
      404
    )
  ),
]);

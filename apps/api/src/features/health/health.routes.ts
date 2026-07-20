import { HttpRouter } from "effect/unstable/http";

import { json } from "../../app/http/responses.js";
import { healthResponse } from "./health.model.js";

/** Shared health route consumed by the Node and Cloudflare hosts. */
export const HealthRoutes = [
  HttpRouter.route("GET", "/health", json(healthResponse)),
] as const;

/** Health-only router used by the Cloudflare Worker host. */
export const HealthWorkerRoutes = HttpRouter.addAll([
  ...HealthRoutes,
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

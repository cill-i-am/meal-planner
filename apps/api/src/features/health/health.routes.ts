import { Effect } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";

import { healthResponse } from "./health.model.js";

/** Shared health route consumed by the Node and Cloudflare hosts. */
export const HealthRoutes = [
  HttpRouter.route(
    "GET",
    "/health",
    HttpServerResponse.json(healthResponse).pipe(Effect.orDie)
  ),
] as const;

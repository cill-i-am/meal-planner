import { HttpRouter } from "effect/unstable/http";

import { json } from "../../app/http/responses.js";

export const HealthRoutes = [
  HttpRouter.route("GET", "/health", json({ ok: true })),
] as const;

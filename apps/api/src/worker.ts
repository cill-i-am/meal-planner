import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import * as HttpRouter from "effect/unstable/http/HttpRouter";

import { HealthWorkerRoutes } from "./features/health/health.routes.js";

/** Minimal Effect-native Cloudflare host for the Meal Planner API. */
export default class MealPlannerApi extends Cloudflare.Worker<MealPlannerApi>()(
  "MealPlannerApi",
  { main: import.meta.url },
  Effect.succeed({
    fetch: HttpRouter.toHttpEffect(HealthWorkerRoutes),
  })
) {}

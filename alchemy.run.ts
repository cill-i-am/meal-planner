import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";

import MealPlannerApi from "./apps/api/src/worker.js";

export default Alchemy.Stack(
  "MealPlanner",
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(),
  },
  Effect.gen(function* MealPlannerStack() {
    const api = yield* MealPlannerApi;

    return {
      apiUrl: api.url,
      apiWorkerName: api.workerName,
    };
  })
);

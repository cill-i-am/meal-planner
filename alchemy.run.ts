import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";

import { MealPlannerDatabase } from "./apps/api/src/infrastructure/meal-planner-database.js";
import MealPlannerApi from "./apps/api/src/worker.js";

export default Alchemy.Stack(
  "MealPlanner",
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(),
  },
  Effect.gen(function* MealPlannerStack() {
    const database = yield* MealPlannerDatabase;
    const api = yield* MealPlannerApi;

    return {
      apiUrl: api.url,
      apiWorkerName: api.workerName,
      databaseName: database.databaseName,
    };
  })
);

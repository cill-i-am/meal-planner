import start from "@tanstack/react-start/server-entry";

import { isApiRequest } from "./api-proxy.js";
import type { MealPlannerApiService } from "./api-proxy.js";

interface WebsiteEnvironment {
  readonly MEAL_PLANNER_API: MealPlannerApiService;
}

export default {
  fetch(request: Request, environment: WebsiteEnvironment) {
    if (isApiRequest(request)) {
      return environment.MEAL_PLANNER_API.fetch(request);
    }
    return start.fetch(request);
  },
};

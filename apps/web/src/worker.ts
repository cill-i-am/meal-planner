import start from "@tanstack/react-start/server-entry";

import { isApiRequest, proxyApiRequest } from "./api-proxy.js";
import type { MealPlannerApiService } from "./api-proxy.js";

interface WebsiteEnvironment {
  readonly MEAL_PLANNER_API: MealPlannerApiService;
}

export default {
  fetch(request: Request, environment: WebsiteEnvironment) {
    if (isApiRequest(request)) {
      return proxyApiRequest(request, environment.MEAL_PLANNER_API);
    }
    return start.fetch(request);
  },
};

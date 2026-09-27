import { isApiRequest } from "./api-proxy.js";
import type { MealPlannerApiService } from "./api-proxy.js";

interface WebsiteEnvironment {
  readonly MEAL_PLANNER_API: MealPlannerApiService;
}
interface StartHandler {
  readonly fetch: (
    request: Request,
    options: { context: { api: MealPlannerApiService } }
  ) => Response | Promise<Response>;
}

/** The host supplies the compiled Start handler and its private API binding. */
export const createWebsiteHandler = (start: StartHandler) => ({
  fetch(request: Request, environment: WebsiteEnvironment) {
    if (isApiRequest(request)) {
      return environment.MEAL_PLANNER_API.fetch(request);
    }
    return start.fetch(request, {
      context: { api: environment.MEAL_PLANNER_API },
    });
  },
});

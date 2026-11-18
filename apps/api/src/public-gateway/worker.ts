import { handleAccountRequest } from "./account.js";
import { isApiRequest } from "./api-proxy.js";
import type { MealPlannerApiService } from "./api-proxy.js";

export default {
  fetch(
    request: Request,
    environment: { MEAL_PLANNER_API: MealPlannerApiService }
  ) {
    if (isApiRequest(request)) {
      return environment.MEAL_PLANNER_API.fetch(request);
    }
    const { pathname } = new URL(request.url);
    if (/^\/invitation\/[^/]+$/u.test(pathname)) {
      return new Response(
        `Give this link to your connected Meal Planner agent to review the invitation: ${new URL(pathname.replace("/invitation/", "/v1/invitations/"), request.url).href}`,
        {
          headers: {
            "cache-control": "no-store",
            "referrer-policy": "no-referrer",
          },
        }
      );
    }
    return handleAccountRequest(request, environment.MEAL_PLANNER_API);
  },
};

import { isApiRequest } from "../../../../web/src/api-proxy.js";

export default {
  fetch: (request, env) =>
    isApiRequest(request)
      ? env.MEAL_PLANNER_API.fetch(request)
      : new Response("Not found", { status: 404 }),
};

import {
  isApiRequest,
  proxyApiRequest,
} from "../../../../web/src/api-proxy.js";

/** Host shell over the exact API-proxy functions used by the Website Worker. */
export default {
  fetch: (request, env) =>
    isApiRequest(request)
      ? proxyApiRequest(request, env.MEAL_PLANNER_API)
      : new Response("Not found", { status: 404 }),
};

import type { MealPlannerApiService } from "../../api-proxy.js";
import { isApiRequest } from "../../api-proxy.js";
import type { ApiRuntime } from "./runtime.js";

/** One incoming request owns its credentials, binding, and refreshed response cookies. */
export const serverApiRuntime = (
  incoming: Request,
  api: MealPlannerApiService,
  setCookies: (cookies: readonly string[]) => void
): ApiRuntime => {
  const baseUrl = new URL(incoming.url).origin;
  return {
    baseUrl,
    fetch: async (input, init) => {
      const request = new Request(input, init);
      if (new URL(request.url).origin !== baseUrl || !isApiRequest(request)) {
        throw new Error(
          "The server API transport only serves this origin's API routes."
        );
      }
      const headers = new Headers(request.headers);
      for (const name of ["cookie", "origin", "cf-connecting-ip"]) {
        const value = incoming.headers.get(name);
        headers.delete(name);
        if (value !== null) {
          headers.set(name, value);
        }
      }
      const response = await api.fetch(
        new Request(request, {
          headers,
          redirect: "manual",
          signal: AbortSignal.any([incoming.signal, request.signal]),
        })
      );
      const cookies = response.headers.getSetCookie();
      if (cookies.length > 0) {
        setCookies(cookies);
      }
      return response;
    },
  };
};

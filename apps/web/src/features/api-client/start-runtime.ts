import {
  createIsomorphicFn,
  getGlobalStartContext,
} from "@tanstack/react-start";
import {
  getRequest,
  getResponseHeaders,
  setResponseHeader,
} from "@tanstack/react-start/server";
import { Predicate, Schema } from "effect";

import type { MealPlannerApiService } from "../../api-proxy.js";
import { browserApiRuntime } from "./runtime.js";
import type { ApiRuntime } from "./runtime.js";
import { serverApiRuntime } from "./server-transport.js";

declare module "@tanstack/react-router" {
  interface Register {
    server: { requestContext: { api?: MealPlannerApiService } };
  }
}

const BindingContext = Schema.Struct({
  api: Schema.declare<MealPlannerApiService>(
    (value): value is MealPlannerApiService =>
      Predicate.isObjectKeyword(value) &&
      Predicate.hasProperty(value, "fetch") &&
      Predicate.isFunction(value.fetch)
  ),
});

export const startApiRuntime = createIsomorphicFn()
  .client(() => browserApiRuntime())
  .server((): ApiRuntime => {
    const incoming = getRequest();
    return {
      baseUrl: new URL(incoming.url).origin,
      fetch: (input, init) => {
        const { api } = Schema.decodeUnknownSync(BindingContext)(
          getGlobalStartContext()
        );
        return serverApiRuntime(incoming, api, (cookies) => {
          const previous = getResponseHeaders().getSetCookie();
          setResponseHeader("set-cookie", [...previous, ...cookies]);
        }).fetch(input, init);
      },
    };
  });

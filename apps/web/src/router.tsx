import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";

import { ApiRuntimeContext } from "./features/api-client/index.js";
import { startApiRuntime } from "./features/api-client/start-runtime.js";
import {
  AuthClientContext,
  makeAuthClient,
  getAuthViewTransition,
} from "./features/auth/index.js";
import { getBrowserReporter } from "./features/observability/browser-observability.js";
import { routeTree } from "./routeTree.gen.js";

export const getRouter = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { refetchOnWindowFocus: false, retry: false, staleTime: 0 },
    },
  });
  const api = startApiRuntime();
  const auth = makeAuthClient(api.fetch, undefined, `${api.baseUrl}/api/auth`);
  const router = createRouter({
    Wrap: ({ children }) => (
      <ApiRuntimeContext value={api}>
        <AuthClientContext value={auth}>{children}</AuthClientContext>
      </ApiRuntimeContext>
    ),
    context: { api, auth, queryClient },
    defaultPreloadStaleTime: 0,
    defaultViewTransition: getAuthViewTransition(),
    routeTree,
    scrollRestoration: true,
  });

  if (!router.isServer) {
    const reporter = getBrowserReporter();
    let navigationStart: number | undefined = performance.now();
    router.subscribe("onBeforeNavigate", (event) => {
      if (event.pathChanged) {
        navigationStart = performance.now();
      }
    });
    router.subscribe("onResolved", () => {
      if (navigationStart === undefined) {
        return;
      }
      reporter.navigation(navigationStart);
      navigationStart = undefined;
    });
  }

  setupRouterSsrQueryIntegration({ queryClient, router });
  return router;
};

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}

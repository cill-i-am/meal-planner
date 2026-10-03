import type { QueryClient } from "@tanstack/react-query";
import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRouteWithContext,
} from "@tanstack/react-router";
import { useEffect } from "react";

import { MotionProvider } from "../components/ui/motion-provider.js";
import { TooltipProvider } from "../components/ui/tooltip.js";
import type { ApiRuntime } from "../features/api-client/index.js";
import type { makeAuthClient } from "../features/auth/index.js";

import "../styles.css";
import {
  readBrowserAnalyticsToken,
  reportReactError,
} from "../features/observability/analytics-config.js";
import { installBrowserErrorReporting } from "../features/observability/browser-observability.js";

const BrowserObservability = () => {
  useEffect(installBrowserErrorReporting, []);
  return null;
};

const RootDocument = () => {
  // eslint-disable-next-line no-use-before-define -- TanStack invokes this component after Route initialization.
  const { browserAnalyticsToken } = Route.useLoaderData();
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body className="relative">
        <MotionProvider>
          <TooltipProvider>
            <Outlet />
          </TooltipProvider>
        </MotionProvider>
        {browserAnalyticsToken && (
          <script
            defer
            src="https://static.cloudflareinsights.com/beacon.min.js"
            data-cf-beacon={JSON.stringify({
              spa: true,
              token: browserAnalyticsToken,
            })}
          />
        )}
        <BrowserObservability />
        <Scripts />
      </body>
    </html>
  );
};

export const Route = createRootRouteWithContext<{
  api: ApiRuntime;
  auth: ReturnType<typeof makeAuthClient>;
  queryClient: QueryClient;
}>()({
  component: RootDocument,
  head: ({ loaderData }) => ({
    meta: [
      { charSet: "utf-8" },
      {
        content: loaderData?.browserAnalyticsToken ?? "",
        name: "cloudflare-rum-token",
      },
      { content: "width=device-width, initial-scale=1", name: "viewport" },
      { title: "Import a recipe · Meal Planner" },
      {
        content: "Review one recipe draft before saving it to Recipe Bank.",
        name: "description",
      },
    ],
  }),
  loader: () => ({ browserAnalyticsToken: readBrowserAnalyticsToken() }),
  onCatch: reportReactError,
});

import type { QueryClient } from "@tanstack/react-query";
import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRouteWithContext,
} from "@tanstack/react-router";

import { MotionProvider } from "../components/ui/motion-provider.js";
import { TooltipProvider } from "../components/ui/tooltip.js";

import "../styles.css";
import type { ApiRuntime } from "../features/api-client/index.js";
import type { makeAuthClient } from "../features/auth/index.js";

const RootDocument = () => (
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
      <Scripts />
    </body>
  </html>
);

export const Route = createRootRouteWithContext<{
  api: ApiRuntime;
  auth: ReturnType<typeof makeAuthClient>;
  queryClient: QueryClient;
}>()({
  component: RootDocument,
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { content: "width=device-width, initial-scale=1", name: "viewport" },
      { title: "The family edit · Meal Planner" },
      {
        content:
          "Discover what works for your family and plan everyone's week of food.",
        name: "description",
      },
    ],
  }),
});

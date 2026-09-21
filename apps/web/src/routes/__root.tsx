import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRoute,
} from "@tanstack/react-router";

import "../styles.css";
import { TooltipProvider } from "../components/ui/tooltip.js";

const RootDocument = () => (
  <html lang="en">
    <head>
      <HeadContent />
    </head>
    <body>
      <TooltipProvider>
        <Outlet />
      </TooltipProvider>
      <Scripts />
    </body>
  </html>
);

export const Route = createRootRoute({
  component: RootDocument,
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { content: "width=device-width, initial-scale=1", name: "viewport" },
      { title: "Import a recipe · Meal Planner" },
      {
        content: "Review one recipe draft before saving it to Recipe Bank.",
        name: "description",
      },
    ],
  }),
});

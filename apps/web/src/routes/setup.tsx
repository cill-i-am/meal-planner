import { createFileRoute, Outlet } from "@tanstack/react-router";

import { SetupProvider } from "../features/onboarding/setup-context.js";

export const Route = createFileRoute("/setup")({
  component: () => (
    <SetupProvider>
      <Outlet />
    </SetupProvider>
  ),
});

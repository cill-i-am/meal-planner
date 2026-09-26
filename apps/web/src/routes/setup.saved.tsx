import { createFileRoute, Navigate } from "@tanstack/react-router";

import { useSetup } from "../features/onboarding/setup-context.js";
import { SetupSavedPage } from "../features/onboarding/setup-saved.js";
import { setupDestination } from "../features/onboarding/setup-state.js";

const Screen = () => {
  const destination = setupDestination(useSetup().progress);
  return destination === "/setup/saved" ? (
    <SetupSavedPage />
  ) : (
    <Navigate to={destination} replace />
  );
};
export const Route = createFileRoute("/setup/saved")({
  component: Screen,
  head: () => ({ meta: [{ title: "Family setup · Meal Planner" }] }),
});

import { createFileRoute, Navigate } from "@tanstack/react-router";

import { FamilyNamePage } from "../features/onboarding/family-name.js";
import { useSetup } from "../features/onboarding/setup-context.js";
import { setupDestination } from "../features/onboarding/setup-state.js";

const Screen = () => {
  const destination = setupDestination(useSetup().progress);
  return destination === "/setup/family" ? (
    <FamilyNamePage />
  ) : (
    <Navigate to={destination} replace />
  );
};
export const Route = createFileRoute("/setup/family")({
  component: Screen,
  head: () => ({ meta: [{ title: "Family setup · Meal Planner" }] }),
});

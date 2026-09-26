import { createFileRoute, Navigate } from "@tanstack/react-router";

import { FamilyReadyPage } from "../features/onboarding/family-review.js";
import { useSetup } from "../features/onboarding/setup-context.js";
import { setupDestination } from "../features/onboarding/setup-state.js";

const Screen = () => {
  const destination = setupDestination(useSetup().progress);
  return destination === "/setup/ready" ? (
    <FamilyReadyPage />
  ) : (
    <Navigate to={destination} replace />
  );
};
export const Route = createFileRoute("/setup/ready")({
  component: Screen,
  head: () => ({ meta: [{ title: "Family setup · Meal Planner" }] }),
});

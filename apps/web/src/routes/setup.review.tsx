import { createFileRoute, Navigate } from "@tanstack/react-router";

import { FamilyReviewPage } from "../features/onboarding/family-review.js";
import { useSetup } from "../features/onboarding/setup-context.js";
import { setupDestination } from "../features/onboarding/setup-state.js";

const Screen = () => {
  const destination = setupDestination(useSetup().progress);
  return destination === "/setup/review" ? (
    <FamilyReviewPage />
  ) : (
    <Navigate to={destination} replace />
  );
};
export const Route = createFileRoute("/setup/review")({
  component: Screen,
  head: () => ({ meta: [{ title: "Family setup · Meal Planner" }] }),
});

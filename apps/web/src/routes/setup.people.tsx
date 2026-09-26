import { createFileRoute, Navigate } from "@tanstack/react-router";

import { AddPersonPage } from "../features/onboarding/people-pages.js";
import { useSetup } from "../features/onboarding/setup-context.js";
import { setupDestination } from "../features/onboarding/setup-state.js";

const Screen = () => {
  const destination = setupDestination(useSetup().progress);
  return destination === "/setup/people" ? (
    <AddPersonPage />
  ) : (
    <Navigate to={destination} replace />
  );
};
export const Route = createFileRoute("/setup/people")({
  component: Screen,
  head: () => ({ meta: [{ title: "Family setup · Meal Planner" }] }),
});

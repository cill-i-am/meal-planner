import { createFileRoute, Navigate } from "@tanstack/react-router";

import { EditPersonPage } from "../features/onboarding/edit-person.js";
import { useSetup } from "../features/onboarding/setup-context.js";
import { setupDestination } from "../features/onboarding/setup-state.js";

const Screen = () => {
  const setup = useSetup();
  const { checkpoint } = setup.progress;
  const destination = setupDestination(setup.progress);
  return destination === "/setup/edit-person" ? (
    <EditPersonPage
      key={`${setup.user.id}:${"personId" in checkpoint ? checkpoint.personId : ""}`}
    />
  ) : (
    <Navigate to={destination} replace />
  );
};
export const Route = createFileRoute("/setup/edit-person")({
  component: Screen,
  head: () => ({ meta: [{ title: "Family setup · Meal Planner" }] }),
});

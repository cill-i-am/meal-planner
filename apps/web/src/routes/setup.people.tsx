import { createFileRoute, Navigate } from "@tanstack/react-router";

import { useFamily } from "../features/family/index.js";
import { AddPersonPage } from "../features/onboarding/index.js";

const Screen = () => {
  const setup = useFamily();
  if (setup.family === undefined) {
    return <Navigate to="/setup/family" replace />;
  }
  return <AddPersonPage />;
};
export const Route = createFileRoute("/setup/people")({
  component: Screen,
  head: () => ({ meta: [{ title: "Family setup · Meal Planner" }] }),
});

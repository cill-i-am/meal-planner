import { createFileRoute, Navigate } from "@tanstack/react-router";

import { useFamily } from "../features/family/index.js";
import { FamilyReadyPage } from "../features/onboarding/index.js";

const Screen = () => {
  const setup = useFamily();
  if (setup.family === undefined) {
    return <Navigate to="/setup/family" replace />;
  }
  return <FamilyReadyPage />;
};
export const Route = createFileRoute("/setup/ready")({
  component: Screen,
  head: () => ({ meta: [{ title: "Family setup · Meal Planner" }] }),
});

import { createFileRoute, Navigate } from "@tanstack/react-router";

import { useFamily } from "../features/family/index.js";
import { FamilyReviewPage } from "../features/onboarding/index.js";

const Screen = () => {
  const setup = useFamily();
  if (setup.family === undefined) {
    return <Navigate to="/setup/family" replace />;
  }
  return <FamilyReviewPage />;
};
export const Route = createFileRoute("/setup/review")({
  component: Screen,
  head: () => ({ meta: [{ title: "Family setup · Meal Planner" }] }),
});

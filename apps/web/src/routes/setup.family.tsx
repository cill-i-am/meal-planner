import { createFileRoute } from "@tanstack/react-router";

import { FamilySetupPage } from "../features/onboarding/index.js";

const Screen = () => <FamilySetupPage />;
export const Route = createFileRoute("/setup/family")({
  component: Screen,
  head: () => ({ meta: [{ title: "Family setup · Meal Planner" }] }),
});

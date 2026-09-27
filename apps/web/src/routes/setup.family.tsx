import { createFileRoute } from "@tanstack/react-router";

import { FamilyNamePage } from "../features/onboarding/index.js";

const Screen = () => <FamilyNamePage />;
export const Route = createFileRoute("/setup/family")({
  component: Screen,
  head: () => ({ meta: [{ title: "Family setup · Meal Planner" }] }),
});

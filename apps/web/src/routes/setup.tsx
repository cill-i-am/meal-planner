import { HouseholdOrganizationId } from "@meal-planner/household-api";
import { createFileRoute, Outlet } from "@tanstack/react-router";
import { Schema } from "effect";

import { SetupProvider } from "../features/onboarding/index.js";

export const Route = createFileRoute("/setup")({
  component: () => (
    <SetupProvider>
      <Outlet />
    </SetupProvider>
  ),
  validateSearch: Schema.decodeUnknownSync(
    Schema.Struct({ familyId: Schema.optional(HouseholdOrganizationId) })
  ),
});

import { createFileRoute, Navigate } from "@tanstack/react-router";

import { useSetup } from "../features/onboarding/setup-context.js";
import { setupDestination } from "../features/onboarding/setup-state.js";

const SetupEntry = () => {
  const setup = useSetup();
  return <Navigate to={setupDestination(setup.progress)} replace />;
};
export const Route = createFileRoute("/setup/")({ component: SetupEntry });

import { createFileRoute, Navigate } from "@tanstack/react-router";

import { useFamily } from "../features/family/index.js";
import { setupDestination } from "../features/onboarding/index.js";

export const SetupEntry = () => {
  const setup = useFamily();
  const destination = setupDestination(setup.family);
  if (destination === "/") {
    return <Navigate to="/" search={{}} replace />;
  }
  return (
    <Navigate
      to={destination}
      search={setup.family ? { familyId: setup.family.id } : {}}
      replace
    />
  );
};
export const Route = createFileRoute("/setup/")({ component: SetupEntry });

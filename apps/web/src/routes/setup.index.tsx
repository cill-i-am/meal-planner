import { createFileRoute, Navigate } from "@tanstack/react-router";

import { useFamily } from "../features/family/index.js";
import { setupDestination } from "../features/onboarding/index.js";

const SetupEntry = () => {
  const setup = useFamily();
  return (
    <Navigate
      to={setupDestination(setup.family)}
      search={setup.family ? { familyId: setup.family.id } : {}}
      replace
    />
  );
};
export const Route = createFileRoute("/setup/")({ component: SetupEntry });

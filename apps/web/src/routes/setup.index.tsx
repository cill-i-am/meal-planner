import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Navigate } from "@tanstack/react-router";

import { useSetup } from "../features/onboarding/setup-context.js";
import { setupDestination } from "../features/onboarding/setup-state.js";
import { SetupStatus } from "../features/onboarding/setup-ui.js";

const SetupEntry = () => {
  const setup = useSetup();
  const { checkpoint } = setup.progress;
  const restore = useQuery({
    enabled: checkpoint.stage === "complete",
    queryFn: async () => {
      if (checkpoint.stage !== "complete") {
        throw new Error("Setup is not complete.");
      }
      // A fresh login has no active family. Better Auth must authorize it again.
      await setup.selectFamily(checkpoint.organizationId);
      return true;
    },
    queryKey: ["restore-setup-family", setup.user.id, checkpoint],
    retry: false,
    staleTime: 0,
  });
  if (checkpoint.stage !== "complete") {
    return <Navigate to={setupDestination(setup.progress)} replace />;
  }
  if (restore.isError) {
    return (
      <SetupStatus
        title="Your family couldn’t be opened"
        description="Your account is signed in. Try loading your family again."
        retry={() => restore.refetch()}
      />
    );
  }
  return restore.isSuccess ? (
    <Navigate to="/" replace />
  ) : (
    <SetupStatus title="Opening your family…" />
  );
};
export const Route = createFileRoute("/setup/")({ component: SetupEntry });

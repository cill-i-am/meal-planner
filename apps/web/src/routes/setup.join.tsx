import { createFileRoute, Navigate } from "@tanstack/react-router";

import { InvitationPage } from "../features/invitations/invitation-page.js";
import { useSetup } from "../features/onboarding/setup-context.js";
import { setupDestination } from "../features/onboarding/setup-state.js";

const Screen = () => {
  const setup = useSetup();
  const { checkpoint } = setup.progress;
  return checkpoint.stage === "invitation-link" ||
    checkpoint.stage === "invitation-response" ? (
    <InvitationPage
      key={`${setup.user.id}:${checkpoint.invitationId}`}
      invitationId={checkpoint.invitationId}
    />
  ) : (
    <Navigate to={setupDestination(setup.progress)} replace />
  );
};
export const Route = createFileRoute("/setup/join")({ component: Screen });

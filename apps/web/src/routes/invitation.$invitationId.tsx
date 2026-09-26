import { createFileRoute, useParams } from "@tanstack/react-router";

import { InvitationPage } from "../features/invitations/invitation-page.js";
import { SetupProvider } from "../features/onboarding/setup-context.js";

const Screen = () => {
  const { invitationId } = useParams({ from: "/invitation/$invitationId" });
  return (
    <SetupProvider>
      <InvitationPage key={invitationId} invitationId={invitationId} />
    </SetupProvider>
  );
};
export const Route = createFileRoute("/invitation/$invitationId")({
  component: Screen,
  head: () => ({ meta: [{ title: "Family invitation · Meal Planner" }] }),
});

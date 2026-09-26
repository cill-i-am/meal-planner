import { createFileRoute, useParams } from "@tanstack/react-router";

import { InvitationPageForRoute } from "../features/invitations/invitation-page.js";

const Screen = () => {
  const { invitationId } = useParams({ from: "/invitation/$invitationId" });
  return <InvitationPageForRoute invitationId={invitationId} />;
};
export const Route = createFileRoute("/invitation/$invitationId")({
  component: Screen,
  head: () => ({ meta: [{ title: "Family invitation · Meal Planner" }] }),
});

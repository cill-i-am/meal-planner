import { InvitationId } from "@meal-planner/household-api";
import {
  createFileRoute,
  useRouter,
  useParams,
  redirect,
} from "@tanstack/react-router";
import { Option, Schema } from "effect";

import { StatusScreen } from "../components/status-screen.js";
import { accountQuery } from "../features/auth/index.js";
import {
  InvitationPageForRoute,
  invitationReadQueryOptions,
} from "../features/invitations/index.js";

const Screen = () => {
  const { invitationId } = useParams({ from: "/invitation/$invitationId" });
  return <InvitationPageForRoute invitationId={invitationId} />;
};
export const Route = createFileRoute("/invitation/$invitationId")({
  beforeLoad: async ({ context, location }) => {
    const account = await context.queryClient.ensureQueryData(
      accountQuery(context.auth)
    );
    if (!account) {
      throw redirect({ search: { redirect: location.href }, to: "/login" });
    }
    return { account };
  },
  component: Screen,
  errorComponent: () => {
    const router = useRouter();
    return (
      <StatusScreen
        title="Your invitation couldn’t be loaded"
        retry={() => router.invalidate()}
      />
    );
  },
  head: () => ({ meta: [{ title: "Family invitation · Meal Planner" }] }),
  headers: () => ({ "Cache-Control": "private, no-store" }),
  loader: async ({ context, params }) => {
    const id = Schema.decodeUnknownOption(InvitationId)(params.invitationId);
    if (Option.isSome(id)) {
      await context.queryClient.prefetchQuery(
        invitationReadQueryOptions(
          context.api,
          id.value,
          context.account.user.id
        )
      );
    }
  },
});

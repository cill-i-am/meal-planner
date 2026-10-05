import { HouseholdOrganizationId } from "@meal-planner/household-api";
import { useQueryClient } from "@tanstack/react-query";
import {
  createFileRoute,
  useRouter,
  Outlet,
  redirect,
} from "@tanstack/react-router";
import { Schema } from "effect";
import { useState } from "react";

import { StatusScreen } from "../components/status-screen.js";
import { Button } from "../components/ui/button.js";
import {
  accountQuery,
  requireAuthSuccess,
  useAuthClient,
} from "../features/auth/index.js";
import {
  familyListQuery,
  familyQuery,
  familyRosterQueryOptions,
} from "../features/family/index.js";
import { SetupProvider } from "../features/onboarding/index.js";

// eslint-disable-next-line sort-keys -- TanStack Router infers loader types from preceding search and dependency options.
export const Route = createFileRoute("/setup")({
  loaderDeps: ({ search }) => ({ familyId: search.familyId }),
  validateSearch: (
    input: Record<string, unknown>
  ): { familyId?: HouseholdOrganizationId | undefined } =>
    Schema.decodeUnknownSync(
      Schema.Struct({ familyId: Schema.optional(HouseholdOrganizationId) })
    )(input),
  beforeLoad: async ({ context, location }) => {
    const account = await context.queryClient.ensureQueryData(
      accountQuery(context.auth)
    );
    if (!account) {
      throw redirect({ search: { redirect: location.href }, to: "/login" });
    }
    return { account };
  },
  component: () => (
    <SetupProvider>
      <Outlet />
    </SetupProvider>
  ),
  errorComponent: () => {
    const router = useRouter();
    const auth = useAuthClient();
    const queryClient = useQueryClient();
    const [signingOut, setSigningOut] = useState(false);
    const [signOutError, setSignOutError] = useState(false);
    return (
      <StatusScreen
        title="Your family couldn’t be loaded"
        footer={
          <div className="flex flex-col items-start gap-3">
            <Button
              disabled={signingOut}
              onClick={async () => {
                setSigningOut(true);
                setSignOutError(false);
                try {
                  await requireAuthSuccess(auth.signOut());
                  queryClient.clear();
                  await router.navigate({
                    replace: true,
                    search: { redirect: router.state.location.href },
                    to: "/login",
                  });
                } catch {
                  setSignOutError(true);
                } finally {
                  setSigningOut(false);
                }
              }}
              variant="outline"
            >
              {signingOut ? "Logging out…" : "Log out and sign in again"}
            </Button>
            {signOutError && (
              <p className="text-destructive text-sm" role="alert">
                We couldn’t log you out. Try again.
              </p>
            )}
          </div>
        }
        retry={() => router.invalidate()}
      />
    );
  },
  headers: () => ({ "Cache-Control": "private, no-store" }),
  loader: async ({ context, deps, location }) => {
    let { familyId } = deps;
    if (!familyId) {
      const families = await context.queryClient.ensureQueryData(
        familyListQuery(context.api, context.account.user.id)
      );
      familyId =
        families.find(
          (family) => family.id === context.account.session.activeOrganizationId
        )?.id ?? families[0]?.id;
    }
    if (familyId) {
      await Promise.all([
        context.queryClient.ensureQueryData(
          familyQuery(context.api, context.account.user.id, familyId)
        ),
        ...(location.pathname === "/setup/family"
          ? []
          : [
              context.queryClient.ensureQueryData(
                familyRosterQueryOptions(
                  context.api,
                  context.account.user.id,
                  familyId
                )
              ),
            ]),
      ]);
    }
  },
});

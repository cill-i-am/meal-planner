import type { HouseholdOrganizationId } from "@meal-planner/household-api";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Navigate, useRouter } from "@tanstack/react-router";
import { Data, Effect } from "effect";
import { createContext, use, useMemo, useState } from "react";
import type { ReactNode } from "react";

import { StatusScreen } from "../../components/status-screen.js";
import { Button } from "../../components/ui/button.js";
import { useApiRuntime } from "../api-client/index.js";
import { accountQuery, accountKey } from "./account-query.js";
import type { Account } from "./account-query.js";
import {
  makeAuthClient,
  requireAuthSuccess,
  useAuthClient,
} from "./auth-client.js";

class AccountOperationFailure extends Data.TaggedError(
  "AccountOperationFailure"
)<{ readonly cause: unknown }> {}
const external = <A,>(run: () => Promise<A>) =>
  Effect.tryPromise({
    catch: (cause) => new AccountOperationFailure({ cause }),
    try: run,
  });
interface AccountContextValue {
  readonly user: Account["user"];
  readonly activeFamilyId: string | null | undefined;
  readonly selectFamily: (
    id: HouseholdOrganizationId
  ) => Effect.Effect<void, AccountOperationFailure>;
  readonly logout: (
    returnTo: string
  ) => Effect.Effect<void, AccountOperationFailure>;
}
const AccountContext = createContext<AccountContextValue | null>(null);
export const useAccount = () => {
  const account = use(AccountContext);
  if (account === null) {
    throw new Error("An authenticated account provider is required.");
  }
  return account;
};
const AuthenticatedAccount = ({
  user,
  activeFamilyId,
  refreshSession,
  children,
}: {
  readonly user: Account["user"];
  readonly activeFamilyId: string | null | undefined;
  readonly refreshSession: () => Promise<unknown>;
  readonly children: ReactNode;
}) => {
  const runtime = useApiRuntime();
  const auth = useMemo(
    () => makeAuthClient(runtime.fetch, user.id, `${runtime.baseUrl}/api/auth`),
    [runtime, user.id]
  );
  const queryClient = useQueryClient();
  const router = useRouter();
  return (
    <AccountContext
      value={{
        activeFamilyId,
        logout: (returnTo) =>
          external(async () => {
            await requireAuthSuccess(auth.signOut());
            queryClient.clear();
            await router.navigate({
              replace: true,
              search: { redirect: returnTo },
              to: "/login",
            });
          }),
        selectFamily: (id) =>
          external(async () => {
            await requireAuthSuccess(
              auth.organization.setActive({ organizationId: id })
            );
            await refreshSession();
          }),
        user,
      }}
    >
      {children}
    </AccountContext>
  );
};
export const AccountProvider = ({
  children,
}: {
  readonly children: ReactNode;
}) => {
  const auth = useAuthClient();
  const queryClient = useQueryClient();
  const session = useQuery(accountQuery(auth));
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState(false);
  if (session.isPending) {
    return <StatusScreen pending title="Loading your account…" />;
  }
  if (session.error) {
    return (
      <StatusScreen
        title="Your account couldn’t be loaded"
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
        retry={() => session.refetch()}
      />
    );
  }
  if (!session.data) {
    return (
      <Navigate
        to="/login"
        search={{ redirect: router.state.location.href }}
        replace
      />
    );
  }
  const { user } = session.data;
  return (
    <AuthenticatedAccount
      key={user.id}
      user={user}
      activeFamilyId={session.data.session.activeOrganizationId}
      refreshSession={() =>
        queryClient.invalidateQueries({ queryKey: accountKey })
      }
    >
      {children}
    </AuthenticatedAccount>
  );
};

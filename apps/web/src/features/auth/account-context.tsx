import { EmailAddress, UserId } from "@meal-planner/household-api";
import type { HouseholdOrganizationId } from "@meal-planner/household-api";
import { useQueryClient } from "@tanstack/react-query";
import { Navigate, useRouter } from "@tanstack/react-router";
import { Data, Effect, Schema } from "effect";
import { createContext, use, useMemo } from "react";
import type { ReactNode } from "react";

import { StatusScreen } from "../../components/status-screen.js";
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
const AccountUser = Schema.Struct({
  email: EmailAddress,
  id: UserId,
  name: Schema.String,
});
interface AccountContextValue {
  readonly user: typeof AccountUser.Type;
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
  readonly user: typeof AccountUser.Type;
  readonly activeFamilyId: string | null | undefined;
  readonly refreshSession: () => Promise<unknown>;
  readonly children: ReactNode;
}) => {
  const auth = useMemo(() => makeAuthClient(fetch, user.id), [user.id]);
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
  const session = auth.useSession();
  const router = useRouter();
  if (session.isPending) {
    return <StatusScreen title="Loading your account…" />;
  }
  if (session.error) {
    return (
      <StatusScreen
        title="Your account couldn’t be loaded"
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
  const user = Schema.decodeUnknownSync(AccountUser)(session.data.user);
  return (
    <AuthenticatedAccount
      key={user.id}
      user={user}
      activeFamilyId={session.data.session.activeOrganizationId}
      refreshSession={session.refetch}
    >
      {children}
    </AuthenticatedAccount>
  );
};

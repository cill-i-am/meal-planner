import { SetupProgress } from "@meal-planner/household-api";
import { useQueryClient } from "@tanstack/react-query";
import { Navigate, useRouter } from "@tanstack/react-router";
import { Schema } from "effect";
import type { ReactNode } from "react";
import { createContext, use, useMemo, useState } from "react";

import {
  makeAuthClient,
  useAuthClient,
  requireAuthSuccess,
} from "../auth/auth-client.js";
import { makeBrowserHouseholdPeopleOperations } from "../household-people/browser-operations.js";
import type { HouseholdPeopleOperations } from "../household-people/operations.js";
import { initialSetup, parseSetupProgress } from "./setup-state.js";
import { SetupStatus } from "./setup-ui.js";

type AuthClient = ReturnType<typeof useAuthClient>;
interface SetupContextValue {
  readonly auth: AuthClient;
  readonly user: {
    readonly id: string;
    readonly name: string;
    readonly email: string;
  };
  readonly progress: SetupProgress;
  readonly families: readonly {
    readonly id: string;
    readonly name: string;
    readonly slug: string;
  }[];
  readonly peopleForFamily: (id: string) => HouseholdPeopleOperations;
  readonly save: (progress: SetupProgress) => Promise<void>;
  readonly selectFamily: (id: string) => Promise<void>;
  readonly logout: () => Promise<void>;
}
const SetupContext = createContext<SetupContextValue | null>(null);
export const useSetup = () => {
  const context = use(SetupContext);
  if (context === null) {
    throw new Error("Setup requires its account provider.");
  }
  return context;
};

const SetupLoginRedirect = () => {
  const router = useRouter();
  const [redirect] = useState(() => router.state.location.href);
  return <Navigate to="/login" search={{ redirect }} replace />;
};

export const SetupProvider = ({
  children,
}: {
  readonly children: ReactNode;
}) => {
  const auth = useAuthClient();
  const session = auth.useSession();
  const organizations = auth.useListOrganizations();
  const active = auth.useActiveOrganization();
  const queryClient = useQueryClient();
  const router = useRouter();
  const userId = session.data?.user.id;
  const scopedAuth = useMemo(() => makeAuthClient(fetch, userId), [userId]);
  if (session.isPending) {
    return <SetupStatus title="Loading your setup…" />;
  }
  if (session.error) {
    return (
      <SetupStatus
        title="Your account didn’t load"
        retry={() => session.refetch()}
      />
    );
  }
  if (session.data === null) {
    return <SetupLoginRedirect />;
  }
  if (organizations.isPending) {
    return <SetupStatus title="Loading your family…" />;
  }
  if (organizations.error) {
    return (
      <SetupStatus
        title="Your family didn’t load"
        retry={async () => {
          await Promise.all([organizations.refetch(), active.refetch()]);
        }}
      />
    );
  }
  let progress: SetupProgress;
  try {
    progress = parseSetupProgress(
      session.data.user.setupProgress ?? initialSetup
    );
  } catch {
    return (
      <SetupStatus
        title="Your saved setup couldn’t be read"
        retry={() => session.refetch()}
      />
    );
  }
  const { user } = session.data;
  const save = async (next: SetupProgress) => {
    const decoded = Schema.decodeUnknownSync(SetupProgress)(next);
    await requireAuthSuccess(scopedAuth.updateUser({ setupProgress: decoded }));
    await session.refetch();
  };
  return (
    <SetupContext
      key={user.id}
      value={{
        auth: scopedAuth,
        families: organizations.data ?? [],
        logout: async () => {
          const redirect = router.state.location.pathname.startsWith(
            "/invitation/"
          )
            ? router.state.location.href
            : "/setup";
          await requireAuthSuccess(scopedAuth.signOut());
          await session.refetch();
          queryClient.clear();
          await router.navigate({
            replace: true,
            search: { redirect },
            to: "/login",
          });
        },
        peopleForFamily: (organizationId) =>
          makeBrowserHouseholdPeopleOperations({
            organizationId,
            userId: user.id,
          }),
        progress,
        save,
        selectFamily: async (id) => {
          const current = await requireAuthSuccess(scopedAuth.getSession());
          if (current.session.activeOrganizationId !== id) {
            await requireAuthSuccess(
              scopedAuth.organization.setActive({ organizationId: id })
            );
          }
          await Promise.all([active.refetch(), organizations.refetch()]);
        },
        user,
      }}
    >
      {children}
    </SetupContext>
  );
};

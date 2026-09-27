import type { Family as SavedFamily } from "@meal-planner/families";
import type { HouseholdOrganizationId } from "@meal-planner/household-api";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouterState } from "@tanstack/react-router";
import { Effect } from "effect";
import { createContext, use } from "react";
import type { ReactNode } from "react";

import { StatusScreen } from "../../components/status-screen.js";
import { useAccount } from "../auth/index.js";
import { makeBrowserHouseholdPeopleEffectOperations } from "../household-people/client.js";
import {
  familyKeys,
  familyListQuery,
  familyQuery,
} from "./family-operations.js";

type Account = ReturnType<typeof useAccount>;
interface FamilyContextValue extends Account {
  readonly family: SavedFamily | undefined;
  readonly families: readonly SavedFamily[];
  readonly peopleEffectForFamily: (
    id: HouseholdOrganizationId
  ) => ReturnType<typeof makeBrowserHouseholdPeopleEffectOperations>;
  readonly refresh: () => Promise<void>;
}
const FamilyContext = createContext<FamilyContextValue | null>(null);
export const useFamily = () => {
  const value = use(FamilyContext);
  if (value === null) {
    throw new Error("A family provider is required.");
  }
  return value;
};
export const useFamilyActions = () => {
  const account = useAccount();
  const queryClient = useQueryClient();
  const refresh = () =>
    queryClient.invalidateQueries({
      queryKey: familyKeys.all(account.user.id),
    });
  return {
    refresh,
    selectFamily: (id: HouseholdOrganizationId) =>
      account.selectFamily(id).pipe(Effect.tap(() => Effect.promise(refresh))),
  };
};
export const FamilyProvider = ({
  children,
}: {
  readonly children: ReactNode;
}) => {
  const account = useAccount();
  const actions = useFamilyActions();
  const families = useQuery(familyListQuery(account.user.id));
  const search = useRouterState({
    select: (state) => state.location.searchStr,
  });
  const requested = new URLSearchParams(search).get("familyId");
  const selected =
    requested === null
      ? (families.data?.find((f) => f.id === account.activeFamilyId) ??
        families.data?.[0])
      : families.data?.find((f) => f.id === requested);
  const family = useQuery(familyQuery(account.user.id, selected?.id));
  if (families.isPending || (selected !== undefined && family.isPending)) {
    return <StatusScreen title="Loading your family…" />;
  }
  if (
    families.isError ||
    family.isError ||
    (requested !== null && selected === undefined)
  ) {
    return (
      <StatusScreen
        title="Your family couldn’t be loaded"
        retry={async () => {
          await families.refetch();
          if (selected) {
            await family.refetch();
          }
        }}
      />
    );
  }
  return (
    <FamilyContext
      value={{
        ...account,
        ...actions,
        families: families.data,
        family: family.data,
        peopleEffectForFamily: (organizationId) =>
          makeBrowserHouseholdPeopleEffectOperations({
            organizationId,
            userId: account.user.id,
          }),
      }}
    >
      {children}
    </FamilyContext>
  );
};

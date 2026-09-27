import type { Family } from "@meal-planner/families";
import type { HouseholdOrganizationId } from "@meal-planner/household-api";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearch } from "@tanstack/react-router";
import { Effect } from "effect";
import { createContext, use } from "react";
import type { ReactNode } from "react";

import { StatusScreen } from "../../components/status-screen.js";
import { useApiRuntime } from "../api-client/index.js";
import { useAccount } from "../auth/index.js";
import {
  familyKeys,
  familyListQuery,
  familyQuery,
} from "./family-operations.js";

const FamilyContext = createContext<{
  readonly family: Family | undefined;
} | null>(null);
export const useFamily = () => {
  const value = use(FamilyContext);
  if (value === null) {
    throw new Error("A family provider is required.");
  }
  return value;
};
export const useFamilyList = () => {
  const { user } = useAccount();
  return useQuery(familyListQuery(useApiRuntime(), user.id));
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

/** Context exposes selected resource data only; queries and mutations own their operations. */
export const FamilyProvider = ({
  children,
}: {
  readonly children: ReactNode;
}) => {
  const account = useAccount();
  const runtime = useApiRuntime();
  const search = useSearch({ strict: false });
  const requested = search.familyId;
  const families = useQuery({
    ...familyListQuery(runtime, account.user.id),
    enabled: requested === undefined,
  });
  const selected =
    requested ??
    families.data?.find((f) => f.id === account.activeFamilyId)?.id ??
    families.data?.[0]?.id;
  const family = useQuery(familyQuery(runtime, account.user.id, selected));
  if (
    (requested === undefined && families.isPending) ||
    (selected !== undefined && family.isPending)
  ) {
    return <StatusScreen title="Loading your family…" />;
  }
  if ((requested === undefined && families.isError) || family.isError) {
    return (
      <StatusScreen
        title="Your family couldn’t be loaded"
        retry={async () => {
          if (requested === undefined) {
            await families.refetch();
          }
          if (selected) {
            await family.refetch();
          }
        }}
      />
    );
  }
  return (
    <FamilyContext
      key={selected ?? "unselected"}
      value={{ family: family.data }}
    >
      {children}
    </FamilyContext>
  );
};

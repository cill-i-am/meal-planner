import { useQuery } from "@tanstack/react-query";

import { Button } from "../../components/ui/button.js";
import { apiEffectQuery } from "../api-client/index.js";
import type { HouseholdOperations } from "./browser-operations.js";

export const HouseholdDomainStatus = ({
  organizationId,
  operations,
}: {
  readonly operations: HouseholdOperations;
  readonly organizationId: string;
}) => {
  const household = useQuery(
    apiEffectQuery.queryOptions({
      queryFn: operations.current,
      queryKey: [organizationId, "household-domain"],
      retry: false,
    })
  );

  if (household.isPending) {
    return <span role="status">Preparing household storage…</span>;
  }
  if (household.isError) {
    return (
      <span role="alert">
        Household storage unavailable.
        <Button
          onClick={() => {
            void household.refetch();
          }}
          type="button"
        >
          Retry
        </Button>
      </span>
    );
  }
  return <span role="status">Household storage ready</span>;
};

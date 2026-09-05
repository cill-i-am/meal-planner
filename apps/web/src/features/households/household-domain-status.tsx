import { useQuery } from "@tanstack/react-query";

import { Button } from "../../components/ui/button.js";
import type { HouseholdOperations } from "./operations.js";

export const HouseholdDomainStatus = ({
  organizationId,
  operations,
}: {
  readonly operations: HouseholdOperations;
  readonly organizationId: string;
}) => {
  const household = useQuery({
    queryFn: operations.current,
    queryKey: [organizationId, "household-domain"],
    retry: false,
  });

  if (household.isPending) {
    return <span role="status">Preparing household storage…</span>;
  }
  if (household.isError) {
    return (
      <span role="alert">
        Household storage unavailable.
        <Button onClick={() => void household.refetch()} type="button">
          Retry
        </Button>
      </span>
    );
  }
  return <span role="status">Household storage ready</span>;
};

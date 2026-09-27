import { useQuery } from "@tanstack/react-query";

import { useApiRuntime } from "../api-client/index.js";
import { useAccount } from "../auth/index.js";
import { useFamily } from "./family-context.js";
import { familyRosterQueryOptions } from "./people-queries.js";

export const useFamilyRoster = () => {
  const family = useFamily();
  const account = useAccount();
  const runtime = useApiRuntime();
  return useQuery(
    familyRosterQueryOptions(runtime, account.user.id, family.family?.id)
  );
};

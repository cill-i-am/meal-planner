import { useQuery } from "@tanstack/react-query";

import { useFamily } from "./family-context.js";
import { familyRosterQueryOptions } from "./people-queries.js";

export const useFamilyRoster = () => {
  const family = useFamily();
  return useQuery(familyRosterQueryOptions(family.user.id, family.family?.id));
};

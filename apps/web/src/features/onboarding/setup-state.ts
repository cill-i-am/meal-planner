import type { Family } from "@meal-planner/families";

export const setupDestination = (family: Family | undefined) => {
  if (!family) {
    return "/setup/family";
  }
  if (family.setup.status === "complete") {
    return "/";
  }
  return "/setup/review";
};

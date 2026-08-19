import type { HouseholdStatus } from "@meal-planner/household-api";

export interface HouseholdOperations {
  readonly current: () => Promise<HouseholdStatus>;
}

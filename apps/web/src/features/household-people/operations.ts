import type {
  BootstrapHouseholdCreatorPayload,
  CreateHouseholdPersonPayload,
  HouseholdPeopleRoster,
  HouseholdPerson,
  HouseholdPersonId,
  TransitionHouseholdPersonPayload,
} from "@meal-planner/household-api";

/** Browser-facing household people operations. */
export interface HouseholdPeopleOperations {
  readonly archive: (
    personId: HouseholdPersonId,
    payload: TransitionHouseholdPersonPayload
  ) => Promise<HouseholdPerson>;
  readonly bootstrapCreator: (
    payload: BootstrapHouseholdCreatorPayload
  ) => Promise<HouseholdPerson>;
  readonly create: (
    payload: CreateHouseholdPersonPayload
  ) => Promise<HouseholdPerson>;
  readonly list: (includeArchived: boolean) => Promise<HouseholdPeopleRoster>;
  readonly restore: (
    personId: HouseholdPersonId,
    payload: TransitionHouseholdPersonPayload
  ) => Promise<HouseholdPerson>;
}

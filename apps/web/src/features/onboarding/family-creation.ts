import type { SetupCheckpoint } from "@meal-planner/household-api";
import { HouseholdOrganizationId } from "@meal-planner/household-api";
import { Schema } from "effect";

import { requireAuthSuccess } from "../auth/auth-client.js";
import type { makeAuthClient } from "../auth/auth-client.js";
import type { HouseholdPeopleOperations } from "../household-people/operations.js";

type Creation = Extract<SetupCheckpoint, { stage: "family-create" }>;
/** The persisted slug identifies this exact creation even if its response was lost. */
export const completeFamilyCreation = async (
  command: Creation,
  auth: ReturnType<typeof makeAuthClient>,
  peopleForFamily: (
    id: typeof HouseholdOrganizationId.Type
  ) => Pick<HouseholdPeopleOperations, "list" | "bootstrapCreator">
): Promise<Extract<SetupCheckpoint, { stage: "family-review" }>> => {
  const families = await requireAuthSuccess(auth.organization.list());
  const existing = families.find((family) => family.slug === command.slug);
  const family =
    existing ??
    (await requireAuthSuccess(
      auth.organization.create({ name: command.name, slug: command.slug })
    ));
  await requireAuthSuccess(
    auth.organization.setActive({ organizationId: family.id })
  );
  const organizationId = Schema.decodeUnknownSync(HouseholdOrganizationId)(
    family.id
  );
  const people = peopleForFamily(organizationId);
  const roster = await people.list(false);
  if (roster.currentPersonId === null) {
    // Backend owns creator-slot and mutation-id uniqueness; retry this exact payload.
    await people.bootstrapCreator(command.creator);
  }
  return {
    organizationId,
    stage: "family-review",
  };
};

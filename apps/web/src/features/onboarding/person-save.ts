import { InviteHouseholdAdultPayload } from "@meal-planner/household-api";
import type { SetupCheckpoint } from "@meal-planner/household-api";
import { Schema } from "effect";

import { HouseholdPeopleOperationError } from "../household-people/operations.js";
import type { HouseholdPeopleOperations } from "../household-people/operations.js";

type PendingPerson = Extract<
  SetupCheckpoint,
  { stage: "person-create" | "person-invite" }
>;
export const saveSetupPerson = async (
  pending: PendingPerson,
  people: HouseholdPeopleOperations,
  checkpoint: (next: SetupCheckpoint, sourceCommandId: string) => Promise<void>
) => {
  let next = pending;
  if (next.stage === "person-create") {
    const person = await people.create(next.command.person);
    if (next.command.kind === "managed") {
      await checkpoint(
        {
          organizationId: next.organizationId,
          stage: "family-review",
        },
        next.command.person.mutationId
      );
      return;
    }
    const creationId = next.command.person.mutationId;
    next = {
      command: Schema.decodeUnknownSync(InviteHouseholdAdultPayload)({
        email: next.command.email,
        mutationId: next.command.invitationMutationId,
        personId: person.id,
      }),
      displayName: person.displayName,
      organizationId: next.organizationId,
      stage: "person-invite",
    };
    await checkpoint(next, creationId);
  }
  if (!people.inviteAdult) {
    throw new Error("Invitation operation is unavailable.");
  }
  // Delivery is mocked at the auth mail boundary; this confirms the invitation record and association only.
  try {
    await people.inviteAdult(next.command);
  } catch (error) {
    if (
      error instanceof HouseholdPeopleOperationError &&
      (error.invitationRejection || error.code === "organizer_required")
    ) {
      await checkpoint(
        {
          displayName: next.displayName,
          email: next.command.email,
          organizationId: next.organizationId,
          personId: next.command.personId,
          reason: error.invitationRejection ?? "forbidden",
          stage: "person-invite-draft",
        },
        next.command.mutationId
      );
      return;
    }
    throw error;
  }
  await checkpoint(
    {
      organizationId: next.organizationId,
      stage: "family-review",
    },
    next.command.mutationId
  );
};

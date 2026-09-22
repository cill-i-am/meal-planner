import { InvitationView } from "@meal-planner/household-api";
import type { SetupCheckpoint } from "@meal-planner/household-api";
import { Schema } from "effect";

import type { makeAuthClient } from "../auth/auth-client.js";
import { requireAuthSuccess } from "../auth/auth-client.js";
import { AuthRequestError } from "../auth/auth-errors.js";
import type { HouseholdPeopleOperations } from "../household-people/operations.js";

export const readInvitation = async (
  id: string,
  userId: string
): Promise<InvitationView> => {
  const response = await fetch(
    `/api/auth/setup/invitation/${encodeURIComponent(id)}`,
    { headers: { "x-meal-planner-user": userId } }
  );
  const body: unknown = await response.json();
  if (!response.ok) {
    const parsed = Schema.decodeUnknownSync(
      Schema.Struct({ code: Schema.optional(Schema.String) })
    )(body);
    throw new AuthRequestError({ code: parsed.code, status: response.status });
  }
  return Schema.decodeUnknownSync(InvitationView)(body);
};
export type InvitationCommand = Extract<
  SetupCheckpoint,
  { stage: "invitation-response" | "invitation-link" }
>;

export const completeInvitation = async (
  command: InvitationCommand,
  dependencies: {
    readonly auth: ReturnType<typeof makeAuthClient>;
    readonly read: () => Promise<InvitationView>;
    readonly activate: (id: string) => Promise<void>;
    readonly people: HouseholdPeopleOperations;
    readonly save: (next: SetupCheckpoint) => Promise<void>;
  }
) => {
  const invitation = await dependencies.read();
  if (
    invitation.id !== command.invitationId ||
    invitation.organizationId !== command.organizationId
  ) {
    throw new Error("The invitation changed.");
  }
  if (
    command.stage === "invitation-response" &&
    command.decision === "decline"
  ) {
    if (invitation.status === "pending") {
      await requireAuthSuccess(
        dependencies.auth.organization.rejectInvitation({
          invitationId: command.invitationId,
        })
      );
    } else if (invitation.status !== "rejected") {
      throw new Error("This invitation can no longer be declined.");
    }
    await dependencies.save(command.returnCheckpoint);
    return "declined";
  }
  if (invitation.status === "pending") {
    await requireAuthSuccess(
      dependencies.auth.organization.acceptInvitation({
        invitationId: command.invitationId,
      })
    );
  } else if (invitation.status !== "accepted") {
    throw new Error("This invitation is no longer available.");
  }
  const linking: InvitationCommand = {
    invitationId: command.invitationId,
    linkMutationId: command.linkMutationId,
    organizationId: command.organizationId,
    returnCheckpoint: command.returnCheckpoint,
    stage: "invitation-link",
  };
  await dependencies.save(linking);
  await dependencies.activate(command.organizationId);
  if (!dependencies.people.completeAdultLink) {
    throw new Error("Profile linking is unavailable.");
  }
  const roster = await dependencies.people.list(false);
  if (roster.currentPersonId === null) {
    await dependencies.people.completeAdultLink({
      invitationId: command.invitationId,
      mutationId: command.linkMutationId,
    });
  }
  await dependencies.save({
    organizationId: command.organizationId,
    stage: "ready",
  });
  return "joined";
};

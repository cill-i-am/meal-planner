import { InviteHouseholdAdultPayload } from "@meal-planner/household-api";
import type {
  HouseholdPersonMutationId,
  SetupCheckpoint,
} from "@meal-planner/household-api";
import { Effect, Result, Schema } from "effect";

import type { HouseholdPeopleEffectOperations } from "../household-people/operations.js";

type PendingPerson = Extract<
  SetupCheckpoint,
  { stage: "person-create" | "person-invite" }
>;
export const saveSetupPerson = <E extends { readonly _tag: string }>(
  pending: PendingPerson,
  people: Pick<HouseholdPeopleEffectOperations, "create" | "inviteAdult">,
  checkpoint: (
    next: SetupCheckpoint,
    sourceCommandId: typeof HouseholdPersonMutationId.Type
  ) => Effect.Effect<void, E>
) =>
  Effect.gen(function* savePerson() {
    let next = pending;
    if (next.stage === "person-create") {
      const person = yield* people.create(next.command.person);
      if (next.command.kind === "managed") {
        yield* checkpoint(
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
      yield* checkpoint(next, creationId);
    }
    // Delivery is mocked at the auth mail boundary; this confirms the invitation record and association only.
    const invitation = yield* Effect.result(people.inviteAdult(next.command));
    if (Result.isFailure(invitation)) {
      const error = invitation.failure;
      if (error.invitationRejection || error.code === "organizer_required") {
        yield* checkpoint(
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
      return yield* Effect.fail(error);
    }
    yield* checkpoint(
      {
        organizationId: next.organizationId,
        stage: "family-review",
      },
      next.command.mutationId
    );
  });

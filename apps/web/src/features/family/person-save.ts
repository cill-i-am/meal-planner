import { Effect, Result } from "effect";

import type { HouseholdPeopleEffectOperations } from "../household-people/client.js";
import type { PersonCreation } from "./person-commands.js";

/** Two explicit product actions; a rejected invitation does not erase the saved person. */
export const savePerson = (
  command: PersonCreation,
  people: Pick<HouseholdPeopleEffectOperations, "create" | "inviteAdult">
) =>
  Effect.gen(function* createPersonAndOptionalInvitation() {
    const person = yield* people.create(command.person);
    if (command.kind === "managed") {
      return { invitationIssue: null, person };
    }
    const invitation = yield* Effect.result(
      people.inviteAdult({
        email: command.email,
        mutationId: command.invitationMutationId,
        personId: person.id,
      })
    );
    if (Result.isFailure(invitation)) {
      if (
        invitation.failure.invitationRejection ||
        invitation.failure.code === "organizer_required"
      ) {
        return { invitationIssue: invitation.failure, person };
      }
      return yield* Effect.fail(invitation.failure);
    }
    return { invitationIssue: null, person: invitation.success.person };
  });

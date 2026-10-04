import {
  InviteHouseholdAdultPayload,
  RenameHouseholdPersonPayload,
  TransitionHouseholdPersonPayload,
} from "@meal-planner/household-api";
import { Effect, Schema } from "effect";

import type { HouseholdPeopleEffectOperations } from "../household-people/index.js";
import type { RosterCommand } from "./person-commands.js";

export const runRosterCommand = (
  command: RosterCommand,
  people: HouseholdPeopleEffectOperations
) => {
  switch (command.kind) {
    case "invite": {
      return people
        .inviteAdult(
          Schema.decodeUnknownSync(InviteHouseholdAdultPayload, {
            onExcessProperty: "error",
          })({
            email: command.email,
            mutationId: command.mutationId,
            personId: command.person.id,
          })
        )
        .pipe(Effect.asVoid);
    }
    case "rename": {
      return people
        .rename(
          command.person.id,
          Schema.decodeUnknownSync(RenameHouseholdPersonPayload, {
            onExcessProperty: "error",
          })({
            displayName: command.name,
            expectedVersion: command.person.version,
            mutationId: command.mutationId,
          })
        )
        .pipe(Effect.asVoid);
    }
    case "remove": {
      return people
        .remove(
          command.person.id,
          Schema.decodeUnknownSync(TransitionHouseholdPersonPayload, {
            onExcessProperty: "error",
          })({
            expectedVersion: command.person.version,
            mutationId: command.mutationId,
          })
        )
        .pipe(Effect.asVoid);
    }
    default: {
      throw new Error("Unknown roster command.");
    }
  }
};

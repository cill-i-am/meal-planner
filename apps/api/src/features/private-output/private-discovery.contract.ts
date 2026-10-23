import { PersonProfile } from "@meal-planner/household-api";
import { AssistantTurnId } from "@meal-planner/private-interview-api";
import { Schema } from "effect";

import {
  Generation,
  PrivateSessionBinding,
} from "./private-output.contract.js";

/** Fresh own-profile input enters the private child; no private content returns. */
export const RunAssistantTurn = Schema.Struct({
  ...Generation.fields,
  binding: PrivateSessionBinding,
  profile: PersonProfile,
  turnId: AssistantTurnId,
});

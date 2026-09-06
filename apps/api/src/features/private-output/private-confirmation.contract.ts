import { MutatePersonProfilePayload } from "@meal-planner/household-api";
import { ConfirmationOutcome } from "@meal-planner/private-interview-api";
import { Schema } from "effect";

import { Generation } from "./private-output-socket.js";
import { PrivateSessionBinding } from "./private-output.contract.js";

export const ReleaseConfirmation = Schema.Struct({
  ...Generation.fields,
  binding: PrivateSessionBinding,
  mutationId: Schema.String.pipe(Schema.check(Schema.isUUID())),
});
export const ReleasedConfirmation = Schema.Union([
  Schema.Struct({ type: Schema.Literal("settled") }),
  Schema.Struct({
    ...Generation.fields,
    payload: MutatePersonProfilePayload,
    type: Schema.Literal("pending"),
  }),
]);
export type ReleasedConfirmation = typeof ReleasedConfirmation.Type;
export const SettleConfirmation = Schema.Struct({
  ...ReleaseConfirmation.fields,
  ...Generation.fields,
  outcome: ConfirmationOutcome,
});

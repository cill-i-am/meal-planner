import { PersonProfile } from "@meal-planner/household-api";
import { Schema } from "effect";

import { PrivateSessionBinding } from "./private-output.contract.js";

/** Server-owned admission metadata; the public request cannot supply this authority. */
export const PrivateChatContext = Schema.Struct({
  binding: PrivateSessionBinding,
  generation: Schema.String.pipe(Schema.check(Schema.isUUID())),
  profile: Schema.NullOr(PersonProfile),
}).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));
export type PrivateChatContext = typeof PrivateChatContext.Type;

export const PrivateChatMetadata = Schema.Struct({
  expectedVersion: Schema.Number.pipe(
    Schema.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))
  ),
});

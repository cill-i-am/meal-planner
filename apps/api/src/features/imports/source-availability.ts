import type { Effect } from "effect";
import { Context } from "effect";

import type { SourceAvailabilityError } from "./import.errors.js";
import type { VideoIdentity } from "./source-identity.js";

export interface AvailableSource {
  readonly _tag: "Available";
}

export interface PrivateOrUnavailableSource {
  readonly _tag: "PrivateOrUnavailable";
}

export type SourceAvailability = AvailableSource | PrivateOrUnavailableSource;

export interface SourceAvailabilityValidatorShape {
  readonly validate: (
    source: Omit<VideoIdentity, "_tag">
  ) => Effect.Effect<SourceAvailability, SourceAvailabilityError>;
}

export const SourceAvailabilityValidator =
  Context.Service<SourceAvailabilityValidatorShape>(
    "meal-planner/SourceAvailabilityValidator"
  );

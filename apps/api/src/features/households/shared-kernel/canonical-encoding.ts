import { Context } from "effect";
import type { Effect, Schema } from "effect";

import type { HouseholdAuthorityServiceFailure } from "./authority-service-failure.js";

export interface HouseholdCanonicalEncodingService {
  readonly encode: (
    value: Schema.Json
  ) => Effect.Effect<string, HouseholdAuthorityServiceFailure>;
}

export class HouseholdCanonicalEncoding extends Context.Service<
  HouseholdCanonicalEncoding,
  HouseholdCanonicalEncodingService
>()("meal-planner/households/HouseholdCanonicalEncoding") {}

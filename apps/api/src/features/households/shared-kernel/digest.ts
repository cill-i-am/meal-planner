import { Context } from "effect";
import type { Effect } from "effect";

import type { HouseholdAuthorityServiceFailure } from "./authority-service-failure.js";

export interface HouseholdDigestService {
  readonly sha256: (
    value: string
  ) => Effect.Effect<string, HouseholdAuthorityServiceFailure>;
}

export class HouseholdDigest extends Context.Service<
  HouseholdDigest,
  HouseholdDigestService
>()("meal-planner/households/HouseholdDigest") {}

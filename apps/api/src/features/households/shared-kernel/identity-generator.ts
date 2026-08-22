import { Context } from "effect";
import type { Effect } from "effect";

import type { HouseholdAuthorityServiceFailure } from "./authority-service-failure.js";

export interface HouseholdIdentityGeneratorService {
  readonly generate: () => Effect.Effect<
    string,
    HouseholdAuthorityServiceFailure
  >;
}

export class HouseholdIdentityGenerator extends Context.Service<
  HouseholdIdentityGenerator,
  HouseholdIdentityGeneratorService
>()("meal-planner/households/HouseholdIdentityGenerator") {}

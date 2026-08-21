import { Context, Data, Effect } from "effect";

export class HouseholdAuthorityServiceFailure extends Data.TaggedError(
  "HouseholdAuthorityServiceFailure"
) {}

export interface HouseholdCanonicalEncodingService {
  readonly encode: (
    value: unknown
  ) => Effect.Effect<string, HouseholdAuthorityServiceFailure>;
}

export class HouseholdCanonicalEncoding extends Context.Service<
  HouseholdCanonicalEncoding,
  HouseholdCanonicalEncodingService
>()("meal-planner/households/HouseholdCanonicalEncoding") {}

export interface HouseholdDigestService {
  readonly sha256: (
    value: string
  ) => Effect.Effect<string, HouseholdAuthorityServiceFailure>;
}

export class HouseholdDigest extends Context.Service<
  HouseholdDigest,
  HouseholdDigestService
>()("meal-planner/households/HouseholdDigest") {}

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

import type { HouseholdOrganizationId } from "@meal-planner/household-api";
import { Context, Effect, Layer, Schema } from "effect";

import {
  HouseholdCanonicalEncoding,
  HouseholdDigest,
} from "./shared-kernel/authority-services.js";

export const HouseholdObjectName = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^household:v1:[a-f\d]{64}$/u)),
  Schema.brand("HouseholdObjectName")
);
export type HouseholdObjectName = typeof HouseholdObjectName.Type;

export const makeHouseholdObjectLocator = () =>
  Effect.gen(function* makeLocator() {
    const canonical = yield* HouseholdCanonicalEncoding;
    const digest = yield* HouseholdDigest;
    return {
      locate: (organizationId: HouseholdOrganizationId) =>
        Effect.gen(function* locateHouseholdObject() {
          const encoded = yield* canonical.encode({
            organizationId,
            purpose: "household-object",
            version: 1,
          });
          const opaqueKey = yield* digest.sha256(encoded);
          return yield* Schema.decodeUnknownEffect(HouseholdObjectName)(
            `household:v1:${opaqueKey}`
          );
        }),
    };
  });

export class HouseholdObjectLocator extends Context.Service<
  HouseholdObjectLocator,
  Effect.Success<ReturnType<typeof makeHouseholdObjectLocator>>
>()("meal-planner/households/HouseholdObjectLocator") {
  static readonly layer = Layer.effect(
    HouseholdObjectLocator,
    makeHouseholdObjectLocator().pipe(Effect.map(HouseholdObjectLocator.of))
  );
}

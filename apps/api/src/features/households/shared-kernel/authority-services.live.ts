import { Effect, Layer } from "effect";
import type { Schema } from "effect";

import {
  HouseholdAuthorityServiceFailure,
  HouseholdCanonicalEncoding,
  HouseholdDigest,
  HouseholdIdentityGenerator,
} from "./authority-services.js";

const encodeCanonicalJson = (value: Schema.Json) => {
  const keys = new Set<string>();
  JSON.stringify(value, (key, item: Schema.Json) => {
    keys.add(key);
    return item;
  });
  return JSON.stringify(value, [...keys].toSorted());
};

const canonicalEncoding = HouseholdCanonicalEncoding.of({
  encode: (value) =>
    Effect.try({
      catch: () => new HouseholdAuthorityServiceFailure(),
      try: () => encodeCanonicalJson(value),
    }),
});

const sha256 = (value: string) =>
  Effect.tryPromise({
    catch: () => new HouseholdAuthorityServiceFailure(),
    try: async () => {
      const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(value)
      );
      return Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, "0")
      ).join("");
    },
  });

const digest = HouseholdDigest.of({ sha256 });

const liveIdentity = HouseholdIdentityGenerator.of({
  generate: () =>
    Effect.try({
      catch: () => new HouseholdAuthorityServiceFailure(),
      try: () => crypto.randomUUID(),
    }),
});

export const HouseholdCanonicalEncodingLive = Layer.succeed(
  HouseholdCanonicalEncoding,
  canonicalEncoding
);
export const HouseholdDigestLive = Layer.succeed(HouseholdDigest, digest);
export const HouseholdIdentityGeneratorLive = Layer.succeed(
  HouseholdIdentityGenerator,
  liveIdentity
);

export const HouseholdAuthorityServicesLive = Layer.mergeAll(
  HouseholdCanonicalEncodingLive,
  HouseholdDigestLive,
  HouseholdIdentityGeneratorLive
);

export const makeHouseholdAuthorityTestLayer = (options: {
  readonly identities: readonly [string, ...string[]];
}) => {
  let nextIdentity = 0;
  const identity = HouseholdIdentityGenerator.of({
    generate: () => {
      const value = options.identities[nextIdentity];
      if (value === undefined) {
        return Effect.fail(new HouseholdAuthorityServiceFailure());
      }
      nextIdentity += 1;
      return Effect.succeed(value);
    },
  });
  return Layer.mergeAll(
    Layer.succeed(HouseholdCanonicalEncoding, canonicalEncoding),
    Layer.succeed(HouseholdDigest, digest),
    Layer.succeed(HouseholdIdentityGenerator, identity)
  );
};

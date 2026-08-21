import { Effect, Layer } from "effect";

import {
  HouseholdAuthorityServiceFailure,
  HouseholdCanonicalEncoding,
  HouseholdDigest,
  HouseholdIdentityGenerator,
} from "./authority-services.js";

type CanonicalJson =
  | boolean
  | null
  | number
  | string
  | readonly CanonicalJson[]
  | { readonly [key: string]: CanonicalJson };

const toCanonicalJson = (
  value: unknown,
  seen: WeakSet<object>
): CanonicalJson => {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) {
      throw new HouseholdAuthorityServiceFailure();
    }
    seen.add(value);
    const encoded = value.map((item) => toCanonicalJson(item, seen));
    seen.delete(value);
    return encoded;
  }
  if (typeof value === "object") {
    if (seen.has(value)) {
      throw new HouseholdAuthorityServiceFailure();
    }
    seen.add(value);
    const encoded = Object.fromEntries(
      Object.entries(value)
        .toSorted(([left], [right]) =>
          left < right ? -1 : left > right ? 1 : 0
        )
        .map(([key, item]) => [key, toCanonicalJson(item, seen)])
    );
    seen.delete(value);
    return encoded;
  }
  throw new HouseholdAuthorityServiceFailure();
};

const canonicalEncoding = HouseholdCanonicalEncoding.of({
  encode: (value) =>
    Effect.try({
      catch: () => new HouseholdAuthorityServiceFailure(),
      try: () => JSON.stringify(toCanonicalJson(value, new WeakSet())),
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

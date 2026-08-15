import { describe, expect, it } from "@effect/vitest";
import { Effect, Exit, Schema } from "effect";

import { RetryableAcquisitionError } from "./import-media.errors.js";
import {
  AcquisitionGeneration,
  FrameTimestampMilliseconds,
  ManifestObjectKey,
  MediaArtifactId,
  MediaByteCount,
  MediaDurationSeconds,
  MediaDurationMilliseconds,
  MediaObjectKey,
  Sha256Hex,
  acquisitionArtifactId,
  manifestObjectKey,
  mediaObjectKey,
} from "./import-media.model.js";
import { ImportId } from "./import.contracts.js";

const importId = Schema.decodeUnknownSync(ImportId)(
  "018f47ad-91aa-7c35-b6fe-000000000001"
);
const generation = Schema.decodeUnknownSync(AcquisitionGeneration)(2);

describe("import media domain values", () => {
  it.effect("constructs validated, purpose-specific artifact identities", () =>
    Effect.gen(function* constructArtifactIdentitiesEffect() {
      const artifactId = acquisitionArtifactId(importId, generation);
      const mediaKey = mediaObjectKey(importId, generation);
      const manifestKey = manifestObjectKey(importId, generation);

      expect(Schema.is(MediaArtifactId)(artifactId)).toBe(true);
      expect(Schema.is(MediaObjectKey)(mediaKey)).toBe(true);
      expect(Schema.is(ManifestObjectKey)(manifestKey)).toBe(true);

      const crossedKeys = yield* Effect.all([
        Schema.decodeUnknownEffect(ManifestObjectKey)(mediaKey).pipe(
          Effect.exit
        ),
        Schema.decodeUnknownEffect(MediaObjectKey)(manifestKey).pipe(
          Effect.exit
        ),
      ]);
      expect(crossedKeys.every((exit) => exit._tag === "Failure")).toBe(true);
    })
  );

  it.effect(
    "rejects invalid hashes, byte counts, and durations at ingress",
    () =>
      Effect.gen(function* rejectInvalidDomainValuesEffect() {
        const invalidValues = yield* Effect.all([
          Schema.decodeUnknownEffect(Sha256Hex)("not-a-hash").pipe(Effect.exit),
          Schema.decodeUnknownEffect(MediaByteCount)(0).pipe(Effect.exit),
          Schema.decodeUnknownEffect(MediaDurationSeconds)(0).pipe(Effect.exit),
          Schema.decodeUnknownEffect(MediaDurationMilliseconds)(0).pipe(
            Effect.exit
          ),
          Schema.decodeUnknownEffect(FrameTimestampMilliseconds)(-1).pipe(
            Effect.exit
          ),
        ]);

        expect(invalidValues.every((exit) => exit._tag === "Failure")).toBe(
          true
        );
        expect(
          Schema.decodeUnknownSync(Sha256Hex)("a".repeat(64))
        ).toHaveLength(64);
      })
  );

  it.effect(
    "represents retryable acquisition failures as yieldable schemas",
    () =>
      Effect.gen(function* yieldRetryableAcquisitionFailureEffect() {
        const failure = new RetryableAcquisitionError({
          reason: "container_rpc",
          stage: "store",
        });
        const exit = yield* Effect.exit(failure);

        expect(Exit.isFailure(exit)).toBe(true);
        expect(Schema.is(RetryableAcquisitionError)(failure)).toBe(true);
        expect(failure).toMatchObject({
          _tag: "RetryableAcquisitionFailure",
          reason: "container_rpc",
          stage: "store",
        });
      })
  );
});

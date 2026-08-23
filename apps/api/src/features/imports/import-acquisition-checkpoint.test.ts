import { Effect, Option, Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  continueHouseholdAcquisitionCheckpoint,
  decodeAcquisitionCheckpoint,
  recoverHouseholdVerifiedAcquisitionCheckpoint,
} from "./import-acquisition-checkpoint.js";
import type { HouseholdImportEvidenceCurrent } from "./import-evidence.repository.household.js";
import {
  AcquisitionTaskOutcome,
  AcquisitionGeneration,
  manifestObjectKey,
  mediaObjectKey,
} from "./import-media.model.js";
import { ImportId, SourceCanonicalId } from "./import.contracts.js";

const importId = Schema.decodeUnknownSync(ImportId)(
  "00000000-0000-4000-8000-000000000189"
);
const generation = Schema.decodeUnknownSync(AcquisitionGeneration)(1);
const acquiredAt = "2026-07-28T10:00:00.000Z";

const verifiedOutcome = () => {
  const outcome = Schema.decodeUnknownSync(AcquisitionTaskOutcome)({
    _tag: "VerifiedAcquisition",
    evidence: {
      acquiredAt,
      audioStreams: [{ codec: "aac", index: 1 }],
      bytes: 1024,
      deleteAt: "2026-08-04T10:00:00.000Z",
      durationSeconds: 30,
      generation: 1,
      manifestByteLength: 512,
      manifestKey: manifestObjectKey(importId, generation),
      manifestSha256: "b".repeat(64),
      mediaKey: mediaObjectKey(importId, generation),
      sha256: "a".repeat(64),
      source: {
        canonicalUrl: "https://example.invalid/redacted-source",
        caption: null,
        creator: {
          displayName: null,
          handle: null,
          id: null,
        },
        observedAt: acquiredAt,
        provenance: {
          canonicalUrl: "provider_observed",
          caption: null,
          creator: {
            displayName: null,
            handle: null,
            id: null,
          },
          publishedAt: "provider_observed",
        },
        publishedAt: "2026-07-27T10:00:00.000Z",
      },
      videoStreams: [{ codec: "h264", index: 0 }],
    },
    generation: 1,
  });
  if (outcome._tag !== "VerifiedAcquisition") {
    throw new Error("Expected a verified acquisition outcome");
  }
  return outcome;
};

const currentCheckpoint = () =>
  Schema.encodeSync(AcquisitionTaskOutcome)(verifiedOutcome());

const currentEvidence = (
  overrides: Partial<HouseholdImportEvidenceCurrent> = {}
): HouseholdImportEvidenceCurrent => ({
  acquisitionGeneration: generation,
  canonicalSourceId: Schema.decodeUnknownSync(SourceCanonicalId)(
    "synthetic-canonical-id"
  ),
  importId,
  sourceKind: "tiktok",
  status: {
    code: "transcription_failed",
    kind: "failed",
    recovery: "retry_later",
  },
  ...overrides,
});

describe("acquisition checkpoint boundary", () => {
  it("decodes the current schema-encoded checkpoint", () => {
    const checkpoint = currentCheckpoint();
    expect(
      Schema.decodeUnknownResult(AcquisitionTaskOutcome)(checkpoint)._tag
    ).toBe("Success");
    expect(decodeAcquisitionCheckpoint(checkpoint)).toMatchObject({
      _tag: "Accepted",
      outcome: { _tag: "VerifiedAcquisition", generation },
    });
  });

  it.each([
    {
      name: "invalid timestamp",
      value: "not-a-timestamp",
    },
    {
      name: "obsolete structured timestamp",
      value: { epochMilliseconds: 1_785_232_800_000 },
    },
  ])("fails closed for $name", ({ value }) => {
    const checkpoint = currentCheckpoint();
    if (checkpoint._tag !== "VerifiedAcquisition") {
      throw new Error("Expected a verified acquisition checkpoint");
    }
    expect(
      decodeAcquisitionCheckpoint({
        ...checkpoint,
        evidence: {
          ...checkpoint.evidence,
          acquiredAt: value,
        },
      })
    ).toEqual({
      _tag: "AcquisitionCheckpointRejected",
      code: "acquisition_checkpoint_invalid",
    });
  });

  it.each([
    {
      current: currentEvidence({
        importId: Schema.decodeUnknownSync(ImportId)(
          "00000000-0000-4000-8000-000000000999"
        ),
      }),
      name: "foreign import identity",
    },
    {
      current: currentEvidence({
        acquisitionGeneration: Schema.decodeUnknownSync(AcquisitionGeneration)(
          2
        ),
      }),
      name: "foreign generation",
    },
    {
      current: currentEvidence({ status: { kind: "queued" } }),
      name: "non-owned lifecycle",
    },
  ])("fails closed for $name", async ({ current }) => {
    const decoded = decodeAcquisitionCheckpoint(currentCheckpoint());
    if (decoded._tag !== "Accepted") {
      throw new Error("Expected the synthetic checkpoint to decode");
    }
    await expect(
      Effect.runPromise(
        continueHouseholdAcquisitionCheckpoint({
          current: Effect.succeed(Option.some(current)),
          importId,
          onAccepted: () => Effect.succeed("continued" as const),
          outcome: decoded.outcome,
        })
      )
    ).resolves.toEqual({
      _tag: "AcquisitionCheckpointRejected",
      code: "acquisition_checkpoint_invalid",
    });
  });

  it("accepts exact household import, generation, and lifecycle ownership", async () => {
    const decoded = decodeAcquisitionCheckpoint(currentCheckpoint());
    if (decoded._tag !== "Accepted") {
      throw new Error("Expected the synthetic checkpoint to decode");
    }
    await expect(
      Effect.runPromise(
        continueHouseholdAcquisitionCheckpoint({
          current: Effect.succeed(Option.some(currentEvidence())),
          importId,
          onAccepted: () => Effect.succeed("continued" as const),
          outcome: decoded.outcome,
        })
      )
    ).resolves.toBe("continued");
  });
});

describe("retained acquisition recovery boundary", () => {
  it("leaves an acquiring import on the ordinary acquisition path", async () => {
    let evidenceReads = 0;
    const acquiring = currentEvidence({ status: { kind: "acquiring" } });

    await expect(
      Effect.runPromise(
        recoverHouseholdVerifiedAcquisitionCheckpoint({
          current: Effect.succeed(Option.some(acquiring)),
          expectedCanonicalId: acquiring.canonicalSourceId,
          importId,
          readEvidence: () =>
            Effect.sync(() => {
              evidenceReads += 1;
              return verifiedOutcome().evidence;
            }),
        })
      )
    ).resolves.toBeNull();
    expect(evidenceReads).toBe(0);
  });

  it("reuses exact retained evidence without reacquisition", async () => {
    let evidenceReads = 0;
    const { evidence } = verifiedOutcome();

    await expect(
      Effect.runPromise(
        recoverHouseholdVerifiedAcquisitionCheckpoint({
          current: Effect.succeed(Option.some(currentEvidence())),
          expectedCanonicalId: currentEvidence().canonicalSourceId,
          importId,
          readEvidence: () =>
            Effect.sync(() => {
              evidenceReads += 1;
              return evidence;
            }),
        })
      )
    ).resolves.toMatchObject({
      _tag: "VerifiedAcquisition",
      evidence,
      generation,
    });
    expect(evidenceReads).toBe(1);
  });

  it("fails closed when retained evidence is absent", async () => {
    await expect(
      Effect.runPromise(
        recoverHouseholdVerifiedAcquisitionCheckpoint({
          current: Effect.succeed(Option.some(currentEvidence())),
          expectedCanonicalId: currentEvidence().canonicalSourceId,
          importId,
          readEvidence: () => Effect.succeed(null),
        })
      )
    ).resolves.toEqual({
      _tag: "AcquisitionCheckpointRejected",
      code: "acquisition_checkpoint_invalid",
    });
  });

  it("fails closed before reading evidence for incompatible identity", async () => {
    let evidenceReads = 0;
    const incompatible = currentEvidence({
      canonicalSourceId: Schema.decodeUnknownSync(SourceCanonicalId)(
        "different-canonical-id"
      ),
    });

    await expect(
      Effect.runPromise(
        recoverHouseholdVerifiedAcquisitionCheckpoint({
          current: Effect.succeed(Option.some(incompatible)),
          expectedCanonicalId: currentEvidence().canonicalSourceId,
          importId,
          readEvidence: () =>
            Effect.sync(() => {
              evidenceReads += 1;
              return verifiedOutcome().evidence;
            }),
        })
      )
    ).resolves.toEqual({
      _tag: "AcquisitionCheckpointRejected",
      code: "acquisition_checkpoint_invalid",
    });
    expect(evidenceReads).toBe(0);
  });
});

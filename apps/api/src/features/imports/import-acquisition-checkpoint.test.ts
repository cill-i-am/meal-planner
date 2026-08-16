import { Effect, Option, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { historicalAcquisitionCheckpointFixture } from "./import-acquisition-checkpoint.historical-fixture.js";
import {
  decodeAcquisitionCheckpoint,
  recoverVerifiedAcquisitionCheckpoint,
  verifyAcquisitionCheckpointContinuation,
} from "./import-acquisition-checkpoint.js";
import {
  AcquisitionTaskOutcome,
  AcquisitionGeneration,
  manifestObjectKey,
  mediaObjectKey,
} from "./import-media.model.js";
import { ImportTraceContext } from "./import-observability.js";
import {
  ImportId,
  ImportTimestamp,
  SourceCanonicalId,
} from "./import.contracts.js";
import { CompatibilityFingerprint } from "./import.repository.js";
import type { StoredImport } from "./import.repository.js";

const importId = Schema.decodeUnknownSync(ImportId)(
  "00000000-0000-4000-8000-000000000189"
);
const generation = Schema.decodeUnknownSync(AcquisitionGeneration)(1);
const acquiredAt = "2026-07-28T10:00:00.000Z";
const historicalCheckpoint = historicalAcquisitionCheckpointFixture(importId);
const trace = Schema.decodeUnknownSync(ImportTraceContext)({
  correlationId: "10000000-0000-4000-8000-000000000002",
});

const verifiedOutcome = () => {
  const decoded = decodeAcquisitionCheckpoint(historicalCheckpoint);
  if (
    decoded._tag !== "Accepted" ||
    decoded.outcome._tag !== "VerifiedAcquisition"
  ) {
    throw new Error("Expected the synthetic checkpoint to decode");
  }
  return decoded.outcome;
};

const storedImport = (overrides: Partial<StoredImport> = {}): StoredImport => ({
  acquisitionGeneration: generation,
  canonicalSourceId: Schema.decodeUnknownSync(SourceCanonicalId)(
    "synthetic-canonical-id"
  ),
  compatibilityFingerprint: Schema.decodeUnknownSync(CompatibilityFingerprint)(
    "b".repeat(64)
  ),
  sourceKind: "tiktok",
  trace,
  view: {
    createdAt: Schema.decodeUnknownSync(ImportTimestamp)(
      "2026-07-28T09:59:00.000Z"
    ),
    evidence: [
      {
        kind: "original_media",
        referenceId: mediaObjectKey(importId, generation),
      },
      {
        kind: "acquisition_manifest",
        referenceId: manifestObjectKey(importId, generation),
      },
    ],
    id: importId,
    source: {
      canonicalId: Schema.decodeUnknownSync(SourceCanonicalId)(
        "synthetic-canonical-id"
      ),
      kind: "tiktok",
    },
    status: {
      code: "transcription_failed",
      kind: "failed",
      recovery: "retry_later",
    },
    updatedAt: Schema.decodeUnknownSync(ImportTimestamp)(
      "2026-07-28T10:01:00.000Z"
    ),
  },
  ...overrides,
});

describe("historical acquisition checkpoint boundary", () => {
  it("reproduces the persisted cross-realm shape rejected by the current decoder", () => {
    expect(
      Schema.decodeUnknownResult(AcquisitionTaskOutcome)(historicalCheckpoint)
        ._tag
    ).toBe("Failure");
  });

  it("decodes only the exact persisted historical timestamp representation", () => {
    expect(decodeAcquisitionCheckpoint(historicalCheckpoint)).toMatchObject({
      _tag: "Accepted",
      outcome: {
        _tag: "VerifiedAcquisition",
        evidence: {
          acquiredAt: expect.any(Object),
          deleteAt: expect.any(Object),
          source: {
            observedAt: expect.any(Object),
            publishedAt: expect.any(Object),
          },
        },
        generation,
      },
    });
  });

  it("preserves the current encoded acquisition checkpoint contract", () => {
    const decoded = decodeAcquisitionCheckpoint(historicalCheckpoint);
    if (decoded._tag !== "Accepted") {
      throw new Error("Expected the synthetic checkpoint to decode");
    }
    const currentCheckpoint = Schema.encodeSync(AcquisitionTaskOutcome)(
      decoded.outcome
    );
    expect(
      Schema.decodeUnknownResult(AcquisitionTaskOutcome)(currentCheckpoint)._tag
    ).toBe("Success");
    expect(decodeAcquisitionCheckpoint(currentCheckpoint)).toMatchObject({
      _tag: "Accepted",
      outcome: { _tag: "VerifiedAcquisition", generation },
    });
  });

  it.each([
    {
      name: "ISO string from a different serializer",
      value: acquiredAt,
    },
    {
      name: "fractional epoch",
      value: { epochMilliseconds: 1_785_232_800_000.5 },
    },
    {
      name: "out-of-range epoch",
      value: { epochMilliseconds: 9_000_000_000_000_000 },
    },
  ])("fails closed for $name", ({ value }) => {
    expect(
      decodeAcquisitionCheckpoint({
        ...historicalCheckpoint,
        evidence: {
          ...historicalCheckpoint.evidence,
          acquiredAt: value,
        },
      })
    ).toEqual({
      _tag: "AcquisitionCheckpointRejected",
      code: "historical_acquisition_checkpoint_invalid",
    });
  });

  it.each([
    {
      name: "foreign import identity",
      stored: storedImport({
        view: {
          ...storedImport().view,
          id: Schema.decodeUnknownSync(ImportId)(
            "00000000-0000-4000-8000-000000000999"
          ),
        },
      }),
    },
    {
      name: "foreign generation",
      stored: storedImport({
        acquisitionGeneration: Schema.decodeUnknownSync(AcquisitionGeneration)(
          2
        ),
      }),
    },
    {
      name: "non-owned lifecycle",
      stored: storedImport({
        view: {
          ...storedImport().view,
          evidence: [],
          status: { kind: "queued" } as const,
        },
      }),
    },
    {
      name: "mismatched evidence references",
      stored: storedImport({
        view: {
          ...storedImport().view,
          evidence: [
            {
              kind: "original_media",
              referenceId: "synthetic-mismatch",
            },
            {
              kind: "acquisition_manifest",
              referenceId: manifestObjectKey(importId, generation),
            },
          ],
        } as unknown as StoredImport["view"],
      }),
    },
  ])("fails closed for $name", ({ stored }) => {
    const decoded = decodeAcquisitionCheckpoint(historicalCheckpoint);
    if (decoded._tag !== "Accepted") {
      throw new Error("Expected the synthetic checkpoint to decode");
    }
    expect(
      verifyAcquisitionCheckpointContinuation({
        importId,
        outcome: decoded.outcome,
        stored,
      })
    ).toEqual({
      _tag: "AcquisitionCheckpointRejected",
      code: "historical_acquisition_checkpoint_invalid",
    });
  });

  it("accepts exact import, generation, lifecycle ownership, and evidence refs", () => {
    const decoded = decodeAcquisitionCheckpoint(historicalCheckpoint);
    if (decoded._tag !== "Accepted") {
      throw new Error("Expected the synthetic checkpoint to decode");
    }
    expect(
      verifyAcquisitionCheckpointContinuation({
        importId,
        outcome: decoded.outcome,
        stored: storedImport(),
      })
    ).toEqual({ _tag: "Accepted" });
  });
});

describe("retained acquisition recovery boundary", () => {
  it("leaves an acquiring import on the ordinary acquisition path", async () => {
    let evidenceReads = 0;
    const acquiring = storedImport({
      view: {
        ...storedImport().view,
        evidence: [],
        status: { kind: "acquiring" },
      },
    });

    await expect(
      Effect.runPromise(
        recoverVerifiedAcquisitionCheckpoint({
          expectedCanonicalId: acquiring.canonicalSourceId,
          findStored: Effect.succeed(Option.some(acquiring)),
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
        recoverVerifiedAcquisitionCheckpoint({
          expectedCanonicalId: storedImport().canonicalSourceId,
          findStored: Effect.succeed(Option.some(storedImport())),
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
        recoverVerifiedAcquisitionCheckpoint({
          expectedCanonicalId: storedImport().canonicalSourceId,
          findStored: Effect.succeed(Option.some(storedImport())),
          importId,
          readEvidence: () => Effect.succeed(null),
        })
      )
    ).resolves.toEqual({
      _tag: "AcquisitionCheckpointRejected",
      code: "historical_acquisition_checkpoint_invalid",
    });
  });

  it("fails closed before reading evidence for incompatible identity", async () => {
    let evidenceReads = 0;
    const incompatible = storedImport({
      canonicalSourceId: Schema.decodeUnknownSync(SourceCanonicalId)(
        "different-canonical-id"
      ),
    });

    await expect(
      Effect.runPromise(
        recoverVerifiedAcquisitionCheckpoint({
          expectedCanonicalId: storedImport().canonicalSourceId,
          findStored: Effect.succeed(Option.some(incompatible)),
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
      code: "historical_acquisition_checkpoint_invalid",
    });
    expect(evidenceReads).toBe(0);
  });
});

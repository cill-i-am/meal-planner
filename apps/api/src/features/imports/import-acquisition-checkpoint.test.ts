import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  historicalAcquisitionCheckpointFixture,
  runtimeNativeAcquisitionCheckpointFixture,
} from "./import-acquisition-checkpoint.historical-fixture.js";
import {
  decodeAcquisitionCheckpoint,
  verifyAcquisitionCheckpointContinuation,
} from "./import-acquisition-checkpoint.js";
import {
  AcquisitionTaskOutcome,
  AcquisitionGeneration,
  manifestObjectKey,
  mediaObjectKey,
} from "./import-media.model.js";
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
const runtimeNativeCheckpoint =
  runtimeNativeAcquisitionCheckpointFixture(importId);

const storedImport = (overrides: Partial<StoredImport> = {}): StoredImport => ({
  acquisitionGeneration: generation,
  canonicalSourceId: Schema.decodeUnknownSync(SourceCanonicalId)(
    "synthetic-canonical-id"
  ),
  compatibilityFingerprint: Schema.decodeUnknownSync(CompatibilityFingerprint)(
    "b".repeat(64)
  ),
  sourceKind: "tiktok",
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
  it("reproduces the exact canonical strings emitted by the historical encoder", () => {
    expect(
      Schema.decodeUnknownResult(AcquisitionTaskOutcome)(historicalCheckpoint)
        ._tag
    ).toBe("Success");
    expect(historicalCheckpoint.evidence).toMatchObject({
      acquiredAt,
      deleteAt: "2026-08-04T10:00:00.000Z",
      source: {
        observedAt: acquiredAt,
        publishedAt: "2026-07-27T10:00:00.000Z",
      },
    });
  });

  it("decodes the exact canonical historical timestamp representation", () => {
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

  it("preserves the exact runtime-native timestamp representation", () => {
    expect(decodeAcquisitionCheckpoint(runtimeNativeCheckpoint)).toMatchObject({
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

  it.each([
    {
      name: "noncanonical offset",
      value: "2026-07-28T10:00:00+00:00",
    },
    {
      name: "missing milliseconds",
      value: "2026-07-28T10:00:00Z",
    },
    {
      name: "invalid calendar date",
      value: "2026-02-30T10:00:00.000Z",
    },
  ])("fails closed for canonical $name", ({ value }) => {
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
      name: "fractional epoch",
      value: { epochMilliseconds: 1_785_232_800_000.5 },
    },
    {
      name: "out-of-range epoch",
      value: { epochMilliseconds: 9_000_000_000_000_000 },
    },
    {
      name: "excess epoch key",
      value: {
        epochMilliseconds: 1_785_232_800_000,
        serializer: "foreign",
      },
    },
    {
      name: "foreign serializer shape",
      value: { seconds: 1_785_232_800 },
    },
    {
      name: "mixed timestamp representation",
      value: acquiredAt,
    },
  ])("fails closed for runtime-native $name", ({ value }) => {
    expect(
      decodeAcquisitionCheckpoint({
        ...runtimeNativeCheckpoint,
        evidence: {
          ...runtimeNativeCheckpoint.evidence,
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
      name: "top-level excess property",
      value: { ...historicalCheckpoint, serializer: "foreign" },
    },
    {
      name: "evidence excess property",
      value: {
        ...historicalCheckpoint,
        evidence: {
          ...historicalCheckpoint.evidence,
          serializer: "foreign",
        },
      },
    },
    {
      name: "source excess property",
      value: {
        ...historicalCheckpoint,
        evidence: {
          ...historicalCheckpoint.evidence,
          source: {
            ...historicalCheckpoint.evidence.source,
            serializer: "foreign",
          },
        },
      },
    },
  ])("fails closed for $name", ({ value }) => {
    expect(decodeAcquisitionCheckpoint(value)).toEqual({
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
      checkpoint: {
        ...historicalCheckpoint,
        generation: 2,
      },
      name: "mismatched outcome and evidence generation",
      stored: storedImport(),
    },
    {
      checkpoint: {
        ...historicalCheckpoint,
        evidence: {
          ...historicalCheckpoint.evidence,
          deleteAt: "2026-08-03T10:00:00.000Z",
        },
      },
      name: "invalid seven-day retention",
      stored: storedImport(),
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
  ])("fails closed for $name", ({ checkpoint, stored }) => {
    const decoded = decodeAcquisitionCheckpoint(
      checkpoint ?? historicalCheckpoint
    );
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

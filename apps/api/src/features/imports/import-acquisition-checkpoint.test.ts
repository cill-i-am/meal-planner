import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { historicalAcquisitionCheckpointFixture } from "./import-acquisition-checkpoint.historical-fixture.js";
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

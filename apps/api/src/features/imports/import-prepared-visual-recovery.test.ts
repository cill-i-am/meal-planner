import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { AcquisitionGeneration } from "./import-media.model.js";
import { resolvePreparedVisualRecovery } from "./import-prepared-visual-recovery.js";
import {
  ImportId,
  ImportTimestamp,
  SourceCanonicalId,
} from "./import.contracts.js";
import type { StoredImport } from "./import.repository.js";
import { CompatibilityFingerprint } from "./import.repository.js";

const importId = Schema.decodeUnknownSync(ImportId)(
  "00000000-0000-4000-8000-000000000208"
);
const generation = Schema.decodeUnknownSync(AcquisitionGeneration)(16);
const rootSpeechDispatchId = `speech:${importId}:${generation}`;
const secondVisualRecoveryDispatchId = `visual:${importId}:${generation}:recovery:2`;
const timestamp = Schema.decodeUnknownSync(ImportTimestamp)(
  "2026-07-29T09:00:00.000Z"
);
const canonicalSourceId =
  Schema.decodeUnknownSync(SourceCanonicalId)("opaque:208");

const storedImport = (
  status: "extracting_visual" | "transcribed"
): StoredImport => ({
  acquisitionGeneration: generation,
  canonicalSourceId,
  compatibilityFingerprint: Schema.decodeUnknownSync(CompatibilityFingerprint)(
    "a".repeat(64)
  ),
  sourceKind: "tiktok",
  view: {
    createdAt: timestamp,
    evidence: [
      {
        kind: "original_media",
        referenceId: "imports/opaque/original",
      },
      {
        kind: "acquisition_manifest",
        referenceId: "imports/opaque/manifest",
      },
      {
        kind: "speech_transcript",
        referenceId: "imports/opaque/transcript",
      },
    ],
    id: importId,
    source: { canonicalId: canonicalSourceId, kind: "tiktok" },
    status: { kind: status },
    updatedAt: timestamp,
  },
});

describe("prepared visual recovery", () => {
  it.each([rootSpeechDispatchId, `${rootSpeechDispatchId}:recovery:1`])(
    "admits the exact second visual recovery with settled speech owner %s",
    (speechDispatchId) => {
      expect(
        resolvePreparedVisualRecovery({
          importId,
          speechDispatchId,
          stored: storedImport("transcribed"),
          visualDispatchId: secondVisualRecoveryDispatchId,
        })
      ).toEqual({
        _tag: "PreparedVisualRecoveryReady",
        acquisitionGeneration: generation,
        speechDispatchId,
        visualDispatchId: secondVisualRecoveryDispatchId,
      });
    }
  );

  it.each([
    {
      name: "missing import",
      speechDispatchId: rootSpeechDispatchId,
      stored: null,
      visualDispatchId: secondVisualRecoveryDispatchId,
    },
    {
      name: "non-transcribed state",
      speechDispatchId: rootSpeechDispatchId,
      stored: storedImport("extracting_visual"),
      visualDispatchId: secondVisualRecoveryDispatchId,
    },
    {
      name: "unowned speech",
      speechDispatchId: `${rootSpeechDispatchId}:recovery:2`,
      stored: storedImport("transcribed"),
      visualDispatchId: secondVisualRecoveryDispatchId,
    },
    {
      name: "first visual recovery",
      speechDispatchId: rootSpeechDispatchId,
      stored: storedImport("transcribed"),
      visualDispatchId: `visual:${importId}:${generation}:recovery:1`,
    },
    {
      name: "third visual recovery",
      speechDispatchId: rootSpeechDispatchId,
      stored: storedImport("transcribed"),
      visualDispatchId: `visual:${importId}:${generation}:recovery:3`,
    },
  ])("rejects $name before provider dispatch", (candidate) => {
    expect(
      resolvePreparedVisualRecovery({
        importId,
        speechDispatchId: candidate.speechDispatchId,
        stored: candidate.stored,
        visualDispatchId: candidate.visualDispatchId,
      })
    ).toEqual({
      _tag: "PreparedVisualRecoveryRejected",
      code: "state_mismatch",
    });
  });
});

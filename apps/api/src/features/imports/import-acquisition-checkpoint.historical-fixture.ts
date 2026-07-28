import { Schema } from "effect";

import {
  AcquisitionGeneration,
  manifestObjectKey,
  mediaObjectKey,
} from "./import-media.model.js";
import type { ImportId } from "./import.contracts.js";

const generation = Schema.decodeUnknownSync(AcquisitionGeneration)(1);

type PersistedTimestamp = string | { readonly epochMilliseconds: number };

const acquisitionCheckpointFixture = (
  importId: ImportId,
  timestamp: (value: string) => PersistedTimestamp
) => ({
  _tag: "VerifiedAcquisition" as const,
  evidence: {
    acquiredAt: timestamp("2026-07-28T10:00:00.000Z"),
    audioStreams: [{ codec: "aac", index: 1 }],
    bytes: 1024,
    deleteAt: timestamp("2026-08-04T10:00:00.000Z"),
    durationSeconds: 30,
    generation: 1,
    manifestKey: manifestObjectKey(importId, generation),
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
      observedAt: timestamp("2026-07-28T10:00:00.000Z"),
      provenance: {
        canonicalUrl: "provider_observed" as const,
        caption: null,
        creator: {
          displayName: null,
          handle: null,
          id: null,
        },
        publishedAt: "provider_observed" as const,
      },
      publishedAt: timestamp("2026-07-27T10:00:00.000Z"),
    },
    videoStreams: [{ codec: "h264", index: 0 }],
  },
  generation: 1,
});

/**
 * Models the exact millisecond UTC strings emitted by the shipped schema
 * encoder and persisted in historical Workflow task results.
 */
export const historicalAcquisitionCheckpointFixture = (importId: ImportId) =>
  acquisitionCheckpointFixture(importId, (value) => value);

/**
 * Models the runtime-native structured-clone representation observed for
 * Effect DateTime values crossing the Workflow boundary without encoding.
 */
export const runtimeNativeAcquisitionCheckpointFixture = (importId: ImportId) =>
  acquisitionCheckpointFixture(importId, (value) => ({
    epochMilliseconds: Date.parse(value),
  }));

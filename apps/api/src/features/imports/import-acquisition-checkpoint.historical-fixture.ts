import { DateTime, Schema } from "effect";

import {
  AcquisitionGeneration,
  manifestObjectKey,
  mediaObjectKey,
} from "./import-media.model.js";
import type { ImportId } from "./import.contracts.js";

const generation = Schema.decodeUnknownSync(AcquisitionGeneration)(1);

/**
 * Models the exact value left when an Effect DateTime crosses the native
 * Workflow structured-clone boundary: only its enumerable epoch field
 * survives; its symbol identity, prototype metadata, and JSON toJSON method do
 * not.
 */
const persistedHistoricalTimestamp = (value: string) =>
  structuredClone(DateTime.makeUnsafe(value));

export const historicalAcquisitionCheckpointFixture = (importId: ImportId) => ({
  _tag: "VerifiedAcquisition" as const,
  evidence: {
    acquiredAt: persistedHistoricalTimestamp("2026-07-28T10:00:00.000Z"),
    audioStreams: [{ codec: "aac", index: 1 }],
    bytes: 1024,
    deleteAt: persistedHistoricalTimestamp("2026-08-04T10:00:00.000Z"),
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
      observedAt: persistedHistoricalTimestamp("2026-07-28T10:00:00.000Z"),
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
      publishedAt: persistedHistoricalTimestamp("2026-07-27T10:00:00.000Z"),
    },
    videoStreams: [{ codec: "h264", index: 0 }],
  },
  generation: 1,
});

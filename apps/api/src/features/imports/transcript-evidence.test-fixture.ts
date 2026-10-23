import { Effect, Option, Schema, Stream } from "effect";
import { TestClock } from "effect/testing";

import { checksumBytes, sha256Bytes } from "./import-digest.js";
import type { HouseholdImportEvidenceCurrentRepository } from "./import-evidence.repository.household.js";
import { acquireStoreVerify } from "./import-media-acquirer.js";
import type {
  AcquisitionBucketLike,
  AcquisitionPutValue,
  R2ObjectBodyLike,
} from "./import-media-acquirer.js";
import { AcquisitionGeneration, Sha256Hex } from "./import-media.model.js";
import {
  SpeechTranscript,
  SpeechUnavailableEvidence,
} from "./import-speech-transcriber.js";
import {
  ImportId,
  ImportTimestamp,
  SourceCanonicalId,
} from "./import.contracts.js";
import { TranscriptEvidenceDocument } from "./transcript-evidence-store.js";

export const importId = Schema.decodeUnknownSync(ImportId)(
  "11111111-1111-4111-8111-111111111111"
);
export const generation = Schema.decodeUnknownSync(AcquisitionGeneration)(1);
export const canonicalId = Schema.decodeUnknownSync(SourceCanonicalId)(
  "7392489304682556679"
);
export const nowText = "2026-10-23T12:00:00.000Z";
export const now = Schema.decodeUnknownSync(ImportTimestamp)(nowText);
export const deleteAt = Schema.decodeUnknownSync(ImportTimestamp)(
  "2026-10-30T12:00:00.000Z"
);
export const dispatchId = `speech:${importId}:${generation}`;
export const transcriptKey = `imports/${importId}/transcription/v1/generations/${generation}/transcript.json`;
export const sourceMediaSha256 = Schema.decodeUnknownSync(Sha256Hex)(
  "a".repeat(64)
);
export const cost = {
  certainty: "known",
  currency: "USD",
  estimatedMicroUsd: 9,
} as const;
export const usage = { audioDurationMilliseconds: 1000, inputBytes: 4 };
export const statuses = [
  { reason: "no_speech_detected", status: "absent" },
  { reason: "malformed_response", status: "failed" },
] as const;

export const unavailableSpeech = (status: (typeof statuses)[number]) =>
  Schema.decodeUnknownSync(SpeechUnavailableEvidence)({
    ...status,
    cost,
    detectedLanguage: null,
    model: "fixture-speech",
    provider: "fixture",
    segments: [],
    text: null,
    usage,
  });
export const availableSpeech = Schema.decodeUnknownSync(SpeechTranscript)({
  cost,
  detectedLanguage: "en",
  model: "fixture-speech",
  provider: "fixture",
  segments: [
    { endMilliseconds: 1000, startMilliseconds: 0, text: "Chop the onion." },
  ],
  text: "Chop the onion.",
  usage,
});
export const receipt = (status: (typeof statuses)[number]) =>
  Schema.decodeUnknownSync(TranscriptEvidenceDocument)({
    ...unavailableSpeech(status),
    acquisitionGeneration: generation,
    createdAt: nowText,
    deleteAt: "2026-10-30T12:00:00.000Z",
    dispatchId,
    importId,
    schemaVersion: 2,
    sourceMediaSha256,
  });
export const readInput = {
  dispatchId,
  generation,
  importId,
  sourceMediaSha256,
};

const collectBytes = (value: AcquisitionPutValue) =>
  ArrayBuffer.isView(value)
    ? Effect.succeed(
        new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice()
      )
    : Stream.runCollect(value).pipe(
        Effect.map((chunks) => {
          const bytes = new Uint8Array(
            chunks.reduce((length, chunk) => length + chunk.byteLength, 0)
          );
          let offset = 0;
          for (const chunk of chunks) {
            bytes.set(chunk, offset);
            offset += chunk.byteLength;
          }
          return bytes;
        })
      );

export const memoryBucket = () => {
  const objects = new Map<string, R2ObjectBodyLike>();
  const bucket: AcquisitionBucketLike = {
    get: (key) => Effect.sync(() => objects.get(key) ?? null),
    head: (key) => Effect.sync(() => objects.get(key) ?? null),
    put: (key, value, options) =>
      Effect.gen(function* putFixtureObject() {
        if (objects.has(key)) {
          return null;
        }
        const bytes = yield* collectBytes(value);
        const digest = yield* sha256Bytes(bytes);
        const object: R2ObjectBodyLike = {
          arrayBuffer: () => Effect.succeed(Uint8Array.from(bytes).buffer),
          checksums: { sha256: checksumBytes(digest) },
          customMetadata: options.customMetadata,
          httpMetadata: options.httpMetadata,
          size: bytes.byteLength,
          text: () => Effect.succeed(new TextDecoder().decode(bytes)),
        };
        objects.set(key, object);
        return object;
      }),
  };
  const update = (
    key: string,
    change: (object: R2ObjectBodyLike) => R2ObjectBodyLike
  ) => {
    const object = objects.get(key);
    if (object === undefined) {
      throw new Error(`Missing fixture object: ${key}`);
    }
    objects.set(key, change(object));
  };
  return { bucket, objects, update };
};

export const acquiredFixture = (audio: "available" | "absent" = "available") =>
  Effect.gen(function* acquireFixtureMedia() {
    yield* TestClock.setTime(Date.parse(nowText));
    const storage = memoryBucket();
    const bytes = new TextEncoder().encode("acquired-media");
    const digest = yield* sha256Bytes(bytes);
    const result = yield* acquireStoreVerify(
      storage.bucket,
      {
        cleanup: () => Effect.void,
        prepare: () =>
          Effect.succeed({
            artifactId: "speech-receipt-fixture",
            audioStreams:
              audio === "available" ? [{ codec: "aac", index: 0 }] : [],
            bytes: bytes.byteLength,
            durationSeconds: 1,
            metadata: {
              canonicalId,
              canonicalUrl: `https://www.tiktok.com/@fixture/video/${canonicalId}`,
              caption: "Onion soup. 1 onion. Chop the onion.",
              creator: { displayName: null, handle: null, id: null },
              observedAt: nowText,
              provenance: {
                canonicalUrl: "provider_observed",
                caption: "creator_provided",
                creator: { displayName: null, handle: null, id: null },
                publishedAt: null,
              },
              publishedAt: null,
            },
            sha256: digest,
            videoStreams: [{ codec: "h264", index: 0 }],
          }),
        readArtifact: () => Stream.succeed(bytes),
      },
      { canonicalId, generation, importId }
    );
    if (result._tag !== "VerifiedAcquisition") {
      return yield* Effect.die("Acquisition fixture failed");
    }
    const current = (
      status: string
    ): HouseholdImportEvidenceCurrentRepository => ({
      readCurrent: () =>
        Effect.succeed(
          Option.some({
            acquisitionGeneration: generation,
            canonicalSourceId: canonicalId,
            importId,
            sourceKind: "tiktok",
            status: { kind: status },
          })
        ),
    });
    return { ...storage, current, evidence: result.evidence };
  });

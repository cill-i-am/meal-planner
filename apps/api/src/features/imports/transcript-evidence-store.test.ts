import { describe, expect, it } from "@effect/vitest";
import { Effect, Option, Schema } from "effect";

import { RetryableAcquisitionError } from "./import-media.errors.js";
import {
  TranscriptEvidenceDocument,
  transcriptEvidenceStatus,
  transcriptEvidenceText,
  TranscriptEvidenceStore,
  TranscriptEvidenceStoreLive,
} from "./transcript-evidence-store.js";
import {
  availableSpeech,
  deleteAt,
  dispatchId,
  generation,
  importId,
  memoryBucket,
  now,
  readInput,
  receipt,
  sourceMediaSha256,
  statuses,
  transcriptKey,
} from "./transcript-evidence.test-fixture.js";

const writeRead = (document: TranscriptEvidenceDocument) =>
  Effect.gen(function* writeAndReadEvidence() {
    const store = yield* TranscriptEvidenceStore;
    const written = yield* store.putVerified({ document });
    const read = yield* store.readVerified(readInput);
    expect(Option.isSome(read)).toBe(true);
    expect(Option.getOrThrow(read)).toEqual(written);
    expect(written.document).toEqual(document);
    return written;
  });

describe("verified speech evidence persistence", () => {
  for (const status of statuses) {
    it.effect(
      `roundtrips a ${status.status} receipt without fabricated text`,
      () => {
        const storage = memoryBucket();
        return Effect.gen(function* roundtripUnavailableReceipt() {
          const written = yield* writeRead(receipt(status));
          expect(transcriptEvidenceStatus(written.document)).toEqual(status);
          expect(transcriptEvidenceText(written.document)).toBeNull();
          expect(written.document.segments).toEqual([]);
          const object = storage.objects.get(written.key);
          expect(object?.customMetadata).toMatchObject({
            kind: "speech_transcript",
            sha256: written.sha256,
            sourceMediaSha256,
          });
          expect(object?.httpMetadata).toEqual({
            cacheControl: "private, no-store",
            contentType: "application/json",
          });
          expect(written.byteLength).toBe(object?.size);
        }).pipe(Effect.provide(TranscriptEvidenceStoreLive(storage.bucket)));
      }
    );
  }

  it.effect("retains valid version-one transcripts on read and write", () => {
    const storage = memoryBucket();
    const document: TranscriptEvidenceDocument = {
      ...availableSpeech,
      acquisitionGeneration: generation,
      createdAt: now,
      deleteAt,
      dispatchId,
      importId,
      schemaVersion: 1,
      sourceMediaSha256,
    };
    return Effect.gen(function* roundtripAvailableTranscript() {
      const written = yield* writeRead(document);
      expect(transcriptEvidenceStatus(written.document)).toEqual({
        status: "available",
      });
      expect(transcriptEvidenceText(written.document)).toBe("Chop the onion.");
    }).pipe(Effect.provide(TranscriptEvidenceStoreLive(storage.bucket)));
  });

  it.effect(
    "keeps a missing artifact distinct from a verified absent receipt",
    () => {
      const storage = memoryBucket();
      return Effect.gen(function* readMissingEvidence() {
        const store = yield* TranscriptEvidenceStore;
        expect(yield* store.readVerified(readInput)).toEqual(Option.none());
      }).pipe(Effect.provide(TranscriptEvidenceStoreLive(storage.bucket)));
    }
  );

  it.effect(
    "rejects invalid receipt status and content combinations from storage",
    () =>
      Effect.gen(function* rejectMalformedReceipts() {
        for (const change of [
          { reason: "malformed_response" },
          { text: "invented transcript" },
          { status: "available" },
          { schemaVersion: 1 },
          { providerPrivateBody: "must-not-escape" },
        ]) {
          const storage = memoryBucket();
          yield* Effect.gen(function* readMalformedReceipt() {
            const store = yield* TranscriptEvidenceStore;
            const document = receipt(statuses[0]);
            yield* store.putVerified({ document });
            const encoded = Schema.encodeSync(TranscriptEvidenceDocument)(
              document
            );
            storage.update(transcriptKey, (object) => ({
              ...object,
              text: () =>
                Effect.succeed(JSON.stringify({ ...encoded, ...change })),
            }));
            const error = yield* Effect.flip(store.readVerified(readInput));
            expect(error).toMatchObject({
              code: "malformed",
              reasonCode: "transcript_schema_invalid",
            });
            expect(JSON.stringify(error)).not.toContain("must-not-escape");
          }).pipe(Effect.provide(TranscriptEvidenceStoreLive(storage.bucket)));
        }
      })
  );

  it.effect(
    "rejects checksum, metadata, and dispatch identity mismatches",
    () => {
      const storage = memoryBucket();
      return Effect.gen(function* rejectReceiptMismatches() {
        const store = yield* TranscriptEvidenceStore;
        yield* store.putVerified({ document: receipt(statuses[0]) });
        const original = storage.objects.get(transcriptKey);
        expect(original).toBeDefined();
        expect(
          yield* Effect.flip(
            store.readVerified({
              ...readInput,
              dispatchId: "different-dispatch",
            })
          )
        ).toMatchObject({ code: "identity_mismatch" });
        storage.update(transcriptKey, (object) => ({
          ...object,
          checksums: { sha256: new Uint8Array(32).buffer },
        }));
        expect(yield* Effect.flip(store.readVerified(readInput))).toMatchObject(
          { code: "checksum_mismatch" }
        );
        if (original === undefined) {
          return yield* Effect.die("Missing stored receipt");
        }
        storage.objects.set(transcriptKey, {
          ...original,
          customMetadata: { ...original.customMetadata, kind: "untrusted" },
        });
        expect(yield* Effect.flip(store.readVerified(readInput))).toMatchObject(
          { code: "metadata_mismatch" }
        );
      }).pipe(Effect.provide(TranscriptEvidenceStoreLive(storage.bucket)));
    }
  );

  it.effect(
    "does not replace an existing receipt or turn storage failures into absence",
    () => {
      const storage = memoryBucket();
      return Effect.gen(function* preserveStoredReceipt() {
        const store = yield* TranscriptEvidenceStore;
        yield* store.putVerified({ document: receipt(statuses[0]) });
        expect(
          yield* Effect.flip(
            store.putVerified({ document: receipt(statuses[1]) })
          )
        ).toMatchObject({
          code: "storage_failure",
          reasonCode: "transcript_conditional_create_rejected",
        });
        expect(
          Option.getOrThrow(yield* store.readVerified(readInput)).document
        ).toEqual(receipt(statuses[0]));
        const failingBucket = {
          ...storage.bucket,
          get: () =>
            Effect.fail(
              new RetryableAcquisitionError({
                reason: "container_rpc",
                stage: "verify",
              })
            ),
        };
        const error = yield* Effect.flip(
          TranscriptEvidenceStore.pipe(
            Effect.flatMap((failingStore) =>
              failingStore.readVerified(readInput)
            ),
            Effect.provide(TranscriptEvidenceStoreLive(failingBucket))
          )
        );
        expect(error).toMatchObject({
          code: "storage_failure",
          reasonCode: "transcript_get_failed",
        });
      }).pipe(Effect.provide(TranscriptEvidenceStoreLive(storage.bucket)));
    }
  );
});

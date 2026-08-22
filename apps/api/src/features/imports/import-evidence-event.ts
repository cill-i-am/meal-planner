import { Effect, Schema } from "effect";

const R2EvidenceEventAction = Schema.Literals([
  "CompleteMultipartUpload",
  "CopyObject",
  "DeleteObject",
  "LifecycleDeletion",
  "PutObject",
]);

/** Closed Cloudflare R2 event-notification body. */
export const R2EvidenceEvent = Schema.Struct({
  account: Schema.String,
  action: R2EvidenceEventAction,
  bucket: Schema.String,
  eventTime: Schema.String,
  object: Schema.Struct({
    eTag: Schema.optionalKey(Schema.String),
    key: Schema.String,
    size: Schema.optionalKey(Schema.Number),
  }),
}).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));
export type R2EvidenceEvent = typeof R2EvidenceEvent.Type;

const SafeImportEvidenceEvent = Schema.Struct({
  action: R2EvidenceEventAction,
  artifact: Schema.Literals([
    "acquisition_manifest",
    "carousel_image",
    "carousel_manifest",
    "original_media",
    "provider_audio",
    "provider_frame",
    "provider_manifest",
    "speech_transcript",
  ]),
  executionGeneration: Schema.Int.pipe(
    Schema.check(Schema.isGreaterThanOrEqualTo(1))
  ),
  trackedReference: Schema.Boolean,
});
export type SafeImportEvidenceEvent = typeof SafeImportEvidenceEvent.Type;

const importUuid =
  "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const patterns = [
  {
    artifact: "original_media",
    pattern: new RegExp(
      `^imports/${importUuid}/acquisition/v1/generations/([1-9][0-9]*)/original\\.mp4$`,
      "iu"
    ),
    trackedReference: true,
  },
  {
    artifact: "acquisition_manifest",
    pattern: new RegExp(
      `^imports/${importUuid}/acquisition/v1/generations/([1-9][0-9]*)/manifest\\.json$`,
      "iu"
    ),
    trackedReference: true,
  },
  {
    artifact: "speech_transcript",
    pattern: new RegExp(
      `^imports/${importUuid}/transcription/v1/generations/([1-9][0-9]*)/transcript\\.json$`,
      "iu"
    ),
    trackedReference: true,
  },
  {
    artifact: "carousel_manifest",
    pattern: new RegExp(
      `^imports/${importUuid}/carousel/v1/generations/([1-9][0-9]*)/manifest\\.json$`,
      "iu"
    ),
    trackedReference: true,
  },
  {
    artifact: "carousel_image",
    pattern: new RegExp(
      `^imports/${importUuid}/carousel/v1/generations/([1-9][0-9]*)/images/[0-9]{2}\\.jpg$`,
      "iu"
    ),
    trackedReference: false,
  },
  {
    artifact: "provider_manifest",
    pattern: new RegExp(
      `^imports/${importUuid}/generations/([1-9][0-9]*)/provider-evidence\\.json$`,
      "iu"
    ),
    trackedReference: false,
  },
  {
    artifact: "provider_audio",
    pattern: new RegExp(
      `^imports/${importUuid}/generations/([1-9][0-9]*)/provider-audio\\.wav$`,
      "iu"
    ),
    trackedReference: false,
  },
  {
    artifact: "provider_frame",
    pattern: new RegExp(
      `^imports/${importUuid}/generations/([1-9][0-9]*)/provider-frame-[0-9]+\\.jpg$`,
      "iu"
    ),
    trackedReference: false,
  },
] as const;

/**
 * Discards the raw key and all account/bucket identifiers. Queue delivery is
 * evidence only: it never has enough authority to resolve a household.
 */
// eslint-disable-next-line anti-slop/no-unknown-parameters -- this is the closed Queue I/O boundary and immediately Schema-decodes the untrusted body
export const decodeSafeImportEvidenceEvent = (untrusted: unknown) =>
  Schema.decodeUnknownEffect(R2EvidenceEvent, {
    onExcessProperty: "error",
  })(untrusted).pipe(
    Effect.flatMap((event) => {
      for (const candidate of patterns) {
        const match = candidate.pattern.exec(event.object.key);
        if (match?.[1] !== undefined) {
          return Schema.decodeUnknownEffect(SafeImportEvidenceEvent)({
            action: event.action,
            artifact: candidate.artifact,
            executionGeneration: Number(match[1]),
            trackedReference: candidate.trackedReference,
          });
        }
      }
      return Effect.fail(new Error("Unrecognized import evidence object key"));
    })
  );

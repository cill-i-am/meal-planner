import { Schema } from "effect";

const TrimmedNonEmptyString = Schema.String.pipe(
  Schema.check(Schema.isTrimmed(), Schema.isNonEmpty())
);

export const IdempotencyKey = TrimmedNonEmptyString.pipe(
  Schema.check(Schema.isMaxLength(128)),
  Schema.brand("IdempotencyKey")
);
export type IdempotencyKey = typeof IdempotencyKey.Type;

export const ImportId = Schema.String.pipe(
  Schema.check(Schema.isUUID()),
  Schema.brand("ImportId")
);
export type ImportId = typeof ImportId.Type;

export const ImportTimestamp = Schema.DateTimeUtcFromString.pipe(
  Schema.brand("ImportTimestamp")
);
export type ImportTimestamp = typeof ImportTimestamp.Type;

export const SourceCanonicalId = TrimmedNonEmptyString.pipe(
  Schema.brand("SourceCanonicalId")
);
export type SourceCanonicalId = typeof SourceCanonicalId.Type;

/** Maximum encoded source locator accepted at the HTTP boundary. */
export const MaximumSourceUrlLength = 2048;

const hasFiniteSourceUrlLength = Schema.makeFilter<string>(
  (input) => input.length <= MaximumSourceUrlLength,
  {
    expected: `a source URL no longer than ${MaximumSourceUrlLength} characters`,
  },
  true
);

const isAbsoluteHttpsUrl = Schema.makeFilter<string>(
  (input) => {
    try {
      return new URL(input).protocol === "https:";
    } catch {
      return false;
    }
  },
  { expected: "an absolute HTTPS URL" }
);

export const SourceUrl = TrimmedNonEmptyString.pipe(
  Schema.check(hasFiniteSourceUrlLength),
  Schema.check(isAbsoluteHttpsUrl),
  Schema.brand("SourceUrl")
);
export type SourceUrl = typeof SourceUrl.Type;

export const TikTokSourceDescriptor = Schema.Struct({
  kind: Schema.Literal("tiktok"),
  url: SourceUrl,
});
export type TikTokSourceDescriptor = typeof TikTokSourceDescriptor.Type;

/** Extensible public source union. TikTok is the only admitted provider in v1. */
export const SourceDescriptor = Schema.Union([TikTokSourceDescriptor]);
export type SourceDescriptor = typeof SourceDescriptor.Type;

export const CreateImportRequest = Schema.Struct({
  source: SourceDescriptor,
});
export type CreateImportRequest = typeof CreateImportRequest.Type;

export const ImportSourceView = Schema.Struct({
  canonicalId: Schema.optionalKey(SourceCanonicalId),
  kind: Schema.Literal("tiktok"),
});
export type ImportSourceView = typeof ImportSourceView.Type;

export const QueuedImportStatus = Schema.Struct({
  kind: Schema.Literal("queued"),
});

export const AcquiringImportStatus = Schema.Struct({
  kind: Schema.Literal("acquiring"),
});

export const AcquiredImportStatus = Schema.Struct({
  kind: Schema.Literal("acquired"),
});

export const TranscribingImportStatus = Schema.Struct({
  kind: Schema.Literal("transcribing"),
});

export const TranscribedImportStatus = Schema.Struct({
  kind: Schema.Literal("transcribed"),
});

export const ExtractingVisualImportStatus = Schema.Struct({
  kind: Schema.Literal("extracting_visual"),
});

export const VisualEvidenceFoundImportStatus = Schema.Struct({
  kind: Schema.Literal("visual_evidence_found"),
});

export const VisualEvidenceEmptyImportStatus = Schema.Struct({
  kind: Schema.Literal("visual_evidence_empty"),
});

export const VisualEvidenceLowConfidenceImportStatus = Schema.Struct({
  kind: Schema.Literal("visual_evidence_low_confidence"),
});

export const PrivateOrUnavailableImportStatus = Schema.Struct({
  code: Schema.Literal("private_or_unavailable"),
  kind: Schema.Literal("failed"),
  recovery: Schema.Literal("check_source_visibility"),
});

export const AcquisitionTemporarilyUnavailableImportStatus = Schema.Struct({
  code: Schema.Literal("acquisition_temporarily_unavailable"),
  kind: Schema.Literal("failed"),
  recovery: Schema.Literal("retry_later"),
});

export const InvalidOrUnsupportedMediaImportStatus = Schema.Struct({
  code: Schema.Literal("invalid_or_unsupported_media"),
  kind: Schema.Literal("failed"),
  recovery: Schema.Literal("submit_supported_public_video"),
});

export const TranscriptionFailedImportStatus = Schema.Struct({
  code: Schema.Literal("transcription_failed"),
  kind: Schema.Literal("failed"),
  recovery: Schema.Literal("retry_later"),
});

export const VisualEvidenceFailedImportStatus = Schema.Struct({
  code: Schema.Literal("visual_evidence_failed"),
  kind: Schema.Literal("failed"),
  recovery: Schema.Literal("operator_reconcile"),
});

export const UnsupportedImportStatus = Schema.Struct({
  code: Schema.Literal("unsupported_post_type"),
  kind: Schema.Literal("unsupported"),
  recovery: Schema.Literal("submit_supported_public_video"),
});

export const ImportStatus = Schema.Union([
  AcquiredImportStatus,
  AcquiringImportStatus,
  QueuedImportStatus,
  PrivateOrUnavailableImportStatus,
  AcquisitionTemporarilyUnavailableImportStatus,
  InvalidOrUnsupportedMediaImportStatus,
  ExtractingVisualImportStatus,
  TranscribedImportStatus,
  TranscribingImportStatus,
  TranscriptionFailedImportStatus,
  VisualEvidenceEmptyImportStatus,
  VisualEvidenceFailedImportStatus,
  VisualEvidenceFoundImportStatus,
  VisualEvidenceLowConfidenceImportStatus,
  UnsupportedImportStatus,
]);
export type ImportStatus = typeof ImportStatus.Type;

export const OriginalMediaEvidenceReference = Schema.Struct({
  kind: Schema.Literal("original_media"),
  referenceId: TrimmedNonEmptyString,
});
export const AcquisitionManifestEvidenceReference = Schema.Struct({
  kind: Schema.Literal("acquisition_manifest"),
  referenceId: TrimmedNonEmptyString,
});
export const SpeechTranscriptEvidenceReference = Schema.Struct({
  kind: Schema.Literal("speech_transcript"),
  referenceId: TrimmedNonEmptyString,
});
export const VisualEvidenceManifestReference = Schema.Struct({
  kind: Schema.Literal("visual_evidence_manifest"),
  referenceId: TrimmedNonEmptyString,
});
export const EvidenceReference = Schema.Union([
  OriginalMediaEvidenceReference,
  AcquisitionManifestEvidenceReference,
  SpeechTranscriptEvidenceReference,
  VisualEvidenceManifestReference,
]);
export type EvidenceReference = typeof EvidenceReference.Type;

const ImportViewFields = {
  createdAt: ImportTimestamp,
  id: ImportId,
  source: ImportSourceView,
  updatedAt: ImportTimestamp,
} as const;

const EmptyEvidence = Schema.Array(EvidenceReference).pipe(
  Schema.check(
    Schema.makeFilter<readonly EvidenceReference[]>(
      (evidence) => evidence.length === 0,
      { expected: "no evidence before acquisition" },
      true
    )
  )
);

const NonAcquiredImportView = Schema.Struct({
  ...ImportViewFields,
  evidence: EmptyEvidence,
  status: Schema.Union([
    AcquiringImportStatus,
    QueuedImportStatus,
    PrivateOrUnavailableImportStatus,
    AcquisitionTemporarilyUnavailableImportStatus,
    InvalidOrUnsupportedMediaImportStatus,
    UnsupportedImportStatus,
  ]),
});

const AcquiredImportView = Schema.Struct({
  ...ImportViewFields,
  evidence: Schema.Tuple([
    OriginalMediaEvidenceReference,
    AcquisitionManifestEvidenceReference,
  ]),
  status: Schema.Union([
    AcquiredImportStatus,
    TranscribingImportStatus,
    TranscriptionFailedImportStatus,
  ]),
});

const TranscribedImportView = Schema.Struct({
  ...ImportViewFields,
  evidence: Schema.Tuple([
    OriginalMediaEvidenceReference,
    AcquisitionManifestEvidenceReference,
    SpeechTranscriptEvidenceReference,
  ]),
  status: Schema.Union([
    ExtractingVisualImportStatus,
    TranscribedImportStatus,
    VisualEvidenceFailedImportStatus,
  ]),
});

const VisualEvidenceImportView = Schema.Struct({
  ...ImportViewFields,
  evidence: Schema.Tuple([
    OriginalMediaEvidenceReference,
    AcquisitionManifestEvidenceReference,
    SpeechTranscriptEvidenceReference,
    VisualEvidenceManifestReference,
  ]),
  status: Schema.Union([
    VisualEvidenceEmptyImportStatus,
    VisualEvidenceFoundImportStatus,
    VisualEvidenceLowConfidenceImportStatus,
  ]),
});

export const ImportView = Schema.Union([
  NonAcquiredImportView,
  AcquiredImportView,
  TranscribedImportView,
  VisualEvidenceImportView,
]);
export type ImportView = typeof ImportView.Type;

export const ImportDisposition = Schema.Literals([
  "created",
  "idempotency_replay",
  "canonical_duplicate",
]);
export type ImportDisposition = typeof ImportDisposition.Type;

export const CreateImportResponse = Schema.Struct({
  disposition: ImportDisposition,
  import: ImportView,
});
export type CreateImportResponse = typeof CreateImportResponse.Type;

export const GetImportResponse = Schema.Struct({
  import: ImportView,
});
export type GetImportResponse = typeof GetImportResponse.Type;

export const ImportProblem = Schema.Struct({
  error: Schema.Struct({
    code: TrimmedNonEmptyString,
    message: TrimmedNonEmptyString,
    recovery: Schema.optionalKey(TrimmedNonEmptyString),
  }),
});
export type ImportProblem = typeof ImportProblem.Type;

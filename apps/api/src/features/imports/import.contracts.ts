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

export const SourceUrl = TrimmedNonEmptyString.pipe(Schema.brand("SourceUrl"));
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

export const FailedImportStatus = Schema.Struct({
  code: Schema.Literal("private_or_unavailable"),
  kind: Schema.Literal("failed"),
  recovery: Schema.Literal("check_source_visibility"),
});

export const UnsupportedImportStatus = Schema.Struct({
  code: Schema.Literal("unsupported_post_type"),
  kind: Schema.Literal("unsupported"),
  recovery: Schema.Literal("submit_supported_public_video"),
});

export const ImportStatus = Schema.Union([
  QueuedImportStatus,
  FailedImportStatus,
  UnsupportedImportStatus,
]);
export type ImportStatus = typeof ImportStatus.Type;

export const EvidenceReference = Schema.Struct({
  kind: Schema.Literal("source_metadata"),
  referenceId: TrimmedNonEmptyString,
});
export type EvidenceReference = typeof EvidenceReference.Type;

export const ImportView = Schema.Struct({
  createdAt: ImportTimestamp,
  evidence: Schema.Array(EvidenceReference),
  id: ImportId,
  source: ImportSourceView,
  status: ImportStatus,
  updatedAt: ImportTimestamp,
});
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

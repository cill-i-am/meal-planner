import { Schema } from "effect";

import { AcquisitionCheckpointRejected } from "./import-acquisition-checkpoint.js";

export const ProviderTaskDiagnosticReasonCode = Schema.Literals([
  "acquisition_evidence_invalid",
  "acquisition_evidence_missing",
  "evidence_assembly_invalid",
  "import_missing",
  "parent_state_invalid",
  "recovery_assembly_fingerprint_mismatch",
  "recovery_generation_mismatch",
  "recovery_source_hash_mismatch",
  "recovery_transcript_hash_mismatch",
  "recovery_visual_hash_mismatch",
  "source_metadata_missing",
  "transcript_evidence_invalid",
  "transcript_evidence_missing",
  "transcript_native_checksum_missing",
  "transcript_native_checksum_mismatch",
  "visual_evidence_invalid",
  "visual_evidence_missing",
  "visual_frame_native_checksum_mismatch",
  "visual_manifest_native_checksum_missing",
  "visual_manifest_native_checksum_mismatch",
]);
export type ProviderTaskDiagnosticReasonCode =
  typeof ProviderTaskDiagnosticReasonCode.Type;

export const ProviderTaskCheckpoint = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal("Failed"),
    code: Schema.String,
    reasonCode: Schema.optionalKey(ProviderTaskDiagnosticReasonCode),
    stage: Schema.Literals(["recipe", "speech", "visual"]),
  }),
  Schema.Struct({
    _tag: Schema.Literal("Succeeded"),
    stage: Schema.Literals(["recipe", "speech", "visual"]),
  }),
]);

export const SpeechProviderTaskCheckpoint = Schema.Union([
  AcquisitionCheckpointRejected,
  ProviderTaskCheckpoint,
]);

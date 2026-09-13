import { Data, Schema } from "effect";

export const PRIVATE_DISCOVERY_KIMI_STREAM_LIMITS = {
  dataEvents: 131_072,
  decodeSliceBytes: 16_384,
  eventBytes: 262_144,
  lineBytes: 65_536,
  logicalTextBytes: 2_097_152,
  wireBytes: 67_108_864,
} as const;

const Count = Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)));
export const PrivateDiscoveryKimiStreamMetrics = Schema.Struct({
  dataEvents: Count,
  logicalTextBytes: Count,
  peakEventBytes: Count,
  peakLineBytes: Count,
  pendingEventBytes: Count,
  pendingLineBytes: Count,
  retainedTextBytes: Count,
  wireBytes: Count,
});
export type KimiStreamMetrics = {
  -readonly [
    K in keyof typeof PrivateDiscoveryKimiStreamMetrics.Type
  ]: (typeof PrivateDiscoveryKimiStreamMetrics.Type)[K];
};

export const PrivateDiscoveryKimiStreamDiagnostic = Schema.Struct({
  check: Schema.Literals([
    "stream_closed",
    "wire_limit",
    "line_limit",
    "event_limit",
    "event_count_limit",
    "logical_text_limit",
    "invalid_utf8",
    "event_name",
    "event_json",
    "chunk_schema",
    "usage_conflict",
    "choice_after_finish",
    "data_after_done",
    "completion_identity",
    "usage_event_before_finish",
    "duplicate_usage_event",
    "missing_usage",
    "incomplete_frame",
    "missing_done",
    "missing_role",
    "missing_finish",
    "missing_tool_identity",
    "decoder_failure",
  ]),
  limit: Schema.NullOr(Count),
  metrics: PrivateDiscoveryKimiStreamMetrics,
  observed: Schema.NullOr(Count),
  stage: Schema.Literals([
    "response_body_limit",
    "response_body_read",
    "response_json",
    "response_envelope",
    "incomplete_completion",
    "tool_call",
  ]),
});
export class PrivateDiscoveryKimiStreamFailure extends Data.TaggedError(
  "PrivateDiscoveryKimiStreamFailure"
)<{ readonly diagnostic: typeof PrivateDiscoveryKimiStreamDiagnostic.Type }> {}

export type RejectKimiStream = (
  check: typeof PrivateDiscoveryKimiStreamDiagnostic.Type.check,
  stage?: typeof PrivateDiscoveryKimiStreamDiagnostic.Type.stage,
  observed?: number,
  limit?: number
) => never;

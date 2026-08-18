import { Effect, Schema } from "effect";

import type {
  VisualEvidenceExtractionInput,
  VisualEvidenceExtractor,
  VisualFrameArtifact,
  VisualFrameSampler,
  VisualFrameSamplingInput,
} from "./import-visual-evidence-extractor.js";
import { VisualEvidence } from "./import-visual-evidence-extractor.js";

/** Deterministic bounded frame-sampling fake with recorded seam calls. */
export const makeDeterministicFrameSampler = (
  frames: readonly VisualFrameArtifact[]
): {
  readonly calls: VisualFrameSamplingInput[];
  readonly service: VisualFrameSampler;
} => {
  const calls: VisualFrameSamplingInput[] = [];
  return {
    calls,
    service: {
      sample: (input) =>
        Effect.sync(() => {
          calls.push(input);
          return frames.map((frame) => ({
            ...frame,
            bytes: Uint8Array.from(frame.bytes),
          }));
        }),
    },
  };
};

/** Deterministic provider-free visual extractor with recorded dispatches. */
export const makeDeterministicVisualEvidenceExtractor = (
  output: typeof VisualEvidence.Encoded
): {
  readonly calls: VisualEvidenceExtractionInput[];
  readonly service: VisualEvidenceExtractor;
} => {
  const evidence = Schema.decodeUnknownSync(VisualEvidence, {
    onExcessProperty: "error",
  })(output);
  const calls: VisualEvidenceExtractionInput[] = [];
  return {
    calls,
    service: {
      extract: (input) =>
        Effect.sync(() => {
          calls.push(input);
          return evidence;
        }),
    },
  };
};

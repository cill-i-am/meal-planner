import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { Schema } from "effect";

import { RecipeDraftContent } from "../../packages/recipe-domain/src/content.js";

const Text = Schema.String.pipe(Schema.check(Schema.isNonEmpty()));
const Count = Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)));
const Measurement = Schema.NullOr(Count);
const Evidence = Schema.Struct({
  artifactReference: Text,
  evidenceId: Text,
  kind: Schema.Literals([
    "caption",
    "creator",
    "source_url",
    "transcript",
    "visual_observation",
  ]),
  origin: Schema.Literals(["creator_provided", "observed"]),
  value: Text,
});
const Witness = Schema.Struct({ evidenceId: Text, path: Text, quote: Text });
export const ExtractionCase = Schema.Struct({
  aliases: Schema.Array(
    Schema.Struct({ path: Text, values: Schema.Array(Text) })
  ),
  allEvidence: Schema.Array(Evidence),
  availableEvidenceIds: Schema.Array(Text),
  expected: RecipeDraftContent,
  id: Text,
  notes: Text,
  provenance: Schema.Struct({
    capturedAt: Schema.NullOr(Text),
    description: Text,
    kind: Schema.Literals([
      "synthetic",
      "raw_capture",
      "scripted_capture",
      "live_capture",
    ]),
    sourceReference: Schema.NullOr(Text),
  }),
  qualifiers: Schema.Array(
    Schema.Struct({
      kind: Schema.Literals(["negation", "condition", "optionality"]),
      path: Text,
      phrases: Schema.Array(Text),
    })
  ),
  scenarios: Schema.Array(Text),
  split: Schema.Literals(["dev", "holdout"]),
  witnesses: Schema.Array(Witness),
});
export type ExtractionCase = typeof ExtractionCase.Type;
export const ExtractionCorpus = Schema.Struct({
  cases: Schema.Array(ExtractionCase),
  expectationReview: Schema.Struct({
    reviewer: Text,
    scope: Text,
    status: Schema.Literals(["pending", "independently_checked"]),
  }),
  version: Text,
});
export type ExtractionCorpus = typeof ExtractionCorpus.Type;

/** Null means unmeasured. A reservation is not provider spend. */
export const ExtractionMeasurements = Schema.Struct({
  costReservationMicroUsd: Measurement,
  fallbackInvocations: Measurement,
  inputTokens: Measurement,
  internalPasses: Measurement,
  latencyMilliseconds: Measurement,
  latencySource: Schema.Literals([
    "client_wall",
    "tool_wall",
    "provider_reported",
    "unavailable",
  ]),
  outputTokens: Measurement,
  providerInvocations: Measurement,
  providerLatencyMilliseconds: Measurement,
  providerSpendMicroUsd: Schema.Struct({
    certainty: Schema.Literals(["known", "estimated", "unavailable"]),
    value: Measurement,
  }),
});
export type ExtractionMeasurements = typeof ExtractionMeasurements.Type;
export const PersistedExtractionOutput = Schema.Struct({
  caseId: Text,
  evidenceSha256: Text,
  failureCode: Schema.NullOr(Text),
  measurements: ExtractionMeasurements,
  rawCandidate: Schema.NullOr(Schema.Json),
  rawProviderResponse: Schema.NullOr(Schema.Json),
  requestIdentity: Schema.optionalKey(
    Schema.Literals(["request_sha256", "dispatch_id_only"])
  ),
  status: Schema.Literals(["completed", "failed", "skipped"]),
  transportReceipt: Schema.optionalKey(Schema.Json),
});
export type PersistedExtractionOutput = typeof PersistedExtractionOutput.Type;
export const GrounderRebinding = Schema.Struct({
  originalGrounderRevision: Text,
  originalGrounderSha256: Text,
  originalPlanSha256: Text,
  reason: Text,
});
export const PersistedExtractionRun = Schema.Struct({
  acceptanceSha256: Text,
  corpusSha256: Text,
  corpusVersion: Text,
  descriptor: Schema.Struct({ model: Text, provider: Text, version: Text }),
  execution: Schema.Literals([
    "scripted_fixture",
    "local_library",
    "live_provider",
  ]),
  grounderRebinding: Schema.optionalKey(GrounderRebinding),
  grounderRevision: Text,
  grounderSha256: Text,
  outputs: Schema.Array(PersistedExtractionOutput),
  runId: Text,
  schemaVersion: Schema.Literal(1),
  strategy: Text,
});
export type PersistedExtractionRun = typeof PersistedExtractionRun.Type;

export const unavailableMeasurements: ExtractionMeasurements = {
  costReservationMicroUsd: null,
  fallbackInvocations: null,
  inputTokens: null,
  internalPasses: null,
  latencyMilliseconds: null,
  latencySource: "unavailable",
  outputTokens: null,
  providerInvocations: null,
  providerLatencyMilliseconds: null,
  providerSpendMicroUsd: { certainty: "unavailable", value: null },
};

export const evidenceForCase = (item: ExtractionCase) =>
  item.allEvidence.filter((evidence) =>
    item.availableEvidenceIds.includes(evidence.evidenceId)
  );
/** Order and every evidence byte are part of the frozen adapter input. */
export const evidenceSha256 = (item: ExtractionCase) =>
  createHash("sha256")
    .update(JSON.stringify(evidenceForCase(item)))
    .digest("hex");

export const corpusSha256 = (corpus: ExtractionCorpus) =>
  createHash("sha256").update(JSON.stringify(corpus)).digest("hex");
export const acceptanceSha256 = () =>
  createHash("sha256")
    .update(readFileSync(new URL("acceptance.v1.json", import.meta.url)))
    .digest("hex");
export const grounderSha256 = () =>
  createHash("sha256")
    .update(
      readFileSync(
        new URL(
          "../../apps/api/src/features/imports/import-recipe-grounding.ts",
          import.meta.url
        )
      )
    )
    .digest("hex");
export const scorerSha256 = () =>
  createHash("sha256")
    .update(readFileSync(new URL("score.ts", import.meta.url)))
    .digest("hex");

export const readCorpus = (path = new URL("corpus.v1.json", import.meta.url)) =>
  Schema.decodeUnknownSync(ExtractionCorpus, { onExcessProperty: "error" })(
    JSON.parse(readFileSync(path, "utf-8"))
  );
export const readRun = (path: string) =>
  Schema.decodeUnknownSync(PersistedExtractionRun, {
    onExcessProperty: "error",
  })(JSON.parse(readFileSync(path, "utf-8")));

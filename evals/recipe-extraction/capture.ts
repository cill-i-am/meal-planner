import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import { Schema } from "effect";

import { assembleClairicEvidenceText } from "../../apps/api/src/features/imports/import-clairic-evidence.js";
import { AcquisitionGeneration } from "../../apps/api/src/features/imports/import-media.model.js";
import {
  decodeClairicRecipeResponse,
  ExperimentalClairicRecipeModel,
  experimentalClairicRecipeVersion,
  makeClairicRecipeRequest,
} from "../../apps/api/src/features/imports/import-provider-clairic.js";
import {
  InstalledRecipeModel,
  InstalledRecipeTokenPrices,
  decodeInstalledRecipeResponse,
  makeInstalledRecipeRequest,
} from "../../apps/api/src/features/imports/import-provider-recipe.js";
import { ImportId } from "../../apps/api/src/features/imports/import.contracts.js";
import {
  EvaluationBridgeResponse,
  EvaluationInvocation,
} from "./accounted-transport.js";
import { withHistoricalGrounding } from "./historical-grounding.js";
import {
  acceptanceSha256,
  corpusSha256,
  evidenceForCase,
  evidenceSha256,
  GrounderRebinding,
  grounderSha256,
  PersistedExtractionRun,
  readCorpus,
  unavailableMeasurements,
} from "./model.js";
import type { ExtractionCase, PersistedExtractionOutput } from "./model.js";

const Text = Schema.String.pipe(Schema.check(Schema.isNonEmpty()));
const Strategy = Schema.Literals(["llama", "clairic"]);
const CapturePlan = Schema.Struct({
  acceptanceSha256: Text,
  corpusSha256: Text,
  corpusVersion: Text,
  grounderRebinding: Schema.optionalKey(GrounderRebinding),
  grounderRevision: Text,
  grounderSha256: Text,
  requests: Schema.Array(
    Schema.Struct({
      caseId: Text,
      evidenceSha256: Text,
      invocation: Schema.NullOr(EvaluationInvocation),
    })
  ),
  runId: Text,
  split: Schema.Literals(["dev", "holdout"]),
  strategy: Strategy,
});
const sha256 = (text: string) =>
  createHash("sha256").update(text).digest("hex");
const writeJson = (file: string, value: Schema.Json) =>
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, {
    flag: "wx",
    mode: 0o600,
  });

const invocationFor = (
  item: ExtractionCase,
  strategy: typeof Strategy.Type,
  runId: string
) => {
  const items = evidenceForCase(item);
  if (items.length === 0) {
    return null;
  }
  const digest = sha256(`recipe-extraction:${item.id}`);
  const assembly = {
    evidenceFingerprint: evidenceSha256(item),
    generation: Schema.decodeUnknownSync(AcquisitionGeneration)(1),
    importId: Schema.decodeUnknownSync(ImportId)(
      `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`
    ),
    items,
  };
  return Schema.decodeUnknownSync(EvaluationInvocation)({
    body:
      strategy === "llama"
        ? makeInstalledRecipeRequest(assembly)
        : makeClairicRecipeRequest(assembleClairicEvidenceText(items)),
    dispatchId: `${runId}:${strategy}:${item.id}`,
    inputMicroUsdPerToken:
      strategy === "llama"
        ? InstalledRecipeTokenPrices.inputMicroUsdPerToken
        : 0.1,
    maximumCostMicroUsd: 100_000,
    model:
      strategy === "llama"
        ? InstalledRecipeModel
        : ExperimentalClairicRecipeModel,
    outputMicroUsdPerToken:
      strategy === "llama"
        ? InstalledRecipeTokenPrices.outputMicroUsdPerToken
        : 0,
  });
};

const Count = Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)));
const AccountedValue = Schema.Struct({
  ...EvaluationBridgeResponse.fields,
  cost: Schema.Union([
    Schema.Struct({ _tag: Schema.Literal("Known"), actualCostMicroUsd: Count }),
    Schema.Struct({ _tag: Schema.Literal("Unknown") }),
    Schema.Struct({
      _tag: Schema.Literal("Conservative"),
      conservativeChargeMicroUsd: Count,
    }),
  ]),
  reservationMicroUsd: Count,
  usage: Schema.Struct({
    inputTokens: Schema.optionalKey(Count),
    outputTokens: Schema.optionalKey(Count),
  }),
});
const AccountedResult = Schema.Struct({
  result: Schema.optionalKey(
    Schema.Struct({ _tag: Text, value: Schema.optionalKey(AccountedValue) })
  ),
  status: Schema.Literals(["settled", "stopped_unknown", "stopped"]),
});
const InterruptedResult = Schema.Struct({
  reconciliation: Schema.Struct({
    externalCallAttempted: Schema.Literal(true),
    method: Schema.Literal("ProviderAccountingRepository.settleUnknown"),
  }),
  result: Schema.Struct({
    _tag: Schema.Literal("InterruptedUnknown"),
    cost: Schema.Struct({ _tag: Schema.Literal("Unknown") }),
    dispatchId: Text,
    latencyMs: Schema.NullOr(Count),
    providerAcceptance: Schema.Literal("unknown"),
    providerInvocations: Schema.Literal(1),
    requestSha256: Text,
    reservationMicroUsd: Count,
    usage: Schema.Null,
  }),
  status: Schema.Literal("stopped_unknown"),
});
const RestEnvelope = Schema.Struct({
  result: Schema.Json,
  success: Schema.Literal(true),
});
const InternalUsage = Schema.Struct({
  usage: Schema.Struct({ passes: Schema.optionalKey(Count) }),
});

const candidateFromResponse = (
  strategy: typeof Strategy.Type,
  item: ExtractionCase,
  raw: Schema.Json
) => {
  const decoded =
    strategy === "llama"
      ? decodeInstalledRecipeResponse(raw)
      : decodeClairicRecipeResponse(
          raw,
          assembleClairicEvidenceText(evidenceForCase(item)),
          "unicode-code-points"
        );
  return decoded._tag === "Decoded"
    ? Schema.encodeSync(Schema.Json)(decoded.value)
    : null;
};

const interruptedOutput = (
  receipt: Schema.Json,
  invocation: typeof EvaluationInvocation.Type,
  base: Omit<PersistedExtractionOutput, "status">,
  latencySource: "client_wall" | "tool_wall"
): PersistedExtractionOutput | null => {
  const interrupted = Schema.decodeUnknownOption(InterruptedResult)(receipt);
  if (interrupted._tag === "None") {
    return null;
  }
  const unknown = interrupted.value.result;
  if (
    unknown.dispatchId !== invocation.dispatchId ||
    unknown.requestSha256 !== sha256(JSON.stringify(invocation))
  ) {
    throw new Error("Interrupted receipt request identity differs");
  }
  return {
    ...base,
    failureCode: "provider_outcome_unknown",
    measurements: {
      ...unavailableMeasurements,
      costReservationMicroUsd: unknown.reservationMicroUsd,
      fallbackInvocations: 0,
      latencyMilliseconds: unknown.latencyMs,
      latencySource: unknown.latencyMs === null ? "unavailable" : latencySource,
      providerInvocations: unknown.providerInvocations,
    },
    status: "failed",
    transportReceipt: receipt,
  };
};

const collectOutput = (
  item: ExtractionCase,
  request: (typeof CapturePlan.Type.requests)[number],
  plan: typeof CapturePlan.Type,
  directory: string,
  latencySource: "client_wall" | "tool_wall"
): PersistedExtractionOutput | null => {
  const base = {
    caseId: item.id,
    evidenceSha256: request.evidenceSha256,
    failureCode: null,
    measurements: unavailableMeasurements,
    rawCandidate: null,
    rawProviderResponse: null,
  };
  if (request.invocation === null) {
    return {
      ...base,
      measurements: {
        ...unavailableMeasurements,
        fallbackInvocations: 0,
        providerInvocations: 0,
      },
      status: "skipped",
    };
  }
  const resultFile = path.join(
    directory,
    `${sha256(request.invocation.dispatchId)}.result.json`
  );
  let saved: string;
  try {
    saved = readFileSync(resultFile, "utf-8");
  } catch (error) {
    const missing = Schema.decodeUnknownOption(
      Schema.Struct({ code: Schema.Literal("ENOENT") })
    )(error);
    if (missing._tag === "Some") {
      return null;
    }
    throw error;
  }
  const receipt = Schema.decodeUnknownSync(Schema.Json)(JSON.parse(saved));
  const interrupted = interruptedOutput(
    receipt,
    request.invocation,
    base,
    latencySource
  );
  if (interrupted !== null) {
    return interrupted;
  }
  const result = Schema.decodeUnknownSync(AccountedResult)(receipt);
  const response = result.result?.value;
  if (response === undefined) {
    return {
      ...base,
      failureCode: "accounted_outcome_unavailable",
      status: "failed",
    };
  }
  if (
    response.dispatchId !== request.invocation.dispatchId ||
    response.requestSha256 !== sha256(JSON.stringify(request.invocation))
  ) {
    throw new Error(`Response identity differs: ${item.id}`);
  }
  const envelope = Schema.decodeUnknownOption(RestEnvelope)(response.body);
  const raw = envelope._tag === "Some" ? envelope.value.result : response.body;
  const usage = Schema.decodeUnknownOption(InternalUsage)(raw);
  const measurements = {
    ...unavailableMeasurements,
    costReservationMicroUsd: response.reservationMicroUsd,
    fallbackInvocations: 0,
    inputTokens: response.usage.inputTokens ?? null,
    internalPasses:
      usage._tag === "Some" ? (usage.value.usage.passes ?? null) : null,
    latencyMilliseconds: response.latencyMs,
    latencySource,
    outputTokens: response.usage.outputTokens ?? null,
    providerInvocations: 1,
    providerSpendMicroUsd:
      response.cost._tag === "Known"
        ? {
            certainty: "estimated" as const,
            value: response.cost.actualCostMicroUsd,
          }
        : unavailableMeasurements.providerSpendMicroUsd,
  };
  if (response.status < 200 || response.status >= 300) {
    return {
      ...base,
      failureCode: `http_${response.status}`,
      measurements,
      rawProviderResponse: response.body,
      status: "failed",
    };
  }
  const rawCandidate = candidateFromResponse(plan.strategy, item, raw);
  return {
    ...base,
    failureCode: rawCandidate === null ? "malformed_response" : null,
    measurements,
    rawCandidate,
    rawProviderResponse: response.body,
    status: rawCandidate === null ? "failed" : "completed",
  };
};

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    cases: { type: "string" },
    directory: { type: "string" },
    "grounder-revision": { type: "string" },
    "historical-grounder": { type: "string" },
    "latency-source": { default: "tool_wall", type: "string" },
    out: { type: "string" },
    plan: { type: "string" },
    reason: { type: "string" },
    results: { type: "string" },
    "run-id": { type: "string" },
    split: { default: "dev", type: "string" },
    strategy: { type: "string" },
  },
});
const [command] = positionals;
const corpus = readCorpus();
if (command === "prepare") {
  const strategy = Schema.decodeUnknownSync(Strategy)(values.strategy);
  const split = Schema.decodeUnknownSync(Schema.Literals(["dev", "holdout"]))(
    values.split
  );
  if (
    values.cases === undefined ||
    values["run-id"] === undefined ||
    values.directory === undefined ||
    values["grounder-revision"] === undefined
  ) {
    throw new Error(
      "prepare requires --strategy --cases comma-separated-ids --run-id --grounder-revision --directory"
    );
  }
  const ids = values.cases.split(",");
  const selected = ids.map((id) => {
    const item = corpus.cases.find(
      (entry) => entry.id === id && entry.split === split
    );
    if (item === undefined) {
      throw new Error(`Unknown case in selected split: ${id}`);
    }
    return item;
  });
  if (new Set(ids).size !== ids.length) {
    throw new Error("Duplicate case IDs");
  }
  const runId = values["run-id"];
  const plan = Schema.decodeUnknownSync(CapturePlan)({
    acceptanceSha256: acceptanceSha256(),
    corpusSha256: corpusSha256(corpus),
    corpusVersion: corpus.version,
    grounderRevision: values["grounder-revision"],
    grounderSha256: grounderSha256(),
    requests: selected.map((item) => ({
      caseId: item.id,
      evidenceSha256: evidenceSha256(item),
      invocation: invocationFor(item, strategy, runId),
    })),
    runId,
    split,
    strategy,
  });
  mkdirSync(values.directory, { mode: 0o700, recursive: true });
  writeJson(path.join(values.directory, `${strategy}.plan.json`), plan);
  for (const request of plan.requests) {
    if (request.invocation !== null) {
      writeJson(
        path.join(
          values.directory,
          `${strategy}-${request.caseId}.request.json`
        ),
        request.invocation
      );
    }
  }
  process.stdout.write(
    `${JSON.stringify({ paidCalls: 0, plan: path.join(values.directory, `${strategy}.plan.json`), preparedRequests: plan.requests.filter((request) => request.invocation !== null).length })}\n`
  );
} else if (command === "rebind-grounder") {
  if (
    values.plan === undefined ||
    values.out === undefined ||
    values.reason === undefined ||
    values["grounder-revision"] === undefined
  ) {
    throw new Error(
      "rebind-grounder requires --plan --out --grounder-revision --reason"
    );
  }
  const originalText = readFileSync(values.plan, "utf-8");
  const plan = Schema.decodeUnknownSync(CapturePlan, {
    onExcessProperty: "error",
  })(JSON.parse(originalText));
  if (
    plan.corpusVersion !== corpus.version ||
    plan.corpusSha256 !== corpusSha256(corpus) ||
    plan.acceptanceSha256 !== acceptanceSha256()
  ) {
    throw new Error("Capture corpus or acceptance fingerprint differs");
  }
  if (plan.grounderRebinding !== undefined) {
    throw new Error("Rebind the original plan to retain original provenance");
  }
  writeJson(
    values.out,
    Schema.decodeUnknownSync(CapturePlan)({
      ...plan,
      grounderRebinding: {
        originalGrounderRevision: plan.grounderRevision,
        originalGrounderSha256: plan.grounderSha256,
        originalPlanSha256: sha256(originalText),
        reason: values.reason,
      },
      grounderRevision: values["grounder-revision"],
      grounderSha256: grounderSha256(),
    })
  );
  process.stdout.write(
    `${JSON.stringify({ paidCalls: 0, plan: values.out, requestsUnchanged: true })}\n`
  );
} else if (command === "collect") {
  if (
    values.plan === undefined ||
    values.results === undefined ||
    values.out === undefined
  ) {
    throw new Error(
      "collect requires --plan --results accounted-directory --out"
    );
  }
  const plan = Schema.decodeUnknownSync(CapturePlan, {
    onExcessProperty: "error",
  })(JSON.parse(readFileSync(values.plan, "utf-8")));
  const selectedGrounderSha256 =
    values["historical-grounder"] === undefined
      ? grounderSha256()
      : await withHistoricalGrounding(
          values["historical-grounder"],
          (grounding) => grounding.sha256
        );
  if (
    plan.corpusVersion !== corpus.version ||
    plan.corpusSha256 !== corpusSha256(corpus) ||
    plan.acceptanceSha256 !== acceptanceSha256() ||
    plan.grounderSha256 !== selectedGrounderSha256
  ) {
    throw new Error("Capture plan fingerprint differs");
  }
  const latencySource = Schema.decodeUnknownSync(
    Schema.Literals(["client_wall", "tool_wall"])
  )(values["latency-source"]);
  const outputs = plan.requests.flatMap((request) => {
    const item = corpus.cases.find((entry) => entry.id === request.caseId);
    if (item === undefined || evidenceSha256(item) !== request.evidenceSha256) {
      throw new Error("Capture evidence differs");
    }
    const output = collectOutput(
      item,
      request,
      plan,
      values.results ?? "",
      latencySource
    );
    return output === null ? [] : [output];
  });
  const run = Schema.decodeUnknownSync(PersistedExtractionRun)({
    acceptanceSha256: plan.acceptanceSha256,
    corpusSha256: plan.corpusSha256,
    corpusVersion: plan.corpusVersion,
    descriptor: {
      model:
        plan.strategy === "llama"
          ? InstalledRecipeModel
          : ExperimentalClairicRecipeModel,
      provider: "cloudflare-workers-ai",
      version:
        plan.strategy === "llama"
          ? "installed-workers-ai-json-schema-v1"
          : experimentalClairicRecipeVersion("unicode-code-points"),
    },
    execution: "live_provider",
    grounderRevision: plan.grounderRevision,
    grounderSha256: plan.grounderSha256,
    outputs,
    runId: plan.runId,
    schemaVersion: 1,
    strategy: plan.strategy,
  });
  writeJson(
    values.out,
    plan.grounderRebinding === undefined
      ? run
      : { ...run, grounderRebinding: plan.grounderRebinding }
  );
  process.stdout.write(
    `${JSON.stringify({ collected: outputs.length, expected: plan.requests.length, paidCalls: 0 })}\n`
  );
} else {
  throw new Error(
    "Use prepare, rebind-grounder or collect. This command never invokes a provider."
  );
}

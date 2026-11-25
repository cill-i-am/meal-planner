import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Schema } from "effect";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import { EvaluationInvocation } from "./accounted-transport.js";
import { readRun } from "./model.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
const capture = fileURLToPath(new URL("capture.ts", import.meta.url));
const fixture = fileURLToPath(
  new URL("comparison.v1/llama.run.json", import.meta.url)
);
const sourcePlan = fileURLToPath(
  new URL("comparison.v1/llama.plan.json", import.meta.url)
);
const cli = (args: readonly string[]) =>
  execFileSync(process.execPath, ["--import", "tsx", capture, ...args], {
    cwd: root,
    encoding: "utf-8",
    stdio: "pipe",
  });

it("retains the checked-in stopped comparison evidence fingerprints", () => {
  const directory = new URL("comparison.v1/", import.meta.url);
  const manifest = Schema.decodeUnknownSync(
    Schema.Struct({
      files: Schema.Array(
        Schema.Struct({ path: Schema.String, sha256: Schema.String })
      ),
    })
  )(JSON.parse(readFileSync(new URL("manifest.json", directory), "utf-8")));
  for (const file of manifest.files) {
    expect(
      createHash("sha256")
        .update(readFileSync(new URL(file.path, directory)))
        .digest("hex")
    ).toBe(file.sha256);
  }
});

describe("capture CLI unknown receipts", () => {
  const receipt = readRun(fixture).outputs[0]?.transportReceipt;
  if (receipt === undefined) {
    throw new Error("Missing recorded reconciliation receipt");
  }
  const identity = Schema.decodeUnknownSync(
    Schema.Struct({
      result: Schema.Struct({
        dispatchId: Schema.String,
        requestSha256: Schema.String,
      }),
    })
  )(receipt).result;
  const nativeReceipt = {
    ledger: Schema.decodeUnknownSync(Schema.Struct({ ledger: Schema.Json }))(
      receipt
    ).ledger,
    reason: "Inspect persisted ledger; no automatic retry is authorized",
    status: "stopped_unknown",
  };
  const invocation = Schema.decodeUnknownSync(
    Schema.Struct({
      requests: Schema.Array(
        Schema.Struct({ invocation: Schema.NullOr(EvaluationInvocation) })
      ),
    })
  )(JSON.parse(readFileSync(sourcePlan, "utf-8"))).requests.find(
    (request) => request.invocation?.dispatchId === identity.dispatchId
  )?.invocation;
  if (invocation === undefined || invocation === null) {
    throw new Error("Missing original invocation");
  }
  let planDirectory: string;
  let plan: string;
  let directory: string;
  let receiptFile: string;
  let publishedRequest: string;
  const dispatchFile = createHash("sha256")
    .update(identity.dispatchId)
    .digest("hex");
  beforeAll(() => {
    planDirectory = mkdtempSync(path.join(os.tmpdir(), "recipe-capture-plan-"));
    plan = path.join(planDirectory, "scripted-replay.plan.json");
    cli([
      "rebind-grounder",
      "--plan",
      sourcePlan,
      "--out",
      plan,
      "--grounder-revision",
      "scripted-receipt-replay",
      "--reason",
      "Regression replay of persisted transport evidence; no provider invocation",
    ]);
  });
  afterAll(() => {
    rmSync(planDirectory, { force: true, recursive: true });
  });
  beforeEach(() => {
    directory = mkdtempSync(path.join(os.tmpdir(), "recipe-capture-replay-"));
    const bridge = path.join(directory, "bridge");
    mkdirSync(bridge);
    receiptFile = path.join(directory, `${dispatchFile}.result.json`);
    publishedRequest = path.join(bridge, `${dispatchFile}.request.json`);
  });
  afterEach(() => {
    rmSync(directory, { force: true, recursive: true });
  });
  it("preserves reconciled receipts without inventing provider response, latency or spend", () => {
    const output = path.join(directory, "scripted-replay.run.json");
    writeFileSync(receiptFile, JSON.stringify(receipt));
    cli(["collect", "--plan", plan, "--results", directory, "--out", output]);
    const run = readRun(output);
    expect(run.outputs).toHaveLength(1);
    expect(run.outputs[0]).toMatchObject({
      failureCode: "provider_outcome_unknown",
      measurements: {
        costReservationMicroUsd: 100_000,
        inputTokens: null,
        internalPasses: null,
        latencyMilliseconds: null,
        outputTokens: null,
        providerInvocations: 1,
        providerSpendMicroUsd: { certainty: "unavailable", value: null },
      },
      rawCandidate: null,
      rawProviderResponse: null,
      requestIdentity: "request_sha256",
      status: "failed",
    });
  });
  it("reports a native unknown without a published request", () => {
    writeFileSync(receiptFile, JSON.stringify(nativeReceipt));
    const nativeOutput = path.join(directory, "native-unknown.run.json");
    cli([
      "collect",
      "--plan",
      plan,
      "--results",
      directory,
      "--out",
      nativeOutput,
    ]);
    expect(readRun(nativeOutput).outputs[0]).toMatchObject({
      failureCode: "provider_outcome_unknown",
      measurements: {
        costReservationMicroUsd: 100_000,
        inputTokens: null,
        internalPasses: null,
        latencyMilliseconds: null,
        providerInvocations: null,
        providerSpendMicroUsd: { certainty: "unavailable", value: null },
      },
      rawCandidate: null,
      rawProviderResponse: null,
      requestIdentity: "dispatch_id_only",
      status: "failed",
      transportReceipt: nativeReceipt,
    });
  });
  it("links a native unknown to the exact published request", () => {
    writeFileSync(receiptFile, JSON.stringify(nativeReceipt));
    writeFileSync(
      publishedRequest,
      JSON.stringify({ ...invocation, requestSha256: identity.requestSha256 })
    );
    const publishedOutput = path.join(directory, "published-unknown.run.json");
    cli([
      "collect",
      "--plan",
      plan,
      "--results",
      directory,
      "--out",
      publishedOutput,
    ]);
    expect(readRun(publishedOutput).outputs[0]).toMatchObject({
      measurements: {
        costReservationMicroUsd: 100_000,
        providerInvocations: null,
      },
      requestIdentity: "request_sha256",
      transportReceipt: nativeReceipt,
    });
  });
  it("rejects a published request with the wrong body", () => {
    writeFileSync(receiptFile, JSON.stringify(nativeReceipt));
    writeFileSync(
      publishedRequest,
      JSON.stringify({
        ...invocation,
        body: { changed: "Same dispatch and reservation, different request" },
        requestSha256: identity.requestSha256,
      })
    );
    expect(() =>
      cli([
        "collect",
        "--plan",
        plan,
        "--results",
        directory,
        "--out",
        path.join(directory, "wrong-published.run.json"),
      ])
    ).toThrow("Unknown native receipt published request identity differs");
  });
  it("rejects a native unknown without the matching dispatch", () => {
    writeFileSync(
      receiptFile,
      JSON.stringify(nativeReceipt).replaceAll(
        identity.dispatchId,
        "wrong-dispatch"
      )
    );
    expect(() =>
      cli([
        "collect",
        "--plan",
        plan,
        "--results",
        directory,
        "--out",
        path.join(directory, "wrong-native.run.json"),
      ])
    ).toThrow("Unknown native receipt lacks the matching reserved dispatch");
  });
  it("rejects an interrupted receipt with a different request identity", () => {
    writeFileSync(
      receiptFile,
      JSON.stringify(receipt).replaceAll(
        identity.requestSha256,
        "wrong-request"
      )
    );
    expect(() =>
      cli([
        "collect",
        "--plan",
        plan,
        "--results",
        directory,
        "--out",
        path.join(directory, "rejected.run.json"),
      ])
    ).toThrow("Interrupted receipt request identity differs");
  });
});

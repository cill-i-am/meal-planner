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
import { expect, it } from "vitest";

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

it("preserves reconciled and normal CLI unknown receipts without inventing provider response, latency, spend or external calls", () => {
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
  const directory = mkdtempSync(
    path.join(os.tmpdir(), "recipe-capture-replay-")
  );
  const plan = path.join(directory, "scripted-replay.plan.json");
  const output = path.join(directory, "scripted-replay.run.json");
  const receiptFile = path.join(
    directory,
    `${createHash("sha256").update(identity.dispatchId).digest("hex")}.result.json`
  );
  try {
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
    const nativeReceipt = {
      ledger: Schema.decodeUnknownSync(Schema.Struct({ ledger: Schema.Json }))(
        receipt
      ).ledger,
      reason: "Inspect persisted ledger; no automatic retry is authorized",
      status: "stopped_unknown",
    };
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
    const bridge = path.join(directory, "bridge");
    mkdirSync(bridge);
    const publishedRequest = path.join(
      bridge,
      `${createHash("sha256").update(identity.dispatchId).digest("hex")}.request.json`
    );
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
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}, 20_000);

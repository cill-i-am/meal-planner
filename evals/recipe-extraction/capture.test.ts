import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Schema } from "effect";
import { expect, it } from "vitest";

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

it("replays the real interrupted receipt without inventing response, latency or spend, and rejects a changed request identity", () => {
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
      status: "failed",
    });
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

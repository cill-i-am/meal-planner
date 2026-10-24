import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { isProviderKnownZeroCostFailure } from "../provider-accounting/provider-accounting.js";
import { AcquisitionGeneration } from "./import-media.model.js";
import {
  correlationId,
  localDispatchGate,
  makeRecordingTraceStore,
  runFactory,
} from "./import-provider-adapters.test-fixture.js";
import { makeWorkersAiTransport } from "./import-provider-kernel.js";
import type { ProviderDispatchGate } from "./import-provider-kernel.js";
import { makeInstalledVisualEvidenceExtractor } from "./import-provider-visual.js";
import { syntheticThreeFrameResponse } from "./import-provider-visual.scout.test-fixture.js";
import { ImportId } from "./import.contracts.js";

const request = {
  dispatchId: "visual:http-boundary:1",
  frames: [0, 1, 2].map((index) => ({
    bytes: new Uint8Array([index + 1]),
    height: 140,
    mimeType: "image/jpeg" as const,
    sha256: "a".repeat(64),
    timestampMilliseconds: index * 1000,
    width: 480,
  })),
  generation: Schema.decodeUnknownSync(AcquisitionGeneration)(1),
  importId: Schema.decodeUnknownSync(ImportId)(
    "019b37f2-1a6e-7f3a-8a5a-7f0d8f6c2b1b"
  ),
  sourceMediaSha256: "b".repeat(64),
};

// Exercise the installed Alchemy serializer/parser, not the scripted language-model fixture.
const makeAdapter = async (
  response: Response,
  dispatch = localDispatchGate
) => {
  let invocations = 0;
  const trace = makeRecordingTraceStore();
  const transport = await runFactory(
    makeWorkersAiTransport(
      {
        id: Effect.succeed("offline-http-boundary"),
        raw: Effect.succeed({
          run: () => {
            invocations += 1;
            return Promise.resolve(response);
          },
        }) as never,
      },
      correlationId
    ),
    trace.service
  );
  const adapter = await runFactory(
    makeInstalledVisualEvidenceExtractor({
      correlationId,
      dispatch,
      transport: transport.visual,
    }),
    trace.service
  );
  return { adapter, events: trace.events, invocations: () => invocations };
};

describe("visual provider HTTP boundary", () => {
  it.each([
    { body: "json", code: "throttled", status: 429 },
    { body: "json", code: "provider_unavailable", status: 503 },
    { body: "json", code: "provider_unavailable", status: 504 },
    { body: "text", code: "provider_unavailable", status: 503 },
  ])(
    "rejects $status/$body before decoding model content",
    async ({ status, body, code }) => {
      let knownZero = false;
      const dispatch: ProviderDispatchGate = {
        run: (input) =>
          input.invoke.pipe(
            // eslint-disable-next-line promise/prefer-await-to-callbacks -- Effect callbacks preserve the typed error channel under test.
            Effect.tapError((error) =>
              Effect.sync(() => {
                knownZero = isProviderKnownZeroCostFailure(error);
              })
            ),
            Effect.map(({ value }) => value)
          ),
      };
      const response =
        body === "json"
          ? Response.json(
              { errors: [{ message: "provider-private-canary" }] },
              { status }
            )
          : new Response("provider-private-canary", { status });
      const { adapter, events, invocations } = await makeAdapter(
        response,
        dispatch
      );
      const exit = await Effect.runPromiseExit(adapter.extract(request));
      expect(exit._tag).toBe("Failure");
      expect(JSON.stringify(exit)).toContain(code);
      expect(JSON.stringify(exit)).not.toContain("provider-private-canary");
      expect(knownZero).toBe(false);
      expect(invocations()).toBe(1);
      expect(response.bodyUsed).toBe(false);
      expect(events).toEqual([
        {
          correlationId,
          event: "provider.response",
          httpStatus: status,
          outcome: "rejected",
          providerStage: "visual",
        },
      ]);
    }
  );

  it("preserves a successful response through the same installed transport", async () => {
    const { adapter, events, invocations } = await makeAdapter(
      Response.json(syntheticThreeFrameResponse)
    );
    const result = await Effect.runPromise(adapter.extract(request));
    expect(result.observations.map(({ text }) => text)).toEqual([
      "2 onions",
      "Simmer 10 minutes",
      "Serve with rice",
    ]);
    expect(result.cost.estimatedMicroUsd).toBe(650);
    expect(invocations()).toBe(1);
    expect(events).toContainEqual({
      correlationId,
      event: "provider.response",
      httpStatus: 200,
      outcome: "received",
      providerStage: "visual",
    });
  });
});

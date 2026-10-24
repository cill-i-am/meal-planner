import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";

import { isProviderKnownZeroCostFailure } from "../provider-accounting/provider-accounting.js";
import {
  correlationId,
  localDispatchGate,
  runFactory,
} from "./import-provider-adapters.test-fixture.js";
import { makeWorkersAiTransport } from "./import-provider-kernel.js";
import type { ProviderDispatchGate } from "./import-provider-kernel.js";
import { makeInstalledVisualEvidenceExtractor } from "./import-provider-visual.js";
import { syntheticThreeFrameResponse } from "./import-provider-visual.scout.test-fixture.js";

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
  generation: 1 as never,
  importId: "http-boundary" as never,
  sourceMediaSha256: "b".repeat(64),
};

// Exercise the installed Alchemy serializer/parser, not the scripted language-model fixture.
const makeAdapter = async (
  response: Response,
  dispatch = localDispatchGate
) => {
  let invocations = 0;
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
    )
  );
  const adapter = await runFactory(
    makeInstalledVisualEvidenceExtractor({
      correlationId,
      dispatch,
      transport: transport.visual,
    })
  );
  return { adapter, invocations: () => invocations };
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
      const log = vi.spyOn(console, "log").mockImplementation(vi.fn());
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
      const readBody = vi.spyOn(response, "json");
      try {
        const { adapter, invocations } = await makeAdapter(response, dispatch);
        const exit = await Effect.runPromiseExit(adapter.extract(request));
        expect(exit._tag).toBe("Failure");
        expect(JSON.stringify(exit)).toContain(code);
        expect(JSON.stringify(exit)).not.toContain("provider-private-canary");
        expect(knownZero).toBe(false);
        expect(invocations()).toBe(1);
        expect(readBody).not.toHaveBeenCalled();
        expect(log.mock.calls).toEqual([
          [
            {
              correlationId,
              event: "provider.response",
              httpStatus: status,
              outcome: "rejected",
              providerStage: "visual",
            },
          ],
        ]);
      } finally {
        log.mockRestore();
        readBody.mockRestore();
      }
    }
  );

  it("preserves a successful response through the same installed transport", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(vi.fn());
    try {
      const { adapter, invocations } = await makeAdapter(
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
      expect(log.mock.calls).toContainEqual([
        {
          correlationId,
          event: "provider.response",
          httpStatus: 200,
          outcome: "received",
          providerStage: "visual",
        },
      ]);
    } finally {
      log.mockRestore();
    }
  });
});

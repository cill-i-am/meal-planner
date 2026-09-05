import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";

import { isProviderKnownZeroCostFailure } from "../provider-accounting/provider-accounting.js";
import {
  makeRawProviderTransports,
  makeProviderTransports,
  makeRejectedProviderTransports,
  correlationId,
  localDispatchGate,
  runFactory,
  makeRecordingTraceStore,
  validVisual,
  validVisualSemantics,
  defaultVisualUsage,
  toolResponse,
} from "./import-provider-adapters.test-fixture.js";
import type { ProviderDispatchGate } from "./import-provider-kernel.js";
import { makeInstalledVisualEvidenceExtractor } from "./import-provider-visual.js";

describe("installed visual provider adapter", () => {
  it("maps a missing visual forced-tool call without payload data", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(vi.fn());
    const gateway = makeProviderTransports({
      providerSecret: "must-not-escape",
    });
    const adapter = await runFactory(
      makeInstalledVisualEvidenceExtractor({
        correlationId,
        dispatch: localDispatchGate,
        transport: gateway.visual,
      })
    );

    const exit = await Effect.runPromiseExit(
      adapter.extract({
        dispatchId: "visual:import-1:1",
        frames: [
          {
            bytes: new Uint8Array([1, 2, 3]),
            height: 1,
            mimeType: "image/jpeg",
            sha256: "a".repeat(64),
            timestampMilliseconds: 0,
            width: 1,
          },
        ],
        generation: 1 as never,
        importId: "import-1" as never,
        sourceMediaSha256: "b".repeat(64),
      })
    );

    expect(exit._tag).toBe("Failure");
    expect(JSON.stringify(exit)).toContain("insufficient_evidence");
    expect(JSON.stringify(exit)).not.toContain("must-not-escape");
    expect(log.mock.calls).toEqual([
      [
        {
          correlationId,
          event: "provider.response",
          outcome: "received",
          providerStage: "visual",
        },
      ],
      [
        {
          correlationId,
          decodeReason: "forced_tool_missing",
          decodeStage: "forced_tool_envelope",
          event: "provider.decode",
          outcome: "malformed",
          providerStage: "visual",
        },
      ],
    ]);
    expect(JSON.stringify(log.mock.calls)).not.toContain("must-not-escape");
    log.mockRestore();
  });

  it("preserves an explicitly branded known-zero visual setup failure for guarded settlement", async () => {
    let reachedDispatchAsKnownZero = false;
    const dispatch: ProviderDispatchGate = {
      run: (input) =>
        input.invoke.pipe(
          // eslint-disable-next-line promise/prefer-await-to-callbacks -- Effect callbacks preserve the typed failure channel under test.
          Effect.tapError((error) =>
            Effect.sync(() => {
              reachedDispatchAsKnownZero =
                isProviderKnownZeroCostFailure(error);
            })
          ),
          Effect.map(({ value }) => value)
        ),
    };
    const trace = makeRecordingTraceStore();
    const adapter = await runFactory(
      makeInstalledVisualEvidenceExtractor({
        correlationId,
        dispatch,
        transport: makeRejectedProviderTransports(
          new Error("provider_known_zero_setup_failure")
        ).visual,
      }),
      trace.service
    );

    const exit = await Effect.runPromiseExit(
      adapter.extract({
        dispatchId: "visual:import-1:1",
        frames: [
          {
            bytes: new Uint8Array([1, 2, 3]),
            height: 1,
            mimeType: "image/jpeg",
            sha256: "a".repeat(64),
            timestampMilliseconds: 0,
            width: 1,
          },
        ],
        generation: 1 as never,
        importId: "import-1" as never,
        sourceMediaSha256: "b".repeat(64),
      })
    );

    expect(exit._tag).toBe("Failure");
    expect(JSON.stringify(exit)).toContain("provider_unavailable");
    expect(reachedDispatchAsKnownZero).toBe(true);
    expect(trace.events).toEqual([]);
  });

  it("does not infer known-zero visual settlement from unbranded provider status, code, or name fields", async () => {
    let reachedDispatchAsKnownZero = false;
    const dispatch: ProviderDispatchGate = {
      run: (input) =>
        input.invoke.pipe(
          // eslint-disable-next-line promise/prefer-await-to-callbacks -- Effect callbacks preserve the typed failure channel under test.
          Effect.tapError((error) =>
            Effect.sync(() => {
              reachedDispatchAsKnownZero =
                isProviderKnownZeroCostFailure(error);
            })
          ),
          Effect.map(({ value }) => value)
        ),
    };
    const trace = makeRecordingTraceStore();
    const adapter = await runFactory(
      makeInstalledVisualEvidenceExtractor({
        correlationId,
        dispatch,
        transport: makeRejectedProviderTransports(
          Object.assign(new Error("providerSecret=must-not-escape"), {
            _tag: "AiGatewayError",
            cause: {
              code: "model_agreement_required",
              name: "request_shape_rejected",
              providerSecret: "must-not-escape",
              status: 400,
            },
          })
        ).visual,
      }),
      trace.service
    );

    const exit = await Effect.runPromiseExit(
      adapter.extract({
        dispatchId: "visual:import-1:1",
        frames: [
          {
            bytes: new Uint8Array([1, 2, 3]),
            height: 1,
            mimeType: "image/jpeg",
            sha256: "a".repeat(64),
            timestampMilliseconds: 0,
            width: 1,
          },
        ],
        generation: 1 as never,
        importId: "import-1" as never,
        sourceMediaSha256: "b".repeat(64),
      })
    );

    expect(exit._tag).toBe("Failure");
    expect(JSON.stringify(exit)).toContain("provider_unavailable");
    expect(JSON.stringify(exit)).not.toContain("must-not-escape");
    expect(reachedDispatchAsKnownZero).toBe(false);
    expect(trace.events).toEqual([]);
  });

  it("uses the current Workers AI image-message forced-tool contract and derives trusted visual metadata", async () => {
    const visualSemantics = {
      observations: [
        {
          confidence: 92,
          frameIndex: 0,
          kind: "visible_text",
          regions: [{ height: 0.25, width: 0.25, x: 0.25, y: 0.25 }],
          text: "2 onions",
          timestampMilliseconds: 999,
        },
      ],
      outcome: "empty",
    } as const;
    const gateway = makeProviderTransports(
      toolResponse("record_visual_evidence", visualSemantics)
    );
    const trace = makeRecordingTraceStore();
    const adapter = await runFactory(
      makeInstalledVisualEvidenceExtractor({
        correlationId,
        dispatch: localDispatchGate,
        transport: gateway.visual,
      }),
      trace.service
    );
    const output = await Effect.runPromise(
      adapter.extract({
        dispatchId: "visual:import-1:1",
        frames: [
          {
            bytes: new Uint8Array([1, 2, 3]),
            height: 1,
            mimeType: "image/jpeg",
            sha256: "a".repeat(64),
            timestampMilliseconds: 125,
            width: 1,
          },
          {
            bytes: new Uint8Array([4, 5]),
            height: 1,
            mimeType: "image/jpeg",
            sha256: "c".repeat(64),
            timestampMilliseconds: 500,
            width: 1,
          },
          {
            bytes: new Uint8Array([6]),
            height: 1,
            mimeType: "image/jpeg",
            sha256: "d".repeat(64),
            timestampMilliseconds: 750,
            width: 1,
          },
        ],
        generation: 1 as never,
        importId: "import-1" as never,
        sourceMediaSha256: "b".repeat(64),
      })
    );

    expect(output).toEqual({
      cost: {
        certainty: "estimated",
        currency: "USD",
        estimatedMicroUsd: 14,
      },
      model: "@cf/meta/llama-4-scout-17b-16e-instruct",
      observations: [
        {
          confidence: 0.92,
          frameIndex: 1,
          kind: "visible_text",
          regions: [{ height: 1, width: 1, x: 0, y: 0 }],
          text: "2 onions",
          timestampMilliseconds: 500,
        },
      ],
      outcome: "found",
      provider: "cloudflare-workers-ai",
      usage: { inputBytes: 2, inputFrames: 1, modelCalls: 1 },
    });
    expect(gateway.visualRequests).toHaveLength(1);
    const [request] = gateway.visualRequests;
    expect(request?.toolChoice).toEqual({ tool: "record_visual_evidence" });
    expect(request?.tools.map((tool) => tool.name)).toEqual([
      "record_visual_evidence",
    ]);
    expect(JSON.stringify(request?.prompt)).toContain(
      "adapter owns the source frame identity and timing"
    );
    expect(trace.events).toEqual([
      {
        correlationId,
        event: "provider.response",
        outcome: "received",
        providerStage: "visual",
      },
      {
        correlationId,
        event: "provider.decode",
        outcome: "succeeded",
        providerStage: "visual",
      },
    ]);
    expect(JSON.stringify(trace.events)).not.toContain("2 onions");
    expect(JSON.stringify(trace.events)).not.toContain("BAU=");
  });

  it("projects known inert visual metadata before strict semantic decoding", async () => {
    const gateway = makeProviderTransports(
      toolResponse("record_visual_evidence", {
        observations: [
          {
            confidence: " 92 ",
            frameIndex: "provider-owned",
            kind: "provider-owned",
            regions: [{ providerOwned: true }],
            text: "  2 onions  ",
            timestampMilliseconds: null,
          },
        ],
        outcome: "provider-owned",
      })
    );
    const adapter = await runFactory(
      makeInstalledVisualEvidenceExtractor({
        correlationId,
        dispatch: localDispatchGate,
        transport: gateway.visual,
      })
    );

    const output = await Effect.runPromise(
      adapter.extract({
        dispatchId: "visual:import-1:1",
        frames: [
          {
            bytes: new Uint8Array([1, 2, 3]),
            height: 1,
            mimeType: "image/jpeg",
            sha256: "a".repeat(64),
            timestampMilliseconds: 125,
            width: 1,
          },
        ],
        generation: 1 as never,
        importId: "import-1" as never,
        sourceMediaSha256: "b".repeat(64),
      })
    );

    expect(output).toMatchObject({
      observations: [
        {
          confidence: 0.92,
          frameIndex: 0,
          kind: "visible_text",
          regions: [{ height: 1, width: 1, x: 0, y: 0 }],
          text: "2 onions",
          timestampMilliseconds: 125,
        },
      ],
      outcome: "found",
    });
  });

  it("conservatively normalizes optional provider confidence variants", async () => {
    const gateway = makeProviderTransports(
      toolResponse("record_visual_evidence", {
        observations: [
          {
            confidence: "92%",
            text: "  2 onions  ",
          },
          {
            text: "add stock",
          },
          {
            confidence: "high",
            text: "serve",
          },
        ],
      })
    );
    const adapter = await runFactory(
      makeInstalledVisualEvidenceExtractor({
        correlationId,
        dispatch: localDispatchGate,
        transport: gateway.visual,
      })
    );

    const output = await Effect.runPromise(
      adapter.extract({
        dispatchId: "visual:import-1:1",
        frames: [
          {
            bytes: new Uint8Array([1, 2, 3]),
            height: 1,
            mimeType: "image/jpeg",
            sha256: "a".repeat(64),
            timestampMilliseconds: 125,
            width: 1,
          },
        ],
        generation: 1 as never,
        importId: "import-1" as never,
        sourceMediaSha256: "b".repeat(64),
      })
    );

    expect(output).toMatchObject({
      observations: [
        { confidence: 0.92, text: "2 onions" },
        { confidence: 0, text: "add stock" },
        { confidence: 0, text: "serve" },
      ],
      outcome: "found",
    });
  });

  it("keeps only safe visual facts when the provider adds malformed metadata", async () => {
    const gateway = makeProviderTransports(
      toolResponse("record_visual_evidence", {
        observations: [
          {
            confidence: 87,
            providerPrivateNote: "must-not-escape",
            text: "  chop the onions  ",
          },
          {
            confidence: 140,
            text: "add stock",
          },
          {
            confidence: 95,
            text: null,
          },
        ],
        providerPrivateSummary: "must-not-escape",
      })
    );
    const adapter = await runFactory(
      makeInstalledVisualEvidenceExtractor({
        correlationId,
        dispatch: localDispatchGate,
        transport: gateway.visual,
      })
    );

    const output = await Effect.runPromise(
      adapter.extract({
        dispatchId: "visual:import-1:1",
        frames: [
          {
            bytes: new Uint8Array([1, 2, 3]),
            height: 1,
            mimeType: "image/jpeg",
            sha256: "a".repeat(64),
            timestampMilliseconds: 125,
            width: 1,
          },
        ],
        generation: 1 as never,
        importId: "import-1" as never,
        sourceMediaSha256: "b".repeat(64),
      })
    );

    expect(output).toMatchObject({
      observations: [
        { confidence: 0.87, text: "chop the onions" },
        { confidence: 0, text: "add stock" },
      ],
      outcome: "found",
    });
    expect(JSON.stringify(output)).not.toContain("must-not-escape");
  });

  it.each([
    ["omits observations", { providerPrivateNote: "must-not-escape" }],
    [
      "returns non-array observations",
      {
        observations: { text: "must-not-escape" },
        providerPrivateNote: "must-not-escape",
      },
    ],
  ])(
    "projects empty visual evidence when the provider %s",
    async (_label, body) => {
      const gateway = makeProviderTransports(
        toolResponse("record_visual_evidence", body)
      );
      const adapter = await runFactory(
        makeInstalledVisualEvidenceExtractor({
          correlationId,
          dispatch: localDispatchGate,
          transport: gateway.visual,
        })
      );

      const output = await Effect.runPromise(
        adapter.extract({
          dispatchId: "visual:import-1:1",
          frames: [
            {
              bytes: new Uint8Array([1, 2, 3]),
              height: 1,
              mimeType: "image/jpeg",
              sha256: "a".repeat(64),
              timestampMilliseconds: 125,
              width: 1,
            },
          ],
          generation: 1 as never,
          importId: "import-1" as never,
          sourceMediaSha256: "b".repeat(64),
        })
      );

      expect(output).toMatchObject({ observations: [], outcome: "empty" });
      expect(JSON.stringify(output)).not.toContain("must-not-escape");
    }
  );

  it("accepts the documented Workers AI forced-tool response envelope", async () => {
    const gateway = makeProviderTransports(
      toolResponse("record_visual_evidence", validVisualSemantics)
    );
    const adapter = await runFactory(
      makeInstalledVisualEvidenceExtractor({
        correlationId,
        dispatch: localDispatchGate,
        transport: gateway.visual,
      })
    );

    const output = await Effect.runPromise(
      adapter.extract({
        dispatchId: "visual:import-1:1",
        frames: [
          {
            bytes: new Uint8Array([1, 2, 3]),
            height: 1,
            mimeType: "image/jpeg",
            sha256: "a".repeat(64),
            timestampMilliseconds: 125,
            width: 1,
          },
        ],
        generation: 1 as never,
        importId: "import-1" as never,
        sourceMediaSha256: "b".repeat(64),
      })
    );

    expect(output).toMatchObject({
      model: "@cf/meta/llama-4-scout-17b-16e-instruct",
      observations: [],
      outcome: "empty",
    });
    expect(gateway.visualRequests).toHaveLength(1);
  });

  it("derives low-confidence outcome from strict provider observations", async () => {
    const gateway = makeProviderTransports(
      toolResponse("record_visual_evidence", {
        observations: [
          {
            confidence: 0.5,
            frameIndex: 0,
            text: "possible ingredient label",
          },
        ],
      })
    );
    const adapter = await runFactory(
      makeInstalledVisualEvidenceExtractor({
        correlationId,
        dispatch: localDispatchGate,
        transport: gateway.visual,
      })
    );

    const output = await Effect.runPromise(
      adapter.extract({
        dispatchId: "visual:import-1:1",
        frames: [
          {
            bytes: new Uint8Array([1, 2, 3]),
            height: 1,
            mimeType: "image/jpeg",
            sha256: "a".repeat(64),
            timestampMilliseconds: 125,
            width: 1,
          },
        ],
        generation: 1 as never,
        importId: "import-1" as never,
        sourceMediaSha256: "b".repeat(64),
      })
    );

    expect(output).toMatchObject({
      observations: [{ confidence: 0.5, text: "possible ingredient label" }],
      outcome: "low_confidence",
    });
  });

  it.each([
    [
      "aligned native and OpenAI authorities",
      {
        ...toolResponse("record_visual_evidence", validVisualSemantics),
        tool_calls: [
          {
            arguments: validVisualSemantics,
            name: "record_visual_evidence",
          },
        ],
      },
    ],
    [
      "an empty OpenAI authority beside one native call",
      {
        choices: [],
        tool_calls: [
          {
            arguments: validVisualSemantics,
            name: "record_visual_evidence",
          },
        ],
        usage: defaultVisualUsage,
      },
    ],
    [
      "one OpenAI message with no calls beside one native call",
      {
        choices: [
          {
            finish_reason: "tool_calls",
            message: {
              content: null,
              tool_calls: [],
            },
          },
        ],
        tool_calls: [
          {
            arguments: validVisualSemantics,
            name: "record_visual_evidence",
          },
        ],
        usage: defaultVisualUsage,
      },
    ],
    [
      "aligned flat and nested fields on one call",
      {
        tool_calls: [
          {
            arguments: validVisualSemantics,
            function: {
              arguments: JSON.stringify(validVisualSemantics),
              name: "record_visual_evidence",
            },
            name: "record_visual_evidence",
          },
        ],
        usage: defaultVisualUsage,
      },
    ],
    [
      "null non-authoritative tool metadata beside an exact native mirror",
      {
        choices: null,
        response: JSON.stringify({
          arguments: validVisualSemantics,
          name: "record_visual_evidence",
        }),
        tool_calls: null,
        usage: defaultVisualUsage,
      },
    ],
  ] as const)(
    "accepts the unambiguous Workers AI vision variant with %s",
    async (_label, response) => {
      const gateway = makeProviderTransports(response);
      const trace = makeRecordingTraceStore();
      const adapter = await runFactory(
        makeInstalledVisualEvidenceExtractor({
          correlationId,
          dispatch: localDispatchGate,
          transport: gateway.visual,
        }),
        trace.service
      );

      const output = await Effect.runPromise(
        adapter.extract({
          dispatchId: "visual:import-1:1",
          frames: [
            {
              bytes: new Uint8Array([1, 2, 3]),
              height: 1,
              mimeType: "image/jpeg",
              sha256: "a".repeat(64),
              timestampMilliseconds: 125,
              width: 1,
            },
          ],
          generation: 1 as never,
          importId: "import-1" as never,
          sourceMediaSha256: "b".repeat(64),
        })
      );

      expect(output).toMatchObject({
        observations: [],
        outcome: "empty",
      });
      expect(trace.events.at(-1)).toEqual({
        correlationId,
        event: "provider.decode",
        outcome: "succeeded",
        providerStage: "visual",
      });
    }
  );

  it("discards model attempts to inject visual transport metadata", async () => {
    const gateway = makeProviderTransports(
      toolResponse("record_visual_evidence", {
        ...validVisual,
        providerPrivateCanary: "must-not-escape",
      })
    );
    const adapter = await runFactory(
      makeInstalledVisualEvidenceExtractor({
        correlationId,
        dispatch: localDispatchGate,
        transport: gateway.visual,
      })
    );

    const output = await Effect.runPromise(
      adapter.extract({
        dispatchId: "visual:import-1:1",
        frames: [
          {
            bytes: new Uint8Array([1, 2, 3]),
            height: 1,
            mimeType: "image/jpeg",
            sha256: "a".repeat(64),
            timestampMilliseconds: 0,
            width: 1,
          },
        ],
        generation: 1 as never,
        importId: "import-1" as never,
        sourceMediaSha256: "b".repeat(64),
      })
    );

    expect(output).toMatchObject({ observations: [], outcome: "empty" });
    expect(JSON.stringify(output)).not.toContain("must-not-escape");
  });

  it("fails closed for prose instead of structured visual tool arguments", async () => {
    const response = toolResponse("record_visual_evidence", "{not-json");
    const gateway = makeProviderTransports(response);
    const adapter = await runFactory(
      makeInstalledVisualEvidenceExtractor({
        correlationId,
        dispatch: localDispatchGate,
        transport: gateway.visual,
      })
    );

    const exit = await Effect.runPromiseExit(
      adapter.extract({
        dispatchId: "visual:import-1:1",
        frames: [
          {
            bytes: new Uint8Array([1, 2, 3]),
            height: 1,
            mimeType: "image/jpeg",
            sha256: "a".repeat(64),
            timestampMilliseconds: 0,
            width: 1,
          },
        ],
        generation: 1 as never,
        importId: "import-1" as never,
        sourceMediaSha256: "b".repeat(64),
      })
    );

    expect(exit._tag).toBe("Failure");
    expect(JSON.stringify(exit)).toContain("malformed_response");
    expect(JSON.stringify(exit)).not.toContain("must-not-escape");
  });

  it("degrades an unparseable optional visual response to bounded empty evidence", async () => {
    const costs: (
      | {
          readonly _tag: "Known";
          readonly actualCostMicroUsd: number;
        }
      | {
          readonly _tag: "Conservative";
          readonly conservativeChargeMicroUsd: number;
        }
      | { readonly _tag: "Unknown" }
    )[] = [];
    const trace = makeRecordingTraceStore();
    const gateway = makeRawProviderTransports(
      new Response("provider-private-canary", {
        headers: { "content-type": "application/json" },
      })
    );
    const adapter = await runFactory(
      makeInstalledVisualEvidenceExtractor({
        correlationId,
        dispatch: {
          run: (input) =>
            input.invoke.pipe(
              Effect.tap(({ cost }) =>
                Effect.sync(() => {
                  costs.push(cost);
                })
              ),
              Effect.map(({ value }) => value)
            ),
        },
        transport: gateway.visual,
      }),
      trace.service
    );

    const output = await Effect.runPromise(
      adapter.extract({
        dispatchId: "visual:import-1:1",
        frames: [
          {
            bytes: new Uint8Array([1, 2, 3]),
            height: 1,
            mimeType: "image/jpeg",
            sha256: "a".repeat(64),
            timestampMilliseconds: 0,
            width: 1,
          },
        ],
        generation: 1 as never,
        importId: "import-1" as never,
        sourceMediaSha256: "b".repeat(64),
      })
    );

    expect(output).toMatchObject({
      cost: {
        certainty: "estimated",
        currency: "USD",
        estimatedMicroUsd: 100_000,
      },
      observations: [],
      outcome: "empty",
      usage: { inputBytes: 3, inputFrames: 1, modelCalls: 1 },
    });
    expect(costs).toEqual([{ _tag: "Known", actualCostMicroUsd: 100_000 }]);
    expect(trace.events).toEqual([
      {
        correlationId,
        event: "provider.response",
        outcome: "received",
        providerStage: "visual",
      },
      {
        correlationId,
        decodeReason: "provider_normalization_invalid",
        decodeStage: "provider_normalization",
        event: "provider.decode",
        outcome: "malformed",
        providerStage: "visual",
      },
    ]);
    expect(JSON.stringify({ output, trace: trace.events })).not.toContain(
      "provider-private-canary"
    );
  });

  it.each([
    ["free-text substitution", { response: "provider-private-canary" }],
    [
      "a fenced JSON object",
      {
        response:
          '```json\n{"observations":[],"outcome":"empty","secret":"provider-private-canary"}\n```',
      },
    ],
    [
      "multiple JSON objects",
      {
        response:
          '{"observations":[],"outcome":"empty"}\n{"secret":"provider-private-canary"}',
      },
    ],
    [
      "an extra native tool call",
      {
        tool_calls: [
          {
            arguments: validVisualSemantics,
            name: "record_visual_evidence",
          },
          {
            arguments: validVisualSemantics,
            name: "record_visual_evidence",
          },
        ],
      },
    ],
    [
      "a conflicting native mirror",
      {
        response: JSON.stringify({
          arguments: {
            observations: [
              {
                confidence: 0.5,
                frameIndex: 0,
                text: "provider-private-canary",
              },
            ],
            outcome: "found",
          },
          name: "record_visual_evidence",
        }),
        tool_calls: [
          {
            arguments: validVisualSemantics,
            name: "record_visual_evidence",
          },
        ],
      },
    ],
    [
      "conflicting native and OpenAI authorities",
      {
        ...toolResponse("record_visual_evidence", validVisualSemantics),
        tool_calls: [
          {
            arguments: {
              observations: [
                {
                  confidence: 0.5,
                  frameIndex: 0,
                  text: "provider-private-canary",
                },
              ],
              outcome: "found",
            },
            name: "record_visual_evidence",
          },
        ],
      },
    ],
    [
      "conflicting flat and nested fields on one call",
      {
        tool_calls: [
          {
            arguments: validVisualSemantics,
            function: {
              arguments: JSON.stringify({
                observations: [
                  {
                    confidence: 0.5,
                    frameIndex: 0,
                    text: "provider-private-canary",
                  },
                ],
                outcome: "found",
              }),
              name: "record_visual_evidence",
            },
            name: "record_visual_evidence",
          },
        ],
      },
    ],
    [
      "an empty flat name beside a valid nested name",
      {
        tool_calls: [
          {
            function: {
              arguments: JSON.stringify(validVisualSemantics),
              name: "record_visual_evidence",
            },
            name: "",
          },
        ],
      },
    ],
    [
      "a null flat name beside a valid nested name",
      {
        tool_calls: [
          {
            function: {
              arguments: JSON.stringify(validVisualSemantics),
              name: "record_visual_evidence",
            },
            name: null,
          },
        ],
      },
    ],
    [
      "an extra OpenAI tool call",
      {
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                {
                  function: {
                    arguments: JSON.stringify(validVisualSemantics),
                    name: "record_visual_evidence",
                  },
                  type: "function",
                },
                {
                  function: {
                    arguments: JSON.stringify(validVisualSemantics),
                    name: "record_visual_evidence",
                  },
                  type: "function",
                },
              ],
            },
          },
        ],
      },
    ],
    [
      "a valid OpenAI tool call beside a malformed nameless call",
      {
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                {
                  function: {
                    arguments: JSON.stringify(validVisualSemantics),
                    name: "record_visual_evidence",
                  },
                  type: "function",
                },
                {
                  function: {
                    arguments: "{}",
                  },
                  type: "function",
                },
              ],
            },
          },
        ],
      },
    ],
    [
      "an extra authoritative OpenAI choice",
      {
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                {
                  function: {
                    arguments: JSON.stringify(validVisualSemantics),
                    name: "record_visual_evidence",
                  },
                  type: "function",
                },
              ],
            },
          },
          {
            message: {
              content: null,
              tool_calls: [
                {
                  function: {
                    arguments: JSON.stringify(validVisualSemantics),
                    name: "record_visual_evidence",
                  },
                  type: "function",
                },
              ],
            },
          },
        ],
      },
    ],
  ] as const)(
    "fails closed for visual %s without leaking provider data",
    async (_label, response) => {
      const gateway = makeProviderTransports(response);
      const trace = makeRecordingTraceStore();
      const adapter = await runFactory(
        makeInstalledVisualEvidenceExtractor({
          correlationId,
          dispatch: localDispatchGate,
          transport: gateway.visual,
        }),
        trace.service
      );

      const exit = await Effect.runPromiseExit(
        adapter.extract({
          dispatchId: "visual:import-1:1",
          frames: [
            {
              bytes: new Uint8Array([1, 2, 3]),
              height: 1,
              mimeType: "image/jpeg",
              sha256: "a".repeat(64),
              timestampMilliseconds: 0,
              width: 1,
            },
          ],
          generation: 1 as never,
          importId: "import-1" as never,
          sourceMediaSha256: "b".repeat(64),
        })
      );

      expect(exit._tag).toBe("Failure");
      expect(JSON.stringify(exit)).toContain("malformed_response");
      expect(trace.events[0]).toEqual({
        correlationId,
        event: "provider.response",
        outcome: "received",
        providerStage: "visual",
      });
      expect(trace.events).toContainEqual(
        expect.objectContaining({
          correlationId,
          event: "provider.decode",
          outcome: "malformed",
          providerStage: "visual",
        })
      );
      expect(JSON.stringify(exit)).not.toContain("provider-private-canary");
      expect(JSON.stringify(trace.events)).not.toContain(
        "provider-private-canary"
      );
    }
  );

  it.each([
    [
      "absent",
      toolResponse("record_visual_evidence", validVisualSemantics, null),
    ],
    [
      "zero",
      toolResponse("record_visual_evidence", validVisualSemantics, {
        completion_tokens: 0,
        prompt_tokens: 0,
      }),
    ],
  ])(
    "settles %s visual usage at the bounded safety maximum",
    async (_label, response) => {
      const costs: (
        | {
            readonly _tag: "Known";
            readonly actualCostMicroUsd: number;
          }
        | {
            readonly _tag: "Conservative";
            readonly conservativeChargeMicroUsd: number;
          }
        | { readonly _tag: "Unknown" }
      )[] = [];
      const adapter = await runFactory(
        makeInstalledVisualEvidenceExtractor({
          correlationId,
          dispatch: {
            run: (input) =>
              input.invoke.pipe(
                Effect.tap(({ cost }) =>
                  Effect.sync(() => {
                    costs.push(cost);
                  })
                ),
                Effect.map(({ value }) => value)
              ),
          },
          transport: makeProviderTransports(response).visual,
        })
      );

      const output = await Effect.runPromise(
        adapter.extract({
          dispatchId: "visual:import-1:1",
          frames: [
            {
              bytes: new Uint8Array([1, 2, 3]),
              height: 1,
              mimeType: "image/jpeg",
              sha256: "a".repeat(64),
              timestampMilliseconds: 0,
              width: 1,
            },
          ],
          generation: 1 as never,
          importId: "import-1" as never,
          sourceMediaSha256: "b".repeat(64),
        })
      );

      expect(costs).toEqual([{ _tag: "Known", actualCostMicroUsd: 100_000 }]);
      expect(output.cost).toEqual({
        certainty: "estimated",
        currency: "USD",
        estimatedMicroUsd: 100_000,
      });
    }
  );

  it("rejects an empty visual dispatch before the provider boundary", async () => {
    const gateway = makeProviderTransports(
      toolResponse("record_visual_evidence", validVisualSemantics)
    );
    const adapter = await runFactory(
      makeInstalledVisualEvidenceExtractor({
        correlationId,
        dispatch: localDispatchGate,
        transport: gateway.visual,
      })
    );

    const exit = await Effect.runPromiseExit(
      adapter.extract({
        dispatchId: "visual:import-1:1",
        frames: [],
        generation: 1 as never,
        importId: "import-1" as never,
        sourceMediaSha256: "b".repeat(64),
      })
    );

    expect(exit._tag).toBe("Failure");
    expect(JSON.stringify(exit)).toContain("insufficient_evidence");
    expect(gateway.visualRequests).toHaveLength(0);
  });
});

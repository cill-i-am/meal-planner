import type * as NativeCloudflare from "@cloudflare/workers-types";
import { Effect, Schema } from "effect";
import { describe, expect, it, vi } from "vitest";

import { PrivateDiscoveryContext } from "./private-discovery-model.js";
import {
  makePrivateDiscoveryModel,
  PRIVATE_DISCOVERY_RESPONSE_BYTES,
} from "./private-discovery-workers-ai.js";
import type { PrivateDiscoveryConfiguration } from "./private-discovery-workers-ai.js";

const context = () =>
  Schema.decodeUnknownSync(PrivateDiscoveryContext)({
    cards: [],
    messages: [
      {
        id: crypto.randomUUID(),
        role: "participant",
        text: "I like tomatoes.",
      },
    ],
    profile: { facts: [], version: 0 },
    summary: "",
  });
const config: PrivateDiscoveryConfiguration = {
  gatewayId: "synthetic-private-discovery",
  inputUsdPerMillionTokens: 0.2,
  maxOutputTokens: 2048,
  model: "@cf/qwen/qwen3-30b-a3b-fp8",
  outputUsdPerMillionTokens: 0.6,
  timeoutMs: 1000,
};
const output = {
  message: "How do you like tomatoes prepared?",
  proposals: [],
  summary: "Tomatoes are an unconfirmed preference.",
};
const completion = (content: Readonly<Record<string, unknown>> = output) => ({
  choices: [
    {
      finish_reason: "stop",
      message: { content: JSON.stringify(content), role: "assistant" },
    },
  ],
  usage: { completion_tokens: 50, prompt_tokens: 100 },
});
interface CapturedOptions {
  readonly extraHeaders: Readonly<Record<string, string>>;
  readonly gateway: {
    readonly collectLog: boolean;
    readonly id: string;
    readonly skipCache: boolean;
  };
  readonly returnRawResponse: boolean;
  readonly signal: AbortSignal;
}
const fixture = (
  respond: (options: CapturedOptions) => Promise<Response> = () =>
    Promise.resolve(Response.json(completion())),
  configuration: PrivateDiscoveryConfiguration = config
) => {
  const run = vi.fn(
    (
      _model: string,
      _body: NativeCloudflare.AiModels[PrivateDiscoveryConfiguration["model"]]["inputs"],
      options: CapturedOptions
    ) => respond(options)
  );
  const model = makePrivateDiscoveryModel({
    PRIVATE_DISCOVERY_CONFIG: JSON.stringify(configuration),
    PrivateDiscoveryAI: {
      // SAFETY: The fake implements only the raw-response overload used by this adapter; no provider transport is called.
      run: run as unknown as NativeCloudflare.Ai["run"],
    },
  });
  const beforeDispatch = vi.fn();
  const input = {
    beforeDispatch,
    context: context(),
    signal: new AbortController().signal,
  };
  return { beforeDispatch, input, model, run };
};

describe("private discovery Workers AI boundary", () => {
  it.each([config.model, "@cf/openai/gpt-oss-120b"] as const)(
    "decodes one bounded raw completion for %s with private gateway controls and provenance",
    async (modelName) => {
      const test = fixture(undefined, { ...config, model: modelName });
      const result = await Effect.runPromise(test.model.generate(test.input));
      expect(test.beforeDispatch).toHaveBeenCalledOnce();
      expect(test.run).toHaveBeenCalledOnce();
      expect(test.run.mock.calls[0]?.[0]).toBe(modelName);
      expect(test.run.mock.calls[0]?.[2]).toMatchObject({
        extraHeaders: { "cf-aig-max-attempts": "1" },
        gateway: { collectLog: false, id: config.gatewayId, skipCache: true },
        returnRawResponse: true,
      });
      expect(result.output).toEqual(output);
      expect(result.provenance).toMatchObject({
        model: modelName,
        provider: "cloudflare-workers-ai",
      });
      expect(result.usage).toEqual({
        estimatedCostUsd: 0.00005,
        inputTokens: 100,
        outputTokens: 50,
      });
    }
  );

  it("does not claim or dispatch an unconfigured model", async () => {
    const test = fixture();
    const model = makePrivateDiscoveryModel({});
    const error = await Effect.runPromise(
      Effect.flip(model.generate(test.input))
    );
    expect(error).toMatchObject({
      provenance: null,
      reason: "not_configured",
      usage: null,
    });
    expect(test.beforeDispatch).not.toHaveBeenCalled();
    expect(test.run).not.toHaveBeenCalled();
  });

  it("does not dispatch after the synchronous native claim refuses authority", async () => {
    const test = fixture();
    test.beforeDispatch.mockImplementation(() => {
      throw new Error("Synthetic revoked claim");
    });
    const error = await Effect.runPromise(
      Effect.flip(test.model.generate(test.input))
    );
    expect(error.reason).toBe("outcome_unknown");
    expect(test.run).not.toHaveBeenCalled();
  });

  it("checks UTF-8 context bytes before claiming or sending any data", async () => {
    const test = fixture();
    const input = {
      ...test.input,
      context: {
        ...context(),
        messages: Array.from({ length: 4 }, () => ({
          id: crypto.randomUUID(),
          role: "participant" as const,
          text: "🍅".repeat(1900),
        })),
      },
    };
    const error = await Effect.runPromise(
      Effect.flip(test.model.generate(input))
    );
    expect(error.reason).toBe("context_limit");
    expect(test.beforeDispatch).not.toHaveBeenCalled();
    expect(test.run).not.toHaveBeenCalled();
  });

  it("includes fixed instructions and output schema in the provider payload bound", async () => {
    const test = fixture();
    const input = {
      ...test.input,
      context: {
        ...context(),
        messages: Array.from({ length: 6 }, () => ({
          id: crypto.randomUUID(),
          role: "participant" as const,
          text: "x".repeat(3800),
        })),
      },
    };
    expect(
      new TextEncoder().encode(JSON.stringify(input.context)).byteLength
    ).toBeLessThan(24_576);
    const error = await Effect.runPromise(
      Effect.flip(test.model.generate(input))
    );
    expect(error.reason).toBe("context_limit");
    expect(test.beforeDispatch).not.toHaveBeenCalled();
    expect(test.run).not.toHaveBeenCalled();
  });

  it.each([
    ["unknown top-level output", { ...output, saved: true }],
    [
      "canonical authority on an action",
      {
        ...output,
        proposals: [
          {
            _tag: "ProposeProfileCard",
            basis: "self",
            change: {
              _tag: "AddConfirmedProfileFact",
              fact: { _tag: "NoKnownHardConstraints" },
            },
          },
        ],
      },
    ],
    ["unbounded message", { ...output, message: "x".repeat(2001) }],
    [
      "unbounded actions",
      {
        ...output,
        proposals: Array.from({ length: 4 }, () => ({
          _tag: "ProposeProfileCard",
          change: {
            _tag: "AddConfirmedProfileFact",
            fact: { _tag: "NoKnownHardConstraints" },
          },
        })),
      },
    ],
  ])("rejects %s while retaining known usage", async (_name, invalid) => {
    const test = fixture(() =>
      Promise.resolve(Response.json(completion(invalid)))
    );
    const error = await Effect.runPromise(
      Effect.flip(test.model.generate(test.input))
    );
    expect(error).toMatchObject({
      provenance: { model: config.model },
      reason: "invalid_output",
      usage: { inputTokens: 100, outputTokens: 50 },
    });
    expect(test.run).toHaveBeenCalledOnce();
  });

  it("retains known usage on a provider refusal", async () => {
    const payload = completion();
    const test = fixture(() =>
      Promise.resolve(
        Response.json({
          ...payload,
          choices: [
            {
              finish_reason: "stop",
              message: {
                content: null,
                refusal: "Synthetic refusal",
                role: "assistant",
              },
            },
          ],
        })
      )
    );
    const error = await Effect.runPromise(
      Effect.flip(test.model.generate(test.input))
    );
    expect(error).toMatchObject({
      reason: "refused",
      usage: { inputTokens: 100, outputTokens: 50 },
    });
  });

  it("does not normalize legacy or prose output into a usable completion", async () => {
    const test = fixture(() =>
      Promise.resolve(Response.json({ response: JSON.stringify(output) }))
    );
    const error = await Effect.runPromise(
      Effect.flip(test.model.generate(test.input))
    );
    expect(error.reason).toBe("invalid_output");
    expect(test.run).toHaveBeenCalledOnce();
  });

  it("bounds the raw response stream", async () => {
    const test = fixture(() =>
      Promise.resolve(
        new Response("x".repeat(PRIVATE_DISCOVERY_RESPONSE_BYTES + 1))
      )
    );
    const error = await Effect.runPromise(
      Effect.flip(test.model.generate(test.input))
    );
    expect(error.reason).toBe("invalid_output");
    expect(test.run).toHaveBeenCalledOnce();
  });

  it("returns provider failure without an automatic retry", async () => {
    const test = fixture(() =>
      Promise.resolve(new Response(null, { status: 503 }))
    );
    const error = await Effect.runPromise(
      Effect.flip(test.model.generate(test.input))
    );
    expect(error).toMatchObject({
      provenance: { model: config.model },
      reason: "provider_unavailable",
      usage: null,
    });
    expect(test.run).toHaveBeenCalledOnce();
  });

  it("aborts transport at the deadline and retains an unknown outcome without retry", async () => {
    let aborted = false;
    const test = fixture((options) => {
      const deferred = Promise.withResolvers<Response>();
      options.signal.addEventListener(
        "abort",
        () => {
          aborted = true;
          deferred.reject(new Error("Synthetic aborted transport"));
        },
        { once: true }
      );
      return deferred.promise;
    });
    const error = await Effect.runPromise(
      Effect.flip(test.model.generate(test.input))
    );
    expect(error).toMatchObject({
      provenance: { model: config.model },
      reason: "outcome_unknown",
      usage: null,
    });
    expect(aborted).toBe(true);
    expect(test.run).toHaveBeenCalledOnce();
  });
});

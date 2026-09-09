import type * as NativeCloudflare from "@cloudflare/workers-types";
import { Cause, Effect, Exit, Schema } from "effect";
import { Tool } from "effect/unstable/ai";
import { describe, expect, it, vi } from "vitest";

import {
  makePrivateDiscoveryProviderOutput,
  PrivateDiscoveryContext,
  PrivateDiscoveryOutput,
} from "./private-discovery-model.js";
import { privateDiscoveryInstructions } from "./private-discovery-prompt.js";
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
const proposedCard = (revision: number) =>
  Schema.decodeUnknownSync(PrivateDiscoveryContext.fields.cards.value)({
    change: {
      _tag: "AddConfirmedProfileFact",
      fact: {
        _tag: "FoodPreference",
        label: `Illustrative dish ${revision}`,
        sentiment: "like",
        targetKind: "dish",
      },
    },
    id: crypto.randomUUID(),
    reviewedFact: null,
    revision,
    status: "proposed",
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
  it.each([0, 1, 2])(
    "uses one matching provider schema for %s eligible cards in both request locations",
    async (count) => {
      const test = fixture();
      const cards = Array.from({ length: count }, (_, index) =>
        proposedCard(index)
      );
      const input = { ...test.input, context: { ...context(), cards } };
      await Effect.runPromise(test.model.generate(input));
      const jsonSchema = Tool.getJsonSchemaFromSchema(
        makePrivateDiscoveryProviderOutput(cards)
      );
      expect(test.run).toHaveBeenCalledOnce();
      expect(test.run.mock.calls[0]?.[1]).toMatchObject({
        messages: [
          {
            content: `${privateDiscoveryInstructions}\n\nOutput JSON schema:\n${JSON.stringify(jsonSchema)}`,
            role: "system",
          },
          { content: JSON.stringify(input.context), role: "user" },
        ],
        response_format: { json_schema: jsonSchema, type: "json_schema" },
      });
      expect(jsonSchema).not.toHaveProperty("$defs");
      const decode = Schema.decodeUnknownSync(
        makePrivateDiscoveryProviderOutput(cards)
      );
      const { change } = proposedCard(0);
      expect(
        decode({
          ...output,
          proposals: [{ _tag: "ProposeProfileCard", change }],
        })
      ).toMatchObject({ proposals: [{ _tag: "ProposeProfileCard" }] });
      for (const card of cards) {
        expect(
          decode({
            ...output,
            proposals: [
              { _tag: "ProposeProfileCard", change },
              {
                _tag: "ReviseProposedProfileCard",
                cardId: card.id,
                change,
                expectedRevision: card.revision,
              },
            ],
          })
        ).toMatchObject({ proposals: [{}, { cardId: card.id }] });
      }
      expect(() =>
        decode({
          ...output,
          proposals: [
            {
              _tag: "ReviseProposedProfileCard",
              cardId: "00000000-0000-0000-0000-000000000000",
              change,
              expectedRevision: 0,
            },
          ],
        })
      ).toThrow();
    }
  );

  it.each(["pending", "rejected", "confirmed", "conflict"] as const)(
    "omits %s cards from provider revision choices",
    (status) => {
      const unavailable = { ...proposedCard(0), status };
      const eligible = proposedCard(1);
      const revision = {
        _tag: "ReviseProposedProfileCard",
        cardId: unavailable.id,
        change: unavailable.change,
        expectedRevision: unavailable.revision,
      };
      for (const cards of [[unavailable], [unavailable, eligible]]) {
        expect(() =>
          Schema.decodeUnknownSync(makePrivateDiscoveryProviderOutput(cards))({
            ...output,
            proposals: [revision],
          })
        ).toThrow();
      }
    }
  );

  it("leaves canonical decoding and exact revision authority unchanged", () => {
    const card = proposedCard(2);
    const revision = {
      _tag: "ReviseProposedProfileCard",
      cardId: card.id,
      change: card.change,
      expectedRevision: card.revision + 1,
    };
    const candidate = { ...output, proposals: [revision] };
    expect(Schema.decodeUnknownSync(PrivateDiscoveryOutput)(candidate)).toEqual(
      candidate
    );
    expect(
      Schema.decodeUnknownSync(makePrivateDiscoveryProviderOutput([card]))(
        candidate
      )
    ).toEqual(candidate);
    const canonicalOnly = {
      ...output,
      proposals: [{ ...revision, cardId: crypto.randomUUID() }],
    };
    expect(
      Schema.decodeUnknownSync(PrivateDiscoveryOutput)(canonicalOnly)
    ).toEqual(canonicalOnly);
  });

  it("rejects an oversized 25-card provider request before claiming or dispatching", async () => {
    const test = fixture();
    const input = {
      ...test.input,
      context: {
        ...context(),
        cards: Array.from({ length: 25 }, (_, index) => proposedCard(index)),
        messages: [
          {
            id: crypto.randomUUID(),
            role: "participant" as const,
            text: "x".repeat(2000),
          },
        ],
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

  it.each([config.model, "@cf/openai/gpt-oss-120b"] as const)(
    "decodes one bounded raw completion for %s with private gateway controls and provenance",
    async (modelName) => {
      const test = fixture(undefined, { ...config, model: modelName });
      const result = await Effect.runPromise(test.model.generate(test.input));
      expect(test.beforeDispatch).toHaveBeenCalledOnce();
      expect(test.run).toHaveBeenCalledOnce();
      expect(test.run.mock.calls[0]?.[0]).toBe(modelName);
      const jsonSchema = Tool.getJsonSchemaFromSchema(
        makePrivateDiscoveryProviderOutput(test.input.context.cards)
      );
      const nativeRequest = test.run.mock.calls[0]?.[1];
      expect(nativeRequest).toMatchObject({
        response_format: {
          json_schema: {
            properties: {
              message: expect.any(Object),
              proposals: {
                items: {
                  properties: { _tag: { enum: ["ProposeProfileCard"] } },
                  type: "object",
                },
                type: "array",
              },
              summary: expect.any(Object),
            },
            required: expect.arrayContaining([
              "message",
              "proposals",
              "summary",
            ]),
            type: "object",
          },
        },
      });
      expect(nativeRequest).not.toHaveProperty(
        "response_format.json_schema.name"
      );
      expect(nativeRequest).not.toHaveProperty(
        "response_format.json_schema.schema"
      );
      expect(nativeRequest).not.toHaveProperty(
        "response_format.json_schema.strict"
      );
      expect(test.run.mock.calls[0]?.[1]).toEqual({
        max_tokens: config.maxOutputTokens,
        messages: [
          {
            content: `${privateDiscoveryInstructions}\n\nOutput JSON schema:\n${JSON.stringify(jsonSchema)}`,
            role: "system",
          },
          { content: JSON.stringify(test.input.context), role: "user" },
        ],
        response_format: {
          json_schema: jsonSchema,
          type: "json_schema",
        },
        stream: false,
        temperature: 0,
      });
      expect(test.run.mock.calls[0]?.[2]).toMatchObject({
        extraHeaders: { "cf-aig-max-attempts": "1" },
        gateway: { collectLog: false, id: config.gatewayId, skipCache: true },
        returnRawResponse: true,
      });
      expect(result.output).toEqual(output);
      expect(result.provenance).toMatchObject({
        model: modelName,
        promptVersion: "private-discovery-prompt-v9",
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

  it.each([config.model, "@cf/openai/gpt-oss-120b"] as const)(
    "counts the generated schema in the system message against the %s provider payload bound",
    async (modelName) => {
      const test = fixture(undefined, { ...config, model: modelName });
      const input = {
        ...test.input,
        context: {
          ...context(),
          messages: Array.from({ length: 5 }, () => ({
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
    }
  );

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
      stage: "output_schema",
      usage: { inputTokens: 100, outputTokens: 50 },
    });
    expect(test.run).toHaveBeenCalledOnce();
  });

  it.each([
    "response_body_missing",
    "response_body_read",
    "response_json",
    "response_envelope",
    "incomplete_completion",
    "missing_content",
    "output_json",
    "output_schema",
  ] as const)(
    "classifies %s without retaining private error data",
    async (stage) => {
      const privateValue = `synthetic-private-${crypto.randomUUID()}`;
      const payload = completion();
      const [choice] = payload.choices;
      if (choice === undefined) {
        throw new Error("Expected synthetic completion choice");
      }
      const respond = (): Response => {
        switch (stage) {
          case "response_body_missing": {
            return new Response(null);
          }
          case "response_body_read": {
            return new Response(
              new ReadableStream({
                start(controller) {
                  controller.error(new Error(privateValue));
                },
              })
            );
          }
          case "response_json": {
            return new Response(`{${privateValue}`);
          }
          case "response_envelope": {
            return Response.json({ ...payload, choices: privateValue });
          }
          case "incomplete_completion": {
            return Response.json({
              ...payload,
              choices: [{ ...choice, finish_reason: privateValue }],
            });
          }
          case "missing_content": {
            return Response.json({
              ...payload,
              choices: [
                { ...choice, message: { ...choice.message, content: null } },
              ],
            });
          }
          case "output_json": {
            return Response.json({
              ...payload,
              choices: [
                {
                  ...choice,
                  message: { ...choice.message, content: `{${privateValue}` },
                },
              ],
            });
          }
          case "output_schema": {
            return Response.json(
              completion({
                ...output,
                message: privateValue,
                proposals: [{ _tag: privateValue }],
              })
            );
          }
          default: {
            throw new Error("Unexpected synthetic diagnostic stage");
          }
        }
      };
      const test = fixture(() => Promise.resolve(respond()));
      const input = {
        ...test.input,
        context: { ...test.input.context, summary: privateValue },
      };
      const error = await Effect.runPromise(
        Effect.flip(test.model.generate(input))
      );
      expect(error).toMatchObject({ reason: "invalid_output", stage });
      expect(error).not.toHaveProperty("cause");
      expect(JSON.stringify(error)).not.toContain(privateValue);
      expect(error.message).not.toContain(privateValue);
      expect(error.stack).not.toContain(privateValue);
      expect(test.run).toHaveBeenCalledOnce();
    }
  );

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
    expect(error).toMatchObject({
      reason: "invalid_output",
      stage: "response_envelope",
    });
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
    expect(error).toMatchObject({
      reason: "invalid_output",
      stage: "response_body_limit",
    });
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

  it("aborts transport and cancels a stalled body at the deadline without awaiting cancellation", async () => {
    const cancel = vi.fn(() => Promise.withResolvers<never>().promise);
    const test = fixture(() =>
      Promise.resolve(new Response(new ReadableStream({ cancel })))
    );
    const error = await Effect.runPromise(
      Effect.flip(test.model.generate(test.input))
    );
    expect(error.reason).toBe("outcome_unknown");
    expect(test.run.mock.calls[0]?.[2].signal.aborted).toBe(true);
    expect(cancel).toHaveBeenCalledOnce();
    expect(test.run).toHaveBeenCalledOnce();
  });

  it("cancels a stalled body after participant stop without awaiting cancellation", async () => {
    const reading = Promise.withResolvers<true>();
    const cancel = vi.fn(() => Promise.withResolvers<never>().promise);
    const test = fixture(() =>
      Promise.resolve(
        new Response(
          new ReadableStream(
            { cancel, pull: () => reading.resolve(true) },
            { highWaterMark: 0 }
          )
        )
      )
    );
    const controller = new AbortController();
    const result = Effect.runPromise(
      Effect.flip(
        test.model.generate({ ...test.input, signal: controller.signal })
      )
    );
    await reading.promise;
    controller.abort();
    const error = await result;
    expect(error.reason).toBe("outcome_unknown");
    expect(test.run.mock.calls[0]?.[2].signal.aborted).toBe(true);
    expect(cancel).toHaveBeenCalledOnce();
    expect(test.run).toHaveBeenCalledOnce();
  });

  it("cancels the owned body reader when the calling fiber is interrupted", async () => {
    const reading = Promise.withResolvers<true>();
    const cancel = vi.fn(() => Promise.withResolvers<never>().promise);
    const test = fixture(() =>
      Promise.resolve(
        new Response(
          new ReadableStream(
            { cancel, pull: () => reading.resolve(true) },
            { highWaterMark: 0 }
          )
        )
      )
    );
    const controller = new AbortController();
    const running = Effect.runPromiseExit(test.model.generate(test.input), {
      signal: controller.signal,
    });
    await reading.promise;
    controller.abort();
    const result = await running;
    expect(Exit.isFailure(result) && Cause.hasInterrupts(result.cause)).toBe(
      true
    );
    expect(test.run.mock.calls[0]?.[2].signal.aborted).toBe(true);
    expect(cancel).toHaveBeenCalledOnce();
    expect(test.run).toHaveBeenCalledOnce();
  });
});

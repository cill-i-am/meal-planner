import type * as NativeCloudflare from "@cloudflare/workers-types";
import { Cause, Effect, Exit, Schema } from "effect";
import { Tool } from "effect/unstable/ai";
import { describe, expect, it, vi } from "vitest";

import {
  emptyPrivateDiscoveryContinuity,
  emptyPrivateDiscoveryContinuityUpdates,
} from "./private-discovery-continuity.js";
import {
  makePrivateDiscoveryProviderOutput,
  PrivateDiscoveryContext,
  PrivateDiscoveryTurnIntent,
} from "./private-discovery-model.js";
import { privateDiscoveryInstructions } from "./private-discovery-prompt.js";
import {
  makePrivateDiscoveryModel,
  PRIVATE_DISCOVERY_KIMI_RESPONSE_BYTES,
  PRIVATE_DISCOVERY_RESPONSE_BYTES,
} from "./private-discovery-workers-ai.js";
import type { PrivateDiscoveryConfiguration } from "./private-discovery-workers-ai.js";

const context = () =>
  Schema.decodeUnknownSync(PrivateDiscoveryContext)({
    cards: [],
    continuity: emptyPrivateDiscoveryContinuity(),
    messages: [
      {
        id: crypto.randomUUID(),
        role: "participant",
        text: "I like tomatoes.",
      },
    ],
    profile: { facts: [], version: 0 },
    scope: "ProfileEdit",
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
  model: "@cf/openai/gpt-oss-120b",
  outputUsdPerMillionTokens: 0.6,
  timeoutMs: 1000,
};
const kimiConfig: PrivateDiscoveryConfiguration = {
  ...config,
  inputUsdPerMillionTokens: 0.95,
  maxOutputTokens: 4096,
  model: "@cf/moonshotai/kimi-k2.6",
  outputUsdPerMillionTokens: 4,
};
const output = {
  _tag: "Continue",
  proposals: [],
  updates: {
    ...emptyPrivateDiscoveryContinuityUpdates(),
    notes: [
      {
        detail: "The adult enjoys tomatoes.",
        key: "preparation",
        subject: "Tomato preparation",
      },
    ],
  },
};
const toolRequest = (parameters: Record<string, unknown>) => ({
  parallel_tool_calls: false,
  tool_choice: { function: { name: "submitDiscoveryTurn" }, type: "function" },
  tools: [
    {
      function: {
        description: expect.any(String),
        name: "submitDiscoveryTurn",
        parameters,
        strict: true,
      },
      type: "function",
    },
  ],
});
const completion = (content: Readonly<Record<string, unknown>> = output) => ({
  choices: [
    {
      finish_reason: "tool_calls",
      message: {
        content: null,
        role: "assistant",
        tool_calls: [
          {
            function: {
              arguments: JSON.stringify({ intent: content }),
              name: "submitDiscoveryTurn",
            },
            id: "test-call",
            type: "function",
          },
        ],
      },
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
    "uses one forced tool schema for %s eligible cards",
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
      expect(Object.keys(jsonSchema["properties"] ?? {})).toEqual(["intent"]);
      expect(jsonSchema["required"]).toEqual(["intent"]);
      expect(test.run).toHaveBeenCalledOnce();
      expect(test.run.mock.calls[0]?.[1]).toMatchObject({
        messages: [
          {
            content: privateDiscoveryInstructions,
            role: "system",
          },
          { content: JSON.stringify(input.context), role: "user" },
        ],
        ...toolRequest(jsonSchema),
      });
      expect(jsonSchema).toHaveProperty("$defs.PrivateDiscoveryEvidence");
      expect(jsonSchema).toHaveProperty("$defs.MealFallbackNeedReference");
      const decode = Schema.decodeUnknownSync(
        makePrivateDiscoveryProviderOutput(cards).fields.intent
      );
      const change = { ...proposedCard(0).change, _tag: "AddFact" };
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
        change: { ...unavailable.change, _tag: "AddFact" },
      };
      for (const cards of [[unavailable], [unavailable, eligible]]) {
        expect(() =>
          Schema.decodeUnknownSync(
            makePrivateDiscoveryProviderOutput(cards).fields.intent
          )({
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
      change: { ...card.change, _tag: "AddFact" },
    };
    const candidate = { ...output, proposals: [revision] };
    expect(
      Schema.decodeUnknownSync(PrivateDiscoveryTurnIntent)(candidate)
    ).toEqual(candidate);
    expect(
      Schema.decodeUnknownSync(
        makePrivateDiscoveryProviderOutput([card]).fields.intent
      )(candidate)
    ).toEqual(candidate);
    const canonicalOnly = {
      ...output,
      proposals: [{ ...revision, cardId: crypto.randomUUID() }],
    };
    expect(
      Schema.decodeUnknownSync(PrivateDiscoveryTurnIntent)(canonicalOnly)
    ).toEqual(canonicalOnly);
  });

  it.each([
    { kind: "wrong_name", stage: "tool_call", title: "wrong tool name" },
    { kind: "multiple", stage: "tool_call", title: "multiple tool calls" },
    { kind: "prose", stage: "tool_call", title: "prose alongside a tool call" },
    {
      kind: "foodRestrictions",
      stage: "output_schema",
      title: "missing food restrictions entry",
    },
    {
      kind: "usualMeals",
      stage: "output_schema",
      title: "missing usual meals entry",
    },
    {
      kind: "revision",
      stage: "output_schema",
      title: "model supplied revision bookkeeping",
    },
  ])(
    "rejects $title without repairing or retrying",
    async ({ kind, stage }) => {
      const payload = completion();
      const [choice] = payload.choices;
      if (choice === undefined) {
        throw new Error("Expected fixture choice");
      }
      const [call] = choice.message.tool_calls;
      if (call === undefined) {
        throw new Error("Expected fixture tool call");
      }
      let message: Record<string, unknown> = choice.message;
      switch (kind) {
        case "wrong_name": {
          message = {
            ...choice.message,
            tool_calls: [
              { ...call, function: { ...call.function, name: "saveProfile" } },
            ],
          };
          break;
        }
        case "multiple": {
          message = {
            ...choice.message,
            tool_calls: [call, { ...call, id: "second-call" }],
          };
          break;
        }
        case "prose": {
          message = { ...choice.message, content: "I saved your profile." };
          break;
        }
        default: {
          const intent: Record<string, unknown> = { ...output };
          if (kind === "revision") {
            intent["proposals"] = [
              {
                _tag: "ReviseProposedProfileCard",
                cardId: crypto.randomUUID(),
                change: {
                  _tag: "AddFact",
                  fact: { _tag: "NoKnownHardConstraints" },
                },
                expectedRevision: 0,
              },
            ];
          } else {
            intent["updates"] = {
              ...output.updates,
              coverage:
                kind === "foodRestrictions"
                  ? { usualMeals: null }
                  : { foodRestrictions: null },
            };
          }
          message = {
            ...choice.message,
            tool_calls: [
              {
                ...call,
                function: {
                  arguments: JSON.stringify({ intent }),
                  name: "submitDiscoveryTurn",
                },
              },
            ],
          };
        }
      }
      const test = fixture(() =>
        Promise.resolve(
          Response.json({ ...payload, choices: [{ ...choice, message }] })
        )
      );
      const failure = await Effect.runPromise(
        Effect.flip(test.model.generate(test.input))
      );
      expect(failure).toMatchObject({ reason: "invalid_output", stage });
      expect(test.run).toHaveBeenCalledOnce();
    }
  );

  it("rejects an oversized 25-card provider request before claiming or dispatching", async () => {
    const test = fixture();
    const input = {
      ...test.input,
      context: {
        ...context(),
        cards: Array.from({ length: 25 }, (_, index) => proposedCard(index)),
        messages: Array.from({ length: 3 }, () => ({
          id: crypto.randomUUID(),
          role: "participant" as const,
          text: "x".repeat(3000),
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
    {
      modelName: config.model,
      sampling: { temperature: 1, top_p: 1 },
    },
    {
      modelName: "@cf/openai/gpt-oss-120b",
      sampling: { temperature: 1, top_p: 1 },
    },
  ] as const)(
    "decodes one bounded raw completion for $modelName with private gateway controls and provenance",
    async ({ modelName, sampling }) => {
      const test = fixture(undefined, { ...config, model: modelName });
      const result = await Effect.runPromise(test.model.generate(test.input));
      expect(test.beforeDispatch).toHaveBeenCalledOnce();
      expect(test.run).toHaveBeenCalledOnce();
      expect(test.run.mock.calls[0]?.[0]).toBe(modelName);
      const jsonSchema = Tool.getJsonSchemaFromSchema(
        makePrivateDiscoveryProviderOutput(test.input.context.cards)
      );
      const nativeRequest = test.run.mock.calls[0]?.[1];
      expect(nativeRequest).not.toHaveProperty("response_format");
      expect(test.run.mock.calls[0]?.[1]).toEqual({
        max_tokens: config.maxOutputTokens,
        messages: [
          {
            content: privateDiscoveryInstructions,
            role: "system",
          },
          { content: JSON.stringify(test.input.context), role: "user" },
        ],
        ...toolRequest(jsonSchema),
        stream: false,
        ...sampling,
      });
      expect(test.run.mock.calls[0]?.[2]).toMatchObject({
        extraHeaders: { "cf-aig-max-attempts": "1" },
        gateway: { collectLog: false, id: config.gatewayId, skipCache: true },
        returnRawResponse: true,
      });
      expect(result.output).toEqual({ intent: output });
      expect(result.provenance).toMatchObject({
        model: modelName,
        policyVersion: "private-discovery-policy-v6",
        promptVersion: "private-discovery-prompt-v25",
        provider: "cloudflare-workers-ai",
      });
      expect(result.usage).toEqual({
        estimatedCostUsd: 0.00005,
        inputTokens: 100,
        outputTokens: 50,
      });
    }
  );

  it.each([0, 1, 2])(
    "sends the exact Kimi forced-tool request with %s eligible cards and retains configured-rate usage",
    async (count) => {
      const payload = completion();
      const reasoning = "Synthetic reasoning must stay outside the result.";
      const test = fixture(
        () =>
          Promise.resolve(
            Response.json({
              ...payload,
              choices: payload.choices.map((choice) => ({
                ...choice,
                message: { ...choice.message, reasoning },
              })),
              usage: {
                ...payload.usage,
                completion_tokens_details: { reasoning_tokens: 30 },
                prompt_tokens_details: { cached_tokens: 80 },
              },
            })
          ),
        kimiConfig
      );
      const cards = Array.from({ length: count }, (_, index) =>
        proposedCard(index)
      );
      const input = { ...test.input, context: { ...context(), cards } };
      const result = await Effect.runPromise(test.model.generate(input));
      const jsonSchema = Tool.getJsonSchemaFromSchema(
        makePrivateDiscoveryProviderOutput(cards)
      );
      expect(test.beforeDispatch).toHaveBeenCalledOnce();
      expect(test.run).toHaveBeenCalledOnce();
      expect(test.run.mock.calls[0]?.[0]).toBe(kimiConfig.model);
      expect(test.run.mock.calls[0]?.[1]).toEqual({
        chat_template_kwargs: { thinking: true },
        max_completion_tokens: 4096,
        messages: [
          {
            content: privateDiscoveryInstructions,
            role: "system",
          },
          { content: JSON.stringify(input.context), role: "user" },
        ],
        n: 1,
        ...toolRequest(jsonSchema),
        stream: false,
        temperature: 1,
        top_p: 0.95,
      });
      expect(test.run.mock.calls[0]?.[2]).toMatchObject({
        extraHeaders: { "cf-aig-max-attempts": "1" },
        gateway: {
          collectLog: false,
          id: kimiConfig.gatewayId,
          skipCache: true,
        },
        returnRawResponse: true,
      });
      expect(result.output).toEqual({ intent: output });
      expect(result.provenance).toMatchObject({
        model: kimiConfig.model,
        policyVersion: "private-discovery-policy-v6",
        promptVersion: "private-discovery-prompt-v25",
        provider: "cloudflare-workers-ai",
      });
      expect(result.usage).toEqual({
        estimatedCostUsd: 0.000295,
        inputTokens: 100,
        outputTokens: 50,
      });
      expect(JSON.stringify(result)).not.toContain(reasoning);
    }
  );

  it("retains unavailable Kimi usage as unknown", async () => {
    const test = fixture(
      () => Promise.resolve(Response.json({ choices: completion().choices })),
      kimiConfig
    );
    const result = await Effect.runPromise(test.model.generate(test.input));
    expect(result.usage).toEqual({
      estimatedCostUsd: null,
      inputTokens: null,
      outputTokens: null,
    });
    expect(test.run).toHaveBeenCalledOnce();
  });

  it.each([
    { ...config, maxOutputTokens: 4096, timeoutMs: 120_000 },
    {
      ...config,
      maxOutputTokens: 4096,
      model: "@cf/openai/gpt-oss-120b",
      timeoutMs: 120_000,
    },
    { ...kimiConfig, maxOutputTokens: 65_536, timeoutMs: 900_000 },
  ] as const)(
    "accepts the maximum token and deadline configuration for $model",
    async (configuration) => {
      const test = fixture(undefined, configuration);
      const result = await Effect.runPromise(test.model.generate(test.input));
      expect(test.run).toHaveBeenCalledOnce();
      expect(test.run.mock.calls[0]?.[1]).toHaveProperty(
        configuration.model === kimiConfig.model
          ? "max_completion_tokens"
          : "max_tokens",
        configuration.maxOutputTokens
      );
      expect(result.output).toEqual({ intent: output });
    }
  );

  it.each([
    { ...config, maxOutputTokens: 4097 },
    { ...config, timeoutMs: 120_001 },
    {
      ...config,
      maxOutputTokens: 4097,
      model: "@cf/openai/gpt-oss-120b",
    },
    {
      ...config,
      model: "@cf/openai/gpt-oss-120b",
      timeoutMs: 120_001,
    },
    { ...kimiConfig, maxOutputTokens: 65_537 },
    { ...kimiConfig, timeoutMs: 900_001 },
  ] as const)(
    "rejects $model token=$maxOutputTokens deadline=$timeoutMs configuration before dispatch",
    async (configuration) => {
      const test = fixture(undefined, configuration);
      const error = await Effect.runPromise(
        Effect.flip(test.model.generate(test.input))
      );
      expect(error.reason).toBe("not_configured");
      expect(test.beforeDispatch).not.toHaveBeenCalled();
      expect(test.run).not.toHaveBeenCalled();
    }
  );

  it("accepts a larger Kimi envelope while excluding legacy reasoning content and counting completion usage once", async () => {
    const payload = completion();
    const reasoningContent = "🧠".repeat(20_000);
    const encoded = JSON.stringify({
      ...payload,
      choices: payload.choices.map((choice) => ({
        ...choice,
        message: { ...choice.message, reasoning_content: reasoningContent },
      })),
      usage: {
        ...payload.usage,
        completion_tokens_details: { reasoning_tokens: 30 },
      },
    });
    expect(new TextEncoder().encode(encoded).byteLength).toBeGreaterThan(
      PRIVATE_DISCOVERY_RESPONSE_BYTES
    );
    const test = fixture(() => Promise.resolve(new Response(encoded)), {
      ...kimiConfig,
      maxOutputTokens: 65_536,
      timeoutMs: 900_000,
    });
    const result = await Effect.runPromise(test.model.generate(test.input));
    expect(test.run).toHaveBeenCalledOnce();
    expect(result.output).toEqual({ intent: output });
    expect(result.usage).toEqual({
      estimatedCostUsd: 0.000295,
      inputTokens: 100,
      outputTokens: 50,
    });
    expect(JSON.stringify(result)).not.toContain("reasoning_content");
    expect(JSON.stringify(result)).not.toContain(reasoningContent);
  });

  it.each([
    { content: "not JSON", finishReason: "tool_calls", stage: "output_json" },
    {
      content: JSON.stringify({ intent: { ...output, saved: true } }),
      finishReason: "tool_calls",
      stage: "output_schema",
    },
    {
      content: JSON.stringify(output),
      finishReason: "length",
      stage: "incomplete_completion",
    },
    { content: null, finishReason: "tool_calls", stage: "tool_call" },
  ])(
    "rejects Kimi content at $stage without using reasoning or repair",
    async ({ content, finishReason, stage }) => {
      const reasoning = "Synthetic reasoning is not final output.";
      const test = fixture(
        () =>
          Promise.resolve(
            Response.json({
              ...completion(),
              choices: [
                {
                  finish_reason: finishReason,
                  message: {
                    content: null,
                    reasoning,
                    role: "assistant",
                    tool_calls:
                      content === null
                        ? []
                        : [
                            {
                              function: {
                                arguments: content,
                                name: "submitDiscoveryTurn",
                              },
                              id: "test-call",
                              type: "function",
                            },
                          ],
                  },
                },
              ],
            })
          ),
        kimiConfig
      );
      const error = await Effect.runPromise(
        Effect.flip(test.model.generate(test.input))
      );
      expect(error).toMatchObject({
        reason: "invalid_output",
        stage,
        usage: { inputTokens: 100, outputTokens: 50 },
      });
      expect(test.run).toHaveBeenCalledOnce();
      expect(JSON.stringify(error)).not.toContain(reasoning);
    }
  );

  it("bounds the Kimi request including its embedded schema before dispatch", async () => {
    const test = fixture(undefined, kimiConfig);
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
      "the superseded free-text output contract",
      { message: "A reply", proposals: [], summary: "A summary" },
    ],
    [
      "the superseded additions/revisions contract",
      {
        ...output,
        updates: { additions: output.updates, revisions: [] },
      },
    ],
    [
      "unknown continuity note fields",
      {
        ...output,
        updates: {
          ...output.updates,
          notes: [{ ...output.updates.notes[0], actor: "forbidden" }],
        },
      },
    ],
    [
      "the retired model-owned Review response",
      {
        ...output,
        reply: { _tag: "Review", reason: "cards_exist", text: "Review." },
      },
    ],
    [
      "canonical authority on an action",
      {
        ...output,
        proposals: [
          {
            _tag: "ProposeProfileCard",
            basis: "self",
            change: {
              _tag: "AddFact",
              fact: { _tag: "NoKnownHardConstraints" },
            },
          },
        ],
      },
    ],
    [
      "removed model reply text",
      {
        ...output,
        reply: {
          _tag: "Continue",
          text: "A model-authored claim.",
        },
      },
    ],
    [
      "unbounded unresolved question",
      {
        ...output,
        updates: {
          ...output.updates,
          notes: [{ ...output.updates.notes[0], question: "x".repeat(2001) }],
        },
      },
    ],
    [
      "unbounded actions",
      {
        ...output,
        proposals: Array.from({ length: 4 }, () => ({
          _tag: "ProposeProfileCard",
          change: {
            _tag: "AddFact",
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
    "tool_call",
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
          case "tool_call": {
            return Response.json({
              ...payload,
              choices: [
                { ...choice, message: { ...choice.message, tool_calls: [] } },
              ],
            });
          }
          case "output_json": {
            return Response.json({
              ...payload,
              choices: [
                {
                  ...choice,
                  message: {
                    ...choice.message,
                    tool_calls: [
                      {
                        function: {
                          arguments: `{${privateValue}`,
                          name: "submitDiscoveryTurn",
                        },
                        id: "test-call",
                        type: "function",
                      },
                    ],
                  },
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
        context: {
          ...test.input.context,
          continuity: {
            ...emptyPrivateDiscoveryContinuity(),
            notes: [
              {
                detail: privateValue,
                key: "private-context",
                subject: "Private context",
              },
            ],
          },
        },
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

  it.each([config, kimiConfig])(
    "retains known $model usage on a provider refusal",
    async (configuration) => {
      const payload = completion();
      const test = fixture(
        () =>
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
          ),
        configuration
      );
      const error = await Effect.runPromise(
        Effect.flip(test.model.generate(test.input))
      );
      expect(error).toMatchObject({
        reason: "refused",
        usage: { inputTokens: 100, outputTokens: 50 },
      });
    }
  );

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

  it.each([
    { configuration: config, maximumBytes: PRIVATE_DISCOVERY_RESPONSE_BYTES },
    {
      configuration: { ...config, model: "@cf/openai/gpt-oss-120b" },
      maximumBytes: PRIVATE_DISCOVERY_RESPONSE_BYTES,
    },
    {
      configuration: kimiConfig,
      maximumBytes: PRIVATE_DISCOVERY_KIMI_RESPONSE_BYTES,
    },
  ] as const)(
    "bounds the whole $configuration.model response stream including unused reasoning metadata",
    async ({ configuration, maximumBytes }) => {
      const payload = completion();
      const test = fixture(
        () =>
          Promise.resolve(
            Response.json({
              ...payload,
              choices: payload.choices.map((choice) => ({
                ...choice,
                message: {
                  ...choice.message,
                  reasoning_content: "x".repeat(maximumBytes),
                },
              })),
            })
          ),
        configuration
      );
      const error = await Effect.runPromise(
        Effect.flip(test.model.generate(test.input))
      );
      expect(error).toMatchObject({
        reason: "invalid_output",
        stage: "response_body_limit",
        usage: null,
      });
      expect(test.run).toHaveBeenCalledOnce();
    }
  );

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

  it.each([config, kimiConfig])(
    "aborts $model transport at the deadline and retains an unknown outcome without retry",
    async (configuration) => {
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
      }, configuration);
      const error = await Effect.runPromise(
        Effect.flip(test.model.generate(test.input))
      );
      expect(error).toMatchObject({
        provenance: { model: configuration.model },
        reason: "outcome_unknown",
        usage: null,
      });
      expect(aborted).toBe(true);
      expect(test.run).toHaveBeenCalledOnce();
    }
  );

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

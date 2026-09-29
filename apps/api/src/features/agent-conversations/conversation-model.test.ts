import { ConversationScope } from "@meal-planner/agent-conversations-api";
import type { CloudflareBindingConfig } from "@tanstack/ai-cloudflare";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { responsesToolSse } from "../../test/cloudflare-responses.test-fixture.js";
import { encodeKimiCompletion } from "../private-output/private-discovery-kimi-stream.test-fixtures.js";
import {
  ConversationModelFailure,
  selectConversationModelAdapterConfig,
  streamConversationTurn,
} from "./conversation-model.js";
import {
  ConversationCanonicalContext,
  WorkersAIConversationModelConfig,
} from "./conversation.contract.js";

const accountId = "a".repeat(32);
const apiKey = "local-test-token";
const directConfig = Schema.decodeUnknownSync(WorkersAIConversationModelConfig)(
  {
    gatewayId: null,
    maxOutputTokens: 4096,
    model: "@cf/openai/gpt-oss-120b",
    timeoutMs: 120_000,
  }
);
const gatewayConfig = Schema.decodeUnknownSync(
  WorkersAIConversationModelConfig
)({
  ...directConfig,
  gatewayId: "existing-gateway",
});
const setupContext = Schema.decodeUnknownSync(ConversationCanonicalContext)({
  family: null,
  people: [],
  plan: null,
  planningContent: null,
  profiles: [],
  setupAccountDisplayName: "Morgan",
});
const familyContext = Schema.decodeUnknownSync(ConversationCanonicalContext)({
  family: {
    canManage: true,
    createdAtEpochMs: 1,
    id: "family-test",
    name: "The Table",
    setup: { completedAtEpochMs: 1, status: "complete" },
    slug: "the-table",
    updatedAtEpochMs: 1,
    version: 1,
  },
  people: [],
  plan: null,
  planningContent: null,
  profiles: [],
  setupAccountDisplayName: null,
});
interface CapturedRequestBody {
  readonly tools: readonly {
    readonly function: { readonly parameters: unknown };
  }[];
}

describe("conversation model transport", () => {
  it("selects direct REST only with complete server credentials", () => {
    expect(
      selectConversationModelAdapterConfig(
        { CLOUDFLARE_ACCOUNT_ID: accountId, CLOUDFLARE_API_TOKEN: apiKey },
        directConfig
      )
    ).toEqual({ accountId, apiKey });
    expect(
      selectConversationModelAdapterConfig(
        { CLOUDFLARE_ACCOUNT_ID: accountId },
        directConfig
      )
    ).toBeUndefined();
    expect(
      selectConversationModelAdapterConfig(
        { CLOUDFLARE_ACCOUNT_ID: "invalid", CLOUDFLARE_API_TOKEN: apiKey },
        directConfig
      )
    ).toBeUndefined();
    expect(
      selectConversationModelAdapterConfig(
        { CLOUDFLARE_ACCOUNT_ID: accountId, CLOUDFLARE_API_TOKEN: " " },
        directConfig
      )
    ).toBeUndefined();
  });

  it("uses a configured gateway for REST and gives the native binding precedence", () => {
    const rest = selectConversationModelAdapterConfig(
      { CLOUDFLARE_ACCOUNT_ID: accountId, CLOUDFLARE_API_TOKEN: apiKey },
      gatewayConfig
    );
    expect(rest).toMatchObject({
      accountId,
      gateway: { id: "existing-gateway", skipCache: true },
    });

    // Only identity is observed here; the provider is never invoked.
    const binding = {} as CloudflareBindingConfig["binding"];
    const native = selectConversationModelAdapterConfig(
      {
        CLOUDFLARE_ACCOUNT_ID: accountId,
        CLOUDFLARE_API_TOKEN: apiKey,
        ConversationAI: binding,
      },
      gatewayConfig
    );
    expect(native).toMatchObject({
      binding,
      gateway: { id: "existing-gateway" },
    });
    expect(
      selectConversationModelAdapterConfig(
        {
          CLOUDFLARE_ACCOUNT_ID: accountId,
          CLOUDFLARE_API_TOKEN: apiKey,
          ConversationAI: binding,
        },
        directConfig
      )
    ).toBeUndefined();
  });

  it("fails closed before a model call when REST credentials are incomplete", () => {
    expect(() =>
      streamConversationTurn({
        accept: () => ({ messageId: "unreachable", text: "unreachable" }),
        context: setupContext,
        controller: new AbortController(),
        environment: {
          AGENT_CONVERSATION_CONFIG: JSON.stringify(directConfig),
          CLOUDFLARE_ACCOUNT_ID: accountId,
        },
        fail: () => {
          throw new Error("Unexpected provider call");
        },
        focusPersonId: null,
        foodAnswer: null,
        messages: [],
        runId: "run-local-test",
        scope: { _tag: "AccountPrivateSetup" },
        threadId: "thread-local-test",
      })
    ).toThrowError(ConversationModelFailure);
  });

  it("offers only setup blocks and rejects invented family tool arguments", async () => {
    let requestBody: unknown;
    const invalidArguments = {
      blocks: [
        {
          familyName: "Cedar Table",
          members: [{ name: "Morgan", role: "parent" }],
          type: "family",
        },
      ],
      reply: "Your family has been set up.",
    };
    const response = new Response(
      encodeKimiCompletion({
        choices: [
          {
            finish_reason: "tool_calls",
            message: {
              content: null,
              role: "assistant",
              tool_calls: [
                {
                  function: {
                    arguments: JSON.stringify(invalidArguments),
                    name: "submitConversationTurn",
                  },
                  id: "invalid-family-tool",
                  type: "function",
                },
              ],
            },
          },
        ],
      }),
      { headers: { "content-type": "text/event-stream" } }
    );
    // The installed adapter calls only `run`; the provider remains local to this test.
    const binding = {
      run: (_model: string, body: CapturedRequestBody) => {
        requestBody = body;
        return Promise.resolve(response);
      },
    } as CloudflareBindingConfig["binding"];
    let accepted = 0;
    let failure: ConversationModelFailure | undefined;
    const stream = streamConversationTurn({
      accept: () => {
        accepted += 1;
        return { messageId: "unexpected", text: "unexpected" };
      },
      context: setupContext,
      controller: new AbortController(),
      environment: {
        AGENT_CONVERSATION_CONFIG: JSON.stringify(gatewayConfig),
        ConversationAI: binding,
      },
      fail: (reason) => {
        failure = reason;
      },
      focusPersonId: null,
      foodAnswer: null,
      messages: [{ content: "We are a family of two.", role: "user" }],
      runId: "run-invalid-family-tool",
      scope: { _tag: "AccountPrivateSetup" },
      threadId: "thread-invalid-family-tool",
    });
    let thrown: unknown;
    try {
      for await (const _chunk of stream) {
        // All model chunks are withheld until the reviewed tool is accepted.
      }
    } catch (error) {
      thrown = error;
    }
    expect(accepted).toBe(0);
    expect(failure ?? thrown).toMatchObject({ reason: "invalid_output" });
    const request = Schema.decodeUnknownSync(
      Schema.Struct({
        tools: Schema.Array(
          Schema.Struct({
            function: Schema.Struct({ parameters: Schema.Unknown }),
          })
        ),
      })
    )(requestBody);
    const toolSchema = JSON.stringify(request.tools[0]?.function.parameters);
    expect(toolSchema).toContain("RosterProposal");
    expect(toolSchema).toContain("Question");
    expect(toolSchema).not.toContain("PlanChangeProposal");
    expect(toolSchema).not.toContain("PersonFactProposal");
    expect(toolSchema).not.toContain("RoutineProposal");
    expect(toolSchema).not.toContain("PlanningContentProposal");
    expect(toolSchema).not.toContain("PlanScheduleProposal");
    expect(toolSchema).not.toContain("RecipeDetails");
  });

  it("uses Cloudflare Responses with bounded private setup tool and no provider retention", async () => {
    const config = {
      gatewayId: "default",
      maxOutputTokens: 8192,
      model: "openai/gpt-6-luna",
      provider: "cloudflare-responses",
      timeoutMs: 120_000,
    };
    const question = {
      blocks: [
        {
          _tag: "Question",
          foodTopic: null,
          prompt: "What name should I use for your family?",
          targetPersonId: null,
        },
      ],
      reply: "I can prepare a roster after you share a family name.",
    };
    const ProviderRequest = Schema.Struct({
      instructions: Schema.String,
      max_output_tokens: Schema.Number,
      model: Schema.String,
      parallel_tool_calls: Schema.Boolean,
      reasoning: Schema.Struct({ effort: Schema.String }),
      store: Schema.Boolean,
      stream: Schema.Boolean,
      tool_choice: Schema.Struct({ name: Schema.String, type: Schema.String }),
      tools: Schema.Array(
        Schema.Struct({
          name: Schema.String,
          parameters: Schema.Unknown,
          strict: Schema.Boolean,
        })
      ),
    });
    let providerRequest: typeof ProviderRequest.Type | undefined;
    let providerURL: string | undefined;
    let gatewayId: string | null = null;
    let collectLog: string | null = null;
    let skipCache: string | null = null;
    const fakeFetch: typeof fetch = async (input, init) => {
      const request = new Request(input, init);
      providerURL = request.url;
      gatewayId = request.headers.get("cf-aig-gateway-id");
      collectLog = request.headers.get("cf-aig-collect-log");
      skipCache = request.headers.get("cf-aig-skip-cache");
      providerRequest = Schema.decodeUnknownSync(ProviderRequest)(
        JSON.parse(await request.text())
      );
      return new Response(responsesToolSse(JSON.stringify(question)), {
        headers: { "content-type": "text/event-stream" },
      });
    };
    let accepted = 0;
    let failed: ConversationModelFailure | undefined;
    const stream = streamConversationTurn({
      accept: (value) => {
        accepted += 1;
        expect(value).toEqual(question);
        return { messageId: "saved-reply", text: value.reply };
      },
      context: setupContext,
      controller: new AbortController(),
      environment: {
        AGENT_CONVERSATION_CONFIG: JSON.stringify(config),
        CLOUDFLARE_ACCOUNT_ID: accountId,
        CLOUDFLARE_API_TOKEN: apiKey,
      },
      fail: (reason) => {
        failed = reason;
      },
      focusPersonId: null,
      foodAnswer: null,
      messages: [{ content: "Please help me set up my family.", role: "user" }],
      responsesFetch: fakeFetch,
      runId: "run-responses-local-test",
      scope: { _tag: "AccountPrivateSetup" },
      threadId: "thread-responses-local-test",
    });
    const chunks = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    expect(failed).toBeUndefined();
    expect(accepted).toBe(1);
    expect(chunks).toContainEqual(
      expect.objectContaining({
        delta: question.reply,
        type: "TEXT_MESSAGE_CONTENT",
      })
    );
    expect(providerURL).toBe(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1/responses`
    );
    expect(gatewayId).toBe("default");
    expect(collectLog).toBe("false");
    expect(skipCache).toBe("true");
    expect(providerRequest).toMatchObject({
      max_output_tokens: 8192,
      model: "openai/gpt-6-luna",
      parallel_tool_calls: false,
      reasoning: { effort: "medium" },
      store: false,
      stream: true,
      tool_choice: { name: "submitConversationTurn", type: "function" },
    });
    expect(providerRequest?.instructions).toContain(
      '"setupAccountDisplayName":"Morgan"'
    );
    expect(providerRequest?.instructions).toContain(
      "ask only for a family name"
    );
    const schema = JSON.stringify(providerRequest?.tools[0]?.parameters);
    expect(schema).toContain("Question");
    expect(schema).toContain("RosterProposal");
    expect(schema).not.toContain("PlanChangeProposal");
  });

  it("keeps the full shared tool schema non-strict when it exceeds Responses strict subset", async () => {
    const question = {
      blocks: [
        {
          _tag: "Question",
          foodTopic: null,
          prompt: "What food would you like to explore?",
          targetPersonId: null,
        },
      ],
      reply: "I have a food question for your review.",
    };
    let strict: boolean | undefined;
    let parameters: unknown;
    const fakeFetch: typeof fetch = async (input, init) => {
      const request = new Request(input, init);
      const body = Schema.decodeUnknownSync(
        Schema.Struct({
          instructions: Schema.String,
          tools: Schema.Array(
            Schema.Struct({
              parameters: Schema.Unknown,
              strict: Schema.Boolean,
            })
          ),
        })
      )(JSON.parse(await request.text()));
      strict = body.tools[0]?.strict;
      expect(body.instructions).toContain('"setupAccountDisplayName":null');
      expect(body.instructions).not.toContain("Morgan");
      parameters = body.tools[0]?.parameters;
      return new Response(responsesToolSse(JSON.stringify(question)), {
        headers: { "content-type": "text/event-stream" },
      });
    };
    let accepted = 0;
    const stream = streamConversationTurn({
      accept: (value) => {
        accepted += 1;
        expect(value).toEqual(question);
        return { messageId: "shared-reply", text: value.reply };
      },
      context: { ...familyContext, setupAccountDisplayName: "Morgan" },
      controller: new AbortController(),
      environment: {
        AGENT_CONVERSATION_CONFIG: JSON.stringify({
          gatewayId: "default",
          maxOutputTokens: 8192,
          model: "openai/gpt-6-luna",
          provider: "cloudflare-responses",
          timeoutMs: 120_000,
        }),
        CLOUDFLARE_ACCOUNT_ID: accountId,
        CLOUDFLARE_API_TOKEN: apiKey,
      },
      fail: (reason) => {
        throw reason;
      },
      focusPersonId: null,
      foodAnswer: null,
      messages: [{ content: "Can we talk about dinners?", role: "user" }],
      responsesFetch: fakeFetch,
      runId: "run-shared-responses-local-test",
      scope: Schema.decodeUnknownSync(ConversationScope)({
        _tag: "FamilyShared",
        familyId: "family-test",
      }),
      threadId: "thread-shared-responses-local-test",
    });
    for await (const _chunk of stream) {
      // Consume the reviewed reply through the same chat loop as the UI.
    }
    expect(accepted).toBe(1);
    expect(strict).toBe(false);
    const schema = JSON.stringify(parameters);
    expect(schema).toContain("PlanScheduleProposal");
    expect(schema).toContain("PersonFactProposal");
  });
});

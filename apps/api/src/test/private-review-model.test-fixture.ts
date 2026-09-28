import { Schema } from "effect";
import { Response as LocalResponse } from "miniflare";

import { emptyPrivateDiscoveryContinuityUpdates } from "../features/private-output/private-discovery-continuity.js";
import { encodeKimiCompletion } from "../features/private-output/private-discovery-kimi-stream.test-fixtures.js";
import { PrivateDiscoveryContext } from "../features/private-output/private-discovery-model.js";
import type { DiscoveryProfileCardChange } from "../features/private-output/private-discovery-model.js";

export const privateReviewModelConfiguration = JSON.stringify({
  gatewayId: "synthetic-local-only",
  inputUsdPerMillionTokens: 1,
  maxOutputTokens: 1000,
  model: "@cf/moonshotai/kimi-k2.6",
  outputUsdPerMillionTokens: 2,
  timeoutMs: 5000,
});

const ModelRequest = Schema.Struct({
  body: Schema.Struct({
    messages: Schema.Array(Schema.Struct({ content: Schema.String })),
  }),
  model: Schema.Literal("@cf/moonshotai/kimi-k2.6"),
});
const preference = (label: string) => ({
  _tag: "FoodPreference" as const,
  label,
  sentiment: "like" as const,
  targetKind: "ingredient" as const,
});

/** Only the external model transport is synthetic; the app still validates and confirms its proposal. */
export const privateReviewModelResponse = async (
  request: Pick<Request, "url" | "json">
) => {
  if (request.url !== "https://private-model.test/run") {
    throw new Error("External network is forbidden in browser model tests");
  }
  const input = Schema.decodeUnknownSync(ModelRequest)(await request.json());
  const context = Schema.decodeUnknownSync(
    Schema.fromJsonString(PrivateDiscoveryContext)
  )(input.body.messages[1]?.content);
  const latest = context.messages.at(-1);
  if (context.scope !== "ProfileEdit" || latest?.role !== "participant") {
    throw new Error("Expected a fresh private profile review message");
  }

  let change: DiscoveryProfileCardChange;
  if (
    latest.text === "I like tomatoes." &&
    context.messages.length === 1 &&
    context.profile.facts.length === 0
  ) {
    change = { _tag: "AddFact", fact: preference("Tomatoes") };
  } else if (
    latest.text === "I prefer peas now." &&
    context.messages.length === 1 &&
    context.profile.facts.length === 1 &&
    context.profile.facts[0]?.standing._tag === "confirmed" &&
    context.profile.facts[0]?.value._tag === "FoodPreference" &&
    context.profile.facts[0].value.label === "Carrots"
  ) {
    change = {
      _tag: "ReplaceFact",
      fact: preference("Peas"),
      factId: context.profile.facts[0].id,
    };
  } else {
    throw new Error("Unexpected synthetic private review context");
  }

  return new LocalResponse(
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
                  arguments: JSON.stringify({
                    intent: {
                      _tag: "Continue",
                      proposals: [{ _tag: "ProposeProfileCard", change }],
                      updates: emptyPrivateDiscoveryContinuityUpdates(),
                    },
                  }),
                  name: "submitDiscoveryTurn",
                },
                id: "synthetic-browser-review",
                type: "function",
              },
            ],
          },
        },
      ],
      usage: { completion_tokens: 20, prompt_tokens: 100 },
    }),
    { headers: { "content-type": "text/event-stream" } }
  );
};

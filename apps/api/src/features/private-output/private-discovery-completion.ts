import { Schema } from "effect";

const TokenCount = Schema.Int.pipe(
  Schema.check(Schema.isGreaterThanOrEqualTo(0))
);
export const PrivateDiscoveryProviderUsage = Schema.Struct({
  completion_tokens: TokenCount,
  prompt_tokens: TokenCount,
});
export const PrivateDiscoveryCompletion = Schema.Struct({
  choices: Schema.Array(
    Schema.Struct({
      finish_reason: Schema.String,
      message: Schema.Struct({
        content: Schema.optionalKey(Schema.NullOr(Schema.String)),
        refusal: Schema.optionalKey(Schema.NullOr(Schema.String)),
        role: Schema.Literal("assistant"),
        tool_calls: Schema.optionalKey(
          Schema.Array(
            Schema.Struct({
              function: Schema.Struct({
                arguments: Schema.String,
                name: Schema.String,
              }),
              id: Schema.String,
              type: Schema.Literal("function"),
            })
          )
        ),
      }),
    })
  ).pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(1))),
  usage: Schema.optionalKey(PrivateDiscoveryProviderUsage),
});

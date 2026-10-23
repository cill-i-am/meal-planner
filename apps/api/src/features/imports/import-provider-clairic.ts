import { Effect, Option, Schema } from "effect";

import type {
  ClairicEvidenceText,
  ClairicSpanEncoding,
} from "./import-clairic-evidence.js";
import {
  assembleClairicEvidenceText,
  resolveClairicEvidenceSpan,
} from "./import-clairic-evidence.js";
import { normalizeClairicRecipePhrases } from "./import-clairic-normalization.js";
import type { ImportCorrelationId } from "./import-observability.js";
import type { ProviderDispatchGate } from "./import-provider-kernel.js";
import {
  failAfter,
  ProviderName,
  providerFailureFromStatus,
} from "./import-provider-kernel.js";
import { makeAccountedRecipeExtractor } from "./import-provider-recipe.js";
import type { RecipeProviderOutcome } from "./import-provider-recipe.js";
import type { RecipeEvidenceAssembly } from "./import-recipe-extractor.js";

export const ExperimentalClairicRecipeModel = "@cf/cloudflare/clairic";
export const experimentalClairicRecipeVersion = (
  encoding: ClairicSpanEncoding
) =>
  encoding === "unicode-code-points"
    ? "experimental-clairic-codepoints-v1"
    : "experimental-clairic-utf16-v1";

const fields = {
  cook: {
    instructions:
      "Exact explicitly labeled cooking time phrase including label and unit. Return null if absent.",
    type: "text",
  },
  inactive: {
    instructions:
      "Exact explicitly labeled inactive time phrase including label and unit. Return null if absent.",
    type: "text",
  },
  ingredients: {
    instructions:
      "Exact complete ingredient phrases, in source order. Preserve quantity, unit, preparation and optional qualifiers. Exclude headings and ingredients only mentioned as substitutions.",
    items: "text",
    type: "list",
  },
  instructions: {
    instructions:
      "Exact complete cooking instruction phrases in source order. Preserve negation, conditions, timing, temperature and optional qualifiers. Do not shorten a qualified action.",
    items: "text",
    type: "list",
  },
  name: {
    instructions: "Exact recipe title, only if stated. Return null if absent.",
    type: "text",
  },
  prep: {
    instructions:
      "Exact explicitly labeled preparation time phrase including label and unit. Return null if absent.",
    type: "text",
  },
  servings: {
    instructions:
      "Exact explicit yield phrase including its label, such as Serves 4. Return null if absent.",
    type: "text",
  },
  total: {
    instructions:
      "Exact explicitly labeled total time phrase including label and unit. Never calculate it. Return null if absent.",
    type: "text",
  },
} as const;

export const makeClairicRecipeRequest = (evidence: ClairicEvidenceText) => ({
  fields,
  model: "clairic" as const,
  options: { return_state_text: true as const },
  state: evidence.state,
});
export interface ClairicRecipeTransport {
  readonly run: (
    body: ReturnType<typeof makeClairicRecipeRequest>
  ) => Promise<Response>;
}

const Count = Schema.Int.pipe(
  Schema.check(
    Schema.isGreaterThanOrEqualTo(0),
    Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER)
  )
);
const Span = Schema.Tuple([Count, Count]);
const metadata = {
  confidence: Schema.optionalKey(Schema.Number),
  guess: Schema.optionalKey(Schema.Json),
  p_null: Schema.optionalKey(Schema.Number),
};
const TextAnswer = Schema.Struct({
  ...metadata,
  span: Schema.optionalKey(Schema.NullOr(Span)),
  type: Schema.Literal("text"),
  value: Schema.NullOr(Schema.String),
});
const ListAnswer = Schema.Struct({
  ...metadata,
  spans: Schema.optionalKey(Schema.NullOr(Schema.Array(Span))),
  type: Schema.Literal("list"),
  value: Schema.NullOr(
    Schema.Array(Schema.String).pipe(Schema.check(Schema.isMaxLength(256)))
  ),
});
const ClairicRecipeResponse = Schema.Struct({
  answers: Schema.Struct({
    cook: TextAnswer,
    inactive: TextAnswer,
    ingredients: ListAnswer,
    instructions: ListAnswer,
    name: TextAnswer,
    prep: TextAnswer,
    servings: TextAnswer,
    total: TextAnswer,
  }),
  model: Schema.Literals(["clairic", ExperimentalClairicRecipeModel]),
  state_text: Schema.String,
  truncated: Schema.Literal(false),
  usage: Schema.Struct({
    image_tokens: Schema.optionalKey(Count),
    input_tokens: Count,
    output_tokens: Count,
    passes: Schema.optionalKey(Count),
    schema_tokens: Schema.optionalKey(Count),
    state_tokens: Schema.optionalKey(Count),
  }),
});

const malformed = { _tag: "Failed", code: "malformed_response" } as const;

/** Fail closed on guesses, truncation, changed source text or ambiguous spans. */
export const decodeClairicRecipeResponse = (
  raw: Schema.Json,
  evidence: ClairicEvidenceText,
  encoding: ClairicSpanEncoding
): RecipeProviderOutcome => {
  const decoded = Schema.decodeUnknownResult(ClairicRecipeResponse, {
    onExcessProperty: "error",
  })(raw);
  if (
    decoded._tag === "Failure" ||
    decoded.success.state_text !== evidence.state
  ) {
    return malformed;
  }
  const { answers, state_text: returnedStateText, usage } = decoded.success;
  const spanValue = (
    value: string,
    span: readonly [number, number] | undefined | null
  ) =>
    span === undefined || span === null
      ? null
      : resolveClairicEvidenceSpan({
          encoding,
          evidence,
          returnedStateText,
          span,
          value,
        });
  const text = (
    answer: typeof TextAnswer.Type
  ): Option.Option<string | null> => {
    if (answer.value === null) {
      return Option.some(null);
    }
    const supported = spanValue(answer.value, answer.span);
    return supported === null || supported.value.trim().length === 0
      ? Option.none()
      : Option.some(supported.value.trim());
  };
  const list = (answer: typeof ListAnswer.Type): readonly string[] | null => {
    if (answer.value === null || answer.value.length === 0) {
      return [];
    }
    if (answer.spans?.length !== answer.value.length) {
      return null;
    }
    const values: string[] = [];
    let previousEnd = 0;
    for (const [index, value] of answer.value.entries()) {
      const span = answer.spans[index];
      if (span === undefined || span[0] < previousEnd) {
        return null;
      }
      const supported = spanValue(value, span);
      if (supported === null || supported.value.trim().length === 0) {
        return null;
      }
      [, previousEnd] = span;
      values.push(supported.value.trim());
    }
    return values;
  };
  const name = text(answers.name);
  const servings = text(answers.servings);
  const prep = text(answers.prep);
  const cook = text(answers.cook);
  const inactive = text(answers.inactive);
  const total = text(answers.total);
  const ingredients = list(answers.ingredients);
  const instructions = list(answers.instructions);
  if (
    Option.isNone(name) ||
    Option.isNone(servings) ||
    Option.isNone(prep) ||
    Option.isNone(cook) ||
    Option.isNone(inactive) ||
    Option.isNone(total) ||
    ingredients === null ||
    instructions === null
  ) {
    return malformed;
  }
  const normalized = Option.liftThrowable(normalizeClairicRecipePhrases)({
    cook: cook.value,
    inactive: inactive.value,
    ingredients,
    instructions,
    name: name.value,
    prep: prep.value,
    servings: servings.value,
    total: total.value,
  });
  return Option.isNone(normalized)
    ? malformed
    : {
        _tag: "Decoded",
        inputTokens: usage.input_tokens,
        outputTokens: usage.output_tokens,
        value: normalized.value,
      };
};

/** Evaluation-only until span compatibility and paired recipe quality are measured. */
export const makeExperimentalClairicRecipeExtractor = (input: {
  readonly correlationId: ImportCorrelationId;
  readonly dispatch: ProviderDispatchGate;
  readonly transport: ClairicRecipeTransport;
  readonly spanEncoding: ClairicSpanEncoding;
}) =>
  makeAccountedRecipeExtractor({
    descriptor: {
      model: ExperimentalClairicRecipeModel,
      provider: ProviderName,
      version: experimentalClairicRecipeVersion(input.spanEncoding),
    },
    dispatch: input.dispatch,
    invoke: (request: RecipeEvidenceAssembly) =>
      failAfter(
        Effect.gen(function* invokeClairicRecipe() {
          const evidence = assembleClairicEvidenceText(request.items);
          const response = yield* Effect.tryPromise({
            catch: () => "outcome_unknown" as const,
            try: () => input.transport.run(makeClairicRecipeRequest(evidence)),
          });
          if (!response.ok) {
            return {
              _tag: "Failed" as const,
              code: providerFailureFromStatus(response.status).code,
            };
          }
          const raw = yield* Effect.tryPromise({
            catch: () => "malformed_response" as const,
            try: () => response.json(),
          }).pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(Schema.Json)),
            Effect.option
          );
          if (Option.isNone(raw)) {
            return malformed;
          }
          return decodeClairicRecipeResponse(
            raw.value,
            evidence,
            input.spanEncoding
          );
        }),
        {
          correlationId: input.correlationId,
          providerStage: "recipe",
          traceStore: undefined,
        }
      ),
    prices: { inputMicroUsdPerToken: 0.1, outputMicroUsdPerToken: 0 },
  });

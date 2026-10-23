import {
  emptyRecipeDetails,
  recipeIngredientFromText,
  recipeInstructionFromText,
} from "@meal-planner/recipe-domain";
import { Schema } from "effect";

import { RecipeCandidate } from "./import-recipe-extractor.js";

const fractions: Readonly<Record<string, number>> = {
  "¼": 0.25,
  "½": 0.5,
  "¾": 0.75,
  "⅓": 1 / 3,
  "⅔": 2 / 3,
  "⅛": 0.125,
  "⅜": 0.375,
  "⅝": 0.625,
  "⅞": 0.875,
};
const numberPattern = String.raw`(?:\d+\s+\d+/\d+|\d+/\d+|\d*\s*[½¼¾⅓⅔⅛⅜⅝⅞]|\d+(?:\.\d+)?)`;
const quantityPattern = new RegExp(
  String.raw`^\s*(${numberPattern})(?:\s*[-–]\s*(${numberPattern}))?\s*`,
  "u"
);
const unitPattern =
  /^(?:kilograms?|grams?|millilitres?|milliliters?|litres?|liters?|tablespoons?|teaspoons?|ounces?|pounds?|cups?|kg|mg|ml|tbsp|tsp|oz|lb|g|l)\b\s*/iu;
// A supported prefix is insufficient when the source continues the number in
// notation this parser cannot represent, such as 1,000, 1⁄2 or 2 × 400.
const numericContinuation =
  /^(?:[\p{N}.,/⁄\p{Pd}−+×*]|[\p{P}\p{S}]\s*\p{N}|(?:to|x)\s*\d|[eE][+-]?\d)/iu;

const hasIncompleteNumericPrefix = (text: string, match: RegExpExecArray) => {
  const prefix = text.slice(0, match.index);
  return (
    /(?:\p{N}\s*(?:[\p{P}\p{S}]|to|x)|\p{N}\s+|\d[eE][+-]?|[+−\p{Pd}])\s*$/iu.test(
      prefix
    ) ||
    (/^[+-]/u.test(match[0]) && /\p{N}\s*$/u.test(prefix))
  );
};

const parseAmount = (text: string): number => {
  const expanded = text.replaceAll(
    /[½¼¾⅓⅔⅛⅜⅝⅞]/gu,
    (value) => ` ${fractions[value]}`
  );
  let total = 0;
  for (const part of expanded.trim().split(/\s+/u)) {
    const [numerator, denominator] = part.split("/").map(Number);
    total +=
      denominator === undefined
        ? (numerator ?? Number.NaN)
        : (numerator ?? Number.NaN) / denominator;
  }
  return total;
};

const quantityFromPhrase = (text: string) => {
  const match = quantityPattern.exec(text);
  if (match === null) {
    return null;
  }
  const rest = text.slice(match[0].length);
  if (numericContinuation.test(rest)) {
    return null;
  }
  const value = parseAmount(match[1] ?? "");
  const max = match[2] === undefined ? null : parseAmount(match[2]);
  if (
    !Number.isFinite(value) ||
    value <= 0 ||
    (max !== null && (!Number.isFinite(max) || max < value))
  ) {
    return null;
  }
  const unit = unitPattern.exec(rest)?.[0] ?? "";
  return {
    quantity: { max, unit: unit.trim() || null, value },
    rest: rest.slice(unit.length).trim(),
  };
};

const ingredientFromPhrase = (original: string) => {
  const parsed = quantityFromPhrase(original);
  const remaining = parsed?.rest || original;
  const preparation =
    /,\s*(?<preparation>(?:finely |roughly )?(?:chopped|diced|minced|sliced|grated|crushed|melted|softened))\s*(?:\(optional\))?$/iu.exec(
      remaining
    );
  const name = (
    preparation === null ? remaining : remaining.slice(0, preparation.index)
  )
    .replace(/\s*\(optional\)\s*$/iu, "")
    .trim();
  return {
    ...recipeIngredientFromText(original),
    name: name || original,
    optional:
      /(?:\(\s*optional\s*\)|,\s*optional)\s*$/iu.test(original) &&
      !/\b(?:not|never|no|non|if|unless|when|only|except)\b|n['’]t\b/iu.test(
        original
      )
        ? true
        : null,
    preparation: preparation?.groups?.["preparation"] ?? null,
    quantity: parsed?.quantity ?? null,
  };
};

const durationFromPhrase = (phrase: string | null) => {
  if (phrase === null) {
    return null;
  }
  const matches = [
    ...phrase.matchAll(
      /(?<![\p{L}\p{N}\p{M}.,/⁄+−\p{Pd}])(?<amount>\d+(?:\.\d+)?|\.\d+)\s*(?<unit>seconds?|secs?|minutes?|mins?|hours?|hrs?)\b/giu
    ),
  ];
  const [match] = matches;
  // A second timing phrase is ambiguous even when its number is unsupported.
  const unitMentions = phrase.match(
    /(?<!\p{L})(?:seconds?|secs?|minutes?|mins?|hours?|hrs?)\b/giu
  );
  if (
    unitMentions?.length !== 1 ||
    matches.length !== 1 ||
    match === undefined ||
    hasIncompleteNumericPrefix(phrase, match)
  ) {
    return null;
  }
  const amount = Number(match?.groups?.["amount"]);
  const unit = match?.groups?.["unit"]?.toLowerCase() ?? "";
  let multiplier = 1;
  if (/^(?:h|hour)/u.test(unit)) {
    multiplier = 3600;
  } else if (/^(?:m|min)/u.test(unit)) {
    multiplier = 60;
  }
  const seconds = amount * multiplier;
  return Number.isSafeInteger(seconds) && seconds >= 0 ? { seconds } : null;
};

const instructionFromPhrase = (text: string, index: number) => {
  const matches = [
    ...text.matchAll(
      /(?<![\p{L}\p{N}\p{M}.,/⁄+−\p{Pd}])(?<amount>[+-]?(?:\d+(?:\.\d+)?|\.\d+))\s*°?\s*(?<unit>[CF])\b/gu
    ),
  ];
  const [match] = matches;
  const unitMentions = text.match(/[\p{N}°]\s*[CF]\b/gu);
  const temperature =
    unitMentions?.length === 1 &&
    matches.length === 1 &&
    match !== undefined &&
    !hasIncompleteNumericPrefix(text, match)
      ? match
      : undefined;
  return {
    ...recipeInstructionFromText(text, index + 1),
    duration: durationFromPhrase(text),
    temperature:
      temperature === undefined
        ? null
        : {
            unit:
              temperature.groups?.["unit"] === "C"
                ? ("C" as const)
                : ("F" as const),
            value: Number(temperature.groups?.["amount"]),
          },
  };
};

const servingsFromPhrase = (
  original: string | null
): RecipeCandidate["servings"] => {
  if (
    original === null ||
    !/^(?:serves|servings:?|portions:?|makes|yield:?)\s+/iu.test(original)
  ) {
    return null;
  }
  const parsed = quantityFromPhrase(
    original.replace(/^(?:serves|servings:?|portions:?|makes|yield:?)\s+/iu, "")
  );
  if (parsed === null) {
    return null;
  }
  return {
    max: parsed.quantity.max,
    original,
    quantity: parsed.quantity.value,
    unit: /^(?:serves|servings:?|portions:?)\s+/iu.test(original)
      ? "serving"
      : (parsed.quantity.unit ?? (parsed.rest || null)),
  };
};

/** Only parse explicit local phrases; the normal grounder remains authoritative. */
export const normalizeClairicRecipePhrases = (input: {
  readonly name: string | null;
  readonly ingredients: readonly string[];
  readonly instructions: readonly string[];
  readonly servings: string | null;
  readonly prep: string | null;
  readonly cook: string | null;
  readonly inactive: string | null;
  readonly total: string | null;
}): RecipeCandidate =>
  Schema.decodeUnknownSync(RecipeCandidate)({
    ...emptyRecipeDetails,
    ingredients:
      input.ingredients.length === 0
        ? null
        : input.ingredients.map(ingredientFromPhrase),
    instructions:
      input.instructions.length === 0
        ? null
        : input.instructions.map(instructionFromPhrase),
    name: input.name,
    servings: servingsFromPhrase(input.servings),
    times: {
      cook: durationFromPhrase(input.cook),
      inactive: durationFromPhrase(input.inactive),
      prep: durationFromPhrase(input.prep),
      total: durationFromPhrase(input.total),
    },
  });

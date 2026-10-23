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
  const value = parseAmount(match[1] ?? "");
  const max = match[2] === undefined ? null : parseAmount(match[2]);
  if (
    !Number.isFinite(value) ||
    value <= 0 ||
    (max !== null && (!Number.isFinite(max) || max < value))
  ) {
    return null;
  }
  const rest = text.slice(match[0].length);
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
    optional: /\boptional\b/iu.test(original) ? true : null,
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
      /(?<![\p{L}\p{N}./+−-])(?<amount>\d+(?:\.\d+)?|\.\d+)\s*(?<unit>seconds?|secs?|minutes?|mins?|hours?|hrs?)\b/giu
    ),
  ];
  if (matches.length !== 1 || /\d\s*(?:[-–/⁄]|to)\s*\d/u.test(phrase)) {
    return null;
  }
  const [match] = matches;
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
      /(?<![\p{L}\p{N}./+−-])(?<amount>[+-]?(?:\d+(?:\.\d+)?|\.\d+))\s*°?\s*(?<unit>[CF])\b/gu
    ),
  ];
  const ambiguous = /\d\s*(?:[-–/⁄]|to)\s*\d+(?:\.\d+)?\s*°?\s*[CF]\b/u.test(
    text
  );
  const temperature =
    matches.length === 1 && !ambiguous ? matches[0] : undefined;
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
      : parsed.rest || null,
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

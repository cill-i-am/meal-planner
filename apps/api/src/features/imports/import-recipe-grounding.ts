import { RecipeDraftContent } from "@meal-planner/recipe-domain";
import { Schema } from "effect";

import type {
  GroundedRecipeFacts,
  RecipeCandidate,
  RecipeEvidenceItem,
  RecipeUnresolvedField,
} from "./import-recipe-extractor.js";

/**
 * Textual grounding permits presentation-only differences while retaining a
 * strict contiguous-substring evidence boundary.
 */
export const normalizeRecipeGroundingText = (value: string) =>
  value
    .normalize("NFKC")
    .toLocaleLowerCase("en")
    .replaceAll(/[\p{P}\p{S}]+/gu, " ")
    .replaceAll(/\s+/gu, " ")
    .trim();

/** A selected fragment cannot remove source polarity or conditions. */
const preservesRecipeClauseQualifiers = (evidence: string, span: string) => {
  const start = evidence.indexOf(span);
  if (start === -1) {
    return false;
  }
  const before = evidence.slice(0, start);
  const after = evidence.slice(start + span.length);
  const prefix = before.slice(
    Math.max(
      before.lastIndexOf("."),
      before.lastIndexOf("!"),
      before.lastIndexOf(";"),
      before.lastIndexOf("\n")
    ) + 1
  );
  const suffix = after.split(/[.!;\n]/u)[0] ?? "";
  const clause = normalizeRecipeGroundingText(`${prefix}${span}${suffix}`);
  const selected = normalizeRecipeGroundingText(span);
  const qualifiers =
    clause.match(
      /\b(?:not|no|never|without|avoid|omit|unless|only if|only when|except|optional|optionally|don t|doesn t|do not|must not|if|when|until)\b/gu
    ) ?? [];
  return qualifiers.every((qualifier) =>
    new RegExp(`(?:^|\\s)${qualifier}(?:$|\\s)`, "u").test(selected)
  );
};

const ProjectionStopWords = new Set([
  "a",
  "about",
  "all",
  "an",
  "and",
  "by",
  "for",
  "from",
  "in",
  "into",
  "it",
  "my",
  "of",
  "on",
  "or",
  "our",
  "some",
  "that",
  "the",
  "them",
  "then",
  "this",
  "to",
  "together",
  "until",
  "with",
  "your",
]);

interface PositionedGroundingToken {
  readonly end: number;
  readonly forms: ReadonlySet<string>;
  readonly start: number;
  readonly value: string;
}

const removeDoubledFinalLetter = (value: string) => {
  const final = value.at(-1);
  const previous = value.at(-2);
  return final !== undefined && final === previous ? value.slice(0, -1) : value;
};

const comparableTokenForms = (value: string) => {
  const normalized = value.normalize("NFKC").toLocaleLowerCase("en");
  const forms = new Set([normalized]);
  if (/\p{L}/u.test(normalized) && normalized.length >= 5) {
    if (normalized.endsWith("ies")) {
      forms.add(`${normalized.slice(0, -3)}y`);
    }
    if (normalized.endsWith("ing") && normalized.length >= 6) {
      const rawStem = normalized.slice(0, -3);
      const stem = removeDoubledFinalLetter(rawStem);
      forms.add(rawStem);
      forms.add(stem);
      forms.add(`${stem}e`);
    }
    if (normalized.endsWith("ed")) {
      const rawStem = normalized.slice(0, -2);
      const stem = removeDoubledFinalLetter(rawStem);
      forms.add(rawStem);
      forms.add(stem);
      forms.add(`${stem}e`);
    }
    if (normalized.endsWith("es")) {
      forms.add(normalized.slice(0, -2));
    }
    if (
      normalized.endsWith("s") &&
      !normalized.endsWith("ss") &&
      !normalized.endsWith("us")
    ) {
      forms.add(normalized.slice(0, -1));
    }
  }
  return forms;
};

const positionedGroundingTokens = (value: string) =>
  [...value.matchAll(/[\p{L}\p{N}]+/gu)].map((match) => {
    const [token] = match;
    const start = match.index;
    return {
      end: start + token.length,
      forms: comparableTokenForms(token),
      start,
      value: token.normalize("NFKC").toLocaleLowerCase("en"),
    } satisfies PositionedGroundingToken;
  });

const tokensIntersect = (
  left: PositionedGroundingToken,
  right: PositionedGroundingToken
) => [...left.forms].some((form) => right.forms.has(form));

/**
 * Project a model-selected fact back to the smallest exact span of cited
 * evidence. Every non-grammatical candidate token must occur in order inside
 * one short evidence window; the returned value is evidence text, never model
 * text. This admits presentation and inflection differences without admitting
 * new recipe facts.
 */
export const projectRecipeEvidenceSpan = (
  evidence: string,
  candidate: string
): string | null => {
  const candidateTokens = positionedGroundingTokens(candidate).filter(
    (token) => !ProjectionStopWords.has(token.value)
  );
  if (candidateTokens.length === 0) {
    return null;
  }
  const evidenceTokens = positionedGroundingTokens(evidence);
  const maximumWindowTokens = Math.max(12, candidateTokens.length * 4 + 4);
  const [firstCandidateToken] = candidateTokens;
  const candidates: {
    readonly end: number;
    readonly start: number;
    readonly tokenCount: number;
  }[] = [];

  for (
    let startIndex = 0;
    startIndex < evidenceTokens.length;
    startIndex += 1
  ) {
    const firstEvidenceToken = evidenceTokens[startIndex];
    if (
      firstEvidenceToken === undefined ||
      firstCandidateToken === undefined ||
      !tokensIntersect(firstEvidenceToken, firstCandidateToken)
    ) {
      continue;
    }
    let evidenceIndex = startIndex;
    let matchedEndIndex = startIndex;
    let matched = true;
    for (
      let candidateIndex = 1;
      candidateIndex < candidateTokens.length;
      candidateIndex += 1
    ) {
      const candidateToken = candidateTokens[candidateIndex];
      let nextMatch = -1;
      for (
        let searchIndex = evidenceIndex + 1;
        searchIndex < evidenceTokens.length &&
        searchIndex - startIndex < maximumWindowTokens;
        searchIndex += 1
      ) {
        const evidenceToken = evidenceTokens[searchIndex];
        if (
          candidateToken !== undefined &&
          evidenceToken !== undefined &&
          tokensIntersect(evidenceToken, candidateToken)
        ) {
          nextMatch = searchIndex;
          break;
        }
      }
      if (nextMatch === -1) {
        matched = false;
        break;
      }
      evidenceIndex = nextMatch;
      matchedEndIndex = nextMatch;
    }
    const finalEvidenceToken = evidenceTokens[matchedEndIndex];
    if (
      matched &&
      finalEvidenceToken !== undefined &&
      matchedEndIndex - startIndex < maximumWindowTokens
    ) {
      candidates.push({
        end: finalEvidenceToken.end,
        start: firstEvidenceToken.start,
        tokenCount: matchedEndIndex - startIndex + 1,
      });
    }
  }

  const [best] = candidates.toSorted(
    (left, right) =>
      left.tokenCount - right.tokenCount ||
      left.end - left.start - (right.end - right.start)
  );
  if (best === undefined) {
    return null;
  }
  const span = evidence.slice(best.start, best.end).trim();
  return preservesRecipeClauseQualifiers(evidence, span) ? span : null;
};

const trustedRecipeCitation = (item: RecipeEvidenceItem) => ({
  confidence: 1,
  evidenceId: item.evidenceId,
  origin: item.origin,
});

const unitAliases: Readonly<Record<string, string>> = {
  cups: "cup",
  gram: "g",
  grams: "g",
  kilogram: "kg",
  kilograms: "kg",
  liters: "l",
  litres: "l",
  milliliters: "ml",
  millilitres: "ml",
  ounce: "oz",
  ounces: "oz",
  portion: "serving",
  portions: "serving",
  pound: "lb",
  pounds: "lb",
  servings: "serving",
  tablespoon: "tbsp",
  tablespoons: "tbsp",
  teaspoon: "tsp",
  teaspoons: "tsp",
};
const normalizedUnit = (unit: string | null) =>
  unit === null
    ? null
    : (unitAliases[unit.toLowerCase()] ?? unit.toLowerCase());
const fractionValues: Readonly<Record<string, string>> = {
  "¼": "1/4",
  "½": "1/2",
  "¾": "3/4",
  "⅓": "1/3",
  "⅔": "2/3",
  "⅛": "1/8",
  "⅜": "3/8",
  "⅝": "5/8",
  "⅞": "7/8",
};
const numberValue = (text: string): number => {
  const value = text
    .replaceAll(/[½¼¾⅓⅔⅛⅜⅝⅞]/gu, (fraction) => ` ${fractionValues[fraction]}`)
    .trim();
  let total = 0;
  for (const part of value.split(/\s+/u)) {
    const [numerator, denominator] = part.split("/").map(Number);
    total +=
      denominator === undefined
        ? (numerator ?? Number.NaN)
        : (numerator ?? Number.NaN) / denominator;
  }
  return total;
};
const knownUnits = new Set([
  "g",
  "kg",
  "mg",
  "ml",
  "l",
  "tbsp",
  "tsp",
  "cup",
  "oz",
  "lb",
  "serving",
]);
const escapePattern = (value: string) =>
  value.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&");
const quantitySupported = (
  original: string,
  quantity: {
    readonly value: number;
    readonly max: number | null;
    readonly unit: string | null;
  }
) => {
  const numbers =
    "(?:\\d+\\s+\\d+/\\d+|\\d+/\\d+|\\d*\\s*[½¼¾⅓⅔⅛⅜⅝⅞]|\\d+(?:\\.\\d+)?)";
  const match = new RegExp(
    `^\\s*(${numbers})(?:\\s*[-–]\\s*(${numbers}))?\\s*([a-z]+)?`,
    "iu"
  ).exec(original);
  if (
    match === null ||
    numberValue(match[1] ?? "") !== quantity.value ||
    (match[2] === undefined ? null : numberValue(match[2])) !== quantity.max
  ) {
    return false;
  }
  return quantity.unit === null
    ? !knownUnits.has(normalizedUnit(match[3] ?? null) ?? "")
    : normalizedUnit(match[3] ?? null) === normalizedUnit(quantity.unit);
};
const durationSupported = (text: string, seconds: number) =>
  [
    ...text.matchAll(
      /(?<amount>\d+(?:\.\d+)?)\s*(?<unit>seconds?|secs?|minutes?|mins?|hours?|hrs?)/giu
    ),
  ].some((match) => {
    const unit = match.groups?.["unit"] ?? "";
    let multiplier = 1;
    if (/^h/iu.test(unit)) {
      multiplier = 3600;
    } else if (/^m/iu.test(unit)) {
      multiplier = 60;
    }
    return Number(match.groups?.["amount"]) * multiplier === seconds;
  });

const groundServingAndNutrition = (
  candidate: RecipeCandidate,
  contentItems: readonly RecipeEvidenceItem[],
  cite: (path: string, item: RecipeEvidenceItem) => void
) => {
  const { servings: selectedServings } = candidate;
  let servings: RecipeCandidate["servings"] = null;
  if (selectedServings !== null) {
    const { original } = selectedServings;
    const item = contentItems.find((source) => source.value.includes(original));
    if (
      item !== undefined &&
      quantitySupported(
        original.replace(
          /^(?:serves|makes|yield:?|servings:?|portions:?)\s*/iu,
          ""
        ),
        {
          max: selectedServings.max,
          unit:
            /^(?:serves|servings:?|portions:?)\s/iu.test(original) &&
            normalizedUnit(selectedServings.unit) === "serving"
              ? null
              : selectedServings.unit,
          value: selectedServings.quantity,
        }
      )
    ) {
      servings = {
        ...selectedServings,
        unit:
          /^(?:serves|servings:?|portions:?)\s/iu.test(original) &&
          selectedServings.unit === null
            ? "serving"
            : selectedServings.unit,
      };
      cite("servings", item);
    }
  }
  // Nutrition needs an explicit source basis; a number near a nutrient is not sufficient.
  const { nutrition } = candidate;
  let groundedNutrition: RecipeCandidate["nutrition"] = null;
  if (nutrition !== null) {
    const item = contentItems.find((source) =>
      source.value.includes(nutrition.original)
    );
    const basis = {
      "100g": /per\s*100\s*g/iu,
      recipe: /(?:per|whole|entire)\s+recipe/iu,
      serving: /per\s+(?:serving|portion)/iu,
    }[nutrition.basis.type];
    if (
      item !== undefined &&
      basis.test(nutrition.original) &&
      (nutrition.basis.servings === null ||
        new RegExp(
          `\\b(?:serves|servings:?|makes)\\s+${nutrition.basis.servings}\\b`,
          "iu"
        ).test(nutrition.original)) &&
      (nutrition.basis.description === null ||
        nutrition.original.includes(nutrition.basis.description)) &&
      nutrition.nutrients.every((nutrient) => {
        const name = escapePattern(nutrient.name);
        const amount = `${escapePattern(String(nutrient.amount.value))}\\s*${escapePattern(nutrient.amount.unit)}`;
        return new RegExp(
          `(?:\\b${name}\\s*:?\\s*${amount}\\b|\\b${amount}\\s+${name}\\b)`,
          "iu"
        ).test(nutrition.original);
      })
    ) {
      groundedNutrition = nutrition;
      cite("nutrition", item);
    }
  }
  return { groundedNutrition, servings };
};

/** Trusted source spans supply content and citations; provider metadata never has authority. */
export const groundRecipeCandidate = (
  candidate: RecipeCandidate,
  items: readonly RecipeEvidenceItem[]
): GroundedRecipeFacts => {
  const evidence: GroundedRecipeFacts["evidence"][number][] = [];
  const contentItems = items.filter(
    (item) => item.kind !== "creator" && item.kind !== "source_url"
  );
  const cite = (path: string, item: RecipeEvidenceItem) => {
    evidence.push({ citations: [trustedRecipeCitation(item)], path });
  };
  const text = (
    value: string | null,
    path: string,
    sources = contentItems
  ): string | null => {
    if (value === null) {
      return null;
    }
    for (const item of sources) {
      const index = item.value
        .toLocaleLowerCase("en")
        .indexOf(value.toLocaleLowerCase("en"));
      let span: string | null = item.value.slice(index, index + value.length);
      if (index === -1) {
        span = projectRecipeEvidenceSpan(item.value, value);
      }
      if (span !== null && preservesRecipeClauseQualifiers(item.value, span)) {
        cite(path, item);
        return span;
      }
    }
    return null;
  };
  const list = (
    values: readonly string[],
    path: string,
    sources = contentItems
  ) =>
    values.flatMap((value) => {
      const grounded = text(
        value,
        `${path}.${evidence.filter((entry) => entry.path.startsWith(`${path}.`)).length}`,
        sources
      );
      return grounded === null ? [] : [grounded];
    });
  const creator = items.find((item) => item.kind === "creator");
  if (creator !== undefined) {
    cite("author.name", creator);
  }
  const ingredients =
    candidate.ingredients?.flatMap((ingredient) => {
      const index = evidence.filter((entry) =>
        /^ingredients\.\d+\.original$/u.test(entry.path)
      ).length;
      const prefix = `ingredients.${index}`;
      const original = text(ingredient.original, `${prefix}.original`);
      if (original === null) {
        return [];
      }
      const item = contentItems.find((source) =>
        source.value.includes(original)
      );
      if (item === undefined) {
        return [];
      }
      const local = [{ ...item, value: original }];
      const groundedName = text(ingredient.name, `${prefix}.name`, local);
      const name = groundedName ?? original;
      if (groundedName === null) {
        cite(`${prefix}.name`, item);
      }
      const quantity =
        ingredient.quantity !== null &&
        quantitySupported(original, ingredient.quantity)
          ? ingredient.quantity
          : null;
      if (quantity !== null) {
        cite(`${prefix}.quantity`, item);
      }
      const optional =
        ingredient.optional === true && /\boptional\b/iu.test(original)
          ? true
          : null;
      if (optional !== null) {
        cite(`${prefix}.optional`, item);
      }
      return [
        {
          group: text(ingredient.group, `${prefix}.group`),
          ingredientId: null,
          localName: text(ingredient.localName, `${prefix}.localName`, local),
          name,
          note: text(ingredient.note, `${prefix}.note`, local),
          optional,
          original,
          preparation: text(
            ingredient.preparation,
            `${prefix}.preparation`,
            local
          ),
          quantity,
          size: text(ingredient.size, `${prefix}.size`, local),
        },
      ];
    }) ?? [];
  const instructions =
    candidate.instructions?.flatMap((instruction) => {
      const index = evidence.filter((entry) =>
        /^instructions\.\d+\.text$/u.test(entry.path)
      ).length;
      const prefix = `instructions.${index}`;
      const grounded = text(instruction.text, `${prefix}.text`);
      if (grounded === null) {
        return [];
      }
      const item = contentItems.find((source) =>
        source.value.includes(grounded)
      );
      if (item === undefined) {
        return [];
      }
      const local = [{ ...item, value: grounded }];
      const duration =
        instruction.duration !== null &&
        durationSupported(grounded, instruction.duration.seconds)
          ? instruction.duration
          : null;
      if (duration !== null) {
        cite(`${prefix}.duration`, item);
      }
      const temperature =
        instruction.temperature !== null &&
        new RegExp(
          `\\b${instruction.temperature.value}\\s*(?:°\\s*)?${instruction.temperature.unit}\\b`,
          "iu"
        ).test(grounded)
          ? instruction.temperature
          : null;
      if (temperature !== null) {
        cite(`${prefix}.temperature`, item);
      }
      return [
        {
          duration,
          equipment: list(instruction.equipment, `${prefix}.equipment`, local),
          group: text(instruction.group, `${prefix}.group`),
          ingredients: [],
          step: index + 1,
          techniques: list(
            instruction.techniques,
            `${prefix}.techniques`,
            local
          ),
          temperature,
          text: grounded,
        },
      ];
    }) ?? [];
  const groundTime = (kind: keyof RecipeCandidate["times"]) => {
    const duration = candidate.times[kind];
    const label = {
      cook: "cook",
      inactive: "(?:inactive|rest|chill|marinate|wait)",
      prep: "prep",
      total: "(?:total|ready)",
    }[kind];
    const pattern = new RegExp(
      `\\b${label}(?:\\s+time)?\\s*(?::|for|in)?\\s*((?:\\d+(?:\\.\\d+)?)\\s*(?:seconds?|secs?|minutes?|mins?|hours?|hrs?))\\b`,
      "giu"
    );
    const item =
      duration === null
        ? undefined
        : contentItems.find((source) =>
            [...source.value.matchAll(pattern)].some((match) =>
              durationSupported(match[1] ?? "", duration.seconds)
            )
          );
    if (item !== undefined) {
      cite(`times.${kind}`, item);
    }
    return item === undefined ? null : duration;
  };
  const times = {
    cook: groundTime("cook"),
    inactive: groundTime("inactive"),
    prep: groundTime("prep"),
    total: groundTime("total"),
  };
  const { servings, groundedNutrition } = groundServingAndNutrition(
    candidate,
    contentItems,
    cite
  );
  const dietary = candidate.dietary.flatMap((claim) => {
    const item = contentItems.find((source) =>
      source.value.split(/[.!;\n]/u).some((statement) => {
        const declaration = normalizeRecipeGroundingText(statement);
        const phrase = normalizeRecipeGroundingText(claim.original);
        return (
          new RegExp(`(?:^|\\s)${escapePattern(phrase)}(?:$|\\s)`, "u").test(
            declaration
          ) &&
          !/\b(?:not|no|never|without|cannot|may|might|possibly|potentially|isn t|aren t|wasn t|weren t|don t|doesn t)\b/u.test(
            declaration
          )
        );
      })
    );
    const normalized = normalizeRecipeGroundingText(claim.original);
    const name = normalizeRecipeGroundingText(claim.name);
    let supported = false;
    if (claim.kind === "diet") {
      supported = claim.value && normalized === name;
    } else if (claim.value) {
      supported = normalized === `contains ${name}`;
    } else {
      supported =
        normalized === `${name} free` || normalized === `free from ${name}`;
    }
    if (item === undefined || !supported) {
      return [];
    }
    cite(
      `dietary.${evidence.filter((entry) => entry.path.startsWith("dietary.")).length}`,
      item
    );
    return [claim];
  });
  const recipe = Schema.decodeUnknownSync(RecipeDraftContent)({
    author: creator === undefined ? null : { name: creator.value, url: null },
    categories: list(candidate.categories, "categories"),
    cuisines: list(candidate.cuisines, "cuisines"),
    description: text(candidate.description, "description"),
    dietary,
    equipment: list(candidate.equipment, "equipment"),
    ingredients: ingredients.length === 0 ? null : ingredients,
    instructions: instructions.length === 0 ? null : instructions,
    language: null,
    media: [],
    name: text(candidate.name, "name"),
    notes: list(candidate.notes, "notes"),
    nutrition: groundedNutrition,
    servings,
    sourceTags: list(candidate.sourceTags, "sourceTags"),
    times,
  });
  const source = items.find((item) => item.kind === "source_url");
  return {
    evidence,
    recipe,
    sourceUrl:
      source === undefined
        ? {
            citations: [],
            origin: "unresolved",
            reason: "not resolved from available evidence",
            state: "unresolved",
          }
        : {
            citations: [trustedRecipeCitation(source)],
            origin: source.origin,
            state: "supported",
            value: source.value,
          },
    unresolvedFields: (Object.keys(recipe) as RecipeUnresolvedField[]).filter(
      (field) =>
        recipe[field] === null ||
        (Array.isArray(recipe[field]) && recipe[field].length === 0) ||
        (field === "times" &&
          Object.values(recipe.times).some((value) => value === null))
    ),
  };
};

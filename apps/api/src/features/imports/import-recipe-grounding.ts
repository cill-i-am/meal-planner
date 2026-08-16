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

export const recipeEvidenceContains = (evidence: string, value: string) => {
  const normalizedValue = normalizeRecipeGroundingText(value);
  return (
    normalizedValue.length > 0 &&
    normalizeRecipeGroundingText(evidence).includes(normalizedValue)
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
  return best === undefined
    ? null
    : evidence.slice(best.start, best.end).trim();
};

const MissingRecipeSemanticReason =
  "not resolved from available evidence" as const;
const MissingRecipeFact = {
  citations: [],
  origin: "unresolved",
  reason: MissingRecipeSemanticReason,
  state: "unresolved",
} as const;
const MissingRecipeFactList = {
  items: [],
  reason: MissingRecipeSemanticReason,
  state: "unresolved",
} as const;

const trustedRecipeCitation = (item: RecipeEvidenceItem) => ({
  confidence: 1,
  evidenceId: item.evidenceId,
  origin: item.origin,
});

const trustedSupportedRecipeFact = <A>(value: A, item: RecipeEvidenceItem) => ({
  citations: [trustedRecipeCitation(item)] as const,
  origin: item.origin,
  state: "supported" as const,
  value,
});

const groundedStringEvidence = (
  value: string,
  items: readonly RecipeEvidenceItem[]
) => {
  const exact = items.find((item) => recipeEvidenceContains(item.value, value));
  if (exact !== undefined) {
    return { item: exact, value } as const;
  }
  for (const item of items) {
    if (
      item.kind !== "caption" &&
      item.kind !== "transcript" &&
      item.kind !== "visual_observation"
    ) {
      continue;
    }
    const projected = projectRecipeEvidenceSpan(item.value, value);
    if (projected !== null) {
      return { item, value: projected } as const;
    }
  }
  return null;
};

const groundRecipeStringFact = (
  value: string | null,
  items: readonly RecipeEvidenceItem[]
) => {
  if (value === null) {
    return MissingRecipeFact;
  }
  const grounded = groundedStringEvidence(value, items);
  return grounded === null
    ? MissingRecipeFact
    : trustedSupportedRecipeFact(grounded.value, grounded.item);
};

const exactTimeEvidence = (
  items: readonly RecipeEvidenceItem[],
  value: number
) =>
  items.find((item) =>
    new RegExp(`\\b${value}\\s*(?:minutes?|mins?)\\b`, "iu").test(item.value)
  );

const exactTemperatureEvidence = (
  items: readonly RecipeEvidenceItem[],
  value: number
) =>
  items.find((item) =>
    new RegExp(`\\b${value}\\s*(?:°\\s*)?c\\b`, "iu").test(item.value)
  );

const groundRecipeNumberFact = (
  value: number | null,
  items: readonly RecipeEvidenceItem[],
  findEvidence: (
    evidence: readonly RecipeEvidenceItem[],
    candidate: number
  ) => RecipeEvidenceItem | undefined
) => {
  if (value === null) {
    return MissingRecipeFact;
  }
  const evidence = findEvidence(items, value);
  return evidence === undefined
    ? MissingRecipeFact
    : trustedSupportedRecipeFact(value, evidence);
};

const groundRecipeFactList = (
  values: readonly string[],
  items: readonly RecipeEvidenceItem[]
) => {
  const grounded = values.flatMap((value) => {
    const groundedFact = groundedStringEvidence(value, items);
    return groundedFact === null
      ? []
      : [trustedSupportedRecipeFact(groundedFact.value, groundedFact.item)];
  });
  const unique = grounded.filter(
    (fact, index) =>
      grounded.findIndex((candidate) => candidate.value === fact.value) ===
      index
  );
  const [first, ...rest] = unique;
  return first === undefined
    ? MissingRecipeFactList
    : { items: [first, ...rest] as const, state: "supported" as const };
};

const trustedEvidenceFact = (
  items: readonly RecipeEvidenceItem[],
  kind: "creator" | "source_url"
) => {
  const evidence = items.find((item) => item.kind === kind);
  return evidence === undefined
    ? MissingRecipeFact
    : trustedSupportedRecipeFact(evidence.value, evidence);
};

const UnresolvedFieldByGroundedKey = [
  ["author", "author"],
  ["category", "category"],
  ["cookTimeMinutes", "cook_time_minutes"],
  ["cuisine", "cuisine"],
  ["description", "description"],
  ["ingredientLines", "ingredient_lines"],
  ["instructions", "instructions"],
  ["name", "name"],
  ["nutrition", "nutrition"],
  ["prepTimeMinutes", "prep_time_minutes"],
  ["temperatureCelsius", "temperature_celsius"],
  ["tools", "tools"],
  ["totalTimeMinutes", "total_time_minutes"],
  ["yield", "yield"],
] as const satisfies readonly (readonly [
  keyof Omit<GroundedRecipeFacts, "unresolvedFields">,
  RecipeUnresolvedField,
])[];

/**
 * The sole authority boundary from decoded provider selections to landed,
 * evidence-cited recipe facts. Unresolved bookkeeping is derived here once.
 */
export const groundRecipeCandidate = (
  candidate: RecipeCandidate,
  items: readonly RecipeEvidenceItem[]
): GroundedRecipeFacts => {
  const grounded = {
    author: trustedEvidenceFact(items, "creator"),
    category: groundRecipeStringFact(candidate.category, items),
    cookTimeMinutes: groundRecipeNumberFact(
      candidate.cookTimeMinutes,
      items,
      exactTimeEvidence
    ),
    cuisine: groundRecipeStringFact(candidate.cuisine, items),
    description: groundRecipeStringFact(candidate.description, items),
    ingredientLines: groundRecipeFactList(candidate.ingredientLines, items),
    instructions: groundRecipeFactList(candidate.instructions, items),
    name: groundRecipeStringFact(candidate.name, items),
    nutrition: groundRecipeStringFact(candidate.nutrition, items),
    prepTimeMinutes: groundRecipeNumberFact(
      candidate.prepTimeMinutes,
      items,
      exactTimeEvidence
    ),
    sourceUrl: trustedEvidenceFact(items, "source_url"),
    supportedClaims: groundRecipeFactList(candidate.supportedClaims, items),
    temperatureCelsius: groundRecipeNumberFact(
      candidate.temperatureCelsius,
      items,
      exactTemperatureEvidence
    ),
    tools: groundRecipeFactList(candidate.tools, items),
    totalTimeMinutes: groundRecipeNumberFact(
      candidate.totalTimeMinutes,
      items,
      exactTimeEvidence
    ),
    yield: groundRecipeStringFact(candidate.yield, items),
  };
  const unresolvedFields = UnresolvedFieldByGroundedKey.flatMap(
    ([key, field]) => (grounded[key].state === "unresolved" ? [field] : [])
  );
  return {
    ...grounded,
    unresolvedFields: [
      ...unresolvedFields,
      "ingredient_quantities",
      "ingredient_units",
    ],
  };
};

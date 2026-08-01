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

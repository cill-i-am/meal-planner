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

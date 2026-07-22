import { Effect } from "effect";

import type {
  RecipeEvidenceAssembly,
  RecipeExtractorDescriptor,
  RecipeExtractorShape,
} from "./import-recipe-extractor.js";

/** Deterministic provider-free extractor that deliberately returns untrusted data. */
export const makeDeterministicRecipeExtractor = (
  descriptor: RecipeExtractorDescriptor,
  output: unknown | ((input: RecipeEvidenceAssembly) => unknown)
): {
  readonly calls: RecipeEvidenceAssembly[];
  readonly service: RecipeExtractorShape;
} => {
  const calls: RecipeEvidenceAssembly[] = [];
  return {
    calls,
    service: {
      descriptor,
      extract: (input) =>
        Effect.sync(() => {
          calls.push(input);
          return structuredClone(
            typeof output === "function" ? output(input) : output
          );
        }),
    },
  };
};

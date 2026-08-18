import { Effect } from "effect";
import type { Schema } from "effect";

import type {
  RecipeEvidenceAssembly,
  RecipeExtractorDescriptor,
  RecipeExtractor,
} from "./import-recipe-extractor.js";

/** Deterministic provider-free extractor that deliberately returns untrusted data. */
export const makeDeterministicRecipeExtractor = (
  descriptor: RecipeExtractorDescriptor,
  output: (input: RecipeEvidenceAssembly) => Schema.Json
): {
  readonly calls: RecipeEvidenceAssembly[];
  readonly service: RecipeExtractor;
} => {
  const calls: RecipeEvidenceAssembly[] = [];
  return {
    calls,
    service: {
      descriptor,
      extract: (input) =>
        Effect.sync(() => {
          calls.push(input);
          return structuredClone(output(input));
        }),
    },
  };
};

/** Deterministic provider-free extractor for one fixed untrusted fixture. */
export const makeDeterministicRecipeExtractorValue = (
  descriptor: RecipeExtractorDescriptor,
  output: Schema.Json
) => makeDeterministicRecipeExtractor(descriptor, () => output);

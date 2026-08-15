import { describe, expect, it } from "vitest";

import {
  makeInstalledRecipeExtractor as publicRecipeFactory,
  makeInstalledSpeechTranscriber as publicSpeechFactory,
  makeInstalledVisualEvidenceExtractor as publicVisualFactory,
} from "./import-provider-adapters.js";
import { makeInstalledRecipeExtractor } from "./import-provider-recipe.js";
import { makeInstalledSpeechTranscriber } from "./import-provider-speech.js";
import { makeInstalledVisualEvidenceExtractor } from "./import-provider-visual.js";

describe("import provider adapter public surface", () => {
  it("keeps the installed provider factories on the compatibility surface", () => {
    expect([
      publicRecipeFactory,
      publicSpeechFactory,
      publicVisualFactory,
    ]).toEqual([
      makeInstalledRecipeExtractor,
      makeInstalledSpeechTranscriber,
      makeInstalledVisualEvidenceExtractor,
    ]);
  });
});

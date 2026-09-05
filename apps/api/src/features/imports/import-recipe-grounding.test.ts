import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  GroundedRecipeFacts,
  RecipeCandidate,
} from "./import-recipe-extractor.js";
import type {
  GroundedRecipeFacts as GroundedRecipeFactsType,
  RecipeEvidenceAssembly,
} from "./import-recipe-extractor.js";
import { groundRecipeCandidate } from "./import-recipe-grounding.js";

const candidate = Schema.decodeUnknownSync(RecipeCandidate)({
  category: "pasta",
  cookTimeMinutes: 12,
  cuisine: "Italian",
  description: "quick tomato pasta",
  ingredientLines: ["tomatoes", "fresh pasta"],
  instructions: ["boil the fresh pasta"],
  name: "tomato pasta",
  nutrition: "high protein",
  prepTimeMinutes: 5,
  supportedClaims: ["ready in 17 minutes"],
  temperatureCelsius: 180,
  tools: ["large pan"],
  totalTimeMinutes: 17,
  yield: "serves 2",
});

const assembly = {
  items: [
    {
      artifactReference: "source-manifest",
      evidenceId: "source-url-evidence",
      kind: "source_url",
      origin: "observed",
      value: "https://example.com/tomato-pasta",
    },
    {
      artifactReference: "source-manifest",
      evidenceId: "creator-evidence",
      kind: "creator",
      origin: "observed",
      value: "Chef Ada",
    },
    {
      artifactReference: "transcript",
      evidenceId: "landed-transcript-evidence",
      kind: "transcript",
      origin: "creator_provided",
      value:
        "Italian quick tomato pasta serves 2. Prep for 5 minutes, cook for 12 minutes, and it is ready in 17 minutes. Heat a large pan to 180 C. Add tomatoes and fresh pasta, then boil the fresh pasta. It is high protein.",
    },
  ],
} as const satisfies Pick<RecipeEvidenceAssembly, "items">;

const supportedFacts = (grounded: GroundedRecipeFactsType) =>
  [
    grounded.author,
    grounded.category,
    grounded.cookTimeMinutes,
    grounded.cuisine,
    grounded.description,
    grounded.name,
    grounded.nutrition,
    grounded.prepTimeMinutes,
    grounded.sourceUrl,
    grounded.temperatureCelsius,
    grounded.totalTimeMinutes,
    grounded.yield,
    ...(grounded.ingredientLines.state === "supported"
      ? grounded.ingredientLines.items
      : []),
    ...(grounded.instructions.state === "supported"
      ? grounded.instructions.items
      : []),
    ...(grounded.supportedClaims.state === "supported"
      ? grounded.supportedClaims.items
      : []),
    ...(grounded.tools.state === "supported" ? grounded.tools.items : []),
  ].filter((fact) => fact.state === "supported");

describe("recipe candidate grounding", () => {
  it("derives every supported claim only from landed evidence", () => {
    const grounded = groundRecipeCandidate(candidate, assembly.items);
    const evidenceById: ReadonlyMap<
      string,
      RecipeEvidenceAssembly["items"][number]
    > = new Map(assembly.items.map((item) => [item.evidenceId, item] as const));

    expect(Schema.is(GroundedRecipeFacts)(grounded)).toBe(true);
    for (const fact of supportedFacts(grounded)) {
      expect(fact.citations).not.toHaveLength(0);
      for (const citation of fact.citations) {
        const evidence = evidenceById.get(citation.evidenceId);
        expect(evidence).toBeDefined();
        expect(citation.origin).toBe(evidence?.origin);
      }
    }
  });

  it("marks unsupported selections unresolved exactly once", () => {
    const grounded = groundRecipeCandidate(
      Schema.decodeUnknownSync(RecipeCandidate)({
        ...candidate,
        category: "provider-invented-category",
        ingredientLines: ["tomatoes", "provider-invented mushrooms"],
      }),
      assembly.items
    );

    expect(grounded.category.state).toBe("unresolved");
    expect(grounded.ingredientLines).toMatchObject({
      items: [{ state: "supported", value: "tomatoes" }],
      state: "supported",
    });
    expect(
      grounded.unresolvedFields.filter((field) => field === "category")
    ).toHaveLength(1);
    expect(new Set(grounded.unresolvedFields).size).toBe(
      grounded.unresolvedFields.length
    );
    expect(JSON.stringify(grounded)).not.toContain("provider-invented");
  });
});

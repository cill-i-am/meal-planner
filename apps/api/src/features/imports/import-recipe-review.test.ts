import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { RecipeDraft } from "./import-recipe-draft.repository.d1.js";
import {
  RecipeCorrection,
  approvalBlockers,
  applyCorrectionOverlay,
} from "./import-recipe-review.js";

const citation = {
  citations: [
    {
      confidence: 1,
      evidenceId: "caption:fixture",
      origin: "creator_provided" as const,
    },
  ],
  origin: "creator_provided" as const,
  state: "supported" as const,
};

const supportedString = (value: string) => ({ ...citation, value });
const supportedNumber = (value: number) => ({ ...citation, value });
const supportedList = (values: readonly string[]) => ({
  items: values.map(supportedString),
  state: "supported" as const,
});
const unresolved = (reason: string) => ({
  citations: [] as const,
  origin: "unresolved" as const,
  reason,
  state: "unresolved" as const,
});

const draft = Schema.decodeUnknownSync(RecipeDraft)({
  createdAt: "2026-07-22T10:00:00.000Z",
  evidenceFingerprint:
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  extraction: {
    author: supportedString("Fixture Cook"),
    category: supportedString("Dinner"),
    cookTimeMinutes: supportedNumber(20),
    cost: {
      certainty: "known",
      currency: "USD",
      estimatedMicroUsd: 0,
    },
    cuisine: supportedString("Irish"),
    description: supportedString("A deterministic fixture."),
    ingredientLines: supportedList(["1 onion", "2 tomatoes"]),
    instructions: supportedList(["Chop the onion.", "Simmer for 20 minutes."]),
    name: unresolved("The title was not visible."),
    nutrition: unresolved("Nutrition was not stated."),
    prepTimeMinutes: supportedNumber(10),
    sourceUrl: supportedString(
      "https://www.tiktok.com/@fixture/video/7520000000000000001"
    ),
    supportedClaims: supportedList(["Simmer for 20 minutes."]),
    temperatureCelsius: unresolved("Temperature was not stated."),
    tools: supportedList(["Saucepan"]),
    totalTimeMinutes: supportedNumber(30),
    unresolvedFields: [
      "name",
      "nutrition",
      "temperature_celsius",
      "ingredient_quantities",
      "ingredient_units",
    ],
    usage: {
      inputEvidenceItems: 1,
      inputTokens: 0,
      latencyMilliseconds: 0,
      modelCalls: 1,
      outputTokens: 0,
    },
    yield: supportedString("2 servings"),
  },
  extractionFingerprint:
    "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  extractor: {
    model: "fixture-v1",
    provider: "deterministic_fake",
    version: "schema-1",
  },
  generation: 1,
  importId: "018f47ad-91aa-7c35-b6fe-000000000301",
  lifecycle: "needs_review",
  schemaVersion: 1,
});

describe("recipe review approval policy", () => {
  it("blocks only unresolved planning-required fields", () => {
    expect(approvalBlockers(draft, [])).toEqual({
      invalidFields: [],
      unresolvedRequiredFields: ["name"],
    });
  });

  it("uses an audited typed correction overlay without mutating extraction", () => {
    const correction = Schema.decodeUnknownSync(RecipeCorrection)({
      actorId: "private_api_credential",
      after: "Tomato and Onion Stew",
      before: null,
      correctedAt: "2026-07-22T10:01:00.000Z",
      field: "name",
      reason: "The title is visible in the cited caption frame.",
      version: 1,
    });

    expect(applyCorrectionOverlay(draft, [correction]).name).toBe(
      "Tomato and Onion Stew"
    );
    expect(approvalBlockers(draft, [correction])).toEqual({
      invalidFields: [],
      unresolvedRequiredFields: [],
    });
    expect(draft.extraction.name.state).toBe("unresolved");
  });
});

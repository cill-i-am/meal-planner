import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { RecipeDraftContent } from "../../packages/recipe-domain/src/content.js";
import {
  PersistedExtractionRun,
  acceptanceSha256,
  corpusSha256,
  evidenceSha256,
  grounderSha256,
  readCorpus,
  unavailableMeasurements,
} from "./model.js";
import type { PersistedExtractionOutput } from "./model.js";
import { compareRuns, scoreOutput, scoreRecipe, scoreRun } from "./score.js";
import { validateCorpus } from "./validate.js";

const corpus = readCorpus();
const parseRecipe = Schema.decodeUnknownSync(RecipeDraftContent);
const caseNamed = (id: string) => {
  const item = corpus.cases.find((entry) => entry.id === id);
  if (item === undefined) {
    throw new Error(`Missing test case ${id}`);
  }
  return item;
};
const outputFor = (id: string): PersistedExtractionOutput => {
  const item = caseNamed(id);
  return {
    caseId: id,
    evidenceSha256: evidenceSha256(item),
    failureCode: null,
    measurements: unavailableMeasurements,
    rawCandidate: Schema.encodeSync(Schema.Json)(item.expected),
    rawProviderResponse: null,
    status: "completed",
  };
};
const runWith = (outputs: readonly PersistedExtractionOutput[]) =>
  Schema.decodeUnknownSync(PersistedExtractionRun)({
    acceptanceSha256: acceptanceSha256(),
    corpusSha256: corpusSha256(corpus),
    corpusVersion: corpus.version,
    descriptor: { model: "none", provider: "none", version: "1" },
    execution: "scripted_fixture",
    grounderRevision: "test",
    grounderSha256: grounderSha256(),
    outputs,
    runId: "scripted-scorer-control",
    schemaVersion: 1,
    strategy: "oracle-control",
  });

describe("frozen recipe extraction evaluation", () => {
  it("validates disjoint evidence, complete source witnesses and qualifier expectations", () => {
    expect(validateCorpus(corpus)).toMatchObject({
      caseCount: 20,
      dev: 10,
      holdout: 10,
    });
    const item = caseNamed("components");
    expect(() =>
      validateCorpus({ ...corpus, cases: [...corpus.cases, item] })
    ).toThrow("Duplicate case");
    expect(() =>
      validateCorpus({ ...corpus, cases: [{ ...item, witnesses: [] }] })
    ).toThrow("lacks witness");
  });

  it("does not turn absent facts, absent output, or absent usage into perfect scores or zero cost", () => {
    const empty = scoreOutput(caseNamed("not-a-recipe"));
    expect(empty.raw.precision).toBeNull();
    expect(empty.raw.recall).toBeNull();
    expect(empty.measurements).toBeNull();
    const run = scoreRun(corpus, runWith([]), "dev");
    expect(run.coverage.missing).toBe(10);
    expect(run.raw.recall).toBe(0);
    expect(run.measurements.knownSpendMicroUsd).toMatchObject({
      measured: 0,
      total: null,
      unavailable: 10,
    });
    expect(run.measurements.providerInvocations.total).toBeNull();
  });

  it("scores acquisition losses separately and refuses hidden-source credit", () => {
    const item = caseNamed("late-evidence-missing");
    const score = scoreOutput(item, outputFor(item.id));
    expect(score.acquisition.availableFacts).toBeLessThan(
      score.acquisition.intendedFacts
    );
    expect(
      score.raw.unmatchedOracleFacts.some((fact) =>
        fact.path.startsWith("servings.")
      )
    ).toBe(true);
    expect(
      score.grounded.missingSourceFacts.some((fact) =>
        fact.path.startsWith("servings.")
      )
    ).toBe(false);
    expect(scoreOutput(caseNamed("silent-unobserved")).raw.recall).toBeNull();
  });

  it("rejects replay against changed evidence bytes", () => {
    const item = caseNamed("caption-complete");
    expect(() =>
      scoreOutput(item, { ...outputFor(item.id), evidenceSha256: "wrong" })
    ).toThrow("fingerprint differs");
  });

  it("rejects changed expectations and grounding under an unchanged corpus version", () => {
    const item = caseNamed("caption-complete");
    const run = runWith([outputFor(item.id)]);
    const changed = {
      ...corpus,
      cases: corpus.cases.map((entry) =>
        entry.id === item.id
          ? {
              ...entry,
              expected: { ...entry.expected, name: "Different expectation" },
            }
          : entry
      ),
    };
    expect(() => scoreRun(changed, run, "dev")).toThrow("fingerprint differs");
    expect(() =>
      scoreRun(corpus, { ...run, grounderSha256: "wrong" }, "dev")
    ).toThrow("fingerprint differs");
  });

  it("does not give unrelated instructions credit for generated step numbers", () => {
    const item = caseNamed("caption-complete");
    const instructions =
      item.expected.instructions?.map((instruction) => ({
        ...instruction,
        duration: null,
        temperature: null,
        text: "Throw away the food.",
      })) ?? null;
    const score = scoreRecipe(
      item,
      parseRecipe({ ...item.expected, instructions })
    );
    expect(score.fields["instruction_step"]).toBeUndefined();
    expect(score.instructionOrder).toEqual({
      accuracy: null,
      comparedPairs: 0,
      inOrderPairs: 0,
    });
  });

  it("checks relative order only among identity-matched instruction clauses", () => {
    const item = caseNamed("caption-complete");
    const instructions =
      item.expected.instructions
        ?.toReversed()
        .map((instruction, index) => ({ ...instruction, step: index + 1 })) ??
      null;
    const score = scoreRecipe(
      item,
      parseRecipe({ ...item.expected, instructions })
    );
    expect(score.instructionOrder).toEqual({
      accuracy: 0,
      comparedPairs: 1,
      inOrderPairs: 0,
    });
    expect(score.usable).toBe(false);
    expect(score.correctionOperations).toBe(1);
  });

  it("finds source-present quantities assigned to the wrong ingredient component", () => {
    const item = caseNamed("components");
    const ingredients =
      item.expected.ingredients?.map((ingredient, index) => ({
        ...ingredient,
        quantity: { max: null, unit: "g", value: index === 0 ? 50 : 200 },
      })) ?? null;
    const score = scoreRecipe(
      item,
      parseRecipe({ ...item.expected, ingredients })
    );
    expect(score.numericAssociationErrors.map((fact) => fact.path)).toEqual([
      "ingredients.0.quantity.value",
      "ingredients.1.quantity.value",
    ]);
    expect(score.fields["quantity"]).toMatchObject({
      falseNegative: 2,
      falsePositive: 2,
      truePositive: 0,
    });
    expect(score.usable).toBe(false);
  });

  it("matches ingredient reorderings one-to-one and penalizes duplicate rows", () => {
    const item = caseNamed("components");
    const rows = item.expected.ingredients;
    if (rows === null || rows[0] === undefined) {
      throw new Error("Expected component ingredients");
    }
    expect(
      scoreRecipe(
        item,
        parseRecipe({ ...item.expected, ingredients: rows.toReversed() })
      ).correctionOperations
    ).toBe(0);
    expect(
      scoreRecipe(item, { ...item.expected, ingredients: [...rows, rows[0]] })
        .falsePositive
    ).toBeGreaterThan(0);
  });

  it("counts range loss and swapped units independently without treating them as a correct quantity", () => {
    const item = caseNamed("range-unicode");
    const ingredients =
      item.expected.ingredients?.map((ingredient, index) =>
        index === 0
          ? { ...ingredient, quantity: { max: null, unit: "tsp", value: 2 } }
          : ingredient
      ) ?? null;
    const score = scoreRecipe(
      item,
      parseRecipe({ ...item.expected, ingredients })
    );
    expect(score.fields["quantity_range"]?.falseNegative).toBe(1);
    expect(score.fields["quantity_unit"]?.falsePositive).toBe(1);
    expect(score.completeIngredientQuantities.falsePositive).toBe(1);
    expect(score.completeIngredientQuantities.falseNegative).toBe(1);
  });

  it("detects dropped negation and conditions even when remaining words occur in the source", () => {
    const item = caseNamed("negative-optional");
    const instructions =
      item.expected.instructions?.map((instruction, index) => {
        const replacements = new Map([
          [1, "Add butter."],
          [2, "Add chives."],
        ]);
        return {
          ...instruction,
          text: replacements.get(index) ?? instruction.text,
        };
      }) ?? null;
    const score = scoreRecipe(
      item,
      parseRecipe({ ...item.expected, instructions })
    );
    expect(score.qualifierLosses.map((entry) => entry.kind)).toEqual([
      "negation",
      "condition",
    ]);
    expect(score.correctionOperations).toBeGreaterThan(0);
  });

  it("reports raw versus grounded loss instead of improving the oracle to fit grounding", () => {
    const item = caseNamed("compound-time");
    const score = scoreOutput(item, outputFor(item.id));
    expect(score.raw.falseNegative).toBe(0);
    expect(
      score.grounded.fields["step_duration"]?.falseNegative
    ).toBeGreaterThan(0);
    expect(score.grounded.correctionOperations).toBeGreaterThan(
      score.raw.correctionOperations
    );
  });

  it("keeps measured spend, conservative reservations and unavailable spend distinct", () => {
    const output = outputFor("caption-complete");
    const run = scoreRun(
      corpus,
      runWith([
        {
          ...output,
          measurements: {
            ...unavailableMeasurements,
            costReservationMicroUsd: 100_000,
          },
        },
      ]),
      "dev"
    );
    expect(run.measurements.knownSpendMicroUsd.total).toBeNull();
    expect(run.measurements.costReservationMicroUsd.total).toBe(100_000);
    expect(() =>
      scoreRun(
        corpus,
        runWith([
          {
            ...output,
            measurements: {
              ...unavailableMeasurements,
              providerSpendMicroUsd: { certainty: "unavailable", value: 0 },
            },
          },
        ]),
        "dev"
      )
    ).toThrow("Contradictory spend certainty");
  });

  it("excludes missing runs from paired comparisons and reports review-required rather than a fabricated winner", () => {
    const baseline = scoreRun(
      corpus,
      runWith([outputFor("caption-complete")]),
      "dev"
    );
    const missing = scoreRun(
      corpus,
      { ...runWith([]), runId: "missing-candidate" },
      "dev"
    );
    const comparison = compareRuns(baseline, missing);
    expect(comparison.decision).toBe("review_required");
    expect(comparison.pairedCases).toBe(0);
    expect(comparison.correctionOperationsDelta).toBeNull();
    expect(comparison.usableCasesDelta).toBeNull();
    expect(
      Object.values(comparison.fields).every((field) => field.paired === 0)
    ).toBe(true);
  });
});

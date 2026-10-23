import { Schema } from "effect";

import { groundRecipeCandidate } from "../../apps/api/src/features/imports/import-recipe-grounding.js";
import {
  RecipeDraftContent,
  recipeContentBlockers,
} from "../../packages/recipe-domain/src/content.js";
import {
  acceptanceSha256,
  corpusSha256,
  evidenceForCase,
  evidenceSha256,
  grounderSha256,
  scorerSha256,
} from "./model.js";
import type {
  ExtractionCase,
  ExtractionCorpus,
  PersistedExtractionOutput,
  PersistedExtractionRun,
} from "./model.js";

type FactValue = string | number | boolean;
export interface RecipeFact {
  readonly path: string;
  readonly field: string;
  readonly value: FactValue;
}
const unitAliases = new Map([
  ["grams", "g"],
  ["gram", "g"],
  ["kilograms", "kg"],
  ["kilogram", "kg"],
  ["millilitres", "ml"],
  ["milliliters", "ml"],
  ["litres", "l"],
  ["liters", "l"],
  ["tablespoons", "tbsp"],
  ["tablespoon", "tbsp"],
  ["teaspoons", "tsp"],
  ["teaspoon", "tsp"],
  ["cups", "cup"],
  ["servings", "serving"],
  ["portions", "serving"],
  ["portion", "serving"],
]);
const textKey = (value: string) =>
  value
    .normalize("NFC")
    .toLocaleLowerCase("en")
    .replaceAll(/\s+/gu, " ")
    .trim()
    .replace(/[.!]+$/u, "");
const comparable = (fact: RecipeFact) => {
  if (!Schema.is(Schema.String)(fact.value)) {
    return fact.value;
  }
  const normalized = textKey(fact.value);
  return fact.path.endsWith(".unit")
    ? (unitAliases.get(normalized) ?? normalized)
    : normalized;
};
const factField = (path: string) => {
  if (path.startsWith("ingredients.")) {
    if (path.endsWith("quantity.value")) {
      return "quantity";
    }
    if (path.endsWith("quantity.max")) {
      return "quantity_range";
    }
    if (path.endsWith("quantity.unit")) {
      return "quantity_unit";
    }
    if (path.endsWith(".group")) {
      return "ingredient_group";
    }
    return `ingredient_${path.split(".").at(-1) ?? "unknown"}`;
  }
  if (path.startsWith("instructions.")) {
    if (path.includes(".temperature.")) {
      return "temperature";
    }
    if (path.endsWith("duration.seconds")) {
      return "step_duration";
    }
    return `instruction_${path.split(".")[2] ?? "unknown"}`;
  }
  if (path.startsWith("servings.")) {
    return `yield_${path.split(".")[1] ?? "unknown"}`;
  }
  if (path.startsWith("times.")) {
    return `time_${path.split(".")[1] ?? "unknown"}`;
  }
  return path.split(".")[0] ?? path;
};

/** Only populated recipe facts count; absent optional fields never inflate accuracy. */
export const recipeFacts = (
  recipe: RecipeDraftContent
): readonly RecipeFact[] => {
  const facts: RecipeFact[] = [];
  const visit = (value: Schema.Json, path: string) => {
    if (
      value === null ||
      path.endsWith(".ingredientId") ||
      path.endsWith(".source") ||
      /^instructions\.\d+\.step$/u.test(path) ||
      /^instructions\.\d+\.(?:ingredients|techniques)/u.test(path)
    ) {
      return;
    }
    if (
      Schema.is(Schema.String)(value) ||
      Schema.is(Schema.Number)(value) ||
      Schema.is(Schema.Boolean)(value)
    ) {
      facts.push({ field: factField(path), path, value });
    } else if (Schema.is(Schema.Array(Schema.Json))(value)) {
      for (const [index, item] of value.entries()) {
        visit(item, `${path}.${index}`);
      }
    } else {
      for (const [key, item] of Object.entries(value)) {
        visit(item, path === "" ? key : `${path}.${key}`);
      }
    }
  };
  visit(Schema.encodeSync(Schema.Json)(recipe), "");
  return facts;
};

/** Ingredient row correspondence is fixed before scoring its nested values. */
const rowAlignment = (
  actual: RecipeDraftContent,
  expected: RecipeDraftContent
) => {
  const map = new Map<string, string>();
  const usedIngredients = new Set<number>();
  for (const [index, row] of (actual.ingredients ?? []).entries()) {
    const ranked =
      expected.ingredients
        ?.flatMap((target, targetIndex) => {
          if (usedIngredients.has(targetIndex)) {
            return [];
          }
          const original = textKey(row.original) === textKey(target.original);
          const name = textKey(row.name) === textKey(target.name);
          const group =
            row.group !== null &&
            target.group !== null &&
            textKey(row.group) === textKey(target.group);
          const score =
            Number(original) * 8 + Number(name) * 4 + Number(group) * 4;
          return score === 0 ? [] : [{ score, targetIndex }];
        })
        .toSorted(
          (left, right) =>
            right.score - left.score || left.targetIndex - right.targetIndex
        ) ?? [];
    const targetIndex = ranked[0]?.targetIndex;
    if (targetIndex !== undefined) {
      usedIngredients.add(targetIndex);
    }
    map.set(
      `ingredients.${index}`,
      `ingredients.${targetIndex ?? `extra${index}`}`
    );
  }
  const usedInstructions = new Set<number>();
  for (const [index, row] of (actual.instructions ?? []).entries()) {
    let targetIndex =
      expected.instructions?.findIndex(
        (target, position) =>
          !usedInstructions.has(position) &&
          textKey(row.text) === textKey(target.text)
      ) ?? -1;
    if (
      targetIndex === -1 &&
      expected.instructions?.[index] !== undefined &&
      !usedInstructions.has(index)
    ) {
      targetIndex = index;
    }
    if (targetIndex !== -1) {
      usedInstructions.add(targetIndex);
    }
    map.set(
      `instructions.${index}`,
      `instructions.${targetIndex === -1 ? `extra${index}` : targetIndex}`
    );
  }
  return map;
};
const alignedFacts = (
  actual: RecipeDraftContent,
  expected: RecipeDraftContent
) => {
  const alignment = rowAlignment(actual, expected);
  return recipeFacts(actual).map((fact) => {
    const prefix = /^(?:ingredients|instructions)\.\d+/u.exec(fact.path)?.[0];
    const replacement =
      prefix === undefined ? undefined : alignment.get(prefix);
    return replacement === undefined
      ? fact
      : { ...fact, path: fact.path.replace(prefix ?? "", replacement) };
  });
};

export const witnessForFact = (item: ExtractionCase, fact: RecipeFact) =>
  item.witnesses
    .filter(
      (witness) =>
        fact.path === witness.path || fact.path.startsWith(`${witness.path}.`)
    )
    .toSorted((left, right) => right.path.length - left.path.length)[0];

export const sourceFacts = (item: ExtractionCase, availableOnly: boolean) =>
  recipeFacts(item.expected).filter((fact) => {
    const witness = witnessForFact(item, fact);
    return (
      witness !== undefined &&
      (!availableOnly || item.availableEvidenceIds.includes(witness.evidenceId))
    );
  });
const equalsExpected = (
  actual: RecipeFact,
  expected: RecipeFact,
  item: ExtractionCase
) => {
  if (actual.path !== expected.path) {
    return false;
  }
  if (comparable(actual) === comparable(expected)) {
    return true;
  }
  return (
    Schema.is(Schema.String)(actual.value) &&
    (
      item.aliases.find((alias) => alias.path === expected.path)?.values ?? []
    ).some((value) => comparable({ ...expected, value }) === comparable(actual))
  );
};
const ratio = (numerator: number, denominator: number) =>
  denominator === 0 ? null : numerator / denominator;
const metric = (
  truePositive: number,
  falsePositive: number,
  falseNegative: number
) => ({
  falseNegative,
  falsePositive,
  precision: ratio(truePositive, truePositive + falsePositive),
  recall: ratio(truePositive, truePositive + falseNegative),
  truePositive,
});

export const scoreRecipe = (
  item: ExtractionCase,
  actual: RecipeDraftContent
) => {
  const expected = sourceFacts(item, true);
  const actualFacts = alignedFacts(actual, item.expected);
  const matched = actualFacts.filter((fact) =>
    expected.some((target) => equalsExpected(fact, target, item))
  );
  const unmatched = actualFacts.filter(
    (fact) => !expected.some((target) => equalsExpected(fact, target, item))
  );
  const missing = expected.filter(
    (fact) => !actualFacts.some((target) => equalsExpected(target, fact, item))
  );
  const numericAssociationErrors = unmatched.filter(
    (fact) =>
      Schema.is(Schema.Number)(fact.value) &&
      expected.some((target) => target.path === fact.path)
  );
  const qualifierLosses = item.qualifiers.flatMap((qualifier) => {
    const target = actualFacts.find((fact) => fact.path === qualifier.path);
    // Omission is recall loss; a shortened asserted clause is qualifier loss.
    if (target === undefined || !Schema.is(Schema.String)(target.value)) {
      return [];
    }
    const value = textKey(target.value);
    return qualifier.phrases.every((phrase) => value.includes(textKey(phrase)))
      ? []
      : [qualifier];
  });
  const fields = [
    ...new Set([...expected, ...actualFacts].map((fact) => fact.field)),
  ].toSorted();
  const quantityPrefixes = expected
    .filter((fact) => fact.field === "quantity")
    .map((fact) => fact.path.replace(/\.value$/u, ""));
  const matchedQuantities = quantityPrefixes.filter((prefix) => {
    const expectedParts = expected.filter((fact) =>
      fact.path.startsWith(`${prefix}.`)
    );
    const actualParts = actualFacts.filter((fact) =>
      fact.path.startsWith(`${prefix}.`)
    );
    return (
      expectedParts.length === actualParts.length &&
      expectedParts.every((fact) =>
        actualParts.some((target) => equalsExpected(target, fact, item))
      )
    );
  }).length;
  const alignment = rowAlignment(actual, item.expected);
  const matchedStepPositions = (actual.instructions ?? []).flatMap(
    (instruction, index) => {
      const prefix = alignment.get(`instructions.${index}`);
      const target = expected.find((fact) => fact.path === `${prefix}.text`);
      if (
        target === undefined ||
        prefix === undefined ||
        !equalsExpected(
          {
            field: "instruction_text",
            path: `${prefix}.text`,
            value: instruction.text,
          },
          target,
          item
        )
      ) {
        return [];
      }
      return [Number(prefix.split(".")[1])];
    }
  );
  let comparedPairs = 0;
  let inOrderPairs = 0;
  for (const [position, sourcePosition] of matchedStepPositions.entries()) {
    for (const later of matchedStepPositions.slice(position + 1)) {
      comparedPairs += 1;
      if (sourcePosition < later) {
        inOrderPairs += 1;
      }
    }
  }
  const orderCorrections = comparedPairs - inOrderPairs;
  const blockers = recipeContentBlockers(actual);
  return {
    ...metric(matched.length, unmatched.length, missing.length),
    blockers,
    completeIngredientQuantities: metric(
      matchedQuantities,
      actualFacts.filter((fact) => fact.field === "quantity").length -
        matchedQuantities,
      quantityPrefixes.length - matchedQuantities
    ),
    correctionOperations: unmatched.length + missing.length + orderCorrections,
    fields: Object.fromEntries(
      fields.map((field) => [
        field,
        metric(
          matched.filter((fact) => fact.field === field).length,
          unmatched.filter((fact) => fact.field === field).length,
          missing.filter((fact) => fact.field === field).length
        ),
      ])
    ),
    instructionOrder: {
      accuracy: ratio(inOrderPairs, comparedPairs),
      comparedPairs,
      inOrderPairs,
    },
    missingSourceFacts: missing,
    numericAssociationErrors,
    qualifierLosses,
    unmatchedOracleFacts: unmatched,
    usable:
      blockers.invalidFields.length === 0 &&
      blockers.unresolvedRequiredFields.length === 0 &&
      unmatched.length === 0 &&
      missing.length === 0 &&
      orderCorrections === 0,
  };
};
export type RecipeScore = ReturnType<typeof scoreRecipe>;

const emptyRecipe = Schema.decodeUnknownSync(RecipeDraftContent)({
  author: null,
  categories: [],
  cuisines: [],
  description: null,
  dietary: [],
  equipment: [],
  ingredients: null,
  instructions: null,
  language: null,
  media: [],
  name: null,
  notes: [],
  nutrition: null,
  servings: null,
  sourceTags: [],
  times: { cook: null, inactive: null, prep: null, total: null },
});

export const scoreOutput = (
  item: ExtractionCase,
  output?: PersistedExtractionOutput,
  ground: typeof groundRecipeCandidate = groundRecipeCandidate
) => {
  if (output !== undefined && output.evidenceSha256 !== evidenceSha256(item)) {
    throw new Error(`Evidence fingerprint differs: ${item.id}`);
  }
  const decoded = Schema.decodeUnknownResult(RecipeDraftContent, {
    onExcessProperty: "error",
  })(output?.rawCandidate);
  const complete = output?.status === "completed" && decoded._tag === "Success";
  const candidate = complete ? decoded.success : emptyRecipe;
  const grounded = ground(candidate, evidenceForCase(item)).recipe;
  const allFacts = sourceFacts(item, false);
  const suppliedFacts = sourceFacts(item, true);
  return {
    acquisition: {
      availableEvidenceItems: item.availableEvidenceIds.length,
      availableFactRecall: ratio(suppliedFacts.length, allFacts.length),
      availableFacts: suppliedFacts.length,
      intendedEvidenceItems: item.allEvidence.length,
      intendedFacts: allFacts.length,
    },
    caseId: item.id,
    executionStatus: output?.status ?? "missing",
    failureCode: output?.failureCode ?? null,
    grounded: scoreRecipe(item, grounded),
    measurements: output?.measurements ?? null,
    provenance: item.provenance.kind,
    raw: scoreRecipe(item, candidate),
    schemaValid: decoded._tag === "Success",
    split: item.split,
  };
};
export type ScoredCase = ReturnType<typeof scoreOutput>;

const totalScore = (scores: readonly RecipeScore[]) => {
  const sum = (select: (score: RecipeScore) => number) =>
    scores.reduce((value, score) => value + select(score), 0);
  const fields = [
    ...new Set(scores.flatMap((score) => Object.keys(score.fields))),
  ].toSorted();
  return {
    ...metric(
      sum((score) => score.truePositive),
      sum((score) => score.falsePositive),
      sum((score) => score.falseNegative)
    ),
    completeIngredientQuantities: metric(
      sum((score) => score.completeIngredientQuantities.truePositive),
      sum((score) => score.completeIngredientQuantities.falsePositive),
      sum((score) => score.completeIngredientQuantities.falseNegative)
    ),
    correctionOperations: sum((score) => score.correctionOperations),
    fields: Object.fromEntries(
      fields.map((field) => [
        field,
        metric(
          sum((score) => score.fields[field]?.truePositive ?? 0),
          sum((score) => score.fields[field]?.falsePositive ?? 0),
          sum((score) => score.fields[field]?.falseNegative ?? 0)
        ),
      ])
    ),
    numericAssociationErrors: sum(
      (score) => score.numericAssociationErrors.length
    ),
    qualifierLosses: sum((score) => score.qualifierLosses.length),
    usableCases: sum((score) => Number(score.usable)),
    usableRate: ratio(
      sum((score) => Number(score.usable)),
      scores.length
    ),
  };
};
const measuredDistribution = (
  values: readonly (number | null | undefined)[]
) => {
  const known = values
    .filter((value): value is number => value !== null && value !== undefined)
    .toSorted((left, right) => left - right);
  const lower = known[Math.floor((known.length - 1) / 2)];
  const upper = known[Math.floor(known.length / 2)];
  return {
    maximum: known.at(-1) ?? null,
    measured: known.length,
    median:
      lower === undefined || upper === undefined ? null : (lower + upper) / 2,
    total:
      known.length === 0 ? null : known.reduce((sum, value) => sum + value, 0),
    unavailable: values.length - known.length,
  };
};

export const scoreRun = (
  corpus: ExtractionCorpus,
  run: PersistedExtractionRun,
  split: "dev" | "holdout" | "all",
  grounding?: {
    readonly apply: typeof groundRecipeCandidate;
    readonly sha256: string;
  }
) => {
  const selectedGrounding = grounding ?? {
    apply: groundRecipeCandidate,
    sha256: grounderSha256(),
  };
  if (run.corpusVersion !== corpus.version) {
    throw new Error("Corpus version differs");
  }
  if (
    run.corpusSha256 !== corpusSha256(corpus) ||
    run.acceptanceSha256 !== acceptanceSha256() ||
    run.grounderSha256 !== selectedGrounding.sha256
  ) {
    throw new Error(
      "Frozen corpus, acceptance or grounder fingerprint differs"
    );
  }
  const ids = new Set<string>();
  for (const output of run.outputs) {
    if (
      ids.has(output.caseId) ||
      !corpus.cases.some((item) => item.id === output.caseId)
    ) {
      throw new Error(`Unknown or duplicate case: ${output.caseId}`);
    }
    ids.add(output.caseId);
    if (
      (output.measurements.providerSpendMicroUsd.certainty ===
        "unavailable") !==
      (output.measurements.providerSpendMicroUsd.value === null)
    ) {
      throw new Error(`Contradictory spend certainty: ${output.caseId}`);
    }
    if (
      (output.measurements.latencyMilliseconds === null) !==
      (output.measurements.latencySource === "unavailable")
    ) {
      throw new Error(`Contradictory latency source: ${output.caseId}`);
    }
    if (output.status === "completed" && output.rawCandidate === null) {
      throw new Error(`Completed output lacks candidate: ${output.caseId}`);
    }
    if (output.status === "failed" && output.failureCode === null) {
      throw new Error(`Failed output lacks failure: ${output.caseId}`);
    }
  }
  const cases = corpus.cases
    .filter((item) => split === "all" || item.split === split)
    .map((item) =>
      scoreOutput(
        item,
        run.outputs.find((output) => output.caseId === item.id),
        selectedGrounding.apply
      )
    );
  return {
    acceptanceSha256: run.acceptanceSha256,
    caseCount: cases.length,
    cases,
    corpusSha256: run.corpusSha256,
    corpusVersion: corpus.version,
    coverage: {
      completed: cases.filter(
        (item) => item.executionStatus === "completed" && item.schemaValid
      ).length,
      failed: cases.filter(
        (item) =>
          item.executionStatus === "failed" ||
          (item.executionStatus === "completed" && !item.schemaValid)
      ).length,
      missing: cases.filter((item) => item.executionStatus === "missing")
        .length,
      skipped: cases.filter((item) => item.executionStatus === "skipped")
        .length,
    },
    descriptor: run.descriptor,
    execution: run.execution,
    expectationReview: corpus.expectationReview,
    grounded: totalScore(cases.map((item) => item.grounded)),
    grounderRebinding: run.grounderRebinding ?? null,
    grounderRevision: run.grounderRevision,
    grounderSha256: run.grounderSha256,
    measurements: {
      costReservationMicroUsd: measuredDistribution(
        cases.map((item) => item.measurements?.costReservationMicroUsd)
      ),
      estimatedSpendMicroUsd: measuredDistribution(
        cases.map((item) =>
          item.measurements?.providerSpendMicroUsd.certainty === "estimated"
            ? item.measurements.providerSpendMicroUsd.value
            : null
        )
      ),
      fallbackInvocations: measuredDistribution(
        cases.map((item) => item.measurements?.fallbackInvocations)
      ),
      inputTokens: measuredDistribution(
        cases.map((item) => item.measurements?.inputTokens)
      ),
      internalPasses: measuredDistribution(
        cases.map((item) => item.measurements?.internalPasses)
      ),
      knownSpendMicroUsd: measuredDistribution(
        cases.map((item) =>
          item.measurements?.providerSpendMicroUsd.certainty === "known"
            ? item.measurements.providerSpendMicroUsd.value
            : null
        )
      ),
      latencyMilliseconds: measuredDistribution(
        cases.map((item) => item.measurements?.latencyMilliseconds)
      ),
      latencySources: {
        client_wall: cases.filter(
          (item) => item.measurements?.latencySource === "client_wall"
        ).length,
        provider_reported: cases.filter(
          (item) => item.measurements?.latencySource === "provider_reported"
        ).length,
        tool_wall: cases.filter(
          (item) => item.measurements?.latencySource === "tool_wall"
        ).length,
        unavailable: cases.filter(
          (item) =>
            item.measurements === null ||
            item.measurements.latencySource === "unavailable"
        ).length,
      },
      outputTokens: measuredDistribution(
        cases.map((item) => item.measurements?.outputTokens)
      ),
      providerInvocations: measuredDistribution(
        cases.map((item) => item.measurements?.providerInvocations)
      ),
      providerLatencyMilliseconds: measuredDistribution(
        cases.map((item) => item.measurements?.providerLatencyMilliseconds)
      ),
    },
    provenance:
      "Synthetic challenge corpus; not representative real-source or live acquisition performance.",
    raw: totalScore(cases.map((item) => item.raw)),
    runId: run.runId,
    schemaVersion: 1,
    scorerSha256: scorerSha256(),
    split,
    strategy: run.strategy,
  };
};
export type RunScore = ReturnType<typeof scoreRun>;

const measuredDelta = (
  before: number | null | undefined,
  after: number | null | undefined
) =>
  before === null ||
  before === undefined ||
  after === null ||
  after === undefined
    ? null
    : after - before;

const comparablePair = (
  left: ScoredCase,
  right: ScoredCase | undefined
): right is ScoredCase =>
  right !== undefined &&
  left.executionStatus === "completed" &&
  right.executionStatus === "completed" &&
  left.schemaValid &&
  right.schemaValid;

/** Paired descriptive counts, not a significance test or a release decision. */
export const compareRuns = (baseline: RunScore, candidate: RunScore) => {
  if (
    baseline.corpusVersion !== candidate.corpusVersion ||
    baseline.split !== candidate.split ||
    baseline.grounderRevision !== candidate.grounderRevision ||
    baseline.corpusSha256 !== candidate.corpusSha256 ||
    baseline.acceptanceSha256 !== candidate.acceptanceSha256 ||
    baseline.grounderSha256 !== candidate.grounderSha256 ||
    baseline.scorerSha256 !== candidate.scorerSha256 ||
    baseline.cases.length !== candidate.cases.length
  ) {
    throw new Error(
      "Paired reports require the same corpus, split and grounder revision"
    );
  }
  const fields = [
    ...new Set(
      [...baseline.cases, ...candidate.cases].flatMap((item) =>
        Object.keys(item.grounded.fields)
      )
    ),
  ].toSorted();
  const pairs = baseline.cases.flatMap((left) => {
    const right = candidate.cases.find((item) => item.caseId === left.caseId);
    return comparablePair(left, right) ? [{ left, right }] : [];
  });
  const attemptedPairCases = baseline.cases.filter((left) => {
    const right = candidate.cases.find((item) => item.caseId === left.caseId);
    const attempted = (status: ScoredCase["executionStatus"] | undefined) =>
      status === "completed" || status === "failed";
    return attempted(left.executionStatus) && attempted(right?.executionStatus);
  }).length;
  return {
    acceptanceSha256: baseline.acceptanceSha256,
    attemptedPairCases,
    baseline: { runId: baseline.runId, strategy: baseline.strategy },
    baselineCoverage: baseline.coverage,
    candidate: { runId: candidate.runId, strategy: candidate.strategy },
    candidateCoverage: candidate.coverage,
    corpusSha256: baseline.corpusSha256,
    corpusVersion: baseline.corpusVersion,
    correctionOperationsDelta:
      pairs.length === 0
        ? null
        : pairs.reduce(
            (sum, pair) =>
              sum +
              pair.right.grounded.correctionOperations -
              pair.left.grounded.correctionOperations,
            0
          ),
    decision: "review_required" as const,
    excludedCases: baseline.cases.length - pairs.length,
    fields: Object.fromEntries(
      fields.map((field) => {
        let improved = 0;
        let regressed = 0;
        let tied = 0;
        let paired = 0;
        const fieldPairs: {
          readonly caseId: string;
          readonly precisionDelta: number | null;
          readonly recallDelta: number | null;
          readonly correctionDelta: number;
        }[] = [];
        for (const left of baseline.cases) {
          const right = candidate.cases.find(
            (item) => item.caseId === left.caseId
          );
          if (!comparablePair(left, right)) {
            continue;
          }
          const before = left.grounded.fields[field];
          const after = right.grounded.fields[field];
          if (before === undefined && after === undefined) {
            continue;
          }
          paired += 1;
          const difference =
            (after?.falsePositive ?? 0) +
            (after?.falseNegative ?? 0) -
            ((before?.falsePositive ?? 0) + (before?.falseNegative ?? 0));
          fieldPairs.push({
            caseId: left.caseId,
            correctionDelta: difference,
            precisionDelta: measuredDelta(before?.precision, after?.precision),
            recallDelta: measuredDelta(before?.recall, after?.recall),
          });
          if (difference < 0) {
            improved += 1;
          } else if (difference > 0) {
            regressed += 1;
          } else {
            tied += 1;
          }
        }
        return [
          field,
          { improved, paired, pairs: fieldPairs, regressed, tied },
        ];
      })
    ),
    groundedNumericAssociationErrors:
      candidate.grounded.numericAssociationErrors,
    groundedQualifierLosses: candidate.grounded.qualifierLosses,
    grounderRevision: baseline.grounderRevision,
    grounderSha256: baseline.grounderSha256,
    pairedCases: pairs.length,
    reasons: [
      "Small synthetic smoke/regression corpus cannot establish representative quality.",
      "Every unmatched oracle fact needs source review before it is called unsupported.",
      "No paid-call or latency benefit is established by unmeasured values.",
      "Holdout strategy versions must be frozen before inspection; repeated tuning invalidates holdout.",
    ],
    scorerSha256: baseline.scorerSha256,
    split: baseline.split,
    unmatchedGroundedFacts: candidate.grounded.falsePositive,
    usableCasesDelta:
      pairs.length === 0
        ? null
        : pairs.reduce(
            (sum, pair) =>
              sum +
              Number(pair.right.grounded.usable) -
              Number(pair.left.grounded.usable),
            0
          ),
  };
};

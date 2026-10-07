import { deepStrictEqual, equal, ok } from "node:assert/strict";

import { Schema } from "effect";

import {
  ProfileFactId,
  ProfileFactStanding,
  ProfileFactValue,
  ProfileVersion,
} from "../../packages/household-api/src/profiles.js";
import { ProfileCardChange } from "../../packages/private-interview-api/src/index.js";
import calibrationAsset from "./calibration.template.json" with { type: "json" };
import evidenceAsset from "./evidence.template.json" with { type: "json" };
import usageAsset from "./provider-usage-policy.json" with { type: "json" };
import rubricAsset from "./rubric.json" with { type: "json" };
import suiteAsset from "./scenarios.json" with { type: "json" };

export const privateDiscoveryAssets = {
  calibration: calibrationAsset,
  evidence: evidenceAsset,
  rubric: rubricAsset,
  suite: suiteAsset,
  usage: usageAsset,
};

export const validatePrivateDiscoveryAssets = (
  assets: typeof privateDiscoveryAssets
) => {
  const { calibration, evidence, usage, rubric, suite } = assets;
  equal(
    rubric.authority,
    "https://github.com/cill-i-am/meal-planner/blob/a28a527759d2d5d5580f4d6d9a673f08b6d80de9/docs/decisions/pdr-0006-ai-evaluation-and-release-evidence.md",
    "Rubric authority must retain its immutable historical provenance"
  );
  equal(usage.version, 2);
  equal(
    usage.maximumProviderAttemptsPerTurn,
    (1 + usage.sdkMaximumRetries) * usage.gatewayMaximumAttemptsPerSdkRequest
  );
  equal(usage.unknownUsage, "report_unavailable");

  const families = [
    "simple_household_baseline",
    "conflicting_adult_routines",
    "dependants_and_fallbacks",
    "mixed_dietary_household",
    "hard_constraint_household",
    "routine_heavy_household",
    "capacity_constrained_week",
    "dependency_and_repair",
  ];
  deepStrictEqual(
    suite.scenarios.map((scenario) => scenario.id),
    families
  );
  deepStrictEqual(
    calibration.productOwnerReview.map((review) => review.scenarioId),
    families
  );
  equal(calibration.scenarioVersion, suite.version);
  equal(calibration.rubricVersion, rubric.version);
  equal(evidence.versions.scenarios.version, suite.version);
  equal(evidence.versions.rubric.version, rubric.version);
  equal(evidence.versions.calibration.version, calibration.version);

  const deferred = new Set(rubric.deferredObligations.map((item) => item.id));
  for (const obligation of rubric.deferredObligations) {
    equal(obligation.status, "not_exercised");
  }
  for (const scenario of suite.scenarios) {
    const profile = scenario.candidateContext.ownProfile;
    Schema.decodeUnknownSync(ProfileVersion)(profile.version);
    for (const fact of profile.facts) {
      Schema.decodeUnknownSync(ProfileFactId)(fact.id);
      Schema.decodeUnknownSync(ProfileFactValue)(fact.value);
      Schema.decodeUnknownSync(ProfileFactStanding)(fact.standing);
    }
    const oracle = scenario.evaluatorOnly;
    const factIds = [
      ...oracle.knownFacts.map((fact) => fact.id),
      ...oracle.withheldFacts.map((fact) => fact.id),
      oracle.challenge.id,
    ];
    const facts = new Set(factIds);
    equal(facts.size, factIds.length, `${scenario.id}: duplicate fact ID`);
    for (const factId of oracle.requiredDiscoveries) {
      ok(facts.has(factId), `${scenario.id}: unknown discovery ${factId}`);
    }
    for (const card of oracle.expectedCards) {
      Schema.decodeUnknownSync(ProfileCardChange)(card.change);
      for (const factId of card.supports) {
        ok(facts.has(factId), `${card.id}: unknown support ${factId}`);
      }
    }
    for (const obligation of oracle.deferredObligations) {
      ok(deferred.has(obligation), `${scenario.id}: unknown deferred owner`);
    }
    ok(oracle.hardAssertions.length > 0);
    ok(oracle.prohibitedClaims.length > 0);
  }

  deepStrictEqual(
    rubric.criticalSoftDimensions.map((dimension) => dimension.id),
    ["household_specificity", "profile_synthesis"]
  );
  for (const dimension of rubric.criticalSoftDimensions) {
    deepStrictEqual(Object.keys(dimension.anchors), ["1", "2", "3", "4", "5"]);
  }
  equal(evidence.status, "not_run");
  equal(evidence.scenarioResults.length, 0);
  equal(evidence.releaseDecision.status, "not_assessed");
  equal(calibration.status, "unscored");
  equal(calibration.acceptedBaselineId, null);
  for (const review of calibration.productOwnerReview) {
    equal(review.status, "unscored");
    equal(review.household_specificity, null);
    equal(review.profile_synthesis, null);
    equal(review.reviewerRole, null);
  }
};

import { deepStrictEqual, equal, ok } from "node:assert/strict";

import { Schema } from "effect";

import {
  ProfileFactId,
  ProfileFactStanding,
  ProfileFactValue,
  ProfileVersion,
} from "../../packages/household-api/src/profiles.js";
import { ProfileCardChange } from "../../packages/private-interview-api/src/index.js";
import calibration from "./calibration.template.json" with { type: "json" };
import evidence from "./evidence.template.json" with { type: "json" };
import rubric from "./rubric.json" with { type: "json" };
import suite from "./scenarios.json" with { type: "json" };

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

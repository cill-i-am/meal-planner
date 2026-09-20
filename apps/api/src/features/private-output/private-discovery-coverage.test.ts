import { ProfileFactId } from "@meal-planner/household-api";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  applyPrivateDiscoveryContinuation,
  emptyPrivateDiscoveryContinuity,
  emptyPrivateDiscoveryContinuityUpdates,
} from "./private-discovery-continuity.js";
import {
  applyPrivateDiscoveryCoverageUpdates,
  emptyPrivateDiscoveryCoverage,
  emptyPrivateDiscoveryCoverageUpdates,
  PrivateDiscoveryCoverage,
  PrivateDiscoveryCoverageFailure,
  PrivateDiscoveryCoverageUpdates,
  profileAddressesFoodRestrictions,
} from "./private-discovery-coverage.js";
import type { PrivateDiscoveryEvidenceMessage } from "./private-discovery-needs.js";

const participant: PrivateDiscoveryEvidenceMessage = {
  id: "00000000-0000-4000-8000-000000000001",
  role: "participant",
  text: "I have no food restrictions. Usually I have toast for breakfast. I'd rather not discuss my meals. Actually, I want to talk about meals now. I don't know.",
};
const evidence = (quote: string) => ({ messageId: participant.id, quote });
const run = (
  current: typeof PrivateDiscoveryCoverage.Type,
  update: typeof PrivateDiscoveryCoverageUpdates.Type
) => applyPrivateDiscoveryCoverageUpdates(current, update, participant);

describe("application-owned private discovery coverage", () => {
  it("requires both topic keys and rejects model-owned states, labels and questions", () => {
    for (const invalid of [
      {},
      { foodRestrictions: null },
      { usualMeals: null },
      {
        foodRestrictions: null,
        usualMeals: {
          _tag: "RecordAnswer",
          evidence: evidence("toast for breakfast"),
          revisit: null,
          value: { description: "   " },
        },
      },
      {
        foodRestrictions: null,
        usualMeals: { _tag: "Unanswered" },
      },
      {
        foodRestrictions: null,
        usualMeals: {
          _tag: "RecordAnswer",
          evidence: evidence("toast for breakfast"),
          revisit: null,
          subject: "usual meals",
          value: { description: "Toast for breakfast" },
        },
      },
    ]) {
      expect(() =>
        Schema.decodeUnknownSync(PrivateDiscoveryCoverageUpdates)(invalid)
      ).toThrow();
    }
  });

  it("initializes every required topic and preserves an answer and its evidence across null and restart", () => {
    const initial = emptyPrivateDiscoveryCoverage();
    expect(initial).toEqual({
      foodRestrictions: { _tag: "Unanswered" },
      usualMeals: { _tag: "Unanswered" },
    });
    const answered = run(initial, {
      foodRestrictions: {
        _tag: "RecordAnswer",
        evidence: evidence("I have no food restrictions."),
        revisit: null,
        value: { _tag: "NoKnownHardConstraints" },
      },
      usualMeals: null,
    });
    const json = Schema.fromJsonString(PrivateDiscoveryCoverage);
    const restored = Schema.decodeUnknownSync(json)(
      Schema.encodeSync(json)(answered)
    );
    expect(run(restored, emptyPrivateDiscoveryCoverageUpdates())).toEqual(
      answered
    );
    expect(answered.usualMeals._tag).toBe("Unanswered");
  });

  it("records unknown and refusal without producing an answer or safety clearance", () => {
    const unknown = run(emptyPrivateDiscoveryCoverage(), {
      foodRestrictions: {
        _tag: "RecordNoInformation",
        evidence: evidence("I don't know."),
        revisit: null,
      },
      usualMeals: {
        _tag: "RecordDecline",
        evidence: evidence("I'd rather not discuss my meals."),
      },
    });
    expect(unknown.foodRestrictions._tag).toBe("NoInformation");
    expect(unknown.usualMeals._tag).toBe("Declined");
    expect("value" in unknown.foodRestrictions).toBe(false);
    expect(profileAddressesFoodRestrictions([])).toBe(false);
  });

  it("requires current explicit revisit evidence when answering a declined topic", () => {
    const declined = run(emptyPrivateDiscoveryCoverage(), {
      foodRestrictions: null,
      usualMeals: {
        _tag: "RecordDecline",
        evidence: evidence("I'd rather not discuss my meals."),
      },
    });
    const answer = {
      _tag: "RecordAnswer" as const,
      evidence: evidence("Usually I have toast for breakfast."),
      revisit: null,
      value: { description: "Toast for breakfast" },
    };
    expect(() =>
      run(declined, { foodRestrictions: null, usualMeals: answer })
    ).toThrow(PrivateDiscoveryCoverageFailure);
    const revisit = evidence("Actually, I want to talk about meals now.");
    const next = run(declined, {
      foodRestrictions: null,
      usualMeals: { ...answer, revisit },
    });
    expect(next.usualMeals).toMatchObject({
      _tag: "Answered",
      reopenedBy: revisit,
    });
    expect(run(next, emptyPrivateDiscoveryCoverageUpdates())).toEqual(next);
  });

  it("rejects older, assistant and invented evidence before changing state", () => {
    const initial = emptyPrivateDiscoveryCoverage();
    const update = {
      ...emptyPrivateDiscoveryCoverageUpdates(),
      usualMeals: {
        _tag: "RecordAnswer" as const,
        evidence: evidence("toast for breakfast"),
        revisit: null,
        value: { description: "Toast for breakfast" },
      },
    };
    for (const invalidEvidence of [
      {
        ...update.usualMeals.evidence,
        messageId: "00000000-0000-4000-8000-000000000002",
      },
      evidence("invented answer"),
    ]) {
      expect(() =>
        run(initial, {
          ...update,
          usualMeals: { ...update.usualMeals, evidence: invalidEvidence },
        })
      ).toThrow();
    }
    expect(() =>
      applyPrivateDiscoveryCoverageUpdates(initial, update, {
        ...participant,
        role: "assistant",
      })
    ).toThrow();
    expect(initial).toEqual(emptyPrivateDiscoveryCoverage());
  });

  it("requires a nonempty typed restriction list and recognizes saved safety facts only", () => {
    expect(() =>
      Schema.decodeUnknownSync(PrivateDiscoveryCoverageUpdates)({
        foodRestrictions: {
          _tag: "RecordAnswer",
          evidence: evidence("I have no food restrictions."),
          revisit: null,
          value: { _tag: "Restrictions", restrictions: [] },
        },
        usualMeals: null,
      })
    ).toThrow();
    expect(
      profileAddressesFoodRestrictions([
        {
          standing: { _tag: "confirmed", basis: "self" },
          value: { _tag: "NoKnownHardConstraints" },
        },
      ])
    ).toBe(true);
    expect(
      profileAddressesFoodRestrictions([
        {
          standing: { _tag: "confirmed", basis: "self" },
          value: {
            _tag: "FoodPreference",
            label: "pasta",
            sentiment: "like",
            targetKind: "dish",
          },
        },
      ])
    ).toBe(false);
  });
  it("asks application-owned safety and usual-meal questions even when the model supplies no topics", () => {
    const policy = { profileFacts: [], scope: "InitialDiscovery" as const };
    const first = applyPrivateDiscoveryContinuation(
      emptyPrivateDiscoveryContinuity(),
      emptyPrivateDiscoveryContinuityUpdates(),
      { _tag: "Continue" },
      participant,
      [],
      policy
    );
    expect(first.decision).toMatchObject({
      _tag: "Ask",
      source: { _tag: "RequiredTopic", topic: "foodRestrictions" },
    });
    const safety = applyPrivateDiscoveryContinuation(
      first.continuity,
      {
        ...emptyPrivateDiscoveryContinuityUpdates(),
        coverage: {
          foodRestrictions: {
            _tag: "RecordNoInformation",
            evidence: evidence("I don't know."),
            revisit: null,
          },
          usualMeals: null,
        },
      },
      { _tag: "Continue" },
      participant,
      [],
      policy
    );
    expect(safety.decision).toMatchObject({
      _tag: "Ask",
      source: { _tag: "RequiredTopic", topic: "usualMeals" },
    });
    const resumed = applyPrivateDiscoveryContinuation(
      safety.continuity,
      emptyPrivateDiscoveryContinuityUpdates(),
      { _tag: "Continue" },
      participant,
      [],
      policy
    );
    expect(resumed.decision).toEqual(safety.decision);
    const settled = applyPrivateDiscoveryContinuation(
      resumed.continuity,
      {
        ...emptyPrivateDiscoveryContinuityUpdates(),
        coverage: {
          foodRestrictions: null,
          usualMeals: {
            _tag: "RecordDecline",
            evidence: evidence("I'd rather not discuss my meals."),
          },
        },
      },
      { _tag: "Continue" },
      participant,
      [],
      policy
    );
    expect(settled.decision).toEqual({ _tag: "Review" });
    expect(settled.continuity.coverage.foodRestrictions._tag).toBe(
      "NoInformation"
    );
  });

  it("does not let optional generic notes settle required coverage or let a profile edit introduce that agenda", () => {
    const changes = {
      ...emptyPrivateDiscoveryContinuityUpdates(),
      notes: [
        {
          detail: "Model claims everything is finished.",
          key: "usual_meals",
          subject: "Usual meals",
        },
      ],
    };
    const initial = applyPrivateDiscoveryContinuation(
      emptyPrivateDiscoveryContinuity(),
      changes,
      { _tag: "Continue" },
      participant,
      [],
      { profileFacts: [], scope: "InitialDiscovery" }
    );
    expect(initial.decision).toMatchObject({
      _tag: "Ask",
      source: { topic: "foodRestrictions" },
    });
    const edit = applyPrivateDiscoveryContinuation(
      emptyPrivateDiscoveryContinuity(),
      emptyPrivateDiscoveryContinuityUpdates(),
      { _tag: "Continue" },
      participant,
      [],
      { profileFacts: [], scope: "ProfileEdit" }
    );
    expect(edit.decision).toEqual({ _tag: "Review" });
    expect(edit.continuity.coverage).toEqual(emptyPrivateDiscoveryCoverage());
  });

  it("uses fresh confirmed profile safety facts without manufacturing an answer and reopens the question when that source disappears", () => {
    const current = emptyPrivateDiscoveryContinuity();
    const apply = (
      profileFacts: Parameters<typeof profileAddressesFoodRestrictions>[0]
    ) =>
      applyPrivateDiscoveryContinuation(
        current,
        emptyPrivateDiscoveryContinuityUpdates(),
        { _tag: "Continue" },
        participant,
        [],
        {
          profileFacts: profileFacts.map((fact) => ({
            id: Schema.decodeUnknownSync(ProfileFactId)(
              `fact_${participant.id}`
            ),
            ...fact,
          })),
          scope: "InitialDiscovery",
        }
      );
    const value = { _tag: "NoKnownHardConstraints" as const };
    expect(
      apply([{ standing: { _tag: "provisional" }, value }]).decision
    ).toMatchObject({ source: { topic: "foodRestrictions" } });
    const known = apply([
      { standing: { _tag: "confirmed", basis: "self" }, value },
    ]);
    expect(known.decision).toMatchObject({ source: { topic: "usualMeals" } });
    expect(known.continuity.coverage.foodRestrictions._tag).toBe("Unanswered");
    expect(apply([]).decision).toMatchObject({
      source: { topic: "foodRestrictions" },
    });
  });

  it("stops without converting unfinished coverage into an answer or readiness", () => {
    const before = emptyPrivateDiscoveryContinuity();
    const stopParticipant = { ...participant, text: "Stop here please." };
    const stopped = applyPrivateDiscoveryContinuation(
      before,
      emptyPrivateDiscoveryContinuityUpdates(),
      {
        _tag: "Stop",
        evidence: { messageId: participant.id, quote: stopParticipant.text },
      },
      stopParticipant,
      [],
      { profileFacts: [], scope: "InitialDiscovery" }
    );
    expect(stopped.decision).toEqual({ _tag: "Stop" });
    expect(stopped.continuity).toEqual(before);
  });

  it("asks a precise safety clarification before the broad required topic without clearing coverage", () => {
    const before = emptyPrivateDiscoveryContinuity();
    const result = applyPrivateDiscoveryContinuation(
      before,
      {
        ...emptyPrivateDiscoveryContinuityUpdates(),
        clarification: {
          _tag: "Request",
          evidence: evidence("I have no food restrictions."),
          request: { _tag: "SafetyMeaning", factId: null },
          revisit: null,
          safetyRevisit: null,
        },
      },
      { _tag: "Continue" },
      participant,
      [],
      { profileFacts: [], scope: "InitialDiscovery" }
    );
    expect(result.decision).toMatchObject({
      _tag: "Ask",
      source: { _tag: "ProfileClarification" },
    });
    expect(result.continuity.coverage).toEqual(before.coverage);
    const resumed = applyPrivateDiscoveryContinuation(
      result.continuity,
      {
        ...emptyPrivateDiscoveryContinuityUpdates(),
        clarification: {
          _tag: "RecordAnswer",
          evidence: evidence("I have no food restrictions."),
          revisit: null,
        },
      },
      { _tag: "Continue" },
      participant,
      [],
      { profileFacts: [], scope: "InitialDiscovery" }
    );
    expect(resumed.decision).toMatchObject({
      _tag: "Ask",
      source: { topic: "foodRestrictions" },
    });
  });
});

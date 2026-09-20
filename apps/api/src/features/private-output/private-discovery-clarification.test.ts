import { ProfileFactId } from "@meal-planner/household-api";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  applyPrivateDiscoveryClarification,
  PrivateDiscoveryClarificationUpdate,
  privateDiscoveryClarificationQuestion,
} from "./private-discovery-clarification.js";
import { emptyPrivateDiscoveryCoverage } from "./private-discovery-coverage.js";

const participant = {
  id: crypto.randomUUID(),
  role: "participant" as const,
  text: "I mean my own food. I do not want to discuss restrictions. Actually, we can talk about that now. I do not know.",
};
const evidence = { messageId: participant.id, quote: "I mean my own food." };
const permission = {
  messageId: participant.id,
  quote: "Actually, we can talk about that now.",
};
const coverage = emptyPrivateDiscoveryCoverage();
const request = {
  _tag: "Request" as const,
  evidence,
  request: { _tag: "ProfileTarget" as const },
  revisit: null,
  safetyRevisit: null,
};
const apply = (
  current: Parameters<typeof applyPrivateDiscoveryClarification>[0],
  update: Parameters<typeof applyPrivateDiscoveryClarification>[1],
  safety = coverage,
  newlyDeclined = false
) =>
  applyPrivateDiscoveryClarification(
    current,
    update,
    participant,
    [],
    safety,
    newlyDeclined
  );

describe("closed application-owned profile clarification", () => {
  it("preserves a pending fixed question across omission and resolves only with current evidence", () => {
    const pending = apply({ _tag: "None" }, request);
    expect(privateDiscoveryClarificationQuestion(pending)).toBe(
      "Does that describe your own food needs, or someone else's?"
    );
    expect(apply(pending, null)).toEqual(pending);
    expect(() =>
      apply(pending, {
        _tag: "RecordAnswer",
        evidence: { ...evidence, messageId: crypto.randomUUID() },
        revisit: null,
      })
    ).toThrow();
    const answered = apply(pending, {
      _tag: "RecordAnswer",
      evidence,
      revisit: null,
    });
    expect(privateDiscoveryClarificationQuestion(answered)).toBeNull();
  });
  it("rejects arbitrary questions, ordinary-meal reasons, unknown fact IDs and silent pending replacement", () => {
    expect(() =>
      Schema.decodeUnknownSync(PrivateDiscoveryClarificationUpdate)({
        ...request,
        question: "What do you usually eat?",
      })
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(PrivateDiscoveryClarificationUpdate)({
        ...request,
        request: { _tag: "UsualMeals" },
      })
    ).toThrow();
    expect(() =>
      apply(
        { _tag: "None" },
        {
          ...request,
          request: {
            _tag: "ProfileEffect",
            factId: Schema.decodeUnknownSync(ProfileFactId)(
              `fact_${crypto.randomUUID()}`
            ),
          },
        }
      )
    ).toThrow(expect.objectContaining({ stage: "clarification_target" }));
    expect(() =>
      apply(apply({ _tag: "None" }, request), {
        ...request,
        request: { _tag: "ProfileEffect", factId: null },
      })
    ).toThrow();
  });
  it("requires explicit revisit permission for a declined clarification", () => {
    const declined = apply(apply({ _tag: "None" }, request), {
      _tag: "RecordDecline",
      evidence,
    });
    expect(() => apply(declined, request)).toThrow();
    expect(apply(declined, { ...request, revisit: permission })._tag).toBe(
      "Pending"
    );
    expect(
      apply(declined, {
        _tag: "RecordNoInformation",
        evidence,
        revisit: permission,
      })._tag
    ).toBe("NoInformation");
  });
  it("cannot ask a safety clarification after fixed-topic refusal without separate current permission", () => {
    const safety = {
      ...coverage,
      foodRestrictions: { _tag: "Declined" as const, evidence },
    };
    const safetyRequest = {
      ...request,
      request: { _tag: "SafetyMeaning" as const, factId: null },
    };
    expect(() => apply({ _tag: "None" }, safetyRequest, safety)).toThrow();
    const reopened = apply(
      { _tag: "None" },
      { ...safetyRequest, safetyRevisit: permission },
      safety
    );
    expect(reopened._tag).toBe("Pending");
    expect(safety.foodRestrictions._tag).toBe("Declined");
    expect(apply(reopened, null, safety, true)._tag).toBe("Declined");
  });
  it("recognizes a saved safety target even when the request is about its profile effect", () => {
    const fact = {
      id: Schema.decodeUnknownSync(ProfileFactId)(
        `fact_${crypto.randomUUID()}`
      ),
      value: { _tag: "NoKnownHardConstraints" as const },
    };
    const safety = {
      ...coverage,
      foodRestrictions: { _tag: "Declined" as const, evidence },
    };
    expect(() =>
      applyPrivateDiscoveryClarification(
        { _tag: "None" },
        { ...request, request: { _tag: "ProfileEffect", factId: fact.id } },
        participant,
        [fact],
        safety,
        false
      )
    ).toThrow();
  });
  it("retires a missing saved target before processing a new safety refusal and never retargets it", () => {
    const id = Schema.decodeUnknownSync(ProfileFactId)(
      `fact_${crypto.randomUUID()}`
    );
    const saved = [{ id, value: { _tag: "NoKnownHardConstraints" as const } }];
    const pending = applyPrivateDiscoveryClarification(
      { _tag: "None" },
      {
        ...request,
        request: { _tag: "ProfileEffect", factId: id },
      },
      participant,
      saved,
      coverage,
      false
    );
    const declined = {
      ...coverage,
      foodRestrictions: { _tag: "Declined" as const, evidence },
    };
    const retired = applyPrivateDiscoveryClarification(
      pending,
      null,
      participant,
      [],
      declined,
      true
    );
    expect(retired).toMatchObject({
      _tag: "TargetUnavailable",
      evidence,
      request: { _tag: "ProfileEffect", factId: id },
    });
    expect(privateDiscoveryClarificationQuestion(retired)).toBeNull();
    expect(
      applyPrivateDiscoveryClarification(
        retired,
        null,
        participant,
        saved,
        declined,
        false
      )
    ).toEqual(retired);
  });
});

import { describe, expect, it } from "vitest";

import { readStoredProfilePayload } from "./profiles.js";

const readPendingProfilePayload = (json: string) =>
  readStoredProfilePayload(JSON.parse(json));

const fact = {
  _tag: "FoodPreference",
  label: "Peas",
  sentiment: "like",
  targetKind: "ingredient",
};
const payload = {
  command: { _tag: "AddProfileFact", fact },
  expectedProfileVersion: 4,
  mutationId: "pending-before-upgrade",
};

describe("private pending profile storage", () => {
  it("reads new intents and recovers existing frozen commands without authority labels", () => {
    expect(readPendingProfilePayload(JSON.stringify(payload))).toEqual(payload);
    expect(
      readPendingProfilePayload(
        JSON.stringify({
          ...payload,
          command: { _tag: "AddConfirmedProfileFact", basis: "self", fact },
        })
      )
    ).toEqual(payload);
    expect(
      readPendingProfilePayload(
        JSON.stringify({
          ...payload,
          command: {
            _tag: "ConfirmProfileFact",
            basis: "self",
            factId: "fact_00000000-0000-4000-8000-000000000101",
          },
        })
      )
    ).toMatchObject({
      command: {
        _tag: "ConfirmProfileFact",
        factId: "fact_00000000-0000-4000-8000-000000000101",
      },
    });
  });

  it("retains the explicit safety marker and rejects invented pending authority", () => {
    const command = {
      _tag: "ConfirmHardConstraintReduction",
      confirmation: "I confirm this safety constraint change",
      factId: "fact_00000000-0000-4000-8000-000000000101",
      replacement: null,
    };
    expect(
      readPendingProfilePayload(JSON.stringify({ ...payload, command }))
    ).toEqual({ ...payload, command });
    expect(() =>
      readPendingProfilePayload(
        JSON.stringify({
          ...payload,
          command: { _tag: "AddConfirmedProfileFact", basis: "model", fact },
        })
      )
    ).toThrow();
    expect(() =>
      readPendingProfilePayload(
        JSON.stringify({
          ...payload,
          command: { ...command, confirmation: undefined },
        })
      )
    ).toThrow();
  });
});

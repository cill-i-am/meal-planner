import { Arbitrary, Effect, Option, Schema } from "effect";
import { expect, it } from "vitest";

import {
  MutatePersonProfilePayload,
  ProfileFactValue,
  ProfileFactStanding,
} from "./profiles.js";

it("round trips every closed fact family with bounded labels", async () => {
  const result = await Effect.runPromise(
    Arbitrary.checkEffect(
      Arbitrary.schema(ProfileFactValue),
      (value) => {
        const decoded = Schema.decodeUnknownSync(ProfileFactValue)(value);
        expect(Schema.encodeSync(ProfileFactValue)(decoded)).toEqual(value);
        return Option.isNone(
          Schema.decodeUnknownOption(ProfileFactValue, {
            onExcessProperty: "error",
          })({
            ...value,
            transcript: "private",
          })
        );
      },
      { runs: 150, seed: 1303 }
    )
  );
  expect(result, Arbitrary.formatCheckFailure(result)).toMatchObject({
    _tag: "Passed",
    runs: 150,
  });
});

it("rejects unbounded labels, invented source or standing, and command authority injection", () => {
  const base = {
    _tag: "FoodPreference",
    label: "Broccoli",
    sentiment: "like",
    targetKind: "ingredient",
  };
  for (const label of ["", " padded ", "x".repeat(121)]) {
    expect(
      Option.isNone(
        Schema.decodeUnknownOption(ProfileFactValue)({ ...base, label })
      )
    ).toBe(true);
  }
  for (const standing of [
    { _tag: "confirmed", basis: "model" },
    { _tag: "inferred" },
  ]) {
    expect(
      Option.isNone(Schema.decodeUnknownOption(ProfileFactStanding)(standing))
    ).toBe(true);
  }
  const payload = {
    command: { _tag: "AddProvisionalProfileFact", fact: base },
    expectedProfileVersion: 0,
    mutationId: "profile-contract",
  };
  expect(
    Option.isSome(
      Schema.decodeUnknownOption(MutatePersonProfilePayload, {
        onExcessProperty: "error",
      })(payload)
    )
  ).toBe(true);
  for (const extra of [
    { actorId: "x" },
    { source: "private_interview_proposal" },
    { transcript: "private" },
  ]) {
    expect(
      Option.isNone(
        Schema.decodeUnknownOption(MutatePersonProfilePayload, {
          onExcessProperty: "error",
        })({
          ...payload,
          ...extra,
        })
      )
    ).toBe(true);
    expect(
      Option.isNone(
        Schema.decodeUnknownOption(MutatePersonProfilePayload, {
          onExcessProperty: "error",
        })({
          ...payload,
          command: { ...payload.command, ...extra },
        })
      )
    ).toBe(true);
  }
  expect(
    Option.isNone(
      Schema.decodeUnknownOption(MutatePersonProfilePayload, {
        onExcessProperty: "error",
      })({
        ...payload,
        command: {
          _tag: "ConfirmHardConstraintReduction",
          factId: "fact_00000000-0000-4000-8000-000000000101",
          replacement: null,
        },
      })
    )
  ).toBe(true);
});

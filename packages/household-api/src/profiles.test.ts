import { Option, Schema } from "effect";
import { FastCheck } from "effect/testing";
import { expect, it } from "vitest";

import {
  MutatePersonProfilePayload,
  ProfileFactValue,
  ProfileFactStanding,
} from "./profiles.js";

it("round trips every closed fact family with bounded labels", () => {
  const label = FastCheck.stringMatching(
    /^[A-Za-z][A-Za-z0-9 ]{0,118}[A-Za-z0-9]$/u
  );
  const fact = FastCheck.oneof(
    FastCheck.record({
      _tag: FastCheck.constant("FoodPreference"),
      label,
      sentiment: FastCheck.constantFrom("like", "dislike", "strong_dislike"),
      targetKind: FastCheck.constantFrom("ingredient", "dish", "cuisine"),
    }),
    FastCheck.record({
      _tag: FastCheck.constant("HardConstraint"),
      category: FastCheck.constantFrom(
        "allergen",
        "dietary_rule",
        "ingredient_avoidance",
        "other_safety"
      ),
      handling: FastCheck.constantFrom("exclude", "requires_adaptation"),
      label,
    }),
    FastCheck.constant({ _tag: "NoKnownHardConstraints" })
  );
  FastCheck.assert(
    FastCheck.property(fact, (value) => {
      const decoded = Schema.decodeUnknownSync(ProfileFactValue)(value);
      expect(Schema.encodeSync(ProfileFactValue)(decoded)).toEqual(value);
      expect(
        Option.isNone(
          Schema.decodeUnknownOption(ProfileFactValue)({
            ...value,
            transcript: "private",
          })
        )
      ).toBe(true);
    }),
    { numRuns: 150, seed: 1303 }
  );
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
      Schema.decodeUnknownOption(MutatePersonProfilePayload)(payload)
    )
  ).toBe(true);
  for (const extra of [
    { actorId: "x" },
    { source: "private_interview_proposal" },
    { transcript: "private" },
  ]) {
    expect(
      Option.isNone(
        Schema.decodeUnknownOption(MutatePersonProfilePayload)({
          ...payload,
          ...extra,
        })
      )
    ).toBe(true);
    expect(
      Option.isNone(
        Schema.decodeUnknownOption(MutatePersonProfilePayload)({
          ...payload,
          command: { ...payload.command, ...extra },
        })
      )
    ).toBe(true);
  }
  expect(
    Option.isNone(
      Schema.decodeUnknownOption(MutatePersonProfilePayload)({
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

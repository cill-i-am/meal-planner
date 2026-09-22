import { Schema } from "effect";
import { expect, it } from "vitest";

import {
  NewPassword,
  RecoveryRequest,
  decodeRecoverySearch,
} from "./recovery-input.js";

it("requires matching passwords without trimming their content", () => {
  expect(() =>
    Schema.decodeUnknownSync(NewPassword)({
      confirmation: "password-two",
      password: "password-one",
    })
  ).toThrow();
  expect(() =>
    Schema.decodeUnknownSync(NewPassword)({
      confirmation: "short",
      password: "short",
    })
  ).toThrow();
  expect(
    Schema.decodeUnknownSync(NewPassword)({
      confirmation: " password ",
      password: " password ",
    }).password
  ).toBe(" password ");
});
it("retains invitation intent while rejecting external reset continuations", () => {
  expect(
    decodeRecoverySearch({
      redirect: "/invitation/synthetic",
      token: "synthetic-token",
    })
  ).toEqual({
    error: undefined,
    redirect: "/invitation/synthetic",
    token: "synthetic-token",
  });
  expect(decodeRecoverySearch({ redirect: "//external.test" }).redirect).toBe(
    "/"
  );
  expect(
    decodeRecoverySearch({ redirect: "/reset-password?token=old" }).redirect
  ).toBe("/");
  expect(
    Schema.decodeUnknownSync(RecoveryRequest)({ email: " test@example.test " })
      .email
  ).toBe("test@example.test");
});

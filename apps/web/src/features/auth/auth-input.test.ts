import { EmailAddress } from "@meal-planner/household-api";
import type { EmailAddress as EmailAddressType } from "@meal-planner/household-api";
import { Schema } from "effect";
import { expect, it } from "vitest";

import { InvitationEmailInput } from "../onboarding/people-input.js";
import { parseSignIn, parseSignUp } from "./auth-input.js";

it("normalizes auth and invitation emails into the shared address type", () => {
  const login: EmailAddressType = parseSignIn({
    email: "  cook@example.com  ",
    password: "password",
  }).email;
  const signup: EmailAddressType = parseSignUp({
    email: " cook@example.com ",
    name: "Cook",
    password: "password123",
  }).email;
  const invitation: EmailAddressType =
    Schema.decodeUnknownSync(InvitationEmailInput)(" cook@example.com ");

  expect([login, signup, invitation]).toEqual([
    "cook@example.com",
    "cook@example.com",
    "cook@example.com",
  ]);
  expect(Schema.is(EmailAddress)(login)).toBe(true);
});

it.each(["bad..dots@example.com", "name@-example.com", "name@example..com"])(
  "rejects a malformed address across auth and invitations: %s",
  (email) => {
    expect(() => parseSignIn({ email, password: "password" })).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(InvitationEmailInput)(email)
    ).toThrow();
  }
);

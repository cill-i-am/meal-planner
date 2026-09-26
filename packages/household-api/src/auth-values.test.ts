import { Schema } from "effect";
import { describe, expect, expectTypeOf, it } from "vitest";

import {
  AuthAccountId,
  AuthVerificationId,
  EmailAddress,
  HouseholdOrganizationId,
  InvitationId,
  MemberId,
  UserId,
} from "./index.js";

describe("shared auth values", () => {
  it("accepts opaque provider and retained IDs while rejecting whitespace and controls", () => {
    const ids = [
      UserId,
      InvitationId,
      MemberId,
      AuthAccountId,
      AuthVerificationId,
      HouseholdOrganizationId,
    ];
    for (const id of ids) {
      for (const value of [
        "provider_opaque-ID.123",
        "3a51ea4b-80ec-4c63-a784-720c96039177",
        "retained:server:id",
      ]) {
        expect(Schema.decodeUnknownSync(id)(value)).toBe(value);
      }
      for (const value of [
        "",
        " bad-id",
        "bad-id ",
        "bad id",
        "bad\tid",
        "bad\u0000id",
        "x".repeat(256),
      ]) {
        expect(() => Schema.decodeUnknownSync(id)(value)).toThrow();
      }
    }
  });

  it("validates addresses without changing the submitted value", () => {
    const decode = Schema.decodeUnknownSync(EmailAddress);
    expect(decode("Ada.Lovelace+home@example.test")).toBe(
      "Ada.Lovelace+home@example.test"
    );
    for (const value of [
      "missing-at.example.test",
      "person@",
      "@example.test",
      "person@@example.test",
      " person@example.test",
      "person@example.test ",
      `${"a".repeat(245)}@example.test`,
    ]) {
      expect(() => decode(value)).toThrow();
    }
  });

  it("keeps auth identities distinct at compile time", () => {
    expectTypeOf<UserId>().not.toMatchTypeOf<InvitationId>();
    expectTypeOf<UserId>().not.toMatchTypeOf<HouseholdOrganizationId>();
    expectTypeOf<InvitationId>().not.toMatchTypeOf<MemberId>();
    expectTypeOf<MemberId>().not.toMatchTypeOf<HouseholdOrganizationId>();
    expectTypeOf<InvitationId>().not.toMatchTypeOf<UserId>();
    expectTypeOf<AuthAccountId>().not.toMatchTypeOf<UserId>();
    expectTypeOf<AuthVerificationId>().not.toMatchTypeOf<InvitationId>();
    expectTypeOf<string>().not.toMatchTypeOf<EmailAddress>();
  });
});

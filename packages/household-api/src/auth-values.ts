import { Schema } from "effect";
import { regexes } from "zod/v4/core";

/** Opaque identity shared by Better Auth records and retained server IDs. */
export const OpaqueAuthId = Schema.String.pipe(
  Schema.check(
    Schema.isNonEmpty(),
    Schema.isMaxLength(255),
    Schema.isPattern(/^[^\s\p{Cc}]+$/u)
  )
);

/** Better Auth user identity. */
export const UserId = OpaqueAuthId.pipe(Schema.brand("UserId"));
export type UserId = typeof UserId.Type;

/** Better Auth invitation identity. */
export const InvitationId = OpaqueAuthId.pipe(Schema.brand("InvitationId"));
export type InvitationId = typeof InvitationId.Type;

/** Better Auth organization member identity. */
export const MemberId = OpaqueAuthId.pipe(Schema.brand("MemberId"));
export type MemberId = typeof MemberId.Type;

/** Linked Better Auth credential account row identity. */
export const AuthAccountId = OpaqueAuthId.pipe(Schema.brand("AuthAccountId"));
export type AuthAccountId = typeof AuthAccountId.Type;

/** Better Auth verification record identity. */
export const AuthVerificationId = OpaqueAuthId.pipe(
  Schema.brand("AuthVerificationId")
);
export type AuthVerificationId = typeof AuthVerificationId.Type;

/** Valid mailbox address used by auth commands and projections. */
export const EmailAddress = Schema.String.pipe(
  Schema.check(
    Schema.isTrimmed(),
    Schema.isMaxLength(254),
    Schema.isPattern(regexes.email)
  ),
  Schema.brand("EmailAddress")
);
export type EmailAddress = typeof EmailAddress.Type;

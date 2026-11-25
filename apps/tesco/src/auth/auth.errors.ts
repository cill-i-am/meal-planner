/* eslint-disable max-classes-per-file -- This module owns one closed, feature-level failure family. */
import { Data } from "effect";

/** Internal boundary failure; callers map it to a feature-owned semantic error. */
export class TescoAuthCookieInvalid extends Data.TaggedError(
  "TescoAuthCookieInvalid"
) {}

export class TescoCredentialsRejected extends Data.TaggedError(
  "TescoCredentialsRejected"
) {}

export class TescoSoftLoginUnavailable extends Data.TaggedError(
  "TescoSoftLoginUnavailable"
) {}

export class TescoSoftLoginResponseInvalid extends Data.TaggedError(
  "TescoSoftLoginResponseInvalid"
) {}

export type TescoSoftLoginRefreshError =
  | TescoCredentialsRejected
  | TescoSoftLoginUnavailable
  | TescoSoftLoginResponseInvalid;

export class TescoRefreshTokenExpired extends Data.TaggedError(
  "TescoRefreshTokenExpired"
) {}

export class TescoAccessTokenNotRenewed extends Data.TaggedError(
  "TescoAccessTokenNotRenewed"
) {}

export type TescoAuthSessionError =
  | TescoRefreshTokenExpired
  | TescoAccessTokenNotRenewed
  | TescoSoftLoginRefreshError;

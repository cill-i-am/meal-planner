import { Data } from "effect";

export class AuthPrincipalResolutionError extends Data.TaggedError(
  "AuthPrincipalResolutionError"
)<{
  readonly reason:
    | "invalid_session"
    | "missing_active_household"
    | "missing_membership";
}> {}

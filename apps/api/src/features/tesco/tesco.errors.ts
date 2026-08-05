export class TescoHttpError {
  readonly _tag = "TescoHttpError" as const;

  constructor(
    readonly message: string,
    readonly status: number
  ) {}
}

export class TescoGraphQlError {
  readonly _tag = "TescoGraphQlError" as const;

  constructor(readonly message: string) {}
}

export class TescoDecodeError {
  readonly _tag = "TescoDecodeError" as const;

  constructor(
    readonly message: string,
    readonly cause: unknown
  ) {}
}

export class TescoRequestBodyError {
  readonly _tag = "TescoRequestBodyError" as const;

  constructor(
    readonly message: string,
    readonly cause: unknown
  ) {}
}

export type TescoAuthRefreshFailureReason =
  | "access-token-not-renewed"
  | "discover-authorization-missing"
  | "discover-config-invalid-json"
  | "discover-config-missing"
  | "invalid-cookie-header"
  | "invalid-oauth-expiry-json"
  | "invalid-oauth-expiry-shape"
  | "missing-oauth-expiry"
  | "refresh-token-expired"
  | "upstream-response-invalid";

export class TescoAuthRefreshError {
  readonly _tag = "TescoAuthRefreshError" as const;

  constructor(
    readonly message: string,
    readonly status: number,
    readonly reason: TescoAuthRefreshFailureReason
  ) {}
}

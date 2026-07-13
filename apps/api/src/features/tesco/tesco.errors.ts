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

export class TescoAuthRefreshError {
  readonly _tag = "TescoAuthRefreshError" as const;

  constructor(
    readonly message: string,
    readonly status: number,
    readonly cause: unknown = undefined
  ) {}
}

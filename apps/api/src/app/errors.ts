import type {
  TescoAuthRefreshError,
  TescoDecodeError,
  TescoGraphQlError,
  TescoHttpError,
  TescoRequestBodyError,
} from "../features/tesco/tesco.errors.js";

export class AppConfigError {
  readonly _tag = "AppConfigError" as const;

  constructor(
    readonly message: string,
    readonly cause: unknown = undefined
  ) {}
}

export class BadRequestError {
  readonly _tag = "BadRequestError" as const;

  constructor(readonly message: string) {}
}

export type ApiError =
  | AppConfigError
  | BadRequestError
  | TescoAuthRefreshError
  | TescoDecodeError
  | TescoGraphQlError
  | TescoHttpError
  | TescoRequestBodyError;

export interface ApiErrorBody {
  readonly error: ApiError["_tag"];
  readonly message: string;
}

export const statusForError = (error: ApiError): number => {
  switch (error._tag) {
    case "BadRequestError": {
      return 400;
    }
    case "TescoHttpError": {
      return error.status >= 400 && error.status < 600 ? error.status : 502;
    }
    case "TescoAuthRefreshError": {
      return error.status >= 400 && error.status < 600 ? error.status : 502;
    }
    case "AppConfigError":
    case "TescoDecodeError":
    case "TescoGraphQlError":
    case "TescoRequestBodyError": {
      return 502;
    }
  }
};

export const toErrorBody = (error: ApiError): ApiErrorBody => ({
  error: error._tag,
  message: error.message,
});

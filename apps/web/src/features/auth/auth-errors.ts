import { Option, Schema } from "effect";

const AuthErrorResponse = Schema.Struct({
  code: Schema.optional(Schema.String),
  status: Schema.optional(Schema.Number),
});
const parseError = Schema.decodeUnknownOption(AuthErrorResponse);

/** Safe exception translation at the Better Auth / TanStack Query boundary. */
export class AuthRequestError extends Error {
  readonly _tag = "AuthRequestError" as const;
  readonly code: string | undefined;
  readonly status: number | undefined;
  readonly retryAt: number | undefined;
  constructor(cause: unknown, retryAt?: number) {
    super("We couldn’t confirm that change. Please try again.");
    this.name = "AuthRequestError";
    this.retryAt = retryAt;
    const parsed = parseError(cause);
    this.code = Option.isSome(parsed) ? parsed.value.code : undefined;
    this.status = Option.isSome(parsed) ? parsed.value.status : undefined;
  }
}

export const parseRetryAfter = (header: string | null): number | undefined => {
  if (header === null || !/^\d+$/u.test(header)) {
    return undefined;
  }
  const seconds = Number(header);
  return Number.isSafeInteger(seconds) && seconds > 0 && seconds <= 86_400
    ? seconds
    : undefined;
};

export interface AuthFeedback {
  readonly message: string;
  readonly field?: "email" | "password";
  readonly stop?: boolean;
}
export const authFeedback = (
  error: Error | null,
  signup: boolean
): AuthFeedback | null => {
  if (error === null) {
    return null;
  }
  if (!(error instanceof AuthRequestError)) {
    return {
      message: signup
        ? "We couldn’t confirm your account was created. Try logging in before creating another account."
        : "We couldn’t confirm that change. Please try again.",
      stop: signup,
    };
  }
  if (error.status === 429) {
    return {
      message:
        error.retryAt === undefined
          ? "Too many attempts. Try again shortly."
          : `Too many attempts. Try again in ${Math.max(1, Math.ceil((error.retryAt - Date.now()) / 1000))} seconds.`,
    };
  }
  const fields: Record<string, AuthFeedback> = {
    INVALID_EMAIL: { field: "email", message: "Enter a valid email address." },
    INVALID_EMAIL_OR_PASSWORD: {
      message:
        "Email or password doesn’t match. Try again or reset your password.",
    },
    PASSWORD_TOO_LONG: {
      field: "password",
      message: "Use 128 characters or fewer.",
    },
    PASSWORD_TOO_SHORT: {
      field: "password",
      message: "Use at least 8 characters.",
    },
    USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: {
      field: "email",
      message:
        "An account already uses this email. Log in or use another email.",
    },
  };
  const field = fields[error.code ?? ""];
  if (field !== undefined) {
    return field;
  }
  switch (error.code) {
    case "INVALID_PASSWORD": {
      return {
        field: "password",
        message: signup
          ? "Use between 8 and 128 characters."
          : "Enter your password.",
      };
    }
    case "FAILED_TO_CREATE_SESSION": {
      return {
        message: signup
          ? "Your account may be ready, but we couldn’t sign you in. Log in to continue."
          : "We couldn’t sign you in. Try again.",
        stop: signup,
      };
    }
    case "EMAIL_NOT_VERIFIED": {
      return { message: "Verify your email before logging in." };
    }
    case "EMAIL_PASSWORD_DISABLED": {
      return { message: "Email login is temporarily unavailable.", stop: true };
    }
    case "EMAIL_PASSWORD_SIGN_UP_DISABLED": {
      return {
        message: "Account creation is temporarily unavailable.",
        stop: true,
      };
    }
    case "FAILED_TO_CREATE_USER": {
      return { message: "We couldn’t create your account. Please try again." };
    }
    case "INVALID_ORIGIN":
    case "MISSING_OR_NULL_ORIGIN":
    case "INVALID_REFERER": {
      return {
        message:
          "We couldn’t verify this request. Reload the page and try again.",
      };
    }
    default: {
      return {
        message: signup
          ? "We couldn’t confirm your account was created. Try logging in before creating another account."
          : "We couldn’t confirm that change. Please try again.",
        stop: signup,
      };
    }
  }
};

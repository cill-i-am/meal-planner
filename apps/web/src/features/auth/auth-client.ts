import { organizationClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { Option, Schema } from "effect";

const AuthenticationError = Schema.Struct({
  message: Schema.String,
});
const decodeAuthenticationError = Schema.decodeUnknownOption(
  AuthenticationError,
  { onExcessProperty: "ignore" }
);

export const authClient = createAuthClient({
  plugins: [organizationClient()],
});

export const requireAuthSuccess = async <T>(
  request: Promise<{
    readonly data: T | null;
    readonly error: unknown;
  }>
): Promise<T> => {
  const result = await request;
  if (result.error !== null) {
    const message = Option.match(decodeAuthenticationError(result.error), {
      onNone: () => "Authentication request failed.",
      onSome: (error) => error.message,
    });
    throw new Error(message);
  }
  if (result.data === null) {
    throw new Error("Authentication request returned no data.");
  }
  return result.data;
};

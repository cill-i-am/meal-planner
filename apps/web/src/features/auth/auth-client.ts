import { organizationClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

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
    const message =
      typeof result.error === "object" &&
      result.error !== null &&
      "message" in result.error &&
      typeof result.error.message === "string"
        ? result.error.message
        : "Authentication request failed.";
    throw new Error(message);
  }
  if (result.data === null) {
    throw new Error("Authentication request returned no data.");
  }
  return result.data;
};

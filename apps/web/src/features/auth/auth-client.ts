import { organizationClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { createContext, useContext } from "react";

import { AuthRequestError, parseRetryAfter } from "./auth-errors.js";

export const makeAuthClient = (transport: typeof fetch = fetch) =>
  createAuthClient({
    fetchOptions: { customFetchImpl: transport },
    plugins: [organizationClient()],
  });
export const AuthClientContext = createContext(makeAuthClient());
export const useAuthClient = () => useContext(AuthClientContext);

export const requireAuthSuccess = async <T>(
  request: Promise<{
    readonly data: T | null;
    readonly error: unknown;
  }>,
  retryAt?: () => number | undefined
): Promise<T> => {
  const result = await request;
  if (result.error !== null) {
    throw new AuthRequestError(result.error, retryAt?.());
  }
  if (result.data === null) {
    throw new AuthRequestError(null);
  }
  return result.data;
};

export const authenticate = async (
  authClient: ReturnType<typeof makeAuthClient>,
  kind: "login" | "signup",
  input: {
    readonly email: string;
    readonly password: string;
    readonly name: string;
  }
): Promise<void> => {
  let retryAt: number | undefined;
  const options = {
    onError: ({ response }: { response: Response }) => {
      const seconds = parseRetryAfter(response.headers.get("X-Retry-After"));
      if (response.status === 429 && seconds !== undefined) {
        retryAt = Date.now() + seconds * 1000;
      }
    },
  };
  try {
    const request =
      kind === "signup"
        ? authClient.signUp.email(input, options)
        : authClient.signIn.email(
            { email: input.email, password: input.password },
            options
          );
    await requireAuthSuccess(request, () => retryAt);
  } catch (error) {
    if (error instanceof AuthRequestError) {
      throw error;
    }
    throw new AuthRequestError(null);
  }
};

import {
  setupProgressField,
  setupProgressVersionField,
} from "@meal-planner/household-api";
import type { UserId } from "@meal-planner/household-api";
import {
  inferAdditionalFields,
  organizationClient,
} from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { Effect, Layer } from "effect";
import { createEffectQuery } from "effect-query";
import { createContext, useContext } from "react";

import { AuthRequestError, parseRetryAfter } from "./auth-errors.js";
import type { parseSignIn, parseSignUp } from "./auth-input.js";

export const makeAuthClient = (
  transport: typeof fetch = fetch,
  expectedUserId?: UserId
) =>
  createAuthClient({
    fetchOptions: {
      customFetchImpl: transport,
      headers: expectedUserId ? { "x-meal-planner-user": expectedUserId } : {},
    },
    plugins: [
      {
        atomListeners: [
          {
            matcher: (path) => path === "/reset-password",
            signal: "$sessionSignal",
          },
        ],
        id: "recovery-session-refresh",
      },
      organizationClient(),
      inferAdditionalFields({
        user: {
          setupProgress: setupProgressField,
          setupProgressVersion: setupProgressVersionField,
        },
      }),
    ],
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

export type AuthenticationInput =
  | { readonly kind: "login"; readonly input: ReturnType<typeof parseSignIn> }
  | { readonly kind: "signup"; readonly input: ReturnType<typeof parseSignUp> };

const effectQuery = createEffectQuery(Layer.empty);

export const authenticate = (
  authClient: ReturnType<typeof makeAuthClient>,
  command: AuthenticationInput
): Effect.Effect<void, AuthRequestError> =>
  Effect.suspend(() => {
    let retryAt: number | undefined;
    const options = {
      onError: ({ response }: { response: Response }) => {
        const seconds = parseRetryAfter(response.headers.get("X-Retry-After"));
        if (response.status === 429 && seconds !== undefined) {
          retryAt = Date.now() + seconds * 1000;
        }
      },
    };
    return Effect.tryPromise({
      catch: (cause) =>
        cause instanceof AuthRequestError ? cause : new AuthRequestError(cause),
      try: async () => {
        const request =
          command.kind === "signup"
            ? authClient.signUp.email(command.input, options)
            : authClient.signIn.email(command.input, options);
        await requireAuthSuccess(request, () => retryAt);
      },
    });
  });

export const authenticationMutationOptions = (
  authClient: ReturnType<typeof makeAuthClient>
) =>
  effectQuery.mutationOptions({
    mutationFn: (command: AuthenticationInput) =>
      authenticate(authClient, command),
    mutationKey: ["authenticate"],
  });

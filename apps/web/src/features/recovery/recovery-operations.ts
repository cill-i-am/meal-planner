import { Data, Effect, Layer } from "effect";
import { createEffectQuery } from "effect-query";

import type { makeAuthClient } from "../auth/auth-client.js";
import { requireAuthSuccess } from "../auth/auth-client.js";
import { AuthRequestError, parseRetryAfter } from "../auth/auth-errors.js";

const effectQuery = createEffectQuery(Layer.empty);

export class RecoveryFailure extends Data.TaggedError("RecoveryFailure")<{
  readonly authError: AuthRequestError;
}> {}

/** Keep the server's retry window across field edits, as on login and signup. */
export const submitRecovery = <T>(
  request: (options: {
    onError: (context: { response: Response }) => void;
  }) => Promise<{ data: T | null; error: unknown }>
): Effect.Effect<T, RecoveryFailure> => {
  let retryAt: number | undefined;
  return Effect.tryPromise({
    catch: (cause) =>
      new RecoveryFailure({
        authError:
          cause instanceof AuthRequestError
            ? cause
            : new AuthRequestError(null, retryAt),
      }),
    try: () =>
      requireAuthSuccess(
        request({
          onError: ({ response }) => {
            const seconds = parseRetryAfter(
              response.headers.get("X-Retry-After")
            );
            if (response.status === 429 && seconds !== undefined) {
              retryAt = Date.now() + seconds * 1000;
            }
          },
        }),
        () => retryAt
      ),
  });
};

export const requestPasswordResetMutationOptions = (
  auth: ReturnType<typeof makeAuthClient>,
  redirect: string
) =>
  effectQuery.mutationOptions({
    mutationFn: (email: string) => {
      const callback = new URL("/reset-password", window.location.origin);
      callback.searchParams.set("redirect", redirect);
      return submitRecovery((options) =>
        auth.requestPasswordReset({ email, redirectTo: callback.href }, options)
      );
    },
    mutationKey: ["requestPasswordReset"],
  });

export const resetPasswordMutationOptions = (
  auth: ReturnType<typeof makeAuthClient>,
  token: string | undefined
) =>
  effectQuery.mutationOptions({
    mutationFn: (password: string) =>
      token
        ? submitRecovery((options) =>
            auth.resetPassword({ newPassword: password, token }, options)
          )
        : Effect.fail(
            new RecoveryFailure({
              authError: new AuthRequestError({ code: "INVALID_TOKEN" }),
            })
          ),
    mutationKey: ["resetPassword"],
  });

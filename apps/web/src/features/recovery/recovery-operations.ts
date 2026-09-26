import { requireAuthSuccess } from "../auth/auth-client.js";
import { parseRetryAfter } from "../auth/auth-errors.js";

/** Keep the server's retry window across field edits, as on login and signup. */
export const submitRecovery = async <T>(
  request: (options: {
    onError: (context: { response: Response }) => void;
  }) => Promise<{ data: T | null; error: unknown }>
) => {
  let retryAt: number | undefined;
  return await requireAuthSuccess(
    request({
      onError: ({ response }) => {
        const seconds = parseRetryAfter(response.headers.get("X-Retry-After"));
        if (response.status === 429 && seconds !== undefined) {
          retryAt = Date.now() + seconds * 1000;
        }
      },
    }),
    () => retryAt
  );
};

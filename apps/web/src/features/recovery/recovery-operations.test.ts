import { Effect } from "effect";
import { expect, it, vi } from "vitest";

import { submitRecovery } from "./recovery-operations.js";

it("keeps a successful reset request generic for any email address", async () => {
  const result = await Effect.runPromise(
    submitRecovery(() =>
      Promise.resolve({ data: { status: true }, error: null })
    )
  );

  expect(result).toEqual({ status: true });
});

it("preserves Better Auth's retry window in a typed failure", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-26T12:00:00Z"));
  try {
    const failure = await Effect.runPromise(
      Effect.flip(
        submitRecovery(({ onError }) => {
          onError({
            response: new Response(null, {
              headers: { "X-Retry-After": "45" },
              status: 429,
            }),
          });
          return Promise.resolve({
            data: null,
            error: { code: "TOO_MANY_REQUESTS", status: 429 },
          });
        })
      )
    );

    expect(failure._tag).toBe("RecoveryFailure");
    expect(failure.authError.status).toBe(429);
    expect(failure.authError.retryAt).toBe(Date.now() + 45_000);
  } finally {
    vi.useRealTimers();
  }
});

it("converts a rejected Better Auth Promise into a safe typed failure", async () => {
  const failure = await Effect.runPromise(
    Effect.flip(
      submitRecovery(() => Promise.reject(new Error("private provider detail")))
    )
  );

  expect(failure._tag).toBe("RecoveryFailure");
  expect(failure.authError.message).not.toContain("private provider detail");
});

import { Effect, Exit, Redacted } from "effect";
import { describe, expect, it } from "vitest";

import { makeImportAuthorizer } from "./import.auth.js";

describe("import authorizer", () => {
  it("accepts only the configured bearer token", async () => {
    const authorizer = await Effect.runPromise(
      makeImportAuthorizer(Redacted.make("expected-token"))
    );

    await expect(
      Effect.runPromise(authorizer.authorize("Bearer expected-token"))
    ).resolves.toBeUndefined();
    const exits = await Promise.all(
      [
        undefined,
        "",
        "expected-token",
        "Basic expected-token",
        "Bearer wrong-token",
        "Bearer expected-token extra",
      ].map((value) => Effect.runPromiseExit(authorizer.authorize(value)))
    );
    for (const exit of exits) {
      expect(Exit.isFailure(exit)).toBe(true);
    }
  });

  it("fails closed when the configured token is empty", async () => {
    const authorizer = await Effect.runPromise(
      makeImportAuthorizer(Redacted.make(""))
    );
    const exit = await Effect.runPromiseExit(
      authorizer.authorize("Bearer any-token")
    );

    expect(Exit.isFailure(exit)).toBe(true);
  });
});

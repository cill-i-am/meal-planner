import { Effect, Exit, Redacted } from "effect";
import { describe, expect, it } from "vitest";

import { makeImportSystemAuthorizer } from "./import-system.auth.js";
import { TestImportPrincipal } from "./import.test-fixtures.js";

describe("import system authorization", () => {
  it("accepts only the configured internal bearer credential", async () => {
    const authorizer = await Effect.runPromise(
      makeImportSystemAuthorizer({
        principal: TestImportPrincipal,
        token: Redacted.make("system-import-token"),
      })
    );

    await expect(
      Effect.runPromise(authorizer.authorize("Bearer system-import-token"))
    ).resolves.toEqual(TestImportPrincipal);

    const rejected = await Promise.all(
      [
        undefined,
        "Bearer wrong-token",
        "Basic system-import-token",
        "Bearer system-import-token extra",
      ].map((authorization) =>
        Effect.runPromiseExit(authorizer.authorize(authorization))
      )
    );
    for (const result of rejected) {
      expect(Exit.isFailure(result)).toBe(true);
    }
  });

  it("fails closed when the configured credential is empty", async () => {
    const authorizer = await Effect.runPromise(
      makeImportSystemAuthorizer({
        principal: TestImportPrincipal,
        token: Redacted.make(""),
      })
    );

    const result = await Effect.runPromiseExit(
      authorizer.authorize("Bearer any-token")
    );

    expect(Exit.isFailure(result)).toBe(true);
  });
});

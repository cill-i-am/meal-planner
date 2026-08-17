import { Effect, Exit, Redacted, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { ImportPrincipal } from "./import-intent.js";
import { makeImportAuthorizer } from "./import.auth.js";

const principal = Schema.decodeUnknownSync(ImportPrincipal)({
  actorId: "a".repeat(64),
  householdScopeId: "b".repeat(64),
});

describe("private import authorization", () => {
  it("returns only the explicitly injected principal for the configured bearer", async () => {
    const authorizer = await Effect.runPromise(
      makeImportAuthorizer({
        expectedToken: Redacted.make("expected-token"),
        principal,
      })
    );

    await expect(
      Effect.runPromise(authorizer.authorize("Bearer expected-token"))
    ).resolves.toEqual(principal);
    const unauthorized = await Effect.runPromiseExit(
      authorizer.authorize("Bearer wrong-token")
    );
    expect(Exit.isFailure(unauthorized)).toBe(true);
  });

  it("fails closed when the configured token is empty", async () => {
    const authorizer = await Effect.runPromise(
      makeImportAuthorizer({ expectedToken: Redacted.make(""), principal })
    );
    const exit = await Effect.runPromiseExit(
      authorizer.authorize("Bearer any-token")
    );

    expect(Exit.isFailure(exit)).toBe(true);
  });
});

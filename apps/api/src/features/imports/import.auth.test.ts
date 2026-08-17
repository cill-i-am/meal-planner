import { Effect, Exit, Redacted, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { ImportPrincipal } from "./import-intent.js";
import { makeImportAuthorizer } from "./import.auth.js";

const firstPrincipal = Schema.decodeUnknownSync(ImportPrincipal)({
  actorId: "a".repeat(64),
  householdScopeId: "b".repeat(64),
});
const secondPrincipal = Schema.decodeUnknownSync(ImportPrincipal)({
  actorId: "c".repeat(64),
  householdScopeId: "d".repeat(64),
});

describe("private import authorization", () => {
  it("resolves each configured bearer to its explicitly paired principal", async () => {
    const authorizer = await Effect.runPromise(
      makeImportAuthorizer({
        configuredPrincipals: [
          { principal: firstPrincipal, token: Redacted.make("first-token") },
          { principal: secondPrincipal, token: Redacted.make("second-token") },
        ],
      })
    );

    await expect(
      Effect.runPromise(authorizer.authorize("Bearer first-token"))
    ).resolves.toEqual(firstPrincipal);
    await expect(
      Effect.runPromise(authorizer.authorize("Bearer second-token"))
    ).resolves.toEqual(secondPrincipal);
    const unauthorized = await Effect.runPromiseExit(
      authorizer.authorize("Bearer wrong-token")
    );
    expect(Exit.isFailure(unauthorized)).toBe(true);
  });

  it("fails closed when the configured token is empty", async () => {
    const authorizer = await Effect.runPromise(
      makeImportAuthorizer({
        configuredPrincipals: [
          { principal: firstPrincipal, token: Redacted.make("") },
        ],
      })
    );
    const exit = await Effect.runPromiseExit(
      authorizer.authorize("Bearer any-token")
    );

    expect(Exit.isFailure(exit)).toBe(true);
  });

  it.each([undefined, "", "Basic first-token", "Bearer unknown-token"])(
    "returns the same secret-free failure for an unknown credential: %s",
    async (authorization) => {
      const authorizer = await Effect.runPromise(
        makeImportAuthorizer({
          configuredPrincipals: [
            {
              principal: firstPrincipal,
              token: Redacted.make("first-token"),
            },
          ],
        })
      );

      const exit = await Effect.runPromiseExit(
        authorizer.authorize(authorization)
      );

      expect(Exit.isFailure(exit)).toBe(true);
      expect(String(exit)).not.toContain("first-token");
      expect(String(exit)).not.toContain(firstPrincipal.actorId);
      expect(String(exit)).not.toContain(firstPrincipal.householdScopeId);
    }
  );
});

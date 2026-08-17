import { ConfigProvider, Effect, Exit, Redacted } from "effect";
import { describe, expect, it } from "vitest";

import { ImportConfiguredPrincipalsConfig } from "./import.auth.config.js";

const configuredPrincipalsJson = JSON.stringify([
  {
    actorId: "a".repeat(64),
    householdScopeId: "b".repeat(64),
    token: "first-token",
  },
  {
    actorId: "c".repeat(64),
    householdScopeId: "d".repeat(64),
    token: "second-token",
  },
]);

describe("import configured-principal registry config", () => {
  it("decodes the closed server registry and redacts every token", async () => {
    const configuredPrincipals = await Effect.runPromise(
      ImportConfiguredPrincipalsConfig.pipe(
        Effect.provide(
          ConfigProvider.layer(
            ConfigProvider.fromUnknown({
              MEAL_PLANNER_IMPORT_CONFIGURED_PRINCIPALS_JSON:
                configuredPrincipalsJson,
            })
          )
        )
      )
    );

    expect(configuredPrincipals).toHaveLength(2);
    expect(configuredPrincipals.map(({ principal }) => principal)).toEqual([
      { actorId: "a".repeat(64), householdScopeId: "b".repeat(64) },
      { actorId: "c".repeat(64), householdScopeId: "d".repeat(64) },
    ]);
    expect(
      configuredPrincipals.map(({ token }) => Redacted.value(token))
    ).toEqual(["first-token", "second-token"]);
    expect(JSON.stringify(configuredPrincipals)).not.toContain("first-token");
    expect(JSON.stringify(configuredPrincipals)).not.toContain("second-token");
  });

  it("fails safely without echoing a malformed registry secret", async () => {
    const exposedOnlyInInput = "must-never-appear-in-config-failure";
    const exit = await Effect.runPromiseExit(
      ImportConfiguredPrincipalsConfig.pipe(
        Effect.provide(
          ConfigProvider.layer(
            ConfigProvider.fromUnknown({
              MEAL_PLANNER_IMPORT_CONFIGURED_PRINCIPALS_JSON: JSON.stringify([
                {
                  actorId: "not-an-actor-id",
                  householdScopeId: "not-a-household-id",
                  token: exposedOnlyInInput,
                },
              ]),
            })
          )
        )
      )
    );

    expect(Exit.isFailure(exit)).toBe(true);
    expect(String(exit)).not.toContain(exposedOnlyInInput);
    expect(String(exit)).toContain("ImportConfiguredPrincipalsConfigError");
  });
});

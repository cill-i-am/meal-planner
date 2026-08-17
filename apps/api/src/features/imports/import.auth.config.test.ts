import { Cause, ConfigProvider, Effect, Exit, Redacted } from "effect";
import { describe, expect, it } from "vitest";

import {
  ImportAuthorizationConfig,
  ImportConfiguredPrincipalsConfig,
} from "./import.auth.config.js";

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

const authorizationConfigExit = (source: Record<string, string>) =>
  Effect.runPromiseExit(
    ImportAuthorizationConfig.pipe(
      Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(source)))
    )
  );

const expectSafeAuthorizationConfigFailure = (
  exit: Awaited<ReturnType<typeof authorizationConfigExit>>,
  privateValues: readonly string[]
) => {
  expect(Exit.isFailure(exit)).toBe(true);
  if (Exit.isSuccess(exit)) {
    throw new Error("Expected authorization configuration to fail");
  }

  const renderedFailures = [String(exit), Cause.pretty(exit.cause)];
  for (const renderedFailure of renderedFailures) {
    for (const privateValue of privateValues) {
      expect(renderedFailure).not.toContain(privateValue);
    }
    expect(renderedFailure).toContain("ImportConfiguredPrincipalsConfigError");
  }
};

describe("import configured-principal registry config", () => {
  it("decodes the closed server registry and redacts every token", async () => {
    const { configuredPrincipals, systemApiToken } = await Effect.runPromise(
      ImportAuthorizationConfig.pipe(
        Effect.provide(
          ConfigProvider.layer(
            ConfigProvider.fromUnknown({
              MEAL_PLANNER_IMPORT_API_TOKEN: "system-token",
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
    expect(Redacted.value(systemApiToken)).toBe("system-token");
    expect(JSON.stringify(configuredPrincipals)).not.toContain("first-token");
    expect(JSON.stringify(configuredPrincipals)).not.toContain("second-token");
    expect(JSON.stringify(systemApiToken)).not.toContain("system-token");
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

  it("rejects one configured token mapped to distinct principals without leaking either authority", async () => {
    const duplicateToken = "must-never-select-the-first-principal";
    const firstActorId = "1".repeat(64);
    const firstHouseholdScopeId = "2".repeat(64);
    const secondActorId = "3".repeat(64);
    const secondHouseholdScopeId = "4".repeat(64);
    const rawRegistry = JSON.stringify([
      {
        actorId: firstActorId,
        householdScopeId: firstHouseholdScopeId,
        token: duplicateToken,
      },
      {
        actorId: secondActorId,
        householdScopeId: secondHouseholdScopeId,
        token: duplicateToken,
      },
    ]);
    const exit = await authorizationConfigExit({
      MEAL_PLANNER_IMPORT_API_TOKEN: "independent-system-token",
      MEAL_PLANNER_IMPORT_CONFIGURED_PRINCIPALS_JSON: rawRegistry,
    });

    expectSafeAuthorizationConfigFailure(exit, [
      duplicateToken,
      firstActorId,
      firstHouseholdScopeId,
      secondActorId,
      secondHouseholdScopeId,
      rawRegistry,
    ]);
  });

  it("rejects a duplicate configured token even when it maps to the same principal", async () => {
    const duplicateToken = "must-never-create-an-ambiguous-registry";
    const actorId = "7".repeat(64);
    const householdScopeId = "8".repeat(64);
    const rawRegistry = JSON.stringify([
      { actorId, householdScopeId, token: duplicateToken },
      { actorId, householdScopeId, token: duplicateToken },
    ]);
    const exit = await authorizationConfigExit({
      MEAL_PLANNER_IMPORT_API_TOKEN: "independent-system-token",
      MEAL_PLANNER_IMPORT_CONFIGURED_PRINCIPALS_JSON: rawRegistry,
    });

    expectSafeAuthorizationConfigFailure(exit, [
      duplicateToken,
      actorId,
      householdScopeId,
      rawRegistry,
    ]);
  });

  it("stops Worker startup before request-layer construction when a household token collides with the system token", async () => {
    const collidingToken = "must-never-cross-the-system-authority-boundary";
    const actorId = "5".repeat(64);
    const householdScopeId = "6".repeat(64);
    const rawRegistry = JSON.stringify([
      { actorId, householdScopeId, token: collidingToken },
    ]);
    let requestLayerConstructed = false;
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* rejectAmbiguousWorkerAuthorizationConfig() {
        const authorizationConfig = yield* ImportAuthorizationConfig;
        requestLayerConstructed = true;
        return authorizationConfig;
      }).pipe(
        Effect.provide(
          ConfigProvider.layer(
            ConfigProvider.fromUnknown({
              MEAL_PLANNER_IMPORT_API_TOKEN: collidingToken,
              MEAL_PLANNER_IMPORT_CONFIGURED_PRINCIPALS_JSON: rawRegistry,
            })
          )
        )
      )
    );

    expect(requestLayerConstructed).toBe(false);
    expectSafeAuthorizationConfigFailure(exit, [
      collidingToken,
      actorId,
      householdScopeId,
      rawRegistry,
    ]);
  });
});

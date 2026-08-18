import { ConfigProvider, Effect, Redacted } from "effect";
import { describe, expect, it } from "vitest";

import { ImportSystemAuthorizationConfig } from "./import.auth.config.js";

describe("ImportSystemAuthorizationConfig", () => {
  it("loads the internal automation token as a redacted value", async () => {
    const token = await Effect.runPromise(
      ImportSystemAuthorizationConfig.pipe(
        Effect.provide(
          ConfigProvider.layer(
            ConfigProvider.fromUnknown({
              MEAL_PLANNER_IMPORT_API_TOKEN: "system-secret",
            })
          )
        )
      )
    );

    expect(Redacted.value(token)).toBe("system-secret");
    expect(JSON.stringify(token)).not.toContain("system-secret");
  });

  it("fails closed when the internal token is absent", async () => {
    const exit = await Effect.runPromiseExit(
      ImportSystemAuthorizationConfig.pipe(
        Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({})))
      )
    );

    expect(exit._tag).toBe("Failure");
  });
});

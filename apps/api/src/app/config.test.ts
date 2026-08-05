import { Cause, ConfigProvider, Effect, Exit, Layer } from "effect";
import { describe, expect, it } from "vitest";

import { AppConfigDefinition, AppConfigLive } from "./config.js";

const parseConfig = (source: Record<string, string>) =>
  Effect.runPromise(
    AppConfigDefinition.parse(ConfigProvider.fromUnknown(source))
  );

const renderConfigFailure = async (source: Record<string, string>) => {
  const exit = await Effect.runPromise(
    Effect.scoped(Layer.build(AppConfigLive)).pipe(
      Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(source))),
      Effect.exit
    )
  );
  if (Exit.isSuccess(exit)) {
    throw new Error("Expected application configuration to fail");
  }
  return Cause.pretty(exit.cause);
};

describe("AppConfigDefinition", () => {
  it("parses server configuration without requiring Tesco credentials", async () => {
    const config = await parseConfig({
      HOST: "127.0.0.1",
      PORT: "3000",
    });

    expect(config).toStrictEqual({
      server: {
        host: "127.0.0.1",
        port: 3000,
      },
    });
  });

  it("does not supply defaults for missing required configuration", async () => {
    await expect(parseConfig({ PORT: "3000" })).rejects.toThrow();
  });

  it("rejects blank or normalized host values", async () => {
    await expect(
      parseConfig({
        HOST: " localhost ",
        PORT: "3000",
      })
    ).rejects.toThrow();
  });

  it("renders value-free application configuration diagnostics", async () => {
    const canary = " malformed-host-canary ";
    const diagnostic = await renderConfigFailure({
      HOST: canary,
      PORT: "3000",
    });

    expect(diagnostic).toContain("AppConfigError");
    expect(diagnostic).not.toContain(canary);
  });
});

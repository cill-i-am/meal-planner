import { ConfigProvider, Effect } from "effect";
import { describe, expect, it } from "vitest";

import { AppConfigDefinition } from "./config.js";

const parseConfig = (source: Record<string, string>) =>
  Effect.runPromise(
    AppConfigDefinition.parse(ConfigProvider.fromUnknown(source))
  );

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
});

import { ConfigProvider, Effect } from "effect";
import { describe, expect, it } from "vitest";

import { AppConfigDefinition } from "./config.js";

const oauthExpiryCookie = encodeURIComponent(
  JSON.stringify({
    AccessToken: Date.now() + 300_000,
    RefreshToken: Date.now() + 3_600_000,
  })
);

const validConfig = {
  HOST: "127.0.0.1",
  PORT: "3000",
  TESCO_AUTHORIZATION: "Bearer test-token",
  TESCO_AUTH_COOKIE_HEADER: `OAuth.TokensExpiryTime=${oauthExpiryCookie}; other=value`,
  TESCO_AUTH_REFRESH_FROM_URL: "https://www.tesco.ie/shop/en-IE",
  TESCO_LOCALE: "en-IE",
  TESCO_MANGO_API_KEY: "test-api-key",
  TESCO_MANGO_URL: "https://xapi.tesco.com/",
  TESCO_REGION: "IE",
  TESCO_SOFT_REFRESH_SIGN_IN_URL: "https://www.tesco.ie/account/login/en-IE",
  TESCO_SUGGESTION_URL: "https://search.api.tesco.com/search/suggestion/",
};

const parseConfig = (source: Record<string, string>) =>
  Effect.runPromise(
    AppConfigDefinition.parse(ConfigProvider.fromUnknown(source))
  );

describe("AppConfigDefinition", () => {
  it("parses required configuration values", async () => {
    const config = await parseConfig({
      ...validConfig,
      TESCO_RELEASE_BRANCH: "release",
      TESCO_TRANSACTION_PURPOSE: "shopping",
    });

    expect(config.server).toStrictEqual({
      host: "127.0.0.1",
      port: 3000,
    });
    expect(config.tesco.mangoUrl.href).toBe("https://xapi.tesco.com/");
    expect(config.tesco.suggestionUrl.href).toBe(
      "https://search.api.tesco.com/search/suggestion/"
    );
    expect(config.tesco.locale).toBe("en-IE");
    expect(config.tesco.region).toBe("IE");
    expect(config.tesco.mangoApiKey).toBe("test-api-key");
    expect(config.tesco.authorization).toBe("Bearer test-token");
    expect(config.tesco.authCookieHeader).toBe(
      validConfig.TESCO_AUTH_COOKIE_HEADER
    );
    expect(config.tesco.softRefreshSignInUrl.href).toBe(
      "https://www.tesco.ie/account/login/en-IE"
    );
    expect(config.tesco.authRefreshFromUrl.href).toBe(
      "https://www.tesco.ie/shop/en-IE"
    );
    expect(config.tesco.transactionPurpose).toBe("shopping");
    expect(config.tesco.releaseBranch).toBe("release");
  });

  it("does not supply defaults for missing required configuration", async () => {
    const { HOST: _host, ...withoutHost } = validConfig;

    await expect(parseConfig(withoutHost)).rejects.toThrow();
  });

  it("rejects blank or normalized configuration values", async () => {
    await expect(
      parseConfig({
        ...validConfig,
        TESCO_AUTHORIZATION: "",
      })
    ).rejects.toThrow();
    await expect(
      parseConfig({
        ...validConfig,
        TESCO_AUTHORIZATION: "test-token",
      })
    ).rejects.toThrow();
    await expect(
      parseConfig({
        ...validConfig,
        TESCO_AUTH_COOKIE_HEADER: "other=value",
      })
    ).rejects.toThrow();
    await expect(
      parseConfig({
        ...validConfig,
        TESCO_REGION: "ie",
      })
    ).rejects.toThrow();
  });

  it("keeps optional Tesco headers absent when they are not configured", async () => {
    const config = await parseConfig(validConfig);

    expect(config.tesco.transactionPurpose).toBeNull();
    expect(config.tesco.releaseBranch).toBeNull();
  });
});

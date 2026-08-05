import { ConfigProvider, Effect, Redacted } from "effect";
import { describe, expect, it } from "vitest";

import { loadTescoConfig } from "./tesco.config.js";

const validConfig = {
  TESCO_AUTHORIZATION: "Bearer test-authorization-secret",
  TESCO_AUTH_COOKIE_HEADER:
    "OAuth.TokensExpiryTime=test-cookie-secret; other=value",
  TESCO_AUTH_REFRESH_FROM_URL: "https://www.tesco.ie/shop/en-IE",
  TESCO_LOCALE: "en-IE",
  TESCO_MANGO_API_KEY: "test-api-key-secret",
  TESCO_MANGO_URL: "https://xapi.tesco.com/",
  TESCO_REGION: "IE",
  TESCO_SOFT_REFRESH_SIGN_IN_URL: "https://www.tesco.ie/account/login/en-IE",
  TESCO_SUGGESTION_URL: "https://search.api.tesco.com/search/suggestion/",
};

const loadConfig = (source: Record<string, string>) =>
  loadTescoConfig.pipe(
    Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(source)))
  );

describe("TescoConfigDefinition", () => {
  it("parses secrets once into redacted consumer-shaped configuration", async () => {
    const config = await Effect.runPromise(loadConfig(validConfig));

    expect(Redacted.isRedacted(config.authBootstrap.initialAuthorization)).toBe(
      true
    );
    expect(Redacted.isRedacted(config.authBootstrap.initialCookieHeader)).toBe(
      true
    );
    expect(Redacted.isRedacted(config.catalogue.mangoApiKey)).toBe(true);
    expect(config.softLogin.locale).toBe("en-IE");
    expect(config.catalogue.locale).toBe("en-IE");
    expect(JSON.stringify(config)).not.toContain("test-authorization-secret");
    expect(JSON.stringify(config)).not.toContain("test-cookie-secret");
    expect(JSON.stringify(config)).not.toContain("test-api-key-secret");
  });

  it("reports invalid secrets without retaining their value or raw cause", async () => {
    const invalidSecret = "invalid-authorization-secret";
    const error = await Effect.runPromise(
      loadConfig({
        ...validConfig,
        TESCO_AUTHORIZATION: invalidSecret,
      }).pipe(Effect.flip)
    );

    expect(error).toMatchObject({
      _tag: "TescoConfigError",
      issues: [
        {
          environmentVariable: "TESCO_AUTHORIZATION",
          reason: "invalid",
        },
      ],
      message: "Invalid Tesco configuration: TESCO_AUTHORIZATION invalid",
    });
    expect(JSON.stringify(error)).not.toContain(invalidSecret);
    expect(error).not.toHaveProperty("cause");
  });

  it("distinguishes a missing allowlisted environment variable", async () => {
    const { TESCO_MANGO_API_KEY: _apiKey, ...withoutApiKey } = validConfig;
    const error = await Effect.runPromise(
      loadConfig(withoutApiKey).pipe(Effect.flip)
    );

    expect(error.issues).toStrictEqual([
      {
        environmentVariable: "TESCO_MANGO_API_KEY",
        reason: "missing",
      },
    ]);
  });
});

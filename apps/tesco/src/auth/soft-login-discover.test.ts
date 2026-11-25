import { Effect, Equal, Redacted, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { TescoAuthorizationValue } from "./auth.model.js";
import { authorizationFromDiscoverHtml } from "./soft-login-discover.js";

const htmlWithDiscoverConfig = (authorization: string) => `
  <!doctype html>
  <html>
    <head>
      <script type="application/discover+json">${JSON.stringify({
        "mfe-orchestrator": {
          props: {
            config: {
              authorization,
            },
          },
        },
      })}</script>
    </head>
  </html>
`;

describe("soft-login discover config", () => {
  it("extracts the renewed authorization from Tesco discover HTML", async () => {
    const authorization = await Effect.runPromise(
      authorizationFromDiscoverHtml(
        htmlWithDiscoverConfig("Bearer refreshed-token")
      )
    );

    const expected = Redacted.make(
      Schema.decodeUnknownSync(TescoAuthorizationValue)(
        "Bearer refreshed-token"
      )
    );

    expect(Equal.equals(authorization, expected)).toBe(true);
    expect(String(authorization)).toBe("<redacted>");
  });

  it("rejects HTML without a discover config", async () => {
    await expect(
      Effect.runPromise(authorizationFromDiscoverHtml("<html></html>"))
    ).rejects.toMatchObject({
      _tag: "TescoSoftLoginResponseInvalid",
    });
  });

  it("rejects discover config without a bearer authorization", async () => {
    await expect(
      Effect.runPromise(
        authorizationFromDiscoverHtml(
          htmlWithDiscoverConfig("not-a-bearer-token")
        )
      )
    ).rejects.toMatchObject({
      _tag: "TescoSoftLoginResponseInvalid",
    });
  });
});

import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import {
  authorizationFromDiscoverConfig,
  discoverJsonFromHtml,
} from "./soft-login-discover.js";

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
      discoverJsonFromHtml(
        htmlWithDiscoverConfig("Bearer refreshed-token")
      ).pipe(Effect.flatMap(authorizationFromDiscoverConfig))
    );

    expect(authorization).toBe("Bearer refreshed-token");
  });

  it("rejects HTML without a discover config", async () => {
    await expect(
      Effect.runPromise(discoverJsonFromHtml("<html></html>"))
    ).rejects.toMatchObject({
      _tag: "TescoAuthRefreshError",
      status: 502,
    });
  });

  it("rejects discover config without a bearer authorization", async () => {
    await expect(
      Effect.runPromise(
        discoverJsonFromHtml(htmlWithDiscoverConfig("not-a-bearer-token")).pipe(
          Effect.flatMap(authorizationFromDiscoverConfig)
        )
      )
    ).rejects.toMatchObject({
      _tag: "TescoAuthRefreshError",
      status: 502,
    });
  });
});

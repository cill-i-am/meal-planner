import { Effect, Layer } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { afterAll, describe, expect, it } from "vitest";

import { AppRoutes } from "../../../app/routes.js";
import {
  TescoCatalogueAuthenticationUnavailable,
  TescoCatalogueRequestRejected,
  TescoCatalogueResponseInvalid,
  TescoCatalogueUnavailable,
} from "./catalogue.errors.js";
import type { TescoCatalogueError } from "./catalogue.errors.js";
import { TescoCatalogue } from "./catalogue.port.js";
import { TescoCatalogueRoutes } from "./catalogue.routes.js";

const makeApp = (service: TescoCatalogue) =>
  HttpRouter.toWebHandler(
    Layer.mergeAll(
      HttpRouter.addAll(TescoCatalogueRoutes),
      Layer.succeed(TescoCatalogue, TescoCatalogue.of(service))
    ),
    { disableLogger: true }
  );

const failingCatalogue = (failure: TescoCatalogueError): TescoCatalogue => ({
  categoryProducts: () => Effect.fail(failure),
  search: () => Effect.fail(failure),
  suggestions: () => Effect.fail(failure),
});

describe("Tesco catalogue routes", () => {
  const apps: ReturnType<typeof HttpRouter.toWebHandler>[] = [];

  afterAll(async () => {
    await Promise.all(apps.map(({ dispose }) => dispose()));
  });

  it.each([
    {
      expected: {
        body: {
          error: "upstream_authentication_unavailable",
          message: "The upstream service is not currently authenticated.",
        },
        status: 503,
      },
      failure: new TescoCatalogueAuthenticationUnavailable({
        operation: "search",
      }),
    },
    {
      expected: {
        body: {
          error: "upstream_unavailable",
          message: "The upstream service is unavailable.",
        },
        status: 502,
      },
      failure: new TescoCatalogueUnavailable({ operation: "search" }),
    },
    {
      expected: {
        body: {
          error: "upstream_request_rejected",
          message: "The upstream service rejected the request.",
        },
        status: 502,
      },
      failure: new TescoCatalogueRequestRejected({ operation: "search" }),
    },
    {
      expected: {
        body: {
          error: "upstream_invalid_response",
          message: "The upstream service returned an invalid response.",
        },
        status: 502,
      },
      failure: new TescoCatalogueResponseInvalid({ operation: "search" }),
    },
  ])(
    "projects $failure._tag to a fixed safe response",
    async ({ failure, expected }) => {
      const app = makeApp(failingCatalogue(failure));
      apps.push(app);

      const response = await app.handler(
        new Request("https://meal-planner.test/tesco/search?query=milk")
      );

      expect(response.status).toBe(expected.status);
      await expect(response.json()).resolves.toStrictEqual(expected.body);
    }
  );

  it("projects query decoding failures without exposing decoder details", async () => {
    const app = makeApp(
      failingCatalogue(new TescoCatalogueUnavailable({ operation: "search" }))
    );
    apps.push(app);

    const response = await app.handler(
      new Request("https://meal-planner.test/tesco/search")
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toStrictEqual({
      error: "invalid_request",
      message: "The request is invalid.",
    });
  });

  it("projects body decoding failures without exposing decoder details", async () => {
    const canary = "provider-secret-invalid-query";
    const app = makeApp(
      failingCatalogue(new TescoCatalogueUnavailable({ operation: "search" }))
    );
    apps.push(app);

    const response = await app.handler(
      new Request("https://meal-planner.test/tesco/search", {
        body: JSON.stringify({ query: ` ${canary}` }),
        headers: { "content-type": "application/json" },
        method: "POST",
      })
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toStrictEqual({
      error: "invalid_request",
      message: "The request is invalid.",
    });
    expect(JSON.stringify(body)).not.toContain(canary);
  });

  it("does not expose a generic GraphQL operation", async () => {
    const calls: string[] = [];
    const app = HttpRouter.toWebHandler(
      Layer.mergeAll(
        AppRoutes,
        Layer.succeed(
          TescoCatalogue,
          TescoCatalogue.of({
            categoryProducts: () =>
              Effect.sync(() => {
                calls.push("categoryProducts");
                throw new Error("Unexpected Tesco catalogue operation");
              }),
            search: () =>
              Effect.sync(() => {
                calls.push("search");
                throw new Error("Unexpected Tesco catalogue operation");
              }),
            suggestions: () =>
              Effect.sync(() => {
                calls.push("suggestions");
                throw new Error("Unexpected Tesco catalogue operation");
              }),
          })
        )
      ),
      { disableLogger: true }
    );
    apps.push(app);

    const response = await app.handler(
      new Request("https://meal-planner.test/tesco/graphql", {
        body: JSON.stringify({
          operationName: "WriteBasket",
          query: 'mutation WriteBasket { addItem(productId: "123") }',
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      })
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "NotFound",
      message: "Route not found",
    });
    expect(calls).toStrictEqual([]);
  });
});

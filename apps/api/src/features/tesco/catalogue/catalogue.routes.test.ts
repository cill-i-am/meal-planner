import { Effect, Layer } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { afterAll, describe, expect, it } from "vitest";

import { AppRoutes } from "../../../app/routes.js";
import { TescoCatalogue } from "./catalogue.port.js";

describe("Tesco catalogue routes", () => {
  const apps: ReturnType<typeof HttpRouter.toWebHandler>[] = [];

  afterAll(async () => {
    await Promise.all(apps.map(({ dispose }) => dispose()));
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

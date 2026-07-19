import { HttpRouter } from "effect/unstable/http";
import { afterAll, describe, expect, it } from "vitest";

import { HealthWorkerRoutes } from "./health.routes.js";

const app = HttpRouter.toWebHandler(HealthWorkerRoutes, {
  disableLogger: true,
});

afterAll(() => app.dispose());

describe("health routes", () => {
  it("returns the typed health response", async () => {
    const response = await app.handler(
      new Request("https://meal-planner.test/health")
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it("returns the API not-found contract outside the health route", async () => {
    const response = await app.handler(
      new Request("https://meal-planner.test/not-health")
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "NotFound",
      message: "Route not found",
    });
  });
});

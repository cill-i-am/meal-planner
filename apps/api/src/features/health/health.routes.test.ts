import { HttpRouter } from "effect/unstable/http";
import { afterAll, describe, expect, it } from "vitest";

import { HealthRoutes } from "./health.routes.js";

const app = HttpRouter.toWebHandler(HttpRouter.addAll(HealthRoutes), {
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
});

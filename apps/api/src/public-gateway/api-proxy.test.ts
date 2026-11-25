import { describe, expect, it, vi } from "vitest";

import { isApiRequest } from "./api-proxy.js";
import worker from "./worker.js";

describe("same-origin API proxy", () => {
  it.each([
    "/api/auth/sign-in/email",
    "/api/auth/get-session",
    "/v1/recipe-import-intents",
    "/mcp",
    "/.well-known/oauth-protected-resource/mcp",
    "/.well-known/oauth-authorization-server/api/auth",
  ])("routes %s to the private API service", (pathname) => {
    expect(
      isApiRequest(new Request(`https://meal-planner.test${pathname}`))
    ).toBe(true);
  });

  it("excludes application and lookalike paths from the API", () => {
    expect(isApiRequest(new Request("https://meal-planner.test/"))).toBe(false);
    expect(
      isApiRequest(new Request("https://meal-planner.test/api/authentication"))
    ).toBe(false);
    expect(
      isApiRequest(new Request("https://meal-planner.test/v10/recipes"))
    ).toBe(false);
    expect(
      isApiRequest(new Request("https://meal-planner.test/mcp-tools"))
    ).toBe(false);
  });

  it("forwards the original request and returns the original response", async () => {
    const request = new Request(
      "https://meal-planner.test/api/auth/sign-in/email",
      {
        body: JSON.stringify({ email: "cook@example.com" }),
        headers: {
          "content-type": "application/json",
          cookie: "better-auth.session_token=session-secret",
        },
        method: "POST",
      }
    );
    const response = new Response(null, {
      headers: {
        "set-cookie":
          "better-auth.session_token=new-session; Path=/; HttpOnly; SameSite=Lax",
      },
      status: 204,
    });
    const binding = { fetch: () => response };
    const fetch = vi.spyOn(binding, "fetch");

    const proxied = await worker.fetch(request, {
      MEAL_PLANNER_API: binding,
    });

    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith(request);
    expect(proxied).toBe(response);
    expect(request.headers.get("cookie")).toBe(
      "better-auth.session_token=session-secret"
    );
    expect(proxied.headers.get("set-cookie")).toBe(
      "better-auth.session_token=new-session; Path=/; HttpOnly; SameSite=Lax"
    );
  });
});

import { describe, expect, it, vi } from "vitest";

import { isApiRequest, proxyApiRequest } from "./api-proxy.js";

describe("same-origin API proxy", () => {
  it.each([
    "/api/auth/sign-in/email",
    "/api/auth/get-session",
    "/v1/recipe-import-intents",
  ])("routes %s to the private API service", (pathname) => {
    expect(
      isApiRequest(new Request(`https://meal-planner.test${pathname}`))
    ).toBe(true);
  });

  it("leaves application and lookalike paths with TanStack Start", () => {
    expect(isApiRequest(new Request("https://meal-planner.test/"))).toBe(false);
    expect(
      isApiRequest(new Request("https://meal-planner.test/api/authentication"))
    ).toBe(false);
    expect(
      isApiRequest(new Request("https://meal-planner.test/v10/recipes"))
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
    const fetch = vi.fn(async () => response);

    const proxied = await proxyApiRequest(request, { fetch });

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

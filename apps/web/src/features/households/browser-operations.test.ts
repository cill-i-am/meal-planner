import { HouseholdStatus } from "@meal-planner/household-api";
// @vitest-environment jsdom
import { Schema } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";

import { parseDisplayedIdentity } from "../auth/displayed-identity.js";
import { makeBrowserHouseholdOperations } from "./browser-operations.js";

afterEach(() => vi.unstubAllGlobals());

const householdStatus = Schema.encodeSync(HouseholdStatus)(
  Schema.decodeUnknownSync(HouseholdStatus)({
    createdAtEpochMs: 1_777_777_777_777,
    organizationId: "organization-a",
    status: "ready",
  })
);

describe("browser household operations", () => {
  it("uses the same-origin generated client with the expected displayed identity", async () => {
    const fetch = vi.fn(
      async (request: RequestInfo | URL, init?: RequestInit) => {
        const normalized = new Request(request, init);
        expect(normalized.url).toBe(
          `${globalThis.location.origin}/v1/household`
        );
        expect(normalized.method).toBe("GET");
        expect(normalized.headers.has("authorization")).toBe(false);
        expect(normalized.headers.get("x-meal-planner-user")).toBe("user-a");
        expect(normalized.headers.get("x-meal-planner-household")).toBe(
          "organization-a"
        );
        expect(normalized.credentials).toBe("same-origin");
        expect(await normalized.text()).toBe("");
        return Response.json(householdStatus);
      }
    );
    vi.stubGlobal("fetch", fetch);

    const result = await makeBrowserHouseholdOperations(
      parseDisplayedIdentity({
        organizationId: "organization-a",
        userId: "user-a",
      })
    ).current();

    expect(result.organizationId).toBe("organization-a");
    expect(fetch).toHaveBeenCalledOnce();
  });
});

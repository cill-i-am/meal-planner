import { describe, expect, it } from "vitest";

import { decodeAuthSearch, readOAuthQuery } from "../auth/index.js";
import { parseAuthorizationRequest } from "./authorization-request.js";

const query =
  "?client_id=client-1&scope=meal-planner%3Aread+offline_access&resource=https%3A%2F%2Fmeal.test%2Fmcp&resource=https%3A%2F%2Fmeal.test%2Fv1&ba_param=client_id&ba_param=scope&sig=opaque%2Bsignature";

describe("OAuth browser continuation", () => {
  it("retains raw signed bytes, repeated resource parameters and requested scope order", () => {
    expect(parseAuthorizationRequest(query)).toEqual({
      clientId: "client-1",
      oauthQuery: query,
      scopes: ["meal-planner:read", "offline_access"],
    });
    expect(readOAuthQuery(query)).toBe(query);
    expect(
      decodeAuthSearch({ redirect: `/oauth/consent${query}` }).redirect
    ).toBe(`/oauth/consent${query}`);
  });
  it.each([
    "",
    "?client_id=x&scope=meal-planner:read",
    "?client_id=x&scope=meal-planner:read&sig=",
    "?client_id=x&scope=meal-planner:read&sig=s&client_id=y",
    "?client_id=x&scope=meal-planner:read&sig=s&scope=meal-planner:write",
    "?client_id=x&scope=meal-planner:read&sig=s&sig=t",
  ])("rejects an incomplete or ambiguous request %s", (search) => {
    expect(parseAuthorizationRequest(search)).toBeNull();
  });
  it("does not treat an ordinary local return path as provider authority", () => {
    expect(readOAuthQuery("?redirect=/oauth/consent")).toBeUndefined();
    expect(
      decodeAuthSearch({ redirect: "https://attacker.test/oauth/consent" })
    ).toEqual({ redirect: "/" });
  });
});

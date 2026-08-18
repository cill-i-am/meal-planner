import { describe, expect, it } from "vitest";

import { deriveAuthBoundaryState } from "./auth-state.js";

const user = { email: "cook@example.com", name: "Cillian" };
const household = {
  id: "org-1",
  name: "Barron home",
  slug: "barron-home",
};
const query = <T>(data: T | null, error: unknown = null) => ({
  data,
  error,
  isPending: false,
});

describe("deriveAuthBoundaryState", () => {
  it.each([
    {
      activeOrganization: query(household),
      organizations: query([household]),
      session: query(null, new Error("session unavailable")),
    },
    {
      activeOrganization: query(household),
      organizations: query([household], new Error("organizations unavailable")),
      session: query({ user }),
    },
    {
      activeOrganization: query(
        household,
        new Error("active organization unavailable")
      ),
      organizations: query([household]),
      session: query({ user }),
    },
  ])("returns a safe error state for an auth query failure", (queries) => {
    expect(deriveAuthBoundaryState(queries)).toEqual({ kind: "error" });
  });

  it("does not treat unauthenticated organization query failures as an outage", () => {
    expect(
      deriveAuthBoundaryState({
        activeOrganization: query(null, new Error("unauthorized")),
        organizations: query(null, new Error("unauthorized")),
        session: query(null),
      })
    ).toEqual({ kind: "anonymous" });
  });
});

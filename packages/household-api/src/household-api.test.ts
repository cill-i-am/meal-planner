import { Schema } from "effect";
import { OpenApi } from "effect/unstable/httpapi";
import { describe, expect, it } from "vitest";

import {
  HouseholdApi,
  HouseholdOrganizationId,
  HouseholdStatus,
} from "./index.js";

describe("Household API protocol", () => {
  it("keeps organization selection out of the browser request", () => {
    const document = OpenApi.fromApi(HouseholdApi);
    const operation = document.paths["/v1/household"]?.get;

    expect(operation).toMatchObject({
      responses: {
        "200": expect.any(Object),
        "401": expect.any(Object),
        "500": expect.any(Object),
      },
    });
    expect(operation?.parameters).toEqual([]);
    expect(operation).not.toHaveProperty("requestBody");
  });

  it("admits only bounded organization IDs and ready status values", () => {
    expect(Schema.is(HouseholdOrganizationId)("organization-a")).toBe(true);
    expect(Schema.is(HouseholdOrganizationId)(" organization-a ")).toBe(false);
    expect(
      Schema.is(HouseholdStatus)({
        createdAtEpochMs: 1,
        organizationId: "organization-a",
        status: "ready",
      })
    ).toBe(true);
  });
});

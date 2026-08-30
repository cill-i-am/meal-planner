// @vitest-environment jsdom

import {
  HouseholdPersonId,
  HouseholdPersonMutationId,
  TransitionHouseholdPersonPayload,
} from "@meal-planner/household-api";
import { Schema } from "effect";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { makeBrowserHouseholdPeopleOperations } from "./browser-operations.js";

const fetchMock = vi.fn<typeof fetch>();

beforeAll(() => vi.stubGlobal("fetch", fetchMock));
afterEach(() => fetchMock.mockReset());
afterAll(() => vi.unstubAllGlobals());

describe("browser household people operations", () => {
  it("preserves a typed deterministic household people failure", async () => {
    fetchMock.mockImplementation(async () =>
      Response.json(
        {
          code: "stale_version",
          message: "The expected person version is stale.",
          status: 409,
        },
        {
          headers: { "content-type": "application/problem+json" },
          status: 409,
        }
      )
    );

    const personId = Schema.decodeUnknownSync(HouseholdPersonId)(
      "person_00000000-0000-4000-8000-000000000101"
    );
    const mutationId = Schema.decodeUnknownSync(HouseholdPersonMutationId)(
      "00000000-0000-4000-8000-000000000102"
    );
    const payload = Schema.decodeUnknownSync(TransitionHouseholdPersonPayload)({
      expectedVersion: 1,
      mutationId,
    });

    await expect(
      makeBrowserHouseholdPeopleOperations().archive(personId, payload)
    ).rejects.toMatchObject({ code: "stale_version" });
  });

  it("classifies a transport failure as an ambiguous availability outcome", async () => {
    fetchMock.mockImplementation(async () => {
      throw new TypeError("connection lost");
    });

    await expect(
      makeBrowserHouseholdPeopleOperations().list(true)
    ).rejects.toMatchObject({ code: "transport_unavailable" });
  });

  it("classifies an undecodable success response as an ambiguous mutation outcome", async () => {
    fetchMock.mockImplementation(async () =>
      Response.json(
        { lifecycle: "active", unexpected: "missing person identity" },
        { status: 200 }
      )
    );

    const personId = Schema.decodeUnknownSync(HouseholdPersonId)(
      "person_00000000-0000-4000-8000-000000000103"
    );
    const mutationId = Schema.decodeUnknownSync(HouseholdPersonMutationId)(
      "00000000-0000-4000-8000-000000000104"
    );
    const payload = Schema.decodeUnknownSync(TransitionHouseholdPersonPayload)({
      expectedVersion: 1,
      mutationId,
    });

    await expect(
      makeBrowserHouseholdPeopleOperations().archive(personId, payload)
    ).rejects.toMatchObject({ code: "transport_unavailable" });
  });
});

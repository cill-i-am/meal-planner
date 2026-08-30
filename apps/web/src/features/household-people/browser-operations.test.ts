// @vitest-environment jsdom

import {
  HouseholdPersonId,
  HouseholdPersonMutationId,
  TransitionHouseholdPersonPayload,
} from "@meal-planner/household-api";
import { Cause, Schema } from "effect";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  classifyHouseholdPeopleOperationCause,
  makeBrowserHouseholdPeopleOperations,
} from "./browser-operations.js";

const fetchMock = vi.fn<typeof fetch>();

beforeAll(() => vi.stubGlobal("fetch", fetchMock));
afterEach(() => fetchMock.mockReset());
afterAll(() => vi.unstubAllGlobals());

describe("browser household people operations", () => {
  it.each([
    {
      cause: Cause.combine(
        Cause.fail({ code: "stale_version" }),
        Cause.fail({
          _tag: "HttpClientError",
          reason: { _tag: "DecodeError" },
        })
      ),
      label: "typed failure before malformed response",
    },
    {
      cause: Cause.combine(
        Cause.fail({
          _tag: "HttpClientError",
          reason: { _tag: "DecodeError" },
        }),
        Cause.fail({ code: "stale_version" })
      ),
      label: "malformed response before typed failure",
    },
    {
      cause: Cause.fail(
        new Error("generated client wrapper", {
          cause: {
            _tag: "HttpClientError",
            reason: { _tag: "EmptyBodyError" },
          },
        })
      ),
      label: "malformed response nested under a wrapper",
    },
  ])("prioritizes ambiguity for $label", ({ cause }) => {
    expect(classifyHouseholdPeopleOperationCause(cause)).toMatchObject({
      code: "transport_unavailable",
    });
  });

  it("keeps an unaccompanied valid domain failure deterministic", () => {
    expect(
      classifyHouseholdPeopleOperationCause(
        Cause.fail({ code: "stale_version" })
      )
    ).toMatchObject({ code: "stale_version" });
  });

  it("does not treat an isolated status-code failure as decode ambiguity", () => {
    expect(
      classifyHouseholdPeopleOperationCause(
        Cause.fail({
          _tag: "HttpClientError",
          reason: { _tag: "StatusCodeError" },
        })
      )
    ).toMatchObject({ code: "unexpected_failure" });
  });

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

  it("classifies an undecodable declared 409 response as ambiguous", async () => {
    fetchMock.mockImplementation(async () =>
      Response.json(
        { code: "stale_version", malformed: true },
        { headers: { "content-type": "application/problem+json" }, status: 409 }
      )
    );
    const personId = Schema.decodeUnknownSync(HouseholdPersonId)(
      "person_00000000-0000-4000-8000-000000000105"
    );
    const payload = Schema.decodeUnknownSync(TransitionHouseholdPersonPayload)({
      expectedVersion: 1,
      mutationId: "00000000-0000-4000-8000-000000000106",
    });
    await expect(
      makeBrowserHouseholdPeopleOperations().archive(personId, payload)
    ).rejects.toMatchObject({ code: "transport_unavailable" });
  });
});

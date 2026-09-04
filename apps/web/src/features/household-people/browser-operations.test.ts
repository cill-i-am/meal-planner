// @vitest-environment jsdom

import {
  AssociateHouseholdAdultInvitationPayload,
  CancelHouseholdAdultDeparturePayload,
  HouseholdMemberDepartureOperationId,
  HouseholdPersonId,
  HouseholdPersonMutationId,
  InviteHouseholdAdultPayload,
  RetryHouseholdAdultDeparturePayload,
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

const wrapErrorCause = (cause: unknown, depth: number) => {
  let current = new Error("generated client decoder", { cause });
  for (let index = 0; index < depth; index += 1) {
    current = new Error("generated client wrapper", { cause: current });
  }
  return current;
};

beforeAll(() => vi.stubGlobal("fetch", fetchMock));
afterEach(() => fetchMock.mockReset());
afterAll(() => vi.unstubAllGlobals());

describe("browser household people operations", () => {
  it("routes exact invitation replay, read-only reconciliation, and departure recovery", async () => {
    const personId = Schema.decodeUnknownSync(HouseholdPersonId)(
      "person_00000000-0000-4000-8000-000000000101"
    );
    const operationId = Schema.decodeUnknownSync(
      HouseholdMemberDepartureOperationId
    )("departure_00000000-0000-4000-8000-000000000201");
    const departureMutationId = Schema.decodeUnknownSync(
      HouseholdPersonMutationId
    )("00000000-0000-4000-8000-000000000102");
    const person = {
      associationState: "invitation_pending",
      associationVersion: 1,
      createdAtEpochMs: 1,
      displayName: "Cillian",
      id: personId,
      isCurrentAdult: false,
      kind: "adult",
      lifecycle: "active",
      updatedAtEpochMs: 1,
      version: 2,
    };
    const departure = {
      canRetry: true,
      executionGeneration: 1,
      lastAttemptAtEpochMs: 2,
      operationId,
      personId,
      state: "revocation_repair_required",
      version: 2,
    };
    fetchMock
      .mockResolvedValueOnce(
        Response.json(
          {
            association: "associated",
            invitationId: "invitation-a",
            person,
          },
          { status: 201 }
        )
      )
      .mockResolvedValueOnce(Response.json(person))
      .mockResolvedValueOnce(Response.json(departure))
      .mockResolvedValueOnce(Response.json(departure))
      .mockResolvedValueOnce(
        Response.json({ ...departure, state: "cancelled", version: 3 })
      )
      .mockResolvedValueOnce(
        Response.json(
          { ...departure, state: "revoking_access", version: 3 },
          { status: 202 }
        )
      );
    const operations = makeBrowserHouseholdPeopleOperations();
    const invitePayload = Schema.decodeUnknownSync(InviteHouseholdAdultPayload)(
      {
        email: "adult@example.test",
        mutationId: departureMutationId,
        personId,
      }
    );

    await operations.inviteAdult?.(invitePayload);
    await operations.associateInvitation?.(
      Schema.decodeUnknownSync(AssociateHouseholdAdultInvitationPayload)({
        email: "adult@example.test",
        mutationId: departureMutationId,
        personId,
      })
    );
    await operations.getDepartureByMutation?.(departureMutationId);
    await operations.getDeparture?.(operationId);
    await operations.cancelDeparture?.(
      operationId,
      Schema.decodeUnknownSync(CancelHouseholdAdultDeparturePayload)({
        expectedOperationVersion: 2,
        mutationId: "00000000-0000-4000-8000-000000000103",
      })
    );
    await operations.retryDeparture?.(
      operationId,
      Schema.decodeUnknownSync(RetryHouseholdAdultDeparturePayload)({
        expectedOperationVersion: 2,
        memberId: "member-a",
        mutationId: "00000000-0000-4000-8000-000000000104",
        reason: "Explicit departure repair",
      })
    );

    expect(
      fetchMock.mock.calls.map(([request, init]) => {
        const url =
          request instanceof Request ? request.url : request.toString();
        const method =
          request instanceof Request ? request.method : (init?.method ?? "GET");
        return [method, new URL(url, globalThis.location.origin).pathname];
      })
    ).toEqual([
      ["POST", "/v1/household/people/invitations"],
      ["POST", "/v1/household/people/invitations/associate"],
      [
        "GET",
        `/v1/household/people/departures/by-mutation/${departureMutationId}`,
      ],
      ["GET", `/v1/household/people/departures/${operationId}`],
      ["POST", `/v1/household/people/departures/${operationId}/cancel`],
      ["POST", `/v1/household/people/departures/${operationId}/retry`],
    ]);
    const [invitationCall] = fetchMock.mock.calls;
    if (invitationCall === undefined) {
      throw new Error("Expected the generated client to send the invitation");
    }
    const [invitationRequest, invitationInit] = invitationCall;
    const replayedRequest =
      invitationRequest instanceof Request
        ? invitationRequest.clone()
        : new Request(invitationRequest, invitationInit);
    await expect(replayedRequest.json()).resolves.toEqual(
      Schema.encodeSync(InviteHouseholdAdultPayload)(invitePayload)
    );
  });

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
      cause: Cause.combine(
        Cause.fail({
          _tag: "HttpClientError",
          reason: { _tag: "StatusCodeError" },
        }),
        Cause.die({
          _tag: "HttpClientError",
          reason: { _tag: "DecodeError" },
        })
      ),
      label: "malformed declared response represented as a defect",
    },
    {
      cause: Cause.fail(
        wrapErrorCause(
          {
            _tag: "HttpClientError",
            reason: { _tag: "EmptyBodyError" },
          },
          12
        )
      ),
      label: "malformed response below more than eight wrappers",
    },
  ])("prioritizes ambiguity for $label", ({ cause }) => {
    expect(classifyHouseholdPeopleOperationCause(cause)).toMatchObject({
      code: "transport_unavailable",
    });
  });

  it("terminates safely when wrapper causes contain a cycle", () => {
    const first = new Error("first");
    const second = new Error("second", { cause: first });
    Object.defineProperty(first, "cause", { value: second });

    expect(
      classifyHouseholdPeopleOperationCause(Cause.fail(first))
    ).toMatchObject({ code: "unexpected_failure" });
  });

  it("treats an opaque generated-client defect as ambiguous", () => {
    expect(
      classifyHouseholdPeopleOperationCause(Cause.die(Object.create(null)))
    ).toMatchObject({ code: "transport_unavailable" });
  });

  it("prioritizes an opaque defect over a typed deterministic failure", () => {
    expect(
      classifyHouseholdPeopleOperationCause(
        Cause.combine(
          Cause.fail({ code: "stale_version" }),
          Cause.die(Object.create(null))
        )
      )
    ).toMatchObject({ code: "transport_unavailable" });
  });

  it("keeps an ordinary unknown typed failure unexpected", () => {
    expect(
      classifyHouseholdPeopleOperationCause(Cause.fail(Object.create(null)))
    ).toMatchObject({ code: "unexpected_failure" });
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

  it("classifies a structurally valid cross-instance server failure", () => {
    expect(
      classifyHouseholdPeopleOperationCause(
        Cause.fail({
          _tag: "HttpClientError",
          reason: {
            _tag: "StatusCodeError",
            response: { status: 503 },
          },
        })
      )
    ).toMatchObject({ code: "transport_unavailable" });
  });

  it("classifies a cross-instance schema failure without nominal identity", () => {
    expect(
      classifyHouseholdPeopleOperationCause(
        Cause.fail({ _tag: "SchemaError", issue: {} })
      )
    ).toMatchObject({ code: "transport_unavailable" });
  });

  it("classifies a prototype-branded schema failure from the generated client", () => {
    const error = Object.create({
      _tag: "SchemaError",
      "~effect/SchemaError/SchemaError": "~effect/SchemaError/SchemaError",
    }) as unknown;

    expect(
      classifyHouseholdPeopleOperationCause(Cause.fail(error))
    ).toMatchObject({ code: "transport_unavailable" });
  });

  it("classifies a prototype-branded HTTP failure from the generated client", () => {
    const error = Object.create({
      _tag: "HttpClientError",
      reason: { _tag: "TransportError" },
      "~effect/http/HttpClientError": "~effect/http/HttpClientError",
    }) as unknown;

    expect(
      classifyHouseholdPeopleOperationCause(Cause.fail(error))
    ).toMatchObject({ code: "transport_unavailable" });
  });

  it("traverses a prototype-inherited generated-client cause", () => {
    const error = Object.create({
      cause: Object.create({
        _tag: "HttpClientError",
        reason: { _tag: "TransportError" },
        "~effect/http/HttpClientError": "~effect/http/HttpClientError",
      }),
    }) as unknown;

    expect(
      classifyHouseholdPeopleOperationCause(Cause.die(error))
    ).toMatchObject({ code: "transport_unavailable" });
  });

  it("traverses a structurally branded cross-instance cause", () => {
    const cause = {
      reasons: [
        {
          _tag: "Fail",
          error: { _tag: "SchemaError", issue: {} },
          "~effect/Cause/Reason": "~effect/Cause/Reason",
        },
      ],
      "~effect/Cause": "~effect/Cause",
    } as unknown as Cause.Cause<unknown>;

    expect(classifyHouseholdPeopleOperationCause(cause)).toMatchObject({
      code: "transport_unavailable",
    });
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

  it("classifies an isolated server response as transient", async () => {
    fetchMock.mockImplementation(async () =>
      Response.json({ message: "temporarily unavailable" }, { status: 503 })
    );

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

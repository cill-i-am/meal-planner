import { HouseholdPersonId, PersonProfile } from "@meal-planner/household-api";
import { QueryClient, isCancelledError } from "@tanstack/react-query";
import { Cause, Effect, Schema } from "effect";
import { expect, it, vi } from "vitest";

import { apiEffectQuery } from "../api-client/index.js";
import { parseDisplayedIdentity } from "../auth/index.js";
import { makeHouseholdProfileEffectOperations } from "./browser-operations.js";
import {
  profileOperationFailure,
  isAmbiguousProfileError,
  ProfileOperationError,
} from "./operations.js";

const personId = Schema.decodeUnknownSync(HouseholdPersonId)(
  "person_00000000-0000-4000-8000-000000000101"
);
const scope = parseDisplayedIdentity({
  organizationId: "organization-a",
  userId: "user-a",
});
const profile = Schema.decodeUnknownSync(PersonProfile)({
  audit: null,
  facts: [],
  personId,
  version: 0,
});

it("reads and paginates profiles through the scoped generated client", async () => {
  const requests: Request[] = [];
  const fetch = vi.fn<typeof globalThis.fetch>(async (request, init) => {
    requests.push(new Request(request, init));
    return Response.json(
      requests.length === 1
        ? Schema.encodeSync(PersonProfile)(profile)
        : { nextBeforeVersion: null, versions: [] }
    );
  });
  const operations = makeHouseholdProfileEffectOperations(scope, {
    baseUrl: location.origin,
    fetch,
  });
  expect(await Effect.runPromise(operations.get(personId))).toEqual(profile);
  await Effect.runPromise(operations.versions(personId, 2));
  expect(requests.map((request) => new URL(request.url).pathname)).toEqual([
    `/v1/families/organization-a/people/${personId}/profile`,
    `/v1/families/organization-a/people/${personId}/profile/versions`,
  ]);
  expect(
    new URL(requests[1]?.url ?? location.origin).searchParams.get(
      "beforeVersion"
    )
  ).toBe("2");
  for (const request of requests) {
    expect(request.headers.get("x-meal-planner-user")).toBe("user-a");
    expect(request.headers.get("x-meal-planner-household")).toBe(
      "organization-a"
    );
    expect(request.credentials).toBe("same-origin");
  }
});

it("propagates query disposal to an in-flight generated profile read", async () => {
  let signal: AbortSignal | null | undefined;
  const fetch = vi.fn<typeof globalThis.fetch>((_request, init) => {
    signal = init?.signal;
    return new Promise<Response>(() => {});
  });
  const operations = makeHouseholdProfileEffectOperations(scope, {
    baseUrl: location.origin,
    fetch,
  });
  const client = new QueryClient();
  const queryKey = ["profile-disposal", personId];
  const pending = client.fetchQuery(
    apiEffectQuery.queryOptions({
      queryFn: () => operations.get(personId),
      queryKey,
      retry: false,
    })
  );
  const cancelled = expect(pending).rejects.toSatisfy(isCancelledError);
  await vi.waitFor(() => expect(signal).toBeDefined());
  await client.cancelQueries({ queryKey });
  expect(signal?.aborted).toBe(true);
  await cancelled;
  expect(client.getQueryData(queryKey)).toBeUndefined();
  client.clear();
});

it.each([
  {
    cause: Cause.fail(new ProfileOperationError("stale_version")),
    code: "stale_version",
    uncertain: false,
  },
  {
    cause: Cause.combine(
      Cause.fail(new ProfileOperationError("stale_version")),
      Cause.die(new Error("response lost"))
    ),
    code: undefined,
    uncertain: true,
  },
  {
    cause: Cause.die(new Error("response lost")),
    code: undefined,
    uncertain: true,
  },
])(
  "keeps the full query cause when deciding whether a command is unresolved ($uncertain)",
  async ({ cause, code, uncertain }) => {
    const client = new QueryClient();
    try {
      await client.fetchQuery(
        apiEffectQuery.queryOptions({
          queryFn: () => Effect.failCause(cause),
          queryKey: ["profile-failure", uncertain, code],
          retry: false,
        })
      );
    } catch (error) {
      if (!(error instanceof Error)) {
        throw new Error("Expected query failure", { cause: error });
      }
      expect(profileOperationFailure(error)?.code).toBe(code);
      expect(isAmbiguousProfileError(error)).toBe(uncertain);
      client.clear();
      return;
    }
    throw new Error("Expected query failure");
  }
);

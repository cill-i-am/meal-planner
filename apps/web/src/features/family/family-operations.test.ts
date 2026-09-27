import { CreateFamily } from "@meal-planner/families";
import { UserId } from "@meal-planner/household-api";
import { Effect, Exit, Schema } from "effect";
import { expect, it } from "vitest";

import { familyOperation } from "./family-operations.js";

const userId = Schema.decodeUnknownSync(UserId)("retry-owner");
const payload = Schema.decodeUnknownSync(CreateFamily)({
  mutationId: "00000000-0000-4000-8000-000000000123",
  name: "Retry family",
});
const saved = {
  canManage: true,
  createdAtEpochMs: 1,
  id: "family-retry",
  name: payload.name,
  setup: { status: "in_progress" },
  slug: "retry-family",
  updatedAtEpochMs: 1,
  version: 1,
};

it("retries transient responses with the identical command and stops after success", async () => {
  const requests: unknown[] = [];
  const transport: typeof fetch = async (input, init) => {
    requests.push(await new Request(input, init).json());
    return requests.length < 3
      ? new Response("Unavailable", { status: 503 })
      : Response.json(saved);
  };
  const result = await Effect.runPromise(
    familyOperation(
      { baseUrl: "https://test.local", fetch: transport },
      userId,
      (api) => api.families.create({ payload })
    )
  );
  expect(result.name).toBe(payload.name);
  expect(requests).toEqual([payload, payload, payload]);
});

it.each([
  [403, { _tag: "FamilyForbidden", message: "Not permitted" }],
  [200, { invalid: "response" }],
])(
  "does not retry a deterministic rejection or malformed success (%s)",
  async (status, body) => {
    let attempts = 0;
    const transport: typeof fetch = async () => {
      attempts += 1;
      return Response.json(body, { status });
    };
    const result = await Effect.runPromiseExit(
      familyOperation(
        { baseUrl: "https://test.local", fetch: transport },
        userId,
        (api) => api.families.create({ payload })
      )
    );
    expect(Exit.isFailure(result)).toBe(true);
    expect(attempts).toBe(1);
  }
);

it("aborts an in-flight request without starting a retry", async () => {
  const started = Promise.withResolvers<null>();
  const aborted = Promise.withResolvers<null>();
  let attempts = 0;
  const transport: typeof fetch = (input, init) => {
    attempts += 1;
    const request = new Request(input, init);
    return new Promise((_resolve, reject) => {
      request.signal.addEventListener(
        "abort",
        () => {
          aborted.resolve(null);
          reject(new DOMException("Aborted", "AbortError"));
        },
        { once: true }
      );
      started.resolve(null);
    });
  };
  const controller = new AbortController();
  const result = Effect.runPromiseExit(
    familyOperation(
      { baseUrl: "https://test.local", fetch: transport },
      userId,
      (api) => api.families.create({ payload })
    ),
    { signal: controller.signal }
  );
  await started.promise;
  controller.abort();
  await aborted.promise;
  expect(Exit.isFailure(await result)).toBe(true);
  expect(attempts).toBe(1);
});

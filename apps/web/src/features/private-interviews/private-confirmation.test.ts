import { PrivateConfirmationMetadata } from "@meal-planner/private-interview-api";
import { Schema } from "effect";
import { expect, it, vi } from "vitest";

import { parseDisplayedIdentity } from "../auth/index.js";
import {
  continuePrivateConfirmation,
  makePrivateConfirmationEffectOperations,
} from "./private-confirmation.js";

const metadata = Schema.decodeUnknownSync(PrivateConfirmationMetadata)({
  generation: "00000000-0000-4000-8000-000000000003",
  mutationId: "00000000-0000-4000-8000-000000000002",
  sessionReference: "00000000-0000-4000-8000-000000000001",
});
const scope = parseDisplayedIdentity({
  organizationId: "organization-a",
  userId: "user-a",
});

it.each([
  [204, "accepted"],
  [401, "authentication_required"],
  [403, "unavailable"],
  [503, "unavailable"],
  [200, "unavailable"],
  [500, "unavailable"],
] as const)(
  "sends only scoped confirmation metadata through the generated client for HTTP %s",
  async (status, outcome) => {
    const requests: Request[] = [];
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      requests.push(new Request(input, init));
      return new Response(null, { status });
    });
    const operations = makePrivateConfirmationEffectOperations(scope, {
      baseUrl: "https://meal-planner.test",
      fetch,
    });
    expect(
      await continuePrivateConfirmation(metadata, operations, {
        signal: new AbortController().signal,
      })
    ).toBe(outcome);
    expect(requests).toHaveLength(1);
    const [request] = requests;
    expect(request?.url).toBe(
      `https://meal-planner.test/v1/private-interviews/${metadata.sessionReference}/confirmations/${metadata.mutationId}`
    );
    expect(request?.method).toBe("POST");
    expect(request?.credentials).toBe("same-origin");
    expect(request?.body).toBeNull();
    expect(request?.headers.get("x-meal-planner-user")).toBe(scope.userId);
    expect(request?.headers.get("x-meal-planner-household")).toBe(
      scope.organizationId
    );
    expect(request?.headers.get("x-private-output-generation")).toBe(
      metadata.generation
    );
  }
);

it("propagates callback cancellation into the generated fetch without reporting acceptance", async () => {
  let signal: AbortSignal | null | undefined;
  const fetch = vi.fn<typeof globalThis.fetch>((_input, init) => {
    signal = init?.signal;
    return new Promise<Response>(() => {});
  });
  const operations = makePrivateConfirmationEffectOperations(scope, {
    baseUrl: "https://meal-planner.test",
    fetch,
  });
  const controller = new AbortController();
  const pending = continuePrivateConfirmation(metadata, operations, {
    signal: controller.signal,
  });
  const rejected = expect(pending).rejects.toBeDefined();
  await vi.waitFor(() => expect(signal).toBeDefined());
  controller.abort();
  await rejected;
  expect(signal?.aborted).toBe(true);
});

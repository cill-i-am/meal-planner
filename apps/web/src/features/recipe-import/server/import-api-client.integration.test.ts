import { Effect, Schema } from "effect";
import { afterEach, describe, expect, it } from "vitest";

import {
  PocFakeApiToken,
  startPocFakeApi,
} from "../../../../scripts/poc-fake-api.js";
import {
  ApproveRecipeInput,
  ImportIdentityInput,
  RecipeBankInput,
  SubmitImportInput,
} from "../contracts.js";
import { makeImportApiClient } from "./import-api-client.js";
import type { ImportApiFailure } from "./import-api-client.js";

const closers: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

const makeClient = (baseUrl: string, token = PocFakeApiToken) =>
  Effect.runPromise(makeImportApiClient({ baseUrl, token }));

const failureOf = <A>(effect: Effect.Effect<A, ImportApiFailure>) =>
  Effect.runPromise(Effect.flip(effect));

describe("recipe import API client against the separate fake HTTP API", () => {
  it("keeps auth server-side and replays stable admission and approval identifiers", async () => {
    const fake = await startPocFakeApi();
    closers.push(fake.close);
    const client = await makeClient(fake.baseUrl);
    const sourceUrl =
      "https://www.tiktok.com/@kitchen/video/7390123456789012345";
    const idempotencyKey = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const submitInput = Schema.decodeUnknownSync(SubmitImportInput)({
      idempotencyKey,
      sourceUrl,
    });

    const submitted = await Effect.runPromise(client.submit(submitInput));
    await Effect.runPromise(client.submit(submitInput));
    const pollInput = Schema.decodeUnknownSync(ImportIdentityInput)({
      importId: submitted.importId,
    });
    const acquiring = await Effect.runPromise(client.poll(pollInput));
    const transcribing = await Effect.runPromise(client.poll(pollInput));
    const extractingVisual = await Effect.runPromise(client.poll(pollInput));
    const progress = await Effect.runPromise(client.poll(pollInput));

    expect([
      acquiring.status.kind,
      transcribing.status.kind,
      extractingVisual.status.kind,
      progress.status.kind,
    ]).toEqual([
      "acquiring",
      "transcribing",
      "extracting_visual",
      "needs_review",
    ]);
    expect(progress.draftId).toBe(submitted.importId);

    if (progress.draftId === undefined) {
      throw new Error("Expected a review draft ID");
    }
    const review = await Effect.runPromise(client.loadReview(progress.draftId));
    expect(review).toMatchObject({
      name: "Roasted aubergine bake",
      status: "needs_review",
      version: 1,
    });
    expect(JSON.stringify(review)).not.toContain("providerPayload");

    const mutationId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const approvalInput = Schema.decodeUnknownSync(ApproveRecipeInput)({
      draftId: progress.draftId,
      expectedVersion: review.version,
      mutationId,
    });
    const applied = await Effect.runPromise(client.approve(approvalInput));
    const replayed = await Effect.runPromise(client.approve(approvalInput));
    expect(applied.outcome).toBe("applied");
    expect(replayed.outcome).toBe("replayed");

    const bank = await Effect.runPromise(
      client.listBank(Schema.decodeUnknownSync(RecipeBankInput)({ sourceUrl }))
    );
    expect(bank.recipe).toMatchObject({
      name: review.name,
      recipeId: submitted.importId,
    });

    const evidence = fake.inspect();
    expect(evidence.requestKeys).toEqual([[idempotencyKey, sourceUrl]]);
    expect(evidence.approvalMutationCount).toBe(1);
    expect(evidence.approvedRecipeCount).toBe(1);
    expect(evidence.approvals).toEqual([
      {
        expectedVersion: 1,
        mutationId,
        reason: "Recipe checked in the web proof of concept.",
      },
      {
        expectedVersion: 1,
        mutationId,
        reason: "Recipe checked in the web proof of concept.",
      },
    ]);
    expect(evidence.requests.every((request) => request.authenticated)).toBe(
      true
    );
    expect(
      evidence.requests.map(({ method, path }) => `${method} ${path}`)
    ).toEqual([
      "POST /imports",
      "POST /imports",
      `GET /imports/${submitted.importId}`,
      `GET /imports/${submitted.importId}`,
      `GET /imports/${submitted.importId}`,
      `GET /imports/${submitted.importId}`,
      `GET /recipe-drafts/${submitted.importId}`,
      `POST /recipe-drafts/${submitted.importId}/approve`,
      `POST /recipe-drafts/${submitted.importId}/approve`,
      "GET /recipe-bank",
    ]);
  });

  it.each([
    [401, "server_configuration", false],
    [409, "conflict", false],
    [422, "invalid_request", false],
    [503, "unavailable", true],
  ] as const)(
    "maps %s without forwarding upstream detail",
    async (status, code, retryable) => {
      const fake = await startPocFakeApi(
        status === 401 ? {} : { forceStatus: status }
      );
      closers.push(fake.close);
      const client = await makeClient(
        fake.baseUrl,
        status === 401 ? "wrong-local-token" : PocFakeApiToken
      );
      const failure = await failureOf(
        client.submit(
          Schema.decodeUnknownSync(SubmitImportInput)({
            idempotencyKey: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
            sourceUrl:
              "https://www.tiktok.com/@kitchen/video/7390123456789012345",
          })
        )
      );

      expect(failure.failure).toMatchObject({ code, retryable });
      expect(JSON.stringify(failure.failure)).not.toContain(
        "Private test detail"
      );
    }
  );

  it("rejects a non-loopback API base before making a request", async () => {
    const failure = await failureOf(
      makeImportApiClient({
        baseUrl: "https://api.example.com/",
        token: PocFakeApiToken,
      })
    );
    expect(failure.failure.code).toBe("server_configuration");
  });
});

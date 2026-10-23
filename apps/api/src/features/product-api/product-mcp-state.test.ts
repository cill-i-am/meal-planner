import { describe, expect, it } from "@effect/vitest";
import { Effect, Redacted, Result, Schema } from "effect";
import { Base64Url } from "effect/encoding";
import { TestClock } from "effect/testing";

import {
  makeProductMcpState,
  ProductMcpReviewLifetimeMs,
  ProductMcpTaskLifetimeMs,
} from "./product-mcp-state.js";
import type { ProductMcpStateError } from "./product-mcp-state.js";

const secret = Redacted.make(
  "mcp-state-test-secret-with-at-least-32-characters"
);
const owner = { clientId: "oauth-client-a", userId: "user-a" };
const locator = {
  createdAt: 0,
  familyId: "family-a",
  intentId: "a72b4fca-8c81-4e5c-8a91-560835eae615",
};
const continuation = {
  actionId: "a".repeat(64),
  actionVersion: 3,
  expiresAt: ProductMcpReviewLifetimeMs,
  familyId: locator.familyId,
  idempotencyKey: "confirm-import-review-1",
  intentId: locator.intentId,
};
const makeState = () => makeProductMcpState({ owner, secret });
const readPayload = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.Json))
);
const taskEnvelope = {
  locator,
  owner,
  purpose: "recipe-import-task",
  version: 1,
};
const reviewEnvelope = {
  continuation,
  owner,
  purpose: "recipe-import-review",
  version: 1,
};

/** Valid MAC fixtures distinguish signature rejection from strict claim parsing. */
const signPayload = (payload: string | Uint8Array) =>
  Effect.promise(async () => {
    const encoded = Base64Url.encode(payload);
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(Redacted.value(secret)),
      { hash: "SHA-256", name: "HMAC" },
      false,
      ["sign"]
    );
    const signature = await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(`meal-planner:mcp-state:v1.${encoded}`)
    );
    return `${encoded}.${Base64Url.encode(new Uint8Array(signature))}`;
  });

const expectInvalid = (result: Effect.Effect<unknown, ProductMcpStateError>) =>
  Effect.gen(function* assertInvalidState() {
    expect(yield* result.pipe(Effect.flip)).toMatchObject({
      _tag: "ProductMcpStateError",
      reason: "invalid",
    });
  });

describe("MCP import state", () => {
  it.effect(
    "keeps task identity stable across retries and request-owned instances",
    () =>
      Effect.gen(function* stableTaskIdentity() {
        const first = yield* makeState();
        const second = yield* makeProductMcpState({
          // eslint-disable-next-line sort-keys -- Input property order must not alter signed identity.
          owner: { userId: owner.userId, clientId: owner.clientId },
          secret,
        });
        const token = yield* first.issueTask(locator);
        yield* TestClock.adjust("1 day");
        expect(
          yield* second.issueTask({
            /* eslint-disable sort-keys -- Input property order must not alter signed identity. */
            intentId: locator.intentId,
            familyId: locator.familyId,
            createdAt: locator.createdAt,
            /* eslint-enable sort-keys */
          })
        ).toBe(token);
        expect(yield* second.readTask(token)).toEqual(locator);
        expect(token).toBe(yield* signPayload(JSON.stringify(taskEnvelope)));
        const payload = token.split(".")[0] ?? "";
        expect(
          readPayload(Result.getOrThrow(Base64Url.decodeString(payload)))
        ).toEqual(taskEnvelope);
      })
  );

  it.effect(
    "rejects another user, another OAuth client and another signing secret",
    () =>
      Effect.gen(function* rejectsForeignOwner() {
        const state = yield* makeState();
        const task = yield* state.issueTask(locator);
        const review = yield* state.issueReview(continuation);
        for (const options of [
          { owner: { ...owner, userId: "user-b" }, secret },
          { owner: { ...owner, clientId: "oauth-client-b" }, secret },
          {
            owner,
            secret: Redacted.make(
              "different-state-secret-at-least-32-characters"
            ),
          },
        ]) {
          const other = yield* makeProductMcpState(options);
          yield* expectInvalid(other.readTask(task));
          yield* expectInvalid(other.readReview(review));
        }
      })
  );

  it.effect("roundtrips the largest encoded expansion of valid claims", () =>
    Effect.gen(function* acceptsBoundedUnicodeClaims() {
      const identity = "界".repeat(255);
      const state = yield* makeProductMcpState({
        owner: { clientId: identity, userId: identity },
        secret,
      });
      const input = {
        ...continuation,
        familyId: identity,
        idempotencyKey: "\u0000".repeat(128),
      };
      const token = yield* state.issueReview(input);
      expect(token.length).toBeGreaterThan(4096);
      expect(token.length).toBeLessThanOrEqual(8192);
      expect(yield* state.readReview(token)).toEqual(input);
    })
  );

  it.effect(
    "separates task locators from review publication continuations",
    () =>
      Effect.gen(function* rejectsOtherPurpose() {
        const state = yield* makeState();
        yield* expectInvalid(
          state.readTask(yield* state.issueReview(continuation))
        );
        yield* expectInvalid(state.readReview(yield* state.issueTask(locator)));
      })
  );

  it.effect(
    "binds every review field and returns the same command for a retry",
    () =>
      Effect.gen(function* bindsReviewCommand() {
        const state = yield* makeState();
        const token = yield* state.issueReview(continuation);
        expect(yield* state.readReview(token)).toEqual(continuation);
        expect(yield* state.readReview(token)).toEqual(continuation);
        expect(yield* state.issueReview(continuation)).toBe(token);
        const signature = token.split(".")[1] ?? "";
        for (const replacement of [
          { actionId: "b".repeat(64) },
          { actionVersion: 4 },
          { expiresAt: continuation.expiresAt - 1 },
          { familyId: "family-b" },
          { idempotencyKey: "different-command" },
          { intentId: "b72b4fca-8c81-4e5c-8a91-560835eae615" },
        ]) {
          const payload = Base64Url.encode(
            JSON.stringify({
              ...reviewEnvelope,
              continuation: { ...continuation, ...replacement },
            })
          );
          yield* expectInvalid(state.readReview(`${payload}.${signature}`));
        }
      })
  );

  it.effect("expires task handles seven days after original creation", () =>
    Effect.gen(function* expiresTaskLocator() {
      const state = yield* makeState();
      const token = yield* state.issueTask(locator);
      yield* TestClock.adjust(ProductMcpTaskLifetimeMs - 1);
      expect(yield* state.readTask(token)).toEqual(locator);
      expect(yield* state.issueTask(locator)).toBe(token);
      yield* TestClock.adjust(1);
      expect(yield* state.readTask(token).pipe(Effect.flip)).toMatchObject({
        reason: "expired",
      });
      expect(yield* state.issueTask(locator).pipe(Effect.flip)).toMatchObject({
        reason: "expired",
      });
    })
  );

  it.effect("rejects future task creation on issuance and reading", () =>
    Effect.gen(function* rejectsFutureTask() {
      const state = yield* makeState();
      expect(
        yield* state.issueTask({ ...locator, createdAt: 1 }).pipe(Effect.flip)
      ).toMatchObject({ reason: "invalid" });
      const token = yield* signPayload(
        JSON.stringify({
          ...taskEnvelope,
          locator: { ...locator, createdAt: ProductMcpTaskLifetimeMs },
        })
      );
      yield* expectInvalid(state.readTask(token));
    })
  );

  it.effect(
    "bounds review continuation lifetime and expires at the exact deadline",
    () =>
      Effect.gen(function* expiresReviewContinuation() {
        const state = yield* makeState();
        const token = yield* state.issueReview(continuation);
        expect(
          yield* state
            .issueReview({
              ...continuation,
              expiresAt: ProductMcpReviewLifetimeMs + 1,
            })
            .pipe(Effect.flip)
        ).toMatchObject({ reason: "invalid" });
        const tooLong = yield* signPayload(
          JSON.stringify({
            ...reviewEnvelope,
            continuation: {
              ...continuation,
              expiresAt: ProductMcpReviewLifetimeMs + 1,
            },
          })
        );
        yield* expectInvalid(state.readReview(tooLong));
        yield* TestClock.adjust(ProductMcpReviewLifetimeMs - 1);
        expect(yield* state.readReview(token)).toEqual(continuation);
        yield* TestClock.adjust(1);
        expect(yield* state.readReview(token).pipe(Effect.flip)).toMatchObject({
          reason: "expired",
        });
        expect(
          yield* state.issueReview(continuation).pipe(Effect.flip)
        ).toMatchObject({ reason: "expired" });
      })
  );

  it.effect(
    "rejects malformed, oversized, noncanonical and invalid UTF-8 tokens",
    () =>
      Effect.gen(function* rejectsMalformedState() {
        const state = yield* makeState();
        const token = yield* state.issueTask(locator);
        const [payload = "", signature = ""] = token.split(".");
        for (const value of [
          "",
          "a".repeat(8193),
          `${token}.extra`,
          `${payload}=.${signature}`,
          `${payload}.\n${signature}`,
          `A.${signature}`,
          `${payload}.${signature.slice(0, -1)}!`,
          yield* signPayload(new Uint8Array([0xff, 0xfe])),
          yield* signPayload("not JSON"),
        ]) {
          yield* expectInvalid(state.readTask(value));
        }
        // Alternate Base64 final padding bits can decode to identical signature bytes.
        const alphabet =
          "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
        const last = signature.at(-1) ?? "";
        const alternative = alphabet[alphabet.indexOf(last) + 1] ?? "";
        yield* expectInvalid(
          state.readTask(`${payload}.${signature.slice(0, -1)}${alternative}`)
        );
      })
  );

  it.effect("strictly decodes signed owner, version and domain claims", () =>
    Effect.gen(function* rejectsInvalidClaims() {
      const state = yield* makeState();
      for (const envelope of [
        { ...taskEnvelope, extra: true },
        { ...taskEnvelope, owner: { ...owner, userId: "" } },
        { ...taskEnvelope, owner: { ...owner, clientId: "" } },
        { ...taskEnvelope, version: 2 },
        { ...taskEnvelope, locator: { ...locator, createdAt: 0.5 } },
        { ...taskEnvelope, locator: { ...locator, createdAt: -1 } },
        { ...taskEnvelope, locator: { ...locator, familyId: "" } },
        { ...taskEnvelope, locator: { ...locator, intentId: "not-an-intent" } },
        { ...taskEnvelope, locator: { ...locator, authorization: "forged" } },
      ]) {
        yield* expectInvalid(
          state.readTask(yield* signPayload(JSON.stringify(envelope)))
        );
      }
      for (const invalidContinuation of [
        { ...continuation, actionId: "untrusted" },
        { ...continuation, actionVersion: 0 },
        { ...continuation, idempotencyKey: "" },
        { ...continuation, expiresAt: Number.MAX_SAFE_INTEGER + 1 },
        { ...continuation, humanApproved: true },
      ]) {
        const signed = yield* signPayload(
          JSON.stringify({
            ...reviewEnvelope,
            continuation: invalidContinuation,
          })
        );
        yield* expectInvalid(state.readReview(signed));
        expect(
          yield* state.issueReview(invalidContinuation).pipe(Effect.flip)
        ).toMatchObject({ reason: "invalid" });
      }
    })
  );

  it.effect(
    "fails closed for empty owners and missing signing configuration",
    () =>
      Effect.gen(function* rejectsInvalidConfiguration() {
        for (const invalidOwner of [
          { ...owner, userId: "" },
          { ...owner, clientId: "" },
          { ...owner, clientId: " client " },
          { ...owner, clientId: "x".repeat(256) },
        ]) {
          expect(
            yield* makeProductMcpState({ owner: invalidOwner, secret }).pipe(
              Effect.flip
            )
          ).toMatchObject({ reason: "invalid" });
        }
        expect(
          yield* makeProductMcpState({
            owner,
            secret: Redacted.make(""),
          }).pipe(Effect.flip)
        ).toMatchObject({ reason: "unavailable" });
      })
  );
});

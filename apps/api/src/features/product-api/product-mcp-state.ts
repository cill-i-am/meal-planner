import { HouseholdOrganizationId, UserId } from "@meal-planner/household-api";
import {
  IdempotencyKey,
  RecipeImportActionId,
  RecipeImportActionVersion,
  RecipeImportIntentId,
} from "@meal-planner/recipe-import-api";
import { Clock, Data, Effect, Redacted, Result, Schema } from "effect";
import { Base64Url } from "effect/encoding";

export const ProductMcpTaskLifetimeMs = 7 * 24 * 60 * 60 * 1000;
export const ProductMcpReviewLifetimeMs = 10 * 60 * 1000;

const EpochMillis = Schema.Number.pipe(
  Schema.check(
    Schema.isInt(),
    Schema.isGreaterThanOrEqualTo(0),
    Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER)
  )
);
const Owner = Schema.Struct({
  clientId: Schema.String.pipe(
    Schema.check(
      Schema.isNonEmpty(),
      Schema.isMaxLength(255),
      Schema.isPattern(/^[^\s\p{Cc}]+$/u)
    )
  ),
  userId: UserId,
});

/** A locator for an existing durable import, never a grant to read that import. */
export const ProductMcpTaskLocator = Schema.Struct({
  createdAt: EpochMillis,
  familyId: HouseholdOrganizationId,
  intentId: RecipeImportIntentId,
});
export type ProductMcpTaskLocator = typeof ProductMcpTaskLocator.Type;

/** The complete immutable input to the existing confirm-review command. */
export const ProductMcpReviewContinuation = Schema.Struct({
  actionId: RecipeImportActionId,
  actionVersion: RecipeImportActionVersion,
  expiresAt: EpochMillis,
  familyId: HouseholdOrganizationId,
  idempotencyKey: IdempotencyKey,
  intentId: RecipeImportIntentId,
});
export type ProductMcpReviewContinuation =
  typeof ProductMcpReviewContinuation.Type;

const TaskEnvelope = Schema.Struct({
  locator: ProductMcpTaskLocator,
  owner: Owner,
  purpose: Schema.Literal("recipe-import-task"),
  version: Schema.Literal(1),
});
const ReviewEnvelope = Schema.Struct({
  continuation: ProductMcpReviewContinuation,
  owner: Owner,
  purpose: Schema.Literal("recipe-import-review"),
  version: Schema.Literal(1),
});
const SignedState = Schema.String.pipe(
  Schema.check(
    Schema.isMaxLength(8192),
    Schema.isPattern(/^[A-Za-z\d_-]+\.[A-Za-z\d_-]{43}$/u)
  )
);
const strict = { onExcessProperty: "error" } as const;
const decodeOwner = Schema.decodeUnknownEffect(Owner, strict);
const decodeTask = Schema.decodeUnknownEffect(ProductMcpTaskLocator, strict);
const decodeReview = Schema.decodeUnknownEffect(
  ProductMcpReviewContinuation,
  strict
);
const decodeSignedState = Schema.decodeUnknownEffect(SignedState, strict);
const decodeTaskEnvelope = Schema.decodeUnknownEffect(
  Schema.fromJsonString(TaskEnvelope),
  strict
);
const decodeReviewEnvelope = Schema.decodeUnknownEffect(
  Schema.fromJsonString(ReviewEnvelope),
  strict
);
const algorithm = { hash: "SHA-256", name: "HMAC" } as const;
const signedBytes = (payload: string) =>
  new TextEncoder().encode(`meal-planner:mcp-state:v1.${payload}`);

export class ProductMcpStateError extends Data.TaggedError(
  "ProductMcpStateError"
)<{
  readonly reason: "invalid" | "expired" | "unavailable";
}> {}

const invalid = () => new ProductMcpStateError({ reason: "invalid" });
const unavailable = () => new ProductMcpStateError({ reason: "unavailable" });
const expired = () => new ProductMcpStateError({ reason: "expired" });

export interface ProductMcpState {
  readonly issueTask: (
    locator: typeof ProductMcpTaskLocator.Encoded
  ) => Effect.Effect<string, ProductMcpStateError>;
  readonly readTask: (
    token: string
  ) => Effect.Effect<ProductMcpTaskLocator, ProductMcpStateError>;
  readonly issueReview: (
    continuation: typeof ProductMcpReviewContinuation.Encoded
  ) => Effect.Effect<string, ProductMcpStateError>;
  readonly readReview: (
    token: string
  ) => Effect.Effect<ProductMcpReviewContinuation, ProductMcpStateError>;
}

const checkTaskTime = (locator: ProductMcpTaskLocator) =>
  Effect.gen(function* validateTaskLifetime() {
    const now = yield* Clock.currentTimeMillis;
    if (locator.createdAt > now) {
      return yield* Effect.fail(invalid());
    }
    if (now - locator.createdAt >= ProductMcpTaskLifetimeMs) {
      return yield* Effect.fail(expired());
    }
  });

const checkReviewTime = (continuation: ProductMcpReviewContinuation) =>
  Effect.gen(function* validateReviewLifetime() {
    const now = yield* Clock.currentTimeMillis;
    if (continuation.expiresAt <= now) {
      return yield* Effect.fail(expired());
    }
    if (continuation.expiresAt - now > ProductMcpReviewLifetimeMs) {
      return yield* Effect.fail(invalid());
    }
  });

/**
 * Request-owned signing adapter. Every use still needs current OAuth admission,
 * scopes and household membership; review replay belongs to the domain receipt.
 * Stable claims make retries deterministic without another persisted workflow.
 */
export const makeProductMcpState = (options: {
  readonly owner: { readonly clientId: string; readonly userId: string };
  readonly secret: Redacted.Redacted<string>;
}): Effect.Effect<ProductMcpState, ProductMcpStateError> =>
  Effect.gen(function* makeImportMcpState() {
    const owner = yield* decodeOwner(options.owner).pipe(
      Effect.mapError(invalid)
    );
    if (Redacted.value(options.secret).length < 32) {
      return yield* Effect.fail(unavailable());
    }
    const key = yield* Effect.tryPromise({
      catch: unavailable,
      try: () =>
        crypto.subtle.importKey(
          "raw",
          new TextEncoder().encode(Redacted.value(options.secret)),
          algorithm,
          false,
          ["sign", "verify"]
        ),
    });
    const sign = (payload: string) => {
      const encoded = Base64Url.encode(payload);
      return Effect.tryPromise({
        catch: unavailable,
        try: () => crypto.subtle.sign(algorithm, key, signedBytes(encoded)),
      }).pipe(
        Effect.map(
          (signature) =>
            `${encoded}.${Base64Url.encode(new Uint8Array(signature))}`
        ),
        Effect.flatMap(decodeSignedState),
        Effect.mapError((failure) =>
          failure._tag === "SchemaError" ? invalid() : failure
        )
      );
    };
    const verifiedPayload = (token: string) =>
      Effect.gen(function* verifyMcpState() {
        const value = yield* decodeSignedState(token).pipe(
          Effect.mapError(invalid)
        );
        const [payload, signature] = value.split(".");
        if (payload === undefined || signature === undefined) {
          return yield* Effect.fail(invalid());
        }
        const signatureBytes = Base64Url.decode(signature);
        const payloadBytes = Base64Url.decode(payload);
        if (
          Result.isFailure(signatureBytes) ||
          Result.isFailure(payloadBytes) ||
          Base64Url.encode(signatureBytes.success) !== signature ||
          Base64Url.encode(payloadBytes.success) !== payload
        ) {
          return yield* Effect.fail(invalid());
        }
        const verified = yield* Effect.tryPromise({
          catch: unavailable,
          try: () =>
            crypto.subtle.verify(
              algorithm,
              key,
              new Uint8Array(signatureBytes.success),
              signedBytes(payload)
            ),
        });
        if (!verified) {
          return yield* Effect.fail(invalid());
        }
        return yield* Effect.try({
          catch: invalid,
          try: () =>
            new TextDecoder("utf-8", { fatal: true }).decode(
              payloadBytes.success
            ),
        });
      });
    const checkOwner = (supplied: typeof Owner.Type) =>
      supplied.userId === owner.userId && supplied.clientId === owner.clientId
        ? Effect.void
        : Effect.fail(invalid());
    return {
      issueReview: (input) =>
        Effect.gen(function* issueReviewContinuation() {
          const continuation = yield* decodeReview(input).pipe(
            Effect.mapError(invalid)
          );
          yield* checkReviewTime(continuation);
          return yield* sign(
            JSON.stringify({
              continuation: {
                actionId: continuation.actionId,
                actionVersion: continuation.actionVersion,
                expiresAt: continuation.expiresAt,
                familyId: continuation.familyId,
                idempotencyKey: continuation.idempotencyKey,
                intentId: continuation.intentId,
              },
              owner,
              purpose: "recipe-import-review",
              version: 1,
            })
          );
        }),
      issueTask: (input) =>
        Effect.gen(function* issueTaskLocator() {
          const locator = yield* decodeTask(input).pipe(
            Effect.mapError(invalid)
          );
          yield* checkTaskTime(locator);
          return yield* sign(
            JSON.stringify({
              locator: {
                createdAt: locator.createdAt,
                familyId: locator.familyId,
                intentId: locator.intentId,
              },
              owner,
              purpose: "recipe-import-task",
              version: 1,
            })
          );
        }),
      readReview: (token) =>
        Effect.gen(function* readReviewContinuation() {
          const payload = yield* verifiedPayload(token);
          const envelope = yield* decodeReviewEnvelope(payload).pipe(
            Effect.mapError(invalid)
          );
          yield* checkOwner(envelope.owner);
          yield* checkReviewTime(envelope.continuation);
          return envelope.continuation;
        }),
      readTask: (token) =>
        Effect.gen(function* readTaskLocator() {
          const payload = yield* verifiedPayload(token);
          const envelope = yield* decodeTaskEnvelope(payload).pipe(
            Effect.mapError(invalid)
          );
          yield* checkOwner(envelope.owner);
          yield* checkTaskTime(envelope.locator);
          return envelope.locator;
        }),
    };
  });
